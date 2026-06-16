import { useEffect, useState } from "react";
import { PageHead } from "../components/ui";
import { FolderIcon } from "../components/icons";
import { useProjectStore } from "../store/projectStore";
import { GEMINI_PROVIDER, deleteApiKey, hasApiKey, saveApiKey } from "../../infrastructure/aiClient";
import {
  getVoicevoxSpeaker, getVoicevoxUrl, setVoicevoxSpeaker, setVoicevoxUrl,
} from "../../infrastructure/appSettings";
import { NARRATOR_STYLES } from "../../domain/voice/narratorStyles";
import {
  INTONATION_RANGE, PITCH_RANGE, SPEED_RANGE, sliderToValue, valueToSlider,
} from "../../domain/voice/voiceParams";

export function SettingsScreen() {
  const synthesizePreview = useProjectStore((s) => s.synthesizePreview);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);

  const [keyInput, setKeyInput] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [voicevoxUrl, setUrl] = useState(() => getVoicevoxUrl());
  const [speaker, setSpeaker] = useState(() => getVoicevoxSpeaker() ?? NARRATOR_STYLES[0].speaker);
  const [testState, setTestState] = useState<"idle" | "loading" | "error">("idle");
  const [testError, setTestError] = useState("");

  function onChangeUrl(value: string) {
    setUrl(value);
    setVoicevoxUrl(value);
  }
  function onChangeSpeaker(value: number) {
    setSpeaker(value);
    setVoicevoxSpeaker(value);
  }
  async function onTestVoice() {
    setTestState("loading");
    setTestError("");
    try {
      const url = await synthesizePreview();
      // 再生失敗（コーデック/自動再生制限など）も握りつぶさず通知する（§2-5）。
      await new Audio(url).play();
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
                  : "未接続のときは、お試し用の動画案でプレビューできます。"}
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
            ナレーションには VOICEVOX：ずんだもん を使います。
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
              声のスタイル
            </label>
            <select
              id="voiceStyle"
              className="select"
              value={speaker}
              onChange={(e) => onChangeSpeaker(Number(e.target.value))}
            >
              {NARRATOR_STYLES.map((s) => (
                <option key={s.speaker} value={s.speaker}>
                  {s.label}
                </option>
              ))}
            </select>
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
            {testState === "loading" ? "確認中…" : "声を試し聞きする"}
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
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">保存先フォルダ</label>
            <div className="row gap-sm">
              <div className="input row gap-sm" style={{ alignItems: "center" }}>
                <FolderIcon size={16} className="text-faint" />
                <span className="text-sm grow">C:\Users\採用担当\動画</span>
              </div>
              <button className="btn btn-secondary">変更する</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
