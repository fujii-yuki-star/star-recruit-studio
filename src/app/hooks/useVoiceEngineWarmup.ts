// 声を使う画面を開いたら、声のエンジンを裏で起こしておく（ADR-0071 決定1）。
//
// ⚠️ **アプリの起動時には起こさない**＝声のエンジンは約 0.5GB を握る。声を使う画面に入ったときだけ起こし、
//   最初の1回の待ち（エンジンの起動）を利用者が声を作る前に済ませておく。止めるのは Rust の見張り（10 分）。
import { useEffect } from "react";
import type { ScreenId } from "../data/mockData";
import { warmVoiceEngine } from "../../infrastructure/voiceFs";
import { useStartupJobStore } from "../store/startupJobStore";

/** 声を作る操作がある画面（たたき台・場面編集・タイムライン編集・公開前チェック）。 */
export const VOICE_WARM_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  "draft",
  "scene-edit",
  "timeline-project",
  "precheck",
]);

/**
 * 声を使う画面に入るたびに、裏で起こしておく（動いていれば Rust 側が何もしない）。
 *
 * ⚠️ **起動の引数で書き出しだけを頼まれた回は起こさない**＝タイムライン形式はその書き出しを編集画面から走らせるので、
 *   画面に入っただけで起こすと、声を作らない書き出しの間ずっと約 0.5GB を握る（実機で確かめた・ADR-0071）。
 * ⚠️ **見るのは画面に入った時点だけ**＝頼まれた書き出しを取り出した（空になった）ことでは起こさない（依存に入れない）。
 */
export function useVoiceEngineWarmup(screen: ScreenId): void {
  const wants = VOICE_WARM_SCREENS.has(screen);
  useEffect(() => {
    if (!wants) return;
    if (useStartupJobStore.getState().pendingExportOut != null) return;
    void warmVoiceEngine();
  }, [screen, wants]);
}
