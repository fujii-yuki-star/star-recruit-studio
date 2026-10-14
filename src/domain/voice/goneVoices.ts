// 作り済みの読み上げなのに、その声がいま一覧に無い（拡張パックを外した）ものを見つける（ADR-0060 段階3・PR レビュー 🔴）。
//
// ⚠️ **クレジットが別のキャラになる**＝声の名前の引き当て（`characterForSpeaker`）が引けないと、クレジットは既定のキャラへ倒れる
//   （`creditForLine`）。作り直す分には V19 どおり既定の声で作るので合うが、**作り済みの音はパックの声のまま**なので、
//   そのまま書き出すと「鳴っている声と名乗るキャラが違う」動画になる（ADR-0003）。書き出しの前に止める。
// ⚠️ **見るのは行・読み上げに直接選んだ声だけ**＝パックの声は動画全体の既定の声には選べない（設定の声の一覧は同梱だけ）。
import { characterForSpeaker } from './voiceCatalog';
import { NARRATION_STATUS } from '../enums';

/** その声がいま一覧に無いか（未指定＝継承は「無い」と言わない）。 */
export function isGoneSpeaker(speaker: number | null | undefined): boolean {
  return speaker != null && characterForSpeaker(speaker) == null;
}

type GoneCandidate = { speaker?: number | null; status?: string; text?: string };

/** 作り済みで、いま一覧に無い声で作られたものか。 */
export function isGoneGeneratedVoice(v: GoneCandidate): boolean {
  return v.status === NARRATION_STATUS.generated && (v.text ?? '').trim().length > 0 && isGoneSpeaker(v.speaker);
}

/** 場面形式＝掛け合いの行のうち、いま無い声で作り済みのものの数。 */
export function sceneGoneVoiceLineCount(scenes: ReadonlyArray<{ lines?: ReadonlyArray<GoneCandidate> | null }>): number {
  return scenes.reduce((n, sc) => n + (sc.lines ?? []).filter(isGoneGeneratedVoice).length, 0);
}
