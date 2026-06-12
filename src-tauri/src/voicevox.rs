// VOICEVOX ローカルエンジン（HTTP）連携（infrastructure 境界）。
// 13 §4：MVP はローカルエンジン接続を VoiceProvider 越しに行う／ADR-0003：ずんだもん＝ナレーター。
// 既定 http://localhost:50021（設定の接続先 base_url → 環境変数 VOICEVOX_URL の順で上書き）。/audio_query → /synthesis で WAV を得る。
use base64::Engine as _;
use std::sync::OnceLock;

fn voicevox_base() -> String {
    std::env::var("VOICEVOX_URL").unwrap_or_else(|_| "http://localhost:50021".to_string())
}

/// reqwest クライアントは接続プール再利用のため一度だけ生成する。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// テキストを VOICEVOX で音声合成し、WAV の data URL を返す。
#[tauri::command]
pub async fn synthesize_voice(
    text: String,
    speaker: u32,
    speed: f64,
    pitch: f64,
    intonation: f64,
    base_url: Option<String>,
) -> Result<String, String> {
    // 設定の接続先を最優先。空なら環境変数→既定にフォールバック。
    let base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(voicevox_base);
    let client = http_client();
    let speaker_str = speaker.to_string();

    // 1) audio_query（text, speaker をクエリで渡す。本文なし）。
    let query_res = client
        .post(format!("{base}/audio_query"))
        .query(&[("text", text.as_str()), ("speaker", speaker_str.as_str())])
        .send()
        .await
        .map_err(|_| {
            "VOICEVOX に接続できませんでした。VOICEVOX を起動してから、もう一度お試しください。"
                .to_string()
        })?;
    if !query_res.status().is_success() {
        return Err(
            "音声の準備に失敗しました。VOICEVOX を起動してから、もう一度お試しください。"
                .to_string(),
        );
    }
    let mut query: serde_json::Value = query_res
        .json()
        .await
        .map_err(|_| "音声データの解析に失敗しました。もう一度お試しください。".to_string())?;

    // 話速・高さ・抑揚を VOICEVOX のスケールへ反映。
    // pitch は本アプリの目安値域 -1.0〜1.0 を VOICEVOX の pitchScale 推奨域 -0.15〜0.15 へ線形変換。
    query["speedScale"] = serde_json::json!(speed);
    query["intonationScale"] = serde_json::json!(intonation);
    query["pitchScale"] = serde_json::json!((pitch * 0.15).clamp(-0.15, 0.15));

    // 2) synthesis（speaker をクエリ、query を本文に）。
    let synth_res = client
        .post(format!("{base}/synthesis"))
        .query(&[("speaker", speaker_str.as_str())])
        .json(&query)
        .send()
        .await
        .map_err(|_| {
            "VOICEVOX に接続できませんでした。VOICEVOX を起動してから、もう一度お試しください。"
                .to_string()
        })?;
    if !synth_res.status().is_success() {
        return Err(
            "音声の生成に失敗しました。VOICEVOX を起動してから、もう一度お試しください。"
                .to_string(),
        );
    }
    let bytes = synth_res
        .bytes()
        .await
        .map_err(|_| "音声データの取得に失敗しました。もう一度お試しください。".to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:audio/wav;base64,{b64}"))
}
