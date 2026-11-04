// VOICEVOX ENGINE（ローカル HTTP サーバ）の同梱・起動・終了（ADR-0005・#149・ADR-0071）。
// 同梱した ENGINE（resource_dir/voicevox_engine/run[.exe]）を空きポートで起動し、アプリ終了時に終了する。
// ⚠️ **使うときに起動し、しばらく使わなければ止める**（ADR-0071）＝アプリの起動時には起こさない（約 0.5GB を握り続けない）。
// バイナリが同梱されていなければ何もしない＝従来どおり手動起動の ENGINE／設定の接続先へフォールバック（dev/CI も不変）。
use crate::packs::DeclaredVoice;
use crate::proc::no_window_command;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// 最後に使ってからこれだけたったら止める（同梱の AI と同じ＝ADR-0071 決定2）。
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
/// 止める見張りの間隔。
const IDLE_POLL: Duration = Duration::from_secs(60);

/// 使い方の数え上げ（ADR-0071 決定2）。⚠️ **止める判断と同じ錠で数える**＝数え始めた直後に止めない。
#[derive(Default)]
struct Usage {
    last_used: Option<Instant>,
    in_flight: u32,
}

/// 起動した同梱 ENGINE の状態（プロセスハンドルと接続先 base_url）。Tauri の管理状態として保持する。
#[derive(Default)]
pub struct EngineState {
    child: Mutex<Option<Child>>,
    base_url: Mutex<Option<String>>,
    usage: Mutex<Usage>,
    /// 起動の糸が走っている間 true（待つ側が「起動に失敗した」と「まだ起動中」を見分ける）。
    starting: AtomicBool,
}

impl EngineState {
    /// 起動済みの同梱 ENGINE の base_url（`http://127.0.0.1:PORT`）。未起動なら None。
    /// ⚠️ **プロセスが終わっていたら None**（ADR-0071 決定4）＝落ちたエンジンの番号へ頼み続けない（次に使うとき起こし直す）。
    pub fn base_url(&self) -> Option<String> {
        if let Ok(mut g) = self.child.lock() {
            let exited = g
                .as_mut()
                .is_some_and(|c| !matches!(c.try_wait(), Ok(None)));
            if exited {
                *g = None;
                if let Ok(mut b) = self.base_url.lock() {
                    *b = None;
                }
                crate::tlog!(
                    "voicevox",
                    "同梱エンジンが終わっていました（次に使うとき起動します）"
                );
                return None;
            }
        }
        self.base_url.lock().ok().and_then(|g| g.clone())
    }

    /// 起動の糸が走っているか。
    pub fn is_starting(&self) -> bool {
        self.starting.load(Ordering::SeqCst)
    }

    /// 頼みごとを始める（終わったら落とす＝`EngineUse` が数を戻し、最後に使った時刻を進める）。
    /// ⚠️ 走っている間は数で止めない（時刻は終わったときに付ければ足りる＝変異チェックで等価と分かった）。
    pub fn begin_use(&self) -> EngineUse<'_> {
        if let Ok(mut u) = self.usage.lock() {
            u.in_flight += 1;
        }
        EngineUse(self)
    }

    /// 使った印だけ付ける（裏で起こしたときも 10 分で止まるように＝印が無いと永久に止まらない）。
    fn touch(&self) {
        if let Ok(mut u) = self.usage.lock() {
            u.last_used = Some(Instant::now());
        }
    }

    /// しばらく使っていなければ止める（止めたら true）。⚠️ 判断と停止を**使い方の錠の中**で行う。
    fn stop_if_idle(&self, now: Instant) -> bool {
        let Ok(u) = self.usage.lock() else {
            return false;
        };
        if !crate::local_llm::should_stop_idle(u.last_used, u.in_flight, now, IDLE_STOP) {
            return false;
        }
        let running = self.child.lock().map(|g| g.is_some()).unwrap_or(false);
        if !running {
            return false;
        }
        self.shutdown();
        true
    }

    fn store(&self, child: Child, base_url: String) {
        if let Ok(mut g) = self.child.lock() {
            // ⚠️ **前のプロセスが残っていたら止めてから置く**＝上書きすると持ち手を失い、終了時にも止められない。
            if let Some(mut old) = g.replace(child) {
                let _ = old.kill();
                let _ = old.wait();
            }
        }
        if let Ok(mut g) = self.base_url.lock() {
            *g = Some(base_url);
        }
    }

    /// 起動済みプロセスを終了する（アプリ終了時・しばらく使わなかったとき・起こし直し）。
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

/// 走っている頼みごと1つ（落とすと数を戻し、最後に使った時刻を進める＝失敗した道でも漏らさない）。
pub struct EngineUse<'a>(&'a EngineState);
impl Drop for EngineUse<'_> {
    fn drop(&mut self) {
        if let Ok(mut u) = self.0.usage.lock() {
            u.in_flight = u.in_flight.saturating_sub(1);
            u.last_used = Some(Instant::now());
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

/// 置き場の中身の「名前」（並べるファイルの名前・大きさ・更新時刻）。同じなら組み直さない。
fn voicelib_signature(engine_dir: &Path, voices: &[DeclaredVoice]) -> String {
    let stamp = |p: &Path| {
        fs::metadata(p)
            .map(|m| {
                let t = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                format!("{}:{t}", m.len())
            })
            .unwrap_or_default()
    };
    let mut lines = Vec::new();
    for dir in [engine_dir.to_path_buf(), engine_dir.join("model")] {
        if let Ok(rd) = fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_file() {
                    lines.push(format!("{}={}", p.display(), stamp(&p)));
                }
            }
        }
    }
    for v in voices {
        lines.push(format!(
            "pack_{}__{}={}",
            v.pack_id,
            v.voice_id,
            stamp(&v.path)
        ));
    }
    lines.sort();
    lines.join("\n")
}

const VOICELIB_SIGNATURE: &str = ".contents";

/// 同梱の声とパックの声を1つの置き場に並べる（ADR-0060 決定7 追補＝`--voicelib_dir` は1つしか読まない）。
/// 置き場は `<out>/<ENGINE 直下の DLL>` と `<out>/model/*.vvm`。**中身が前と同じなら組み直さない**（起動を待たせない）。
/// ⚠️ **パックの声はコピー**（ハードリンクにしない）＝音声ソフトが開いている間は同じ実体を消せず、パックを外せなくなる。
/// ⚠️ 置き場のファイル名 `pack_<packId>__<voiceId>.vvm` は 11 §2 の名前空間（`packIdPrefix`）と同じ形＝packId に `__` が無いので重ならない。
pub(crate) fn build_voicelib(
    engine_dir: &Path,
    out: &Path,
    voices: &[DeclaredVoice],
) -> std::io::Result<()> {
    let sig = voicelib_signature(engine_dir, voices);
    if fs::read_to_string(out.join(VOICELIB_SIGNATURE))
        .ok()
        .as_deref()
        == Some(sig.as_str())
    {
        return Ok(());
    }
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
    // ⚠️ **同じファイルは1回だけ置く**＝1つの声のファイルに複数のキャラが入っていて、パックがそれぞれを声として書くことがある
    //   （例：紅桜と雀松朱司）。2回置くと音声ソフトに同じ番号が2つずつ並ぶ。
    let mut placed: Vec<&Path> = Vec::new();
    for v in voices {
        if placed.contains(&v.path.as_path()) {
            continue;
        }
        placed.push(&v.path);
        fs::copy(
            &v.path,
            model.join(format!("pack_{}__{}.vvm", v.pack_id, v.voice_id)),
        )?;
    }
    // ⚠️ **名前は最後に書く**＝途中で失敗したら名前が無いので、次は必ず組み直す。
    fs::write(out.join(VOICELIB_SIGNATURE), sig)?;
    Ok(())
}

/// 起こし直しを1本ずつ通す（重なると、先に起こしたプロセスの持ち手を失い、終了時にも止められない）。
static RESTART_LOCK: Mutex<()> = Mutex::new(());

/// 音声ソフトを起こし直す（拡張パックの声を入れた・外したあと＝段階3）。
/// ⚠️ **止めてから置き場を組み直す**＝動いている間は置き場の声のファイルが開かれていて消せない。
/// ⚠️ **パックの声を渡せなかった・起こせなかったら失敗として返す**（画面が `VOICE_ENGINE_RESTART_FAILED` を出す）。
///   渡せなかったときも同梱の声だけでは起こしておく（声が全部使えなくなる状態を作らない）。
#[tauri::command]
pub async fn restart_voice_engine(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = RESTART_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        app.state::<EngineState>().shutdown();
        // 起こしたものも 10 分で止まるように印を付ける（ADR-0071）。
        app.state::<EngineState>().touch();
        ensure_idle_watcher(&app);
        match start_engine(&app) {
            Ok(EngineStart::Started { packs_ok: true }) | Ok(EngineStart::NotBundled) => Ok(()),
            _ => Err(crate::messages::VOICE_ENGINE_RESTART_FAILED.to_string()),
        }
    })
    .await
    .map_err(|_| crate::messages::VOICE_ENGINE_RESTART_FAILED.to_string())?
}

/// 同梱された ENGINE の置き場（resource_dir/voicevox_engine）。実行ファイルが無ければ None。
pub(crate) fn bundled_engine_dir(app: &AppHandle) -> Option<PathBuf> {
    bundled_engine_exe(app).and_then(|e| e.parent().map(Path::to_path_buf))
}

/// 同梱された ENGINE 実行ファイル（resource_dir/voicevox_engine/run[.exe]）。無ければ None。
fn bundled_engine_exe(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("voicevox_engine");
    let exe = dir.join(if cfg!(windows) { "run.exe" } else { "run" });
    exe.exists().then_some(exe)
}

enum EngineStart {
    /// 同梱が無い（開発時・未配置）。
    NotBundled,
    /// 起こした。`packs_ok`＝入っているパックの声を（あれば）渡せた。
    Started { packs_ok: bool },
}

/// 同梱 ENGINE が動いていなければ、**裏で**起動を始める（待たない・ADR-0071 決定1）。
/// 同梱が無い・もう動いている・起動中なら何もしない。止める見張りもここで1度だけ立てる。
/// ⚠️ **パックの声があると置き場を組む**（初回や別ドライブでは大きなコピーになりうる）＝呼んだ側を待たせないよう別の糸で起こす。
pub fn kick_bundled_engine(app: &AppHandle) {
    let state = app.state::<EngineState>();
    state.touch();
    ensure_idle_watcher(app);
    if bundled_engine_exe(app).is_none() || state.base_url().is_some() {
        return;
    }
    if state.starting.swap(true, Ordering::SeqCst) {
        return; // もう起動中
    }
    let app = app.clone();
    std::thread::spawn(move || {
        {
            let _guard = RESTART_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // 錠を待つ間にほかが起こしていたら起こさない（二重に起こすと前のを止めることになる）。
            if app.state::<EngineState>().base_url().is_none() {
                if let Err(e) = start_engine(&app) {
                    crate::tlog!("voicevox", "同梱エンジンの起動に失敗: {e}");
                }
            }
        }
        app.state::<EngineState>()
            .starting
            .store(false, Ordering::SeqCst);
    });
}

/// 同梱されているか（されていなければ、待つ側は設定の接続先／既定へ回る）。
pub fn is_bundled(app: &AppHandle) -> bool {
    bundled_engine_exe(app).is_some()
}

/// しばらく使わなければ止める見張り（1つだけ・ADR-0071 決定2）。
fn ensure_idle_watcher(app: &AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(IDLE_POLL);
        let state = app.state::<EngineState>();
        // ⚠️ 起こし直し（パックの声）と重ねない。
        let _guard = RESTART_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if state.stop_if_idle(Instant::now()) {
            crate::tlog!(
                "voicevox",
                "しばらく使われなかったので同梱エンジンを止めました"
            );
        }
    });
}

fn start_engine(app: &AppHandle) -> Result<EngineStart, String> {
    let Some(exe) = bundled_engine_exe(app) else {
        return Ok(EngineStart::NotBundled); // 同梱なし（開発時・未配置）＝既定/設定の接続先を使う。
    };
    let Some(port) = pick_free_port() else {
        crate::tlog!(
            "voicevox",
            "空きポートの確保に失敗。同梱エンジンの起動を見送ります。"
        );
        return Err("port".into());
    };
    // Windows: GUI アプリ（windows_subsystem=windows）からコンソール向けの run.exe を起こすと、
    // 継承するコンソールが無いため新しい窓が開く。抑止は入口（`proc::no_window_command`）が持つ。
    let mut cmd = no_window_command(&exe);
    // ⚠️ **エンジンの出力は受け取らない**（通し点検 2026-10-16）＝受け継ぐと、起動の引数で頼まれた回に
    //   **頼んだ側の標準出力へ辞書の作成の進み具合が数千字流れ込み**、標準エラーにもエンジンのログが混ざった
    //   （`18 §18.5`＝標準出力は結果の受け渡しに使われうるので混ぜない・断りの文は1行）。
    //   画面から起こした回はもともと行き先が無い（窓のアプリにコンソールは無い）＝失うものは無い。
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string());
    // 拡張パックの声（ADR-0060 段階3）＝採る声の判定は `packs::voice_plan` の1か所（画面も同じ結果を使う）。
    // ⚠️ **組めなければ同梱の声だけで起こす**（声が全部使えなくなる状態を作らない）が、失敗としては返す。
    let mut packs_ok = true;
    let engine_dir = exe.parent().map(Path::to_path_buf);
    let voices = crate::packs::voice_plan(app, engine_dir.as_deref()).0;
    if let (Some(engine_dir), Some(out)) = (engine_dir.as_deref(), voicelib_dir(app)) {
        if voices.is_empty() {
            // 声のパックが無くなったら置き場も消す（コピーだと 500MB を超えて残る）。
            if out.exists() {
                let _ = fs::remove_dir_all(&out);
            }
        } else {
            match build_voicelib(engine_dir, &out, &voices) {
                Ok(()) => {
                    cmd.arg("--voicelib_dir").arg(&out);
                    crate::tlog!(
                        "voicevox",
                        "拡張パックの声 {} 個を並べて起動します",
                        voices.len()
                    );
                }
                Err(e) => {
                    packs_ok = false;
                    crate::tlog!(
                        "voicevox",
                        "拡張パックの声の置き場を組めませんでした（同梱の声だけで起動）: {e}"
                    );
                }
            }
        }
    } else if !voices.is_empty() {
        packs_ok = false;
    }
    // DLL・モデル・辞書を解決できるよう、作業ディレクトリを ENGINE 直下にする。
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    match cmd.spawn() {
        Ok(child) => {
            // 異常終了でも残さない（`proc::bind_to_app_lifetime`）。
            crate::proc::bind_to_app_lifetime(&child);
            let base_url = format!("http://127.0.0.1:{port}");
            app.state::<EngineState>().store(child, base_url.clone());
            crate::tlog!("voicevox", "同梱エンジンを起動しました: {base_url}");
            Ok(EngineStart::Started { packs_ok })
        }
        Err(e) => {
            crate::tlog!(
                "voicevox",
                "同梱エンジンの起動に失敗（設定の接続先／手動起動へフォールバック）: {e}"
            );
            Err(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// しばらく動き続ける子（エンジンの代わり）。
    fn long_child() -> Child {
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("ping", &["-n", "30", "127.0.0.1"])
        } else {
            ("sleep", &["30"])
        };
        no_window_command(program)
            .args(args)
            .stdout(Stdio::null())
            .spawn()
            .expect("spawn")
    }

    #[test]
    fn idle_stop_waits_for_running_requests_and_then_stops() {
        let st = EngineState::default();
        st.store(long_child(), "http://127.0.0.1:1".into());
        let later = Instant::now() + IDLE_STOP + Duration::from_secs(1);
        // 頼みが走っている間は、10 分たっていても止めない（ADR-0071 決定2）。
        let using = st.begin_use();
        assert!(!st.stop_if_idle(later));
        assert!(st.base_url().is_some());
        drop(using);
        // 使い終えた直後はまだ止めない（使い終えた時刻から数える）。
        assert!(!st.stop_if_idle(Instant::now()));
        // 10 分たてば止める。止めたら接続先も消え、止めたものをもう一度止めようとはしない。
        assert!(st.stop_if_idle(Instant::now() + IDLE_STOP + Duration::from_secs(1)));
        assert!(st.base_url().is_none());
        assert!(!st.stop_if_idle(Instant::now() + IDLE_STOP * 3));
    }

    #[test]
    fn idle_stop_needs_a_use_mark() {
        // 印が無い（一度も使っていない）のに止める、はしない。印を付ければ 10 分で止まる＝裏で起こしただけでも残らない。
        let st = EngineState::default();
        st.store(long_child(), "http://127.0.0.1:1".into());
        assert!(!st.stop_if_idle(Instant::now() + IDLE_STOP * 2));
        st.touch();
        assert!(st.stop_if_idle(Instant::now() + IDLE_STOP + Duration::from_secs(1)));
    }

    #[test]
    fn exited_engine_is_not_running() {
        // 落ちたエンジンの番号へ頼み続けない（ADR-0071 決定4）。
        let st = EngineState::default();
        let mut c = long_child();
        c.kill().unwrap();
        c.wait().unwrap();
        st.store(c, "http://127.0.0.1:1".into());
        assert!(st.base_url().is_none());
    }

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
        // 同じファイルを2つの声が指す（1つのファイルに2人のキャラ）＝置くのは1回だけ。
        let voices = [
            DeclaredVoice {
                pack_id: "office".into(),
                voice_id: "aoi".into(),
                path: pack_vvm.clone(),
                character: "雀松朱司".into(),
                speakers: vec![9001],
            },
            DeclaredVoice {
                pack_id: "office".into(),
                voice_id: "beni".into(),
                path: pack_vvm.clone(),
                character: "†聖騎士 紅桜†".into(),
                speakers: vec![9002],
            },
        ];
        build_voicelib(&engine, &out, &voices).unwrap();
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
        // 中身が同じなら組み直さない（目印に置いたファイルが残る）／パックの声が変われば組み直す（目印は消える）。
        fs::write(out.join("model/marker"), b"m").unwrap();
        build_voicelib(&engine, &out, &voices).unwrap();
        assert!(out.join("model/marker").exists());
        fs::write(&pack_vvm, b"pack-v2-longer").unwrap();
        build_voicelib(&engine, &out, &voices).unwrap();
        assert!(!out.join("model/marker").exists());
        assert_eq!(
            fs::read(out.join("model/pack_office__aoi.vvm")).unwrap(),
            b"pack-v2-longer"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
