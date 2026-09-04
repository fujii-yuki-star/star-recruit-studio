import { useEffect } from "react";
import { create } from "zustand";

/**
 * いま画面に「声をまとめて作る」の操作が置かれているか（#1024 ⑤）。
 *
 * ⚠️ **画面の名前で数えない**＝「この画面には置いてある」を一覧で持つと、
 * **画面を足したときに配り忘れる**（このリポジトリで繰り返している型）。
 * 置いてある部品自身が**居る間だけ数える**ので、置き場所が増えても減っても自動で合う。
 */
const useBulkVoicePresence = create<{ count: number; enter: () => void; leave: () => void }>((set) => ({
  count: 0,
  enter: () => set((s) => ({ count: s.count + 1 })),
  leave: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/** `BulkVoiceControls` が居る間だけ数える（この hook だけが数を動かす）。 */
export function useBulkVoiceControlsPresence(): void {
  const enter = useBulkVoicePresence((s) => s.enter);
  const leave = useBulkVoicePresence((s) => s.leave);
  useEffect(() => {
    enter();
    return leave;
  }, [enter, leave]);
}

/** 画面に操作が置かれている数（0＝どこにも出ていない＝全画面バナーの出番）。 */
export function useBulkVoiceControlsCount(): number {
  return useBulkVoicePresence((s) => s.count);
}
