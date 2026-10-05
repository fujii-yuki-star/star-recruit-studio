// このパソコンの中で動画案を作る（ADR-0051）＝同梱の llama.cpp（`llama-server`）と自前で作ったモデルを起動・停止し、生成する。
//
// 作りは同梱の VOICEVOX ENGINE（`voicevox_engine.rs`）と同じ型（決定13）：
// - 置き場所＝`resource_dir/local_llm/{runtime,models}`。無ければ `LOCAL_AI_MISSING`（黙って別の道へ行かない＝決定5）。
// - **初めて生成するときに起動**（アプリの起動では起こさない）・空き番号・`127.0.0.1` だけ・窓を出さない。
// - **しばらく使わなければ止める**・アプリ終了で必ず止める（`shutdown_side_processes`）。
// - 出力の形は**フロントから渡された正典の schema** で縛る（schema の持ち主を1つに）。最後の検証はフロント（ajv）が行う。
// - **写真も読める**（ADR-0052 決定4）＝視覚の部品（`mmproj`）が同梱されていれば一緒に読み込む。無くても動画案は作れる。
use crate::messages::{
    AI_CANCELLED, LOCAL_AI_BROKEN, LOCAL_AI_MISSING, LOCAL_AI_START_FAILED, LOCAL_AI_TIMEOUT,
    LOCAL_AI_TOO_LONG,
};
use crate::proc::no_window_command;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// 同梱するモデル（`docs/yuko_recruit_docs/local-llm-build.md` の出力表と同じ値＝版を変えたら両方直す）。
pub const MODEL_FILE: &str = "stario-qwen3.5-2b-q4_k_m.gguf";
pub const MODEL_SIZE: u64 = 1_312_164_800;
pub const MODEL_SHA256: &str = "5405508fd56e0bace3ec4c2484eb4d0f606cbded87760cf3756896e234068b35";

/// 同梱する視覚の部品（写真を読む・ADR-0052 決定4）。値は `local-llm-build.md` の出力表と同じ。
pub const MMPROJ_FILE: &str = "stario-qwen3.5-2b-mmproj-q8_0.gguf";
pub const MMPROJ_SIZE: u64 = 364_664_384;
pub const MMPROJ_SHA256: &str = "526dbf85f350baf3a5107b1f14e629e94571c7cbab4277476fbdaaa8c4a31a64";
/// 写真1枚に使うトークンの上限（最低検証機で約 10 秒／枚＝ADR-0052 の実測）。
const IMAGE_MAX_TOKENS: u32 = 256;
/// 読む写真のファイルの大きさの上限（丸ごと読んで data URL にするので、元＋約 1.33 倍が同時にメモリに載る）。
/// 越えたら読まない（写真の説明が付かないだけ＝動画案づくりは今どおり）。
pub const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// 文脈の長さ（トークン）。見た目パターン・素材の一覧つきの指示文と、出力（数千トークン）が収まる大きさ。
const CONTEXT_TOKENS: u32 = 8192;
/// 1回の出力の上限（トークン）＝ADR-0052 決定6・#1293。ふつうの動画案は 600〜1,100 トークン（最低検証機の実測）＝約3倍。
/// ⚠️ **止まらずに出し続ける回がある**（実測で1回・文脈いっぱいまで）＝上限が無いと 600 秒の待ちの末に読めない、になる。
pub const MAX_OUTPUT_TOKENS: u32 = 3072;
/// 起動して応えるまで待つ上限（モデルの読み込みを含む）。
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// 1回の生成の上限（最低検証機で CPU だけ＝約 20 トークン/秒）。
const GENERATE_TIMEOUT: Duration = Duration::from_secs(600);
/// 編集の途中の手伝い（候補2〜3個の短い文）の上限（UI/UX 監査 2026-10-02）。
/// ⚠️ 以前は動画案と同じ 600 秒＝相手が固まると「考えています…」のまま最長約12分（起動の待ちを含む）押せなかった。
/// 出力の上限（`MAX_OUTPUT_TOKENS`）を最低検証機の速さ（約 20 トークン/秒）で書き切っても 160 秒に収まる。
const ASSIST_TIMEOUT: Duration = Duration::from_secs(180);
/// 最後の生成からこれだけ使わなければ止める（メモリ約 2.3GB を返す）。
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
/// やめる操作を見る間隔。
const CANCEL_POLL: Duration = Duration::from_millis(200);

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    base_url: Option<String>,
    /// この回の起動の合言葉（`--api-key`）。起動ごとに作り直す＝同じパソコンのほかのプログラム（ウェブページを含む）が
    /// 番号を当てても使えない。
    api_key: Option<String>,
    last_used: Option<Instant>,
    /// この回の起動のあいだ、モデルの SHA-256 を確かめ済みか（1.3GB を毎回は読まない＝決定14）。
    verified: bool,
    /// いま走っている生成の数（#1286 レビュー 🟡）＝1つでも走っている間は「しばらく使っていない」で止めない。
    in_flight: u32,
    /// この回の起動で視覚の部品を読み込んだか（写真を読めるか）。
    vision: bool,
    /// 視覚の部品の SHA-256 を確かめ済みか（モデルの `verified` と同じ＝365MB を起動のたびには読まない）。
    vision_verified: bool,
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
            g.api_key = None;
        }
    }

    /// 動いていて**応えることを確かめ済み**なら接続先を返す（途中で止まっていたら片付けて None）。
    /// 起動を待っている間は子プロセスだけがあり接続先は None＝None を返す（待つのは `starting`）。
    /// この回の起動の合言葉（起動していなければ空＝要求は断られる）。
    fn api_key(&self) -> String {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.api_key.clone())
            .unwrap_or_default()
    }

    fn running_base_url(&self) -> Option<String> {
        let mut g = self.inner.lock().ok()?;
        let alive = match g.child.as_mut() {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        };
        if !alive {
            g.child = None;
            g.base_url = None;
            g.api_key = None;
            // 落ちた回の「最後に使った時刻」も消す（#1293 レビュー 🟡）＝残すと、次の起動の途中で見張りが
            // 「しばらく使っていない」と判定して起動中の子を止める。
            g.last_used = None;
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

/// 同梱物の場所（実行ファイル・モデル・視覚の部品）。
struct BundlePaths {
    exe: PathBuf,
    model: PathBuf,
    mmproj: PathBuf,
}

fn bundle_paths(app: &AppHandle) -> Option<BundlePaths> {
    let dir = app.path().resource_dir().ok()?.join("local_llm");
    let exe = dir.join("runtime").join(if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    });
    Some(BundlePaths {
        exe,
        model: dir.join("models").join(MODEL_FILE),
        mmproj: dir.join("models").join(MMPROJ_FILE),
    })
}

/// 同梱されているか（実行ファイルとモデルが両方ある）。視覚の部品は無くても動画案は作れるので見ない。
fn is_bundled(app: &AppHandle) -> bool {
    bundle_paths(app).is_some_and(|b| b.exe.is_file() && b.model.is_file())
}

/// 起動ごとの合言葉（32 桁の16進）。乱数の箱を使わず、標準の「起動ごとに種が変わる」ハッシュと時刻から作る
/// （外から当てられないことだけが要る＝暗号の強さは要らない。相手は 127.0.0.1 だけ）。
pub fn new_api_key() -> String {
    use std::hash::{BuildHasher, Hasher};
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    (0..2u64)
        .map(|i| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i);
            h.write_u128(now);
            h.write_u32(std::process::id());
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// 起動の引数（純粋）。⚠️ **守りの3つ**（#1277 の確認・2026-10-01）：
/// - `--api-key`＝合言葉が無い要求を断る（同じパソコンの悪意あるウェブページが番号を総当たりしても使えない）
/// - `--no-slots`＝直前に処理した内容（指示文）を見せる口を閉じる（既定では開いている）
/// - `--offline`＝ネットへ出ない（モデルや部品を取りに行かない）
pub fn server_args(model: &Path, port: u16, mmproj: Option<&Path>, api_key: &str) -> Vec<String> {
    let mut a = vec![
        "-m".to_string(),
        model.display().to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "-c".to_string(),
        CONTEXT_TOKENS.to_string(),
        "--api-key".to_string(),
        api_key.to_string(),
        "--no-slots".to_string(),
        "--offline".to_string(),
    ];
    if let Some(mm) = mmproj {
        a.extend([
            "--mmproj".to_string(),
            mm.display().to_string(),
            "--image-max-tokens".to_string(),
            IMAGE_MAX_TOKENS.to_string(),
        ]);
    }
    a
}

/// 視覚の部品を読み込むか（大きさ→照合の順）。
/// 無い・壊れている＝**読み込まずに起動する**（動画案は作れる・写真を読む口だけが断る）。
fn vision_usable(mmproj: &Path, verify_sha: bool) -> bool {
    if check_model_size(mmproj, MMPROJ_SIZE) != ModelCheck::Ok {
        return false;
    }
    !verify_sha || check_model_sha256(mmproj, MMPROJ_SHA256) == ModelCheck::Ok
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
        // ⚠️ **プロキシを通さない**（§2-6）＝相手は必ず 127.0.0.1。既定だとパソコンのプロキシ設定に従い、
        //   指示文や写真が社内プロキシへ出うる。
        reqwest::Client::builder()
            .no_proxy()
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
/// やめる操作が押されるまで待つ（押されなければ終わらない＝`select!` の片側に置く）。
async fn until_cancelled(cancelled: &(dyn Fn() -> bool + Sync)) {
    loop {
        tokio::time::sleep(CANCEL_POLL).await;
        if cancelled() {
            break;
        }
    }
}

/// `cancelled`＝やめる操作が押されたか（動画案づくりは世代で見る／写真を読む口は見ない＝`|| false`）。
async fn ensure_started(
    app: &AppHandle,
    state: &LocalLlmState,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<String, String> {
    if let Some(url) = state.running_base_url() {
        return Ok(url);
    }
    // 起動を待つ間も「やめる」を見る（写真を読む口が起動している間に、動画案づくりが錠で待たされても止められる）。
    let _guard = tokio::select! {
        g = state.starting.lock() => g,
        _ = until_cancelled(cancelled) => return Err(AI_CANCELLED.to_string()),
    };
    if cancelled() {
        return Err(AI_CANCELLED.to_string());
    }
    if let Some(url) = state.running_base_url() {
        return Ok(url);
    }
    let Some(BundlePaths { exe, model, mmproj }) = bundle_paths(app) else {
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
    if cancelled() {
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
    if cancelled() {
        return Err(AI_CANCELLED.to_string());
    }
    // 視覚の部品（照合はモデルと同じく1度だけ＝大きさは毎回見る）。無い・壊れているなら読み込まずに起動する。
    let mm = mmproj.clone();
    let verify_sha = !state
        .inner
        .lock()
        .map(|g| g.vision_verified)
        .unwrap_or(false);
    let vision = tauri::async_runtime::spawn_blocking(move || vision_usable(&mm, verify_sha))
        .await
        .unwrap_or(false);
    if vision && verify_sha {
        if let Ok(mut g) = state.inner.lock() {
            g.vision_verified = true;
        }
    }
    if cancelled() {
        return Err(AI_CANCELLED.to_string());
    }
    if !vision {
        crate::tlog!(
            "local_llm",
            "視覚の部品を使いません（無いか照合が合わない）: {}",
            mmproj.display()
        );
    }
    // ⚠️ 空き番号を選んでから llama-server が使うまでに、ほかのプログラムに取られうる（同梱の VOICEVOX ENGINE と
    //   同じ既知の制約）。取られたら起動に失敗し `LOCAL_AI_START_FAILED`＝もう一度押せば別の番号で起動する。
    let Some(port) = pick_free_port() else {
        return Err(LOCAL_AI_START_FAILED.to_string());
    };
    let key = new_api_key();
    let mut cmd = no_window_command(&exe);
    cmd.args(server_args(
        &model,
        port,
        vision.then_some(mmproj.as_path()),
        &key,
    ));
    cmd.stdin(Stdio::null())
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
        g.api_key = Some(key.clone());
    }
    let base_url = format!("http://127.0.0.1:{port}");
    let started = Instant::now();
    loop {
        // 見張り・アプリ終了で止められた（子が片付けられた）＝待ち続けない（#1293 レビュー 🟡）。
        if state
            .inner
            .lock()
            .map(|g| g.child.is_none())
            .unwrap_or(true)
        {
            crate::tlog!("local_llm", "起動の途中で止められました");
            return Err(LOCAL_AI_START_FAILED.to_string());
        }
        if let Some(status) = state.starting_child_exited() {
            crate::tlog!("local_llm", "起動の途中で止まりました: {status}");
            state.shutdown();
            return Err(LOCAL_AI_START_FAILED.to_string());
        }
        if cancelled() {
            crate::tlog!("local_llm", "起動の途中でやめました");
            state.shutdown();
            return Err(AI_CANCELLED.to_string());
        }
        let ok = http_client()
            .get(format!("{base_url}/health"))
            .bearer_auth(&key)
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
        g.vision = vision;
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
    request_body(system, serde_json::json!(user), schema)
}

/// 写真を1枚添えた本文（OpenAI 互換の `image_url`＝data URL）。写真は**このパソコンの中の llama-server にだけ**渡す。
pub fn build_image_request_body(
    system: &str,
    user: &str,
    image_data_url: &str,
    schema: serde_json::Value,
) -> serde_json::Value {
    request_body(
        system,
        serde_json::json!([
            { "type": "text", "text": user },
            { "type": "image_url", "image_url": { "url": image_data_url } },
        ]),
        schema,
    )
}

fn request_body(
    system: &str,
    user_content: serde_json::Value,
    schema: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_content },
        ],
        "response_format": { "type": "json_schema", "json_schema": { "name": "ai_video_plan", "schema": schema } },
        // 考える段は切る＝待ち時間を延ばさず、出力は JSON だけにする。
        "chat_template_kwargs": { "enable_thinking": false },
        "temperature": 0.2,
        "max_tokens": MAX_OUTPUT_TOKENS,
    })
}

/// 少しずつ届く応答（`stream: true`＝SSE の `data: {...}` 行）を組み立てる（純粋・ADR-0052 決定6「進み具合を見せる」）。
/// ⚠️ **行の途中で切れて届く**（日本語の1字の途中で切れることもある）＝改行までをバイトのまま持ち越してから読む。
#[derive(Default)]
pub struct StreamAcc {
    pub content: String,
    pub finish_reason: Option<String>,
    pub timings: Option<serde_json::Value>,
    pub done: bool,
    /// 途中で llama-server が返した失敗（`data: {"error": ...}`）。黙って捨てない。
    pub error: Option<String>,
    pending: Vec<u8>,
}

impl StreamAcc {
    /// 届いた断片を足す。
    pub fn push(&mut self, chunk: &[u8]) {
        self.pending.extend_from_slice(chunk);
        while let Some(i) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=i).collect();
            let text = String::from_utf8_lossy(&line);
            self.line(text.trim_end_matches(['\r', '\n']));
        }
    }

    fn line(&mut self, line: &str) {
        let Some(data) = line.strip_prefix("data:") else {
            return;
        };
        let data = data.trim();
        if data == "[DONE]" {
            self.done = true;
            return;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
            return;
        };
        if let Some(e) = v.get("error") {
            self.error = Some(e.to_string());
            return;
        }
        if let Some(c) = v
            .pointer("/choices/0/delta/content")
            .and_then(|c| c.as_str())
        {
            self.content.push_str(c);
        }
        if let Some(r) = v
            .pointer("/choices/0/finish_reason")
            .and_then(|r| r.as_str())
        {
            self.finish_reason = Some(r.to_string());
        }
        if let Some(t) = v.get("timings") {
            self.timings = Some(t.clone());
        }
    }

    /// 書き始めた場面の数（出力の形は正典の schema で縛っている＝場面ごとに `"sceneType"` が1つ）。
    pub fn scenes(&self) -> usize {
        self.content.matches("\"sceneType\"").count()
    }

    /// 出力が上限（`MAX_OUTPUT_TOKENS`）で止まったか。
    pub fn stopped_by_length(&self) -> bool {
        self.finish_reason.as_deref() == Some("length")
    }

    /// 最後まで届いたか（終わりの印 `[DONE]` か終わりの理由がある・途中の失敗が無い）。
    /// ⚠️ 接続が切れた・途中で失敗した回は、途中までの中身を返さない（読めない、ではなく失敗として扱う）。
    pub fn finished(&self) -> bool {
        self.error.is_none() && (self.done || self.finish_reason.is_some())
    }
}

/// 進み具合の知らせ（画面が「3 場面目を書いています」を出す）。
#[derive(Clone, serde::Serialize)]
struct LocalAiProgress {
    scenes: u32,
}

/// 読める写真の種類（拡張子 → data URL の種類）。**写真以外のファイルは読まない**（任意のファイルを読む口にしない）。
pub fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        // ⚠️ webp は受けない＝llama.cpp の画像の読み込み（stb_image）が扱えない（毎回断られる）。
        _ => None,
    }
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
    let base = ensure_started(&app, &state, &|| crate::ai::is_superseded(gen)).await?;
    if crate::ai::is_superseded(gen) {
        return Err(AI_CANCELLED.to_string());
    }
    let mut body = build_request_body(&system, &user, schema);
    // 少しずつ受け取る＝書き終えた場面の数を画面へ知らせる（ADR-0052 決定6）。
    body["stream"] = serde_json::json!(true);
    let started = Instant::now();
    // 送って、本文を読み終えるまでを1つにする＝本文の読み取りも「やめる」と時間切れの対象にする（#1286 レビュー 🟡）。
    let request = async {
        let mut resp = http_client()
            .post(format!("{base}/v1/chat/completions"))
            .bearer_auth(state.api_key())
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await?;
            return Ok::<_, reqwest::Error>((status, None, text));
        }
        let mut acc = StreamAcc::default();
        let mut told = 0usize;
        while let Some(chunk) = resp.chunk().await? {
            acc.push(&chunk);
            let n = acc.scenes();
            if n > told {
                told = n;
                let _ = app.emit("local-ai-progress", LocalAiProgress { scenes: n as u32 });
            }
            if acc.done {
                break;
            }
        }
        Ok((status, Some(acc), String::new()))
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
    let (status, acc, error_body) = result.map_err(|e| {
        crate::tlog!("local_llm", "生成に失敗しました: {e}");
        if e.is_timeout() {
            LOCAL_AI_TIMEOUT.to_string()
        } else if e.is_decode() {
            crate::messages::AI_REQUEST_FAILED.to_string()
        } else {
            LOCAL_AI_START_FAILED.to_string()
        }
    })?;
    let Some(acc) = acc.filter(|_| status.is_success()) else {
        crate::tlog!(
            "local_llm",
            "生成が断られました: status={status} body={}",
            error_body.chars().take(500).collect::<String>()
        );
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    };
    crate::tlog!(
        "local_llm",
        "生成しました（{:.1} 秒・{}）",
        started.elapsed().as_secs_f32(),
        acc.timings
            .as_ref()
            .map(|t| t.to_string())
            .unwrap_or_default()
    );
    if !acc.finished() {
        crate::tlog!(
            "local_llm",
            "生成の途中で止まりました: {}",
            acc.error
                .as_deref()
                .unwrap_or("終わりの印がないまま接続が切れた")
        );
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    if acc.stopped_by_length() {
        crate::tlog!(
            "local_llm",
            "出力が上限（{MAX_OUTPUT_TOKENS} トークン）で止まりました"
        );
        return Err(LOCAL_AI_TOO_LONG.to_string());
    }
    if acc.content.is_empty() {
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    Ok(acc.content)
}

/// 先に起動しておく（ADR-0052 決定6「入力画面を開いたら裏で準備を始める」・#1293）。
/// 起動と照合（初回は 1.3GB＋365MB を読む）を、利用者が入力している間に済ませる＝「作る」を押してからの待ちを減らす。
/// ⚠️ **やめる操作の世代に乗せない**（写真を読む口と同じ）＝準備が動画案づくりを「やめた」扱いにしない。
/// ⚠️ 失敗しても画面には出さない（押したときに同じ起動をもう一度試し、そこで次の行動を出す）。
#[tauri::command]
pub async fn local_ai_prepare(
    app: AppHandle,
    state: State<'_, LocalLlmState>,
) -> Result<(), String> {
    if !is_bundled(&app) {
        return Ok(());
    }
    // 準備も「走っている」と数える（#1293 レビュー 🟡）＝起動の途中で見張りに止められない。
    let _in_flight = InFlight::begin(&state);
    ensure_started(&app, &state, &|| false).await.map(|_| ())
}

/// 写真を1枚読んで、説明とタグを返す（ADR-0052 決定4）。戻り値は応答の本文（JSON の文字列）。検証はフロントが行う。
///
/// ⚠️ **動画案づくりの「やめる」の世代に乗せない**＝取り込みの裏で写真を読んでいる最中に動画案を作ると、
///   `begin_generation` を進めた側が相手を「やめた」扱いにして**動画案づくりが失敗する**。写真を読む口は世代を進めず、
///   やめる操作も見ない（1枚 約 10 秒で終わる・時間の上限は生成と同じ）。
/// ⚠️ **プロジェクトの中の写真だけ**読む＝場所は `resolve_project_file`（プロジェクトの外へ出る道を断る）で決め、
///   **写真の種類の拡張子だけ**を受ける（任意のファイルを読む口にしない）。動画は呼び出し側が代表の1コマ（サムネイル）を渡す。
#[tauri::command]
pub async fn local_ai_describe_image(
    app: AppHandle,
    state: State<'_, LocalLlmState>,
    system: String,
    user: String,
    schema: String,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    let path = crate::ffmpeg::resolve_project_file(&app, &project_id, &rel_path)?;
    let Some(mime) = image_mime(&path) else {
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    };
    let schema: serde_json::Value = serde_json::from_str(&schema)
        .map_err(|_| crate::messages::AI_REQUEST_FAILED.to_string())?;
    let too_large = tokio::fs::metadata(&path)
        .await
        .map(|m| m.len() > IMAGE_MAX_BYTES)
        .unwrap_or(false);
    if too_large {
        crate::tlog!(
            "local_llm",
            "写真が大きすぎるので読みません: {}",
            path.display()
        );
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        crate::tlog!("local_llm", "写真を読めません: {e}");
        crate::messages::AI_REQUEST_FAILED.to_string()
    })?;
    use base64::Engine as _;
    let data_url = format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    let _in_flight = InFlight::begin(&state);
    let base = ensure_started(&app, &state, &|| false).await?;
    let vision = state.inner.lock().map(|g| g.vision).unwrap_or(false);
    if !vision {
        return Err(LOCAL_AI_MISSING.to_string());
    }
    let body = build_image_request_body(&system, &user, &data_url, schema);
    let started = Instant::now();
    let resp = http_client()
        .post(format!("{base}/v1/chat/completions"))
        .bearer_auth(state.api_key())
        .json(&body)
        .send()
        .await;
    let (status, json) = match resp {
        Ok(r) => {
            let status = r.status();
            match r.json::<serde_json::Value>().await {
                Ok(j) => (status, j),
                Err(e) => {
                    crate::tlog!("local_llm", "写真の説明の応答を読めません: {e}");
                    return Err(crate::messages::AI_REQUEST_FAILED.to_string());
                }
            }
        }
        Err(e) => {
            crate::tlog!("local_llm", "写真の説明に失敗しました: {e}");
            return Err(if e.is_timeout() {
                LOCAL_AI_TIMEOUT
            } else {
                LOCAL_AI_START_FAILED
            }
            .to_string());
        }
    };
    if !status.is_success() {
        crate::tlog!("local_llm", "写真の説明が断られました: status={status}");
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    crate::tlog!(
        "local_llm",
        "写真を説明しました（{:.1} 秒）",
        started.elapsed().as_secs_f32()
    );
    extract_content(&json).ok_or_else(|| crate::messages::AI_REQUEST_FAILED.to_string())
}

/// 編集の途中の小さな手伝い（ADR-0053）＝セリフの言い直し・語りから字幕・見出しの候補。戻り値は応答の本文（JSON の文字列）。
/// 候補の検証はフロントが行う（`assist.ts`）。
///
/// ⚠️ **動画案づくりの「やめる」の世代に乗せない**（写真を読む口と同じ）＝手伝いが動画案づくりを止めない・その逆も無い。
/// ⚠️ 相手は同梱の llama-server だけ（127.0.0.1・合言葉つき・プロキシを通さない）＝外へは送らない（§2-6）。
#[tauri::command]
pub async fn local_ai_assist(
    app: AppHandle,
    state: State<'_, LocalLlmState>,
    system: String,
    user: String,
    schema: String,
) -> Result<String, String> {
    let schema: serde_json::Value = serde_json::from_str(&schema)
        .map_err(|_| crate::messages::AI_REQUEST_FAILED.to_string())?;
    let _in_flight = InFlight::begin(&state);
    let base = ensure_started(&app, &state, &|| false).await?;
    let body = build_request_body(&system, &user, schema);
    let resp = http_client()
        .post(format!("{base}/v1/chat/completions"))
        .bearer_auth(state.api_key())
        .timeout(ASSIST_TIMEOUT)
        .json(&body)
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            crate::tlog!("local_llm", "手伝いの要求に失敗しました: {e}");
            return Err(if e.is_timeout() {
                LOCAL_AI_TIMEOUT
            } else {
                LOCAL_AI_START_FAILED
            }
            .to_string());
        }
    };
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| {
        crate::tlog!("local_llm", "手伝いの応答を読めません: {e}");
        crate::messages::AI_REQUEST_FAILED.to_string()
    })?;
    if !status.is_success() {
        crate::tlog!("local_llm", "手伝いが断られました: status={status}");
        return Err(crate::messages::AI_REQUEST_FAILED.to_string());
    }
    extract_content(&json).ok_or_else(|| crate::messages::AI_REQUEST_FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 手伝いの上限は動画案より短く、出力の上限を最低検証機の速さ（約 20 トークン/秒）で書き切れる長さ（PR3 レビュー 🟡＝コメントの主張を検査にする）。
    #[test]
    fn assist_timeout_is_shorter_than_generate_and_fits_max_output() {
        assert!(ASSIST_TIMEOUT < GENERATE_TIMEOUT);
        assert!(u64::from(MAX_OUTPUT_TOKENS) / 20 <= ASSIST_TIMEOUT.as_secs());
    }
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
    fn image_request_body_carries_text_and_image_in_user_content() {
        let body = build_image_request_body(
            "sys",
            "usr",
            "data:image/png;base64,AAAA",
            serde_json::json!({"type": "object"}),
        );
        assert_eq!(body["messages"][0]["content"], "sys");
        let user = &body["messages"][1]["content"];
        assert_eq!(user[0]["type"], "text");
        assert_eq!(user[0]["text"], "usr");
        assert_eq!(user[1]["type"], "image_url");
        assert_eq!(user[1]["image_url"]["url"], "data:image/png;base64,AAAA");
        assert_eq!(
            body["response_format"]["json_schema"]["schema"]["type"],
            "object"
        );
        assert_eq!(body["chat_template_kwargs"]["enable_thinking"], false);
    }

    #[test]
    fn image_mime_reads_only_photo_extensions() {
        assert_eq!(image_mime(Path::new("a/b.JPG")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("a/b.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("b.png")), Some("image/png"));
        assert_eq!(image_mime(Path::new("b.webp")), None);
        assert_eq!(image_mime(Path::new("b.mp4")), None);
        assert_eq!(image_mime(Path::new("project.json")), None);
        assert_eq!(image_mime(Path::new("noext")), None);
    }

    #[test]
    fn vision_is_skipped_when_mmproj_missing_or_wrong_size() {
        let p = temp_file("mmproj", b"abc");
        assert!(!vision_usable(&p, false)); // 大きさが違う
        assert!(!vision_usable(&p.with_extension("none"), false)); // 無い
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn request_body_caps_output_length() {
        let body = build_request_body("s", "u", serde_json::json!({}));
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
        let img = build_image_request_body("s", "u", "data:,", serde_json::json!({}));
        assert_eq!(img["max_tokens"], MAX_OUTPUT_TOKENS);
    }

    #[test]
    fn stream_acc_joins_deltas_across_split_chunks() {
        let mut acc = StreamAcc::default();
        let a =
            "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"sceneType\\\": \\\"場面\"}}]}\n";
        let bytes = a.as_bytes();
        // 日本語の1字の途中で切って届ける。
        let cut = a.find("場").unwrap() + 1;
        acc.push(&bytes[..cut]);
        assert_eq!(acc.content, "");
        acc.push(&bytes[cut..]);
        assert_eq!(acc.content, "{\"sceneType\": \"場面");
        assert_eq!(acc.scenes(), 1);
        acc.push(b"\r\n: keep-alive\n\n");
        acc.push(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"timings\":{\"predicted_n\":3}}\n");
        assert_eq!(acc.finish_reason.as_deref(), Some("stop"));
        assert!(!acc.stopped_by_length());
        assert_eq!(acc.timings.as_ref().unwrap()["predicted_n"], 3);
        assert!(!acc.done);
        acc.push(b"data: [DONE]\n");
        assert!(acc.done);
    }

    #[test]
    fn stream_acc_reports_length_stop_and_counts_scenes() {
        let mut acc = StreamAcc::default();
        // llama-server（b11269）の最初の断片＝役割だけで中身は null・終わりの理由も null（実物から写した形）。
        acc.push(b"data: {\"choices\":[{\"finish_reason\":null,\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":null}}]}

");
        assert_eq!(acc.content, "");
        assert_eq!(acc.finish_reason, None);
        for _ in 0..3 {
            acc.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"\\\"sceneType\\\"\"}}]}\n");
        }
        acc.push(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n");
        assert_eq!(acc.scenes(), 3);
        assert!(acc.stopped_by_length());
        // data: で始まらない行・読めない行は無視する。
        acc.push(b"event: x\ndata: {broken\n");
        assert_eq!(acc.scenes(), 3);
        assert!(acc.finished());
    }

    #[test]
    fn stream_acc_is_not_finished_when_cut_or_failed() {
        let mut acc = StreamAcc::default();
        acc.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"{\"}}]}\n");
        // 終わりの印も理由も無いまま切れた。
        assert!(!acc.finished());
        acc.push(b"data: [DONE]\n");
        assert!(acc.finished());
        let mut failed = StreamAcc::default();
        failed.push(b"data: {\"error\":{\"code\":500,\"message\":\"x\"}}\n");
        failed.push(b"data: [DONE]\n");
        assert!(failed.error.is_some());
        assert!(!failed.finished());
    }

    #[test]
    fn server_args_turn_on_the_three_guards() {
        let a = server_args(Path::new("m.gguf"), 1234, None, "k");
        let pos = |f: &str| a.iter().position(|x| x == f);
        assert_eq!(a[pos("--api-key").unwrap() + 1], "k");
        assert!(pos("--no-slots").is_some());
        assert!(pos("--offline").is_some());
        assert_eq!(a[pos("--host").unwrap() + 1], "127.0.0.1");
        assert!(pos("--mmproj").is_none());
        let v = server_args(Path::new("m.gguf"), 1234, Some(Path::new("p.gguf")), "k");
        assert_eq!(
            v[v.iter().position(|x| x == "--mmproj").unwrap() + 1],
            "p.gguf"
        );
    }

    #[test]
    fn api_key_is_long_and_changes() {
        let a = new_api_key();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, new_api_key());
    }

    #[test]
    fn extract_content_reads_first_choice() {
        let v = serde_json::json!({"choices": [{"message": {"content": "{\"a\":1}"}}]});
        assert_eq!(extract_content(&v).as_deref(), Some("{\"a\":1}"));
        assert_eq!(extract_content(&serde_json::json!({})), None);
    }
}
