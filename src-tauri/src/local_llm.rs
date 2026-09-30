// このパソコンの中で動画案を作る（ADR-0051）＝同梱の llama.cpp（`llama-server`）と自前で作ったモデルを起動・停止し、生成する。
//
// 作りは同梱の VOICEVOX ENGINE（`voicevox_engine.rs`）と同じ型（決定13）：
// - 置き場所＝`resource_dir/local_llm/{runtime,models}`。無ければ `LOCAL_AI_MISSING`（黙って別の道へ行かない＝決定5）。
// - **初めて生成するときに起動**（アプリの起動では起こさない）・空き番号・`127.0.0.1` だけ・窓を出さない。
// - **しばらく使わなければ止める**・アプリ終了で必ず止める（`shutdown_side_processes`）。
// - 出力の形は**フロントから渡された正典の schema** で縛る（schema の持ち主を1つに）。最後の検証はフロント（ajv）が行う。
use crate::messages::{
    AI_CANCELLED, LOCAL_AI_BROKEN, LOCAL_AI_MISSING, LOCAL_AI_START_FAILED, LOCAL_AI_TIMEOUT,
};
use crate::proc::no_window_command;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// 同梱するモデル（`docs/yuko_recruit_docs/local-llm-build.md` の出力表と同じ値＝版を変えたら両方直す）。
pub const MODEL_FILE: &str = "stario-qwen3.5-2b-q4_k_m.gguf";
pub const MODEL_SIZE: u64 = 1_312_164_800;
pub const MODEL_SHA256: &str = "5405508fd56e0bace3ec4c2484eb4d0f606cbded87760cf3756896e234068b35";

/// 文脈の長さ（トークン）。見た目パターン・素材の一覧つきの指示文と、出力（数千トークン）が収まる大きさ。
const CONTEXT_TOKENS: u32 = 8192;
/// 起動して応えるまで待つ上限（モデルの読み込みを含む）。
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// 1回の生成の上限（最低検証機で CPU だけ＝約 20 トークン/秒）。
const GENERATE_TIMEOUT: Duration = Duration::from_secs(600);
/// 最後の生成からこれだけ使わなければ止める（メモリ約 2.3GB を返す）。
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
/// やめる操作を見る間隔。
const CANCEL_POLL: Duration = Duration::from_millis(200);

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    base_url: Option<String>,
    last_used: Option<Instant>,
    /// この回の起動のあいだ、モデルの SHA-256 を確かめ済みか（1.3GB を毎回は読まない＝決定14）。
    verified: bool,
    /// いま走っている生成の数（#1286 レビュー 🟡）＝1つでも走っている間は「しばらく使っていない」で止めない。
    in_flight: u32,
}

/// 「しばらく使っていない」で止めてよいか（純粋関数）。**生成が走っている間は止めない**
/// （長い生成の終わり際に止めると、利用者には「準備ができませんでした」と誤って見える＝#1286 レビュー 🟡）。
pub fn should_stop_idle(
    last_used: Option<Instant>,
    in_flight: u32,
    now: Instant,
    idle: Duration,
) -> bool {
    in_flight == 0 && last_used.is_some_and(|t| now.saturating_duration_since(t) >= idle)
}

/// 生成が走っている間を数える（落としたときに必ず数を戻す＝やめた・失敗した道でも漏らさない）。
struct InFlight<'a>(&'a LocalLlmState);
impl<'a> InFlight<'a> {
    fn begin(state: &'a LocalLlmState) -> Self {
        if let Ok(mut g) = state.inner.lock() {
            g.in_flight += 1;
            g.last_used = Some(Instant::now());
        }
        InFlight(state)
    }
}
impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.0.inner.lock() {
            g.in_flight = g.in_flight.saturating_sub(1);
            g.last_used = Some(Instant::now());
        }
    }
}

/// 起動したローカル実行の状態（Tauri の管理状態）。
#[derive(Default)]
pub struct LocalLlmState {
    inner: Mutex<Inner>,
    /// 起動を1本にまとめる（同時に2回押しても2つ起動しない）。
    starting: tokio::sync::Mutex<()>,
}

impl LocalLlmState {
    /// 起動済みなら止める（アプリ終了・しばらく使わなかったとき）。
    pub fn shutdown(&self) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(mut child) = g.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            g.base_url = None;
            g.last_used = None;
        }
    }

    /// 動いていて**応えることを確かめ済み**なら接続先を返す（途中で止まっていたら片付けて None）。
    /// 起動を待っている間は子プロセスだけがあり接続先は None＝None を返す（待つのは `starting`）。
    fn running_base_url(&self) -> Option<String> {
        let mut g = self.inner.lock().ok()?;
        let alive = match g.child.as_mut() {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        };
        if !alive {
            g.child = None;
            g.base_url = None;
            return None;
        }
        g.base_url.clone()
    }

    /// 起動を待っている子プロセスが止まったか（待ちの途中で見る）。
    fn starting_child_exited(&self) -> Option<std::process::ExitStatus> {
        let mut g = self.inner.lock().ok()?;
        g.child.as_mut().and_then(|c| c.try_wait().ok().flatten())
    }
}

/// 同梱物の場所（実行ファイル・モデル）。
fn bundle_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let dir = app.path().resource_dir().ok()?.join("local_llm");
    let exe = dir.join("runtime").join(if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    });
    let model = dir.join("models").join(MODEL_FILE);
    Some((exe, model))
}

/// 同梱されているか（実行ファイルとモデルが両方ある）。
fn is_bundled(app: &AppHandle) -> bool {
    bundle_paths(app).is_some_and(|(exe, model)| exe.is_file() && model.is_file())
}

/// モデルの照合の結果。
#[derive(Debug, PartialEq, Eq)]
pub enum ModelCheck {
    Ok,
    Missing,
    Broken,
}

/// 大きさを見る（毎回・安い）。
pub fn check_model_size(path: &Path, expected: u64) -> ModelCheck {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() && m.len() == expected => ModelCheck::Ok,
        Ok(m) if m.is_file() => ModelCheck::Broken,
        _ => ModelCheck::Missing,
    }
}

/// SHA-256 を見る（重い＝起動の回に1度だけ）。
pub fn check_model_sha256(path: &Path, expected_hex: &str) -> ModelCheck {
    let Ok(mut f) = std::fs::File::open(path) else {
        return ModelCheck::Missing;
    };
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(_) => return ModelCheck::Broken,
        }
    }
    let got = hasher.finalize();
    let hex: String = got.iter().map(|b| format!("{b:02x}")).collect();
    if hex == expected_hex {
        ModelCheck::Ok
    } else {
        ModelCheck::Broken
    }
}

fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    listener.local_addr().ok().map(|a| a.port())
}

/// 生成に使う HTTP の口（外部 AI とは別＝時間の上限が違う）。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(GENERATE_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// しばらく使わなければ止める見張り（1つだけ）。
fn ensure_idle_watcher(app: &AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let state = app.state::<LocalLlmState>();
            let idle = state.inner.lock().ok().is_some_and(|g| {
                should_stop_idle(g.last_used, g.in_flight, Instant::now(), IDLE_STOP)
            });
            if idle {
                crate::tlog!("local_llm", "しばらく使われなかったので止めます");
                state.shutdown();
            }
        }
    });
}

/// 動いていなければ起動し、応えるまで待つ。接続先（`http://127.0.0.1:PORT`）を返す。失敗は画面に出す文。
///
/// ⚠️ **起動した瞬間から状態に持つ**（#1286 レビュー 🔴）＝応えるまで（最大 120 秒）ローカル変数のままだと、
///   その間にアプリを閉じたとき `shutdown` が見つけられず、約 2.3GB を握ったまま残る。接続先は応えるまで None。
/// ⚠️ **起動の途中でも「やめる」を見る**（#1286 レビュー 🔴）＝照合（1.3GB を読む）と応答待ちの間も止められる。
async fn ensure_started(
    app: &AppHandle,
    state: &LocalLlmState,
    gen: u64,
) -> Result<String, String> {
    if let Some(url) = state.running_base_url() {
        return Ok(url);
    }
    let _guard = state.starting.lock().await;
    if let Some(url) = state.running_base_url() {
        return Ok(url);
    }
    let Some((exe, model)) = bundle_paths(app) else {
        return Err(LOCAL_AI_MISSING.to_string());
    };
    if !exe.is_file() {
        crate::tlog!("local_llm", "実行の部品がありません: {}", exe.display());
        return Err(LOCAL_AI_MISSING.to_string());
    }
    match check_model_size(&model, MODEL_SIZE) {
        ModelCheck::Ok => {}
        ModelCheck::Missing => {
            crate::tlog!("local_llm", "モデルがありません: {}", model.display());
            return Err(LOCAL_AI_MISSING.to_string());
        }
        ModelCheck::Broken => {
            crate::tlog!(
                "local_llm",
                "モデルの大きさが合いません: {}",
                model.display()
            );
            return Err(LOCAL_AI_BROKEN.to_string());
        }
    }
    if crate::ai::is_superseded(gen) {
        return Err(AI_CANCELLED.to_string());
    }
    let verified = state.inner.lock().map(|g| g.verified).unwrap_or(false);
    if !verified {
        let m = model.clone();
        let check =
            tauri::async_runtime::spawn_blocking(move || check_model_sha256(&m, MODEL_SHA256))
                .await
                .unwrap_or(ModelCheck::Broken);
        if check != ModelCheck::Ok {
            crate::tlog!("local_llm", "モデルの照合が合いません: {}", model.display());
            return Err(if check == ModelCheck::Missing {
                LOCAL_AI_MISSING
            } else {
                LOCAL_AI_BROKEN
            }
            .to_string());
        }
        if let Ok(mut g) = state.inner.lock() {
            g.verified = true;
        }
    }
    if crate::ai::is_superseded(gen) {
        return Err(AI_CANCELLED.to_string());
    }
    // ⚠️ 空き番号を選んでから llama-server が使うまでに、ほかのプログラムに取られうる（同梱の VOICEVOX ENGINE と
    //   同じ既知の制約）。取られたら起動に失敗し `LOCAL_AI_START_FAILED`＝もう一度押せば別の番号で起動する。
    let Some(port) = pick_free_port() else {
        return Err(LOCAL_AI_START_FAILED.to_string());
    };
    let mut cmd = no_window_command(&exe);
    cmd.arg("-m")
        .arg(&model)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-c",
            &CONTEXT_TOKENS.to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    let child = cmd.spawn().map_err(|e| {
        crate::tlog!("local_llm", "起動できません: {e}");
        LOCAL_AI_START_FAILED.to_string()
    })?;
    if let Ok(mut g) = state.inner.lock() {
        g.child = Some(child);
        g.base_url = None;
    }
    let base_url = format!("http://127.0.0.1:{port}");
    let started = Instant::now();
    loop {
        if let Some(status) = state.starting_child_exited() {
            crate::tlog!("local_llm", "起動の途中で止まりました: {status}");
            state.shutdown();
            return Err(LOCAL_AI_START_FAILED.to_string());
        }
        if crate::ai::is_superseded(gen) {
            crate::tlog!("local_llm", "起動の途中でやめました");
            state.shutdown();
            return Err(AI_CANCELLED.to_string());
        }
        let ok = http_client()
            .get(format!("{base_url}/health"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            break;
        }
        if started.elapsed() >= START_TIMEOUT {
            crate::tlog!("local_llm", "応えるまでに時間がかかりすぎました");
            state.shutdown();
            return Err(LOCAL_AI_START_FAILED.to_string());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    crate::tlog!(
        "local_llm",
        "起動しました（{:.1} 秒）",
        started.elapsed().as_secs_f32()
    );
    if let Ok(mut g) = state.inner.lock() {
        g.base_url = Some(base_url.clone());
        g.last_used = Some(Instant::now());
    }
    ensure_idle_watcher(app);
    Ok(base_url)
}

/// 生成の本文（OpenAI 互換の chat completions・出力の形を正典の schema で縛る）。
pub fn build_request_body(
    system: &str,
    user: &str,
    schema: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "response_format": { "type": "json_schema", "json_schema": { "name": "ai_video_plan", "schema": schema } },
        // 考える段は切る＝待ち時間を延ばさず、出力は JSON だけにする。
        "chat_template_kwargs": { "enable_thinking": false },
        "temperature": 0.2,
    })
}

/// 応答から本文を取り出す。
pub fn extract_content(resp: &serde_json::Value) -> Option<String> {
    resp.get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// 同梱されているか（設定画面の表示に使う）。
#[tauri::command]
pub fn local_ai_available(app: AppHandle) -> bool {
    is_bundled(&app)
}

/// このパソコンの中で動画案を作る。戻り値は応答の本文（JSON の文字列）。検証はフロントが行う（§2-2）。
#[tauri::command]
pub async fn local_ai_generate(
    app: AppHandle,
    state: State<'_, LocalLlmState>,
    system: String,
    user: String,
    schema: String,
) -> Result<String, String> {
    let gen = crate::ai::begin_generation();
    let schema: serde_json::Value = serde_json::from_str(&schema)
        .map_err(|_| crate::messages::AI_REQUEST_FAILED.to_string())?;
    // 起動の前から「走っている」と数える＝起動し終えてから数え始めるまでの間に、見張りが止める道を作らない。
    let _in_flight = InFlight::begin(&state);
    let base = ensure_started(&app, &state, gen).await?;
    if crate::ai::is_superseded(gen) {
        return Err(AI_CANCELLED.to_string());
    }
    let body = build_request_body(&system, &user, schema);
    let started = Instant::now();
    // 送って、本文を読み終えるまでを1つにする＝本文の読み取りも「やめる」と時間切れの対象にする（#1286 レビュー 🟡）。
    let request = async {
        let resp = http_client()
            .post(format!("{base}/v1/chat/completions"))
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let json: serde_json::Value = resp.json().await?;
        Ok::<_, reqwest::Error>((status, json))
    };
    // やめる操作を見ながら待つ＝やめたら接続を切る（相手は生成を止める）。
    let cancelled = async {
        loop {
            tokio::time::sleep(CANCEL_POLL).await;
            if crate::ai::is_superseded(gen) {
                break;
            }
        }
    };
    let result = tokio::select! {
        r = request => r,
        _ = cancelled => return Err(AI_CANCELLED.to_string()),
    };
    let (status, json) = result.map_err(|e| {
        crate::tlog!("local_llm", "生成に失敗しました: {e}");
        if e.is_timeout() {
            LOCAL_AI_TIMEOUT.to_string()
        } else if e.is_decode() {
            crate::messages::AI_REQUEST_FAILED.to_string()
        } else {
            LOCAL_AI_START_FAILED.to_string()
        }
    })?;
    if !status.is_success() {
        crate::tlog!(
            "local_llm",
            "生成が断られました: status={status} body={}",
            json.to_string().chars().take(500).collect::<String>()
        );
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    crate::tlog!(
        "local_llm",
        "生成しました（{:.1} 秒・{}）",
        started.elapsed().as_secs_f32(),
        json.get("timings")
            .map(|t| t.to_string())
            .unwrap_or_default()
    );
    extract_content(&json).ok_or_else(|| crate::messages::AI_REQUEST_FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 検査ごとに別の名前（並んで走る検査が互いのファイルを消さない）。
    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let p = std::env::temp_dir().join(format!("stario-llm-test-{}-{name}", std::process::id()));
        std::fs::File::create(&p).unwrap().write_all(bytes).unwrap();
        p
    }

    #[test]
    fn size_check_distinguishes_missing_and_broken() {
        let p = temp_file("size", b"abc");
        assert_eq!(check_model_size(&p, 3), ModelCheck::Ok);
        assert_eq!(check_model_size(&p, 4), ModelCheck::Broken);
        assert_eq!(
            check_model_size(&p.with_extension("none"), 3),
            ModelCheck::Missing
        );
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn sha256_check_matches_known_value() {
        // "abc" の SHA-256（FIPS 180-2 の例）。
        let p = temp_file("sha", b"abc");
        assert_eq!(
            check_model_sha256(
                &p,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            ),
            ModelCheck::Ok
        );
        assert_eq!(check_model_sha256(&p, &"0".repeat(64)), ModelCheck::Broken);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn request_body_constrains_output_to_schema_and_turns_off_thinking() {
        let body = build_request_body("sys", "usr", serde_json::json!({"type": "object"}));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "usr");
        assert_eq!(body["response_format"]["type"], "json_schema");
        assert_eq!(
            body["response_format"]["json_schema"]["schema"]["type"],
            "object"
        );
        assert_eq!(body["chat_template_kwargs"]["enable_thinking"], false);
    }

    #[test]
    fn idle_stop_waits_for_running_generations() {
        let now = Instant::now();
        let idle = Duration::from_secs(600);
        let old = now.checked_sub(Duration::from_secs(601));
        // 使われてから 600 秒を過ぎ、走っている生成が無い＝止める。
        assert!(should_stop_idle(old, 0, now, idle));
        // 走っている生成があれば、どれだけ前でも止めない。
        assert!(!should_stop_idle(old, 1, now, idle));
        // まだ 600 秒たっていない＝止めない。
        assert!(!should_stop_idle(
            now.checked_sub(Duration::from_secs(599)),
            0,
            now,
            idle
        ));
        // 一度も使っていない＝止める理由が無い。
        assert!(!should_stop_idle(None, 0, now, idle));
    }

    #[test]
    fn extract_content_reads_first_choice() {
        let v = serde_json::json!({"choices": [{"message": {"content": "{\"a\":1}"}}]});
        assert_eq!(extract_content(&v).as_deref(), Some("{\"a\":1}"));
        assert_eq!(extract_content(&serde_json::json!({})), None);
    }
}
