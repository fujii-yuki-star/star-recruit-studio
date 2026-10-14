// VOICEVOX ENGINE（ローカル HTTP サーバ）の同梱・自動起動・自動終了（ADR-0005・#149）。
// 同梱した ENGINE（resource_dir/voicevox_engine/run[.exe]）を空きポートで起動し、アプリ終了時に終了する。
// バイナリが同梱されていなければ何もしない＝従来どおり手動起動の ENGINE／設定の接続先へフォールバック（dev/CI も不変）。
use crate::proc::no_window_command;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 起動した同梱 ENGINE の状態（プロセスハンドルと接続先 base_url）。Tauri の管理状態として保持する。
#[derive(Default)]
pub struct EngineState {
    child: Mutex<Option<Child>>,
    base_url: Mutex<Option<String>>,
}

impl EngineState {
    /// 起動済みの同梱 ENGINE の base_url（`http://127.0.0.1:PORT`）。未起動なら None。
    pub fn base_url(&self) -> Option<String> {
        self.base_url.lock().ok().and_then(|g| g.clone())
    }

    fn store(&self, child: Child, base_url: String) {
        if let Ok(mut g) = self.child.lock() {
            *g = Some(child);
        }
        if let Ok(mut g) = self.base_url.lock() {
            *g = Some(base_url);
        }
    }

    /// 起動済みプロセスを終了する（アプリ終了時に呼ぶ＝ゾンビ化防止）。
    pub fn shutdown(&self) {
        if let Ok(mut g) = self.child.lock() {
            if let Some(mut child) = g.take() {
                let _ = child.kill();
                // Windows の kill()=TerminateProcess は即時終了のため wait() はすぐ返る（終了完了待ちで長くブロックしない）。
                let _ = child.wait();
            }
        }
        if let Ok(mut g) = self.base_url.lock() {
            *g = None;
        }
    }
}

/// 空き TCP ポートを1つ確保して返す（`:0` で bind→drop し OS からポート番号を得る）。
/// 注: drop→spawn の間に別プロセスが同ポートを取りうる TOCTOU はあるが、loopback・数ms・
/// 起動失敗時はフォールバック（手動起動/設定の接続先）があるため許容する。
fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    Some(port)
}

/// 拡張パックの声を並べる置き場（`appData/voicelib`・段階3）。
fn voicelib_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("voicelib"))
}

/// 同じドライブならハードリンク、できなければコピー（同梱の声は約 500MB あるので、毎回の丸写しを避ける）。
fn link_or_copy(src: &Path, dst: &Path) -> std::io::Result<()> {
    if fs::hard_link(src, dst).is_ok() {
        return Ok(());
    }
    fs::copy(src, dst).map(|_| ())
}

/// 同梱の声とパックの声を1つの置き場に並べる（ADR-0060 決定7 追補＝`--voicelib_dir` は1つしか読まない）。
/// 置き場は `<out>/<ENGINE 直下の DLL>` と `<out>/model/*.vvm`。毎回作り直す（外したパックの声を残さない）。
/// ⚠️ **パックの声はコピー**（ハードリンクにしない）＝音声ソフトが開いている間は同じ実体を消せず、パックを外せなくなる。
pub(crate) fn build_voicelib(
    engine_dir: &Path,
    out: &Path,
    voices: &[(String, String, PathBuf)],
) -> std::io::Result<()> {
    if out.exists() {
        fs::remove_dir_all(out)?;
    }
    let model = out.join("model");
    fs::create_dir_all(&model)?;
    for e in fs::read_dir(engine_dir)?.flatten() {
        let p = e.path();
        let ext = p
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.to_ascii_lowercase());
        if p.is_file() && matches!(ext.as_deref(), Some("dll" | "so" | "dylib")) {
            fs::copy(&p, out.join(e.file_name()))?;
        }
    }
    for e in fs::read_dir(engine_dir.join("model"))?.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) == Some("vvm") {
            link_or_copy(&p, &model.join(e.file_name()))?;
        }
    }
    for (pack_id, voice_id, src) in voices {
        fs::copy(src, model.join(format!("pack_{pack_id}__{voice_id}.vvm")))?;
    }
    Ok(())
}

/// 音声ソフトを起こし直す（拡張パックの声を入れた・外したあと＝段階3）。
/// ⚠️ **止めてから置き場を組み直す**＝動いている間は置き場の声のファイルが開かれていて消せない。
#[tauri::command]
pub async fn restart_voice_engine(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<EngineState>().shutdown();
        start_bundled_engine(&app);
    })
    .await
    .map_err(|_| crate::messages::VOICE_ENGINE_RESTART_FAILED.to_string())
}

/// 同梱された ENGINE 実行ファイル（resource_dir/voicevox_engine/run[.exe]）。無ければ None。
fn bundled_engine_exe(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("voicevox_engine");
    let exe = dir.join(if cfg!(windows) { "run.exe" } else { "run" });
    exe.exists().then_some(exe)
}

/// 同梱 ENGINE を空きポートで起動する。同梱が無ければ何もしない（手動起動／設定の接続先へフォールバック）。
/// 起動完了（モデル読込）には数秒かかるため、直後の音声作成が早すぎると失敗しうる（再試行で回復）。
pub fn start_bundled_engine(app: &AppHandle) {
    let Some(exe) = bundled_engine_exe(app) else {
        return; // 同梱なし（開発時・未配置）＝既定/設定の接続先を使う。
    };
    let Some(port) = pick_free_port() else {
        crate::tlog!(
            "voicevox",
            "空きポートの確保に失敗。同梱エンジンの起動を見送ります。"
        );
        return;
    };
    // Windows: GUI アプリ（windows_subsystem=windows）からコンソール向けの run.exe を起こすと、
    // 継承するコンソールが無いため新しい窓が開く。抑止は入口（`proc::no_window_command`）が持つ。
    let mut cmd = no_window_command(&exe);
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string());
    // 拡張パックの声（ADR-0060 段階3）＝あるときだけ、同梱の声と並べた置き場を組んで渡す。
    // ⚠️ **組めなければ同梱の声だけで起こす**（声が全部使えなくなる状態を作らない）。
    let voices = crate::packs::installed_pack_voices(app);
    if !voices.is_empty() {
        match (exe.parent(), voicelib_dir(app)) {
            (Some(engine_dir), Some(out)) => match build_voicelib(engine_dir, &out, &voices) {
                Ok(()) => {
                    cmd.arg("--voicelib_dir").arg(&out);
                    crate::tlog!(
                        "voicevox",
                        "拡張パックの声 {} 個を並べて起動します",
                        voices.len()
                    );
                }
                Err(e) => crate::tlog!(
                    "voicevox",
                    "拡張パックの声の置き場を組めませんでした（同梱の声だけで起動）: {e}"
                ),
            },
            _ => crate::tlog!(
                "voicevox",
                "拡張パックの声の置き場が決まりません（同梱の声だけで起動）"
            ),
        }
    }
    // DLL・モデル・辞書を解決できるよう、作業ディレクトリを ENGINE 直下にする。
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    match cmd.spawn() {
        Ok(child) => {
            let base_url = format!("http://127.0.0.1:{port}");
            app.state::<EngineState>().store(child, base_url.clone());
            crate::tlog!("voicevox", "同梱エンジンを起動しました: {base_url}");
        }
        Err(e) => {
            crate::tlog!(
                "voicevox",
                "同梱エンジンの起動に失敗（設定の接続先／手動起動へフォールバック）: {e}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_voicelib_lays_out_dlls_bundled_and_pack_voices() {
        let tag = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("stario_voicelib_{tag}"));
        let engine = root.join("engine");
        fs::create_dir_all(engine.join("model")).unwrap();
        fs::write(engine.join("voicevox_core.dll"), b"core").unwrap();
        fs::write(engine.join("run.exe"), b"exe").unwrap();
        fs::write(engine.join("model/0.vvm"), b"bundled").unwrap();
        fs::write(engine.join("model/readme.txt"), b"x").unwrap();
        let pack_vvm = root.join("p.vvm");
        fs::write(&pack_vvm, b"pack").unwrap();
        let out = root.join("voicelib");
        // 前回の残り（外したパックの声）は消える。
        fs::create_dir_all(out.join("model")).unwrap();
        fs::write(out.join("model/pack_old__gone.vvm"), b"old").unwrap();
        build_voicelib(
            &engine,
            &out,
            &[("office".to_string(), "aoi".to_string(), pack_vvm.clone())],
        )
        .unwrap();
        let mut names: Vec<String> = fs::read_dir(out.join("model"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["0.vvm", "pack_office__aoi.vvm"]);
        assert_eq!(fs::read(out.join("voicevox_core.dll")).unwrap(), b"core");
        assert!(!out.join("run.exe").exists());
        assert_eq!(
            fs::read(out.join("model/pack_office__aoi.vvm")).unwrap(),
            b"pack"
        );
        assert_eq!(fs::read(out.join("model/0.vvm")).unwrap(), b"bundled");
        let _ = fs::remove_dir_all(&root);
    }
}
