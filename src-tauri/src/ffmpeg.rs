// FFmpeg 呼び出し（infrastructure 境界）。アプリに静的リンクせず、ffmpeg.exe を外部実行ファイル（sidecar）として呼ぶ。
// バイナリは「環境変数 → 所定フォルダ(<appData>/bin) → PATH」で解決する（ADR-0002 実装方針）。
// コーデックは h264_mf（Media Foundation＝主経路）→ libopenh264（フォールバック）→ libx264（開発=GPL）を自動選択（ADR-0002/0013）。
// → LGPL+mediafoundation ビルドを所定フォルダに置くだけで h264_mf 出力へ無改修で切り替わる（コマンド生成は不変）。
// SVG→PNG は ADR-0004（WebView Canvas）で生成。FFmpegは PNG/動画/音声の合成のみ（ADR-0001）。
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

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
    pub delay_sec: f64,
    pub play_sec: f64,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
}

/// 結合済み動画（ナレーション入り）へ、場面ごとBGMの各クリップをループ→切り出し→音量→フェード→adelay して amix する引数（純粋・ADR-0018 ③(7)）。
/// クリップは planBgmMix が配置済み（曲が変わる境界は前後を重ねた delay/play＋フェードで amix ブレンド＝クロスフェード）。
/// 既存音声 [0:a] は保持し normalize=0 で各入力の音量を保つ。duration=first＋-t total で動画長に合わせる。runs は1本以上（呼ぶ前に判定）。
pub fn mix_bgm_runs_args(
    video: &str,
    runs: &[BgmRunPlaced],
    total_sec: f64,
    out: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), video.into()];
    for r in runs {
        // 各BGMソースはループ（尺に満たない曲を繰り返す）。
        args.push("-stream_loop".into());
        args.push("-1".into());
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
        filters.push(format!(
            "[{src}:a]atrim=0:{play},asetpts=N/SR/TB,volume={vol}{fi}{fo}{d}[{label}]",
            play = r.play_sec,
            vol = r.volume
        ));
        labels.push(format!("[{label}]"));
    }
    let n = labels.len();
    filters.push(format!(
        "{}amix=inputs={n}:duration=first:normalize=0[a]",
        labels.join("")
    ));
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

/// テロップ帯の overlay 入力（純粋引数用・ADR-0018）。png は一時PNGパス、区間はグローバル秒（front の compileTimeline と一致）。
pub struct TelopOverlay<'a> {
    pub png: &'a str,
    pub start_sec: f64,
    pub end_sec: f64,
}

/// 結合済み動画へテロップ帯PNG群を時刻指定で重ねる引数（純粋・ADR-0018 テロップ実描画）。
/// 各PNGは透過・出力解像度と同サイズ（front が場面PNGと同じ SVG→PNG で焼く＝ADR-0004 パリティ）。
/// 静止PNGは overlay の eof_action=repeat で唯一フレームが持続し、enable='between(t,S,E)' が表示区間を制御する
/// （t は主入力＝結合済み動画のタイムスタンプ）。映像は再エンコード（コーデック/ビットレートは場面と同一）・音声は無変更コピー。
/// BGM 合成の前に1回だけ実行する（再エンコード世代を最小に。xfade チェーンへの合流は将来最適化）。
pub fn overlay_telops_args(
    video: &str,
    telops: &[TelopOverlay],
    codec: VideoCodec,
    bitrate: &str,
    out: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), video.into()];
    for t in telops {
        args.push("-i".into());
        args.push(t.png.into());
    }
    let mut filters: Vec<String> = Vec::new();
    let mut prev = "0:v".to_string();
    for (i, t) in telops.iter().enumerate() {
        let label = format!("v{}", i + 1);
        filters.push(format!(
            "[{prev}][{idx}:v]overlay=0:0:eof_action=repeat:enable='between(t,{s},{e})'[{label}]",
            idx = i + 1,
            s = t.start_sec,
            e = t.end_sec
        ));
        prev = label;
    }
    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.push("-map".into());
    args.push(format!("[{prev}]"));
    args.push("-map".into());
    args.push("0:a".into());
    args.push("-c:v".into());
    args.push(codec.encoder().into());
    args.extend(codec.quality_args(bitrate));
    args.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "copy".into(),
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

/// 動画ありシーンの合成入力（ADR-0006）。下PNG→動画(slot)→上PNG(透過・1枚以上)を overlay し、
/// 音声は narrations(0本以上・行ごとの adelay 配置可) ＋ 元動画音声(任意) を amix（すべて無ければ無音）。
/// 掛け合い×動画はクリップを連続1本のまま、上PNG（字幕/クレジット）を行区間で切替え、
/// 行ナレーションを開始秒に配置する（プレビューの行進行と一致＝ADR-0001 パリティ）。
pub struct VideoSceneArgs<'a> {
    /// 動画より下のレイヤー（背景等, zIndex<slot, 不透明・全面）。
    pub below_png: &'a str,
    /// 動画クリップ。
    pub clip: &'a str,
    /// 動画より上のレイヤー（文字/ゆうこ等, zIndex>slot, 透過PNG）。通常1枚（window=None）、
    /// 掛け合いは行区間ごとに複数枚。空は防御（bg1 を直接出力）＝export_video が事前に弾く。
    pub aboves: &'a [AbovePngArg<'a>],
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
    // 映像: 下PNG → クリップ(slotへfit) → 上PNG(透過・1枚以上) を overlay。
    // 速度!=1 のときだけ setpts(映像)/atempo(元音声)を挟む（A=尺独立：尺は据え置き、クリップ内の再生速度のみ変える）。
    let speed = a.speed;
    let normal_speed = (speed - 1.0).abs() < 1e-6;
    let clip_v = if normal_speed {
        fit_filter(a.fit, a.slot_w, a.slot_h)
    } else {
        format!(
            "setpts=PTS/{speed},{}",
            fit_filter(a.fit, a.slot_w, a.slot_h)
        )
    };
    let x = a.slot_x;
    let y = a.slot_y;
    let mut vparts: Vec<String> = vec![format!("[1:v]{clip_v}[clip]")];
    if a.aboves.is_empty() {
        // 防御（通常は export_video が事前に弾く）: 上PNG無しでも合成が成立するよう bg1 を直接出力。
        vparts.push(format!("[0:v][clip]overlay={x}:{y}[vout]"));
    } else {
        vparts.push(format!("[0:v][clip]overlay={x}:{y}[bg1]"));
        for (k, ab) in a.aboves.iter().enumerate() {
            let in_l = format!("bg{}", k + 1);
            let out_l = if k + 1 == a.aboves.len() {
                "vout".to_string()
            } else {
                format!("bg{}", k + 2)
            };
            let idx = 2 + k;
            match ab.window {
                // 全尺の1枚（従来）: -loop 入力を常時 overlay。
                None => vparts.push(format!("[{in_l}][{idx}:v]overlay=0:0[{out_l}]")),
                // 行区間つき: 単一フレーム入力を eof_action=repeat で持続させ、[start,end) だけ描く
                // （テロップ overlay と同方式）。半開区間＝境界フレームでの前後同時描画を防ぐ。
                Some((s, e)) => vparts.push(format!(
                    "[{in_l}][{idx}:v]overlay=0:0:eof_action=repeat:enable='gte(t,{s})*lt(t,{e})'[{out_l}]"
                )),
            }
        }
    }
    let video_filter = vparts.join(";");
    // 音声: narrations（0本以上・delay 配置）と 元音声([1:a]) の組合せ。すべて無ければ無音(anullsrc)。
    let nv = a.narration_volume;
    let ov = a.original_volume;
    // 元音声フィルタ: volume の後、速度!=1 なら atempo（ピッチ維持で速度変更）。
    let orig_a = if normal_speed {
        format!("volume={ov}")
    } else {
        format!("volume={ov},atempo={speed}")
    };
    // ナレーション入力の先頭 index（0=below, 1=clip, 2..=aboves の直後）。
    let narr_base = 2 + a.aboves.len();
    // 1本ぶんの前処理: [窓で atrim 切り詰め →] volume → 必要なら adelay（行の開始秒へ配置・全チャンネル）。
    // window_sec=Some の掛け合い×動画では、行の音声を窓（次の行の開始まで）で切る＝前の行が次の行に
    // 重なって鳴らない（プレビューは次行開始で pause・静止画掛け合いはセグメント -t でカット＝#385）。
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
    // apad で尺に満たない音声を無音で埋める（後段 -t {dur} で切る）。scene_clip_args と同じ方針で、
    // ナレーション/元音声がシーン尺より短くても音声トラックが早期 EOF にならないようにする。
    // anullsrc は無限長なので apad 不要。
    let audio_filter = if a.narrations.is_empty() {
        if a.use_original_audio {
            format!("[1:a]{orig_a},apad[aout]")
        } else {
            "anullsrc=channel_layout=stereo:sample_rate=44100[aout]".to_string()
        }
    } else if a.narrations.len() == 1 && !a.use_original_audio {
        // 単一ナレーションのみ: amix 不要（delay 0・window None なら従来と同一のフィルタ文字列）。
        format!(
            "{},apad[aout]",
            narr_chain(
                narr_base,
                a.narrations[0].delay_sec,
                a.narrations[0].window_sec
            )
        )
    } else {
        // 複数ナレーション（掛け合い） or 元音声併用: 各ナレーションをラベル化して amix。
        let mut parts: Vec<String> = Vec::new();
        let mut labels = String::new();
        for (k, na) in a.narrations.iter().enumerate() {
            parts.push(format!(
                "{}[n{k}]",
                narr_chain(narr_base + k, na.delay_sec, na.window_sec)
            ));
            labels.push_str(&format!("[n{k}]"));
        }
        let mut inputs = a.narrations.len();
        if a.use_original_audio {
            parts.push(format!("[1:a]{orig_a}[orig]"));
            labels.push_str("[orig]");
            inputs += 1;
        }
        format!(
            "{};{labels}amix=inputs={inputs}:duration=longest:normalize=0,apad[aout]",
            parts.join(";")
        )
    };
    let filter = format!("{video_filter};{audio_filter}");

    let dur = a.duration_sec;
    // クリップの使用尺(ソース秒): clip_end_sec があれば (end-start) を dur*speed で頭打ち。無ければ dur*speed。
    // 速度分だけソースを読み、setpts で再生時間が dur に収まる（A=尺独立）。
    // 尺より短いクリップは overlay の既定 eof_action=repeat で最終フレームが保持される（N-1）。
    let clip_t = match a.clip_end_sec {
        Some(end) if end > a.clip_start_sec => (end - a.clip_start_sec).min(dur * speed),
        _ => dur * speed,
    };
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-loop".into(),
        "1".into(),
        "-t".into(),
        format!("{dur}"),
        "-i".into(),
        a.below_png.into(),
        "-ss".into(),
        format!("{}", a.clip_start_sec),
        "-t".into(),
        format!("{clip_t}"),
        "-i".into(),
        a.clip.into(),
    ];
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
                    eprintln!(
                        "[ffmpeg] 診断モード: 外部 FFMPEG_PATH を使用します（同梱 pin 構成外＝LGPL+h264_mf は保証されません）: {p}"
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

/// 技術詳細を開発者向けに stderr へ記録し、ユーザーには行動を示す固定文言を返す（§2-3/§2-5）。
/// `log` クレート未導入のため eprintln! で記録する（tauri dev のコンソールに出る）。
fn export_failure(detail: impl std::fmt::Display, user_message: impl Into<String>) -> String {
    eprintln!("[export] {detail}");
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
    Video(VideoJob),
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
}

/// FFmpeg xfade が受け付ける transition 名の許可リスト（MVP）。これ以外/"none" はハードカット扱い。
const XFADE_NAMES: [&str; 5] = ["fade", "slideleft", "slideright", "slideup", "slidedown"];
fn validate_xfade_name(name: &str) -> Option<String> {
    XFADE_NAMES.contains(&name).then(|| name.to_string())
}

/// 各シーン（静止画 or 動画）→ MP4 にし、トランジション有無で結合方法を選ぶ（ADR-0009 T2）。
/// 全境界ハードカット（遷移なし）なら concat demuxer の無劣化コピー、1つでも遷移ありなら xfade チェーンで再エンコード。
/// `joins` は jobs と同じ長さ（joins[0]＝先頭で未使用）。
// bitrate は export_video で1回算出し、場面/xfade/テロップ overlay の3経路で同一値を共有するため引数で受ける（#121）。
// 内部オーケストレータで、引数は infra ハンドル（ffmpeg/tmp/output）＋エンコード設定の混在＝自然な構造体化が難しいため、
// 意図した8引数として clippy::too_many_arguments を抑制する。
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
) -> Result<(), String> {
    fs::create_dir_all(tmp_dir).map_err(|e| {
        export_failure(
            format!("create tmp dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let mut files: Vec<String> = Vec::with_capacity(jobs.len());
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
                video_scene_args(&VideoSceneArgs {
                    below_png: &below,
                    clip: &clip_path,
                    aboves: &aboves,
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
        run(ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("scene {} encode: {e}", i + 1),
                format!(
                    "場面{}の変換に失敗しました。もう一度お試しください。",
                    i + 1
                ),
            )
        })?;
        files.push(clip.to_string_lossy().into_owned());
    }

    // 境界は joins[1..] のみ有効（joins[0]＝先頭場面は遷移元なし。skip(1) で除外＝コメントと一致）。
    let has_transition = joins.iter().skip(1).any(|j| j.xfade.is_some());
    if has_transition && files.len() >= 2 {
        // 遷移あり：xfade/concat フィルタチェーンで再エンコード結合（ADR-0009 T2）。
        let steps: Vec<JoinStep> = (1..files.len())
            .map(|i| JoinStep {
                xfade: joins[i].xfade.as_deref(),
                duration_sec: joins[i].duration_sec,
                offset_sec: joins[i].offset_sec,
            })
            .collect();
        let args = xfade_chain_args(
            &files,
            &steps,
            &output.to_string_lossy(),
            codec,
            fps,
            bitrate,
        );
        run(ffmpeg, &args).map_err(|e| {
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
        run(ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("concat: {e}"),
                "場面の結合に失敗しました。もう一度お試しください。",
            )
        })?;
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
    if rel_path.contains("..")
        || rel_path.starts_with('/')
        || rel_path.starts_with('\\')
        || Path::new(rel_path).is_absolute()
    {
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
    /// 動画ありシーン（ADR-0006）。指定時は overlay 合成経路へ。
    #[serde(default)]
    video: Option<VideoSceneInput>,
    /// この場面に「入る」トランジション（ADR-0009 T2）。先頭場面は無視。未指定＝ハードカット。
    #[serde(default)]
    transition: Option<TransitionInput>,
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

/// 動画ありシーンの入力（ADR-0006・step2b）。下/上PNGは base64、クリップはプロジェクト相対パス。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSceneInput {
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
    audio_base64: String,
    /// 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。
    file_ext: String,
    volume: f64,
    /// グローバル配置開始（秒）＝adelay。
    #[serde(default)]
    delay_sec: f64,
    /// ループ素材から使う長さ（秒）＝atrim。
    play_sec: f64,
    #[serde(default)]
    fade_in_sec: f64,
    #[serde(default)]
    fade_out_sec: f64,
}

/// タイムラインのテロップ帯入力（ADR-0018）。透過PNG（base64/data URL）＋グローバル表示区間（compileTimeline の秒と一致）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelopInput {
    png_base64: String,
    #[serde(default)]
    start_sec: f64,
    #[serde(default)]
    end_sec: f64,
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
    telops: Option<Vec<TelopInput>>,
) -> Result<ExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_video_impl(
            app,
            scenes,
            file_name,
            bgm_runs,
            project_id,
            output_path,
            telops,
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

/// 書き出し本体（ブロッキング）。`export_video` が spawn_blocking 上で呼ぶ（#375）。
#[allow(clippy::too_many_arguments)]
fn export_video_impl(
    app: tauri::AppHandle,
    scenes: Vec<SceneInput>,
    file_name: String,
    bgm_runs: Option<Vec<BgmRunInput>>,
    project_id: Option<String>,
    output_path: Option<String>,
    telops: Option<Vec<TelopInput>>,
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

        if let Some(v) = &s.video {
            // 動画ありシーン（ADR-0006）。下/上PNGを書き出し、クリップをプロジェクト相対パスから安全解決。
            let pid = project_id.as_deref().ok_or_else(|| {
                export_failure(
                    "video scene without project_id",
                    "動画を含む書き出しには、先にプロジェクトの保存が必要です。",
                )
            })?;
            let below = tmp.join(format!("below_{i:03}.png"));
            decode_b64_to_file(
                &v.below_png_base64,
                &below,
                &format!("scene {} below png", i + 1),
            )?;
            // 上PNG：行区間つき（掛け合い×動画）なら全部、無ければ従来の全尺1枚。
            let mut aboves: Vec<TimedAbove> = Vec::new();
            if !v.above_segments.is_empty() {
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
            } else if !v.above_png_base64.is_empty() {
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
            } else {
                return Err(export_failure(
                    format!("scene {} video without above png", i + 1),
                    "動画の保存中に問題が発生しました。もう一度お試しください。",
                ));
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
            jobs.push(SceneJob::Video(VideoJob {
                below,
                aboves,
                clip,
                narrations,
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
            }));
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
            jobs.push(SceneJob::Frames(FramesJob {
                frames_dir,
                first_frame,
                audio: narration,
                narration_volume: s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
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

    // 場面間トランジション（ADR-0009 T2）。各場面の「入り」を JoinInfo に解決（joins[0]＝先頭で未使用）。
    let joins: Vec<JoinInfo> = scenes
        .iter()
        .map(|s| match &s.transition {
            Some(t) => JoinInfo {
                xfade: validate_xfade_name(&t.name),
                duration_sec: t.duration_sec,
                offset_sec: t.offset_sec,
            },
            None => JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
            },
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

    // パス構成：場面結合 →（テロップ overlay 合成・ADR-0018）→（場面ごとBGM 合成・ADR-0018 ③(7)）→ out。中間成果物は tmp。
    let has_telops = telops.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
    let has_bgm = bgm_runs.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
    let joined_path = if has_telops {
        tmp.join("joined.mp4")
    } else if has_bgm {
        tmp.join("video.mp4")
    } else {
        out.clone()
    };
    encode_jobs(
        &ffmpeg,
        &jobs,
        &joins,
        codec,
        DEFAULT_FPS,
        &bitrate,
        &tmp,
        &joined_path,
    )?;

    // タイムラインのテロップ帯を結合後の動画へ overlay（区間はグローバル秒＝xfade 重なり込みの実効時間軸）。
    let video_path = if has_telops {
        let list = telops.unwrap_or_default();
        let target = if has_bgm {
            tmp.join("video.mp4")
        } else {
            out.clone()
        };
        let mut png_paths: Vec<String> = Vec::with_capacity(list.len());
        for (i, t) in list.iter().enumerate() {
            let p = tmp.join(format!("telop_{i:03}.png"));
            decode_b64_to_file(&t.png_base64, &p, &format!("telop {}", i + 1))?;
            png_paths.push(p.to_string_lossy().into_owned());
        }
        let overlays: Vec<TelopOverlay> = list
            .iter()
            .zip(png_paths.iter())
            .map(|(t, p)| TelopOverlay {
                png: p,
                start_sec: t.start_sec,
                end_sec: t.end_sec,
            })
            .collect();
        let args = overlay_telops_args(
            &joined_path.to_string_lossy(),
            &overlays,
            codec,
            &bitrate,
            &target.to_string_lossy(),
        );
        run(&ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("telop overlay: {e}"),
                "テロップの合成に失敗しました。もう一度お試しください。",
            )
        })?;
        target
    } else {
        joined_path
    };

    // 場面ごとBGM（ADR-0018 ③(7)）：各クリップを一時ファイルへ書き出し、planBgmMix の配置で結合後の動画へ amix。
    if has_bgm {
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
                delay_sec: r.delay_sec,
                play_sec: r.play_sec,
                fade_in_sec: r.fade_in_sec,
                fade_out_sec: r.fade_out_sec,
            })
            .collect();
        let args = mix_bgm_runs_args(
            &video_path.to_string_lossy(),
            &placed,
            total,
            &out.to_string_lossy(),
        );
        run(&ffmpeg, &args).map_err(|e| {
            export_failure(
                format!("bgm mix: {e}"),
                "BGMの合成に失敗しました。もう一度お試しください。",
            )
        })?;
    }

    Ok(ExportReport {
        output_path: out.to_string_lossy().into_owned(),
        codec: codec.encoder().to_string(),
        scene_count: scenes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // テロップ overlay（ADR-0018）：enable='between' 区間付きの overlay チェーンを組み、音声は無変更コピー。
    #[test]
    fn overlay_telops_args_builds_enable_chain() {
        let telops = [
            TelopOverlay {
                png: "t0.png",
                start_sec: 1.5,
                end_sec: 3.0,
            },
            TelopOverlay {
                png: "t1.png",
                start_sec: 8.0,
                end_sec: 11.0,
            },
        ];
        let a = overlay_telops_args(
            "in.mp4",
            &telops,
            VideoCodec::MediaFoundation,
            "12000k",
            "out.mp4",
        );
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        assert_eq!(
            a[fc + 1],
            "[0:v][1:v]overlay=0:0:eof_action=repeat:enable='between(t,1.5,3)'[v1];[v1][2:v]overlay=0:0:eof_action=repeat:enable='between(t,8,11)'[v2]"
        );
        // 最終映像ラベルを map、音声は元動画から無変更コピー。MF は -b:v（品質）を伴う。yuv420p で互換維持。
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v2]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "0:a"));
        assert!(a.windows(2).any(|w| w[0] == "-c:a" && w[1] == "copy"));
        assert!(a.windows(2).any(|w| w[0] == "-b:v" && w[1] == "12000k"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        // 入力は 動画1本＋テロップPNG2枚。
        assert_eq!(a.iter().filter(|s| *s == "-i").count(), 3);
    }

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
    fn mix_bgm_runs_args_single_run_loops_volume_fade_amix() {
        // 単一区間（全場面が継承する従来ケース相当）：ループ・音量・フェード（out 開始 = play 10 − 2 = 8）・amix(inputs=2)。
        let runs = [BgmRunPlaced {
            file: "bgm.mp3",
            volume: 0.25,
            delay_sec: 0.0,
            play_sec: 10.0,
            fade_in_sec: 1.0,
            fade_out_sec: 2.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, "out.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-stream_loop" && w[1] == "-1"));
        let fc = a.iter().position(|s| s == "-filter_complex").unwrap();
        assert_eq!(
            a[fc + 1],
            "[1:a]atrim=0:10,asetpts=N/SR/TB,volume=0.25,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2[bg0];[0:a][bg0]amix=inputs=2:duration=first:normalize=0[a]"
        );
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy")); // 映像は再エンコードしない
    }

    #[test]
    fn mix_bgm_runs_args_crossfade_places_two_runs_with_adelay() {
        // 曲が変わる2区間：2本目は adelay で配置。入力は video+2曲、amix inputs=3。
        let runs = [
            BgmRunPlaced {
                file: "a.mp3",
                volume: 0.25,
                delay_sec: 0.0,
                play_sec: 8.5,
                fade_in_sec: 1.5,
                fade_out_sec: 1.0,
            },
            BgmRunPlaced {
                file: "b.mp3",
                volume: 0.3,
                delay_sec: 7.5,
                play_sec: 6.5,
                fade_in_sec: 1.0,
                fade_out_sec: 2.0,
            },
        ];
        let a = mix_bgm_runs_args("v.mp4", &runs, 14.0, "out.mp4");
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
            delay_sec: 0.0,
            play_sec: 10.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
        }];
        let a = mix_bgm_runs_args("v.mp4", &runs, 10.0, "out.mp4");
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
            })
            .collect();
        encode_jobs(&ffmpeg, &scenes, &joins, codec, 30, "12000k", &tmp, &out)
            .expect("encode_jobs");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
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
            }],
            codec,
            30,
            "12000k",
            &tmp,
            &video,
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
            delay_sec: 0.0,
            play_sec: 2.0,
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
        }];
        let args = mix_bgm_runs_args(&video.to_string_lossy(), &runs, 2.0, &out.to_string_lossy());
        run(&ffmpeg, &args).expect("bgm mix");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }

    #[test]
    fn video_scene_args_overlays_clip_and_mixes_audio() {
        let narr = "n.wav".to_string();
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "below.png",
            clip: "clip.mp4",
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
        assert!(fc.contains("[1:a]volume=0.2[orig]"));
        assert!(fc.contains("[n0][n1][orig]amix=inputs=3:duration=longest:normalize=0,apad[aout]"));
    }

    #[test]
    fn video_scene_args_single_narration_keeps_legacy_filter() {
        // 単一ナレーション（delay 0）は従来と同一のフィルタ文字列（後方互換＝既存場面の出力不変）。
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
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
        let jobs = vec![SceneJob::Video(VideoJob {
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
            slot: (40, 30, 240, 180),
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
            speed: 1.0,
        })];
        let joins: Vec<JoinInfo> = jobs
            .iter()
            .map(|_| JoinInfo {
                xfade: None,
                duration_sec: 0.0,
                offset_sec: 0.0,
            })
            .collect();
        encode_jobs(&ffmpeg, &jobs, &joins, codec, 30, "12000k", &tmp, &out)
            .expect("encode_jobs video");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }
}
