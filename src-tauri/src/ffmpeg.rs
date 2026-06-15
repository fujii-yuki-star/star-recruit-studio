// FFmpeg 呼び出し（infrastructure 境界）。アプリに静的リンクせず、ffmpeg.exe を外部実行ファイル（sidecar）として呼ぶ。
// バイナリは「環境変数 → 所定フォルダ(<appData>/bin) → PATH」で解決する（ADR-0002 実装方針）。
// コーデックは libopenh264 があればそれ（本番=LGPL）、無ければ libx264（開発=GPL）を自動選択。
// → LGPLビルドを所定フォルダに置くだけで OpenH264 出力へ無改修で切り替わる（コマンド生成は不変）。
// SVG→PNG は ADR-0004（WebView Canvas）で生成。FFmpegは PNG/動画/音声の合成のみ（ADR-0001）。
use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

// 既定FPS（videoSettings.fps の正典は project.json。B2でフロントから受け取る予定）。
const DEFAULT_FPS: u32 = 30;
// ナレーション既定音量。正典は 11_SCHEMA_REFERENCE §4（=1.0、TS domain/constants.ts と同値）。Rust側ミラー。
const DEFAULT_NARRATION_VOLUME: f64 = 1.0;
// 元動画音声の既定音量。正典は 11_SCHEMA_REFERENCE §4（=0.2、TS domain/constants.ts と同値）。
const DEFAULT_ORIGINAL_AUDIO_VOLUME: f64 = 0.2;

/// 映像コーデック。本番(OpenH264)への無改修切替のための抽象。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    OpenH264,
    X264,
}

impl VideoCodec {
    /// FFmpeg の -c:v に渡すエンコーダ名。
    pub fn encoder(self) -> &'static str {
        match self {
            VideoCodec::OpenH264 => "libopenh264",
            VideoCodec::X264 => "libx264",
        }
    }
}

/// `ffmpeg -encoders` の出力から H.264 エンコーダを選ぶ（OpenH264 優先＝本番想定）。
pub fn pick_codec(encoders_output: &str) -> Option<VideoCodec> {
    if encoders_output.contains("libopenh264") {
        Some(VideoCodec::OpenH264)
    } else if encoders_output.contains("libx264") {
        Some(VideoCodec::X264)
    } else {
        None
    }
}

/// 1シーン分の動画（PNG静止画＋音声）にする引数（純粋）。
/// 音声があればナレーション（volume適用）を、無ければ無音トラックを付け、全クリップを
/// 「映像＋AAC音声」で統一する（後段 concat の `-c copy` が成立するため）。
pub fn scene_clip_args(
    png: &str,
    audio: Option<&str>,
    narration_volume: f64,
    out: &str,
    duration_sec: f64,
    fps: u32,
    codec: VideoCodec,
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
    match audio {
        Some(a) => args.extend([
            "-i".into(),
            a.into(),
            // ナレーション音量を適用し、尺に満たない分は無音で埋める（apad）。
            "-filter_complex".into(),
            format!("[1:a]volume={narration_volume},apad[a]"),
            "-map".into(),
            "0:v".into(),
            "-map".into(),
            "[a]".into(),
        ]),
        None => args.extend([
            // 音声が無い場面は無音トラックを生成して付ける。
            "-f".into(),
            "lavfi".into(),
            "-t".into(),
            format!("{duration_sec}"),
            "-i".into(),
            "anullsrc=channel_layout=stereo:sample_rate=44100".into(),
            "-map".into(),
            "0:v".into(),
            "-map".into(),
            "1:a".into(),
        ]),
    }
    args.extend([
        "-r".into(),
        format!("{fps}"),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:v".into(),
        codec.encoder().into(),
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

/// 結合済み動画（ナレーション入り）に BGM を重ねる引数（純粋）。
/// BGM はループ（-stream_loop）し、音量・フェードを適用、amix で既存音声と合成する。
/// normalize=0 で各入力の音量を保つ（既定の正規化で音が痩せるのを防ぐ）。duration=first で動画長に合わせる。
pub fn mix_bgm_args(
    video: &str,
    bgm: &str,
    volume: f64,
    fade_in_sec: f64,
    fade_out_sec: f64,
    total_sec: f64,
    out: &str,
) -> Vec<String> {
    let fade_out_start = (total_sec - fade_out_sec).max(0.0);
    // afade は d=0 を受け付けない（"Option d value 0 out of range" で失敗）。
    // フェード秒が 0（既定）のときはそのフィルタを省略する。
    let afade_in = if fade_in_sec > 0.0 {
        format!(",afade=t=in:st=0:d={fade_in_sec}")
    } else {
        String::new()
    };
    let afade_out = if fade_out_sec > 0.0 {
        format!(",afade=t=out:st={fade_out_start}:d={fade_out_sec}")
    } else {
        String::new()
    };
    let filter = format!(
        "[1:a]volume={volume}{afade_in}{afade_out}[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]"
    );
    vec![
        "-y".into(),
        "-i".into(),
        video.into(),
        "-stream_loop".into(),
        "-1".into(),
        "-i".into(),
        bgm.into(),
        "-filter_complex".into(),
        filter,
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
    ]
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

/// 動画ありシーンの合成入力（ADR-0006）。下PNG→動画(slot)→上PNG(透過)を overlay し、
/// 音声は narration(任意) ＋ 元動画音声(任意) を amix（両方無ければ無音）。
pub struct VideoSceneArgs<'a> {
    /// 動画より下のレイヤー（背景等, zIndex<slot, 不透明・全面）。
    pub below_png: &'a str,
    /// 動画クリップ。
    pub clip: &'a str,
    /// 動画より上のレイヤー（文字/ゆうこ等, zIndex>slot, 透過PNG）。
    pub above_png: &'a str,
    /// ナレーション音声（無ければ None）。
    pub narration: Option<&'a str>,
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
    pub fps: u32,
    pub codec: VideoCodec,
    pub out: &'a str,
}

/// 動画ありシーンを1本のMP4にする引数（純粋・ADR-0006）。
/// 入力順: 0=below / 1=clip / 2=above /（narration があれば）3=narration。
pub fn video_scene_args(a: &VideoSceneArgs) -> Vec<String> {
    // 映像: 下PNG → クリップ(slotへfit) → 上PNG(透過) を overlay。
    let video_filter = format!(
        "[1:v]{fit}[clip];[0:v][clip]overlay={x}:{y}[bg1];[bg1][2:v]overlay=0:0[vout]",
        fit = fit_filter(a.fit, a.slot_w, a.slot_h),
        x = a.slot_x,
        y = a.slot_y
    );
    // 音声: narration(入力3) と 元音声([1:a]) の有無で分岐。両方無ければ無音(anullsrc)。
    let nv = a.narration_volume;
    let ov = a.original_volume;
    // apad で尺に満たない音声を無音で埋める（後段 -t {dur} で切る）。scene_clip_args と同じ方針で、
    // ナレーション/元音声がシーン尺より短くても音声トラックが早期 EOF にならないようにする。
    // anullsrc は無限長なので apad 不要。
    let audio_filter = match (a.narration.is_some(), a.use_original_audio) {
        (true, true) => format!(
            "[3:a]volume={nv}[narr];[1:a]volume={ov}[orig];[narr][orig]amix=inputs=2:duration=longest:normalize=0,apad[aout]"
        ),
        (true, false) => format!("[3:a]volume={nv},apad[aout]"),
        (false, true) => format!("[1:a]volume={ov},apad[aout]"),
        (false, false) => "anullsrc=channel_layout=stereo:sample_rate=44100[aout]".to_string(),
    };
    let filter = format!("{video_filter};{audio_filter}");

    let dur = a.duration_sec;
    // クリップの使用尺: clip_end_sec があれば (end-start) を尺で頭打ち。無ければシーン尺いっぱい。
    // 尺より短いクリップは overlay の既定 eof_action=repeat で最終フレームが保持される（N-1）。
    let clip_t = match a.clip_end_sec {
        Some(end) if end > a.clip_start_sec => (end - a.clip_start_sec).min(dur),
        _ => dur,
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
        "-loop".into(),
        "1".into(),
        "-t".into(),
        format!("{dur}"),
        "-i".into(),
        a.above_png.into(),
    ];
    if let Some(narr) = a.narration {
        args.extend(["-i".into(), narr.into()]);
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

/// ffmpeg バイナリを解決（環境変数 → appData/bin → localAppData/bin → PATH）。
pub fn resolve_ffmpeg(app: &tauri::AppHandle) -> PathBuf {
    resolve_bin(app, "FFMPEG_PATH", "ffmpeg")
}

fn resolve_bin(app: &tauri::AppHandle, env_key: &str, name: &str) -> PathBuf {
    if let Ok(p) = std::env::var(env_key) {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    // appData / localAppData の bin/ を順に探す（Windowsの Roaming/Local 差や Tauri のデータ位置差に対応）。
    let file = format!("{name}.exe");
    let dirs = [app.path().app_data_dir(), app.path().app_local_data_dir()];
    for base in dirs.into_iter().flatten() {
        let exe = base.join("bin").join(&file);
        if exe.exists() {
            return exe;
        }
    }
    PathBuf::from(name)
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

/// 動画ありシーンの解決済みジョブ（ADR-0006）。下/上PNGは tmp に書き出し済み、clip は絶対パス解決済み。
struct VideoJob {
    below: PathBuf,
    above: PathBuf,
    clip: PathBuf,
    narration: Option<PathBuf>,
    slot: (u32, u32, u32, u32),
    fit: Fit,
    clip_start_sec: f64,
    clip_end_sec: Option<f64>,
    duration_sec: f64,
    narration_volume: f64,
    original_volume: f64,
    use_original_audio: bool,
}

/// 1シーン分のジョブ。静止画 or 動画。
enum SceneJob {
    Still(SceneFile),
    Video(VideoJob),
}

impl SceneJob {
    fn duration_sec(&self) -> f64 {
        match self {
            SceneJob::Still(s) => s.duration_sec,
            SceneJob::Video(v) => v.duration_sec,
        }
    }
}

/// 各シーン（静止画 or 動画）→ MP4 → concat で1本に結合する。
fn encode_jobs(
    ffmpeg: &Path,
    jobs: &[SceneJob],
    codec: VideoCodec,
    fps: u32,
    tmp_dir: &Path,
    output: &Path,
) -> Result<(), String> {
    fs::create_dir_all(tmp_dir).map_err(|e| {
        export_failure(
            format!("create tmp dir: {e}"),
            "動画の保存中に問題が発生しました。もう一度お試しください。",
        )
    })?;
    let mut list = String::new();
    for (i, job) in jobs.iter().enumerate() {
        let clip_name = format!("scene_{i:03}.mp4");
        let clip = tmp_dir.join(&clip_name);
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
                )
            }
            SceneJob::Video(v) => {
                let below = v.below.to_string_lossy().into_owned();
                let above = v.above.to_string_lossy().into_owned();
                let clip_path = v.clip.to_string_lossy().into_owned();
                let out_path = clip.to_string_lossy().into_owned();
                let narr = v
                    .narration
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned());
                video_scene_args(&VideoSceneArgs {
                    below_png: &below,
                    clip: &clip_path,
                    above_png: &above,
                    narration: narr.as_deref(),
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
                    fps,
                    codec,
                    out: &out_path,
                })
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
        list.push_str(&format!("file '{clip_name}'\n"));
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

/// エクスポートの入力（1場面）。フロントは PNG(base64 or data URL) と尺を渡す。
/// 動画ありシーンは `video` を指定（その場合 png_base64 は使わない）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneInput {
    #[serde(default)]
    png_base64: String,
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
}

/// 動画ありシーンの入力（ADR-0006・step2b）。下/上PNGは base64、クリップはプロジェクト相対パス。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSceneInput {
    below_png_base64: String,
    above_png_base64: String,
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
}

/// BGM 入力（プロジェクト全体に重ねる）。data URL も可。volume は §6 で解決済み。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgmInput {
    audio_base64: String,
    volume: f64,
    #[serde(default)]
    fade_in_sec: f64,
    #[serde(default)]
    fade_out_sec: f64,
    /// 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。
    file_ext: String,
}

/// エクスポート結果の要約。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    output_path: String,
    codec: String,
    scene_count: usize,
}

/// 場面PNG群を受け取り、実MP4を output_path に書き出す（H.264/MP4）。
#[tauri::command]
pub fn export_video(
    app: tauri::AppHandle,
    scenes: Vec<SceneInput>,
    file_name: String,
    bgm: Option<BgmInput>,
    project_id: Option<String>,
    output_path: Option<String>,
) -> Result<ExportReport, String> {
    if scenes.is_empty() {
        return Err("書き出す場面がありません。".into());
    }
    let ffmpeg = resolve_ffmpeg(&app);
    let encoders = run(&ffmpeg, &["-hide_banner".into(), "-encoders".into()]).map_err(|_| {
        "動画の書き出しツールが見つかりません。設定でツールの場所を指定してください。".to_string()
    })?;
    let codec = pick_codec(&encoders).ok_or_else(|| {
        "動画の書き出し機能が使えません。設定でツールの場所を確認してください。".to_string()
    })?;

    let tmp = std::env::temp_dir().join("yuko_recruit_export");
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
            let above = tmp.join(format!("above_{i:03}.png"));
            decode_b64_to_file(
                &v.above_png_base64,
                &above,
                &format!("scene {} above png", i + 1),
            )?;
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
                above,
                clip,
                narration,
                slot: (v.slot_x, v.slot_y, v.slot_w, v.slot_h),
                fit: parse_fit(&v.fit),
                clip_start_sec: v.clip_start_sec.max(0.0), // 負値は 0 に丸める

                clip_end_sec: v.clip_end_sec,
                duration_sec: s.duration_sec,
                narration_volume: s.narration_volume.unwrap_or(DEFAULT_NARRATION_VOLUME),
                original_volume: v.original_volume.unwrap_or(DEFAULT_ORIGINAL_AUDIO_VOLUME),
                use_original_audio: v.use_original_audio,
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

    // BGM があれば、場面結合は一時ファイルへ→最後に BGM を重ねて out へ。無ければ直接 out へ。
    let video_path = if bgm.is_some() {
        tmp.join("video.mp4")
    } else {
        out.clone()
    };
    encode_jobs(&ffmpeg, &jobs, codec, DEFAULT_FPS, &tmp, &video_path)?;

    if let Some(b) = bgm {
        let bg_bytes = base64::engine::general_purpose::STANDARD
            .decode(strip_data_url(&b.audio_base64))
            .map_err(|e| {
                export_failure(
                    format!("bgm decode: {e}"),
                    "BGMを読み取れませんでした。別のファイルでお試しください。",
                )
            })?;
        let ext = sanitize_file_name(&b.file_ext);
        let bgm_path = tmp.join(format!("bgm.{ext}"));
        fs::write(&bgm_path, bg_bytes).map_err(|e| {
            export_failure(
                format!("write bgm: {e}"),
                "動画の保存中に問題が発生しました。もう一度お試しください。",
            )
        })?;
        let total: f64 = jobs.iter().map(|j| j.duration_sec()).sum();
        let args = mix_bgm_args(
            &video_path.to_string_lossy(),
            &bgm_path.to_string_lossy(),
            b.volume,
            b.fade_in_sec,
            b.fade_out_sec,
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
    fn pick_codec_prefers_openh264_then_x264() {
        assert_eq!(
            pick_codec("V..... libopenh264 ... V..... libx264"),
            Some(VideoCodec::OpenH264)
        );
        assert_eq!(pick_codec("V..... libx264 only"), Some(VideoCodec::X264));
        assert_eq!(pick_codec("no h264 here"), None);
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
        );
        assert!(o.iter().any(|s| s == "libopenh264"));
        assert!(o.iter().any(|s| s.contains("anullsrc")));
        assert!(o.iter().any(|s| s == "aac"));
        assert!(o.windows(2).any(|w| w[0] == "-map" && w[1] == "1:a"));
    }

    #[test]
    fn concat_args_copies_streams() {
        let a = concat_args("list.txt", "out.mp4");
        assert!(a.iter().any(|s| s == "concat"));
        assert!(a.windows(2).any(|w| w[0] == "-c" && w[1] == "copy"));
    }

    #[test]
    fn mix_bgm_args_applies_loop_volume_fade_and_amix() {
        let a = mix_bgm_args("v.mp4", "bgm.mp3", 0.25, 1.0, 2.0, 10.0, "out.mp4");
        // BGM をループ入力にする。
        assert!(a.windows(2).any(|w| w[0] == "-stream_loop" && w[1] == "-1"));
        // 音量・フェード（out 開始 = 総尺 10 - フェード 2 = 8）・amix（normalize=0）を適用。
        assert!(a.iter().any(|s| s.contains("volume=0.25")));
        assert!(a.iter().any(|s| s.contains("afade=t=in:st=0:d=1")));
        assert!(a.iter().any(|s| s.contains("afade=t=out:st=8:d=2")));
        assert!(a
            .iter()
            .any(|s| s.contains("amix=inputs=2:duration=first:normalize=0")));
        // 映像は再エンコードしない。
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy"));
    }

    #[test]
    fn mix_bgm_args_omits_afade_when_zero() {
        // フェード秒=0（既定）のとき afade を出さない（d=0 は FFmpeg が拒否するため）。
        let a = mix_bgm_args("v.mp4", "bgm.mp3", 0.25, 0.0, 0.0, 10.0, "out.mp4");
        assert!(!a.iter().any(|s| s.contains("afade")));
        assert!(a.iter().any(|s| s.contains("volume=0.25")));
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
        encode_jobs(&ffmpeg, &scenes, codec, 30, &tmp, &out).expect("encode_jobs");
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
            codec,
            30,
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
        // 既定のフェード無し（0.0）で実行し、afade=d=0 で落ちない（バグ#1回帰）ことを確認する。
        let args = mix_bgm_args(
            &video.to_string_lossy(),
            &bgm.to_string_lossy(),
            0.25,
            0.0,
            0.0,
            2.0,
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
            above_png: "above.png",
            narration: Some(&narr),
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
            fps: 30,
            codec: VideoCodec::X264,
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
            above_png: "a.png",
            narration: None,
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
            fps: 30,
            codec: VideoCodec::X264,
            out: "o.mp4",
        });
        let pos = args.iter().position(|s| s == "-ss").expect("-ss");
        assert_eq!(args[pos + 1], "1"); // clip_start
        assert_eq!(args[pos + 3], "2"); // clip_t = min(end-start, dur)
    }

    #[test]
    fn video_scene_args_uses_silence_without_audio() {
        let args = video_scene_args(&VideoSceneArgs {
            below_png: "b.png",
            clip: "c.mp4",
            above_png: "a.png",
            narration: None,
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
            fps: 30,
            codec: VideoCodec::OpenH264,
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
            above_png: &above_s,
            narration: Some(&narr_s),
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
            fps: 30,
            codec,
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
            above_png: &above_s,
            narration: None,
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
            fps: 30,
            codec,
            out: &out2_s,
        });
        run(&ffmpeg, &args2).expect("video_scene silent overlay");
        assert!(fs::metadata(&out2).expect("scene_silent.mp4 exists").len() > 0);
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
            above,
            clip,
            narration: Some(narr),
            slot: (40, 30, 240, 180),
            fit: Fit::Cover,
            clip_start_sec: 0.0,
            clip_end_sec: None,
            duration_sec: 2.0,
            narration_volume: 1.0,
            original_volume: 0.2,
            use_original_audio: true,
        })];
        encode_jobs(&ffmpeg, &jobs, codec, 30, &tmp, &out).expect("encode_jobs video");
        assert!(fs::metadata(&out).expect("final.mp4 exists").len() > 0);
    }
}
