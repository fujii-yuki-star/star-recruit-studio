// 声を使う画面を開いたら、声のエンジンを裏で起こしておく（ADR-0071 決定1）。
//
// ⚠️ **アプリの起動時には起こさない**＝声のエンジンは約 0.5GB を握る。声を使う画面に入ったときだけ起こし、
//   最初の1回の待ち（エンジンの起動）を利用者が声を作る前に済ませておく。止めるのは Rust の見張り（10 分）。
import { useEffect } from "react";
import type { ScreenId } from "../data/mockData";
import { warmVoiceEngine } from "../../infrastructure/voiceFs";

/** 声を作る操作がある画面（たたき台・場面編集・タイムライン編集・公開前チェック）。 */
export const VOICE_WARM_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  "draft",
  "scene-edit",
  "timeline-project",
  "precheck",
]);

/** 声を使う画面に入るたびに、裏で起こしておく（動いていれば Rust 側が何もしない）。 */
export function useVoiceEngineWarmup(screen: ScreenId): void {
  const wants = VOICE_WARM_SCREENS.has(screen);
  useEffect(() => {
    if (wants) void warmVoiceEngine();
  }, [screen, wants]);
}
