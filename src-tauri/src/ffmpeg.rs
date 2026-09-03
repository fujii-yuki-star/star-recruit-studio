// FFmpeg 呼び出し（infrastructure 境界）。アプリに静的リンクせず、ffmpeg.exe を外部実行ファイル（sidecar）として呼ぶ。
// バイナリは「環境変数 → 所定フォルダ(<appData>/bin) → PATH」で解決する（ADR-0002 実装方針）。
// コーデックは h264_mf（Media Foundation＝主経路）→ libopenh264（フォールバック）→ libx264（開発=GPL）を自動選択（ADR-0002/0013）。
// → LGPL+mediafoundation ビルドを所定フォルダに置くだけで h264_mf 出力へ無改修で切り替わる（コマンド生成は不変）。
// SVG→PNG は ADR-0004（WebView Canvas）で生成。FFmpegは PNG/動画/音声の合成のみ（ADR-0001）。
use base64::Engine as _;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, Manager};

// 既定FPS（videoSettings.fps の正典は project.json。B2でフロントから受け取る予定）。
const DEFAULT_FPS: u32 = 30;
// ナレーション既定音量。正典は 11_SCHEMA_REFERENCE §4（=1.0、TS domain/constants.ts と同値）。Rust側ミラー。
const DEFAULT_NARRATION_VOLUME: f64 = 1.0;
// 元動画音声の既定音量。正典は 11_SCHEMA_REFERENCE §4（=0.2、TS domain/constants.ts と同値）。
const DEFAULT_ORIGINAL_AUDIO_VOLUME: f64 = 0.2;
// 再生速度の値域（atempo 1段：0.5〜2.0、1.0=等速）。11 §4 / schemas $defs/Clip。
const SPEED_MIN: f64 = 0.5;
const SPEED_MAX: f64 = 2.0;
const DEFAULT_SPEED: f64 = 1.0;

/// 映像コーデック。主経路は h264_mf（Media Foundation）で、フォールバックとして OpenH264／開発用 libx264 を持つ（ADR-0013）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    /// Windows Media Foundation の H.264（h264_mf）。OS提供コーデック＝H.264書き出しの主経路（ADR-0013）。
    /// h264_mf を持つ FFmpeg がある時に選択される（配布版＝LGPL＋mediafoundation 構成）。
    MediaFoundation,
    OpenH264,
    X264,
}

/// H.264 目標ビットレートの基準（総画素 × fps ベース＝向き非依存。#121 / ADR-0013）。
/// BPP は bits/pixel/frame。1080p30 ≈ 12Mbps（x264 CRF23 同等・品質優先のユーザー決定 2026-06-18）を基準に逆算。
/// 縦型(1080×1920) は横型(1920×1080) と総画素が同じ＝同ビットレートになる。
/// 本定数群は正典(11.4)に枠を持たない配布実装(Rust)固有値（永続データ/schema には載らない）。
const BITRATE_BPP: f64 = 0.19;
const BITRATE_MIN_BPS: u64 = 3_000_000;
const BITRATE_MAX_BPS: u64 = 16_000_000;
/// 出力解像度の probe に失敗したときのフォールバック（従来既定＝16:9 1080p）。
const DEFAULT_OUTPUT_WIDTH: u32 = 1920;
const DEFAULT_OUTPUT_HEIGHT: u32 = 1080;

/// 出力の総画素数 × fps から H.264 目標ビットレート(bps)を求める（h264_mf 用・向き非依存）。
fn target_bitrate_bps(width: u32, height: u32, fps: u32) -> u64 {
    let raw = BITRATE_BPP * f64::from(width) * f64::from(height) * f64::from(fps);
    (raw as u64).clamp(BITRATE_MIN_BPS, BITRATE_MAX_BPS)
}

/// bps を FFmpeg の `-b:v` 引数値（kbps 表記）へ整形する。
fn bitrate_arg(bps: u64) -> String {
    format!("{}k", bps / 1000)
}

/// PNG 先頭24バイトから幅・高さを読む純関数。署名と IHDR チャンク名を検証し、不正なら None。
/// レイアウト: PNG署名(8) + IHDR長(4) + "IHDR"(4) + width(4 BE) + height(4 BE)。
fn parse_png_size(head: &[u8]) -> Option<(u32, u32)> {
    if head.len() < 24 || &head[0..8] != b"\x89PNG\r\n\x1a\n" || &head[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([head[16], head[17], head[18], head[19]]);
    let h = u32::from_be_bytes([head[20], head[21], head[22], head[23]]);
    (w != 0 && h != 0).then_some((w, h))
}

/// PNG ファイルの幅・高さを読む（依存なし・先頭24バイトのみ読む）。失敗時 None。
fn read_png_size(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut f = fs::File::open(path).ok()?;
    let mut head = [0u8; 24];
    f.read_exact(&mut head).ok()?;
    parse_png_size(&head)
}

impl VideoCodec {
    /// FFmpeg の -c:v に渡すエンコーダ名。
    pub fn encoder(self) -> &'static str {
        match self {
            VideoCodec::MediaFoundation => "h264_mf",
            VideoCodec::OpenH264 => "libopenh264",
            VideoCodec::X264 => "libx264",
        }
    }

    /// エンコーダ別の画質（レート制御）指定。`-c:v <encoder>` の直後に置く。
    /// - MediaFoundation: 目標ビットレートを与える（既定が低画質のため）。
    /// - X264: 無指定で CRF 23 相当の良好な既定になるため何も足さない。
    /// - OpenH264: 当面据え置き（フォールバック採用時に同様の指定要否を検証）。
    pub fn quality_args(self, bitrate: &str) -> Vec<String> {
        match self {
            VideoCodec::MediaFoundation => vec!["-b:v".into(), bitrate.into()],
            VideoCodec::OpenH264 | VideoCodec::X264 => Vec::new(),
        }
    }
}

/// `ffmpeg -encoders` の出力から H.264 エンコーダを選ぶ。
/// 優先順位：h264_mf（Media Foundation・OS提供＝主経路, ADR-0013）→ libopenh264（フォールバック）→ libx264（開発用）。
/// 配布版は LGPL＋mediafoundation で h264_mf。開発用 ffmpeg-static は h264_mf を持たないため開発時は libx264。
pub fn pick_codec(encoders_output: &str) -> Option<VideoCodec> {
    if encoders_output.contains("h264_mf") {
        Some(VideoCodec::MediaFoundation)
    } else if encoders_output.contains("libopenh264") {
        Some(VideoCodec::OpenH264)
    } else if encoders_output.contains("libx264") {
        Some(VideoCodec::X264)
    } else {
        None
    }
}

/// `ffmpeg -encoders` 出力を「書き出し能力」の UI 向け状態へ写す純関数（#120・ADR-0013）。
/// - "mediaFoundation": h264_mf（OS提供・主経路）＝標準方式で書き出せる。
/// - "fallback": h264_mf は無いが OpenH264／libx264 がある＝予備方式で書き出しは可能（標準方式ではない）。
/// - "unavailable": H.264 エンコーダが皆無＝書き出し不可（例: Windows N/KN でメディア機能パック未導入かつ予備も無い構成）。
///
/// ツール（ffmpeg）自体が見つからないケースは呼び出し側で "toolMissing" を返す。
pub fn h264_capability(encoders_output: &str) -> &'static str {
    match pick_codec(encoders_output) {
        Some(VideoCodec::MediaFoundation) => "mediaFoundation",
        Some(_) => "fallback",
        None => "unavailable",
    }
}

/// 書き出し能力（#120）。capability は h264_capability の値、または "toolMissing"。encoder は診断用。
/// 注: capability の文字列は TS の `ExportCapability`（src/domain/export/exportCapability.ts）と一致させる
/// （値を増やすときは TS 型・exportCapability.test.ts・h264_capability_maps_encoders_to_ui_states を併せて更新）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct H264Capability {
    capability: String,
    encoder: Option<String>,
}

/// 書き出し前に H.264 エンコード能力を検知する（#120・ADR-0013）。
/// `ffmpeg -encoders` を読み、標準方式（h264_mf）/予備/不可 を判定。ffmpeg 不在は "toolMissing"。
/// UI（公開前チェック）が「次の行動」を事前提示するために使う（書き出し本体は export_video 内で再判定）。
#[tauri::command]
pub fn detect_h264_capability(app: tauri::AppHandle) -> H264Capability {
    let ffmpeg = resolve_ffmpeg(&app);
    match run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]) {
        Ok(encoders) => H264Capability {
            capability: h264_capability(&encoders).into(),
            encoder: pick_codec(&encoders).map(|c| c.encoder().to_string()),
        },
        Err(_) => H264Capability {
            capability: "toolMissing".into(),
            encoder: None,
        },
    }
}

/// 場面MP4の共通末尾（音声＝ナレーション or 無音・出力エンコード・尺クランプ）を args へ足す（純粋）。
/// scene_clip_args / frames_scene_args が共有。呼び出し側で映像入力（input 0）を積んでから呼ぶこと。
#[allow(clippy::too_many_arguments)]
fn append_scene_av_tail(
    args: &mut Vec<String>,
    audio: Option<&str>,
    narration_volume: f64,
    duration_sec: f64,
    fps: u32,
    codec: VideoCodec,
    bitrate: &str,
    out: &str,
    // 映像に噛ませる simple フィルタ（None=映像は 0:v 直結＝従来）。frames 経路が tpad(最終フレーム保持)を渡す（#376）。
    video_filter: Option<&str>,
) {
    // 映像出力ラベルと（必要なら）映像フィルタ節。video_filter があれば [0:v]{vf}[v] を filter_complex に足し [v] を map。
    let vmap = if video_filter.is_some() { "[v]" } else { "0:v" };
    let vfg = video_filter.map(|vf| format!("[0:v]{vf}[v]"));
    match audio {
        Some(a) => {
            // ナレーション音量を適用し、尺に満たない分は無音で埋める（apad）。映像フィルタがあれば同じ filter_complex に連結。
            let fc = match &vfg {
                Some(v) => format!("{v};[1:a]volume={narration_volume},apad[a]"),
                None => format!("[1:a]volume={narration_volume},apad[a]"),
            };
            args.extend([
                "-i".into(),
                a.into(),
                "-filter_complex".into(),
                fc,
                "-map".into(),
                vmap.into(),
                "-map".into(),
                "[a]".into(),
            ]);
        }
        None => {
            // 音声が無い場面は無音トラックを生成して付ける。
            args.extend([
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                format!("{duration_sec}"),
                "-i".into(),
                "anullsrc=channel_layout=stereo:sample_rate=44100".into(),
            ]);
            if let Some(v) = &vfg {
                args.extend(["-filter_complex".into(), v.clone()]);
            }
            args.extend(["-map".into(), vmap.into(), "-map".into(), "1:a".into()]);
        }
    }
    args.extend([
        "-r".into(),
        format!("{fps}"),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:v".into(),
        codec.encoder().into(),
    ]);
    // MF は既定ビットレートが低画質のため目標ビットレートを付与（x264 は無指定で良好）。
    args.extend(codec.quality_args(bitrate));
    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        // 映像・音声とも尺ぴったりに切る。
        "-t".into(),
        format!("{duration_sec}"),
        out.into(),
    ]);
}

/// 1シーン分の動画（PNG静止画＋音声）にする引数（純粋）。
/// 音声があればナレーション（volume適用）を、無ければ無音トラックを付け、全クリップを
/// 「映像＋AAC音声」で統一する（後段 concat の `-c copy` が成立するため）。
/// FFmpeg 引数ビルダの純関数（エンコード入力をそのまま受ける）。引数数はこの用途として許容する。
#[allow(clippy::too_many_arguments)]
pub fn scene_clip_args(
    png: &str,
    audio: Option<&str>,
    narration_volume: f64,
    out: &str,
    duration_sec: f64,
    fps: u32,
    codec: VideoCodec,
    bitrate: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-loop".into(),
        "1".into(),
        "-t".into(),
        format!("{duration_sec}"),
        "-i".into(),
        png.into(),
    ];
    append_scene_av_tail(
        &mut args,
        audio,
        narration_volume,
        duration_sec,
        fps,
        codec,
        bitrate,
        out,
        None, // 静止1枚は -loop で尺を満たす＝映像フィルタ不要（従来どおり 0:v 直結）
    );
    args
}

/// アニメ場面のフレーム列（④・ADR-0019 per-frame）を1動画セグメントに焼く引数（純粋）。
/// `frames_pattern`＝`frame_%05d.png` 等の image2 入力パターン、`fps`＝入力フレームレート。
/// 音声・コーデック・ビットレート・尺クランプは scene_clip_args と同一（append_scene_av_tail 共有）。
/// 1場面=1動画セグメント（音声トラック1本）を維持し、後段 concat の `-c copy` に載る。
#[allow(clippy::too_many_arguments)]
pub fn frames_scene_args(
    frames_pattern: &str,
    audio: Option<&str>,
    narration_volume: f64,
    out: &str,
    duration_sec: f64,
    fps: u32,
    codec: VideoCodec,
    bitrate: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-framerate".into(),
        format!("{fps}"),
        "-start_number".into(),
        "0".into(),
        "-i".into(),
        frames_pattern.into(),
    ];
    // フレーム列はアニメの「変化する区間」だけ（#376）。最終フレームを尺まで複製保持して尺を満たす
    // （stop_duration を尺いっぱいに取り、末尾 -t {duration} でぴったり切る＝アンダーフロー無し）。
    let vf = format!("tpad=stop_mode=clone:stop_duration={duration_sec}");
    append_scene_av_tail(
        &mut args,
        audio,
        narration_volume,
        duration_sec,
        fps,
        codec,
        bitrate,
        out,
        Some(&vf),
    );
    args
}

/// concat demuxer でシーンMP4を無劣化結合する引数（純粋）。list_file と同じ階層の相対名を参照する。
pub fn concat_args(list_file: &str, out: &str) -> Vec<String> {
    vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_file.into(),
        "-c".into(),
        "copy".into(),
        out.into(),
    ]
}

/// 場面間の結合方法（1境界ぶん・ADR-0009 T2）。
/// xfade=Some(FFmpeg の transition 名)のとき重ねて遷移、None のときハードカット（concat）。
pub struct JoinStep<'a> {
    /// FFmpeg xfade の transition 名（"fade"/"slideleft"/"slideright"/"slideup"/"slidedown"）。None=ハードカット。
    pub xfade: Option<&'a str>,
    /// xfade の長さ（秒・xfade のときのみ）。
    pub duration_sec: f64,
    /// 結合結果（左入力）先頭からの xfade 開始位置（秒・xfade のときのみ）。transitionTimeline が算出。
    pub offset_sec: f64,
}

/// 場面MP4群を xfade/concat のフィルタチェーンで1本に再エンコード結合する引数（純粋・ADR-0009 T2）。
/// `steps.len()` は `files.len()-1`（各境界）。映像は xfade/concat、音声は acrossfade/concat を同じ境界規則で連ねる。
/// 全境界 none のときは呼ばない（その場合は concat_args の無劣化コピーを使う）。files は2本以上を前提。
pub fn xfade_chain_args(
    files: &[String],
    steps: &[JoinStep],
    out: &str,
    codec: VideoCodec,
    fps: u32,
    bitrate: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into()];
    for f in files {
        args.push("-i".into());
        args.push(f.clone());
    }
    let mut filters: Vec<String> = Vec::new();
    // 全入力のタイムベースを AVTB(1/1000000) に正規化してからチェーンへ。
    // concat フィルタは出力タイムベースを 1/1000000 に強制する一方、生の場面 MP4 は 1/15360。
    // xfade は2入力のタイムベース一致を要求するため、「concat（ハードカット）の直後に xfade」が
    // 来る境界で「timebase do not match」(-22) になり結合が全体失敗する。
    // settb/asettb は実時刻(PTS)を保ったまま tb ラベルだけ統一するので、どの遷移順序でも一致する。
    for k in 0..files.len() {
        filters.push(format!("[{k}:v]settb=AVTB[nv{k}]"));
        filters.push(format!("[{k}:a]asettb=AVTB[na{k}]"));
    }
    // 映像チェーン：[nv0] を起点に、各境界で xfade（重ね）or concat（ハードカット）。
    let mut v_prev = "nv0".to_string();
    for (i, st) in steps.iter().enumerate() {
        let cur = i + 1;
        let v_out = format!("v{cur}");
        match st.xfade {
            // duration は必ず**入力尺未満**であることが上流で保証される：`transitionTimeline`（TS・単一の参照元）が
            // strict `<` で clamp 済み（`d = min(want, acc−ε, 尺−ε)`・ε=1フレーム＝#547 P3-4／ADR-0009）。
            // ゆえに xfade へ `duration ≥ 入力尺`（未定義動作）は渡らない。Rust 側は場面尺を持たないため（steps は
            // duration/offset のみ）ここで再クランプはしない＝不変条件は算出元の1か所で担保する（多層で式を写経しない）。
            Some(name) => filters.push(format!(
                "[{v_prev}][nv{cur}]xfade=transition={name}:duration={d}:offset={o}[{v_out}]",
                d = st.duration_sec,
                o = st.offset_sec,
            )),
            None => filters.push(format!("[{v_prev}][nv{cur}]concat=n=2:v=1:a=0[{v_out}]")),
        }
        v_prev = v_out;
    }
    // 音声チェーン：xfade の境界は acrossfade（同じ D で重ねる）、none は concat。
    // acrossfade はオフセット引数を取らず「入力1の終端を検出して自動でクロスフェード開始」する。
    // これが映像 xfade の offset=acc−D と整合するのは、各場面 MP4 を scene_clip_args が -t {dur} で
    // 尺ぴったりに揃えているため（音声＝映像と同尺）。
    let mut a_prev = "na0".to_string();
    for (i, st) in steps.iter().enumerate() {
        let cur = i + 1;
        let a_out = format!("a{cur}");
        match st.xfade {
            Some(_) => filters.push(format!(
                "[{a_prev}][na{cur}]acrossfade=d={d}[{a_out}]",
                d = st.duration_sec,
            )),
            None => filters.push(format!("[{a_prev}][na{cur}]concat=n=2:v=0:a=1[{a_out}]")),
        }
        a_prev = a_out;
    }
    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend([
        "-map".into(),
        format!("[{v_prev}]"),
        "-map".into(),
        format!("[{a_prev}]"),
        "-r".into(),
        format!("{fps}"),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:v".into(),
        codec.encoder().into(),
    ]);
    // MF は既定ビットレートが低画質のため目標ビットレートを付与（x264 は無指定で良好）。
    args.extend(codec.quality_args(bitrate));
    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        out.into(),
    ]);
    args
}

/// 場面ごとBGMの1クリップの配置（front の planBgmMix が算出）。ファイル・音量・置き場所(delay)・使う長さ(play)・前後フェード。
pub struct BgmRunPlaced<'a> {
    pub file: &'a str,
    pub volume: f64,
    /// 音量の変化（#512）＝`volume` フィルタの式（`t`＝この音の先頭からの秒）。**式は front の
    /// `volumeExpr`（domain・純粋関数）が点列から組む**＝ここでは差し込むだけ（組み直すと規則が2か所になり、
    /// 再生と書き出しでずれる余地が増える・ADR-0032 追補＝案A）。`None`＝従来どおり `volume` の一定値。
    pub volume_expr: Option<&'a str>,
    pub delay_sec: f64,
    pub play_sec: f64,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
    /// 素材が置き場所より短いとき繰り返すか。**BGM は true**（曲を尺いっぱい鳴らす）。
    /// **読み上げは false**（繰り返すと言葉が二重に鳴る＝タイムライン形式の音声クリップ・#631）。
    pub loop_source: bool,
    /// 素材のどこから使うか（秒・0=頭から）。タイムライン形式のトリム（#631）。
    pub source_start_sec: f64,
    /// 再生速度（>0・1.0=等速）。ピッチは維持（atempo）。タイムライン形式の速度変更（#631）。
    pub speed: f64,
}

/// `atempo` は1段で 0.5〜2.0 しか受け付けないので、範囲外は**掛け算で分ける**（例 4.0＝`atempo=2,atempo=2`）。
/// 値を範囲へ丸めない＝設定した速度どおりに鳴る（ADR-0026①）。等速のときは空（従来の引数と同じ並び）。
fn atempo_chain(speed: f64) -> String {
    // 壊れた値（NaN/∞/0以下）は等速扱い＝`atempo=NaN` のような引数を作らない。
    if !speed.is_finite() || speed <= 0.0 || (speed - 1.0).abs() < 1e-6 {
        return String::new();
    }
    let mut rest = speed;
    let mut stages: Vec<f64> = Vec::new();
    while rest > SPEED_MAX {
        stages.push(SPEED_MAX);
        rest /= SPEED_MAX;
    }
    while rest < SPEED_MIN {
        stages.push(SPEED_MIN);
        rest /= SPEED_MIN;
    }
    stages.push(rest);
    stages
        .iter()
        .map(|v| format!("atempo={v},"))
        .collect::<Vec<_>>()
        .join("")
}

/// 結合済み動画（ナレーション入り）へ、場面ごとBGMの各クリップをループ→切り出し→音量→フェード→adelay して amix する引数（純粋・ADR-0018 ③(7)）。
/// クリップは planBgmMix が配置済み（曲が変わる境界は前後を重ねた delay/play＋フェードで amix ブレンド＝クロスフェード）。
/// 既存音声 [0:a] は保持し normalize=0 で各入力の音量を保つ。duration=first＋-t total で動画長に合わせる。
/// ⚠️ **runs は0本もありうる**（PR #896 レビュー ℹ️）＝**整えるだけ**（`normalize` のみ）のときは
/// BGM が無いまま呼ばれる（`needs_audio_pass = has_bgm || normalize.is_some()`）。
/// 0本なら `amix=inputs=1`（既存音声だけ）を通る＝「1本以上」を前提に手を入れない。
/// 全体の音量を整える設定（#259・ADR-0032 追補4）。
#[derive(Debug, Clone, Copy)]
pub struct NormalizeSpec {
    /// 目安の大きさ（LUFS・負の値）。
    pub target_lufs: f64,
}

pub fn mix_bgm_runs_args(
    video: &str,
    runs: &[BgmRunPlaced],
    total_sec: f64,
    // 全体の音量を整える（#259）。`None` ＝整えない（従来どおり＝出力不変）。
    normalize: Option<NormalizeSpec>,
    out: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), video.into()];
    for r in runs {
        // ループする音（BGM）は尺に満たない曲を繰り返す。読み上げは繰り返さない（言葉が二重に鳴る）。
        if r.loop_source {
            args.push("-stream_loop".into());
            args.push("-1".into());
        }
        args.push("-i".into());
        args.push(r.file.into());
    }
    let mut filters: Vec<String> = Vec::new();
    // amix の入力ラベル：先頭は既存音声、続いて各BGMクリップ。
    let mut labels: Vec<String> = vec!["[0:a]".into()];
    for (i, r) in runs.iter().enumerate() {
        let src = i + 1; // 入力番号（0 は video）
        let label = format!("bg{i}");
        // afade は d=0 を受け付けないため 0 のときは省略。st は asetpts でリセット後の 0 基準。
        let fi = if r.fade_in_sec > 0.0 {
            format!(",afade=t=in:st=0:d={}", r.fade_in_sec)
        } else {
            String::new()
        };
        let fo = if r.fade_out_sec > 0.0 {
            format!(
                ",afade=t=out:st={}:d={}",
                (r.play_sec - r.fade_out_sec).max(0.0),
                r.fade_out_sec
            )
        } else {
            String::new()
        };
        // adelay でグローバル位置へ（0 のときは省略）。
        let delay_ms = (r.delay_sec * 1000.0).round() as i64;
        let d = if delay_ms > 0 {
            format!(",adelay={delay_ms}|{delay_ms}")
        } else {
            String::new()
        };
        // 切り出しは**素材の時間**で見る（速度を掛けたぶん長く読む）。`asetpts` で 0 起点へ戻したあと
        // `atempo` で速度を掛けるので、フェードの位置（`play_sec` 基準）は速度が変わってもずれない。
        let tempo = atempo_chain(r.speed);
        // 音量の変化（#512）。式の `t` は**この音の先頭からの秒**＝`asetpts` で 0 起点に戻し `atempo` を
        // 掛けたあとの時刻なので、フェード（`play_sec` 基準）と同じ物差しになる＝再生の `volumeAt(points, 局所秒)`
        // と同じ点を指す。`eval=frame` を付けないと**最初の1回しか評価されず**一定音量に化ける。
        // 式は `'…'` で囲む＝中の `,` `(` `)` をフィルタの区切りとして読ませない。
        // 空文字は「式が無い」と同じ意味（曲線を持たない）なので一定値へ落とす＝`volume=''` のような引数を作らない。
        let vol_filter = match r.volume_expr.map(str::trim).filter(|e| !e.is_empty()) {
            Some(expr) => format!("volume='{expr}':eval=frame"),
            None => format!("volume={}", r.volume),
        };
        filters.push(format!(
            "[{src}:a]atrim={start}:{end},asetpts=N/SR/TB,{tempo}{vol_filter}{fi}{fo}{d}[{label}]",
            start = r.source_start_sec,
            end = r.source_start_sec + r.play_sec * if r.speed > 0.0 { r.speed } else { 1.0 },
        ));
        labels.push(format!("[{label}]"));
    }
    let n = labels.len();
    // ⚠️ **amix の `normalize=0` は「入力数で割らない」という意味**（#259 の「音量を整える」とは別物）。
    // 割ると音源を足すたびに全体が小さくなるので従来どおり 0 のまま。整えるのは下の `loudnorm`。
    let mixed = if normalize.is_some() {
        "[mixed]"
    } else {
        "[a]"
    };
    filters.push(format!(
        "{}amix=inputs={n}:duration=first:normalize=0{mixed}",
        labels.join("")
    ));
    // 全体の音量を整える（#259）。`loudnorm` で目安の大きさへ寄せ、`alimiter` で歪みを止める。
    // ⚠️ **1回通しで測って整える**（2回通しは全体をもう一度読むので、書き出しが目に見えて遅くなる）。
    // ⚠️ **`alimiter` を必ず後ろに置く**＝整えた結果が 0dBFS を超えると歪む（受け入れ条件「歪みが出ない」）。
    if let Some(nz) = normalize {
        filters.push(format!(
            "[mixed]loudnorm=I={i}:TP=-1.5:LRA=11,alimiter=limit=0.95[a]",
            i = nz.target_lufs
        ));
    }
    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend([
        "-map".into(),
        "0:v".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "copy".into(),
        "-c:a".into(),
        "aac".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        "-t".into(),
        format!("{total_sec}"),
        out.into(),
    ]);
    args
}

/// 動画スロットの収め方（11 §5 / asset.clip.fit）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    Cover,
    Contain,
    Stretch,
}

/// 動画クリップをスロット(w×h)へ収める scale/crop/pad フィルタ（純粋）。
fn fit_filter(fit: Fit, w: u32, h: u32) -> String {
    match fit {
        // 短辺合わせで埋めて余りを切る。
        Fit::Cover => {
            format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1")
        }
        // 全体を収め、余白を中央寄せで黒帯。
        Fit::Contain => format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
        ),
        // アスペクト無視で引き伸ばし。
        Fit::Stretch => format!("scale={w}:{h},setsar=1"),
    }
}

/// 上PNG 1枚ぶんの合成指定（掛け合い×動画では行区間ごとに差し替える）。
pub struct AbovePngArg<'a> {
    pub png: &'a str,
    /// None＝全尺表示（従来の1枚・-loop 入力）。Some((開始秒, 終了秒))＝表示窓 [start,end) で
    /// enable 切替（単一フレーム入力＋eof_action=repeat＝テロップ overlay と同方式）。
    pub window: Option<(f64, f64)>,
}

/// ナレーション1本ぶんの配置指定。delay_sec 秒の位置に adelay 配置（0＝先頭＝従来の単一ナレーション）。
/// window_sec=Some のとき、その行の窓（次の行の開始まで＝表示尺）で atrim 切り詰め＝前の行が次の行に
/// 重なって鳴らない（掛け合い×動画・#385）。None=切り詰めない（単一ナレーション等・従来どおり）。
pub struct NarrationArg<'a> {
    pub wav: &'a str,
    pub delay_sec: f64,
    pub window_sec: Option<f64>,
}

/// 追加の動画レイヤー1本ぶん（#431・複数動画スロット）。先頭動画は VideoSceneArgs の従来フィールド、
/// 2本目以降を extra_videos で zIndex 昇順（先頭動画の上）に重ねる。各レイヤーは自分の slot/fit/クリップ設定を持つ。
pub struct VideoLayerArg<'a> {
    pub clip: &'a str,
    pub slot_x: u32,
    pub slot_y: u32,
    pub slot_w: u32,
    pub slot_h: u32,
    pub fit: Fit,
    pub clip_start_sec: f64,
    pub clip_end_sec: Option<f64>,
    pub use_original_audio: bool,
    pub original_volume: f64,
    pub speed: f64,
}

/// 動画×アニメ（#435・非掛け合い）：静止層（下=below／動画間=mid／最上=above）を per-frame の画像列で描く指定。
/// VideoSceneArgs の below_frames / mid_frames / above_frames で共有し、指定時は対応する静止PNGの代わりに
/// image2 シーケンスを overlay する（below は tpad=stop_mode=clone、mid/above は eof_action=repeat で最終
/// フレームを尺まで保持＝#376/frames_scene_args と同方針）。この経路は**動画スロット本体が動かない**場合用＝動画は
/// 基準位置で固定 overlay。スロット本体がアニメ対象のときは buildExportScenes が窓 Frames＋settled Video の2段に
/// 分割して位置/拡縮/回転/不透明度も一致させる（#442・Rust 側は既存 Frames/Video 経路のまま）。
pub struct AboveFramesArg<'a> {
    /// image2 パターン（例 "<dir>/frame_%05d.png"）。
    pub pattern: &'a str,
    /// フレームレート。
    pub fps: u32,
}

/// 動画シーンの「最上層(above)」入力の種別（#435）。above_frames_dir（動画×アニメ）を最優先し、無ければ
/// 掛け合いの above_segments、無ければ単一 above_png。すべて空はエラー（None）。純粋＝decode 前に検証でき、
/// per-frame(above_frames) と静止 aboves を**相互排他**にして順序バグ（frames 指定なのに aboves 必須で失敗）を防ぐ。
#[derive(Debug, PartialEq, Eq)]
enum AboveSource {
    /// 動画×アニメ：最上層を per-frame（above_frames_dir）で焼く＝静止 aboves は組まない。
    Frames,
    /// 掛け合い：行区間つき上PNG（above_segments）。
    Segments,
    /// 単一 narration：全尺1枚（above_png_base64）。
    SinglePng,
}

fn resolve_above_source(
    has_frames_dir: bool,
    has_segments: bool,
    has_above_png: bool,
) -> Option<AboveSource> {
    if has_frames_dir {
        Some(AboveSource::Frames)
    } else if has_segments {
        Some(AboveSource::Segments)
    } else if has_above_png {
        Some(AboveSource::SinglePng)
    } else {
        None
    }
}

/// 動画ありシーンの合成入力（ADR-0006／#431 で複数動画スロット対応）。
/// 下PNG → 動画レイヤー（zIndex 昇順・各 slot へ fit）→ その間の静止層(mid_pngs) → 上PNG(透過・1枚以上) を
/// zIndex 順に overlay し、音声は narrations(0本以上) ＋ 各動画の元音声(任意) を amix（すべて無ければ無音）。
/// 掛け合い×動画はクリップを連続1本のまま、上PNG（字幕/クレジット）を行区間で切替え、
/// 行ナレーションを開始秒に配置する（プレビューの行進行と一致＝ADR-0001 パリティ）。
/// 先頭動画は従来フィールド（clip/slot_*/fit/clip_*/use_original_audio/original_volume/speed）＝1動画は従来と同一。
pub struct VideoSceneArgs<'a> {
    /// 動画より下のレイヤー（背景等, zIndex<先頭動画, 不透明・全面）。
    pub below_png: &'a str,
    /// 先頭（最下）動画クリップ。
    pub clip: &'a str,
    /// 2本目以降の動画レイヤー（zIndex 昇順・先頭動画の上に重ねる・#431）。空＝1動画（従来）。
    pub extra_videos: &'a [VideoLayerArg<'a>],
    /// 連続する動画レイヤーの間に挟む静止層（透過PNG・枚数＝動画本数−1・#431）。空＝1動画（従来・中間層なし）。
    /// mid_frames が非空のとき（動画×アニメ）は使わない。
    pub mid_pngs: &'a [&'a str],
    /// 動画より上のレイヤー（文字/ゆうこ等, zIndex>slot, 透過PNG）。通常1枚（window=None）、
    /// 掛け合いは行区間ごとに複数枚。空は防御（bg1 を直接出力）＝export_video が事前に弾く。
    /// above_frames=Some のとき（動画×アニメ）は使わない。
    pub aboves: &'a [AbovePngArg<'a>],
    /// 動画×アニメ（#435）：下層を per-frame 画像列で焼く。Some のとき below_png の代わり＝tpad で最終フレーム保持。
    pub below_frames: Option<AboveFramesArg<'a>>,
    /// 動画×アニメ（#435）：中間静止層を per-frame 画像列で焼く（枚数＝動画本数−1）。非空のとき mid_pngs の代わり。
    pub mid_frames: &'a [AboveFramesArg<'a>],
    /// 動画×アニメ（#435）：最上層を per-frame 画像列で焼く。Some のとき aboves の代わりに使う。
    pub above_frames: Option<AboveFramesArg<'a>>,
    /// ナレーション音声（0本以上）。単一場面ナレーションは [{wav, delay_sec:0}]。
    pub narrations: &'a [NarrationArg<'a>],
    /// スロット矩形。
    pub slot_x: u32,
    pub slot_y: u32,
    pub slot_w: u32,
    pub slot_h: u32,
    pub fit: Fit,
    /// クリップの切り出し開始秒（asset.clip.startSec）。
    pub clip_start_sec: f64,
    /// クリップの切り出し終了秒（asset.clip.endSec）。None or 不正値ならシーン尺いっぱい使う。
    pub clip_end_sec: Option<f64>,
    /// シーン尺（秒）。
    pub duration_sec: f64,
    pub narration_volume: f64,
    pub original_volume: f64,
    /// 元動画音声を使うか（asset.clip.useOriginalAudio）。
    /// 音声なしクリップでの true は [1:a] が無効化＝export_video で `clip_has_audio` により事前に弾く
    /// （front も metadata.hasAudio で確認）。
    pub use_original_audio: bool,
    /// 再生速度（0.5〜2.0・1.0=等速）。setpts(映像)/atempo(元音声)に反映。尺は不変（A=尺独立）。
    pub speed: f64,
    pub fps: u32,
    pub codec: VideoCodec,
    /// H.264 目標ビットレート（`-b:v` 値・MF のみ使用）。出力総画素から算出（#121）。
    pub bitrate: &'a str,
    pub out: &'a str,
}

/// 動画ありシーンを1本のMP4にする引数（純粋・ADR-0006）。
/// 入力順: 0=below / 1=clip / 2..=aboves（1枚以上）/ その後 narrations（0本以上）。
pub fn video_scene_args(a: &VideoSceneArgs) -> Vec<String> {
    // 先頭動画（従来フィールド）＋追加動画（extra_videos）を1列に束ね、zIndex 昇順（下→上）に扱う（#431）。
    struct VLayer {
        clip: String,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
        fit: Fit,
        start: f64,
        end: Option<f64>,
        use_orig: bool,
        ovol: f64,
        speed: f64,
    }
    let mut layers: Vec<VLayer> = Vec::with_capacity(1 + a.extra_videos.len());
    layers.push(VLayer {
        clip: a.clip.to_string(),
        x: a.slot_x,
        y: a.slot_y,
        w: a.slot_w,
        h: a.slot_h,
        fit: a.fit,
        start: a.clip_start_sec,
        end: a.clip_end_sec,
        use_orig: a.use_original_audio,
        ovol: a.original_volume,
        speed: a.speed,
    });
    for e in a.extra_videos {
        layers.push(VLayer {
            clip: e.clip.to_string(),
            x: e.slot_x,
            y: e.slot_y,
            w: e.slot_w,
            h: e.slot_h,
            fit: e.fit,
            start: e.clip_start_sec,
            end: e.clip_end_sec,
            use_orig: e.use_original_audio,
            ovol: e.original_volume,
            speed: e.speed,
        });
    }
    let n = layers.len();
    // 中間層の枚数：アニメ時（mid_frames 非空）は image2 の本数、それ以外は静止 mid_pngs の枚数。
    let mid_count = if a.mid_frames.is_empty() {
        a.mid_pngs.len()
    } else {
        a.mid_frames.len()
    };
    let mid_anim = !a.mid_frames.is_empty();
    let dur = a.duration_sec;
    // 映像: 各動画レイヤーをスケール（fit・速度!=1 は setpts＝A尺独立）。入力 index: below=0, clip{k}=1+k。
    let mut vparts: Vec<String> = Vec::new();
    for (k, l) in layers.iter().enumerate() {
        let normal = (l.speed - 1.0).abs() < 1e-6;
        let cv = if normal {
            fit_filter(l.fit, l.w, l.h)
        } else {
            format!("setpts=PTS/{},{}", l.speed, fit_filter(l.fit, l.w, l.h))
        };
        vparts.push(format!("[{}:v]{cv}[clip{k}]", 1 + k));
    }
    // 下層(below)：動画×アニメ（below_frames=Some・#435）は image2 を tpad で最終フレーム保持して base に。それ以外は [0:v]。
    let below_label = if a.below_frames.is_some() {
        vparts.push(format!(
            "[0:v]tpad=stop_mode=clone:stop_duration={dur}[below0]"
        ));
        "below0".to_string()
    } else {
        "0:v".to_string()
    };
    // overlay 順（下→上）: below → clip0@slot0 → mid0 → clip1@slot1 → … → clip{n-1} → aboves。
    // 1 overlay 操作＝(入力ラベル, x, y, 行区間 enable[start,end), eof_action=repeat か)。mid=1+n+m、above=1+n+mid_count(+j)。
    type OverlayOp = (String, u32, u32, Option<(f64, f64)>, bool);
    let mid_base = 1 + n;
    let above_base = 1 + n + mid_count;
    let mut ops: Vec<OverlayOp> = Vec::new();
    for (k, l) in layers.iter().enumerate() {
        ops.push((format!("clip{k}"), l.x, l.y, None, false));
        if k + 1 < n {
            // 動画 k と k+1 の間の静止層（透過）。アニメ時は image2＝eof_action=repeat で最終フレーム保持。
            ops.push((format!("{}:v", mid_base + k), 0, 0, None, mid_anim));
        }
    }
    // 最上層(above)：動画×アニメ（above_frames=Some・#435）は image2 シーケンス1本を最前面に overlay し、
    // eof_action=repeat で最終フレームを尺まで保持（前景アニメ・#376 同方針）。それ以外は静止 aboves（掛け合いは行区間 enable）。
    if a.above_frames.is_some() {
        ops.push((format!("{above_base}:v"), 0, 0, None, true));
    } else {
        for (j, ab) in a.aboves.iter().enumerate() {
            ops.push((format!("{}:v", above_base + j), 0, 0, ab.window, false));
        }
    }
    // 連鎖 emit。prev は below（静止=[0:v] / アニメ=tpad 済み [below0]）起点。最後の overlay を [vout]、途中は [bg{i}]。
    // 行区間つき above は単一フレームを eof_action=repeat で持続させ [start,end) だけ描く（半開区間＝#385/テロップ方式）。
    let mut prev = below_label;
    for (i, (in_l, x, y, win, eof_rep)) in ops.iter().enumerate() {
        let out = if i + 1 == ops.len() {
            "vout".to_string()
        } else {
            format!("bg{}", i + 1)
        };
        let en = match win {
            Some((s, e)) => format!(":eof_action=repeat:enable='gte(t,{s})*lt(t,{e})'"),
            None if *eof_rep => ":eof_action=repeat".to_string(),
            None => String::new(),
        };
        vparts.push(format!("[{prev}][{in_l}]overlay={x}:{y}{en}[{out}]"));
        prev = out;
    }
    let video_filter = vparts.join(";");
    // 音声: narrations（0本以上・delay 配置）＋ 各動画レイヤーの元音声(use_orig)。すべて無ければ無音(anullsrc)。
    let nv = a.narration_volume;
    // ナレーション入力の先頭 index（below=0, clip×n, mid×mid_count, above の直後）。above_frames は image2 を1本占める。
    let above_count = if a.above_frames.is_some() {
        1
    } else {
        a.aboves.len()
    };
    let narr_base = 1 + n + mid_count + above_count;
    // 1本ぶんの前処理: [窓で atrim 切り詰め →] volume → 必要なら adelay（行の開始秒へ配置・全チャンネル）＝#385。
    // atrim 後は asetpts=N/SR/TB で PTS を 0 起点へ戻してから adelay で配置する（mix_bgm と同方針）。
    let narr_chain = |idx: usize, delay_sec: f64, window_sec: Option<f64>| -> String {
        let ms = (delay_sec * 1000.0).round() as i64;
        let trim = match window_sec {
            Some(w) => format!("atrim=0:{w},asetpts=N/SR/TB,"),
            None => String::new(),
        };
        if ms > 0 {
            format!("[{idx}:a]{trim}volume={nv},adelay={ms}:all=1")
        } else {
            format!("[{idx}:a]{trim}volume={nv}")
        }
    };
    // 動画レイヤー k の元音声前処理（volume・速度!=1 は atempo でピッチ維持）。入力 index=1+k。
    let orig_inline = |k: usize, l: &VLayer| -> String {
        if (l.speed - 1.0).abs() < 1e-6 {
            format!("[{}:a]volume={}", 1 + k, l.ovol)
        } else {
            format!("[{}:a]volume={},atempo={}", 1 + k, l.ovol, l.speed)
        }
    };
    let orig_layers: Vec<usize> = layers
        .iter()
        .enumerate()
        .filter(|(_, l)| l.use_orig)
        .map(|(k, _)| k)
        .collect();
    let orig_count = orig_layers.len();
    // apad で尺に満たない音声を無音で埋める（後段 -t {dur} で切る）。anullsrc は無限長ゆえ apad 不要。
    let audio_filter = if a.narrations.is_empty() && orig_count == 0 {
        "anullsrc=channel_layout=stereo:sample_rate=44100[aout]".to_string()
    } else if a.narrations.is_empty() && orig_count == 1 {
        // 単一の元音声のみ（従来のバイト一致）: [k:a]volume=..[,atempo],apad[aout]。
        let k = orig_layers[0];
        format!("{},apad[aout]", orig_inline(k, &layers[k]))
    } else if a.narrations.len() == 1 && orig_count == 0 {
        // 単一ナレーションのみ（従来のバイト一致・delay0/window None なら従来と同一のフィルタ文字列）。
        format!(
            "{},apad[aout]",
            narr_chain(
                narr_base,
                a.narrations[0].delay_sec,
                a.narrations[0].window_sec
            )
        )
    } else {
        // 複数ナレーション（掛け合い） or 元音声併用: narrations→origs の順でラベル化して amix。
        let mut parts: Vec<String> = Vec::new();
        let mut labels = String::new();
        for (k, na) in a.narrations.iter().enumerate() {
            parts.push(format!(
                "{}[n{k}]",
                narr_chain(narr_base + k, na.delay_sec, na.window_sec)
            ));
            labels.push_str(&format!("[n{k}]"));
        }
        for &k in &orig_layers {
            parts.push(format!("{}[orig{k}]", orig_inline(k, &layers[k])));
            labels.push_str(&format!("[orig{k}]"));
        }
        let inputs = a.narrations.len() + orig_count;
        format!(
            "{};{labels}amix=inputs={inputs}:duration=longest:normalize=0,apad[aout]",
            parts.join(";")
        )
    };
    let filter = format!("{video_filter};{audio_filter}");

    // -i 入力: below(loop or image2) → 各動画clip(-ss/-t) → mid(loop or image2) → aboves(loop/単frame/image2) → narrations。
    let mut args: Vec<String> = vec!["-y".into()];
    if let Some(bf) = &a.below_frames {
        // 動画×アニメ（#435）：下層を image2 シーケンスで入力（filter 側 tpad で最終フレーム保持）。
        args.extend([
            "-framerate".into(),
            format!("{}", bf.fps),
            "-start_number".into(),
            "0".into(),
            "-i".into(),
            bf.pattern.into(),
        ]);
    } else {
        args.extend([
            "-loop".into(),
            "1".into(),
            "-t".into(),
            format!("{dur}"),
            "-i".into(),
            a.below_png.into(),
        ]);
    }
    for l in &layers {
        // 使用尺(ソース秒): end があれば (end-start) を dur*speed で頭打ち、無ければ dur*speed（A=尺独立：
        // 速度分だけソースを読み setpts で再生時間が dur に収まる）。尺より短いクリップは overlay 既定の
        // eof_action=repeat で最終フレーム保持（N-1）。
        let clip_t = match l.end {
            Some(end) if end > l.start => (end - l.start).min(dur * l.speed),
            _ => dur * l.speed,
        };
        args.extend([
            "-ss".into(),
            format!("{}", l.start),
            "-t".into(),
            format!("{clip_t}"),
            "-i".into(),
            l.clip.clone(),
        ]);
    }
    if a.mid_frames.is_empty() {
        for mid in a.mid_pngs {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-t".into(),
                format!("{dur}"),
                "-i".into(),
                (*mid).into(),
            ]);
        }
    } else {
        // 動画×アニメ（#435）：中間層を image2 シーケンスで入力（overlay 側 eof_action=repeat で保持）。
        for mf in a.mid_frames {
            args.extend([
                "-framerate".into(),
                format!("{}", mf.fps),
                "-start_number".into(),
                "0".into(),
                "-i".into(),
                mf.pattern.into(),
            ]);
        }
    }
    if let Some(af) = &a.above_frames {
        // 動画×アニメ（#435）：最上層を image2 シーケンスで入力（前景アニメ・overlay 側 eof_action=repeat で保持）。
        args.extend([
            "-framerate".into(),
            format!("{}", af.fps),
            "-start_number".into(),
            "0".into(),
            "-i".into(),
            af.pattern.into(),
        ]);
    } else {
        for ab in a.aboves {
            match ab.window {
                // 全尺の1枚（従来）: 尺ぶんループ。
                None => args.extend([
                    "-loop".into(),
                    "1".into(),
                    "-t".into(),
                    format!("{dur}"),
                    "-i".into(),
                    ab.png.into(),
                ]),
                // 行区間つき: 単一フレームのまま入力（overlay 側の eof_action=repeat で持続）。
                Some(_) => args.extend(["-i".into(), ab.png.into()]),
            }
        }
    }
    for na in a.narrations {
        args.extend(["-i".into(), na.wav.into()]);
    }
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
        "-r".into(),
        format!("{}", a.fps),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:v".into(),
        a.codec.encoder().into(),
    ]);
    // MF は既定ビットレートが低画質のため目標ビットレートを付与。
    args.extend(a.codec.quality_args(a.bitrate));
    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        "-t".into(),
        format!("{dur}"),
        a.out.into(),
    ]);
    args
}

/// ffmpeg バイナリを解決する。
/// - **配布版（release）**：同梱 FFmpeg（`resource_dir/ffmpeg/bin/ffmpeg.exe`）を**最優先**＝pin 済み
///   LGPL+h264_mf 構成を保証する（外部の未 pin FFmpeg を拾わない）。外部 `FFMPEG_PATH` は **`tauri dev`、
///   または明示診断（`FFMPEG_DIAGNOSTIC=1`）時のみ**尊重する。
/// - **開発（`tauri dev`）**：`FFMPEG_PATH` 優先（ffmpeg-static で開発）。
/// - フォールバック：`appData/bin` → `localAppData/bin` → PATH（同梱が無い環境向け）。
pub fn resolve_ffmpeg(app: &tauri::AppHandle) -> PathBuf {
    // FFMPEG_PATH を尊重するのは「dev か、明示診断（FFMPEG_DIAGNOSTIC=1）」のときだけ。配布版は同梱を
    // 最優先＝外部の未 pin FFmpeg で上書きさせない（pin 済み LGPL+h264_mf 構成を保証）。
    // ※ cfg!(dev) は tauri-build が出力する cfg（`cargo:rustc-cfg=dev` ＋ `cargo:rustc-check-cfg=cfg(dev)`
    //   を登録）で、`tauri dev` セッションのみ true・`tauri build` では false。debug/release プロファイルでは
    //   なくビルド種別で判定するため、debug packaged build でも配布版扱い（同梱優先）になる。
    let dev = cfg!(dev);
    let diagnostic = std::env::var("FFMPEG_DIAGNOSTIC")
        .map(|v| v == "1")
        .unwrap_or(false);
    if dev || diagnostic {
        if let Ok(p) = std::env::var("FFMPEG_PATH") {
            if !p.is_empty() {
                // 配布版で診断フラグにより外部 FFmpeg を使う場合は、pin 構成外（LGPL+h264_mf 保証外）を警告。
                if !dev {
                    crate::tlog!("ffmpeg","診断モード: 外部 FFMPEG_PATH を使用します（同梱 pin 構成外＝LGPL+h264_mf は保証されません）: {p}"
                    );
                }
                return PathBuf::from(p);
            }
        }
    }
    // 同梱 FFmpeg（配布版の本命）。
    if let Ok(res) = app.path().resource_dir() {
        let exe = res.join("ffmpeg").join("bin").join("ffmpeg.exe");
        if exe.exists() {
            return exe;
        }
    }
    // フォールバック：appData/bin → localAppData/bin → PATH（Windows の Roaming/Local 差にも対応）。
    for base in [app.path().app_data_dir(), app.path().app_local_data_dir()]
        .into_iter()
        .flatten()
    {
        let exe = base.join("bin").join("ffmpeg.exe");
        if exe.exists() {
            return exe;
        }
    }
    PathBuf::from("ffmpeg")
}

/// ffmpeg を実行。成功時 stdout、失敗時 stderr を返す。
pub fn run(bin: &Path, args: &[String]) -> Result<String, String> {
    let out = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

// ── 書き出しのキャンセル／アプリ終了時 kill（#380）。 ──
// 走行中の ffmpeg 子プロセスを別スレッド（キャンセルコマンド・アプリ終了ハンドラ）から終了できるよう、
// 現在の Child を単一スロットに保持する。EXPORT_IN_FLIGHT で書き出しは同時1本に限られ、書き出し内の
// run_export 呼び出しも逐次のため、この単一スロットで取りこぼしなく追跡できる（probe/サムネ等の run は非対象）。
static EXPORT_CHILD: Mutex<Option<Child>> = Mutex::new(None);
// キャンセル要求フラグ。spawn〜スロット登録の隙間に来た要求や、次の run_export 開始も取りこぼさないための保険。
static EXPORT_CANCELLED: AtomicBool = AtomicBool::new(false);
// キャンセル時に run_export が返す内部マーカー（呼び出し側の map_err で握られ、ユーザーには出ない・ログ識別用）。
const EXPORT_CANCELLED_MARK: &str = "export cancelled by user";

/// EXPORT_CHILD のロック取得（毒された場合も内部値を取り出して継続＝終了処理を止めない）。
fn lock_export_child() -> std::sync::MutexGuard<'static, Option<Child>> {
    EXPORT_CHILD.lock().unwrap_or_else(|e| e.into_inner())
}

/// 走行中の書き出し ffmpeg を終了する（ユーザーのキャンセル／アプリ終了の双方から呼ぶ・#380）。
/// フラグを立ててから Child を kill＋reap する。まだ spawn 前ならフラグだけ残し、run_export 側が拾う。
pub fn cancel_running_export() {
    EXPORT_CANCELLED.store(true, Ordering::SeqCst);
    if let Some(mut child) = lock_export_child().take() {
        let _ = child.kill();
        let _ = child.wait(); // reap（ゾンビ化防止）
    }
}

/// 書き出し開始時にキャンセル状態を初期化する（前回のキャンセル要求・残 Child を持ち越さない）。
/// 1回の書き出し（準備＝stage_clip_frames と 本体＝export_video）が始まる**前**に呼び、以降を1つの
/// キャンセル対象スコープにする（フロントが busy 表示前に begin_export で呼ぶ・二重書き出しは UI/EXPORT_IN_FLIGHT で排他）。
fn reset_export_cancel() {
    EXPORT_CANCELLED.store(false, Ordering::SeqCst);
    if let Some(mut child) = lock_export_child().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// 書き出し開始をフロントが宣言するコマンド（#380）。この時点から準備（クリップ抽出）も本体も同一の
/// キャンセルスコープに入る＝前回の中止要求を持ち越さず、以降の run_export をまとめて中止できる。
#[tauri::command]
pub fn begin_export() {
    reset_export_cancel();
}

/// ユーザー操作の「中止」から呼ぶコマンド（#380）。走行中の書き出し ffmpeg を終了する。
/// 「中止しました」の表示は呼び出し側（フロント）が把握しているため、ここは副作用のみ（戻り値なし）。
#[tauri::command]
pub fn cancel_export() {
    cancel_running_export();
}

/// 書き出し専用の ffmpeg 実行（#380）。`run` と同じく成功時 stdout・失敗時 stderr を返すが、
/// 走行中 Child を EXPORT_CHILD に登録し、キャンセル／アプリ終了から kill できるようにする。
/// stdout/stderr は別スレッドで排出する（ffmpeg は stderr 出力が多く、未排出だとパイプ詰まりで停止し得る）。
fn run_export(bin: &Path, args: &[String]) -> Result<String, String> {
    // 既にキャンセル要求済みなら新規 spawn せず即中止（前段の場面で中止された連鎖を止める）。
    if EXPORT_CANCELLED.load(Ordering::SeqCst) {
        return Err(EXPORT_CANCELLED_MARK.to_string());
    }
    let mut child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // 出力は別スレッドで排出（パイプ詰まり回避）。ハンドルは take し、Child は kill 可能なまま保持する。
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_h = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    let err_h = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    *lock_export_child() = Some(child);

    // try_wait をポーリングして完了を待つ。キャンセルされたらスロットが空になり（or フラグで自 kill）抜ける。
    let status = loop {
        if EXPORT_CANCELLED.load(Ordering::SeqCst) {
            if let Some(mut child) = lock_export_child().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            break None;
        }
        let mut slot = lock_export_child();
        match slot.as_mut() {
            None => break None, // キャンセルコマンドが take + kill 済み
            Some(child) => match child.try_wait() {
                Ok(Some(st)) => {
                    *slot = None;
                    break Some(st);
                }
                Ok(None) => {
                    drop(slot);
                    std::thread::sleep(std::time::Duration::from_millis(40));
                }
                Err(_) => {
                    *slot = None;
                    break None;
                }
            },
        }
    };

    let stdout = out_h.join().unwrap_or_default();
    let stderr = err_h.join().unwrap_or_default();
    match status {
        Some(st) if st.success() => Ok(stdout),
        Some(_) => Err(stderr),
        None => Err(EXPORT_CANCELLED_MARK.to_string()),
    }
}

/// `run` の生バイト版（#332）。stdout を**文字列にせず**そのまま返す。
///
/// ⚠️ **PCM は文字列にできない**＝`run` は `from_utf8_lossy` を通すので、音の波形（s16le）を
/// 通すと**不正なバイトが `U+FFFD` に化けて値が壊れる**。波形専用にここを分ける。
fn run_bytes(bin: &Path, args: &[String]) -> Result<Vec<u8>, String> {
    let out = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// 素材の**中身が変わったか**を安く見分ける印（#332）。大きさと更新時刻から作る。
///
/// ⚠️ **これが無いとキャッシュが化ける**＝保存名は `assets/<assetId>.<ext>` で、`asset_NNN` は
/// **空き番号を埋める**採番（`createAssetId`）。さらに #347 の「ファイルを選び直す」は
/// **同じ名前のまま中身を入れ替える**。どちらも「名前は同じで中身が別」を作るので、
/// 名前だけでキャッシュを引くと**前の動画のコマ列**が出る。
fn file_stamp(path: &Path) -> String {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return "0_0".to_string(),
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}_{}", meta.len(), mtime)
}

/// 波形の山（#332）。0.0〜1.0 を `buckets` 個返す（音が無い・読めないときは空）。
///
/// ⚠️ **素材のバイトを JS に載せない**（ADR-0004・§2-1）＝ここで PCM を受けて**山だけ**を返す。
/// 5分の曲でも Rust 側で数MBを流すだけで、JS へ渡るのは数百個の数値で済む。
/// 4000Hz・モノラルまで落とす＝波形の見た目には十分で、読み取り量が桁で減る。
/// ⚠️ **メインスレッドを塞がない**（#375 と同じ形）＝同期の `#[tauri::command]` は
/// **UI/IPC のイベントループ上**で走るので、ここで ffmpeg のフル復号を回すと**ウィンドウが応答なし**に
/// なる。書き出しは**1フレーム＝1 invoke** をフロントが回しているので、塞ぐと**中止も閉じるも効かない**。
/// 呼び出し側の同時実行の絞り（`ANALYSIS_CONCURRENCY`）は、別スレッドへ逃がして初めて意味を持つ。
#[tauri::command]
pub async fn audio_peaks(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    buckets: usize,
    from_sec: f64,
    length_sec: f64,
) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        audio_peaks_impl(app, project_id, rel_path, buckets, from_sec, length_sec)
    })
    .await
    .map_err(|e| format!("audio peaks task join: {e}"))?
}

fn audio_peaks_impl(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    buckets: usize,
    from_sec: f64,
    length_sec: f64,
) -> Result<Vec<f32>, String> {
    // 山の数は画面の都合で決まる。極端な値でメモリを食わないよう範囲に収める。
    let buckets = buckets.clamp(1, 2000);
    let input = resolve_project_file(&app, &project_id, &rel_path)?;
    if !input.is_file() {
        // 見つからないのは #347 が知らせる話＝ここは**空で返す**（波形が出ないだけ）。
        return Ok(Vec::new());
    }
    let ffmpeg = resolve_ffmpeg(&app);
    // ⚠️ **置いた範囲だけを測る**＝素材まるごとを測って帯へ伸ばすと、末尾だけを置いた帯に
    // 頭からの波形が出る。`-ss` は `-i` の前（速い＝そこまで復号しない）、長さは `-t` で切る。
    let mut args: Vec<String> = vec!["-v".into(), "error".into()];
    if from_sec > 0.0 && from_sec.is_finite() {
        args.push("-ss".into());
        args.push(format!("{from_sec}"));
    }
    args.push("-i".into());
    args.push(input.to_string_lossy().into_owned());
    if length_sec > 0.0 && length_sec.is_finite() {
        args.push("-t".into());
        args.push(format!("{length_sec}"));
    }
    args.extend([
        "-f".to_string(),
        "s16le".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "4000".to_string(),
        "-".to_string(),
    ]);
    // ⚠️ **失敗しても空で返す**＝波形は「あると見やすい」もので、無くても編集はできる。
    // 音の入っていない動画・壊れたファイルで**画面を止めない**（§2-5＝求めることが無い）。
    let pcm = match run_bytes(&ffmpeg, &args) {
        Ok(b) => b,
        Err(_) => return Ok(Vec::new()),
    };
    let samples = pcm.len() / 2;
    if samples == 0 {
        return Ok(Vec::new());
    }
    let mut out = vec![0.0f32; buckets];
    for (i, slot) in out.iter_mut().enumerate() {
        let from = samples * i / buckets;
        let to = (samples * (i + 1) / buckets).max(from + 1).min(samples);
        let mut peak: i32 = 0;
        for s in from..to {
            let v = i16::from_le_bytes([pcm[s * 2], pcm[s * 2 + 1]]) as i32;
            peak = peak.max(v.abs());
        }
        *slot = (peak as f32 / 32768.0).min(1.0);
    }
    Ok(out)
}

/// 動画のコマ列（#332）。`frames` コマを**横に並べた PNG 1枚**を作り、相対パスを返す。
///
/// ⚠️ **1枚にまとめる**＝コマごとに別ファイルにすると、帯1本を描くのに N 回の読み込みが要る。
/// 1枚なら `background-image` で置いて `background-size` で割るだけで済む。
/// 置き場は `cache/`＝**素材ではない**（#348 の片づけ・#347 の欠損検知が実体と勘違いしない）。
/// ⚠️ **メインスレッドを塞がない**（`audio_peaks` と同じ理由・#375）。
#[tauri::command]
pub async fn video_filmstrip(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    frames: usize,
    from_sec: f64,
    length_sec: f64,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        video_filmstrip_impl(app, project_id, rel_path, frames, from_sec, length_sec)
    })
    .await
    .map_err(|e| format!("filmstrip task join: {e}"))?
}

fn video_filmstrip_impl(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    frames: usize,
    from_sec: f64,
    length_sec: f64,
) -> Result<String, String> {
    let frames = frames.clamp(1, 60);
    let input = resolve_project_file(&app, &project_id, &rel_path)?;
    if !input.is_file() {
        return Ok(String::new());
    }
    let ffmpeg = resolve_ffmpeg(&app);
    // 尺が要る（何秒ごとに1コマ取るかを決めるため）。取れなければコマ列は作らない。
    // ⚠️ **置いた範囲だけを測る**（波形と同じ理由）。範囲が渡っていれば尺を調べ直さない
    //（probe の1プロセスぶん減る）。
    let span = if length_sec > 0.0 && length_sec.is_finite() {
        length_sec
    } else {
        ffmpeg_probe_stderr(&ffmpeg, &input)
            .ok()
            .and_then(|s| parse_video_meta(&s).duration_sec)
            .unwrap_or(0.0)
    };
    if span <= 0.0 || !span.is_finite() {
        return Ok(String::new());
    }
    let stem = Path::new(&rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "asset".to_string());
    let rel_out = format!(
        "cache/{}_{}_{}_{:.3}_{:.3}strip.png",
        stem,
        file_stamp(&input),
        frames,
        from_sec,
        span
    );
    let out = resolve_project_file(&app, &project_id, &rel_out)?;
    // 既にあるなら作り直さない（同じ中身・同じコマ数なら結果は同じ）。
    if out.is_file() {
        return Ok(rel_out);
    }
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into()];
    if from_sec > 0.0 && from_sec.is_finite() {
        args.push("-ss".into());
        args.push(format!("{from_sec}"));
    }
    args.push("-i".into());
    args.push(input.to_string_lossy().into_owned());
    args.push("-t".into());
    args.push(format!("{span}"));
    args.push("-vf".into());
    args.push(format!(
        "fps={}/{},scale=-1:48,tile={}x1",
        frames, span, frames
    ));
    args.extend(["-frames:v".to_string(), "1".to_string()]);
    args.push(out.to_string_lossy().into_owned());
    // ⚠️ **失敗しても空で返す**（波形と同じ）＝コマ列は無くても編集はできる。
    match run(&ffmpeg, &args) {
        Ok(_) => Ok(rel_out),
        Err(_) => Ok(String::new()),
    }
}

/// `ffmpeg -i <file>` を実行し stderr を返す（出力未指定で終了コード1だが stderr にメタ情報が出る）。
/// 音声有無・メタ取得（probe 系）の共通土台。成否に関わらず stderr を見る。
fn ffmpeg_probe_stderr(ffmpeg: &Path, file: &Path) -> Result<String, String> {
    match Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-i")
        .arg(file)
        .output()
    {
        Ok(o) => Ok(String::from_utf8_lossy(&o.stderr).into_owned()),
        // プロセス起動失敗（I/O・権限等）は報告する。
        Err(e) => Err(export_failure(
            format!("ffmpeg probe failed: {e}"),
            "動画の確認に失敗しました。もう一度お試しください。",
        )),
    }
}

/// クリップに音声トラックがあるか（`ffmpeg -i` の stderr に "Audio:" が出るか）。
fn clip_has_audio(ffmpeg: &Path, clip: &Path) -> Result<bool, String> {
    Ok(ffmpeg_probe_stderr(ffmpeg, clip)?.contains("Audio:"))
}

/// 技術詳細を**このパソコンの記録へ**残し、ユーザーには行動を示す固定文言を返す（§2-3/§2-5）。
///
/// ⚠️ **`eprintln!` だけにしない**（#396）＝配布版はコンソールを持たないので、**stderr はどこにも残らない**。
/// 「失敗しました」と言われても調べる材料が無かった。`tlog!` は stderr にも出しつつ
/// `appData/logs` にも残す（外へは送らない＝§2-6）。
fn export_failure(detail: impl std::fmt::Display, user_message: impl Into<String>) -> String {
    crate::trouble_log::record("export", &format!("{}", detail));
    user_message.into()
}

/// 動画メタ情報（probe 結果）。フロントの AssetMetadata（width/height/durationSec/hasAudio）に対応。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    duration_sec: Option<f64>,
    has_audio: bool,
    width: Option<u32>,
    height: Option<u32>,
}

/// `ffmpeg -i` の stderr から尺・音声有無・解像度を解析する（純粋・テスト可能）。
fn parse_video_meta(stderr: &str) -> VideoMeta {
    let (width, height) = parse_resolution(stderr);
    VideoMeta {
        duration_sec: parse_duration_sec(stderr),
        has_audio: stderr.contains("Audio:"),
        width,
        height,
    }
}

/// "Duration: HH:MM:SS.ss" を秒へ変換（"N/A"・解析不能は None）。
fn parse_duration_sec(stderr: &str) -> Option<f64> {
    let idx = stderr.find("Duration:")?;
    let dur = stderr[idx + "Duration:".len()..]
        .trim_start()
        .split(',')
        .next()?
        .trim();
    if dur.starts_with("N/A") {
        return None;
    }
    let mut parts = dur.split(':');
    let h: f64 = parts.next()?.trim().parse().ok()?;
    let m: f64 = parts.next()?.trim().parse().ok()?;
    let s: f64 = parts.next()?.trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Video ストリーム行から解像度 "幅x高さ" を抽出する。
/// コーデックタグ(0x..)やストリーム番号([0x1])を拾わないよう、幅・高さとも 16 以上のみ採用。
fn parse_resolution(stderr: &str) -> (Option<u32>, Option<u32>) {
    let Some(line) = stderr.lines().find(|l| l.contains("Video:")) else {
        return (None, None);
    };
    let b = line.as_bytes();
    for i in 1..b.len().saturating_sub(1) {
        if b[i] != b'x' || !b[i - 1].is_ascii_digit() || !b[i + 1].is_ascii_digit() {
            continue;
        }
        let mut l = i;
        while l > 0 && b[l - 1].is_ascii_digit() {
            l -= 1;
        }
        let mut r = i + 1;
        while r < b.len() && b[r].is_ascii_digit() {
            r += 1;
        }
        if let (Ok(w), Ok(h)) = (line[l..i].parse::<u32>(), line[i + 1..r].parse::<u32>()) {
            if w >= 16 && h >= 16 {
                return (Some(w), Some(h));
            }
        }
    }
    (None, None)
}

/// 動画素材のメタ情報（長さ・音声有無・解像度）を `ffmpeg -i` で取得する。
/// 注: Err はフロント（assetFs.probeVideo）で catch → null される best-effort 取得＝
/// ここで返すユーザー向け文言は画面に出ない（取得できなくても素材は保持される）。技術詳細は eprintln に残る。
#[tauri::command]
pub fn probe_video(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<VideoMeta, String> {
    let file = resolve_project_file(&app, &project_id, &rel_path)?;
    if !file.exists() {
        return Err(export_failure(
            format!("probe target missing: {}", file.display()),
            "動画が見つかりませんでした。もう一度取り込んでください。",
        ));
    }
    let ffmpeg = resolve_ffmpeg(&app);
    let stderr = ffmpeg_probe_stderr(&ffmpeg, &file)?;
    Ok(parse_video_meta(&stderr))
}

/// クリップの相対パスからサムネ(ポスターPNG)の相対パスを作る（純粋）。
/// 例: "assets/asset_005.mp4" → "assets/asset_005_thumb.png"。
fn thumbnail_rel_path(rel_path: &str) -> String {
    let p = Path::new(rel_path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    match p
        .parent()
        .and_then(|d| d.to_str())
        .filter(|d| !d.is_empty())
    {
        Some(dir) => format!("{dir}/{stem}_thumb.png"),
        None => format!("{stem}_thumb.png"),
    }
}

/// 動画の代表フレーム（先頭フレーム）を PNG で書き出し、その相対パスを返す（確認画面/一覧サムネ用）。
/// 注: Err はフロント（assetFs.extractVideoThumbnail）で catch → null される best-effort 取得＝
/// ここで返すユーザー向け文言は画面に出ない（サムネが無くてもアイコン表示にフォールバックする）。
#[tauri::command]
pub fn extract_video_thumbnail(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    let input = resolve_project_file(&app, &project_id, &rel_path)?;
    if !input.exists() {
        return Err(export_failure(
            format!("thumbnail src missing: {}", input.display()),
            "動画が見つかりませんでした。もう一度取り込んでください。",
        ));
    }
    let rel_out = thumbnail_rel_path(&rel_path);
    let out = resolve_project_file(&app, &project_id, &rel_out)?;
    // 出力先(assets/)は import_asset で作成済みだが、念のため保証する。
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| {
            export_failure(
                format!("thumbnail dir: {e}"),
                "動画のサムネイル作成に失敗しました。",
            )
        })?;
    }
    let ffmpeg = resolve_ffmpeg(&app);
    // 先頭フレームを 1枚、横640pxへ縮小して PNG 出力（プレビュー用ポスター）。
    let args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        "0".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=640:-2".into(),
        out.to_string_lossy().into_owned(),
    ];
    run(&ffmpeg, &args).map_err(|e| {
        export_failure(
            format!("thumbnail extract: {e}"),
            "動画のサムネイル作成に失敗しました。",
        )
    })?;
    Ok(rel_out)
}

/// 動画の**その瞬間**を静止画（PNG）として切り出し、素材フォルダへ保存して相対パスを返す（#349）。
///
/// ⚠️ **サムネ（`extract_video_thumbnail`）とは別物**＝あちらは一覧用に横 640px へ縮める
/// 「見せるための絵」。こちらは**素材として使う絵**なので**原寸のまま**出す（縮めると、
/// 切り出した写真だけ解像度が落ちて動画に入る＝黙って劣化させない）。
/// ⚠️ **ファイル名は呼ぶ側が決める**（`asset_NNN` の採番はドメイン側の責務・§4）。
#[tauri::command]
pub async fn extract_video_frame(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    at_sec: f64,
    out_file_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_video_frame_impl(app, project_id, rel_path, at_sec, out_file_name)
    })
    .await
    .map_err(|e| {
        export_failure(
            format!("frame extract join: {e}"),
            "静止画の切り出しに失敗しました。もう一度お試しください。",
        )
    })?
}

fn extract_video_frame_impl(
    app: tauri::AppHandle,
    project_id: String,
    rel_path: String,
    at_sec: f64,
    out_file_name: String,
) -> Result<String, String> {
    if !is_safe_frame_file_name(&out_file_name) {
        return Err(export_failure(
            format!("frame extract bad name: {out_file_name}"),
            "静止画の切り出しに失敗しました。もう一度お試しください。",
        ));
    }
    let input = resolve_project_file(&app, &project_id, &rel_path)?;
    if !input.exists() {
        return Err(export_failure(
            format!("frame src missing: {}", input.display()),
            "動画が見つかりませんでした。素材の一覧から取り込み直してください。",
        ));
    }
    let rel_out = format!("assets/{out_file_name}");
    let out = resolve_project_file(&app, &project_id, &rel_out)?;
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| {
            export_failure(
                format!("frame dir: {e}"),
                "静止画の保存先を用意できませんでした。もう一度お試しください。",
            )
        })?;
    }
    let ffmpeg = resolve_ffmpeg(&app);
    let seek = frame_seek_args(at_sec);
    let mut args: Vec<String> = vec!["-y".into()];
    if let Some(coarse) = seek.coarse_sec {
        args.push("-ss".into());
        args.push(format!("{coarse}"));
    }
    args.push("-i".into());
    args.push(input.to_string_lossy().into_owned());
    if seek.fine_sec > 0.0 {
        args.push("-ss".into());
        args.push(format!("{}", seek.fine_sec));
    }
    args.extend([
        "-frames:v".into(),
        "1".into(),
        out.to_string_lossy().into_owned(),
    ]);
    run(&ffmpeg, &args).map_err(|e| {
        export_failure(
            format!("frame extract: {e}"),
            "静止画を切り出せませんでした。時間を少し動かしてもう一度お試しください。",
        )
    })?;
    // ⚠️ **出来ていないのに成功にしない**＝尺の外を指すと FFmpeg は 0 個の絵で正常終了する。
    if !out.exists() {
        return Err(export_failure(
            format!("frame extract produced nothing at {at_sec}"),
            "その時間には映像がありませんでした。時間を少し戻してもう一度お試しください。",
        ));
    }
    Ok(rel_out)
}

/// 頭出しの引数（#349・PR #885 レビュー 🔴）。粗い頭出しと、そこからの端数に分ける。
struct FrameSeek {
    /// `-i` の**前**に置く秒（`None` ＝前置きしない＝先頭から読む）。
    coarse_sec: Option<f64>,
    /// `-i` の**後**に置く秒（0 ＝置かない）。
    fine_sec: f64,
}

/// 切り出した絵のファイル名として受けてよいか（#349・PR #885 レビュー 🟡）。
///
/// ⚠️ **規則は写さず共有する**（α-6 出口監査 ℹ️）＝ここは `is_safe_single_file_name` の**3つ目の写し**で、
/// **コロンの検査だけ落ちていた**（Windows の `C:evil.txt` はドライブ相対＝`is_absolute()` を通る）。
/// いまは下流の `is_safe_rel_path` が弾くので実害は無かったが、**順序が変われば穴になる**。
fn is_safe_frame_file_name(name: &str) -> bool {
    crate::assets::is_safe_single_file_name(name)
}

/// 切り出しの頭出しを「粗い＋端数」に分ける（#349・PR #885 レビュー 🔴）。
///
/// ⚠️ **`-ss` を `-i` の前だけに置くと、狙った瞬間の絵が出ない**＝前置きは
/// **指定秒より前のキーフレーム**まで飛んでそこから1枚を返すので、キーフレームの間隔が広い動画
///（スマホ撮影・画面収録）では**数秒ずれる**。しかもコマンドは正常終了しファイルもできるので、
/// 「0枚で正常終了」の検査では捕まらない＝**見た画と違う絵を成功として返してしまう**。
///
/// ⚠️ **`-i` の後ろだけに置くと遅い**（先頭から全部デコードする）。長い動画で待たされる。
///
/// そこで**手前まで粗く飛び、残りを正確に進む**（二段シーク＝定石）。
/// 手前に取る余白（`SEEK_BACKOFF_SEC`）は、よくあるキーフレーム間隔（2〜5秒）を跨げる長さにする。
fn frame_seek_args(at_sec: f64) -> FrameSeek {
    // ⚠️ **負の時刻は 0 に寄せる**（FFmpeg が引数として受け付けない）。
    let t = at_sec.max(0.0);
    const SEEK_BACKOFF_SEC: f64 = 10.0;
    if t <= SEEK_BACKOFF_SEC {
        // 近い時刻は前置きせず、そのまま正確に進む（10 秒ぶんのデコードは待たされない）。
        return FrameSeek {
            coarse_sec: None,
            fine_sec: t,
        };
    }
    let coarse = t - SEEK_BACKOFF_SEC;
    FrameSeek {
        coarse_sec: Some(coarse),
        fine_sec: t - coarse,
    }
}

struct SceneFile {
    png: PathBuf,
    audio: Option<PathBuf>,
    narration_volume: f64,
    duration_sec: f64,
}

/// 上PNG 1枚の解決済みジョブ入力。window は表示窓（None=全尺・掛け合いは行区間 [start,end)）。
struct TimedAbove {
    png: PathBuf,
    window: Option<(f64, f64)>,
}

/// ナレーション1本の解決済みジョブ入力。delay_sec 秒に配置（0=先頭＝従来）。
/// window_sec=Some のとき行の窓で atrim 切り詰め（掛け合い×動画・#385）。None=切り詰めない。
struct TimedNarration {
    wav: PathBuf,
    delay_sec: f64,
    window_sec: Option<f64>,
}

/// 動画ありシーンの解決済みジョブ（ADR-0006）。下/上PNGは tmp に書き出し済み、clip は絶対パス解決済み。
/// 掛け合い×動画は aboves（行区間つき上PNG）＋ narrations（行ごと delay 配置）で行進行を焼く。
struct VideoJob {
    below: PathBuf,
    aboves: Vec<TimedAbove>,
    clip: PathBuf,
    narrations: Vec<TimedNarration>,
    slot: (u32, u32, u32, u32),
    fit: Fit,
    clip_start_sec: f64,
    clip_end_sec: Option<f64>,
    duration_sec: f64,
    narration_volume: f64,
    original_volume: f64,
    use_original_audio: bool,
    speed: f64,
    /// 2本目以降の動画レイヤー（zIndex 昇順・#431）。空＝1動画。
    extra_videos: Vec<VideoLayerJob>,
    /// 動画レイヤー間の静止層PNG（透過・枚数＝動画本数−1・#431）。空＝1動画。
    mid_pngs: Vec<PathBuf>,
    /// 動画×アニメ（#435）：下層を per-frame で焼くときの (フレームdir, fps)。None＝静止 below_png。
    below_frames: Option<(PathBuf, u32)>,
    /// 動画×アニメ（#435）：中間層を per-frame で焼くときの [(フレームdir, fps)]（枚数＝動画本数−1）。空＝静止 mid_pngs。
    mid_frames: Vec<(PathBuf, u32)>,
    /// 動画×アニメ（#435・非掛け合い）：最上層を per-frame で焼くときの (フレームdir, fps)。None＝静止 aboves。
    above_frames: Option<(PathBuf, u32)>,
}

/// 追加動画レイヤー1本の解決済みジョブ（#431）。clip は絶対パス、slot/クリップ設定を持つ。
struct VideoLayerJob {
    clip: PathBuf,
    slot: (u32, u32, u32, u32),
    fit: Fit,
    clip_start_sec: f64,
    clip_end_sec: Option<f64>,
    use_original_audio: bool,
    original_volume: f64,
    speed: f64,
}

/// アニメ場面のフレーム列ジョブ（④・ADR-0019 per-frame）。frames_dir に frame_00000.png... を書き出し済み。
struct FramesJob {
    frames_dir: PathBuf,
    /// ビットレート算出の解像度取得用（先頭フレーム）。
    first_frame: PathBuf,
    audio: Option<PathBuf>,
    narration_volume: f64,
    duration_sec: f64,
    fps: u32,
}

/// 1シーン分のジョブ。静止画 or 動画 or アニメ（フレーム列）。
enum SceneJob {
    Still(SceneFile),
    // VideoJob は複数動画/中間層/per-frame（#431/#435）でフィールドが多く大きいため Box で間接化（enum サイズ均一化・clippy）。
    Video(Box<VideoJob>),
    Frames(FramesJob),
}

impl SceneJob {
    fn duration_sec(&self) -> f64 {
        match self {
            SceneJob::Still(s) => s.duration_sec,
            SceneJob::Video(v) => v.duration_sec,
            SceneJob::Frames(f) => f.duration_sec,
        }
    }
}

/// 検証済みの境界結合（export_video が SceneInput.transition から組み立てる・ADR-0009 T2）。
struct JoinInfo {
    /// 検証済み xfade 名（None=ハードカット）。
    xfade: Option<String>,
    duration_sec: f64,
    offset_sec: f64,
    /// 論理的な「場面」の先頭セグメントか（#430）。scene_ranges が場面境界の判定に使う。
    scene_start: bool,
}

/// セグメント単位の joins（scene_start）から、論理的な場面ごとのセグメント範囲 [start, end) を返す（#430・ADR-0026）。
/// 掛け合いは1場面が複数セグメント（間/行）に展開されるため、これで「同一場面の連結」と「場面クリップ単位の xfade」
/// を分ける。先頭セグメントは常に場面の開始とみなす（joins[0].scene_start に依らない＝防御）。純粋関数。
fn scene_ranges(joins: &[JoinInfo]) -> Vec<(usize, usize)> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut start = 0usize;
    for (i, j) in joins.iter().enumerate().skip(1) {
        if j.scene_start {
            ranges.push((start, i));
            start = i;
        }
    }
    if !joins.is_empty() {
        ranges.push((start, joins.len()));
    }
    ranges
}

/// FFmpeg xfade が受け付ける transition 名の許可リスト（MVP）。これ以外/"none" はハードカット扱い。
const XFADE_NAMES: [&str; 5] = ["fade", "slideleft", "slideright", "slideup", "slidedown"];
fn validate_xfade_name(name: &str) -> Option<String> {
    XFADE_NAMES.contains(&name).then(|| name.to_string())
}

/// 書き出しの進捗イベント（#376）：フロントの ExportScreen が受けて encoding 段のバーを実進捗（80→100%）で描く。
/// phase＝"encode"（場面ごとエンコード・step/total 有効）/"join"（結合）/"bgm"（BGM合成）。
/// 出力（ffmpeg 引数）には一切影響しない＝パリティ不変（ADR-0001）。
#[derive(Clone, serde::Serialize)]
struct ExportProgressEvent {
    phase: String,
    step: usize,
    total: usize,
}

/// 進捗イベントを emit（送れなくても書き出しは続行＝best-effort・#376）。app が None（テスト等）は何もしない。
fn emit_export_progress(app: Option<&tauri::AppHandle>, phase: &str, step: usize, total: usize) {
    if let Some(app) = app {
        let _ = app.emit(
            "export_progress",
            ExportProgressEvent {
                phase: phase.to_string(),
                step,
                total,
            },
        );
    }
}

/// 各シーン（静止画 or 動画）→ MP4 にし、トランジション有無で結合方法を選ぶ（ADR-0009 T2）。
/// 全境界ハードカット（遷移なし）なら concat demuxer の無劣化コピー、1つでも遷移ありなら xfade チェーンで再エンコード。
/// `joins` は jobs と同じ長さ（joins[0]＝先頭で未使用）。progress＝進捗イベントの送り先（None＝送らない・#376）。
// bitrate は export_video で1回算出し、場面/xfade/テロップ overlay の3経路で同一値を共有するため引数で受ける（#121）。
// 内部オーケストレータで、引数は infra ハンドル（ffmpeg/tmp/output）＋エンコード設定の混在＝自然な構造体化が難しいため、
// 意図した引数数として clippy::too_many_arguments を抑制する。
#[allow(clippy::too_many_arguments)]
fn encode_jobs(
    ffmpeg: &Path,
    jobs: &[SceneJob],
    joins: &[JoinInfo],
    codec: VideoCodec,
    fps: u32,
    bitrate: &str,
    tmp_dir: &Path,
    output: &Path,
    progress: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    fs::create_dir_all(tmp_dir).map_err(|e| {
        export_failure(
            format!("create tmp dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let mut files: Vec<String> = Vec::with_capacity(jobs.len());
    let encode_start = Instant::now();
    for (i, job) in jobs.iter().enumerate() {
        let clip = tmp_dir.join(format!("scene_{i:03}.mp4"));
        let args = match job {
            SceneJob::Still(s) => {
                let audio = s.audio.as_ref().map(|p| p.to_string_lossy().into_owned());
                scene_clip_args(
                    &s.png.to_string_lossy(),
                    audio.as_deref(),
                    s.narration_volume,
                    &clip.to_string_lossy(),
                    s.duration_sec,
                    fps,
                    codec,
                    bitrate,
                )
            }
            SceneJob::Video(v) => {
                let below = v.below.to_string_lossy().into_owned();
                let clip_path = v.clip.to_string_lossy().into_owned();
                let out_path = clip.to_string_lossy().into_owned();
                // 上PNG/ナレーションのパスを owned 化してから引数構造体（借用）を組む。
                let aboves_s: Vec<(String, Option<(f64, f64)>)> = v
                    .aboves
                    .iter()
                    .map(|a| (a.png.to_string_lossy().into_owned(), a.window))
                    .collect();
                let aboves: Vec<AbovePngArg> = aboves_s
                    .iter()
                    .map(|(p, w)| AbovePngArg { png: p, window: *w })
                    .collect();
                let narrs_s: Vec<(String, f64, Option<f64>)> = v
                    .narrations
                    .iter()
                    .map(|n| {
                        (
                            n.wav.to_string_lossy().into_owned(),
                            n.delay_sec,
                            n.window_sec,
                        )
                    })
                    .collect();
                let narrations: Vec<NarrationArg> = narrs_s
                    .iter()
                    .map(|(w, d, win)| NarrationArg {
                        wav: w,
                        delay_sec: *d,
                        window_sec: *win,
                    })
                    .collect();
                // 追加動画レイヤー（#431）：clip パスを owned 化してから借用構造体を組む。
                let extra_clip_s: Vec<String> = v
                    .extra_videos
                    .iter()
                    .map(|e| e.clip.to_string_lossy().into_owned())
                    .collect();
                let extra_videos: Vec<VideoLayerArg> = v
                    .extra_videos
                    .iter()
                    .zip(extra_clip_s.iter())
                    .map(|(e, clip)| VideoLayerArg {
                        clip,
                        slot_x: e.slot.0,
                        slot_y: e.slot.1,
                        slot_w: e.slot.2,
                        slot_h: e.slot.3,
                        fit: e.fit,
                        clip_start_sec: e.clip_start_sec,
                        clip_end_sec: e.clip_end_sec,
                        use_original_audio: e.use_original_audio,
                        original_volume: e.original_volume,
                        speed: e.speed,
                    })
                    .collect();
                // 動画レイヤー間の静止層PNG（#431）。
                let mid_s: Vec<String> = v
                    .mid_pngs
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let mid_pngs: Vec<&str> = mid_s.iter().map(|s| s.as_str()).collect();
                // 動画×アニメ（#435）：下/中/上層の image2 パターン（<dir>/frame_%05d.png）。パスを owned 化してから借用。
                let frame_pat = |df: &(PathBuf, u32)| -> String {
                    df.0.join("frame_%05d.png").to_string_lossy().into_owned()
                };
                let below_pat = v.below_frames.as_ref().map(frame_pat);
                let below_frames = v.below_frames.as_ref().and_then(|(_, fps)| {
                    below_pat.as_ref().map(|pat| AboveFramesArg {
                        pattern: pat,
                        fps: *fps,
                    })
                });
                let mid_pat_s: Vec<String> = v.mid_frames.iter().map(frame_pat).collect();
                let mid_frames: Vec<AboveFramesArg> = v
                    .mid_frames
                    .iter()
                    .zip(mid_pat_s.iter())
                    .map(|((_, fps), pat)| AboveFramesArg {
                        pattern: pat,
                        fps: *fps,
                    })
                    .collect();
                let above_pat = v.above_frames.as_ref().map(frame_pat);
                let above_frames = v.above_frames.as_ref().and_then(|(_, fps)| {
                    above_pat.as_ref().map(|pat| AboveFramesArg {
                        pattern: pat,
                        fps: *fps,
                    })
                });
                video_scene_args(&VideoSceneArgs {
                    below_png: &below,
                    clip: &clip_path,
                    extra_videos: &extra_videos,
                    mid_pngs: &mid_pngs,
                    aboves: &aboves,
                    below_frames,
                    mid_frames: &mid_frames,
                    above_frames,
                    narrations: &narrations,
                    slot_x: v.slot.0,
                    slot_y: v.slot.1,
                    slot_w: v.slot.2,
                    slot_h: v.slot.3,
                    fit: v.fit,
                    clip_start_sec: v.clip_start_sec,
                    clip_end_sec: v.clip_end_sec,
                    duration_sec: v.duration_sec,
                    narration_volume: v.narration_volume,
                    original_volume: v.original_volume,
                    use_original_audio: v.use_original_audio,
                    speed: v.speed,
                    fps,
                    codec,
                    bitrate,
                    out: &out_path,
                })
            }
            SceneJob::Frames(f) => {
                let audio = f.audio.as_ref().map(|p| p.to_string_lossy().into_owned());
                // image2 入力パターン（frame_00000.png ...）。decode 時に同名で書き出し済み。
                let pattern = f.frames_dir.join("frame_%05d.png");
                frames_scene_args(
                    &pattern.to_string_lossy(),
                    audio.as_deref(),
                    f.narration_volume,
                    &clip.to_string_lossy(),
                    f.duration_sec,
                    f.fps,
                    codec,
                    bitrate,
                )
            }
        };
        run_export(ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("scene {} encode: {e}", i + 1),
                format!(
                    "場面{}の変換に失敗しました。もう一度お試しください。",
                    i + 1
                ),
            )
        })?;
        files.push(clip.to_string_lossy().into_owned());
        // 場面1本を焼くたびに実進捗を通知＝encoding 段のバーが場面ごとに進む（#376）。
        emit_export_progress(progress, "encode", i + 1, jobs.len());
    }
    crate::tlog!(
        "export",
        "encode {} clips: {} ms",
        jobs.len(),
        encode_start.elapsed().as_millis()
    );
    // 結合（concat/xfade）に入る前に通知＝場面が2本以上あるときの結合待ちを「進行中」と示す（#376）。
    if files.len() >= 2 {
        emit_export_progress(progress, "join", 0, 0);
    }
    let join_start = Instant::now();

    // 境界は joins[1..] のみ有効（joins[0]＝先頭場面は遷移元なし。skip(1) で除外＝コメントと一致）。
    let has_transition = joins.iter().skip(1).any(|j| j.xfade.is_some());
    if has_transition && files.len() >= 2 {
        // 遷移あり：まず**論理的な場面**単位へ束ねる（#430・ADR-0026）。掛け合いは1場面が複数セグメント
        // （間/行）に展開されるので、同一場面のセグメントを先に -c copy 連結して per-scene クリップにし、その
        // per-scene クリップ間で xfade する。これで入場 xfade が「間」の短さでなく場面尺で clamp され、間を跨いで
        // 先頭行に重なる（front の transitionTimeline も per-scene で offset/尺を解決済み）。単一セグメント場面は連結不要。
        let ranges = scene_ranges(joins);
        let mut scene_files: Vec<String> = Vec::with_capacity(ranges.len());
        let mut scene_steps: Vec<JoinStep> = Vec::new();
        for (g, &(start, end)) in ranges.iter().enumerate() {
            let scene_clip = if end - start == 1 {
                files[start].clone() // 単一セグメント＝そのまま（連結不要）
            } else {
                // 複数セグメント（掛け合い）＝場面内はハードカット連結（-c copy・無劣化）。concat demuxer は
                // list と同階層の相対名を参照する（segment は tmp_dir/scene_NNN.mp4）。
                let mut list = String::new();
                for k in start..end {
                    list.push_str(&format!("file 'scene_{k:03}.mp4'\n"));
                }
                let list_path = tmp_dir.join(format!("scene_group_{g:03}.txt"));
                fs::write(&list_path, list).map_err(|e| {
                    export_failure(
                        format!("write scene group list: {e}"),
                        "動画の保存中に問題が発生しました。もう一度お試しください。",
                    )
                })?;
                let group_out = tmp_dir.join(format!("scene_group_{g:03}.mp4"));
                let cargs = concat_args(&list_path.to_string_lossy(), &group_out.to_string_lossy());
                run_export(ffmpeg, &cargs).map_err(|e| {
                    export_failure(
                        format!("scene group concat: {e}"),
                        "場面の結合に失敗しました。もう一度お試しください。",
                    )
                })?;
                group_out.to_string_lossy().into_owned()
            };
            scene_files.push(scene_clip);
            // 場面 g の入場遷移＝その場面の先頭セグメントの join（g=0 は先頭で未使用）。
            if g >= 1 {
                let j = &joins[start];
                scene_steps.push(JoinStep {
                    xfade: j.xfade.as_deref(),
                    duration_sec: j.duration_sec,
                    offset_sec: j.offset_sec,
                });
            }
        }
        // per-scene クリップ間で xfade/concat（ADR-0009 T2）。関数は無改修＝入力が場面クリップに変わっただけ。
        let args = xfade_chain_args(
            &scene_files,
            &scene_steps,
            &output.to_string_lossy(),
            codec,
            fps,
            bitrate,
        );
        run_export(ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("xfade join: {e}"),
                "場面の切り替え合成に失敗しました。もう一度お試しください。",
            )
        })?;
    } else {
        // 遷移なし：従来どおり concat demuxer の無劣化コピー（高速）。
        let mut list = String::new();
        for i in 0..files.len() {
            list.push_str(&format!("file 'scene_{i:03}.mp4'\n"));
        }
        let list_path = tmp_dir.join("concat.txt");
        fs::write(&list_path, list).map_err(|e| {
            export_failure(
                format!("write concat list: {e}"),
                "動画の保存中に問題が発生しました。もう一度お試しください。",
            )
        })?;
        let args = concat_args(&list_path.to_string_lossy(), &output.to_string_lossy());
        run_export(ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("concat: {e}"),
                "場面の結合に失敗しました。もう一度お試しください。",
            )
        })?;
    }
    if files.len() >= 2 {
        crate::tlog!(
            "export",
            "join {} clips: {} ms",
            files.len(),
            join_start.elapsed().as_millis()
        );
    }
    Ok(())
}

/// data URL なら base64 本体だけを取り出す。
fn strip_data_url(s: &str) -> &str {
    if s.starts_with("data:") {
        if let Some(i) = s.find(',') {
            return &s[i + 1..];
        }
    }
    s
}

/// ファイル名から区切り・予約文字を除く（空なら "export"）。
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    if cleaned.is_empty() {
        "export".to_string()
    } else {
        cleaned
    }
}

/// "cover" | "contain" | "stretch" → Fit（不明は cover）。
fn parse_fit(s: &str) -> Fit {
    match s {
        "contain" => Fit::Contain,
        "stretch" => Fit::Stretch,
        _ => Fit::Cover,
    }
}

/// プロジェクト相対パスを絶対パスへ解決（パストラバーサル・絶対パスを拒否＝assets.rs と同方針）。
fn resolve_project_file(
    app: &tauri::AppHandle,
    project_id: &str,
    rel_path: &str,
) -> Result<PathBuf, String> {
    if !crate::is_safe_project_id(project_id) {
        return Err(export_failure(
            format!("unsafe project_id: {project_id}"),
            "動画の書き出しに失敗しました。アプリを再起動してもう一度お試しください。",
        ));
    }
    // ⚠️ **規則は写さず共有する**（#893・§2-7）＝ここに同じ条件を書き直していたため、
    // `assets.rs` 側にコロン（Windows のドライブ相対パス）の検査を足しても**こちらだけ古いまま**だった。
    if !crate::assets::is_safe_rel_path(rel_path) {
        return Err(export_failure(
            format!("unsafe rel_path: {rel_path}"),
            "動画の書き出しに失敗しました。素材を確認してもう一度お試しください。",
        ));
    }
    let base = app.path().app_data_dir().map_err(|e| {
        export_failure(
            format!("app data dir: {e}"),
            "動画の保存先を準備できませんでした。もう一度お試しください。",
        )
    })?;
    Ok(base.join("projects").join(project_id).join(rel_path))
}

/// base64(or data URL) をデコードして path へ書き出す（汎用・下/上PNG用）。
fn decode_b64_to_file(b64: &str, path: &Path, ctx: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url(b64))
        .map_err(|e| {
            export_failure(
                format!("{ctx} decode: {e}"),
                "動画の保存中に問題が発生しました。もう一度お試しください。",
            )
        })?;
    fs::write(path, bytes).map_err(|e| {
        export_failure(
            format!("{ctx} write: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })
}

/// アニメ場面のフレームを逐次ディスクへ書き出すステージング先 <appData>/exports/.frames_stage。
/// 巨大な base64 を1回の IPC（JSON.stringify）に載せると文字列上限を超えて失敗するため、フレームは
/// 1枚ずつ小さく stage_export_frame で書き出し、export_video には frames_dir（相対名）だけ渡す（#書き出しRangeError）。
fn export_frames_stage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 生の OS エラーを UI に出さない（§2-5）。他の書き出しエラーと同様 export_failure で定型文言へ。
    let base = app.path().app_data_dir().map_err(|e| {
        export_failure(
            format!("app data dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    // プロセス単位に分ける（#379）：アプリ二重起動や dev/packaged 同時起動でステージを共有して相互破壊しないよう
    // pid で隔離。stage_export_frame も export_video も同一プロセスの pid を使うので値は一致し、clear は自分の分だけ消す。
    Ok(base
        .join("exports")
        .join(".frames_stage")
        .join(format!("proc_{}", std::process::id())))
}

/// ステージ用ディレクトリ名の検証（英数字と _ のみ＝パストラバーサル防止。フロントは `scene_frames_<n>` を渡す）。
fn is_safe_stage_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// アニメ場面のフレームを1枚だけステージングへ書き出す（巨大IPC回避・逐次保存）。
/// dir_name は場面ごとの相対名（英数字と _）、frame_index は 0 起点の連番。data_base64 は data URL 可。
/// 書き出し中に数百回呼ばれ、各回が PNG デコード＋ディスク書き込み（ブロッキング）のため、
/// メインスレッドではなくブロッキング専用スレッドで実行して描画フェーズの UI 固まりを防ぐ（#375）。
#[tauri::command]
pub async fn stage_export_frame(
    app: tauri::AppHandle,
    dir_name: String,
    frame_index: u32,
    data_base64: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        stage_export_frame_impl(app, dir_name, frame_index, data_base64)
    })
    .await
    .map_err(|e| {
        export_failure(
            format!("stage frame task join: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?
}

fn stage_export_frame_impl(
    app: tauri::AppHandle,
    dir_name: String,
    frame_index: u32,
    data_base64: String,
) -> Result<(), String> {
    if !is_safe_stage_name(&dir_name) {
        return Err(export_failure(
            format!("invalid stage dir: {dir_name}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        ));
    }
    let dir = export_frames_stage_dir(&app)?.join(&dir_name);
    fs::create_dir_all(&dir).map_err(|e| {
        export_failure(
            format!("create stage dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let path = dir.join(format!("frame_{frame_index:05}.png"));
    decode_b64_to_file(&data_base64, &path, "staged frame")
}

/// フレームのステージングを空にする（書き出しの前後で呼ぶ＝古いフレームを残さない）。非存在は成功扱い。
/// 数百PNGのディレクトリ削除（ブロッキングI/O）をメインスレッドで走らせないよう専用スレッドへ退避（#375）。
#[tauri::command]
pub async fn clear_export_frames_stage(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_export_frames_stage_impl(app))
        .await
        .map_err(|e| {
            export_failure(
                format!("clear frames task join: {e}"),
                "動画の保存中に問題が発生しました。もう一度お試しください。",
            )
        })?
}

fn clear_export_frames_stage_impl(app: tauri::AppHandle) -> Result<(), String> {
    let dir = export_frames_stage_dir(&app)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        // ロック等で消せないときも生 OS エラーを UI に出さない（§2-5）。定型文言で「次の行動」を示す。
        Err(e) => Err(export_failure(
            format!("clear frames stage: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )),
    }
}

// 起動時に掃除する書き出し一時ディレクトリの「古さ」しきい値（#420）。
// pid 隔離（#379）以降、クラッシュ/強制終了した pid のディレクトリを消す主体がいなくなり、
// `.frames_stage/proc_*` と `%TEMP%/yuko_recruit_export_*` がプロセスを跨いで蓄積し得る。
// 年齢ベースで「十分に古いものだけ」消す＝走行中の別インスタンス（mtime が新しい）は触らず #379 の相互破壊防止を保つ。
// 24h は、あり得る最長の書き出し（描画＋エンコード）よりも十分に長く取り、進行中の書き出しを決して巻き込まないための安全余裕。
// pid 生存確認（Option A）は依存追加（sysinfo/OpenProcess）が要るため α では採らない（本しきい値で十分安全側）。
// 注意（将来しきい値を短縮する場合）：古さ判定はトップレベル dir 自身の mtime のみで、配下サブディレクトリの更新は見ない。
// proc_<pid> の mtime は子（scene_frames_N）の追加時にしか更新されないため、単一シーンへ長時間書き込み続ける進行中の
// 書き出しではトップレベル mtime が停滞し得る（#420 レビュー）。24h ではそのケースも書き出し時間を大きく超え実害なし。
const STALE_EXPORT_DIR_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// name（ディレクトリ名）が prefix で始まる書き出し作業ディレクトリで、最終更新から max_age を超えていれば掃除対象。
/// 純粋関数（I/O なし）＝テスト対象（§7）。now/modified は呼び出し側が渡す。
/// mtime が未来（時計ずれ・別インスタンスが今まさに書き込み中など）のときは触らない＝安全側で false。
fn is_stale_export_dir(
    name: &str,
    prefix: &str,
    modified: SystemTime,
    now: SystemTime,
    max_age: Duration,
) -> bool {
    if !name.starts_with(prefix) {
        return false;
    }
    match now.duration_since(modified) {
        Ok(age) => age > max_age,
        Err(_) => false,
    }
}

/// parent 直下で prefix にマッチする「十分に古い」ディレクトリだけを削除する（走行中のものは新しいので残す）。
/// parent が無ければ何もしない。削除失敗（ロック中＝走行中の可能性）は無視して次回に回す（起動を妨げない）。
fn remove_stale_export_dirs(parent: &Path, prefix: &str, max_age: Duration) {
    let now = SystemTime::now();
    let entries = match fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return, // まだ一度も書き出していない等＝掃除不要
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue, // 非UTF-8名は自分の作った proc_/yuko_recruit_export_ ではない
        };
        // トップレベル dir 自身の mtime のみで古さを判定（配下の更新は見ない・前提は STALE_EXPORT_DIR_MAX_AGE のコメント参照）。
        let modified = entry.metadata().and_then(|m| m.modified()).ok();
        if let Some(modified) = modified {
            if is_stale_export_dir(&name, prefix, modified, now, max_age) {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }
}

/// 起動時に、前回クラッシュ/強制終了で残った書き出しの一時/ステージディレクトリを掃除する（#420）。
/// 起動を妨げないようブロッキング専用スレッドで実行し、失敗はログのみ（§2-5：UI へ生エラーを出さない）。
pub fn cleanup_stale_export_dirs(app: &tauri::AppHandle) {
    // ステージ先の親 `<appData>/exports/.frames_stage`（proc_* が並ぶ）。取得失敗時は掃除をスキップ。
    let stage_parent = app
        .path()
        .app_data_dir()
        .ok()
        .map(|b| b.join("exports").join(".frames_stage"));
    // 作業ディレクトリの親 `%TEMP%`（yuko_recruit_export_* が並ぶ）。
    let temp_parent = std::env::temp_dir();
    let app_for_cache = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = stage_parent {
            remove_stale_export_dirs(&parent, "proc_", STALE_EXPORT_DIR_MAX_AGE);
        }
        remove_stale_export_dirs(
            &temp_parent,
            "yuko_recruit_export_",
            STALE_EXPORT_DIR_MAX_AGE,
        );
        // 帯に敷く絵の作り置きも一緒に（#332）＝誰も消さないと増え続ける。
        remove_stale_analysis_cache(&app_for_cache);
    });
}

/// 帯に敷く絵の作り置き（`projects/*/cache/`）を古い順に片づける（#332）。
///
/// ⚠️ **誰も消さないと増え続ける**＝鍵に「素材の中身の印」と「コマ数」と「範囲」が入るので、
/// 中身を差し替えるたび・別の倍率で開くたび・別の範囲で置くたびに1枚増える。
/// 素材の片づけ（`delete_project_files` は `assets/` 限定＝破壊的なコマンドは範囲を狭く）にも
/// 焼き出しのコピー（明示パス）にも乗らないので、**起動時にまとめて捨てる**。
/// **作り直せる**ものなので、消して困ることは無い（次に必要になったら作る）。
fn remove_stale_analysis_cache(app: &tauri::AppHandle) {
    let projects = match app.path().app_data_dir().ok().map(|b| b.join("projects")) {
        Some(p) => p,
        None => return,
    };
    let now = SystemTime::now();
    let entries = match fs::read_dir(&projects) {
        Ok(e) => e,
        Err(_) => return, // まだ動画を作っていない＝掃除不要
    };
    for project in entries.flatten() {
        let cache = project.path().join("cache");
        let files = match fs::read_dir(&cache) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file in files.flatten() {
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            // 使われていない期間で見る（書き出しの一時置き場と同じ基準・同じ長さ）。
            if let Ok(modified) = file.metadata().and_then(|m| m.modified()) {
                if now
                    .duration_since(modified)
                    .map(|d| d > STALE_EXPORT_DIR_MAX_AGE)
                    .unwrap_or(false)
                {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

/// クリップの区間フレームを出力fpsでステージング（#442・動画スロット本体アニメ）。
/// 動画スロットがアニメする場面は、アニメ区間だけ「動画の実フレームをスロット矩形へ描いて場面全体を per-frame 合成」
/// する。その素材として、クリップの [clip_start_sec, +dur_sec)（再生秒）を **出力 f＝clip-time clip_start_sec+(f/fps)*speed**
/// になるよう `setpts=PTS/speed,fps` でサンプルして `<stage>/<dir>/frame_%05d.png` へ書き出す。width で横幅を制限（縦は比率維持）。
/// 返り値＝実書き出しフレーム数（尺がクリップ末尾を超えると要求 N 未満になりうる＝フロントは min(f,count-1) で末尾クランプ）。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stage_clip_frames(
    app: tauri::AppHandle,
    project_id: String,
    clip_rel_path: String,
    clip_start_sec: f64,
    dur_sec: f64,
    speed: f64,
    fps: u32,
    width: u32,
    dir_name: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stage_clip_frames_impl(
            app,
            project_id,
            clip_rel_path,
            clip_start_sec,
            dur_sec,
            speed,
            fps,
            width,
            dir_name,
        )
    })
    .await
    .map_err(|e| {
        export_failure(
            format!("stage clip frames join: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?
}

#[allow(clippy::too_many_arguments)]
fn stage_clip_frames_impl(
    app: tauri::AppHandle,
    project_id: String,
    clip_rel_path: String,
    clip_start_sec: f64,
    dur_sec: f64,
    speed: f64,
    fps: u32,
    width: u32,
    dir_name: String,
) -> Result<usize, String> {
    if !is_safe_stage_name(&dir_name) {
        return Err(export_failure(
            format!("invalid stage dir: {dir_name}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        ));
    }
    let input = resolve_project_file(&app, &project_id, &clip_rel_path)?;
    if !input.exists() {
        return Err(export_failure(
            format!("clip frames src missing: {}", input.display()),
            "動画が見つかりませんでした。もう一度取り込んでください。",
        ));
    }
    let dir = export_frames_stage_dir(&app)?.join(&dir_name);
    fs::create_dir_all(&dir).map_err(|e| {
        export_failure(
            format!("clip frames dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let fps = fps.max(1);
    let speed = if speed.is_finite() && speed > 0.0 {
        speed
    } else {
        1.0
    };
    let width = width.max(2);
    // 出力フレーム数 N＝ceil(dur*fps)+1（末尾フレームを含める＝フロントの frameCount と一致）。
    let n = (dur_sec.max(0.0) * fps as f64).ceil() as usize + 1;
    let start = clip_start_sec.max(0.0);
    let ffmpeg = resolve_ffmpeg(&app);
    // 出力 f＝clip-time start+(f/fps)*speed：setpts=PTS/speed で速度反映→fps で等間隔サンプル→横幅制限。
    let vf = format!("setpts=PTS/{speed},fps={fps},scale='min({width},iw)':-2");
    let args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        format!("{start}"),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        vf,
        "-frames:v".into(),
        format!("{n}"),
        "-start_number".into(),
        "0".into(),
        dir.join("frame_%05d.png").to_string_lossy().into_owned(),
    ];
    run_export(&ffmpeg, &args).map_err(|e| {
        export_failure(
            format!("clip frames extract: {e}"),
            "動画の変換に失敗しました。もう一度お試しください。",
        )
    })?;
    // 実書き出し枚数を数える（クリップ末尾で N 未満になりうる）。最低1枚は保証（先頭が無ければエラー）。
    let count = (0..n)
        .take_while(|f| dir.join(format!("frame_{f:05}.png")).exists())
        .count();
    if count == 0 {
        return Err(export_failure(
            format!("clip frames produced none: {}", dir.display()),
            "動画の変換に失敗しました。もう一度お試しください。",
        ));
    }
    Ok(count)
}

/// ステージ済みフレーム（stage_clip_frames が書き出したクリップフレーム）を base64 data URL で読む（#442）。
/// ブラウザがこのフレームをスロット画像として layoutToSvg に差し込み、場面全体を per-frame 合成する。
#[tauri::command]
pub async fn read_export_frame(
    app: tauri::AppHandle,
    dir_name: String,
    frame_index: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_export_frame_impl(app, dir_name, frame_index))
        .await
        .map_err(|e| {
            export_failure(
                format!("read export frame join: {e}"),
                "動画の保存中に問題が発生しました。もう一度お試しください。",
            )
        })?
}

fn read_export_frame_impl(
    app: tauri::AppHandle,
    dir_name: String,
    frame_index: u32,
) -> Result<String, String> {
    if !is_safe_stage_name(&dir_name) {
        return Err(export_failure(
            format!("invalid stage dir: {dir_name}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        ));
    }
    let path = export_frames_stage_dir(&app)?
        .join(&dir_name)
        .join(format!("frame_{frame_index:05}.png"));
    let bytes = fs::read(&path).map_err(|e| {
        export_failure(
            format!("read staged frame: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// エクスポートの入力（1場面）。フロントは PNG(base64 or data URL) と尺を渡す。
/// 動画ありシーンは `video` を指定（その場合 png_base64 は使わない）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneInput {
    #[serde(default)]
    png_base64: String,
    /// アニメ場面のフレーム列（④・ADR-0019・data URL 可）。指定時は image2 で1動画に焼く（png_base64 は未使用）。
    /// 巨大場面（数百フレーム）は IPC の JSON 文字列上限を超えるため、frames_dir（ステージング済み）を優先する。
    #[serde(default)]
    frames_base64: Option<Vec<String>>,
    /// ステージング済みフレームの相対ディレクトリ名（stage_export_frame で <stage>/<name>/frame_NNNNN.png を書き込み済み）。
    /// 指定時は frames_base64 より優先＝巨大な base64 を IPC に載せずに済む（#書き出しRangeError）。
    #[serde(default)]
    frames_dir: Option<String>,
    /// frames_base64 のフレームレート（未指定なら描画fpsを使う）。
    #[serde(default)]
    fps: Option<u32>,
    duration_sec: f64,
    /// 場面のナレーション音声(WAV)。data URL も可。無い場面は無音トラックになる。
    #[serde(default)]
    audio_base64: Option<String>,
    /// ナレーション音量（§6で解決済み）。未指定なら既定。
    #[serde(default)]
    narration_volume: Option<f64>,
    /// 同時開始（掛け合いの並行・ADR-0031）：audio_base64（primary）と**同時に**流す他行のナレーション。
    /// 非空のとき primary と amix して 1 本の narration にする（非動画の掛け合い＝still/frames 全経路が narration を使う）。
    #[serde(default)]
    narration_segments: Vec<NarrationSegmentInput>,
    /// 動画ありシーン（ADR-0006）。指定時は overlay 合成経路へ。
    #[serde(default)]
    video: Option<VideoSceneInput>,
    /// 窓 Frames セグメント（#442・動画スロット本体アニメ）のクリップ元音声（**複数動画スロット対応＝各スロット1本**）。
    /// 非空のとき frames_dir 経路でナレーションと全本を amix する（アニメ区間から再生される元音声・useOriginalAudio のスロットぶん）。
    #[serde(default)]
    clip_audios: Vec<ClipAudioInput>,
    /// この場面に「入る」トランジション（ADR-0009 T2）。先頭場面は無視。未指定＝ハードカット。
    #[serde(default)]
    transition: Option<TransitionInput>,
    /// 論理的な「場面」の先頭セグメントか（#430）。掛け合いの間/行など同一場面の後続セグメントは false。
    /// true の境界で場面が変わる＝同一場面のセグメントを先に連結してから場面クリップ単位で xfade する。
    #[serde(default)]
    scene_start: bool,
}

/// 場面間トランジション入力（ADR-0009 T2）。front の transitionTimeline が name/offset を解決済み。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionInput {
    /// FFmpeg xfade の transition 名（"fade"/"slideleft"/"slideright"/"slideup"/"slidedown"）。"none"/不明はハードカット。
    name: String,
    #[serde(default)]
    duration_sec: f64,
    #[serde(default)]
    offset_sec: f64,
}

/// 窓 Frames セグメント（#442）のクリップ元音声入力。区間 [clip_start_sec, +dur_sec*speed) を取り出し
/// atempo で速度反映・volume を適用して、ナレーションと amix する（settled 区間の元音声は Video 経路が担う）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudioInput {
    clip_rel_path: String,
    #[serde(default)]
    clip_start_sec: f64,
    /// 窓の尺 W（再生秒）。ソース秒は dur_sec*speed。
    #[serde(default)]
    dur_sec: f64,
    #[serde(default)]
    speed: Option<f64>,
    #[serde(default)]
    volume: Option<f64>,
    /// 窓内での再生開始遅延（scene-time 秒・#444/ADR-0027）。0＝窓先頭から（従来）。adelay で配置する。
    #[serde(default)]
    delay_sec: f64,
}

/// 動画ありシーンの入力（ADR-0006・step2b）。下/上PNGは base64、クリップはプロジェクト相対パス。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSceneInput {
    /// 下PNG（不透明・全面）。below_frames_dir（動画×アニメ・#435 P1）指定時は省略されるため default 許容。
    #[serde(default)]
    below_png_base64: String,
    /// 全尺の上PNG（従来の1枚）。above_segments 指定時は未使用（空可）。
    #[serde(default)]
    above_png_base64: String,
    /// 掛け合い×動画：行区間つき上PNG（字幕/クレジット差し替え）。空なら above_png_base64 を全尺で使う。
    #[serde(default)]
    above_segments: Vec<AboveSegmentInput>,
    /// 掛け合い×動画：行ごとのナレーション（開始秒に配置）。空なら場面単位の audio_base64（従来）。
    #[serde(default)]
    narration_segments: Vec<NarrationSegmentInput>,
    /// プロジェクト相対のクリップパス（例: "assets/asset_005.mp4"）。
    clip_rel_path: String,
    slot_x: u32,
    slot_y: u32,
    slot_w: u32,
    slot_h: u32,
    /// "cover" | "contain" | "stretch"。
    fit: String,
    #[serde(default)]
    clip_start_sec: f64,
    #[serde(default)]
    clip_end_sec: Option<f64>,
    /// 元動画音声を使うか（front 側で hasAudio 確認済み＝N-2）。
    #[serde(default)]
    use_original_audio: bool,
    #[serde(default)]
    original_volume: Option<f64>,
    #[serde(default)]
    speed: Option<f64>,
    /// 2本目以降の動画レイヤー（zIndex 昇順・先頭動画の上・#431）。空＝1動画（従来）。
    #[serde(default)]
    video_layers: Vec<VideoLayerInput>,
    /// 連続する動画レイヤーの間に挟む静止層PNG（透過・base64・枚数＝動画本数−1・#431）。空＝1動画。
    #[serde(default)]
    mid_layers: Vec<String>,
    /// 動画×アニメ（#435）：最上層を per-frame で焼くステージング済みフレームdir名（英数字/_）。
    /// stage_export_frame が <stage>/<dir>/frame_NNNNN.png を書き込み済み。None＝静止 above（従来/掛け合い）。
    #[serde(default)]
    above_frames_dir: Option<String>,
    /// 動画×アニメ（#435）：下層を per-frame で焼くステージング済みフレームdir名。None＝静止 below。
    #[serde(default)]
    below_frames_dir: Option<String>,
    /// 動画×アニメ（#435）：中間層を per-frame で焼くステージング済みフレームdir名（枚数＝動画本数−1）。空＝静止 mid。
    #[serde(default)]
    mid_frames_dirs: Vec<String>,
    /// per-frame（below/mid/above）フレームレート（未指定は 30）。全層共通。
    #[serde(default)]
    above_frames_fps: Option<u32>,
}

/// 追加動画レイヤー1本の入力（#431）。先頭動画（VideoSceneInput 本体）と同じクリップ設定を持つ。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoLayerInput {
    clip_rel_path: String,
    slot_x: u32,
    slot_y: u32,
    slot_w: u32,
    slot_h: u32,
    /// "cover" | "contain" | "stretch"。
    fit: String,
    #[serde(default)]
    clip_start_sec: f64,
    #[serde(default)]
    clip_end_sec: Option<f64>,
    #[serde(default)]
    use_original_audio: bool,
    #[serde(default)]
    original_volume: Option<f64>,
    #[serde(default)]
    speed: Option<f64>,
}

/// 掛け合い×動画：行区間つき上PNG入力（表示窓 [start_sec, end_sec)）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AboveSegmentInput {
    png_base64: String,
    #[serde(default)]
    start_sec: f64,
    #[serde(default)]
    end_sec: f64,
}

/// 掛け合い×動画：行ナレーション入力（delay_sec 秒に配置・window_sec の窓で切り詰め＝#385）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrationSegmentInput {
    audio_base64: String,
    #[serde(default)]
    delay_sec: f64,
    /// 行の窓（次の行の開始まで＝表示尺）。この長さで atrim 切り詰め＝前の行が次の行に重ならない（#385）。
    /// 省略時 None=切り詰めない（後方互換）。
    #[serde(default)]
    window_sec: Option<f64>,
}

/// 場面ごとBGMの1クリップ入力（ADR-0018 ③(7)・front の planBgmMix が配置＋フェードを算出）。data URL も可・volume は §6 で解決済み。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgmRunInput {
    /// 音源の中身（base64）。**`audio_path` を渡すときは空でよい**。
    audio_base64: String,
    /// 音源のプロジェクト相対パス（#512 段2）。**動画の元の音**はここで渡す
    /// ＝動画ファイルを base64 にすると数百MBの文字列を作ることになる（場面形式の動画スロットも
    /// パスで渡している＝同じ流儀）。指定があれば base64 より優先し、一時ファイルも作らない。
    #[serde(default)]
    audio_path: Option<String>,
    /// 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。
    file_ext: String,
    volume: f64,
    /// 音量の変化（#512）＝`volume` フィルタの式。**未指定＝従来どおり `volume` の一定値**
    /// （場面形式の呼び出しは渡さない＝出力は不変）。組むのは front の `volumeExpr`（ADR-0032 追補＝案A）。
    #[serde(default)]
    volume_expr: Option<String>,
    /// グローバル配置開始（秒）＝adelay。
    #[serde(default)]
    delay_sec: f64,
    /// ループ素材から使う長さ（秒）＝atrim。
    play_sec: f64,
    #[serde(default)]
    fade_in_sec: f64,
    #[serde(default)]
    fade_out_sec: f64,
    /// 素材が短いとき繰り返すか。**既定 true＝従来の BGM の挙動**（場面形式の呼び出しは指定しない）。
    /// タイムライン形式の読み上げは false を渡す（#631）。
    #[serde(default = "default_true")]
    loop_source: bool,
    /// 素材のどこから使うか（秒）。**既定 0＝従来どおり頭から**。
    #[serde(default)]
    source_start_sec: f64,
    /// 再生速度。**既定 1.0＝従来どおり等速**。
    #[serde(default = "default_speed")]
    speed: f64,
}

fn default_speed() -> f64 {
    DEFAULT_SPEED
}

fn default_true() -> bool {
    true
}

/// エクスポート結果の要約。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    output_path: String,
    codec: String,
    scene_count: usize,
}

/// 書き出しが同時に2本走らないための実行中フラグ（#379）。フロントの busy 制御に加えた保険＝
/// 二重 invoke（画面遷移で進捗表示が消え再度押す等）や競合を Rust 側でも弾き、共有作業ディレクトリの
/// 相互破壊を防ぐ。RAII で必ず解除する（早期 return・エラー・パニックでも Drop で false へ戻る）。
static EXPORT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
struct ExportInFlightGuard;
impl Drop for ExportInFlightGuard {
    fn drop(&mut self) {
        EXPORT_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// 場面PNG群を受け取り、実MP4を output_path に書き出す（H.264/MP4）。
/// 数分に及ぶ FFmpeg パイプライン（場面エンコード→xfade結合→テロップ→BGM）は同期・ブロッキングのため、
/// 同期コマンドのままだとメインスレッド（UI イベントループ）を塞ぎ、ウィンドウが「応答なし」になる（#375）。
/// async コマンド＋spawn_blocking でブロッキング専用スレッドへ退避し、UI を生かす。
#[tauri::command]
pub async fn export_video(
    app: tauri::AppHandle,
    scenes: Vec<SceneInput>,
    file_name: String,
    bgm_runs: Option<Vec<BgmRunInput>>,
    project_id: Option<String>,
    output_path: Option<String>,
    // 全体の音量を整えるときの目安の大きさ（LUFS・#259）。未指定＝整えない（従来どおり＝出力不変）。
    normalize_lufs: Option<f64>,
) -> Result<ExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_video_impl(
            app,
            scenes,
            file_name,
            bgm_runs,
            project_id,
            output_path,
            normalize_lufs,
        )
    })
    .await
    .map_err(|e| {
        export_failure(
            format!("export task join: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?
}

/// 窓 Frames（#442）の音声を用意する：ナレーション（narration・§6音量）と**複数**クリップ元音声
/// （各 clip・区間 [start,+dur*speed)・atempo で速度反映・volume）を amix して 1 本の WAV にする。
/// 複数動画スロットのアニメ区間でも settled（Video 経路の全スロット amix）と同じく全元音声が鳴る（#431 整合・#442 P2）。
/// 音量は WAV に焼き込むので、呼び出し側は job の narration_volume に 1.0 を渡す（append_scene_av_tail の二重適用回避）。
/// clips は少なくとも1本（呼び出しは clip_audios 非空時のみ）。
fn build_window_audio(
    ffmpeg: &Path,
    tmp: &Path,
    idx: usize,
    clips: &[(PathBuf, &ClipAudioInput)],
    narration: Option<&Path>,
    narration_volume: f64,
) -> Result<PathBuf, String> {
    let out = tmp.join(format!("winaudio_{idx:03}.wav"));
    let mut args: Vec<String> = vec!["-y".into()];
    let mut fc = String::new();
    let mut labels = String::new();
    let mut input_idx = 0usize;
    // ナレーション入力（先頭・音量を焼く）。
    if let Some(narr) = narration {
        args.extend(["-i".into(), narr.to_string_lossy().into_owned()]);
        fc.push_str(&format!("[{input_idx}:a]volume={narration_volume}[a0];"));
        labels.push_str("[a0]");
        input_idx += 1;
    }
    // 各クリップ元音声（-ss/-t で区間切り出し・atempo で速度反映・volume を焼く）。
    for (k, (clip, ca)) in clips.iter().enumerate() {
        let speed = ca.speed.unwrap_or(DEFAULT_SPEED).clamp(0.5, 2.0);
        let vol = ca.volume.unwrap_or(DEFAULT_ORIGINAL_AUDIO_VOLUME);
        let src_dur = ca.dur_sec.max(0.0) * speed; // ソース秒（再生秒 W × speed）
        let start = ca.clip_start_sec.max(0.0);
        args.extend([
            "-ss".into(),
            format!("{start}"),
            "-t".into(),
            format!("{src_dur}"),
            "-i".into(),
            clip.to_string_lossy().into_owned(),
        ]);
        let atempo = if (speed - 1.0).abs() < 1e-6 {
            String::new()
        } else {
            format!("atempo={speed},")
        };
        // 窓内での再生開始遅延（#444/ADR-0027）：0 のときは省略（従来＝窓先頭から）。全チャンネルへ adelay（narr_chain と同方針）。
        let delay_ms = (ca.delay_sec.max(0.0) * 1000.0).round() as i64;
        let adelay = if delay_ms > 0 {
            format!(",adelay={delay_ms}:all=1")
        } else {
            String::new()
        };
        fc.push_str(&format!(
            "[{input_idx}:a]{atempo}volume={vol}{adelay}[c{k}];"
        ));
        labels.push_str(&format!("[c{k}]"));
        input_idx += 1;
    }
    // narration + クリップ本数を amix（1本でも通す＝ラベル整形のみで passthrough）。
    let filter = format!("{fc}{labels}amix=inputs={input_idx}:duration=longest:normalize=0[a]");
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[a]".into(),
        out.to_string_lossy().into_owned(),
    ]);
    run_export(ffmpeg, &args).map_err(|e| {
        export_failure(
            format!("window audio: {e}"),
            "動画の変換に失敗しました。もう一度お試しください。",
        )
    })?;
    Ok(out)
}

/// mix_narrations の filter_complex を組む純粋部分（テスト可能・ADR-0031）。入力は primary（あれば先頭）→各同時行の順。
/// primary は unit gain の passthrough（anull）、各同時行は window_sec で atrim・delay_sec で adelay（無ければ anull）。
/// 全入力を amix（duration=longest＝一番長い声に合わせ短い声は無音尾・normalize=0＝各声フル音量）。
fn narration_mix_filter(has_primary: bool, segments: &[NarrationSegmentInput]) -> String {
    let mut fc = String::new();
    let mut labels = String::new();
    let mut input_idx = 0usize;
    if has_primary {
        fc.push_str(&format!("[{input_idx}:a]anull[n0];"));
        labels.push_str("[n0]");
        input_idx += 1;
    }
    for (k, seg) in segments.iter().enumerate() {
        let mut chain: Vec<String> = Vec::new();
        if let Some(w) = seg.window_sec {
            if w > 0.0 {
                chain.push(format!("atrim=0:{w}"));
                chain.push("asetpts=N/SR/TB".into());
            }
        }
        let delay_ms = (seg.delay_sec.max(0.0) * 1000.0).round() as i64;
        if delay_ms > 0 {
            chain.push(format!("adelay={delay_ms}:all=1"));
        }
        if chain.is_empty() {
            chain.push("anull".into()); // フィルタ無しでもラベルを有効にする passthrough
        }
        fc.push_str(&format!("[{input_idx}:a]{}[p{k}];", chain.join(",")));
        labels.push_str(&format!("[p{k}]"));
        input_idx += 1;
    }
    // amix（1本でも通す＝ラベル整形のみで passthrough）。
    format!("{fc}{labels}amix=inputs={input_idx}:duration=longest:normalize=0[a]")
}

/// 同時開始（掛け合いの並行・ADR-0031）：primary ナレーション（任意）＋各同時行（delay_sec 秒に配置・window_sec 窓で
/// 切り詰め）を amix して 1 本の WAV にする。音量は焼かない（unit gain）＝下流で場面の narration_volume を1回だけ適用する
/// （build_window_audio と違い二重適用の心配がない＝全員同じ場面音量）。呼び出しは narration_segments 非空時のみ。
/// primary が無い場面（segments だけ）でも混ぜられる。全 non-video 経路（still/frames/frames_dir）が共有する narration を差し替える。
fn mix_narrations(
    ffmpeg: &Path,
    tmp: &Path,
    idx: usize,
    primary: Option<&Path>,
    segments: &[NarrationSegmentInput],
) -> Result<PathBuf, String> {
    let out = tmp.join(format!("dualvoice_{idx:03}.wav"));
    let mut args: Vec<String> = vec!["-y".into()];
    // 入力を filter と同じ順（primary→各同時行）で並べる。
    if let Some(p) = primary {
        args.extend(["-i".into(), p.to_string_lossy().into_owned()]);
    }
    for (k, seg) in segments.iter().enumerate() {
        let wav = tmp.join(format!("dualvoice_{idx:03}_{k:02}.wav"));
        decode_b64_to_file(
            &seg.audio_base64,
            &wav,
            &format!("scene {} parallel narration {}", idx + 1, k + 1),
        )?;
        args.extend(["-i".into(), wav.to_string_lossy().into_owned()]);
    }
    let filter = narration_mix_filter(primary.is_some(), segments);
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[a]".into(),
        out.to_string_lossy().into_owned(),
    ]);
    run_export(ffmpeg, &args).map_err(|e| {
        export_failure(
            format!("dual-voice mix: {e}"),
            "動画の変換に失敗しました。もう一度お試しください。",
        )
    })?;
    Ok(out)
}

/// 書き出し本体（ブロッキング）。`export_video` が spawn_blocking 上で呼ぶ（#375）。
#[allow(clippy::too_many_arguments)]
fn export_video_impl(
    app: tauri::AppHandle,
    scenes: Vec<SceneInput>,
    file_name: String,
    bgm_runs: Option<Vec<BgmRunInput>>,
    project_id: Option<String>,
    output_path: Option<String>,
    normalize_lufs: Option<f64>,
) -> Result<ExportReport, String> {
    // すでに別の書き出しが走っていれば弾く（二重実行での作業ディレクトリ相互破壊を防ぐ・#379）。
    // 取得できたら以降の全経路で RAII ガードが解除を保証する。
    if EXPORT_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(export_failure(
            "export already in flight",
            "すでに書き出し中です。完了までお待ちください。",
        ));
    }
    let _in_flight = ExportInFlightGuard;
    // キャンセルスコープの初期化は begin_export（準備＝クリップ抽出の前）で済ませる（#380）。ここでリセットすると
    // 準備中に押された中止を取りこぼす（本体開始で flag が消える）ため、ここでは初期化しない。

    if scenes.is_empty() {
        return Err("書き出す場面がありません。".into());
    }
    let ffmpeg = resolve_ffmpeg(&app);
    let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).map_err(|_| {
        "動画の書き出しツールが見つかりません。設定でツールの場所を指定してください。".to_string()
    })?;
    // ここに来るのは「ffmpeg は見つかったが H.264 エンコーダ（h264_mf/libopenh264/libx264）が無い」ケース。
    // 原因はツールの場所ではなく環境（例: Windows N で Media Foundation 非搭載、配布ビルドの構成不足）。
    // 通常は公開前チェック（detect_h264_capability・#120）で事前ブロックされるが、そこを経ない経路でも
    // 「次の行動」を示せるよう、文言は TS の EXPORT_CAPABILITY_NOTICE.unavailable と同内容に揃える（§2-5）。
    let codec = pick_codec(&encoders).ok_or_else(|| {
        "この端末では動画を書き出せません。お使いの Windows が N／KN 版の場合は「メディア機能パック」を追加してから、もう一度お試しください。解決しない場合はお問い合わせください。".to_string()
    })?;

    // プロセス単位の作業ディレクトリ（#379）：固定名だと二重起動時に相手の中間ファイル（scene_NNN.mp4 等）を
    // remove_dir_all で消し合い、無エラーで別内容が混ざった MP4 になり得た。pid で隔離し自分の前回残骸だけ掃除する。
    let tmp = std::env::temp_dir().join(format!("yuko_recruit_export_{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| {
        export_failure(
            format!("create tmp dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;

    let mut jobs: Vec<SceneJob> = Vec::with_capacity(scenes.len());
    for (i, s) in scenes.iter().enumerate() {
        // ナレーション音声（静止/動画 共通）を先に書き出す。
        let narration = match &s.audio_base64 {
            Some(b64) if !b64.is_empty() => {
                let wav = tmp.join(format!("scene_{i:03}.wav"));
                decode_b64_to_file(b64, &wav, &format!("scene {} narration", i + 1))?;
                Some(wav)
            }
            _ => None,
        };
        // 同時開始（掛け合いの並行・ADR-0031）：並行ナレーションがあれば primary と amix して 1 本に差し替える。
        // 非動画（still/frames/frames_dir）が共有する narration をここで確定＝以降の全経路が同時ボイスを鳴らす。
        // 動画ありシーンは v.narration_segments を使う（TS は s.narration_segments を非動画にだけ載せる）ので空＝素通り。
        let narration = if !s.narration_segments.is_empty() {
            Some(mix_narrations(
                &ffmpeg,
                &tmp,
                i,
                narration.as_deref(),
                &s.narration_segments,
            )?)
        } else {
            narration
        };

        if let Some(v) = &s.video {
            // 動画ありシーン（ADR-0006）。下/上PNGを書き出し、クリップをプロジェクト相対パスから安全解決。
            let pid = project_id.as_deref().ok_or_else(|| {
                export_failure(
                    "video scene without project_id",
                    "動画を含む書き出しには、先にプロジェクトの保存が必要です。",
                )
            })?;
            // 下層PNG：below_frames_dir（動画×アニメ・#435）があれば静止 below は書き出さない（per-frame を使う）。
            let below = tmp.join(format!("below_{i:03}.png"));
            if v.below_frames_dir
                .as_deref()
                .filter(|d| !d.is_empty())
                .is_none()
            {
                decode_b64_to_file(
                    &v.below_png_base64,
                    &below,
                    &format!("scene {} below png", i + 1),
                )?;
            }
            // 最上層(above)の入力種別を先に判定（#435）：above_frames_dir（動画×アニメ）を最優先し、
            // per-frame と静止 aboves を相互排他にする（frames 指定なのに aboves 必須で落ちる順序バグ防止）。
            let has_frames_dir = v.above_frames_dir.as_deref().is_some_and(|d| !d.is_empty());
            let above_src = resolve_above_source(
                has_frames_dir,
                !v.above_segments.is_empty(),
                !v.above_png_base64.is_empty(),
            )
            .ok_or_else(|| {
                export_failure(
                    format!("scene {} video without above png", i + 1),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                )
            })?;
            // 静止 aboves は Segments/SinglePng のときだけ組む。Frames のときは空（above_frames を後段で解決）。
            let mut aboves: Vec<TimedAbove> = Vec::new();
            match above_src {
                AboveSource::Segments => {
                    for (k, seg) in v.above_segments.iter().enumerate() {
                        let p = tmp.join(format!("above_{i:03}_{k:02}.png"));
                        decode_b64_to_file(
                            &seg.png_base64,
                            &p,
                            &format!("scene {} above png {}", i + 1, k + 1),
                        )?;
                        aboves.push(TimedAbove {
                            png: p,
                            window: Some((seg.start_sec, seg.end_sec)),
                        });
                    }
                }
                AboveSource::SinglePng => {
                    let p = tmp.join(format!("above_{i:03}.png"));
                    decode_b64_to_file(
                        &v.above_png_base64,
                        &p,
                        &format!("scene {} above png", i + 1),
                    )?;
                    aboves.push(TimedAbove {
                        png: p,
                        window: None,
                    });
                }
                AboveSource::Frames => {} // 静止 aboves なし＝above_frames を使う（#435）
            }
            // ナレーション：行ごと（掛け合い×動画・開始秒に配置）を優先、無ければ場面単位（従来）。
            let mut narrations: Vec<TimedNarration> = Vec::new();
            if !v.narration_segments.is_empty() {
                for (k, seg) in v.narration_segments.iter().enumerate() {
                    let p = tmp.join(format!("scene_{i:03}_line_{k:02}.wav"));
                    decode_b64_to_file(
                        &seg.audio_base64,
                        &p,
                        &format!("scene {} line narration {}", i + 1, k + 1),
                    )?;
                    narrations.push(TimedNarration {
                        wav: p,
                        delay_sec: seg.delay_sec.max(0.0), // 負値は 0 に丸める
                        // 窓は正のときだけ切り詰める（0/負は退化＝切らずに全尺再生＝無音化を避ける）。
                        window_sec: seg.window_sec.filter(|&w| w > 0.0),
                    });
                }
            } else if let Some(n) = narration {
                narrations.push(TimedNarration {
                    wav: n,
                    delay_sec: 0.0,
                    window_sec: None, // 場面単位の単一ナレーションは切り詰めない（従来どおり）
                });
            }
            let clip = resolve_project_file(&app, pid, &v.clip_rel_path)?;
            if !clip.exists() {
                return Err(export_failure(
                    format!("clip not found: {}", clip.display()),
                    format!(
                        "場面{}の動画ファイルが見つかりませんでした。素材を確認してください。",
                        i + 1
                    ),
                ));
            }
            // スロットサイズが 0 だと scale=0:0 で FFmpeg が落ちるため事前に弾く。
            if v.slot_w == 0 || v.slot_h == 0 {
                return Err(export_failure(
                    format!("invalid slot size: {}x{}", v.slot_w, v.slot_h),
                    format!(
                        "場面{}の動画の表示サイズが不正です。テンプレートを確認してください。",
                        i + 1
                    ),
                ));
            }
            // 元音声を使う指定だがクリップに音声が無いと [1:a] 参照が無効になるため、行動を示して弾く（N-2 の防御）。
            if v.use_original_audio && !clip_has_audio(&ffmpeg, &clip)? {
                return Err(export_failure(
                    format!("clip has no audio but use_original_audio: {}", clip.display()),
                    format!(
                        "場面{}の動画には音声が含まれていません。書き出し設定で元の音声を使わないようにして、もう一度お試しください。",
                        i + 1
                    ),
                ));
            }
            // 追加動画レイヤー（#431）：中間層の枚数は「追加動画の本数」と一致する必要がある
            // （総動画数 n=1+追加、中間層 = n−1 = 追加本数）。動画×アニメ（#435 P1）は静止 mid_layers ではなく
            // per-frame の mid_frames_dirs を送るため、どちらか非空の方を実効枚数として検証する。
            let mid_input_count = if v.mid_frames_dirs.is_empty() {
                v.mid_layers.len()
            } else {
                v.mid_frames_dirs.len()
            };
            if mid_input_count != v.video_layers.len() {
                return Err(export_failure(
                    format!(
                        "mid layers ({}) != video_layers ({})",
                        mid_input_count,
                        v.video_layers.len()
                    ),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                ));
            }
            // 追加動画レイヤーのクリップを解決＋検証（先頭動画と同じチェック）。
            let mut extra_videos: Vec<VideoLayerJob> = Vec::new();
            for vl in &v.video_layers {
                let lclip = resolve_project_file(&app, pid, &vl.clip_rel_path)?;
                if !lclip.exists() {
                    return Err(export_failure(
                        format!("layer clip not found: {}", lclip.display()),
                        format!(
                            "場面{}の動画ファイルが見つかりませんでした。素材を確認してください。",
                            i + 1
                        ),
                    ));
                }
                if vl.slot_w == 0 || vl.slot_h == 0 {
                    return Err(export_failure(
                        format!("invalid layer slot size: {}x{}", vl.slot_w, vl.slot_h),
                        format!(
                            "場面{}の動画の表示サイズが不正です。テンプレートを確認してください。",
                            i + 1
                        ),
                    ));
                }
                if vl.use_original_audio && !clip_has_audio(&ffmpeg, &lclip)? {
                    return Err(export_failure(
                        format!("layer clip has no audio but use_original_audio: {}", lclip.display()),
                        format!(
                            "場面{}の動画には音声が含まれていません。書き出し設定で元の音声を使わないようにして、もう一度お試しください。",
                            i + 1
                        ),
                    ));
                }
                extra_videos.push(VideoLayerJob {
                    clip: lclip,
                    slot: (vl.slot_x, vl.slot_y, vl.slot_w, vl.slot_h),
                    fit: parse_fit(&vl.fit),
                    clip_start_sec: vl.clip_start_sec.max(0.0),
                    clip_end_sec: vl.clip_end_sec,
                    use_original_audio: vl.use_original_audio,
                    original_volume: vl.original_volume.unwrap_or(DEFAULT_ORIGINAL_AUDIO_VOLUME),
                    speed: vl
                        .speed
                        .map(|s| s.clamp(SPEED_MIN, SPEED_MAX))
                        .unwrap_or(DEFAULT_SPEED),
                });
            }
            // 中間静止層PNG（透過）を書き出す。
            let mut mid_pngs: Vec<PathBuf> = Vec::new();
            for (m, b64) in v.mid_layers.iter().enumerate() {
                let p = tmp.join(format!("mid_{i:03}_{m:02}.png"));
                decode_b64_to_file(b64, &p, &format!("scene {} mid png {}", i + 1, m + 1))?;
                mid_pngs.push(p);
            }
            // 動画×アニメ（#435）：下/中/上層のステージング済みフレームdir を解決（<stage>/<dir>・先頭フレーム必須）。
            let anim_fps = v.above_frames_fps.unwrap_or(30);
            let resolve_frames = |dir_name: &str| -> Result<PathBuf, String> {
                if !is_safe_stage_name(dir_name) {
                    return Err(export_failure(
                        format!("invalid frames_dir: {dir_name}"),
                        "動画の保存中に問題が発生しました。もう一度お試しください。",
                    ));
                }
                let fdir = export_frames_stage_dir(&app)?.join(dir_name);
                if !fdir.join("frame_00000.png").exists() {
                    return Err(export_failure(
                        format!("staged frames missing: {}", fdir.display()),
                        "動画の保存中に問題が発生しました。もう一度お試しください。",
                    ));
                }
                Ok(fdir)
            };
            let above_frames = match v.above_frames_dir.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Some((resolve_frames(d)?, anim_fps)),
                None => None,
            };
            let below_frames = match v.below_frames_dir.as_deref().filter(|d| !d.is_empty()) {
                Some(d) => Some((resolve_frames(d)?, anim_fps)),
                None => None,
            };
            let mut mid_frames: Vec<(PathBuf, u32)> = Vec::new();
            for d in v.mid_frames_dirs.iter().filter(|d| !d.is_empty()) {
                mid_frames.push((resolve_frames(d)?, anim_fps));
            }
            jobs.push(SceneJob::Video(Box::new(VideoJob {
                below,
                aboves,
                clip,
                narrations,
                extra_videos,
                mid_pngs,
                below_frames,
                mid_frames,
                above_frames,
                slot: (v.slot_x, v.slot_y, v.slot_w, v.slot_h),
                fit: parse_fit(&v.fit),
                clip_start_sec: v.clip_start_sec.max(0.0), // 負値は 0 に丸める

                clip_end_sec: v.clip_end_sec,
                duration_sec: s.duration_sec,
                narration_volume: s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
                original_volume: v.original_volume.unwrap_or(DEFAULT_ORIGINAL_AUDIO_VOLUME),
                use_original_audio: v.use_original_audio,
                speed: v
                    .speed
                    .map(|s| s.clamp(SPEED_MIN, SPEED_MAX))
                    .unwrap_or(DEFAULT_SPEED),
            })));
        } else if let Some(dir_name) = s.frames_dir.as_ref().filter(|d| !d.is_empty()) {
            // アニメ場面（④）：ステージング済みフレームを使う（巨大 base64 を IPC に載せない・#書き出しRangeError）。
            // stage_export_frame が <stage>/<dir_name>/frame_NNNNN.png を書き込み済み。
            if !is_safe_stage_name(dir_name) {
                return Err(export_failure(
                    format!("invalid frames_dir: {dir_name}"),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                ));
            }
            let frames_dir = export_frames_stage_dir(&app)?.join(dir_name);
            let first_frame = frames_dir.join("frame_00000.png");
            if !first_frame.exists() {
                return Err(export_failure(
                    format!("staged frames missing: {}", frames_dir.display()),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                ));
            }
            // 窓 Frames（#442）：クリップ元音声（複数動画スロット対応）があればナレーションと全本 amix
            // （音量は WAV へ焼き込む＝job の narration_volume は 1.0）。無ければ従来どおりナレーションのみ。
            let (audio, narr_vol) = if !s.clip_audios.is_empty() {
                let pid = project_id.as_deref().ok_or_else(|| {
                    export_failure(
                        "clip audio without project_id",
                        "動画を含む書き出しには、先にプロジェクトの保存が必要です。",
                    )
                })?;
                let mut clips: Vec<(PathBuf, &ClipAudioInput)> =
                    Vec::with_capacity(s.clip_audios.len());
                for ca in &s.clip_audios {
                    let clip = resolve_project_file(&app, pid, &ca.clip_rel_path)?;
                    if !clip.exists() {
                        return Err(export_failure(
                            format!("clip audio src missing: {}", clip.display()),
                            "動画が見つかりませんでした。もう一度取り込んでください。",
                        ));
                    }
                    clips.push((clip, ca));
                }
                let nv = s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME);
                let mixed = build_window_audio(&ffmpeg, &tmp, i, &clips, narration.as_deref(), nv)?;
                (Some(mixed), 1.0)
            } else {
                (
                    narration,
                    s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
                )
            };
            jobs.push(SceneJob::Frames(FramesJob {
                frames_dir,
                first_frame,
                audio,
                narration_volume: narr_vol,
                duration_sec: s.duration_sec,
                fps: s.fps.unwrap_or(DEFAULT_FPS),
            }));
        } else if let Some(frames) = s.frames_base64.as_ref().filter(|f| !f.is_empty()) {
            // アニメ場面（④・ADR-0019 per-frame）。フレーム列を frame_00000.png... として書き出し、
            // image2 で1動画セグメントに焼く（1場面=1セグメント＝音声トラック1本を維持）。
            let frames_dir = tmp.join(format!("scene_{i:03}_frames"));
            fs::create_dir_all(&frames_dir).map_err(|e| {
                export_failure(
                    format!("create frames dir: {e}"),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                )
            })?;
            let mut first_frame = PathBuf::new();
            for (f, frame_b64) in frames.iter().enumerate() {
                let frame_path = frames_dir.join(format!("frame_{f:05}.png"));
                decode_b64_to_file(
                    frame_b64,
                    &frame_path,
                    &format!("scene {} frame {}", i + 1, f),
                )?;
                if f == 0 {
                    first_frame = frame_path;
                }
            }
            jobs.push(SceneJob::Frames(FramesJob {
                frames_dir,
                first_frame,
                audio: narration,
                narration_volume: s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
                duration_sec: s.duration_sec,
                fps: s.fps.unwrap_or(DEFAULT_FPS),
            }));
        } else {
            // 静止画シーン（従来）。
            let png = tmp.join(format!("scene_{i:03}.png"));
            decode_b64_to_file(&s.png_base64, &png, &format!("scene {} png", i + 1))?;
            jobs.push(SceneJob::Still(SceneFile {
                png,
                audio: narration,
                narration_volume: s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
                duration_sec: s.duration_sec,
            }));
        }
    }

    // 保存先：ピッカーで選ばれたパスがあればそこへ。無ければ既定 <appData>/exports/<安全名>.mp4。
    let out = match output_path.as_deref().filter(|s| !s.is_empty()) {
        Some(picked) => {
            let mut p = PathBuf::from(picked);
            // 拡張子が mp4 でなければ補う（FFmpeg のフォーマット判定のため）。
            if p.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("mp4"))
                != Some(true)
            {
                p.set_extension("mp4");
            }
            // パストラバーサル防止（ダイアログ経由では起きないが invoke 直呼び対策）。
            if p.components().any(|c| c.as_os_str() == "..") {
                return Err(export_failure(
                    "output_path contains '..': path traversal rejected",
                    "保存先が不正です。保存先を選び直してください。",
                ));
            }
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    export_failure(
                        format!("create out dir: {e}"),
                        "動画の保存先を準備できませんでした。保存先を選び直してください。",
                    )
                })?;
            }
            p
        }
        None => {
            let exports = app
                .path()
                .app_data_dir()
                .map_err(|e| {
                    export_failure(
                        format!("app data dir: {e}"),
                        "動画の保存先を準備できませんでした。もう一度お試しください。",
                    )
                })?
                .join("exports");
            fs::create_dir_all(&exports).map_err(|e| {
                export_failure(
                    format!("create exports dir: {e}"),
                    "動画の保存先を準備できませんでした。もう一度お試しください。",
                )
            })?;
            exports.join(format!("{}.mp4", sanitize_file_name(&file_name)))
        }
    };

    // 場面間トランジション（ADR-0009 T2）。各セグメントの「入り」を JoinInfo に解決（joins[0]＝先頭で未使用）。
    // scene_start は front が付与（#430・掛け合いの間/行は false）。scene_ranges が場面束ねに使う。
    let joins: Vec<JoinInfo> = scenes
        .iter()
        .map(|s| {
            let (xfade, duration_sec, offset_sec) = match &s.transition {
                Some(t) => (validate_xfade_name(&t.name), t.duration_sec, t.offset_sec),
                None => (None, 0.0, 0.0),
            };
            JoinInfo {
                xfade,
                duration_sec,
                offset_sec,
                scene_start: s.scene_start,
            }
        })
        .collect();

    // 出力解像度（先頭場面のPNG＝実出力サイズ）から H.264 目標ビットレートを1回算出（#121・向き非依存）。
    // 場面エンコード・xfade 結合・テロップ overlay（再エンコード）で同じ値を共有する。
    let (out_w, out_h) = jobs
        .first()
        .and_then(|j| match j {
            SceneJob::Still(s) => read_png_size(s.png.as_path()),
            // 下層 PNG はキャンバス全体（出力解像度）をレンダリングしたもの（ADR-0001 A2）。
            SceneJob::Video(v) => read_png_size(v.below.as_path()),
            // アニメ場面の先頭フレーム（キャンバス全体＝出力解像度・ADR-0019）。
            SceneJob::Frames(f) => read_png_size(f.first_frame.as_path()),
        })
        .unwrap_or((DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT));
    let bitrate = bitrate_arg(target_bitrate_bps(out_w, out_h, DEFAULT_FPS));

    // パス構成：場面結合 →（場面ごとBGM 合成・ADR-0018 ③(7)）→ out。中間成果物は tmp。
    // 旧・場面横断タイムラインのテロップ合成は #635 で退役（ADR-0032 決定11/12）＝この段そのものが無くなった。
    let has_bgm = bgm_runs.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
    let normalize = normalize_lufs.map(|target_lufs| NormalizeSpec { target_lufs });
    // ⚠️ **BGM が無くても音を整えるなら音の段を通す**（#259・ADR-0026②）＝BGM の有無で
    // 「音量を整える」が効いたり効かなかったりすると、同じ設定で別の結果になる。
    // 整えるだけのときは `amix=inputs=1`（既存音声だけ）を通る＝映像は `-c:v copy` のまま。
    let needs_audio_pass = has_bgm || normalize.is_some();
    // ⚠️ **利用者の選んだ場所へ直に書かない**（UI/UX レビュー 🔴）＝ffmpeg は出力を**開いた時点で切り詰める**ので、
    // 既にある動画を選んで「上書きしますか→はい」と答えた直後に中止・失敗すると、
    // **前の動画が失われ、開けないファイルだけが残る**（実測＝10,748 バイトの再生できる動画が
    // 262,192 バイトの `moov atom not found` になった）。しかも成功時と同じ名前・拡張子なので、
    // **開くまで気づけない**（§2-5「黙って別の結果にしない」）。
    // → **隣に一時名で書き、成功したときだけ名前を付け替える**。
    let staged = staged_output_path(&out);
    let joined_path = if needs_audio_pass {
        tmp.join("video.mp4")
    } else {
        staged.clone()
    };
    // ⚠️ **書きかけは、どの抜け方でも片づける**（中止・失敗・途中の `?`）＝
    // 残すと、次に同じ場所へ書き出すときに**前回の書きかけ**が隣にいる（利用者から見ると謎のファイル）。
    let _staged_cleanup = StagedCleanup {
        path: staged.clone(),
    };
    let export_start = Instant::now();
    encode_jobs(
        &ffmpeg,
        &jobs,
        &joins,
        codec,
        DEFAULT_FPS,
        &bitrate,
        &tmp,
        &joined_path,
        Some(&app),
    )?;

    // 場面ごとBGM（ADR-0018 ③(7)）：各クリップを一時ファイルへ書き出し、planBgmMix の配置で結合後の動画へ amix。
    // 音を整えるだけ（BGM 無し）のときもここを通る（#259）＝BGM のリストが空になるだけ。
    if needs_audio_pass {
        // ⚠️ **BGM が無いのに「BGMを合わせています」と出さない**（PR #896 レビュー ℹ️）＝
        // 整えるだけのときは別の段として出す（事実と違う進捗を見せない・§2-5）。
        emit_export_progress(Some(&app), if has_bgm { "bgm" } else { "loudness" }, 0, 0);
        let bgm_start = Instant::now();
        let list = bgm_runs.unwrap_or_default();
        // xfade で重なった分だけ実効総尺が縮む（ADR-0009）。-t にこの値を使う。境界は joins[1..] のみ。
        let applied: f64 = joins
            .iter()
            .skip(1)
            .filter_map(|j| j.xfade.as_ref().map(|_| j.duration_sec))
            .sum();
        let total: f64 = jobs.iter().map(|j| j.duration_sec()).sum::<f64>() - applied;
        let mut files: Vec<String> = Vec::with_capacity(list.len());
        for (i, r) in list.iter().enumerate() {
            // パス指定（#512 段2＝動画の元の音）は**そのまま入力にする**。中身を運ばないので、
            // 大きな動画でも文字列にならない。存在しなければ理由つきで断る（黙って無音にしない）。
            if let Some(rel) = r.audio_path.as_deref() {
                // ⚠️ **プロジェクトが判らないなら、その理由で断る**（レビュー 🟡・§2-5）。
                // 空文字で流すと `is_safe_project_id` に落ちて「アプリを再起動して」という
                // **的外れな案内**になる（本当に必要なのは保存）。同ファイルの動画ありシーン・
                // クリップ元音声の2か所と**同じ断り方**に揃える（同じ事情に別の文言を出さない）。
                let pid = project_id.as_deref().ok_or_else(|| {
                    export_failure(
                        "video clip audio without project_id",
                        "動画を含む書き出しには、先にプロジェクトの保存が必要です。",
                    )
                })?;
                let src = resolve_project_file(&app, pid, rel)?;
                if !src.exists() {
                    return Err(export_failure(
                        format!("bgm src missing: {}", src.display()),
                        "動画が見つかりませんでした。もう一度取り込んでください。",
                    ));
                }
                files.push(src.to_string_lossy().into_owned());
                continue;
            }
            let bg_bytes = base64::engine::general_purpose::STANDARD
                .decode(strip_data_url(&r.audio_base64))
                .map_err(|e| {
                    export_failure(
                        format!("bgm decode: {e}"),
                        "BGMを読み取れませんでした。別のファイルでお試しください。",
                    )
                })?;
            let ext = sanitize_file_name(&r.file_ext);
            let bgm_path = tmp.join(format!("bgm_{i:03}.{ext}"));
            fs::write(&bgm_path, bg_bytes).map_err(|e| {
                export_failure(
                    format!("write bgm: {e}"),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                )
            })?;
            files.push(bgm_path.to_string_lossy().into_owned());
        }
        let placed: Vec<BgmRunPlaced> = list
            .iter()
            .zip(files.iter())
            .map(|(r, f)| BgmRunPlaced {
                file: f.as_str(),
                volume: r.volume,
                volume_expr: r.volume_expr.as_deref(),
                delay_sec: r.delay_sec,
                play_sec: r.play_sec,
                fade_in_sec: r.fade_in_sec,
                fade_out_sec: r.fade_out_sec,
                loop_source: r.loop_source,
                source_start_sec: r.source_start_sec,
                speed: r.speed,
            })
            .collect();
        let args = mix_bgm_runs_args(
            &joined_path.to_string_lossy(),
            &placed,
            total,
            normalize,
            &staged.to_string_lossy(),
        );
        run_export(&ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("bgm mix: {e}"),
                "BGMの合成に失敗しました。もう一度お試しください。",
            )
        })?;
        crate::tlog!("export", "bgm mix: {} ms", bgm_start.elapsed().as_millis());
    }
    // 書き出し全体（エンコード＋結合＋字幕＋BGM）の所要時間。代表ケースで Before/After を測るための計測ログ（#376）。
    crate::tlog!(
        "export",
        "total (encode+join+bgm): {} ms / {} scenes",
        export_start.elapsed().as_millis(),
        scenes.len()
    );

    // ⚠️ **ここで初めて利用者の場所へ置く**＝ここまで来たものだけが「開ける動画」。
    // `rename` は同じ場所どうしなので取り違えが起きない（別ドライブへ跨がない）。
    finish_staged_output(&staged, &out)?;

    Ok(ExportReport {
        output_path: out.to_string_lossy().into_owned(),
        codec: codec.encoder().to_string(),
        scene_count: scenes.len(),
    })
}

/// 書きかけを置く場所（利用者の選んだ場所の**隣**）。
///
/// ⚠️ **同じフォルダに置く**＝別の場所（一時フォルダ）だと、最後の付け替えが
/// **ドライブをまたぐコピー**になり、大きな動画で時間がかかるうえ途中で失敗しうる。
fn staged_output_path(out: &Path) -> PathBuf {
    let name = out
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video.mp4".to_string());
    out.with_file_name(format!(".{name}.writing"))
}

/// 書けた動画を利用者の選んだ場所へ置く（**成功したときだけ**呼ぶ）。
fn finish_staged_output(staged: &Path, out: &Path) -> Result<(), String> {
    // 既にあるものは、置き換える直前まで残しておく（ここで初めて消える）。
    if out.exists() {
        fs::remove_file(out).map_err(|e| {
            export_failure(
                format!("remove existing output: {e}"),
                "前からあった動画を置き換えられませんでした。別の名前で保存し直してください。",
            )
        })?;
    }
    fs::rename(staged, out).map_err(|e| {
        export_failure(
            format!("rename staged output: {e}"),
            "動画を保存先へ置けませんでした。空き容量を確かめて、もう一度お試しください。",
        )
    })
}

/// 書きかけの後始末（**どの抜け方でも**片づける）。
///
/// ⚠️ **`?` での早期離脱が多い**ので、片づけを手で書くと**必ずどこかで抜ける**。
/// 置いた場所を持たせて、抜けた時点で消えるようにする。成功したときは
/// `finish_staged_output` が先に名前を付け替えているので、ここでの削除は空振りする。
struct StagedCleanup {
    path: PathBuf,
}

impl Drop for StagedCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 切り出した絵のファイル名の検査（#349・PR #885 レビュー 🟡）。
    ///
    /// ⚠️ **「`assets/` の直下に1つ置く」という約束**を名前の形で守る（パスをまたがせない）。
    #[test]
    fn frame_file_name_rejects_path_pieces() {
        assert!(is_safe_frame_file_name("asset_002.png"));
        assert!(is_safe_frame_file_name("日本語の名前.png"));
        assert!(!is_safe_frame_file_name(""));
        assert!(!is_safe_frame_file_name("a/b.png"));
        assert!(!is_safe_frame_file_name("a\\b.png"));
        assert!(!is_safe_frame_file_name("../x.png"));
        assert!(!is_safe_frame_file_name("a..b.png")); // 「..」を含むものは一律で断る（安全側）
    }

    /// 切り出しの頭出し（#349・PR #885 レビュー 🔴）。
    ///
    /// ⚠️ **`-ss` を `-i` の前だけに置くと、狙った瞬間の絵が出ない**（キーフレームまで飛ぶ）。
    /// ⚠️ **後ろだけだと遅い**（先頭から全部デコードする）。二段に分ける。
    #[test]
    fn frame_seek_splits_into_coarse_and_fine() {
        let s = frame_seek_args(60.0);
        assert_eq!(s.coarse_sec, Some(50.0)); // 手前まで粗く飛ぶ
        assert!((s.fine_sec - 10.0).abs() < 1e-9); // 残りは正確に進む
    }

    #[test]
    fn frame_seek_near_start_does_not_prefix() {
        // 近い時刻は前置きしない（10 秒ぶんのデコードは待たされない）。
        let s = frame_seek_args(3.5);
        assert_eq!(s.coarse_sec, None);
        assert!((s.fine_sec - 3.5).abs() < 1e-9);
    }

    #[test]
    fn frame_seek_at_zero_is_head() {
        let s = frame_seek_args(0.0);
        assert_eq!(s.coarse_sec, None);
        assert_eq!(s.fine_sec, 0.0);
    }

    /// ⚠️ **負の時刻は 0 に寄せる**（FFmpeg が引数として受け付けない）。
    #[test]
    fn frame_seek_clamps_negative() {
        let s = frame_seek_args(-5.0);
        assert_eq!(s.coarse_sec, None);
        assert_eq!(s.fine_sec, 0.0);
    }

    /// 粗い頭出しと端数を足すと、必ず元の時刻になる（絵がずれない条件）。
    #[test]
    fn frame_seek_parts_sum_to_requested_time() {
        for t in [0.0_f64, 1.0, 9.99, 10.0, 10.01, 123.456, 3600.0] {
            let s = frame_seek_args(t);
            let total = s.coarse_sec.unwrap_or(0.0) + s.fine_sec;
            assert!((total - t).abs() < 1e-9, "t={t} total={total}");
        }
    }

    // フレームステージングのディレクトリ名はパストラバーサル防止で英数字と _ のみ許可（#書き出しRangeError）。
    #[test]
    fn stage_name_allows_word_chars_rejects_separators_and_traversal() {
        assert!(is_safe_stage_name("scene_frames_2"));
        assert!(is_safe_stage_name("frame00"));
        assert!(!is_safe_stage_name("")); // 空は不可
        assert!(!is_safe_stage_name("..")); // 親参照
        assert!(!is_safe_stage_name("a/b")); // スラッシュ
        assert!(!is_safe_stage_name("a\\b")); // バックスラッシュ
        assert!(!is_safe_stage_name("a b")); // 空白
        assert!(!is_safe_stage_name("a.b")); // ドット
    }

    // 起動時の一時ディレクトリ掃除（#420）：prefix 一致かつ十分に古いものだけを対象にする（走行中＝新しいものは残す）。
    #[test]
    fn stale_export_dir_only_targets_old_matching_prefixes() {
        let max_age = Duration::from_secs(24 * 60 * 60);
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100 * 24 * 60 * 60); // 任意の現在時刻
        let old = now - Duration::from_secs(25 * 60 * 60); // 25h 前＝しきい値超え
        let fresh = now - Duration::from_secs(60); // 1分前＝走行中相当
                                                   // prefix 一致＋古い＝掃除対象
        assert!(is_stale_export_dir("proc_1234", "proc_", old, now, max_age));
        assert!(is_stale_export_dir(
            "yuko_recruit_export_9",
            "yuko_recruit_export_",
            old,
            now,
            max_age
        ));
        // prefix 一致でも新しい＝対象外（別インスタンスの書き出し中を消さない＝#379 の相互破壊防止）
        assert!(!is_stale_export_dir(
            "proc_1234",
            "proc_",
            fresh,
            now,
            max_age
        ));
        // prefix 不一致＝対象外（無関係なディレクトリを消さない）
        assert!(!is_stale_export_dir(
            "something_else",
            "proc_",
            old,
            now,
            max_age
        ));
        // mtime が未来（時計ずれ）＝安全側で対象外
        let future = now + Duration::from_secs(60 * 60);
        assert!(!is_stale_export_dir(
            "proc_1", "proc_", future, now, max_age
        ));
    }

    // テロップ overlay（ADR-0018）：enable='between' 区間付きの overlay チェーンを組み、音声は無変更コピー。

    #[test]
    fn parse_video_meta_audio_resolution_duration() {
        let stderr = "  Duration: 00:00:05.00, start: 0.000000, bitrate: 3186 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 3106 kb/s, 30 fps\n  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono";
        let m = parse_video_meta(stderr);
        assert_eq!(m.duration_sec, Some(5.0));
        assert!(m.has_audio);
        assert_eq!(m.width, Some(1280));
        assert_eq!(m.height, Some(720));
    }

    #[test]
    fn parse_video_meta_no_audio_minutes() {
        let stderr =
            "Duration: 00:01:30.50, bitrate: 1000 kb/s\n Stream #0:0: Video: hevc, yuv420p, 1920x1080, 30 fps";
        let m = parse_video_meta(stderr);
        assert_eq!(m.duration_sec, Some(90.5));
        assert!(!m.has_audio);
        assert_eq!(m.width, Some(1920));
        assert_eq!(m.height, Some(1080));
    }

    #[test]
    fn parse_video_meta_na_and_missing() {
        let m = parse_video_meta("Duration: N/A, bitrate: N/A");
        assert_eq!(m.duration_sec, None);
        assert!(!m.has_audio);
        assert_eq!(m.width, None);
        assert_eq!(m.height, None);
    }

    #[test]
    fn thumbnail_rel_path_swaps_name() {
        assert_eq!(
            thumbnail_rel_path("assets/asset_005.mp4"),
            "assets/asset_005_thumb.png"
        );
        assert_eq!(thumbnail_rel_path("clip.mov"), "clip_thumb.png");
    }

    #[test]
    fn parse_resolution_rejects_codec_tags_and_handles_missing() {
        // コーデックタグ 0x.. / ストリーム番号 [0x1] を拾わず解像度のみ採用。
        let line =
            "  Stream #0:0[0x1]: Video: h264 (avc1 / 0x31637661), yuv420p, 640x360, 100 kb/s";
        assert_eq!(parse_resolution(line), (Some(640), Some(360)));
        // Video 行が無ければ (None, None)。
        assert_eq!(
            parse_resolution("Duration: 00:00:01.0\n Audio: aac"),
            (None, None)
        );
    }

    #[test]
    fn pick_codec_prefers_mediafoundation_then_openh264_then_x264() {
        // h264_mf（Media Foundation）が主経路で最優先（libx264 と併存しても MF を選ぶ）。
        assert_eq!(
            pick_codec("V..... h264_mf ... V..... libx264"),
            Some(VideoCodec::MediaFoundation)
        );
        // h264_mf が無ければ OpenH264 → libx264 の順（既存挙動）。
        assert_eq!(
            pick_codec("V..... libopenh264 ... V..... libx264"),
            Some(VideoCodec::OpenH264)
        );
        assert_eq!(pick_codec("V..... libx264 only"), Some(VideoCodec::X264));
        assert_eq!(pick_codec("no h264 here"), None);
    }

    #[test]
    fn pick_codec_prefers_mediafoundation_over_libopenh264_in_btbn_lgpl() {
        // 配布版 BtbN win64-lgpl-shared（n8.1.2）の実 -encoders 抜粋。libopenh264 と h264_mf が併存し
        // libx264/libx265 は無い。通常経路では必ず h264_mf を選ぶ（libopenh264 は選ばない＝#119）。
        let btbn_lgpl_encoders = " V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)\n V....D h264_mf              H264 via MediaFoundation (codec h264)";
        assert_eq!(
            pick_codec(btbn_lgpl_encoders),
            Some(VideoCodec::MediaFoundation)
        );
    }

    #[test]
    fn h264_capability_maps_encoders_to_ui_states() {
        // h264_mf あり＝標準方式（主経路）。
        assert_eq!(
            h264_capability(" V..... h264_mf  H264 via MediaFoundation"),
            "mediaFoundation"
        );
        // h264_mf 無し・OpenH264／libx264 あり＝予備方式（書き出しは可能）。
        assert_eq!(h264_capability(" V..... libopenh264  OpenH264"), "fallback");
        assert_eq!(h264_capability(" V..... libx264  x264"), "fallback");
        // H.264 エンコーダ皆無＝書き出し不可。
        assert_eq!(h264_capability("no h264 encoders here"), "unavailable");
    }

    #[test]
    fn quality_args_sets_bitrate_for_mediafoundation_only() {
        // MF だけ目標ビットレートを付与（x264/OpenH264 は無指定）。値は呼び出し側が算出して渡す。
        assert_eq!(
            VideoCodec::MediaFoundation.quality_args("12000k"),
            vec!["-b:v".to_string(), "12000k".to_string()]
        );
        assert!(VideoCodec::X264.quality_args("12000k").is_empty());
        assert!(VideoCodec::OpenH264.quality_args("12000k").is_empty());
        // scene_clip_args は -c:v h264_mf の直後に -b:v <bitrate> を置く。
        let a = scene_clip_args(
            "f.png",
            None,
            1.0,
            "out.mp4",
            3.0,
            30,
            VideoCodec::MediaFoundation,
            "12000k",
        );
        let i = a
            .iter()
            .position(|s| s == "h264_mf")
            .expect("encoder present");
        assert_eq!(a[i + 1], "-b:v");
        assert_eq!(a[i + 2], "12000k");
        // video_scene_args も MF で -c:v h264_mf の直後に -b:v <bitrate>。
        let v = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::MediaFoundation,
            bitrate: "12000k",
            out: "out.mp4",
        });
        let vi = v
            .iter()
            .position(|s| s == "h264_mf")
            .expect("encoder present");
        assert_eq!(v[vi + 1], "-b:v");
        assert_eq!(v[vi + 2], "12000k");
        // xfade_chain_args も MF で -b:v <bitrate>。
        let files = vec!["a.mp4".to_string(), "b.mp4".to_string()];
        let steps = vec![JoinStep {
            xfade: Some("fade"),
            duration_sec: 0.5,
            offset_sec: 1.5,
        }];
        let xf = xfade_chain_args(
            &files,
            &steps,
            "out.mp4",
            VideoCodec::MediaFoundation,
            30,
            "12000k",
        );
        let xi = xf
            .iter()
            .position(|s| s == "h264_mf")
            .expect("encoder present");
        assert_eq!(xf[xi + 1], "-b:v");
        assert_eq!(xf[xi + 2], "12000k");
        // x264 は -b:v を付けない（bitrate を渡しても無視）。
        let x = scene_clip_args(
            "f.png",
            None,
            1.0,
            "out.mp4",
            3.0,
            30,
            VideoCodec::X264,
            "12000k",
        );
        assert!(!x.iter().any(|s| s == "-b:v"));
    }

    #[test]
    fn target_bitrate_is_pixel_based_and_orientation_agnostic() {
        let land = target_bitrate_bps(1920, 1080, 30);
        let port = target_bitrate_bps(1080, 1920, 30);
        assert_eq!(land, port); // 総画素が同じ＝同ビットレート（向き非依存）
        assert!(
            (11_000_000..=12_500_000).contains(&land),
            "1080p30 ≈ 12M, got {land}"
        );
        let hd = target_bitrate_bps(1280, 720, 30);
        assert!(
            (4_500_000..=6_500_000).contains(&hd),
            "720p30 ≈ 5–6M, got {hd}"
        );
    }

    #[test]
    fn target_bitrate_clamps_small_and_large() {
        assert_eq!(target_bitrate_bps(320, 180, 30), 3_000_000); // 下限
        assert_eq!(target_bitrate_bps(3840, 2160, 60), 16_000_000); // 上限
        assert_eq!(target_bitrate_bps(1920, 1080, 0), BITRATE_MIN_BPS); // fps=0 → clamp下限
        assert_eq!(bitrate_arg(5_253_120), "5253k");
    }

    fn png_head(w: u32, h: u32) -> Vec<u8> {
        let mut head = vec![0u8; 24];
        head[0..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        head[12..16].copy_from_slice(b"IHDR");
        head[16..20].copy_from_slice(&w.to_be_bytes());
        head[20..24].copy_from_slice(&h.to_be_bytes());
        head
    }

    #[test]
    fn parse_png_size_reads_valid_ihdr() {
        assert_eq!(parse_png_size(&png_head(1080, 1920)), Some((1080, 1920)));
        assert_eq!(parse_png_size(&png_head(1920, 1080)), Some((1920, 1080)));
    }

    #[test]
    fn parse_png_size_rejects_bad_input() {
        assert_eq!(parse_png_size(&[0u8; 24]), None); // 非PNG署名
        assert_eq!(parse_png_size(b"\x89PNG\r\n\x1a\n"), None); // 24バイト未満
        let mut not_ihdr = png_head(100, 100);
        not_ihdr[12..16].copy_from_slice(b"sRGB"); // IHDR 以外のチャンク
        assert_eq!(parse_png_size(&not_ihdr), None);
        assert_eq!(parse_png_size(&png_head(0, 0)), None); // ゼロ寸法
    }

    #[test]
    fn scene_clip_args_with_audio_applies_volume_and_maps_filtered_track() {
        let a = scene_clip_args(
            "in.png",
            Some("v.wav"),
            1.0,
            "out.mp4",
            8.0,
            30,
            VideoCodec::X264,
            "12000k",
        );
        assert!(a.iter().any(|s| s == "libx264"));
        assert!(a.iter().any(|s| s == "yuv420p"));
        assert!(a.iter().any(|s| s == "aac"));
        assert!(a.iter().any(|s| s.contains("volume=1")));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[a]"));
    }

    #[test]
    fn scene_clip_args_without_audio_adds_silence_track() {
        let o = scene_clip_args(
            "in.png",
            None,
            1.0,
            "out.mp4",
            8.0,
            30,
            VideoCodec::OpenH264,
            "12000k",
        );
        assert!(o.iter().any(|s| s == "libopenh264"));
        assert!(o.iter().any(|s| s.contains("anullsrc")));
        assert!(o.iter().any(|s| s == "aac"));
        assert!(o.windows(2).any(|w| w[0] == "-map" && w[1] == "1:a"));
    }

    #[test]
    fn frames_scene_args_uses_image2_input_and_shares_av_tail() {
        // アニメ場面（④）：image2（-framerate + start_number + %05d パターン）で入力し、
        // 音声・コーデック・尺クランプは scene_clip_args と同一（append_scene_av_tail 共有）。
        let a = frames_scene_args(
            "frames/frame_%05d.png",
            Some("v.wav"),
            0.8,
            "out.mp4",
            4.0,
            30,
            VideoCodec::X264,
            "12000k",
        );
        // image2 入力パターン（-loop は使わない）。
        assert!(a.windows(2).any(|w| w[0] == "-framerate" && w[1] == "30"));
        assert!(a.windows(2).any(|w| w[0] == "-start_number" && w[1] == "0"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-i" && w[1] == "frames/frame_%05d.png"));
        assert!(!a.iter().any(|s| s == "-loop"));
        // #376：フレームは「変化する区間」だけ焼き、最終フレームを tpad で尺まで保持。
        // 映像は filter_complex 経由（[0:v]tpad...[v]）＝map は [v]、音声フィルタと同一 filter_complex に連結。
        let fc = a
            .iter()
            .find(|s| s.contains("tpad"))
            .expect("video filter_complex with tpad");
        assert!(fc.contains("[0:v]tpad=stop_mode=clone:stop_duration=4"));
        assert!(fc.contains("[1:a]volume=0.8,apad[a]")); // 音声節も同じ filter_complex に
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        // 共有末尾（音声 volume・エンコード・尺クランプ）。
        assert!(a.iter().any(|s| s == "libx264"));
        assert!(a.iter().any(|s| s == "yuv420p"));
        assert!(a.iter().any(|s| s == "aac"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[a]"));
        // 出力は尺ぴったりに切る（-t 4）。
        assert!(a.windows(2).any(|w| w[0] == "-t" && w[1] == "4"));
    }

    #[test]
    fn frames_scene_args_without_audio_adds_silence_track() {
        let o = frames_scene_args(
            "frames/frame_%05d.png",
            None,
            1.0,
            "out.mp4",
            4.0,
            30,
            VideoCodec::OpenH264,
            "12000k",
        );
        assert!(o.iter().any(|s| s == "libopenh264"));
        assert!(o.iter().any(|s| s.contains("anullsrc")));
        assert!(o.windows(2).any(|w| w[0] == "-map" && w[1] == "1:a"));
        // 無音経路でも映像は tpad で最終フレームを尺まで保持し [v] を map（#376）。
        assert!(o
            .iter()
            .any(|s| s.contains("[0:v]tpad=stop_mode=clone:stop_duration=4[v]")));
        assert!(o.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
    }

    // #376：少数フレーム＋tpad で「尺いっぱいまで最終フレームを保持」できるか実FFmpegで検証。
    // FFMPEG_PATH 未設定ならスキップ。
    #[test]
    fn frames_scene_args_tpad_holds_last_frame_to_full_duration() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_frames_tpad_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        // フレームは5枚だけ（≈0.167秒ぶん）。tpad が無ければ出力は ~0.167s にしかならない。
        for f in 0..5 {
            let p = tmp.join(format!("frame_{f:05}.png"));
            run(
                &ffmpeg,
                &[
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "color=c=teal:s=160x120".into(),
                    "-frames:v".into(),
                    "1".into(),
                    p.to_string_lossy().into_owned(),
                ],
            )
            .expect("frame png");
        }
        let pattern = tmp.join("frame_%05d.png");
        let out = tmp.join("held.mp4");
        // 尺 2.0 秒を要求。フレームは5枚だけ＝tpad で最終フレームを 2 秒まで複製保持する。
        let args = frames_scene_args(
            &pattern.to_string_lossy(),
            None,
            1.0,
            &out.to_string_lossy(),
            2.0,
            30,
            codec,
            "12000k",
        );
        run(&ffmpeg, &args).expect("frames tpad encode");
        // 検証は「映像ストリームのフレーム数」で行う。コンテナ尺は無音トラック(-t 2)が支配してしまい
        // tpad の有無を区別できない（映像が0.17秒でも音声2秒で Duration=2 になる）。
        let ffprobe = ffmpeg.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        if !ffprobe.exists() {
            return; // ffprobe 同梱が無い環境ではスキップ（本番は bin に同梱）。
        }
        let probe = run(
            &ffprobe,
            &[
                "-v".into(),
                "error".into(),
                "-count_frames".into(),
                "-select_streams".into(),
                "v:0".into(),
                "-show_entries".into(),
                "stream=nb_read_frames".into(),
                "-of".into(),
                "csv=p=0".into(),
                out.to_string_lossy().into_owned(),
            ],
        )
        .expect("ffprobe frames");
        let frames: u32 = probe.trim().parse().expect("frame count");
        // 2.0s × 30fps ≈ 60 フレーム（tpad 保持）。tpad 無しなら入力5フレームのみ＝この閾値で明確に区別。
        assert!(
            frames >= 55,
            "expected ~60 video frames (tpad hold), got {frames}"
        );
    }

    #[test]
    fn concat_args_copies_streams() {
        let a = concat_args("list.txt", "out.mp4");
        assert!(a.iter().any(|s| s == "concat"));
        assert!(a.windows(2).any(|w| w[0] == "-c" && w[1] == "copy"));
    }

    #[test]
    fn scene_ranges_groups_segments_by_scene_start() {
        // #430：scene_start で論理的な場面へ束ねる。掛け合いは1場面が複数セグメント（間/行）に展開される。
        let j = |scene_start: bool| JoinInfo {
            xfade: None,
            duration_sec: 0.0,
            offset_sec: 0.0,
            scene_start,
        };
        // 場面0＝[0,3)（先頭+間+行など3セグメント）／場面1＝[3,4)（単一）／場面2＝[4,6)。
        let joins = vec![j(true), j(false), j(false), j(true), j(true), j(false)];
        assert_eq!(scene_ranges(&joins), vec![(0, 3), (3, 4), (4, 6)]);
        // 先頭は scene_start に依らず場面開始（防御）。
        assert_eq!(scene_ranges(&[j(false), j(false)]), vec![(0, 2)]);
        // 空・単一。
        assert_eq!(scene_ranges(&[]), Vec::<(usize, usize)>::new());
        assert_eq!(scene_ranges(&[j(true)]), vec![(0, 1)]);
    }

    #[test]
    fn validate_xfade_name_allowlist() {
        // 許可名はそのまま、"none"/未知名はハードカット（None）。
        assert_eq!(validate_xfade_name("fade").as_deref(), Some("fade"));
        assert_eq!(validate_xfade_name("slideup").as_deref(), Some("slideup"));
        assert_eq!(
            validate_xfade_name("slideleft").as_deref(),
            Some("slideleft")
        );
        assert_eq!(validate_xfade_name("none"), None);
        assert_eq!(validate_xfade_name(""), None);
        assert_eq!(validate_xfade_name("wipe"), None); // MVP 外
    }

    #[test]
    fn xfade_chain_args_two_scenes_fade() {
        let files = vec!["a.mp4".to_string(), "b.mp4".to_string()];
        let steps = vec![JoinStep {
            xfade: Some("fade"),
            duration_sec: 0.5,
            offset_sec: 7.5,
        }];
        let a = xfade_chain_args(
            &files,
            &steps,
            "out.mp4",
            VideoCodec::OpenH264,
            30,
            "12000k",
        );
        // 2入力。
        assert_eq!(a.iter().filter(|s| *s == "-i").count(), 2);
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        let graph = &a[fc + 1];
        // 全入力を settb=AVTB/asettb=AVTB で正規化（concat→xfade 境界の timebase 不一致対策）。
        assert!(graph.contains("[0:v]settb=AVTB[nv0]"));
        assert!(graph.contains("[1:v]settb=AVTB[nv1]"));
        assert!(graph.contains("[0:a]asettb=AVTB[na0]"));
        // 映像 xfade（offset=累積−D=7.5）と音声 acrossfade（同じ D）。入力は正規化済みラベル。
        assert!(graph.contains("[nv0][nv1]xfade=transition=fade:duration=0.5:offset=7.5[v1]"));
        assert!(graph.contains("[na0][na1]acrossfade=d=0.5[a1]"));
        // 最終ラベルを map。
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v1]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[a1]"));
        // 再エンコード（copy ではない）。
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-c:v" && w[1] == VideoCodec::OpenH264.encoder()));
        assert!(!a.windows(2).any(|w| w[0] == "-c" && w[1] == "copy"));
    }

    #[test]
    fn xfade_chain_args_slide_direction_maps_to_name() {
        let files = vec!["a.mp4".to_string(), "b.mp4".to_string()];
        let steps = vec![JoinStep {
            xfade: Some("slideup"),
            duration_sec: 0.4,
            offset_sec: 3.6,
        }];
        let a = xfade_chain_args(&files, &steps, "out.mp4", VideoCodec::X264, 30, "12000k");
        assert!(
            a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1]
                .contains("xfade=transition=slideup:duration=0.4:offset=3.6")
        );
    }

    #[test]
    fn xfade_chain_args_none_boundary_uses_concat_filter() {
        let files = vec!["a.mp4".to_string(), "b.mp4".to_string()];
        let steps = vec![JoinStep {
            xfade: None,
            duration_sec: 0.0,
            offset_sec: 0.0,
        }];
        let a = xfade_chain_args(
            &files,
            &steps,
            "out.mp4",
            VideoCodec::OpenH264,
            30,
            "12000k",
        );
        let graph = &a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1];
        // ハードカット＝concat フィルタ（映像/音声）。入力は正規化済みラベル。xfade は含まない。
        assert!(graph.contains("[nv0][nv1]concat=n=2:v=1:a=0[v1]"));
        assert!(graph.contains("[na0][na1]concat=n=2:v=0:a=1[a1]"));
        assert!(!graph.contains("xfade"));
    }

    #[test]
    fn xfade_chain_args_mixed_three_scenes() {
        let files = vec![
            "a.mp4".to_string(),
            "b.mp4".to_string(),
            "c.mp4".to_string(),
        ];
        // 境界1=fade、境界2=none（ハードカット）。
        let steps = vec![
            JoinStep {
                xfade: Some("fade"),
                duration_sec: 0.5,
                offset_sec: 7.5,
            },
            JoinStep {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
            },
        ];
        let a = xfade_chain_args(
            &files,
            &steps,
            "out.mp4",
            VideoCodec::OpenH264,
            30,
            "12000k",
        );
        assert_eq!(a.iter().filter(|s| *s == "-i").count(), 3);
        let graph = &a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("[nv0][nv1]xfade=transition=fade:duration=0.5:offset=7.5[v1]"));
        assert!(graph.contains("[v1][nv2]concat=n=2:v=1:a=0[v2]"));
        assert!(graph.contains("[a1][na2]concat=n=2:v=0:a=1[a2]"));
        // 最終ラベルは v2/a2。
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v2]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[a2]"));
    }

    #[test]
    fn xfade_chain_args_cut_then_fade_normalizes_timebase() {
        // 「ハードカット(concat)→クロスフェード(xfade)」の並び（実運用で顕在化した回帰の最小再現）。
        // concat 出力は tb=1/1000000、生場面は 1/15360。正規化しないと後続 xfade が
        // "timebase do not match" (-22) で失敗する。settb/asettb=AVTB で全入力を揃えて回避する。
        let files = vec![
            "a.mp4".to_string(),
            "b.mp4".to_string(),
            "c.mp4".to_string(),
        ];
        // 境界1=none（ハードカット）、境界2=fade。
        let steps = vec![
            JoinStep {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
            },
            JoinStep {
                xfade: Some("fade"),
                duration_sec: 0.5,
                offset_sec: 4.5,
            },
        ];
        let a = xfade_chain_args(
            &files,
            &steps,
            "out.mp4",
            VideoCodec::OpenH264,
            30,
            "12000k",
        );
        let graph = &a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1];
        // 全入力が settb/asettb=AVTB で正規化されている。
        for k in 0..3 {
            assert!(graph.contains(&format!("[{k}:v]settb=AVTB[nv{k}]")));
            assert!(graph.contains(&format!("[{k}:a]asettb=AVTB[na{k}]")));
        }
        // 境界1=concat（正規化入力）→ v1、境界2=xfade は「concat 出力 v1」と「正規化入力 nv2」を取る。
        // これで xfade の2入力タイムベースが一致（両者 AVTB）＝-22 を回避する要。
        assert!(graph.contains("[nv0][nv1]concat=n=2:v=1:a=0[v1]"));
        assert!(graph.contains("[v1][nv2]xfade=transition=fade:duration=0.5:offset=4.5[v2]"));
    }

    // 実 FFmpeg で xfade チェーンが MP4 を生成できるか（FFMPEG_PATH 未設定ならスキップ）。
    #[test]
    fn xfade_chain_args_produces_output_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_xfade_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        // 単純な場面MP4（映像＋AAC無音・各2秒）を3本。
        // 3本 [none, fade]＝「ハードカット(concat)→クロスフェード(xfade)」で実運用の回帰を再現する。
        let mut files = Vec::new();
        for (i, color) in ["red", "green", "blue"].iter().enumerate() {
            let f = tmp.join(format!("s{i}.mp4"));
            run(
                &ffmpeg,
                &[
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!("color=c={color}:s=320x240:rate=30:duration=2"),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "anullsrc=channel_layout=stereo:sample_rate=44100".into(),
                    "-shortest".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-c:v".into(),
                    codec.encoder().into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-t".into(),
                    "2".into(),
                    f.to_string_lossy().into_owned(),
                ],
            )
            .expect("scene mp4");
            files.push(f.to_string_lossy().into_owned());
        }
        let out = tmp.join("xf.mp4");
        // 境界1=none（ハードカット・concat 出力 tb=1/1000000）、境界2=fade。
        // 正規化が無いと後続 xfade で「timebase do not match」(-22) になる並び。
        // fade offset = concat 済み前2本(4s) − D(0.5) = 3.5。
        let steps = vec![
            JoinStep {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
            },
            JoinStep {
                xfade: Some("fade"),
                duration_sec: 0.5,
                offset_sec: 3.5,
            },
        ];
        let args = xfade_chain_args(&files, &steps, &out.to_string_lossy(), codec, 30, "12000k");
        run(&ffmpeg, &args).expect("xfade join");
        assert!(fs::metadata(&out).expect("xf.mp4 exists").len() > 0);
    }

    #[test]
    fn narration_mix_filter_primary_plus_one_window() {
        // 同時開始（ADR-0031）：primary＋同時行1本（window=8・delay=0）。primary は anull passthrough、
        // 同時行は atrim で窓に切り詰め（delay 無しゆえ adelay 無し）、amix inputs=2・duration=longest。
        let segs = vec![NarrationSegmentInput {
            audio_base64: String::new(),
            delay_sec: 0.0,
            window_sec: Some(8.0),
        }];
        assert_eq!(
            narration_mix_filter(true, &segs),
            "[0:a]anull[n0];[1:a]atrim=0:8,asetpts=N/SR/TB[p0];[n0][p0]amix=inputs=2:duration=longest:normalize=0[a]"
        );
    }

    #[test]
    fn narration_mix_filter_no_primary_delay_and_window() {
        // primary 無し＋2本：1本目は delay=1.5s→adelay=1500（window 無し）、2本目は window=3（delay 0）。amix inputs=2。
        let segs = vec![
            NarrationSegmentInput {
                audio_base64: String::new(),
                delay_sec: 1.5,
                window_sec: None,
            },
            NarrationSegmentInput {
                audio_base64: String::new(),
                delay_sec: 0.0,
                window_sec: Some(3.0),
            },
        ];
        assert_eq!(
            narration_mix_filter(false, &segs),
            "[0:a]adelay=1500:all=1[p0];[1:a]atrim=0:3,asetpts=N/SR/TB[p1];[p0][p1]amix=inputs=2:duration=longest:normalize=0[a]"
        );
    }

    #[test]
    fn narration_mix_filter_primary_only_passthrough() {
        // 同時行が空（primary だけ）＝anull passthrough を1本 amix（inputs=1・ラベル整形のみ）。
        assert_eq!(
            narration_mix_filter(true, &[]),
            "[0:a]anull[n0];[n0]amix=inputs=1:duration=longest:normalize=0[a]"
        );
    }

    #[test]
    fn mix_bgm_runs_args_single_run_loops_volume_fade_amix() {
        // 単一区間（全場面が継承する従来ケース相当）：ループ・音量・フェード（out 開始 = play 10 − 2 = 8）・amix(inputs=2)。
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.25,
            volume_expr: None,
            delay_sec: 0.0,
            play_sec: 10.0,
            fade_in_sec: 1.0,
            fade_out_sec: 2.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, None, "out.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-stream_loop" && w[1] == "-1"));
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        assert_eq!(
            a[fc + 1],
            "[1:a]atrim=0:10,asetpts=N/SR/TB,volume=0.25,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2[bg0];[0:a][bg0]amix=inputs=2:duration=first:normalize=0[a]"
        );
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy")); // 映像は再エンコードしない
    }

    /// 読み上げ（タイムライン形式の音声クリップ・#631）は繰り返さない＝素材が短くても言葉が二重に鳴らない。
    /// 既定（BGM）はループのままで、区別は入力の loop_source だけで決まる。
    /// 音を整える（#259）＝**混ぜたあとに1回だけ通す**。順番が逆だと個々の音量・フェードを
    /// 測ってしまい、`alimiter` が先だと整えた結果の 0dBFS 超えを止められない。
    #[test]
    fn mix_bgm_runs_args_normalize_appends_loudnorm_after_mix() {
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.5,
            volume_expr: None,
            delay_sec: 0.0,
            play_sec: 10.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args(
            "v.mp4",
            &runs,
            10.0,
            Some(NormalizeSpec { target_lufs: -16.0 }),
            "out.mp4",
        );
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        assert_eq!(
            a[fc + 1],
            "[1:a]atrim=0:10,asetpts=N/SR/TB,volume=0.5[bg0];[0:a][bg0]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95[a]"
        );
    }

    /// ⚠️ **BGM が無くても整える**（ADR-0026②＝BGM の有無で挙動を割らない）。
    /// 既存の音声だけを `amix=inputs=1` で通し、そのあとに整える段を足す。
    #[test]
    fn mix_bgm_runs_args_normalize_without_bgm() {
        let a = mix_bgm_runs_args(
            "v.mp4",
            &[],
            10.0,
            Some(NormalizeSpec { target_lufs: -20.0 }),
            "out.mp4",
        );
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        assert_eq!(
            a[fc + 1],
            "[0:a]amix=inputs=1:duration=first:normalize=0[mixed];[mixed]loudnorm=I=-20:TP=-1.5:LRA=11,alimiter=limit=0.95[a]"
        );
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy")); // 映像は再エンコードしない
    }

    #[test]
    fn mix_bgm_runs_args_no_loop_for_voice() {
        let runs = [BgmRunPlaced {
            file: "voice.wav",
            volume: 1.0,
            volume_expr: None,
            delay_sec: 2.0,
            play_sec: 3.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            loop_source: false,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, None, "out.mp4");
        assert!(!a.iter().any(|s| s == "-stream_loop")); // 繰り返さない
        assert!(a.windows(2).any(|w| w[0] == "-i" && w[1] == "voice.wav")); // 入力自体は載る
    }

    #[test]
    fn mix_bgm_runs_args_trims_and_speeds_source() {
        // タイムライン形式のトリム＋速度（#631）：素材の 4.0 秒から、出力 3 秒ぶんを2倍速で。
        // 素材側で読む長さは 3×2=6 秒＝atrim=4:10。フェードは出力側の秒数（atempo の後）で見る。
        let runs = [BgmRunPlaced {
            file: "clip.wav",
            volume: 1.0,
            volume_expr: None,
            delay_sec: 0.0,
            play_sec: 3.0,
            fade_in_sec: 0.0,
            fade_out_sec: 1.0,
            loop_source: false,
            source_start_sec: 4.0,
            speed: 2.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, None, "out.mp4");
        let fc = a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1].clone();
        assert!(fc.contains("atrim=4:10"), "{fc}");
        assert!(fc.contains("asetpts=N/SR/TB,atempo=2,volume=1"), "{fc}");
        assert!(fc.contains("afade=t=out:st=2:d=1"), "{fc}"); // 出力 3 秒の末尾 1 秒
    }

    /// 音量の変化（#512 段3）：front が組んだ式をそのまま `volume` へ差し込む（毎フレーム評価）。
    /// 一定値の `volume=` は出さない＝2つの音量が重ね掛けにならない。フェードは従来どおり式の上に掛かる。
    #[test]
    fn mix_bgm_runs_args_uses_volume_expression_when_given() {
        let expr = "if(lt(t,0),0.2,if(lt(t,4),0.2+(1-0.2)*(t-0)/4,1))";
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.25,
            volume_expr: Some(expr),
            delay_sec: 0.0,
            play_sec: 8.0,
            fade_in_sec: 1.0,
            fade_out_sec: 0.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 8.0, None, "out.mp4");
        let fc = a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1].clone();
        // 式は `'…'` で囲む（中の `,` を区切りと読ませない）＋ eval=frame（付けないと一定音量に化ける）。
        assert!(fc.contains(&format!("volume='{expr}':eval=frame")), "{fc}");
        assert!(!fc.contains("volume=0.25"), "{fc}"); // 一定値は出さない
        assert!(fc.contains("afade=t=in:st=0:d=1"), "{fc}"); // フェードは式の上に掛かる
    }

    /// 式が空（点が無いのと同じ意味）のときは一定値へ落とす＝`volume=''` のような壊れた引数を作らない。
    #[test]
    fn mix_bgm_runs_args_empty_expression_falls_back_to_constant_volume() {
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.25,
            volume_expr: Some("  "),
            delay_sec: 0.0,
            play_sec: 8.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 8.0, None, "out.mp4");
        let fc = a[a.iter().position(|s| s == "-filter_complex").unwrap() + 1].clone();
        assert!(fc.contains("volume=0.25"), "{fc}");
        assert!(!fc.contains("eval=frame"), "{fc}");
    }

    #[test]
    fn atempo_chain_splits_out_of_range_speed_without_rounding() {
        // 1段で受けられる範囲はそのまま。範囲外は掛け算で分ける＝速度を丸めない（ADR-0026①）。
        assert_eq!(atempo_chain(1.0), "");
        assert_eq!(atempo_chain(1.5), "atempo=1.5,");
        assert_eq!(atempo_chain(4.0), "atempo=2,atempo=2,");
        assert_eq!(atempo_chain(0.25), "atempo=0.5,atempo=0.5,");
        // 分けたあとの積は元の速度に戻る（丸めていない）。
        for speed in [0.1, 0.3, 3.0, 5.0, 8.0] {
            let product: f64 = atempo_chain(speed)
                .trim_end_matches(',')
                .split(',')
                .map(|s| s.trim_start_matches("atempo=").parse::<f64>().unwrap())
                .product();
            assert!((product - speed).abs() < 1e-9, "{speed} => {product}");
        }
    }

    #[test]
    fn mix_bgm_runs_args_crossfade_places_two_runs_with_adelay() {
        // 曲が変わる2区間：2本目は adelay で配置。入力は video+2曲、amix inputs=3。
        let runs = [
            BgmRunPlaced {
                file: "a.mp3",
                volume: 0.25,
                volume_expr: None,
                delay_sec: 0.0,
                play_sec: 8.5,
                fade_in_sec: 1.5,
                fade_out_sec: 1.0,
                loop_source: true,
                source_start_sec: 0.0,
                speed: 1.0,
            },
            BgmRunPlaced {
                file: "b.mp3",
                volume: 0.3,
                volume_expr: None,
                delay_sec: 7.5,
                play_sec: 6.5,
                fade_in_sec: 1.0,
                fade_out_sec: 2.0,
                loop_source: true,
                source_start_sec: 0.0,
                speed: 1.0,
            },
        ];
        let a = mix_bgm_runs_args("v.mp4", &runs, 14.0, None, "out.mp4");
        assert_eq!(a.iter().filter(|s| *s == "-i").count(), 3); // video + 2曲
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        let f = &a[fc + 1];
        // 先頭曲は delay 0 ゆえ adelay なし。2本目は adelay=7500。amix は video+2曲。
        assert!(f.contains("[1:a]atrim=0:8.5,asetpts=N/SR/TB,volume=0.25,afade=t=in:st=0:d=1.5,afade=t=out:st=7.5:d=1[bg0]"));
        assert!(f.contains("[2:a]atrim=0:6.5,asetpts=N/SR/TB,volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=4.5:d=2,adelay=7500|7500[bg1]"));
        assert!(f.contains("[0:a][bg0][bg1]amix=inputs=3:duration=first:normalize=0[a]"));
    }

    #[test]
    fn mix_bgm_runs_args_omits_afade_and_adelay_when_zero() {
        // フェード秒=0（既定）は afade を、delay=0 は adelay を出さない（いずれも FFmpeg が 0 を拒否/不要）。
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.25,
            volume_expr: None,
            delay_sec: 0.0,
            play_sec: 10.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, None, "out.mp4");
        assert!(!a.iter().any(|s| s.contains("afade")));
        assert!(!a.iter().any(|s| s.contains("adelay")));
        assert!(a
            .iter()
            .any(|s| s.contains("amix=inputs=2:duration=first:normalize=0")));
    }

    #[test]
    fn strip_data_url_handles_both() {
        assert_eq!(strip_data_url("data:image/png;base64,AAAA"), "AAAA");
        assert_eq!(strip_data_url("AAAA"), "AAAA");
    }

    #[test]
    fn sanitize_file_name_strips_separators_and_defaults() {
        assert_eq!(sanitize_file_name("会社紹介_2026春"), "会社紹介_2026春");
        assert_eq!(sanitize_file_name("a/b\\c:d*?"), "a_b_c_d__");
        assert_eq!(sanitize_file_name("   "), "export");
    }

    // 実FFmpegが要るE2E結合テスト。FFMPEG_PATH 未設定ならスキップ（CIを失敗させない）。
    #[test]
    fn encode_scenes_makes_mp4_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_export_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // 音声つき場面の検証用に短い WAV を1本作る。
        let voice = tmp.join("voice.wav");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                "1".into(),
                "-i".into(),
                "sine=frequency=440:sample_rate=44100".into(),
                voice.to_string_lossy().into_owned(),
            ],
        )
        .expect("generate test wav");

        let mut scenes = Vec::new();
        for (i, color) in ["red", "blue"].iter().enumerate() {
            let png = tmp.join(format!("src_{i}.png"));
            let gen = vec![
                "-y".to_string(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!("color=c={color}:s=320x180"),
                "-frames:v".into(),
                "1".into(),
                png.to_string_lossy().into_owned(),
            ];
            run(&ffmpeg, &gen).expect("generate test png");
            scenes.push(SceneJob::Still(SceneFile {
                png,
                // 場面0は音声つき、場面1は無音。混在クリップの concat copy を検証する。
                audio: if i == 0 { Some(voice.clone()) } else { None },
                narration_volume: 1.0,
                duration_sec: 1.0,
            }));
        }
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        let out = tmp.join("final.mp4");
        let joins: Vec<JoinInfo> = scenes
            .iter()
            .map(|_| JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: true,
            })
            .collect();
        encode_jobs(
            &ffmpeg, &scenes, &joins, codec, 30, "12000k", &tmp, &out, None,
        )
        .expect("encode_jobs");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }

    // #430 のE2E：掛け合い場面（複数セグメント）＋入場遷移。場面A=2セグメント（間/行相当）を先に連結し、
    // 場面B（入場 fade）と per-scene xfade する経路が実FFmpegで通ることを検証。FFMPEG_PATH 未設定ならスキップ。
    #[test]
    fn encode_jobs_groups_multi_segment_scene_before_xfade() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_export_unittest_scene_group");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let mut jobs = Vec::new();
        for (i, color) in ["red", "green", "blue"].iter().enumerate() {
            let png = tmp.join(format!("src_{i}.png"));
            run(
                &ffmpeg,
                &[
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!("color=c={color}:s=320x180"),
                    "-frames:v".into(),
                    "1".into(),
                    png.to_string_lossy().into_owned(),
                ],
            )
            .expect("generate png");
            jobs.push(SceneJob::Still(SceneFile {
                png,
                audio: None,
                narration_volume: 1.0,
                duration_sec: 1.0,
            }));
        }
        // scene_start=[T,F,T]：seg0/seg1 が場面A（連結して2s）、seg2 が場面B。場面B の入場に fade。
        // 場面A 尺=2s ゆえ per-scene offset = 2 − 0.5 = 1.5（front の transitionTimeline 相当）。
        let joins = vec![
            JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: true,
            },
            JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: false,
            },
            JoinInfo {
                xfade: Some("fade".into()),
                duration_sec: 0.5,
                offset_sec: 1.5,
                scene_start: true,
            },
        ];
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        let out = tmp.join("final.mp4");
        encode_jobs(
            &ffmpeg, &jobs, &joins, codec, 30, "12000k", &tmp, &out, None,
        )
        .expect("encode_jobs scene group");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
        // 場面A の内部セグメントが連結クリップ（scene_group_000.mp4）に束ねられた。
        assert!(
            tmp.join("scene_group_000.mp4").exists(),
            "場面Aの連結クリップが作られていない"
        );
    }

    // BGM 合成のE2E（amix/afade/stream_loop のフィルタグラフが実FFmpegで通るか）。FFMPEG_PATH 未設定ならスキップ。
    #[test]
    fn mix_bgm_produces_output_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_bgm_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // 1場面の動画（無音トラック付き）を作る。
        let png = tmp.join("src.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=green:s=320x180".into(),
                "-frames:v".into(),
                "1".into(),
                png.to_string_lossy().into_owned(),
            ],
        )
        .expect("generate png");
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");
        let video = tmp.join("video.mp4");
        encode_jobs(
            &ffmpeg,
            &[SceneJob::Still(SceneFile {
                png,
                audio: None,
                narration_volume: 1.0,
                duration_sec: 2.0,
            })],
            &[JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: true,
            }],
            codec,
            30,
            "12000k",
            &tmp,
            &video,
            None,
        )
        .expect("encode video");

        // 動画より長い BGM を作り、ループ・フェード・音量つきで合成する。
        let bgm = tmp.join("bgm.wav");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                "3".into(),
                "-i".into(),
                "sine=frequency=220:sample_rate=44100".into(),
                bgm.to_string_lossy().into_owned(),
            ],
        )
        .expect("generate bgm");
        let out = tmp.join("final.mp4");
        // 既定のフェード無し（0.0）で実行し、afade=d=0/adelay=0 を省いて落ちない（バグ#1回帰）ことを確認する。
        let bgm_str = bgm.to_string_lossy();
        let runs = [BgmRunPlaced {
            file: &bgm_str,
            volume: 0.25,
            volume_expr: None,
            delay_sec: 0.0,
            play_sec: 2.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            loop_source: true,
            source_start_sec: 0.0,
            speed: 1.0,
        }];
        let args = mix_bgm_runs_args(
            &video.to_string_lossy(),
            &runs,
            2.0,
            None,
            &out.to_string_lossy(),
        );
        run(&ffmpeg, &args).expect("bgm mix");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }

    #[test]
    fn video_scene_args_overlays_clip_and_mixes_audio() {
        let narr = "n.wav".to_string();
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "below.png",
            clip: "clip.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "above.png",
                window: None,
            }],
            narrations: &[NarrationArg {
                wav: &narr,
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 80,
            slot_y: 140,
            slot_w: 1040,
            slot_h: 800,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 8.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "out.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        assert!(fc.contains("force_original_aspect_ratio=increase")); // cover
        assert!(fc.contains("overlay=80:140")); // スロット配置
        assert!(fc.contains("[bg1][2:v]overlay=0:0[vout]")); // 上PNGを前面へ
        assert!(fc.contains("[3:a]volume=1")); // ナレーション
        assert!(fc.contains("[1:a]volume=0.2")); // 元動画音声
        assert!(fc.contains("amix=inputs=2"));
        assert!(!fc.contains("setpts")); // 等速(speed=1.0)なら setpts は不要
        assert!(!fc.contains("atempo")); // 等速なら atempo は不要
        assert!(args.windows(2).any(|w| w[0] == "-map" && w[1] == "[vout]"));
        assert!(args.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
        assert!(args.iter().any(|s| s == "libx264"));
    }

    #[test]
    fn video_scene_args_clip_end_trims_to_segment() {
        // clip_start=1, clip_end=3, dur=5 → クリップは min(3-1,5)=2 秒に切り出す。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 1.0,
            clip_end_sec: Some(3.0),
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let pos = args.iter().position(|s| s == "-ss").expect("-ss");
        assert_eq!(args[pos + 1], "1"); // clip_start
        assert_eq!(args[pos + 3], "2"); // clip_t = min(end-start, dur)
    }

    #[test]
    fn video_scene_args_speed_applies_setpts_and_atempo() {
        // speed=2: 映像は setpts=PTS/2、元音声は atempo=2。クリップ読取尺は dur*speed=10。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 2.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        assert!(fc.contains("setpts=PTS/2")); // 映像を2倍速
        assert!(fc.contains("atempo=2")); // 元音声を2倍速（ピッチ維持）
        let pos = args.iter().position(|s| s == "-ss").expect("-ss");
        assert_eq!(args[pos + 3], "10"); // clip_t = dur*speed
    }

    #[test]
    fn video_scene_args_clip_end_with_speed_caps_source_seconds() {
        // clip_end が主要制限: start=0,end=3,dur=5,speed=2 → clip_t = min(3, dur*speed=10) = 3。
        let a1 = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: Some(3.0),
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 2.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let p1 = a1.iter().position(|s| s == "-ss").expect("-ss");
        assert_eq!(a1[p1 + 3], "3");

        // dur*speed が主要制限: end=12,dur=5,speed=2 → clip_t = min(12, 10) = 10。
        let a2 = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: Some(12.0),
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 2.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let p2 = a2.iter().position(|s| s == "-ss").expect("-ss");
        assert_eq!(a2[p2 + 3], "10");
    }

    #[test]
    fn video_scene_args_uses_silence_without_audio() {
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Contain,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::OpenH264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        assert!(fc.contains("anullsrc")); // 音声無しは無音トラック
        assert!(!fc.contains("[3:a]")); // ナレーション入力なし
        assert!(fc.contains("force_original_aspect_ratio=decrease")); // contain
    }

    #[test]
    fn video_scene_args_dialogue_above_windows_and_delayed_narrations() {
        // 掛け合い×動画：上PNGを行区間 [0,4)/[4,8) で切替え、行ナレーションを 0秒/4秒 に配置する。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[
                AbovePngArg {
                    png: "a0.png",
                    window: Some((0.0, 4.0)),
                },
                AbovePngArg {
                    png: "a1.png",
                    window: Some((4.0, 8.0)),
                },
            ],
            narrations: &[
                NarrationArg {
                    wav: "l0.wav",
                    delay_sec: 0.0,
                    window_sec: Some(4.0),
                },
                NarrationArg {
                    wav: "l1.wav",
                    delay_sec: 4.0,
                    window_sec: Some(4.0),
                },
            ],
            slot_x: 80,
            slot_y: 140,
            slot_w: 1040,
            slot_h: 800,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 8.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // 上PNG は行区間の enable 窓（半開区間・テロップと同じ eof_action=repeat 方式）で順に前面へ。
        assert!(
            fc.contains("[bg1][2:v]overlay=0:0:eof_action=repeat:enable='gte(t,0)*lt(t,4)'[bg2]")
        );
        assert!(
            fc.contains("[bg2][3:v]overlay=0:0:eof_action=repeat:enable='gte(t,4)*lt(t,8)'[vout]")
        );
        // 行ナレーション：各行を窓（4秒）で atrim 切り詰め＝前の行が次の行に重ならない（#385）。
        // 2本目は adelay=4000ms で配置し、amix で1トラックへ。
        assert!(fc.contains("[4:a]atrim=0:4,asetpts=N/SR/TB,volume=1[n0]"));
        assert!(fc.contains("[5:a]atrim=0:4,asetpts=N/SR/TB,volume=1,adelay=4000:all=1[n1]"));
        assert!(fc.contains("[n0][n1]amix=inputs=2:duration=longest:normalize=0,apad[aout]"));
        // 行区間つき上PNG は単一フレーム入力（-loop は below の1回だけ）。
        assert_eq!(args.iter().filter(|s| *s == "-loop").count(), 1);
        // 入力は below/clip/上PNG×2/ナレーション×2 の6本。
        assert_eq!(args.iter().filter(|s| *s == "-i").count(), 6);
    }

    #[test]
    fn video_scene_args_dialogue_with_original_audio_mixes_all() {
        // 掛け合い×動画×元音声：行ナレーション2本＋元音声を amix=inputs=3 で混ぜる。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[
                AbovePngArg {
                    png: "a0.png",
                    window: Some((0.0, 2.0)),
                },
                AbovePngArg {
                    png: "a1.png",
                    window: Some((2.0, 5.0)),
                },
            ],
            narrations: &[
                NarrationArg {
                    wav: "l0.wav",
                    delay_sec: 0.0,
                    window_sec: Some(2.0),
                },
                NarrationArg {
                    wav: "l1.wav",
                    delay_sec: 2.0,
                    window_sec: Some(3.0),
                },
            ],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 0.8,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // 各行を窓（2秒/3秒）で atrim 切り詰め（#385）。元音声は切り詰めず amix=inputs=3。
        assert!(fc.contains("[4:a]atrim=0:2,asetpts=N/SR/TB,volume=0.8[n0]"));
        assert!(fc.contains("[5:a]atrim=0:3,asetpts=N/SR/TB,volume=0.8,adelay=2000:all=1[n1]"));
        // #431：元音声ラベルは動画レイヤー index つき（先頭動画＝orig0）。amix は narrations→origs 順。
        assert!(fc.contains("[1:a]volume=0.2[orig0]"));
        assert!(fc.contains("[n0][n1][orig0]amix=inputs=3:duration=longest:normalize=0,apad[aout]"));
    }

    #[test]
    fn video_scene_args_two_videos_overlays_in_zindex_order() {
        // #431：2動画（先頭＋extra 1本）＋中間静止層1枚。overlay は下→clip0@slot0→mid0→clip1@slot1→above。
        let extra = [VideoLayerArg {
            clip: "clip2.mp4",
            slot_x: 200,
            slot_y: 100,
            slot_w: 400,
            slot_h: 300,
            fit: Fit::Contain,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            use_original_audio: false,
            original_volume: 0.2,
            speed: 1.0,
        }];
        let mid = ["mid0.png"];
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "below.png",
            clip: "clip1.mp4",
            extra_videos: &extra,
            mid_pngs: &mid,
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "above.png",
                window: None,
            }],
            narrations: &[NarrationArg {
                wav: "n.wav",
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 80,
            slot_y: 140,
            slot_w: 1040,
            slot_h: 800,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 8.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "out.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // 2本のクリップをそれぞれスケール（先頭=input1→[clip0]、extra=input2→[clip1]）。
        assert!(fc.contains("[1:v]") && fc.contains("[clip0]"));
        assert!(fc.contains("[2:v]") && fc.contains("[clip1]"));
        // overlay 連鎖（zIndex 下→上）: below→clip0@(80,140)→mid0(input3)→clip1@(200,100)→above(input4)。
        assert!(fc.contains("[0:v][clip0]overlay=80:140[bg1]"));
        assert!(fc.contains("[bg1][3:v]overlay=0:0[bg2]")); // mid0＝入力 1+n=3
        assert!(fc.contains("[bg2][clip1]overlay=200:100[bg3]"));
        assert!(fc.contains("[bg3][4:v]overlay=0:0[vout]")); // above＝入力 1+n+mid=4
                                                             // 入力本数: below/clip0/clip1/mid0/above/narration = 6本。
        assert_eq!(args.iter().filter(|s| *s == "-i").count(), 6);
    }

    #[test]
    fn video_scene_args_two_videos_mix_both_original_audios() {
        // #431：2動画とも元音声ありは両方 amix（narrations 無し・orig0=先頭input1, orig1=extra input2）。
        let extra = [VideoLayerArg {
            clip: "c2.mp4",
            slot_x: 0,
            slot_y: 0,
            slot_w: 100,
            slot_h: 100,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            use_original_audio: true,
            original_volume: 0.3,
            speed: 1.0,
        }];
        let mid = ["m.png"];
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c1.mp4",
            extra_videos: &extra,
            mid_pngs: &mid,
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[],
            slot_x: 0,
            slot_y: 0,
            slot_w: 100,
            slot_h: 100,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        assert!(fc.contains("[1:a]volume=0.2[orig0]"));
        assert!(fc.contains("[2:a]volume=0.3[orig1]"));
        assert!(fc.contains("[orig0][orig1]amix=inputs=2:duration=longest:normalize=0,apad[aout]"));
    }

    #[test]
    fn video_scene_args_above_frames_uses_image2_sequence() {
        // #435：動画×アニメ（非掛け合い）は最上層を image2 シーケンスで overlay（eof_action=repeat で最終フレーム保持）。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "below.png",
            clip: "clip.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            aboves: &[], // above_frames=Some のとき aboves は使わない
            below_frames: None,
            mid_frames: &[],
            above_frames: Some(AboveFramesArg {
                pattern: "abv/frame_%05d.png",
                fps: 30,
            }),
            narrations: &[NarrationArg {
                wav: "n.wav",
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 80,
            slot_y: 140,
            slot_w: 1040,
            slot_h: 800,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 8.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "out.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // below(0)→clip0(1)→above image2(2)。最上 overlay は eof_action=repeat（enable 無し＝前景アニメを尺まで保持）。
        assert!(fc.contains("[0:v][clip0]overlay=80:140[bg1]"));
        assert!(fc.contains("[bg1][2:v]overlay=0:0:eof_action=repeat[vout]"));
        // image2 入力（-framerate 30 -i abv/frame_%05d.png）。静止 -loop は below のみ（above はループしない）。
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-framerate" && w[1] == "30"));
        assert!(args.iter().any(|s| s == "abv/frame_%05d.png"));
        assert_eq!(args.iter().filter(|s| *s == "-loop").count(), 1); // below のみ loop
                                                                      // narration は above image2（1本）の後＝入力 index 3。
        assert!(fc.contains("[3:a]volume=1,apad[aout]"));
    }

    #[test]
    fn resolve_above_source_prioritizes_frames_then_segments_then_png() {
        // #435 の decode 順序バグ回帰防止：above_frames_dir があれば静止 above が空でも Frames（エラーにしない）。
        assert_eq!(
            resolve_above_source(true, false, false),
            Some(AboveSource::Frames)
        );
        assert_eq!(
            resolve_above_source(true, true, true),
            Some(AboveSource::Frames) // frames を最優先（静止 aboves と相互排他）
        );
        assert_eq!(
            resolve_above_source(false, true, false),
            Some(AboveSource::Segments)
        );
        assert_eq!(
            resolve_above_source(false, false, true),
            Some(AboveSource::SinglePng)
        );
        assert_eq!(
            resolve_above_source(false, true, true),
            Some(AboveSource::Segments) // segments を single png より優先（従来）
        );
        assert_eq!(resolve_above_source(false, false, false), None); // すべて空＝エラー
    }

    #[test]
    fn video_scene_args_all_static_layers_per_frame_for_animation() {
        // #435 P1：動画×アニメは下/中/上の静止層すべてを image2 で焼く（below=tpad base, mid/above=eof_repeat overlay）。
        let extra = [VideoLayerArg {
            clip: "c2.mp4",
            slot_x: 0,
            slot_y: 0,
            slot_w: 100,
            slot_h: 100,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            use_original_audio: false,
            original_volume: 0.2,
            speed: 1.0,
        }];
        let mid_f = [AboveFramesArg {
            pattern: "mid0/frame_%05d.png",
            fps: 30,
        }];
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "below.png", // below_frames=Some のとき使わない
            clip: "clip1.mp4",
            extra_videos: &extra,
            mid_pngs: &[], // mid_frames を使う
            aboves: &[],
            below_frames: Some(AboveFramesArg {
                pattern: "bel/frame_%05d.png",
                fps: 30,
            }),
            mid_frames: &mid_f,
            above_frames: Some(AboveFramesArg {
                pattern: "abv/frame_%05d.png",
                fps: 30,
            }),
            narrations: &[],
            slot_x: 80,
            slot_y: 140,
            slot_w: 1040,
            slot_h: 800,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 8.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "out.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // below は tpad で最終フレーム保持してから base に。
        assert!(fc.contains("[0:v]tpad=stop_mode=clone:stop_duration=8[below0]"));
        assert!(fc.contains("[below0][clip0]overlay=80:140[bg1]"));
        // mid（input 3）は eof_action=repeat。extra 動画（clip1）@(0,0)。above（input 4）も eof_action=repeat で最前面。
        assert!(fc.contains("[bg1][3:v]overlay=0:0:eof_action=repeat[bg2]"));
        assert!(fc.contains("[bg2][clip1]overlay=0:0[bg3]"));
        assert!(fc.contains("[bg3][4:v]overlay=0:0:eof_action=repeat[vout]"));
        // 静止 -loop は無し（below/mid/above すべて image2）。
        assert_eq!(args.iter().filter(|s| *s == "-loop").count(), 0);
        assert!(args.iter().any(|s| s == "bel/frame_%05d.png"));
        assert!(args.iter().any(|s| s == "mid0/frame_%05d.png"));
        assert!(args.iter().any(|s| s == "abv/frame_%05d.png"));
    }

    #[test]
    fn video_scene_input_deserializes_animated_frontend_shape() {
        // #435 P1 回帰防止：per-frame 経路は belowPngBase64/midLayers を送らず belowFramesDir/midFramesDirs を送る。
        // Rust が frontend 形の JSON を弾かず decode でき（serde default）、中間層の実効枚数が videoLayers と一致すること。
        let json = r#"{
            "belowFramesDir": "scene_vbelow_0",
            "midFramesDirs": ["scene_vmid_0_0"],
            "aboveFramesDir": "scene_vabove_0",
            "aboveFramesFps": 30,
            "clipRelPath": "assets/v.mp4",
            "slotX": 0, "slotY": 0, "slotW": 100, "slotH": 100,
            "fit": "cover",
            "videoLayers": [
                { "clipRelPath": "assets/v2.mp4", "slotX": 200, "slotY": 100, "slotW": 400, "slotH": 300, "fit": "contain" }
            ]
        }"#;
        let v: VideoSceneInput =
            serde_json::from_str(json).expect("frontend-shaped animated video input should decode");
        // belowPngBase64/midLayers/abovePngBase64 は省略＝空（#[serde(default)]）。
        assert!(v.below_png_base64.is_empty());
        assert!(v.mid_layers.is_empty());
        assert_eq!(v.below_frames_dir.as_deref(), Some("scene_vbelow_0"));
        assert_eq!(v.above_frames_dir.as_deref(), Some("scene_vabove_0"));
        assert_eq!(v.mid_frames_dirs, vec!["scene_vmid_0_0".to_string()]);
        // 中間層の実効枚数（per-frame は mid_frames_dirs）＝videoLayers と一致（P1 の枚数チェックが通る）。
        let mid_input_count = if v.mid_frames_dirs.is_empty() {
            v.mid_layers.len()
        } else {
            v.mid_frames_dirs.len()
        };
        assert_eq!(mid_input_count, v.video_layers.len());
    }

    #[test]
    fn video_scene_args_single_narration_keeps_legacy_filter() {
        // 単一ナレーション（delay 0）は従来と同一のフィルタ文字列（後方互換＝既存場面の出力不変）。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: "a.png",
                window: None,
            }],
            narrations: &[NarrationArg {
                wav: "n.wav",
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 0,
            slot_y: 0,
            slot_w: 640,
            slot_h: 360,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 5.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec: VideoCodec::X264,
            bitrate: "12000k",
            out: "o.mp4",
        });
        let fc = args
            .iter()
            .find(|s| s.contains("overlay"))
            .expect("filter_complex");
        // 映像・音声とも従来文字列（enable/adelay/amix/atrim を含まない＝window None は切り詰めない）。
        assert!(fc.contains("[bg1][2:v]overlay=0:0[vout]"));
        assert!(fc.contains("[3:a]volume=1,apad[aout]"));
        assert!(!fc.contains("enable="));
        assert!(!fc.contains("adelay"));
        assert!(!fc.contains("amix"));
        assert!(!fc.contains("atrim")); // 単一ナレーションは窓なし＝切り詰めない（#385・後方互換）
    }

    #[test]
    fn fit_filter_cover_scales_and_crops() {
        let f = fit_filter(Fit::Cover, 320, 180);
        assert!(f.contains("force_original_aspect_ratio=increase"));
        assert!(f.contains("crop=320:180"));
    }

    #[test]
    fn fit_filter_contain_pads_centered() {
        let f = fit_filter(Fit::Contain, 320, 180);
        assert!(f.contains("force_original_aspect_ratio=decrease"));
        assert!(f.contains("pad=320:180:(ow-iw)/2:(oh-ih)/2"));
    }

    #[test]
    fn fit_filter_stretch_scales_only() {
        assert_eq!(fit_filter(Fit::Stretch, 320, 180), "scale=320:180,setsar=1");
    }

    // 動画スロット合成のE2E（overlay＋amix のフィルタグラフが実FFmpegで通るか）。FFMPEG_PATH 未設定ならスキップ。
    #[test]
    fn video_scene_produces_output_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_overlay_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");

        // 下PNG(不透明) / 上PNG(透過)
        let below = tmp.join("below.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=navy:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                below.to_string_lossy().into_owned(),
            ],
        )
        .expect("below png");
        let above = tmp.join("above.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=black@0.0:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                "-pix_fmt".into(),
                "rgba".into(),
                above.to_string_lossy().into_owned(),
            ],
        )
        .expect("above png");
        // クリップ（映像＋元音声）
        let clip = tmp.join("clip.mp4");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=320x240:rate=30:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=330:duration=3".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:v".into(),
                codec.encoder().into(),
                "-c:a".into(),
                "aac".into(),
                "-shortest".into(),
                clip.to_string_lossy().into_owned(),
            ],
        )
        .expect("clip");
        // ナレーション
        let narr = tmp.join("narr.wav");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                "2".into(),
                "-i".into(),
                "sine=frequency=660:sample_rate=44100".into(),
                narr.to_string_lossy().into_owned(),
            ],
        )
        .expect("narration");

        let below_s = below.to_string_lossy().into_owned();
        let above_s = above.to_string_lossy().into_owned();
        let clip_s = clip.to_string_lossy().into_owned();
        let narr_s = narr.to_string_lossy().into_owned();
        let out = tmp.join("scene.mp4");
        let out_s = out.to_string_lossy().into_owned();
        let args = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: &above_s,
                window: None,
            }],
            narrations: &[NarrationArg {
                wav: &narr_s,
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out_s,
        });
        run(&ffmpeg, &args).expect("video_scene overlay");
        assert!(fs::metadata(&out).expect("scene.mp4 exists").len() > 0);

        // (narration None, use_original_audio false) ＝ 無音 anullsrc 経路も実FFmpegで検証。
        let out2 = tmp.join("scene_silent.mp4");
        let out2_s = out2.to_string_lossy().into_owned();
        let args2 = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: &above_s,
                window: None,
            }],
            narrations: &[],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Contain,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out2_s,
        });
        run(&ffmpeg, &args2).expect("video_scene silent overlay");
        assert!(fs::metadata(&out2).expect("scene_silent.mp4 exists").len() > 0);

        // 掛け合い×動画：行区間つき上PNG（enable 窓）＋行ナレーション（adelay 配置）も実FFmpegで検証。
        let out3 = tmp.join("scene_dialogue.mp4");
        let out3_s = out3.to_string_lossy().into_owned();
        let args3 = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[],
            mid_pngs: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[
                AbovePngArg {
                    png: &above_s,
                    window: Some((0.0, 1.0)),
                },
                AbovePngArg {
                    png: &above_s,
                    window: Some((1.0, 2.0)),
                },
            ],
            narrations: &[
                NarrationArg {
                    wav: &narr_s,
                    delay_sec: 0.0,
                    window_sec: Some(1.0),
                },
                NarrationArg {
                    wav: &narr_s,
                    delay_sec: 1.0,
                    window_sec: Some(1.0),
                },
            ],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out3_s,
        });
        run(&ffmpeg, &args3).expect("video_scene dialogue overlay");
        assert!(
            fs::metadata(&out3)
                .expect("scene_dialogue.mp4 exists")
                .len()
                > 0
        );

        // #431：2動画＋中間静止層の一般合成も実FFmpegで検証（interleaved overlay ＋ narration+2元音声の amix）。
        let mid = tmp.join("mid.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=black@0.0:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                "-pix_fmt".into(),
                "rgba".into(),
                mid.to_string_lossy().into_owned(),
            ],
        )
        .expect("mid png");
        let mid_s = mid.to_string_lossy().into_owned();
        let out4 = tmp.join("scene_multi.mp4");
        let out4_s = out4.to_string_lossy().into_owned();
        let args4 = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[VideoLayerArg {
                clip: &clip_s,
                slot_x: 320,
                slot_y: 30,
                slot_w: 240,
                slot_h: 180,
                fit: Fit::Contain,
                clip_start_sec: 0.0,
                clip_end_sec: None,
                use_original_audio: true,
                original_volume: 0.3,
                speed: 1.0,
            }],
            mid_pngs: &[&mid_s],
            below_frames: None,
            mid_frames: &[],
            above_frames: None,
            aboves: &[AbovePngArg {
                png: &above_s,
                window: None,
            }],
            narrations: &[NarrationArg {
                wav: &narr_s,
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out4_s,
        });
        run(&ffmpeg, &args4).expect("video_scene multi-video overlay");
        assert!(fs::metadata(&out4).expect("scene_multi.mp4 exists").len() > 0);

        // #435：動画×アニメ（最上層を image2 シーケンスで overlay）も実FFmpegで検証。透過フレーム3枚を焼いて渡す。
        let afdir = tmp.join("above_frames");
        fs::create_dir_all(&afdir).unwrap();
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=white@0.0:s=640x360".into(),
                "-frames:v".into(),
                "3".into(),
                "-start_number".into(),
                "0".into(),
                "-pix_fmt".into(),
                "rgba".into(),
                afdir.join("frame_%05d.png").to_string_lossy().into_owned(),
            ],
        )
        .expect("above frames");
        let afpat = afdir.join("frame_%05d.png").to_string_lossy().into_owned();
        let out5 = tmp.join("scene_anim.mp4");
        let out5_s = out5.to_string_lossy().into_owned();
        let args5 = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[],
            mid_pngs: &[],
            aboves: &[],
            below_frames: None,
            mid_frames: &[],
            above_frames: Some(AboveFramesArg {
                pattern: &afpat,
                fps: 30,
            }),
            narrations: &[NarrationArg {
                wav: &narr_s,
                delay_sec: 0.0,
                window_sec: None,
            }],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out5_s,
        });
        run(&ffmpeg, &args5).expect("video_scene above-frames overlay");
        assert!(fs::metadata(&out5).expect("scene_anim.mp4 exists").len() > 0);

        // #435 P1：下層も image2（below_frames）＝tpad で base に持ち上げてから overlay も実FFmpegで検証。
        let bfdir = tmp.join("below_frames");
        fs::create_dir_all(&bfdir).unwrap();
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=navy:s=640x360".into(),
                "-frames:v".into(),
                "3".into(),
                "-start_number".into(),
                "0".into(),
                bfdir.join("frame_%05d.png").to_string_lossy().into_owned(),
            ],
        )
        .expect("below frames");
        let bfpat = bfdir.join("frame_%05d.png").to_string_lossy().into_owned();
        let out6 = tmp.join("scene_anim_below.mp4");
        let out6_s = out6.to_string_lossy().into_owned();
        let args6 = video_scene_args(&VideoSceneArgs {
            below_png: &below_s,
            clip: &clip_s,
            extra_videos: &[],
            mid_pngs: &[],
            aboves: &[],
            below_frames: Some(AboveFramesArg {
                pattern: &bfpat,
                fps: 30,
            }),
            mid_frames: &[],
            above_frames: Some(AboveFramesArg {
                pattern: &afpat,
                fps: 30,
            }),
            narrations: &[],
            slot_x: 40,
            slot_y: 30,
            slot_w: 240,
            slot_h: 180,
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: false,
            speed: 1.0,
            fps: 30,
            codec,
            bitrate: "12000k",
            out: &out6_s,
        });
        run(&ffmpeg, &args6).expect("video_scene below+above frames overlay");
        assert!(
            fs::metadata(&out6)
                .expect("scene_anim_below.mp4 exists")
                .len()
                > 0
        );
    }

    // encode_jobs の Video アーム連結E2E（SceneJob::Video → video_scene_args → run → concat）。
    #[test]
    fn encode_jobs_video_scene_produces_output_when_ffmpeg_available() {
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_encode_jobs_video_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");

        let below = tmp.join("below.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=navy:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                below.to_string_lossy().into_owned(),
            ],
        )
        .expect("below png");
        let above = tmp.join("above.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=black@0.0:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                "-pix_fmt".into(),
                "rgba".into(),
                above.to_string_lossy().into_owned(),
            ],
        )
        .expect("above png");
        let clip = tmp.join("clip.mp4");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=320x240:rate=30:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=330:duration=3".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:v".into(),
                codec.encoder().into(),
                "-c:a".into(),
                "aac".into(),
                "-shortest".into(),
                clip.to_string_lossy().into_owned(),
            ],
        )
        .expect("clip");
        let narr = tmp.join("narr.wav");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                "2".into(),
                "-i".into(),
                "sine=frequency=660:sample_rate=44100".into(),
                narr.to_string_lossy().into_owned(),
            ],
        )
        .expect("narration");

        let out = tmp.join("final.mp4");
        let jobs = vec![SceneJob::Video(Box::new(VideoJob {
            below,
            aboves: vec![TimedAbove {
                png: above,
                window: None,
            }],
            clip,
            narrations: vec![TimedNarration {
                wav: narr,
                delay_sec: 0.0,
                window_sec: None,
            }],
            extra_videos: vec![],
            mid_pngs: vec![],
            below_frames: None,
            mid_frames: vec![],
            above_frames: None,
            slot: (40, 30, 240, 180),
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
        }))];
        let joins: Vec<JoinInfo> = jobs
            .iter()
            .map(|_| JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: true,
            })
            .collect();
        encode_jobs(
            &ffmpeg, &jobs, &joins, codec, 30, "12000k", &tmp, &out, None,
        )
        .expect("encode_jobs video");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }

    #[test]
    fn encode_jobs_frames_then_video_scene_group_concats_when_ffmpeg_available() {
        // #442：動画スロット本体アニメの1場面は「窓(Frames セグメント)＋settled(Video セグメント)」の2ジョブに
        // 分かれ、同一場面として -c copy 連結される。Frames-MP4 と Video-MP4 が同一エンコード設定
        //（append_scene_av_tail 共有）で concat 互換であることを実FFmpegで検証する（連結が非互換なら concat が
        // 失敗し encode_jobs が Err→panic）。
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_encode_jobs_frames_video_group");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).unwrap();
        let codec = pick_codec(&encoders).expect("an h264 encoder");

        // 窓セグメント＝フレーム列（frame_00000.png ...）。0.5s×30fps を image2 で生成。
        let frames_dir = tmp.join("winframes");
        fs::create_dir_all(&frames_dir).unwrap();
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=teal:s=640x360:rate=30:duration=0.5".into(),
                "-start_number".into(),
                "0".into(),
                frames_dir
                    .join("frame_%05d.png")
                    .to_string_lossy()
                    .into_owned(),
            ],
        )
        .expect("window frames");
        let first_frame = frames_dir.join("frame_00000.png");
        assert!(first_frame.exists(), "window frames not generated");

        // settled セグメント＝Video（実クリップ・最終位置）。既存 Video E2E と同じ素材の作り方。
        let below = tmp.join("below.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=navy:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                below.to_string_lossy().into_owned(),
            ],
        )
        .expect("below png");
        let above = tmp.join("above.png");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=black@0.0:s=640x360".into(),
                "-frames:v".into(),
                "1".into(),
                "-pix_fmt".into(),
                "rgba".into(),
                above.to_string_lossy().into_owned(),
            ],
        )
        .expect("above png");
        let clip = tmp.join("clip.mp4");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=320x240:rate=30:duration=3".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:v".into(),
                codec.encoder().into(),
                clip.to_string_lossy().into_owned(),
            ],
        )
        .expect("clip");

        // jobs=[Frames(窓・0.5s), Video(settled・1.5s)]。joins=[start=true, start=false]＝同一場面（遷移なし＝全体 concat）。
        let jobs = vec![
            SceneJob::Frames(FramesJob {
                frames_dir: frames_dir.clone(),
                first_frame,
                audio: None,
                narration_volume: 1.0,
                duration_sec: 0.5,
                fps: 30,
            }),
            SceneJob::Video(Box::new(VideoJob {
                below,
                aboves: vec![TimedAbove {
                    png: above,
                    window: None,
                }],
                clip,
                narrations: vec![],
                extra_videos: vec![],
                mid_pngs: vec![],
                below_frames: None,
                mid_frames: vec![],
                above_frames: None,
                slot: (40, 30, 240, 180),
                fit: Fit::Cover,
                clip_start_sec: 0.0,
                clip_end_sec: None,
                duration_sec: 1.5,
                narration_volume: 1.0,
                original_volume: 0.2,
                use_original_audio: false,
                speed: 1.0,
            })),
        ];
        let joins = vec![
            JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: true,
            },
            JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
                scene_start: false,
            },
        ];
        let out = tmp.join("final.mp4");
        encode_jobs(
            &ffmpeg, &jobs, &joins, codec, 30, "12000k", &tmp, &out, None,
        )
        .expect("encode_jobs frames+video group concat");
        // 連結成功＝両セグメントが -c copy 互換（非互換なら concat が失敗し上で panic）。両セグメント MP4 も生成済み。
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
        assert!(
            tmp.join("scene_000.mp4").exists(),
            "窓(Frames)セグメントが生成されていない"
        );
        assert!(
            tmp.join("scene_001.mp4").exists(),
            "settled(Video)セグメントが生成されていない"
        );
    }

    #[test]
    fn stage_clip_frames_extracts_expected_frame_count_when_ffmpeg_available() {
        // #442：クリップ区間フレーム抽出（stage_clip_frames_impl と同じフィルタ）で出力fpsの枚数が得られる。
        // 出力 f＝clip-time start+(f/fps)*speed（setpts=PTS/speed,fps）。速度=1・W=1s・fps=30 → 31枚。
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_stage_clip_frames_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let clip = tmp.join("clip.mp4");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=320x240:rate=30:duration=3".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                clip.to_string_lossy().into_owned(),
            ],
        )
        .expect("clip");
        // stage_clip_frames_impl と同一のフィルタ／枚数（W=1・fps=30・speed=1・width=640）。
        let (fps, speed, width, dur): (u32, f64, u32, f64) = (30, 1.0, 640, 1.0);
        let n = (dur * fps as f64).ceil() as usize + 1;
        let dir = tmp.join("frames");
        fs::create_dir_all(&dir).unwrap();
        let vf = format!("setpts=PTS/{speed},fps={fps},scale='min({width},iw)':-2");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-ss".into(),
                "0".into(),
                "-i".into(),
                clip.to_string_lossy().into_owned(),
                "-vf".into(),
                vf,
                "-frames:v".into(),
                format!("{n}"),
                "-start_number".into(),
                "0".into(),
                dir.join("frame_%05d.png").to_string_lossy().into_owned(),
            ],
        )
        .expect("extract clip frames");
        let count = (0..n)
            .take_while(|f| dir.join(format!("frame_{f:05}.png")).exists())
            .count();
        assert_eq!(count, 31, "W=1s×30fps＋1 で 31 枚のはず（実際 {count}）");
        assert!(dir.join("frame_00000.png").exists());
    }

    #[test]
    fn build_window_audio_mixes_narration_and_clip_when_ffmpeg_available() {
        // #442：窓 Frames の音声＝ナレーション＋クリップ元音声を amix して 1 本の WAV にする。
        let Ok(ffmpeg_path) = std::env::var("FFMPEG_PATH") else {
            return;
        };
        let ffmpeg = PathBuf::from(&ffmpeg_path);
        if !ffmpeg.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("yuko_window_audio_unittest");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        // 音声つきクリップ（testsrc2 映像＋sine 音声）。
        let clip = tmp.join("clip.mp4");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=160x120:rate=30:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=440:duration=3".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-shortest".into(),
                clip.to_string_lossy().into_owned(),
            ],
        )
        .expect("clip with audio");
        // ナレーション WAV（1秒）。
        let narr = tmp.join("narr.wav");
        run(
            &ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-t".into(),
                "1".into(),
                "-i".into(),
                "sine=frequency=660:sample_rate=44100".into(),
                narr.to_string_lossy().into_owned(),
            ],
        )
        .expect("narration");
        let ca = ClipAudioInput {
            clip_rel_path: String::new(), // build_window_audio は clip: &Path を使う（rel は未使用）
            clip_start_sec: 0.5,
            dur_sec: 1.0,
            speed: Some(1.0),
            volume: Some(0.4),
            delay_sec: 0.0, // #444：既定0＝窓先頭から（adelay なし＝従来挙動）
        };
        // ナレーション＋**2本**のクリップ音声を amix（#442 P2・複数動画スロット）。
        let clips2 = vec![(clip.clone(), &ca), (clip.clone(), &ca)];
        let mixed = build_window_audio(&ffmpeg, &tmp, 0, &clips2, Some(narr.as_path()), 1.0)
            .expect("mix narration+2 clips");
        assert!(
            fs::metadata(&mixed).expect("mixed wav exists").len() > 1000,
            "amix 出力の WAV が生成されていない"
        );
        // クリップ音声のみ（narration なし・1本）も整えて返す（amix inputs=1 の passthrough）。
        let clips1 = vec![(clip.clone(), &ca)];
        let clip_only =
            build_window_audio(&ffmpeg, &tmp, 1, &clips1, None, 1.0).expect("clip-only audio");
        assert!(
            fs::metadata(&clip_only)
                .expect("clip-only wav exists")
                .len()
                > 1000
        );
    }
}

#[cfg(test)]
mod staged_output_tests {
    use super::*;

    /// **利用者の選んだ場所へ直に書かない**（UI/UX レビュー 🔴）。
    ///
    /// ⚠️ **実測で確かめた壊れ方**＝ffmpeg は出力を**開いた時点で切り詰める**ので、
    /// 既にある動画を選んで「上書きしますか→はい」と答えた直後に中止・失敗すると、
    /// **前の動画が失われ、開けないファイルだけが残る**
    ///（10,748 バイトの再生できる動画が 262,192 バイトの `moov atom not found` になった）。
    #[test]
    fn 書きかけは利用者の場所に触らない() {
        let dir = std::env::temp_dir().join(format!("stario_staged_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("taisetsu.mp4");
        fs::write(&out, "前に作った大事な動画".as_bytes()).unwrap();

        let staged = staged_output_path(&out);
        // ⚠️ **隣に置く**＝別ドライブへ跨ぐと、最後の付け替えがコピーになって遅く・失敗しうる。
        assert_eq!(staged.parent(), out.parent(), "書きかけは同じ場所へ置く");
        assert_ne!(staged, out, "利用者の選んだ場所そのものへ書かない");

        // 書き出しが途中まで進んだ（＝書きかけができた）。
        fs::write(&staged, "書きかけ".as_bytes()).unwrap();
        assert_eq!(
            fs::read(&out).unwrap(),
            "前に作った大事な動画".as_bytes(),
            "書きかけができても、前の動画はそのまま"
        );

        // 中止・失敗＝見張りが落ちて片づく。
        {
            let _cleanup = StagedCleanup {
                path: staged.clone(),
            };
        }
        assert!(!staged.exists(), "書きかけを残さない");
        assert_eq!(
            fs::read(&out).unwrap(),
            "前に作った大事な動画".as_bytes(),
            "中止しても前の動画は失われない"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 成功したときだけ置き換える() {
        let dir = std::env::temp_dir().join(format!("stario_staged_ok_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("taisetsu.mp4");
        fs::write(&out, "前の動画".as_bytes()).unwrap();
        let staged = staged_output_path(&out);
        fs::write(&staged, "新しい動画".as_bytes()).unwrap();

        finish_staged_output(&staged, &out).unwrap();
        assert_eq!(
            fs::read(&out).unwrap(),
            "新しい動画".as_bytes(),
            "置き換わる"
        );
        assert!(!staged.exists(), "書きかけは残らない");

        // 成功した後に見張りが落ちても、置いたものを消さない。
        {
            let _cleanup = StagedCleanup {
                path: staged.clone(),
            };
        }
        assert!(out.exists(), "成功した動画を後片づけで消さない");
        let _ = fs::remove_dir_all(&dir);
    }
}
