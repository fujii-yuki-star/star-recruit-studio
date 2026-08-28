// クレジットの見せ方（ADR-0025・#359）。
//
// ⚠️ **About 画面のクレジットは必須で不変**（`13 §4`）＝ここで変わるのは**動画に焼く側**だけ。
// ⚠️ **非表示にできる**のは事業側の判断（社内利用・ADR-0025）。非表示のときは
// 「概要欄などに書いてください」の案内と、**貼り付けられる一覧**を出す（それが無いと守れない）。
import { useState } from "react";
import { useProjectStore } from "../store/projectStore";
import {
  CREDIT_MODE, CREDIT_SECONDS_MAX, CREDIT_SECONDS_MIN, creditClipboardText,
  resolveCreditDisplay, type CreditMode,
} from "../../domain/voice/creditDisplay";
import { usedVoiceCredits } from "../../domain/voice/narratorCredit";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";

/** 見せ方の選択肢（§2-3＝「オーバーレイ」「区間」等は出さない）。 */
const MODE_LABEL: Record<CreditMode, string> = {
  [CREDIT_MODE.always]: "ずっと出す",
  [CREDIT_MODE.head]: "最初だけ出す",
  [CREDIT_MODE.tail]: "最後だけ出す",
  [CREDIT_MODE.both]: "最初と最後に出す",
  [CREDIT_MODE.hidden]: "動画には出さない",
};

export function CreditDisplayField({ disabled }: { disabled?: boolean }) {
  const creditDisplay = useProjectStore((s) => s.meta.videoSettings.creditDisplay);
  const setCreditDisplay = useProjectStore((s) => s.setCreditDisplay);
  const scenes = useProjectStore((s) => s.scenes);
  const [copied, setCopied] = useState(false);
  const { mode, seconds } = resolveCreditDisplay(creditDisplay);
  const showSeconds = mode === CREDIT_MODE.head || mode === CREDIT_MODE.tail || mode === CREDIT_MODE.both;
  const credits = usedVoiceCredits(scenes, getVoicevoxSpeaker());

  return (
    <div className="field">
      <label className="field-label" htmlFor="credit-mode">声の表記の出し方</label>
      <select
        id="credit-mode"
        className="input"
        value={mode}
        disabled={disabled}
        onChange={(e) => { setCreditDisplay({ mode: e.target.value as CreditMode }); setCopied(false); }}
      >
        {Object.entries(MODE_LABEL).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>

      {showSeconds && (
        <label className="row gap-sm text-sm" style={{ alignItems: "center", marginTop: 6 }}>
          何秒出すか
          <input
            type="number"
            className="input"
            style={{ width: 80 }}
            min={CREDIT_SECONDS_MIN}
            max={CREDIT_SECONDS_MAX}
            value={seconds}
            disabled={disabled}
            onChange={(e) => setCreditDisplay({ seconds: Number(e.target.value) })}
          />
          秒
        </label>
      )}

      {/* ⚠️ **場面形式は場面ごとにしか切り替えられない**＝静止の場面は1枚の絵なので、途中で消すには
          その場面だけ毎フレーム描き直すことになる。**多め側**へ倒してあることを先に言う（§2-5＝
          「思ったより長く出た」を後から驚かない）。 */}
      {showSeconds && (
        <p className="field-hint">
          場面の途中では切り替えられないため、指定より長く出ることがあります（短くはなりません）。
        </p>
      )}

      {/* ⚠️ **出さないときは「代わりにどうするか」を必ず出す**（`13 §4`＝規約は守る必要がある）。 */}
      {mode === CREDIT_MODE.hidden && (
        <div className="notice notice-warn" style={{ marginTop: 8 }} role="alert">
          <p style={{ margin: 0 }}>
            動画に声の表記が入りません。公開するときは、概要欄などに次の表記を入れてください。
          </p>
          <pre className="text-sm" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{creditClipboardText(credits)}</pre>
          <button
            className="btn btn-secondary text-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(creditClipboardText(credits)).then(
                () => setCopied(true),
                // ⚠️ **コピーできなくても文は見えている**＝行き止まりにしない（手で写せる）。
                () => setCopied(false),
              );
            }}
          >
            {copied ? "コピーしました" : "この表記をコピー"}
          </button>
        </div>
      )}
    </div>
  );
}
