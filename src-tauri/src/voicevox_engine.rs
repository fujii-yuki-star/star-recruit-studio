// VOICEVOX ENGINE（ローカル HTTP サーバ）の同梱・自動起動・自動終了（ADR-0005・#149）。
// 同梱した ENGINE（resource_dir/voicevox_engine/run[.exe]）を空きポートで起動し、アプリ終了時に終了する。
// バイナリが同梱されていなければ何もしない＝従来どおり手動起動の ENGINE／設定の接続先へフォールバック（dev/CI も不変）。
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
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
        eprintln!("[voicevox] 空きポートの確保に失敗。同梱エンジンの起動を見送ります。");
        return;
    };
    let mut cmd = Command::new(&exe);
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string());
    // DLL・モデル・辞書を解決できるよう、作業ディレクトリを ENGINE 直下にする。
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    match cmd.spawn() {
        Ok(child) => {
            let base_url = format!("http://127.0.0.1:{port}");
            app.state::<EngineState>().store(child, base_url.clone());
            eprintln!("[voicevox] 同梱エンジンを起動しました: {base_url}");
        }
        Err(e) => {
            eprintln!("[voicevox] 同梱エンジンの起動に失敗（設定の接続先／手動起動へフォールバック）: {e}");
        }
    }
}
