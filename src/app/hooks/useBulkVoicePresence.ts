import { useEffect } from "react";
import { create } from "zustand";
import type { BulkVoiceFormat } from "./useBulkVoiceSource";

/**
 * いま画面に「声をまとめて作る」の操作が置かれているか（#1024 ⑤）。
 *
 * ⚠️ **画面の名前で数えない**＝「この画面には置いてある」を一覧で持つと、
 * **画面を足したときに配り忘れる**（このリポジトリで繰り返している型）。
 * 置いてある部品自身が**居る間だけ数える**ので、置き場所が増えても減っても自動で合う。
 *
 * ⚠️ **形式ごとに数える**（#1019 ⑥・PR #1044 レビュー）＝2つの形式は**同時に開いたままが正規の状態**
 * なので、まとめて作るのも**同時に走りうる**。1つの数で持つと、片方の操作が画面に出ているだけで
 * **もう片方のバナーまで引っ込む**（走っているのに進み具合も中止も見えない）。
 */
const useBulkVoicePresence = create<{
  count: Record<BulkVoiceFormat, number>;
  enter: (f: BulkVoiceFormat) => void;
  leave: (f: BulkVoiceFormat) => void;
}>((set) => ({
  count: { scene: 0, timeline: 0 },
  enter: (f) => set((s) => ({ count: { ...s.count, [f]: s.count[f] + 1 } })),
  leave: (f) => set((s) => ({ count: { ...s.count, [f]: Math.max(0, s.count[f] - 1) } })),
}));

/** `BulkVoiceControls` が居る間だけ数える（この hook だけが数を動かす）。 */
export function useBulkVoiceControlsPresence(format: BulkVoiceFormat): void {
  const enter = useBulkVoicePresence((s) => s.enter);
  const leave = useBulkVoicePresence((s) => s.leave);
  useEffect(() => {
    enter(format);
    return () => leave(format);
  }, [enter, leave, format]);
}

/** その形式の操作が画面に置かれている数（0＝どこにも出ていない＝全画面バナーの出番）。 */
export function useBulkVoiceControlsCount(format: BulkVoiceFormat): number {
  return useBulkVoicePresence((s) => s.count[format]);
}
