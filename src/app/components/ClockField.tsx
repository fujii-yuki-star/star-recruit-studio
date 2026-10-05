// 時刻を見せて、そのまま打ち込める欄（UI/UX 監査 2026-10-02＝再生位置を数値で打つ手段が無かった）。
// 見せ方は `markerClock`（分:秒.コマ）＝目印・一覧と同じ書き方。打つときは同じ書き方でも、秒だけでもよい（`parseClock`）。
// ⚠️ **読めなければ打つ前の値へ戻す**＝黙って別の時刻へ飛ばない。範囲の外は端へ寄せる（数値欄と同じ作法）。
import { useState } from "react";
import { markerClock, parseClock } from "../../domain/timeline/markers";
import { isComposingReact } from "../hooks/keyboardShortcut";

export function ClockField({ value, fps, max, onCommit, ariaLabel, title }: {
  value: number;
  fps: number;
  max: number;
  onCommit: (sec: number) => void;
  ariaLabel: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? markerClock(value, fps);
  const commit = (): void => {
    if (draft == null) return;
    const sec = parseClock(draft, fps);
    setDraft(null);
    if (sec == null) return; // 読めない＝打つ前の値のまま
    onCommit(Math.min(Math.max(0, sec), max));
  };
  return (
    <input
      className="input clock-field"
      aria-label={ariaLabel}
      title={title}
      value={shown}
      inputMode="decimal"
      spellCheck={false}
      // ⚠️ **焦点が入ったら表示を止める**（PR #1340 レビュー 🟡）＝再生中は時刻が毎フレーム描き直され、選んだ範囲が
      //   外れてカーソルが末尾へ飛び、打った文字が動いている時刻の後ろへ付け足されていた。いまの値を下書きへ写して固定する。
      onFocus={(e) => { setDraft(markerClock(value, fps)); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isComposingReact(e)) return; // 変換中は奪わない（共有の判定＝古い WebView の keyCode 229 も見る）
        if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); e.currentTarget.blur(); }
      }}
    />
  );
}
