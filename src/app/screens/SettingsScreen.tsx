import { useEffect, useState } from "react";
import { PageHead } from "../components/ui";
import { useProjectStore } from "../store/projectStore";
import { useAudioPreview } from "../hooks/useAudioPreview";
import { useHistoryGroup } from "../hooks/useHistoryGroup";
import { GEMINI_PROVIDER, deleteApiKey, hasApiKey, saveApiKey } from "../../infrastructure/aiClient";
import {
  DEFAULT_AI_MODEL, getAiModel, getVoicevoxSpeaker, getVoicevoxUrl,
  setAiModel, setVoicevoxSpeaker, setVoicevoxUrl,
} from "../../infrastructure/appSettings";
import { VOICE_CATALOG, DEFAULT_SPEAKER, characterForSpeaker } from "../../domain/voice/voiceCatalog";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import {
  INTONATION_RANGE, PITCH_RANGE, SPEED_RANGE, sliderToValue, valueToSlider,
} from "../../domain/voice/voiceParams";
import {
  H264_INITIAL_STATUS, H264_STATUS_LABEL, OPENH264_CREDIT_TEXT, OPENH264_FEATURE_ENABLED,
  type H264FeatureStatus,
} from "../../domain/export/h264Feature";

export function SettingsScreen() {
  const synthesizePreview = useProjectStore((s) => s.synthesizePreview);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);
  // 声パラメータ（速さ/高さ/抑揚）スライダーのドラッグを1履歴に（#389・場面編集側と同じ挙動に揃える）。
  const { dragGroup } = useHistoryGroup();

  const [keyInput, setKeyInput] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [aiModel, setAiModelState] = useState(() => getAiModel());

  function onChangeModel(value: string) {
    setAiModelState(value);
    setAiModel(value);
  }
  const [voicevoxUrl, setUrl] = useState(() => getVoicevoxUrl());
  const [speaker, setSpeaker] = useState(() => {
    // 保存済み speaker がカタログに無い（旧値・破損）なら既定へ（select の選択肢と state の乖離を防ぐ）。
    const saved = getVoicevoxSpeaker();
    return saved != null && characterForSpeaker(saved) != null ? saved : DEFAULT_SPEAKER;
  });
  const [testState, setTestState] = useState<"idle" | "loading" | "error">("idle");
  const [testError, setTestError] = useState("");
  // 試し聞きの再生制御（#388）：画面遷移で停止・連打で重ならない・再生中は「停止」表示。
  const audioPreview = useAudioPreview();
  // 動画保存の予備機能の状態（実検出は取得・検証実装後＝pin 後。今は表示枠用のプレースホルダ）。
  const h264Status: H264FeatureStatus = H264_INITIAL_STATUS;

  function onChangeUrl(value: string) {
    setUrl(value);
    setVoicevoxUrl(value);
  }
  function onChangeSpeaker(value: number) {
    setSpeaker(value);
    setVoicevoxSpeaker(value);
  }
  async function onTestVoice() {
    // 再生中にもう一度押したら停止（投げっぱなしにしない・#388）。
    if (audioPreview.playingKey === "settings") {
      audioPreview.stop();
      return;
    }
    setTestState("loading");
    setTestError("");
    try {
      const url = await synthesizePreview();
      // 再生失敗（コーデック/自動再生制限など）も握りつぶさず通知する（§2-5）。停止制御は audioPreview に委ねる。
      audioPreview.play("settings", url, () => {
        setTestError("声の確認に失敗しました。もう一度お試しください。");
        setTestState("error");
      });
      setTestState("idle");
    } catch (e) {
      // VOICEVOX 由来の失敗は Rust が行動明示の文字列で返す。それ以外（再生失敗等）は定型文。
      setTestError(
        typeof e === "string" ? e : "声の確認に失敗しました。もう一度お試しください。",
      );
      setTestState("error");
    }
  }

  // 起動時に接続キーの有無を確認（値は取得しない＝有無のみ）。
  useEffect(() => {
    void hasApiKey(GEMINI_PROVIDER)
      .then(setAiConnected)
      .catch(() => setAiConnected(false));
  }, []);

  async function onSaveKey() {
    setKeyBusy(true);
    setKeyError("");
    try {
      await saveApiKey(GEMINI_PROVIDER, keyInput.trim());
      setKeyInput("");
      setAiConnected(await hasApiKey(GEMINI_PROVIDER));
    } catch (e) {
      setKeyError(typeof e === "string" ? e : "キーを保存できませんでした。もう一度お試しください。");
    } finally {
      setKeyBusy(false);
    }
  }

  async function onClearKey() {
    setKeyBusy(true);
    setKeyError("");
    try {
      await deleteApiKey(GEMINI_PROVIDER);
      setAiConnected(await hasApiKey(GEMINI_PROVIDER));
    } catch (e) {
      setKeyError(typeof e === "string" ? e : "接続を削除できませんでした。もう一度お試しください。");
    } finally {
      setKeyBusy(false);
    }
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="設定"
        desc="使用するAIやナレーターの声、保存先などを設定できます。"
      />

      <div style={{ maxWidth: 760 }} className="col gap-lg">
        {/* 動画案を作るAI（接続キーの保存・削除） */}
        <div className="card">
          <h2 className="section-title">動画案を作るAI</h2>
          <p className="page-desc text-pretty">
            動画案づくりに Google の Gemini を使えます。お持ちの接続キーを、この端末の安全な保管領域に保存します（キーは画面には表示しません）。
          </p>

          <div className="toggle-row">
            <div>
              <span className="field-label" style={{ margin: 0 }}>
                接続の状態
              </span>
              <p className="field-hint" style={{ marginTop: 2 }}>
                {aiConnected
                  ? "接続済み。動画案づくりに使われます。"
                  : "未接続のときは、お試し用の動画案で仕上がりを確認できます。"}
              </p>
            </div>
            <span className={`badge ${aiConnected ? "badge-teal" : "badge-gray"}`}>
              {aiConnected ? "接続済み" : "未接続"}
            </span>
          </div>

          {aiConnected ? (
            <button
              className="btn btn-secondary"
              onClick={() => void onClearKey()}
              disabled={keyBusy}
            >
              接続を削除する
            </button>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="aiKey">
                接続キー（Gemini）
              </label>
              <div className="row gap-sm">
                <input
                  id="aiKey"
                  className="input grow"
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="接続キーを貼り付け"
                />
                <button
                  className="btn btn-primary"
                  onClick={() => void onSaveKey()}
                  disabled={!keyInput.trim() || keyBusy}
                >
                  保存する
                </button>
              </div>
              <p className="field-hint">
                キーはこの端末の安全な保管領域に保存し、画面・ファイル・送信内容には残しません。
              </p>
            </div>
          )}
          {keyError && (
            <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>
              <span>{keyError}</span>
            </div>
          )}

          <div className="field" style={{ marginTop: "var(--gap-md)" }}>
            <label className="field-label" htmlFor="aiModel">
              モデル
            </label>
            <input
              id="aiModel"
              className="input"
              value={aiModel}
              onChange={(e) => onChangeModel(e.target.value)}
              placeholder={DEFAULT_AI_MODEL}
            />
            <p className="field-hint">
              通常は変更不要です（未入力なら {DEFAULT_AI_MODEL} を使います）。無料枠の状況に応じて変更できます（例：gemini-2.5-flash-lite）。
            </p>
          </div>

          <p className="field-hint mt">※ OpenAI への接続は準備中です。</p>

          <hr className="divider" />
          <p className="field-hint">
            動画案を作る前に、外部AIへ渡す情報の確認画面を必ず表示します。
          </p>
        </div>

        {/* ナレーターの声 */}
        <div className="card">
          <h2 className="section-title">ナレーターの声</h2>
          <p className="page-desc text-pretty">
            選んだ声のクレジット（{creditForSpeaker(speaker)}）を、動画とプレビューに常に表示します。
          </p>

          <div className="field">
            <label className="field-label" htmlFor="voicevoxUrl">
              音声ソフトの接続先
            </label>
            <input
              id="voicevoxUrl"
              className="input"
              value={voicevoxUrl}
              onChange={(e) => onChangeUrl(e.target.value)}
              placeholder="http://localhost:50021"
            />
            <p className="field-hint">
              通常は空のままで大丈夫です（標準の接続先を使います）。場所を変えている場合だけ入力してください。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="voiceStyle">
              声（キャラクター・スタイル）
            </label>
            <select
              id="voiceStyle"
              className="select"
              value={speaker}
              onChange={(e) => onChangeSpeaker(Number(e.target.value))}
            >
              {VOICE_CATALOG.map((c) => (
                <optgroup key={c.character} label={c.character}>
                  {c.styles.map((s) => (
                    <option key={s.speaker} value={s.speaker}>
                      {c.character}（{s.label}）
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="field-hint">
              選んだキャラクターの名前を、動画に常時クレジット表示します。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="speed">
              話す速さ
            </label>
            <input
              id="speed"
              type="range"
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.speed ?? SPEED_RANGE.def, SPEED_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({ speed: sliderToValue(Number(e.target.value), SPEED_RANGE) })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>ゆっくり</span>
              <span>はやい</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pitch">
              声の高さ
            </label>
            <input
              id="pitch"
              type="range"
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.pitch ?? PITCH_RANGE.def, PITCH_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({ pitch: sliderToValue(Number(e.target.value), PITCH_RANGE) })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>ひくい</span>
              <span>たかい</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="intonation">
              抑揚
            </label>
            <input
              id="intonation"
              type="range"
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.intonation ?? INTONATION_RANGE.def, INTONATION_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({
                  intonation: sliderToValue(Number(e.target.value), INTONATION_RANGE),
                })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>おだやか</span>
              <span>ゆたか</span>
            </div>
          </div>

          <p className="field-hint">
            話す速さ・高さ・抑揚はこのプロジェクトのナレーションに使われます（保存すると残ります）。
          </p>

          <button
            className="btn btn-secondary"
            onClick={() => void onTestVoice()}
            disabled={testState === "loading"}
          >
            {audioPreview.playingKey === "settings"
              ? "■ 停止"
              : testState === "loading"
                ? "確認中…"
                : "声を試し聞きする"}
          </button>
          {testState === "error" && (
            <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>
              <span>{testError}</span>
            </div>
          )}
        </div>

        {/* 保存先 */}
        <div className="card">
          <h2 className="section-title">保存先</h2>
          <p className="page-desc text-pretty">
            動画の保存先は、書き出し（「動画を保存」）のときに毎回選べます。
          </p>
        </div>

        {/* H.264動画保存機能の「OpenH264フォールバック」情報。主経路は Windows 標準機能（Media Foundation）＝ADR-0013。通常＋開発中は機能フラグで既定非表示。 */}
        {OPENH264_FEATURE_ENABLED && (
          <div className="card">
            <h2 className="section-title">動画保存の予備機能</h2>
            <p className="page-desc text-pretty">
              通常は Windows の標準機能で動画を保存します。以下は予備の保存方法が使えるかどうかの状態です。
            </p>
            <div className="row-between mt">
              <span className="text-muted">状態</span>
              <strong>{H264_STATUS_LABEL[h264Status]}</strong>
            </div>
            {h264Status === "error" && (
              <p className="field-hint mt">もう一度お試しのうえ、解決しない場合はアプリを再起動してください。</p>
            )}
            {h264Status === "verificationRequired" && (
              <p className="field-hint mt">ご利用には確認が必要です。アプリを再起動してください。</p>
            )}
            <p className="field-hint mt">{OPENH264_CREDIT_TEXT}</p>
            <details style={{ marginTop: "var(--gap-sm)" }}>
              <summary className="text-sm text-muted" style={{ cursor: "pointer" }}>詳細情報</summary>
              <div className="col gap-sm mt text-sm">
                <div className="row-between"><span className="text-muted">コーデック</span><span>OpenH264（H.264）</span></div>
                <div className="row-between"><span className="text-muted">提供元</span><span>Cisco Systems, Inc.</span></div>
                <div className="row-between"><span className="text-muted">バージョン</span><span>—</span></div>
                <div className="row-between"><span className="text-muted">検証結果</span><span>—</span></div>
                <div className="row-between"><span className="text-muted">配置場所</span><span>—</span></div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
