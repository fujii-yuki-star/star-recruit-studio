// VOICEVOX ローカルエンジン（HTTP）連携（infrastructure 境界）。
// 13 §4：MVP はローカルエンジン接続を VoiceProvider 越しに行う／ADR-0003：ずんだもん＝ナレーター。
// 既定 http://localhost:50021（設定の接続先 base_url → 環境変数 VOICEVOX_URL の順で上書き）。/audio_query → /synthesis で WAV を得る。
use base64::Engine as _;
use std::sync::OnceLock;

fn voicevox_base() -> String {
    std::env::var("VOICEVOX_URL").unwrap_or_else(|_| "http://localhost:50021".to_string())
}

/// 声を作る1回の待ち時間の上限（秒）。#1024 ④。
///
/// ⚠️ **上限が無いと「作成中…」のまま止まりうる**＝同梱エンジンは同じPCの中なので普段は速いが、
/// 起動直後のモデル読み込み・別プロセスの固まり・外部エンジンを指した設定では**返らないことがある**。
/// 一括作成は中止できるので行き止まりにはならないが、**1件ずつ作るときは抜け道が無い**。
/// ⚠️ **AI（60秒）より長く採る**＝あちらは外部サービスへの1往復だが、こちらは
/// **長いセリフの音声合成**で、同梱エンジンでも数十秒かかることがある（短く採ると正常な合成を切る）。
const VOICE_REQUEST_TIMEOUT_SECS: u64 = 180;
/// つなぐまでの上限（秒）。**つながらないことは速く分かる**＝エンジンが動いていないときに
/// 3分待たせない（合成そのものの上限とは別に持つ）。
const VOICE_CONNECT_TIMEOUT_SECS: u64 = 10;

/// reqwest クライアントは接続プール再利用のため一度だけ生成する。
/// **待ち時間の上限を持つ**（#1024 ④）＝応答が返らないときに「作成中…」で止まらない。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(VOICE_REQUEST_TIMEOUT_SECS))
            .connect_timeout(std::time::Duration::from_secs(VOICE_CONNECT_TIMEOUT_SECS))
            .build()
            // build() が失敗するのは TLS バックエンドの初期化不能など**致命的な環境不備のみ**＝実質到達不能。
            // その場合は HTTP を一切送れず継続に意味がないため fail-fast（ai.rs と同方針）。
            .expect("HTTP クライアントの初期化に失敗しました")
    })
}

/// 送信の失敗を、**次の行動が違うもの**へ分ける（§2-5・#1024 ④）。
///
/// ⚠️ **時間切れを「つながりません」と言わない**＝エンジンには**届いている**ので
/// 接続先を見ても直らない（見に行かせるのは実行できない次の行動）。
/// ⚠️ **つながらないほうは元の文のまま**＝そちらは設定で直る。
/// ⚠️ **1か所に寄せる**＝送る所は8か所あり、写すと**片方だけ時間切れを見分ける**ようになる。
fn send_error(e: &reqwest::Error, timeout: &str, unreachable: &str) -> String {
    pick_send_message(e.is_timeout(), e.is_connect(), timeout, unreachable)
}

/// 見分けそのもの（`reqwest::Error` は外から作れないので、判定だけ切り出して検査する）。
///
/// ⚠️ **`is_timeout()` だけでは足りない**（PR #1036 レビュー 🔴）＝**つなぐまでの上限**
/// （`connect_timeout`）が切れたときも `is_timeout()` は真になる。そこを「時間切れ」に倒すと、
/// **届いてすらいないのに「開き直してください」**と言うことになり、接続先の設定を直せば
/// 直る人に**実行できない次の行動**を出す（§2-5）。**つなぐ前に落ちたものは、拒否も
/// 名前解決の失敗も時間切れも、まとめて「つながりません」**へ倒す。
fn pick_send_message(
    is_timeout: bool,
    is_connect: bool,
    timeout: &str,
    unreachable: &str,
) -> String {
    if is_timeout && !is_connect {
        timeout
    } else {
        unreachable
    }
    .to_string()
}

const VOICE_UNAVAILABLE_MESSAGE: &str =
    "ゆうこの声の準備ができていません。設定を確認してください。";
const ENGINE_UNREACHABLE_MESSAGE: &str = "音声ソフトにつながりません。接続先を確認してください。";
/// 声を作るのが返らないとき＝**セリフを短くする**という、この場でできる手が1つある。
const VOICE_TIMEOUT_MESSAGE: &str =
    "ゆうこの声を作るのに時間がかかりすぎました。セリフを短く分けるか、アプリを開き直してから、もう一度お試しください。";
/// 読み方の聞き比べ・読み方辞書が返らないとき＝短くする手は無いので、開き直しだけを言う。
const ENGINE_TIMEOUT_MESSAGE: &str =
    "音声ソフトの応答に時間がかかりすぎました。アプリを開き直してから、もう一度お試しください。";

/// 話し方（話速・高さ・抑揚）。**3つで1組**なので束ねて渡す。
///
/// ⚠️ **換算は `apply` だけが持つ**＝声を作る経路（`synthesize_voice`）と読み方の聞き比べ
///（`voicevox_synthesize_with_accent`）で**同じ式**を使う。写すと片方だけ直る。
#[derive(serde::Deserialize)]
pub struct VoiceStyle {
    pub speed: f64,
    pub pitch: f64,
    pub intonation: f64,
}

impl VoiceStyle {
    /// 話速・高さ・抑揚を VOICEVOX のスケールへ反映する。
    /// pitch は本アプリの目安値域 -1.0〜1.0 を VOICEVOX の pitchScale 推奨域 -0.15〜0.15 へ線形変換。
    fn apply(&self, query: &mut serde_json::Value) {
        query["speedScale"] = serde_json::json!(self.speed);
        query["intonationScale"] = serde_json::json!(self.intonation);
        query["pitchScale"] = serde_json::json!((self.pitch * 0.15).clamp(-0.15, 0.15));
    }
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
        .map_err(|e| send_error(&e, VOICE_TIMEOUT_MESSAGE, VOICE_UNAVAILABLE_MESSAGE))?;
    if !query_res.status().is_success() {
        return Err("ゆうこの声の作成に失敗しました。もう一度お試しください。".to_string());
    }
    let mut query: serde_json::Value = query_res
        .json()
        .await
        .map_err(|_| "音声データの解析に失敗しました。もう一度お試しください。".to_string())?;

    VoiceStyle {
        speed,
        pitch,
        intonation,
    }
    .apply(&mut query);

    // 2) synthesis（speaker をクエリ、query を本文に）。
    let synth_res = client
        .post(format!("{base}/synthesis"))
        .query(&[("speaker", speaker_str.as_str())])
        .json(&query)
        .send()
        .await
        .map_err(|e| send_error(&e, VOICE_TIMEOUT_MESSAGE, VOICE_UNAVAILABLE_MESSAGE))?;
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
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
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
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
    if !res.status().is_success() {
        return Err(
            "読み方を登録できませんでした。読み（カタカナ）を確かめてもう一度お試しください。"
                .to_string(),
        );
    }
    let body = res.text().await.map_err(|_| {
        "読み方の登録結果を読み取れませんでした。もう一度お試しください。".to_string()
    })?;
    // 本文は `"<uuid>"`（JSON 文字列）。引用符が付かない実装でも拾えるように両対応。
    Ok(serde_json::from_str::<String>(&body)
        .unwrap_or_else(|_| body.trim().trim_matches('"').to_string()))
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
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
    if res.status().is_success() {
        return Ok(true);
    }
    if is_missing_word(res.status()) {
        return Ok(false);
    }
    Err(
        "読み方を更新できませんでした。読み（カタカナ）を確かめてもう一度お試しください。"
            .to_string(),
    )
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
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
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
    style: VoiceStyle,
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
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
    if !query_res.status().is_success() {
        return Err(
            "読み方を確かめられませんでした。読み（カタカナ）を確かめてもう一度お試しください。"
                .to_string(),
        );
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
        // ⚠️ **値はそのまま渡す**（推測で寄せない・§9-2）。`AccentPhrase.accent` と `user_dict` の
        // `accent_type` が「下がらない（平板）」を同じ値で表すかは**実機で未検証**（ADR-0037 未解決）。
        // 片方へ寄せると聞いた音と登録後の音が食い違うので、実機で突き合わせてから直す。
        let clamped = (accent_type as usize).min(mora_count);
        phrase["accent"] = serde_json::json!(clamped);
    }
    style.apply(&mut query);

    let synth_res = client
        .post(format!("{base}/synthesis"))
        .query(&[("speaker", speaker_str.as_str())])
        .json(&query)
        .send()
        .await
        .map_err(|e| send_error(&e, ENGINE_TIMEOUT_MESSAGE, ENGINE_UNREACHABLE_MESSAGE))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 画面が渡す形をそのまま受け取れることを固定する（#350）。
    ///
    /// ⚠️ **型では検知できない境界**＝画面（TypeScript）は `style: { speed, pitch, intonation }`
    /// を送る。ばら渡しへ戻ると**受け取れずに落ちる**ので、送る側（`voicevoxProvider.synthesize.test.ts`）
    /// と受ける側の両方で留める。
    #[test]
    fn 時間切れはつながりませんと言わない() {
        // ⚠️ **時間切れは設定を見ても直らない**＝接続先を見に行かせない（§2-5）。
        assert_eq!(
            pick_send_message(
                true,
                false,
                VOICE_TIMEOUT_MESSAGE,
                VOICE_UNAVAILABLE_MESSAGE
            ),
            VOICE_TIMEOUT_MESSAGE
        );
        assert_eq!(
            pick_send_message(
                false,
                false,
                VOICE_TIMEOUT_MESSAGE,
                VOICE_UNAVAILABLE_MESSAGE
            ),
            VOICE_UNAVAILABLE_MESSAGE
        );
    }

    #[test]
    fn つなぐ前に落ちたものはつながりませんへ倒す() {
        // ⚠️ **つなぐまでの上限が切れたときも `is_timeout()` は真**（PR #1036 レビュー 🔴）＝
        // そこを「時間切れ」に倒すと、届いてすらいないのに「開き直してください」と言うことになる。
        assert_eq!(
            pick_send_message(true, true, VOICE_TIMEOUT_MESSAGE, VOICE_UNAVAILABLE_MESSAGE),
            VOICE_UNAVAILABLE_MESSAGE
        );
        // 拒否・名前解決の失敗（時間切れではない接続の失敗）も同じ側。
        assert_eq!(
            pick_send_message(
                false,
                true,
                VOICE_TIMEOUT_MESSAGE,
                VOICE_UNAVAILABLE_MESSAGE
            ),
            VOICE_UNAVAILABLE_MESSAGE
        );
    }

    #[test]
    fn 時間切れの文には次の行動がある() {
        // 声＝セリフを短くする手がある／聞き比べ・辞書＝開き直すだけ。どちらも「もう一度」で終わらない。
        assert!(VOICE_TIMEOUT_MESSAGE.contains("短く"));
        assert!(VOICE_TIMEOUT_MESSAGE.contains("開き直して"));
        assert!(ENGINE_TIMEOUT_MESSAGE.contains("開き直して"));
        // ⚠️ **「接続先を確認」を混ぜない**＝届いているのに設定を見に行かせない。
        assert!(!VOICE_TIMEOUT_MESSAGE.contains("接続先"));
        assert!(!ENGINE_TIMEOUT_MESSAGE.contains("接続先"));
    }

    #[test]
    fn 話し方をまとめて受け取れる() {
        let style: VoiceStyle = serde_json::from_value(
            serde_json::json!({"speed": 1.2, "pitch": 0.3, "intonation": 0.8}),
        )
        .expect("画面が送る形を受け取れること");
        assert_eq!(style.speed, 1.2);
    }

    /// 声の作成と聞き比べで**同じ換算**を通ることを固定する（写すと片方だけ直る）。
    #[test]
    fn 高さは推奨域へ収める() {
        let mut q = serde_json::json!({});
        VoiceStyle {
            speed: 1.0,
            pitch: 5.0,
            intonation: 1.0,
        }
        .apply(&mut q);
        assert_eq!(q["pitchScale"], serde_json::json!(0.15));
        assert_eq!(q["speedScale"], serde_json::json!(1.0));
    }
}
