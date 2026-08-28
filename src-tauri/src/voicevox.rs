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
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<String, String> {
    // 接続先: 設定の base_url（上級者）＞ 同梱エンジン（自動起動）＞ 環境変数 ＞ 既定 50021。
    let base = base_url
        .filter(|s| !s.trim().is_empty())
        .or_else(|| engine.base_url())
        .unwrap_or_else(voicevox_base);
    let client = http_client();
    let speaker_str = speaker.to_string();

    // 1) audio_query（text, speaker をクエリで渡す。本文なし）。
    let query_res = client
        .post(format!("{base}/audio_query"))
        .query(&[("text", text.as_str()), ("speaker", speaker_str.as_str())])
        .send()
        .await
        .map_err(|_| "ゆうこの声の準備ができていません。設定を確認してください。".to_string())?;
    if !query_res.status().is_success() {
        return Err("ゆうこの声の作成に失敗しました。もう一度お試しください。".to_string());
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
        .map_err(|_| "ゆうこの声の準備ができていません。設定を確認してください。".to_string())?;
    if !synth_res.status().is_success() {
        return Err("ゆうこの声の作成に失敗しました。もう一度お試しください。".to_string());
    }
    let bytes = synth_res
        .bytes()
        .await
        .map_err(|_| "音声データの取得に失敗しました。もう一度お試しください。".to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:audio/wav;base64,{b64}"))
}

// ── 読み方辞書（ADR-0037・#350）──────────────────────────────────────────────
//
// ⚠️ **同梱 ENGINE v0.25.2 で実際に叩いて確かめた形**（ADR-0037）＝
// `GET /user_dict`（uuid → 語 の object）／`POST /user_dict_word`（uuid を返す）／
// `PUT`・`DELETE /user_dict_word/{uuid}`。`accent_type` は**必須で既定なし**。
// ⚠️ **辞書は OS 上の固定パスで他の VOICEVOX と共有される**（`--user_dict_path` に相当する
// オプションが無い）ので、**丸ごと入れ替える API（`import_user_dict` の override）は使わない**
// ＝アプリが関与する語だけを1語ずつ足す/直す/消す（決定3）。

/// 接続先の解決（合成と同じ順＝設定の接続先 → 同梱エンジン → 環境変数 → 既定）。
fn resolve_base(base_url: Option<String>, engine: &crate::voicevox_engine::EngineState) -> String {
    base_url
        .filter(|s| !s.trim().is_empty())
        .or_else(|| engine.base_url())
        .unwrap_or_else(voicevox_base)
}

/// エンジンの読み方辞書を丸ごと読む（本文をそのまま返す＝解釈は呼び出し側＝§2-2）。
#[tauri::command]
pub async fn voicevox_user_dict_list(
    base_url: Option<String>,
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<String, String> {
    let base = resolve_base(base_url, &engine);
    let res = http_client()
        .get(format!("{base}/user_dict"))
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if !res.status().is_success() {
        return Err("読み方の一覧を取れませんでした。もう一度お試しください。".to_string());
    }
    res.text()
        .await
        .map_err(|_| "読み方の一覧を読み取れませんでした。もう一度お試しください。".to_string())
}

/// 語を1つ足す。**足せた語の id を返す**（次から同じ語を二重に登録しないための控え）。
#[tauri::command]
pub async fn voicevox_user_dict_add(
    surface: String,
    pronunciation: String,
    accent_type: u32,
    base_url: Option<String>,
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<String, String> {
    let base = resolve_base(base_url, &engine);
    let res = http_client()
        .post(format!("{base}/user_dict_word"))
        .query(&[
            ("surface", surface.as_str()),
            ("pronunciation", pronunciation.as_str()),
            ("accent_type", accent_type.to_string().as_str()),
        ])
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if !res.status().is_success() {
        return Err("読み方を登録できませんでした。読み（カタカナ）を確かめてもう一度お試しください。".to_string());
    }
    let body = res
        .text()
        .await
        .map_err(|_| "読み方の登録結果を読み取れませんでした。もう一度お試しください。".to_string())?;
    // 本文は `"<uuid>"`（JSON 文字列）。引用符が付かない実装でも拾えるように両対応。
    Ok(serde_json::from_str::<String>(&body).unwrap_or_else(|_| body.trim().trim_matches('"').to_string()))
}

/// 語を1つ直す。**`false` ＝その id の語がもう無い**（実測＝未知の uuid は `422`）。
/// エラーにしないのは、呼ぶ側が「作り直す合図」として扱うため（ADR-0037 決定3b）。
#[tauri::command]
pub async fn voicevox_user_dict_update(
    word_uuid: String,
    surface: String,
    pronunciation: String,
    accent_type: u32,
    base_url: Option<String>,
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<bool, String> {
    let base = resolve_base(base_url, &engine);
    let res = http_client()
        .put(format!("{base}/user_dict_word/{word_uuid}"))
        .query(&[
            ("surface", surface.as_str()),
            ("pronunciation", pronunciation.as_str()),
            ("accent_type", accent_type.to_string().as_str()),
        ])
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if res.status().is_success() {
        return Ok(true);
    }
    if is_missing_word(res.status()) {
        return Ok(false);
    }
    Err("読み方を更新できませんでした。読み（カタカナ）を確かめてもう一度お試しください。".to_string())
}

/// 語を1つ消す。**`false` ＝その id の語がもう無い**（消し終わっているのと同じ＝エラーにしない）。
#[tauri::command]
pub async fn voicevox_user_dict_delete(
    word_uuid: String,
    base_url: Option<String>,
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<bool, String> {
    let base = resolve_base(base_url, &engine);
    let res = http_client()
        .delete(format!("{base}/user_dict_word/{word_uuid}"))
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if res.status().is_success() {
        return Ok(true);
    }
    if is_missing_word(res.status()) {
        return Ok(false);
    }
    Err("読み方を削除できませんでした。もう一度お試しください。".to_string())
}

/// 「その id の語がもう無い」を表す応答か。**実測は `422`**（ADR-0037）だが、
/// 版によっては `404` を返しうるので両方を同じ意味に受ける（作り直しの合図）。
fn is_missing_word(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNPROCESSABLE_ENTITY || status == reqwest::StatusCode::NOT_FOUND
}

/// 読み（カタカナ）を**指定した下がり方**で鳴らす（読み方の聞き比べ・ADR-0037 決定6）。
///
/// ⚠️ **辞書には触らない**＝登録する前に確かめるための機能なので、`user_dict` へ入れて消す、はしない
/// （辞書は OS 上の固定パスで他の VOICEVOX と共有される＝途中で落ちるとゴミが残る・決定3）。
/// 代わりに `audio_query` の結果の**下がる位置だけ差し替えて** `synthesis` へ渡す。
///
/// ⚠️ **読みが複数のかたまりに割れたときは先頭だけ直す**＝辞書は1語に1つの下がり方を持つので、
/// 登録後の聞こえ方に十分近い。割れること自体が稀（1語ぶんの読みを渡すため）。
#[tauri::command]
pub async fn voicevox_synthesize_with_accent(
    yomi: String,
    accent_type: u32,
    speaker: u32,
    speed: f64,
    pitch: f64,
    intonation: f64,
    base_url: Option<String>,
    engine: tauri::State<'_, crate::voicevox_engine::EngineState>,
) -> Result<String, String> {
    let base = resolve_base(base_url, &engine);
    let client = http_client();
    let speaker_str = speaker.to_string();

    let query_res = client
        .post(format!("{base}/audio_query"))
        .query(&[("text", yomi.as_str()), ("speaker", speaker_str.as_str())])
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if !query_res.status().is_success() {
        return Err("読み方を確かめられませんでした。読み（カタカナ）を確かめてもう一度お試しください。".to_string());
    }
    let mut query: serde_json::Value = query_res
        .json()
        .await
        .map_err(|_| "音声データの解析に失敗しました。もう一度お試しください。".to_string())?;

    // 下がる位置を差し替える（先頭のかたまりだけ・粒の数を超えない範囲へ収める）。
    if let Some(phrase) = query
        .get_mut("accent_phrases")
        .and_then(|v| v.as_array_mut())
        .and_then(|a| a.first_mut())
    {
        let mora_count = phrase
            .get("moras")
            .and_then(|m| m.as_array())
            .map(|m| m.len())
            .unwrap_or(0);
        let clamped = (accent_type as usize).min(mora_count);
        phrase["accent"] = serde_json::json!(clamped);
    }
    query["speedScale"] = serde_json::json!(speed);
    query["intonationScale"] = serde_json::json!(intonation);
    query["pitchScale"] = serde_json::json!((pitch * 0.15).clamp(-0.15, 0.15));

    let synth_res = client
        .post(format!("{base}/synthesis"))
        .query(&[("speaker", speaker_str.as_str())])
        .json(&query)
        .send()
        .await
        .map_err(|_| "音声ソフトにつながりません。接続先を確認してください。".to_string())?;
    if !synth_res.status().is_success() {
        return Err("読み方を確かめられませんでした。もう一度お試しください。".to_string());
    }
    let bytes = synth_res
        .bytes()
        .await
        .map_err(|_| "音声データの取得に失敗しました。もう一度お試しください。".to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:audio/wav;base64,{b64}"))
}
