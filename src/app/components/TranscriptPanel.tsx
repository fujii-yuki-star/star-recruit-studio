import { useEffect, useRef, useState } from "react";
import { markerClock } from "../../domain/timeline/markers";
import type { TranscriptLine } from "../../domain/timeline/transcript";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { DeleteConfirm } from "./DeleteConfirm";
import {
  TRANSCRIPT_CUT_LABEL,
  TRANSCRIPT_PLACE_LABEL,
  transcribingMessage,
  transcriptCutSummary,
  transcriptSummary,
} from "../uiLabels";

/**
 * 声を文字にした結果の欄（ADR-0058・#1387）。
 *
 * - 文字にしている間＝進み具合と「やめる」。
 * - 結果＝行ごとに **選ぶ・時刻・文**。文は**その場で直せる**（判断軸3＝認識の結果を正解扱いしない）。時刻を押すとその場所へ。
 * - 「字幕として並べる」＝選んだ行を字幕に（新しい列・取り消し1回）。
 * - 「選んだ行を消して詰める」＝**もう一度確かめてから**（削除の確認と同じ部品＝`06 §2` 規約1）。
 *
 * ⚠️ **既定は全部選ぶ**（業界の型＝自動字幕は全部の文を字幕にする）。消すときは選び直す前提＝確認で数と秒を見せる。
 */
export function TranscriptPanel({
  lines,
  percent,
  fps,
  onSeek,
  onPlace,
  onCut,
  onClose,
}: {
  /** `null`＝文字にしている最中。 */
  lines: TranscriptLine[] | null;
  percent: number;
  fps: number;
  onSeek: (sec: number) => void;
  onPlace: (picked: TranscriptLine[]) => void;
  onCut: (picked: TranscriptLine[]) => void;
  onClose: () => void;
}) {
  // 直した文と外した行。⚠️ **どの結果に対する編集かも持つ**＝結果が入れ替わったら前の編集を引きずらない（無音を詰める欄と同じ）。
  const [edit, setEdit] = useState<{ of: TranscriptLine[] | null; texts: Record<number, string>; off: ReadonlySet<number> }>(
    { of: lines, texts: {}, off: new Set() },
  );
  const cur = edit.of === lines ? edit : { of: lines, texts: {}, off: new Set<number>() };
  const update = (f: (c: typeof cur) => Partial<typeof cur>): void => setEdit({ ...cur, ...f(cur) });
  const [confirmCut, setConfirmCut] = useState(false);

  if (lines === null) return <TranscribingBox percent={percent} onClose={onClose} />;

  const withText = lines.map((l, i) => ({ ...l, text: cur.texts[i] ?? l.text }));
  const picked = withText.filter((_, i) => !cur.off.has(i));
  const pickedSec = picked.reduce((a, l) => a + (l.endSec - l.startSec), 0);
  const allOn = cur.off.size === 0;

  if (confirmCut) {
    return (
      <DeleteConfirm
        message={transcriptCutSummary(picked.length, pickedSec)}
        confirmLabel={`${TRANSCRIPT_CUT_LABEL}（${picked.length}行）`}
        onCancel={() => setConfirmCut(false)}
        onConfirm={() => onCut(picked)}
      />
    );
  }
  return (
    <div className="card" role="dialog" aria-label="声を文字にした結果" style={{ width: "min(720px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 8 }}>
      <TranscriptEscape onClose={onClose} />
      <p className="text-muted" style={{ margin: 0 }}>{transcriptSummary(lines.length)}</p>
      <div className="row gap-sm">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(() => ({ off: allOn ? new Set(lines.map((_, i) => i)) : new Set() }))}>
          {allOn ? "すべて外す" : "すべて選ぶ"}
        </button>
      </div>
      <div role="list" aria-label="文字にした行" style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {withText.map((l, i) => (
          <div role="listitem" key={`${l.startSec}-${i}`} className="row gap-sm" style={{ alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!cur.off.has(i)}
              aria-label={`${markerClock(l.startSec, fps)} の行を選ぶ`}
              onChange={(e) =>
                update((c) => {
                  const off = new Set(c.off);
                  if (e.target.checked) off.delete(i);
                  else off.add(i);
                  return { off };
                })
              }
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSeek(l.startSec)} title="この時刻へ移動します" style={{ fontVariantNumeric: "tabular-nums" }}>
              {markerClock(l.startSec, fps)}
            </button>
            <input
              type="text"
              className="input"
              style={{ flex: 1 }}
              value={l.text}
              aria-label={`${markerClock(l.startSec, fps)} の文`}
              onChange={(e) => {
                const v = e.target.value;
                update((c) => ({ texts: { ...c.texts, [i]: v } }));
              }}
            />
          </div>
        ))}
      </div>
      <div className="row gap-sm" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>閉じる</button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={picked.length === 0}
          title={picked.length === 0 ? "消す行を1つ以上選んでください" : undefined}
          onClick={() => setConfirmCut(true)}
        >
          {TRANSCRIPT_CUT_LABEL}（{picked.length}行）
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={picked.every((l) => l.text.trim() === "")}
          title={picked.length === 0 ? "字幕にする行を1つ以上選んでください" : undefined}
          onClick={() => onPlace(picked)}
        >
          {TRANSCRIPT_PLACE_LABEL}（{picked.length}行）
        </button>
      </div>
    </div>
  );
}

/** `Escape` で閉じる（確認の中では確認が先に受ける）。 */
function TranscriptEscape({ onClose }: { onClose: () => void }) {
  useEscapeReceiver(true, () => {
    onClose();
    return true;
  });
  return null;
}

/** 文字にしている最中の箱（進み具合・やめる）。 */
function TranscribingBox({ percent, onClose }: { percent: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEscapeReceiver(true, () => {
    onClose();
    return true;
  });
  return (
    <div className="notice notice-info" role="status" style={{ minWidth: 320 }}>
      <span>{transcribingMessage(percent)}</span>
      <progress max={100} value={percent} aria-label="声を文字にする進み具合" style={{ width: "100%" }} />
      <div className="row gap-sm">
        <button ref={closeRef} className="btn btn-ghost" onClick={onClose}>
          やめる
        </button>
      </div>
    </div>
  );
}
