// 実 AI プロバイダ（ADR-0010 P1）。
// - APIキーは OS の資格情報ストア（keyring＝Windows 資格情報マネージャ）に保存し、平文ファイル・ログ・JS へ出さない（§13§7・§2-6）。
// - API 呼び出しは Rust 内で行い、鍵を JS（フロント）に渡さない。鍵を URL・エラー本文・ログに載せない。
// - MVP は Gemini（無料枠・ADR-0010）。OpenAI は P2（is_supported_provider で弾く）。
// - 出力契約: JSON モード（responseMimeType=application/json）で構成JSONを要求し、受信後にフロントで ajv 検証する（二重防御）。
use std::sync::OnceLock;

/// keyring のサービス名（資格情報マネージャ上の識別子）。account にはプロバイダ名を使う。
const KEYRING_SERVICE: &str = "star-recruit-studio:ai";

/// 生成温度（低めで決定論寄り＝12§5 注記）。生成パラメータのため 11§4 の尺/enum 定数とは別管理。
const GEMINI_TEMPERATURE: f64 = 0.2;

/// 対応プロバイダ（MVP は gemini のみ。openai は P2 で有効化）。
fn is_supported_provider(provider: &str) -> bool {
    provider == "gemini"
}

/// reqwest クライアントは接続プール再利用のため一度だけ生成する（voicevox.rs と同方針）。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// keyring エントリ（service 固定・account=プロバイダ名）。
fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|_| "鍵の保管領域にアクセスできませんでした。".to_string())
}

/// APIキーを OS 資格情報ストアに保存する（平文ファイルには書かない）。
#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    if !is_supported_provider(&provider) {
        return Err("対応していない接続先です。".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("キーが空です。キーを入力してください。".to_string());
    }
    key_entry(&provider)?
        .set_password(&api_key)
        .map_err(|_| "キーの保存に失敗しました。もう一度お試しください。".to_string())
}

/// APIキーが保存済みかを返す（**値は返さない＝有無のみ**。鍵を JS に出さない）。
#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    if !is_supported_provider(&provider) {
        return Ok(false);
    }
    match key_entry(&provider)?.get_password() {
        Ok(_) => Ok(true),
        // 未登録・アクセス不可はいずれも「未設定」扱い（安全側・鍵は出さない）。
        Err(_) => Ok(false),
    }
}

/// 保存済みAPIキーを削除する（未登録でも成功扱い）。
#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    if !is_supported_provider(&provider) {
        return Err("対応していない接続先です。".to_string());
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
    provider: String,
    model: String,
    system: String,
    user: String,
) -> Result<String, String> {
    if !is_supported_provider(&provider) {
        return Err("対応していない接続先です。".to_string());
    }
    if model.trim().is_empty() {
        return Err("利用するモデルが指定されていません。".to_string());
    }
    let api_key = key_entry(&provider)?.get_password().map_err(|_| {
        "接続キーが設定されていません。設定画面でキーを登録してください。".to_string()
    })?;

    let body = build_gemini_body(&system, &user);
    let res = http_client()
        .post(gemini_endpoint(&model))
        .header("x-goog-api-key", &api_key)
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "AI に接続できませんでした。ネットワークを確認して、もう一度お試しください。"
                .to_string()
        })?;

    if !res.status().is_success() {
        // ステータス本文に鍵・送信内容は含めない（鍵をログ/本文に載せない）。
        return Err(
            "AI への要求が失敗しました。時間をおいて、もう一度お試しください。".to_string(),
        );
    }
    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "AIからの応答を解釈できませんでした。もう一度お試しください。".to_string())?;
    extract_gemini_text(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
