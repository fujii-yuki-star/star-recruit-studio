// 実 AI プロバイダ（ADR-0010 P1）。
// - APIキーは OS の資格情報ストア（keyring＝Windows 資格情報マネージャ）に保存し、平文ファイル・ログ・JS へ出さない（§13§7・§2-6）。
// - API 呼び出しは Rust 内で行い、鍵を JS（フロント）に渡さない。鍵を URL・エラー本文・ログに載せない。
// - MVP は Gemini（無料枠・ADR-0010）。OpenAI は P2（is_supported_provider で弾く）。
// - 出力契約: JSON モード（responseMimeType=application/json）で構成JSONを要求し、受信後にフロントで ajv 検証する（二重防御）。
use std::sync::OnceLock;
use tauri::Emitter;

/// 混み合っていて待ち直すことを画面へ知らせる（無言で止まらないため）。
#[derive(Clone, serde::Serialize)]
pub struct AiBusyWaitEvent {
    /// 何回目の待ち直しか（1 から）。
    pub attempt: u32,
    /// 待ち直す上限。
    pub total: u32,
    /// 今回待つ長さ（ミリ秒）。
    pub wait_ms: u64,
}

/// keyring のサービス名（資格情報マネージャ上の識別子）。account にはプロバイダ名を使う。
const KEYRING_SERVICE: &str = "star-recruit-studio:ai";

/// 生成温度（低めで決定論寄り＝12§5 注記）。生成パラメータのため 11§4 の尺/enum 定数とは別管理。
const GEMINI_TEMPERATURE: f64 = 0.2;

/// 外部 AI 呼び出しのタイムアウト（秒）。無応答時に UI を無限待機させない。
const AI_REQUEST_TIMEOUT_SECS: u64 = 60;

/// 対応プロバイダ（MVP は gemini のみ。openai は P2 で有効化）。
fn is_supported_provider(provider: &str) -> bool {
    provider == "gemini"
}

/// 混み合っているときに待ち直す間隔（ミリ秒）。**要素数＝待ち直す回数**。
///
/// ⚠️ **待ち続けない**＝合計 33 秒で諦める。黙って何分も止まるほうが、断られるより悪い。
/// ⚠️ **だんだん長くする**＝混雑が晴れるのに要る時間は読めないので、短い間隔で潰し合わない。
const BUSY_WAIT_MS: [u64; 3] = [3_000, 10_000, 20_000];

/// AI 呼び出しが失敗した**種類**。
///
/// ⚠️ **分ける理由は「次の行動が違う」から**（§2-5・利用者の指摘 2026-09-25）＝
/// これまでは何が起きても「時間をおいて、もう一度お試しください」の1文だった。
/// ところが**待っても直らない失敗**（提供が終わったモデルを指している・鍵が違う）が実在し、
/// 実際に**動画案づくりが全滅していたのに、画面は待てば直ると言い続けていた**（#1244）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiFailure {
    /// 混み合っている（相手側の一時的な事情）。**待ち直せば通ることがある**。
    Busy,
    /// 使いすぎ（回数の上限）。待てば戻るが、**待ち直しても同じ**なので自動では粘らない。
    Overused,
    /// 指している接続先が無い。**待っても直らない**＝設定を見直す。
    ModelMissing,
    /// 鍵が受け付けられない。**待っても直らない**＝鍵を登録し直す。
    KeyRejected,
    /// 送った内容が受け付けられない。**待っても直らない**＝内容を変える。
    Rejected,
    /// それ以外。
    Unknown,
}

/// 応答の番号から失敗の種類を決める（純粋・検査対象）。
pub fn classify_failure(status: u16) -> AiFailure {
    match status {
        503 => AiFailure::Busy,
        429 => AiFailure::Overused,
        404 => AiFailure::ModelMissing,
        401 | 403 => AiFailure::KeyRejected,
        400 => AiFailure::Rejected,
        _ => AiFailure::Unknown,
    }
}

/// 待ち直してよい失敗か（純粋・検査対象）。
///
/// ⚠️ **粘るのは「混み合っている」だけ**＝使いすぎ（429）で粘ると**上限をさらに削る**し、
/// 待っても直らない種類で粘ると、利用者を意味なく待たせるだけになる。
pub fn should_wait_and_retry(kind: AiFailure) -> bool {
    matches!(kind, AiFailure::Busy)
}

/// 利用者に出す文（§2-3＝実装の言葉を出さない／§2-5＝次の行動を示す・純粋・検査対象）。
pub fn failure_message(kind: AiFailure) -> &'static str {
    // ⚠️ **文言は `messages.rs` に1つ**（§6）＝門番（`errorStateTable` / `rustUserMessageGuard`）が
    //   そこを見る作りなので、ここに直書きすると正典との突き合わせから外れる。
    match kind {
        // ⚠️ **ここへ来るのは待ち直しても駄目だったとき**＝「もう一度」だけでは同じことをさせるので、
        //   何回か試したことを伝えたうえで、間を置くよう促す。
        AiFailure::Busy => crate::messages::AI_BUSY,
        AiFailure::Overused => crate::messages::AI_OVERUSED,
        AiFailure::ModelMissing => crate::messages::AI_MODEL_MISSING,
        AiFailure::KeyRejected => crate::messages::AI_KEY_REJECTED,
        AiFailure::Rejected => crate::messages::AI_REJECTED,
        AiFailure::Unknown => crate::messages::AI_REQUEST_FAILED,
    }
}

/// モデル名が URL パスへ安全に埋め込めるか（英数字・ハイフン・ドットのみ）。
/// `/` や `..` を弾き、鍵付きリクエストが別エンドポイントへ届く URL インジェクションを防ぐ。
fn is_valid_gemini_model(model: &str) -> bool {
    !model.is_empty()
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// reqwest クライアントは接続プール再利用のため一度だけ生成する（voicevox.rs と同方針）。
/// 外部 API のため**タイムアウトを設定**し、応答が返らないときに UI が無限待機しないようにする。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(AI_REQUEST_TIMEOUT_SECS))
            .build()
            // build() が失敗するのは TLS バックエンドの初期化不能など**致命的な環境不備のみ**＝実質到達不能。
            // その場合は HTTP を一切送れず継続に意味がないため、ここは fail-fast（voicevox.rs の `Client::new()` も
            // 内部で同様に panic する＝同方針）。通常の通信失敗・タイムアウトは送信時に Result で扱う（ここではない）。
            .expect("HTTP クライアントの初期化に失敗しました")
    })
}

/// keyring エントリ（service 固定・account=プロバイダ名）。
fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|_| crate::messages::KEYRING_UNAVAILABLE.to_string())
}

/// APIキーを OS 資格情報ストアに保存する（平文ファイルには書かない）。
#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    if !is_supported_provider(&provider) {
        return Err(crate::messages::AI_PROVIDER_UNSUPPORTED.to_string());
    }
    if api_key.trim().is_empty() {
        return Err("キーが空です。キーを入力してください。".to_string());
    }
    key_entry(&provider)?
        .set_password(&api_key)
        .map_err(|_| "キーの保存に失敗しました。もう一度お試しください。".to_string())
}

/// 保管庫の読み取り結果を「在る／無い／確かめられない」へ振り分ける（**純粋関数**）。
///
/// ⚠️ **アクセスできないことを「無い」と言わない**（#1131）＝以前はここも `Ok(false)` に
/// 畳んでいたので、**保存できた直後でも「未接続」**と出て、しかも理由が画面にも記録にも
/// 残らなかった（黙って別の結果にしない＝ADR-0026④）。
/// ⚠️ **鍵は出さない**という元の意図は保つ＝返すのは**確かめられなかった**という事実だけ。
/// ⚠️ **切り出してあるのは検査が分岐を叩くため**（`opener::guard_produced` と同じ流儀）＝
/// 本体は OS の保管庫を触るので、そのままでは単体で叩けない。
fn has_from(read: Result<String, keyring::Error>) -> Result<bool, String> {
    match read {
        Ok(_) => Ok(true),
        // **未登録**＝本当に「無い」。ここだけが `false`。
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err(crate::messages::KEYRING_UNAVAILABLE.to_string()),
    }
}

/// APIキーが保存済みかを返す（**値は返さない＝有無のみ**。鍵を JS に出さない）。
#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    if !is_supported_provider(&provider) {
        return Ok(false);
    }
    has_from(key_entry(&provider)?.get_password())
}

/// 保存済みAPIキーを削除する（未登録でも成功扱い）。
#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    if !is_supported_provider(&provider) {
        return Err(crate::messages::AI_PROVIDER_UNSUPPORTED.to_string());
    }
    match key_entry(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("キーの削除に失敗しました。もう一度お試しください。".to_string()),
    }
}

/// Gemini generateContent のリクエストボディ（純粋・テスト対象）。
/// JSON モード（responseMimeType=application/json）で構成JSONを要求する（12§3）。
/// 厳密 responseSchema は将来拡張：ai-video-plan は additionalProperties:false 等 Gemini responseSchema 非対応の語彙を含むため、
/// MVP は JSON モード＋受信後 ajv 検証（validateVideoPlan）を防御線とする（ADR-0010「二重防御」）。
fn build_gemini_body(system: &str, user: &str) -> serde_json::Value {
    serde_json::json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": user }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": GEMINI_TEMPERATURE
        }
    })
}

/// Gemini の generateContent エンドポイント URL（モデル指定）。**鍵は URL に載せず**ヘッダ（x-goog-api-key）で送る。
fn gemini_endpoint(model: &str) -> String {
    format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent")
}

/// Gemini レスポンス JSON から本文テキスト（先頭候補の全 parts を連結）を取り出す（純粋・テスト対象）。
fn extract_gemini_text(resp: &serde_json::Value) -> Result<String, String> {
    let parts = resp
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .ok_or_else(|| {
            "AIからの応答を読み取れませんでした。もう一度お試しください。".to_string()
        })?;
    let mut text = String::new();
    for part in parts {
        if let Some(s) = part.get("text").and_then(|t| t.as_str()) {
            text.push_str(s);
        }
    }
    if text.is_empty() {
        return Err("AIからの応答が空でした。もう一度お試しください。".to_string());
    }
    Ok(text)
}

/// AI に構成案生成を依頼し、応答テキスト（JSON 文字列）を返す。鍵は keyring から取り、JS には渡さない。
/// 応答の検証（ajv）・内部変換はフロント（domain）側で行う（§2-2）。
#[tauri::command]
pub async fn ai_generate(
    app: tauri::AppHandle,
    provider: String,
    model: String,
    system: String,
    user: String,
) -> Result<String, String> {
    if !is_supported_provider(&provider) {
        return Err(crate::messages::AI_PROVIDER_UNSUPPORTED.to_string());
    }
    // model は URL パスへ埋め込むため、安全な文字種のみ許可する（インジェクション防止）。
    if !is_valid_gemini_model(&model) {
        return Err("利用するモデルが正しくありません。設定を確認してください。".to_string());
    }
    let api_key = key_entry(&provider)?.get_password().map_err(|_| {
        "接続キーが設定されていません。設定画面でキーを登録してください。".to_string()
    })?;

    let body = build_gemini_body(&system, &user);
    // ⚠️ **混み合っているときだけ、待って自分でもう一度送る**（利用者の指摘 2026-09-25・ADR-0010 P3）＝
    //   以前は1回で諦めていたので、相手が混んでいるだけの日は**何度押しても失敗し続けた**
    //  （実機で連続 8 回失敗を観測）。混雑は相手側の一時的な事情なので、押し直させる理由が無い。
    // ⚠️ **粘るのは混雑だけ**＝`should_wait_and_retry`。使いすぎ・接続先が無い・鍵違いで粘っても意味が無い。
    // ⚠️ **黙って待たない**＝待っている間は画面へ知らせる（`ai-busy-wait`）。無言で 30 秒止まるのは故障に見える。
    let mut attempt: usize = 0;
    let res = loop {
        let sent = http_client()
            .post(gemini_endpoint(&model))
            .header("x-goog-api-key", &api_key)
            .json(&body)
            .send()
            .await
            .map_err(|_| {
                "AI に接続できませんでした。ネットワークを確認して、もう一度お試しください。"
                    .to_string()
            })?;
        if sent.status().is_success() {
            break sent;
        }
        // 診断用：原因（400/404/429 等とメッセージ）特定のため、ステータスと Gemini のエラー本文を stderr に出す。
        // 本文＝Gemini のエラー説明で、鍵や送信内容は含まれない（鍵はリクエストヘッダのみ）。UI には出さない（§2-3）。
        let status = sent.status();
        let kind = classify_failure(status.as_u16());
        let body_text = sent.text().await.unwrap_or_default();
        let head: String = body_text.chars().take(500).collect();
        crate::tlog!("ai", "Gemini API エラー: status={status} body={head}");
        if !should_wait_and_retry(kind) || attempt >= BUSY_WAIT_MS.len() {
            return Err(failure_message(kind).to_string());
        }
        let wait_ms = BUSY_WAIT_MS[attempt];
        attempt += 1;
        let _ = app.emit(
            "ai-busy-wait",
            AiBusyWaitEvent {
                attempt: attempt as u32,
                total: BUSY_WAIT_MS.len() as u32,
                wait_ms,
            },
        );
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
    };
    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "AIからの応答を解釈できませんでした。もう一度お試しください。".to_string())?;
    extract_gemini_text(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **在る**＝読めたなら在る。
    #[test]
    fn 読めたなら在ると言う() {
        assert_eq!(has_from(Ok("k".to_string())), Ok(true));
    }

    /// **無い**＝未登録だけが「無い」。
    #[test]
    fn 未登録なら無いと言う() {
        assert_eq!(has_from(Err(keyring::Error::NoEntry)), Ok(false));
    }

    /// **確かめられない**＝アクセスできないことを「無い」に畳まない（#1131）。
    ///
    /// ⚠️ **畳むと、保存できた直後でも「未接続」**と出て、理由がどこにも残らない。
    #[test]
    fn 確かめられないなら無いと言わない() {
        let err = keyring::Error::Invalid("service".to_string(), "空です".to_string());
        assert_eq!(
            has_from(Err(err)),
            Err(crate::messages::KEYRING_UNAVAILABLE.to_string()),
            "アクセスできないことを「無い」に畳んでいる"
        );
    }

    /// **待っても直らない失敗を、待てば直ると言わない**（#1244・利用者の指摘 2026-09-25）。
    ///
    /// ⚠️ **実際に踏んだ**＝提供が終わったモデルを指していたのに、画面は
    /// 「時間をおいて、もう一度お試しください」と言い続け、**動画案づくりが全滅していることに誰も気づけなかった**。
    #[test]
    fn 待っても直らない失敗は待てとは言わない() {
        for status in [404u16, 401, 403, 400] {
            let kind = classify_failure(status);
            assert!(
                !should_wait_and_retry(kind),
                "status={status} で自動の待ち直しに入っている"
            );
            let msg = failure_message(kind);
            assert!(
                !msg.contains("時間をおいて"),
                "status={status} の文が「時間をおいて」と言っている（待っても直らない）: {msg}"
            );
        }
    }

    /// **待てば直る失敗だけ、自分で待ち直す**。
    #[test]
    fn 混み合っているときだけ待ち直す() {
        assert!(should_wait_and_retry(classify_failure(503)));
        // ⚠️ **使いすぎでは粘らない**＝上限をさらに削るだけ。
        assert!(!should_wait_and_retry(classify_failure(429)));
        assert!(!should_wait_and_retry(classify_failure(500)));
    }

    /// 番号 → 種類の対応（見分けそのもの）。
    #[test]
    fn 応答の番号から失敗の種類を決める() {
        assert_eq!(classify_failure(503), AiFailure::Busy);
        assert_eq!(classify_failure(429), AiFailure::Overused);
        assert_eq!(classify_failure(404), AiFailure::ModelMissing);
        assert_eq!(classify_failure(401), AiFailure::KeyRejected);
        assert_eq!(classify_failure(403), AiFailure::KeyRejected);
        assert_eq!(classify_failure(400), AiFailure::Rejected);
        assert_eq!(classify_failure(418), AiFailure::Unknown);
    }

    /// **どの文も「次の行動」を持つ**（§2-5）。
    ///
    /// ⚠️ **1つずつ書き並べない**＝種類を足したときに書き漏らす。**全部を回す**。
    #[test]
    fn どの失敗にも次の行動がある() {
        let all = [
            AiFailure::Busy,
            AiFailure::Overused,
            AiFailure::ModelMissing,
            AiFailure::KeyRejected,
            AiFailure::Rejected,
            AiFailure::Unknown,
        ];
        for kind in all {
            let msg = failure_message(kind);
            assert!(!msg.is_empty(), "{kind:?} の文が空");
            assert!(
                msg.contains("ください"),
                "{kind:?} の文が次の行動を示していない: {msg}"
            );
        }
        // ⚠️ **同じ文を使い回していないか**＝使い回すと、分けた意味が無い（見分けても届かない）。
        let msgs: Vec<&str> = all.iter().map(|k| failure_message(*k)).collect();
        let mut uniq = msgs.clone();
        uniq.sort_unstable();
        uniq.dedup();
        assert_eq!(uniq.len(), msgs.len(), "同じ文を2つ以上の種類で使っている");
    }

    /// **待ち続けない**＝合計の待ちに上限がある（黙って何分も止まらない）。
    #[test]
    fn 待ち直しは有限で_だんだん長くなる() {
        let total: u64 = BUSY_WAIT_MS.iter().sum();
        assert!(
            (5_000..=60_000).contains(&total),
            "待ちの合計が極端（{total}ms）"
        );
        for pair in BUSY_WAIT_MS.windows(2) {
            assert!(
                pair[1] > pair[0],
                "待ちが長くなっていない: {BUSY_WAIT_MS:?}"
            );
        }
    }

    #[test]
    fn build_gemini_body_uses_json_mode_and_messages() {
        let body = build_gemini_body("SYS", "USER");
        assert_eq!(
            body["generationConfig"]["responseMimeType"],
            "application/json"
        );
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "SYS");
        assert_eq!(body["contents"][0]["parts"][0]["text"], "USER");
        assert_eq!(body["contents"][0]["role"], "user");
    }

    #[test]
    fn extract_gemini_text_reads_and_joins_parts() {
        let resp = serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": "{\"ok\":" }, { "text": "true}" }] } }]
        });
        assert_eq!(extract_gemini_text(&resp).unwrap(), "{\"ok\":true}");
    }

    #[test]
    fn extract_gemini_text_errors_on_missing_or_empty() {
        assert!(extract_gemini_text(&serde_json::json!({ "candidates": [] })).is_err());
        assert!(extract_gemini_text(&serde_json::json!({})).is_err());
        let empty_parts = serde_json::json!({
            "candidates": [{ "content": { "parts": [] } }]
        });
        assert!(extract_gemini_text(&empty_parts).is_err());
    }

    #[test]
    fn gemini_endpoint_includes_model_and_is_https() {
        let url = gemini_endpoint("gemini-2.0-flash");
        assert!(url.contains("gemini-2.0-flash"));
        assert!(url.starts_with("https://"));
        assert!(!url.contains("key=")); // 鍵を URL に載せない
    }

    #[test]
    fn supported_provider_is_gemini_only_in_p1() {
        assert!(is_supported_provider("gemini"));
        assert!(!is_supported_provider("openai"));
        assert!(!is_supported_provider("foo"));
    }

    #[test]
    fn valid_gemini_model_allows_safe_names_and_rejects_path_chars() {
        assert!(is_valid_gemini_model("gemini-2.0-flash"));
        assert!(is_valid_gemini_model("gemini-1.5-pro"));
        // URL インジェクションになり得る入力を弾く。
        assert!(!is_valid_gemini_model(""));
        assert!(!is_valid_gemini_model("../other-api"));
        assert!(!is_valid_gemini_model("models/x:generateContent"));
        assert!(!is_valid_gemini_model("gemini flash"));
        assert!(!is_valid_gemini_model("a/b"));
    }
}
