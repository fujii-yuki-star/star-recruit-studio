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

/**
 * 「動画全体の既定の声（設定）が、いま選べない声のまま残っているか」を答える関数（app 側が差し込む）。
 *
 * ⚠️ **継承で作った読み上げも見る**（ADR-0003 追補・2026-10-16・PR レビュー 🔴）＝既定の声に青山龍星・もち子さんを
 *   選んでいた人の**継承の読み上げ**（場面の1人の読み上げ・声を指定しない行・声を指定しない読み上げの部品）は、
 *   音は外した声のままなのに、クレジットは既定（ずんだもん）へ倒れる。設定はこのパソコンにあるので、
 *   領域の外から差し込む（`voiceCatalog` の `setExtraVoiceCharacters` と同じ形＝配り忘れを作らない）。
 */
let inheritedVoiceRetired: () => boolean = () => false;

/** 既定の声が「いま選べない声」かを答える関数を差し込む（`appSettings` が読み込み時に呼ぶ）。 */
export function setInheritedVoiceRetiredProbe(probe: () => boolean): void {
  inheritedVoiceRetired = probe;
}

/** 作り済みで、いま一覧に無い声で作られたものか（声を指定しない＝継承は、既定の声が外れているときだけ）。 */
export function isGoneGeneratedVoice(v: GoneCandidate): boolean {
  if (v.status !== NARRATION_STATUS.generated || (v.text ?? '').trim().length === 0) return false;
  return v.speaker == null ? inheritedVoiceRetired() : isGoneSpeaker(v.speaker);
}

/** 場面形式＝掛け合いの行（行が無ければ1人の読み上げ）のうち、いま無い声で作り済みのものの数。 */
export function sceneGoneVoiceLineCount(
  scenes: ReadonlyArray<{ lines?: ReadonlyArray<GoneCandidate> | null; narration?: GoneCandidate | null }>,
): number {
  return scenes.reduce((n, sc) => {
    // 行があれば行が実効（`sceneLines` と同じ）＝1人の読み上げは休眠なので数えない。
    const voices = sc.lines && sc.lines.length > 0 ? sc.lines : sc.narration ? [sc.narration] : [];
    return n + voices.filter(isGoneGeneratedVoice).length;
  }, 0);
}
