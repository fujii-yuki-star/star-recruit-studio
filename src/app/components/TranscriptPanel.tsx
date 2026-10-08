import { useEffect, useRef, useState, type RefObject } from "react";
import { markerClock } from "../../domain/timeline/markers";
import type { TranscriptLine } from "../../domain/timeline/transcript";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { DeleteConfirm } from "./DeleteConfirm";
import {
  TRANSCRIPT_CUT_ALL_WARNING,
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
 * ⚠️ **既定は全部選ぶ**（業界の型＝自動字幕は全部の文を字幕にする）。消すときは選び直す前提＝確認で数と秒を見せ、
 *   全部を選んだままなら「話している所をすべて消す」と言う（#1387 段2のレビュー）。
 * ⚠️ **直した文を黙って捨てない**＝直した後に閉じるときは確かめる／文を打っている欄の `Escape` は欄から手を離すだけ。
 * ⚠️ **押す前に断る**＝固定した列があると消して詰められない（`cutDisabledReason`・無音を詰めると同じ）。
 */
export function TranscriptPanel({
  lines,
  percent,
  fps,
  onSeek,
  onPreview,
  onPlace,
  onCut,
  onClose,
  cutDisabledReason,
}: {
  /** `null`＝文字にしている最中。 */
  lines: TranscriptLine[] | null;
  percent: number;
  fps: number;
  onSeek: (sec: number) => void;
  /** その行を鳴らす（行の始まりから終わりまで＝耳で確かめる・無音を詰めるの「聞く」と同じ）。 */
  onPreview: (line: TranscriptLine) => void;
  /** 消して詰められない理由（固定した列がある等）。あれば押す前に押せなくする。 */
  cutDisabledReason?: string;
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
  const [confirmClose, setConfirmClose] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const showList = lines !== null && !confirmCut && !confirmClose;
  // ⚠️ **欄の中に手を閉じ込める**（削除の確認と同じ部品）＝Tab で後ろの編集画面へ抜けない・閉じたら押した所へ戻す。
  useFocusTrap(showList, boxRef, firstRef);
  const dirty = Object.keys(cur.texts).length > 0;
  const requestClose = (): void => (dirty ? setConfirmClose(true) : onClose());

  if (lines === null) return <TranscribingBox percent={percent} onClose={onClose} />;

  const withText = lines.map((l, i) => ({ ...l, text: cur.texts[i] ?? l.text }));
  const picked = withText.filter((_, i) => !cur.off.has(i));
  const pickedSec = picked.reduce((a, l) => a + (l.endSec - l.startSec), 0);
  const allOn = cur.off.size === 0;
  // 字幕になる行の数（文が空の行は字幕にならない＝押す前の数と並べる数をそろえる）。
  const placeable = picked.filter((l) => l.text.trim() !== "").length;

  if (confirmClose) {
    return (
      <DeleteConfirm
        message="直した文は消えます。閉じますか？（もう一度見るには、文字にするところからやり直します）"
        confirmLabel="閉じる"
        onCancel={() => setConfirmClose(false)}
        onConfirm={onClose}
      />
    );
  }
  if (confirmCut) {
    return (
      <DeleteConfirm
        message={allOn ? `${TRANSCRIPT_CUT_ALL_WARNING}${transcriptCutSummary(picked.length, pickedSec)}` : transcriptCutSummary(picked.length, pickedSec)}
        confirmLabel={`${TRANSCRIPT_CUT_LABEL}（${picked.length}行）`}
        onCancel={() => setConfirmCut(false)}
        onConfirm={() => onCut(picked)}
      />
    );
  }
  return (
    <div ref={boxRef} className="card" role="dialog" aria-modal="true" aria-label="声を文字にした結果" style={{ width: "min(720px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 8 }}>
      <TranscriptEscape boxRef={boxRef} onClose={requestClose} />
      <p className="text-muted" style={{ margin: 0 }}>{transcriptSummary(lines.length)}</p>
      <div className="row gap-sm">
        <button ref={firstRef} type="button" className="btn btn-ghost btn-sm" onClick={() => update(() => ({ off: allOn ? new Set(lines.map((_, i) => i)) : new Set() }))}>
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreview(l)} title="この行を鳴らします">
              聞く
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
        <button type="button" className="btn btn-ghost" onClick={requestClose}>閉じる</button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={picked.length === 0 || cutDisabledReason != null}
          title={cutDisabledReason ?? (picked.length === 0 ? "消す行を1つ以上選んでください" : undefined)}
          onClick={() => setConfirmCut(true)}
        >
          {TRANSCRIPT_CUT_LABEL}（{picked.length}行）
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={placeable === 0}
          title={picked.length === 0 ? "字幕にする行を1つ以上選んでください" : placeable === 0 ? "文が空の行は字幕になりません。文を書いてから押してください" : undefined}
          onClick={() => onPlace(picked)}
        >
          {TRANSCRIPT_PLACE_LABEL}（{placeable}行）
        </button>
      </div>
    </div>
  );
}

/**
 * `Escape` で閉じる（確認の中では確認が先に受ける）。
 * ⚠️ **文を打っている欄の中では、欄から手を離すだけ**＝直している最中の `Escape` で一覧ごと閉じない（業界の型）。
 */
function TranscriptEscape({ boxRef, onClose }: { boxRef: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  useEscapeReceiver(true, () => {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.matches('input[type="text"]') && boxRef.current?.contains(a)) {
      a.blur();
      return true;
    }
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
