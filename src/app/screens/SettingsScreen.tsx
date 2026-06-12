import { useState } from "react";
import { PageHead, Switch } from "../components/ui";
import { FolderIcon } from "../components/icons";
import { useProjectStore } from "../store/projectStore";
import {
  getVoicevoxSpeaker, getVoicevoxUrl, setVoicevoxSpeaker, setVoicevoxUrl,
} from "../../infrastructure/appSettings";
import { NARRATOR_STYLES } from "../../domain/voice/narratorStyles";

export function SettingsScreen() {
  const synthesizePreview = useProjectStore((s) => s.synthesizePreview);

  const [ai, setAi] = useState("standard");
  const [confirmBeforeSend, setConfirmBeforeSend] = useState(true);
  const [voicevoxUrl, setUrl] = useState(() => getVoicevoxUrl());
  const [speaker, setSpeaker] = useState(() => getVoicevoxSpeaker() ?? NARRATOR_STYLES[0].speaker);
  const [speed, setSpeed] = useState(50);
  const [pitch, setPitch] = useState(50);
  const [intonation, setIntonation] = useState(50);
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

  return (
    <div className="main-scroll">
      <PageHead
        title="設定"
        desc="使用するAIやナレーターの声、保存先などを設定できます。"
      />

      <div style={{ maxWidth: 760 }} className="col gap-lg">
        {/* 使用するAI / 接続情報 */}
        <div className="card">
          <h2 className="section-title">使用するAI</h2>
          <div className="field">
            <label className="field-label" htmlFor="ai">
              動画案を作るAI
            </label>
            <select
              id="ai"
              className="select"
              value={ai}
              onChange={(e) => setAi(e.target.value)}
            >
              <option value="standard">標準のAI（おすすめ）</option>
              <option value="light">かんたんなAI（速い）</option>
              <option value="custom">自分で接続するAI</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="conn">
              接続情報
            </label>
            <input
              id="conn"
              className="input"
              type="password"
              placeholder="接続情報を入力（必要な場合のみ）"
            />
            <p className="field-hint">
              標準のAIをお使いの場合、ここは入力しなくて大丈夫です。
            </p>
          </div>

          <div className="toggle-row">
            <div>
              <span className="field-label" style={{ margin: 0 }}>
                送信前の確認
              </span>
              <p className="field-hint" style={{ marginTop: 2 }}>
                動画案を作る前に、渡す情報の確認画面を表示します。
              </p>
            </div>
            <Switch
              on={confirmBeforeSend}
              onChange={setConfirmBeforeSend}
              label="送信前の確認"
            />
          </div>
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
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
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
              value={pitch}
              onChange={(e) => setPitch(Number(e.target.value))}
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
              value={intonation}
              onChange={(e) => setIntonation(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>おだやか</span>
              <span>ゆたか</span>
            </div>
          </div>

          <p className="field-hint">話す速さ・高さ・抑揚の保存は次の更新で対応します。</p>

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
