// VOICEVOX ローカルエンジン（HTTP）連携（infrastructure 境界）。
// 13 §4：MVP はローカルエンジン接続を VoiceProvider 越しに行う／ADR-0003：ずんだもん＝ナレーター。
// 既定 http://localhost:50021（環境変数 VOICEVOX_URL で上書き可）。/audio_query → /synthesis で WAV を得る。
use base64::Engine as _;

fn voicevox_base() -> String {
    std::env::var("VOICEVOX_URL").unwrap_or_else(|_| "http://localhost:50021".to_string())
}

/// テキストを VOICEVOX で音声合成し、WAV の data URL を返す。
#[tauri::command]
pub async fn synthesize_voice(
    text: String,
    speaker: u32,
    speed: f64,
    pitch: f64,
    intonation: f64,
) -> Result<String, String> {
    let base = voicevox_base();
    let client = reqwest::Client::new();
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
        return Err(format!(
            "音声クエリの作成に失敗しました（{}）。",
            query_res.status()
        ));
    }
    let mut query: serde_json::Value = query_res.json().await.map_err(|e| e.to_string())?;

    // 話速・高さ・抑揚を VOICEVOX のスケールへ反映。
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
        .map_err(|e| e.to_string())?;
    if !synth_res.status().is_success() {
        return Err(format!(
            "音声合成に失敗しました（{}）。",
            synth_res.status()
        ));
    }
    let bytes = synth_res.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:audio/wav;base64,{b64}"))
}
