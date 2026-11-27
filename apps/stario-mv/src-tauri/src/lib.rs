//! すたりおMV（γ）の本体。γ0.1 の段階⑦＝プレビュー画面（MV-0007）。
//!
//! 描くのは専用の糸（[`preview`]）。画面（React）は命令を送るだけ（開く・欄の位置・再生・コマ送り）。

mod audio;
mod clock;
mod edit;
mod preview;

use mv_core::io::Loaded;
use mv_render::present::Rect;
use preview::Cmd;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// プレビューの糸への口。
struct PreviewTx(Mutex<Sender<Cmd>>);

/// 画面の取引を送る操作口（外部 AI と同じ `mv-ops`＝MV-0008 決定1）。
struct Editor(Mutex<mv_ops::Ops>);

/// 起動の引数で渡された動画（`--project <フォルダ>`＝MV-0007 決定5）。
struct InitialProject(Option<PathBuf>);

impl PreviewTx {
    fn send(&self, c: Cmd) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "プレビューが止まっています。アプリを起動し直してください。".to_string())?
            .send(c)
            .map_err(|_| "プレビューが止まっています。アプリを起動し直してください。".to_string())
    }
}

/// 開いた動画の要約（画面がコンポジションの一覧と長さを出すため）。
pub fn summary(dir: &Path, l: &Loaded) -> Value {
    json!({
        "dir": dir.display().to_string(),
        "name": l.project.name,
        "mainCompositionId": l.project.main_composition_id,
        "compositions": l.project.compositions.iter().map(|c| json!({
            "id": c.id, "name": c.name, "width": c.width, "height": c.height,
            "fps": { "num": c.fps.num, "den": c.fps.den }, "durationFrames": c.duration_frames,
        })).collect::<Vec<_>>(),
        "issues": l.issues.iter().map(|i| json!({ "path": i.path, "message": i.message })).collect::<Vec<_>>(),
    })
}

#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("動画のフォルダを選ぶ（project.json のあるフォルダ）")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
}

#[tauri::command]
fn initial_project(init: tauri::State<InitialProject>) -> Option<String> {
    init.0.as_ref().map(|p| p.display().to_string())
}

#[tauri::command]
async fn open_project(dir: String, tx: tauri::State<'_, PreviewTx>) -> Result<Value, String> {
    let dir = PathBuf::from(dir);
    let loaded = mv_core::io::load_project(&dir).map_err(|e| e.to_string())?;
    let s = summary(&dir, &loaded);
    tx.send(Cmd::Open {
        dir,
        project: Box::new(loaded.project),
    })?;
    Ok(s)
}

#[tauri::command]
fn preview_set_rect(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    tx: tauri::State<PreviewTx>,
) -> Result<(), String> {
    tx.send(Cmd::Rect(Rect { x, y, w, h }))
}

#[tauri::command]
fn preview_play(tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Play)
}

#[tauri::command]
fn preview_pause(tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Pause)
}

#[tauri::command]
fn preview_seek(frame: i64, tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Seek(frame))
}

#[tauri::command]
fn preview_step(delta: i64, tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Step(delta))
}

#[tauri::command]
fn preview_set_muted(muted: bool, tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Mute(muted))
}

#[tauri::command]
fn preview_set_composition(id: String, tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Composition(id))
}

/// 編集に使う動画の全体と版（MV-0008）。
#[tauri::command]
async fn edit_read(dir: String) -> Result<Value, String> {
    edit::read(Path::new(&dir))
}

/// 画面の取引を反映する（検査を通ったときだけ保存＝MV-0008 決定1・2）。保存したらプレビューをすぐ読み直す。
#[tauri::command]
async fn edit_apply(
    dir: String,
    ops: Value,
    base_revision: Option<String>,
    editor: tauri::State<'_, Editor>,
    tx: tauri::State<'_, PreviewTx>,
) -> Result<Value, String> {
    let r = {
        let mut engine = editor
            .0
            .lock()
            .map_err(|_| "編集の口が止まっています。アプリを起動し直してください。".to_string())?;
        edit::apply(
            &mut *engine,
            Path::new(&dir),
            &ops,
            base_revision.as_deref(),
            &mut std::thread::sleep,
        )
    };
    // 断ったときも試しはやめる（元の見え方へ戻す）
    tx.send(if r.is_ok() {
        Cmd::Reload
    } else {
        Cmd::Trial(None)
    })?;
    r
}

/// 今のコマの、見えているレイヤーの枠（窓の画素・MV-0008 決定6）。プレビューの糸に描画の核で求めてもらう。
#[tauri::command]
async fn preview_bounds(tx: tauri::State<'_, PreviewTx>) -> Result<Value, String> {
    let (reply, rx) = std::sync::mpsc::channel();
    tx.send(Cmd::Bounds(reply))?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "プレビューが答えません。少し待ってからもう一度押してください。".to_string())?
}

/// 素材のファイルを選ぶ（利用者が選んだもの＝許したフォルダの外でも取り込める・MV-0008 決定2）。
#[tauri::command]
async fn pick_asset_files(app: tauri::AppHandle) -> Vec<String> {
    app.dialog()
        .file()
        .set_title("取り込む素材を選ぶ")
        .add_filter(
            "素材",
            &[
                "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "svg", "mp4", "mov", "m4v",
                "webm", "mkv", "avi", "wav", "mp3", "m4a", "aac", "flac", "ogg", "opus",
            ],
        )
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
        .collect()
}

/// 値の欄に出す、動かせる値の今の時刻での値（描画の核と同じ計算＝MV-0008 決定5）。
#[tauri::command]
fn edit_eval(layer: Value, frame: i64) -> Value {
    edit::eval_values(&layer, frame)
}

/// 掴んで動かしている途中の編集を、プレビューに試しとして渡す（保存しない）。`ops` が無ければやめる。
#[tauri::command]
fn edit_trial(ops: Option<Vec<Value>>, tx: tauri::State<PreviewTx>) -> Result<(), String> {
    tx.send(Cmd::Trial(ops))
}

/// 起動の引数から `--project <フォルダ>` を取り出す。
fn project_arg(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .position(|a| a == "--project")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
}

/// フォントの場所：設定・環境変数 → 同梱 → 開発中は α の同梱（COPIED_FROM.md）。
fn resolve_fonts(
    settings: &mv_ops::settings::Settings,
    resource_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::var_os("STARIO_MV_FONTS")
        .map(PathBuf::from)
        .into_iter()
        .chain(settings.font_dirs.iter().cloned())
        .filter(|p| p.is_dir())
        .collect();
    if v.is_empty() {
        let candidates = [
            resource_dir.map(|r| r.join("fonts")),
            Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../public/fonts")),
        ];
        v.extend(
            candidates
                .into_iter()
                .flatten()
                .filter(|p| p.is_dir())
                .take(1),
        );
    }
    v
}

/// FFmpeg の場所：設定 → 環境変数 → 同梱 → 開発中は α の同梱 → PATH（書き出しと同じ探し方）。
fn resolve_ffmpeg(
    settings: &mv_ops::settings::Settings,
    resource_dir: Option<&Path>,
) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let candidates: Vec<PathBuf> = [
        resource_dir.map(|r| r.join("ffmpeg").join("bin").join(exe)),
        Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../src-tauri/resources/ffmpeg/bin")
                .join(exe),
        ),
    ]
    .into_iter()
    .flatten()
    .collect();
    mv_export::locate_ffmpeg(settings.ffmpeg.as_deref(), &candidates).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(InitialProject(project_arg(&args)))
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("窓（main）がありません")?;
            let settings = mv_ops::settings::Settings::load(&mv_ops::settings::config_dir())
                .unwrap_or_default();
            let res = app.path().resource_dir().ok();
            let fonts = resolve_fonts(&settings, res.as_deref());
            let ffmpeg = resolve_ffmpeg(&settings, res.as_deref());
            let (tx, rx) = std::sync::mpsc::channel();
            app.manage(PreviewTx(Mutex::new(tx)));
            // ⚠️ 画面の操作口は「利用者」＝利用者が選んだ素材は許したフォルダの外でも取り込める（AI の口は別＝MV-0008 決定2）
            app.manage(Editor(Mutex::new(mv_ops::Ops::for_user(settings.clone()))));
            preview::spawn(window, fonts, ffmpeg, rx);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            initial_project,
            open_project,
            preview_set_rect,
            preview_play,
            preview_pause,
            preview_seek,
            preview_step,
            preview_set_composition,
            preview_set_muted,
            edit_read,
            edit_apply,
            edit_trial,
            edit_eval,
            preview_bounds,
            pick_asset_files
        ])
        .run(tauri::generate_context!())
        .expect("すたりおMV を起動できませんでした");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 起動の引数から動画のフォルダを取る() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            project_arg(&a(&["stario-mv.exe", "--project", "C:/x"])),
            Some(PathBuf::from("C:/x"))
        );
        assert_eq!(project_arg(&a(&["stario-mv.exe"])), None);
        assert_eq!(project_arg(&a(&["stario-mv.exe", "--project"])), None);
    }

    #[test]
    fn 開発中は_alpha_の同梱フォントを見つけ設定が先() {
        let s = mv_ops::settings::Settings::default();
        let f = resolve_fonts(&s, None);
        assert_eq!(f.len(), 1);
        assert!(f[0].ends_with("public/fonts"));
        // 設定に書いたフォルダが先
        let dir = tempfile::tempdir().unwrap();
        let s = mv_ops::settings::Settings {
            font_dirs: vec![dir.path().to_path_buf()],
            ..Default::default()
        };
        assert_eq!(resolve_fonts(&s, None), vec![dir.path().to_path_buf()]);
    }
}
