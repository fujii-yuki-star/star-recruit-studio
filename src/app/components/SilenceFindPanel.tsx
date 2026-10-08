import { useEffect, useRef, useState } from "react";
import { markerClock } from "../../domain/timeline/markers";
import type { SilenceCandidate } from "../../domain/timeline/silence";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { DeleteConfirm } from "./DeleteConfirm";
import { SILENCE_APPLY_LABEL, SILENCE_FINDING, SILENCE_NONE_FOUND, silenceSummary } from "../uiLabels";

/**
 * 無音を詰める欄（#1385）。候補を見せて、選んだ所だけ詰める。
 *
 * ⚠️ **確認の形は削除の確認と同じ部品**（`DeleteConfirm`）＝【やめる／詰める（危険色）】の並び・焦点・`Escape` を共有する
 *   （詰めると中身が消えるので、削除と同じ合図にする＝`06 §2` 規約1）。
 * ⚠️ **既定は全部選ぶ**（業界の型＝CapCut の「無音を除去」は見つけた所を全部詰める）。外したい所だけ外す。
 * ⚠️ **行を押すとその時刻へ**＝詰める前に、そこが本当に要らない間かを確かめられる。
 */
export function SilenceFindPanel({
  candidates,
  fps,
  onSeek,
  onApply,
  onClose,
}: {
  /** `null`＝探している最中。 */
  candidates: SilenceCandidate[] | null;
  fps: number;
  onSeek: (sec: number) => void;
  onApply: (picked: SilenceCandidate[]) => void;
  onClose: () => void;
}) {
  // 外した候補の番号。⚠️ **どの候補の並びに対する選び直しかも持つ**＝候補が入れ替わったら前の番号を引きずらない
  //（効果の中で空に戻すと描き直しが2回走る＝lint の指摘）。
  const [offState, setOffState] = useState<{ of: SilenceCandidate[] | null; off: ReadonlySet<number> }>({ of: candidates, off: new Set() });
  const off: ReadonlySet<number> = offState.of === candidates ? offState.off : new Set();
  const setOff = (f: (prev: ReadonlySet<number>) => ReadonlySet<number>): void =>
    setOffState((st) => ({ of: candidates, off: f(st.of === candidates ? st.off : new Set()) }));
  const picked = (candidates ?? []).filter((_, i) => !off.has(i));
  const total = picked.reduce((a, c) => a + (c.endSec - c.startSec), 0);

  if (candidates === null || candidates.length === 0) {
    return <SilenceStatusBox text={candidates === null ? SILENCE_FINDING : SILENCE_NONE_FOUND} onClose={onClose} />;
  }
  return (
    <DeleteConfirm
      confirmLabel={`${SILENCE_APPLY_LABEL}（${picked.length}か所）`}
      onCancel={onClose}
      onConfirm={() => {
        if (picked.length > 0) onApply(picked);
      }}
      message={
        <>
          <span style={{ display: "block", marginBottom: 6 }}>{silenceSummary(picked.length, total)}</span>
          <span role="list" aria-label="詰める候補" style={{ display: "block", maxHeight: 240, overflowY: "auto" }}>
            {candidates.map((c, i) => (
              <span role="listitem" key={`${c.startSec}-${c.endSec}`} className="row gap-sm" style={{ alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!off.has(i)}
                  aria-label={`${markerClock(c.startSec, fps)}〜${markerClock(c.endSec, fps)} を詰める`}
                  onChange={(e) =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSeek(c.startSec)} title="この時刻へ移動します">
                  {markerClock(c.startSec, fps)}〜{markerClock(c.endSec, fps)}（{(c.endSec - c.startSec).toFixed(1)} 秒）
                </button>
              </span>
            ))}
          </span>
        </>
      }
    />
  );
}

/** 探している最中／見つからなかったときの箱（閉じるだけ）。 */
function SilenceStatusBox({ text, onClose }: { text: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEscapeReceiver(true, () => {
    onClose();
    return true;
  });
  return (
    <div className="notice notice-info" role="status">
      <span>{text}</span>
      <div className="row gap-sm">
        <button ref={closeRef} className="btn btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
