// 場面の数の上限（#1213・`11 §4` の `MAX_SCENES_PER_VIDEO`）。**純粋関数**。
//
// ⚠️ **なぜ要るか**＝正典は「場面は80まで」と言っている
//（`schemas/project.schema.json` の `scenes.maxItems`・`11 §4`）のに、
// **画面はいくらでも足せた**。定数を見ていたのは **AI の出力を変換するとき1か所だけ**で、
// **手で足す道（足す・複製・分ける）には関門が無かった**。
//
// ⚠️ **読み込みも止めない**＝`maxItems` 違反は「構造の破損」ではないので読込拒否にならない（#416）。
// つまり **81個以上の動画が普通に作れて、普通に保存でき、外へ渡したときだけ弾かれる**。
//
// ⚠️ **80 は据え置き**（2026-09-18 利用者判断＝「場面編集においては厳格に30分である必要性は薄い」）。
// 上限そのものを動かすなら `11 §4` と schema と `constants.ts` の3点（門番＝`canonConstantsGuard`）。

import { MAX_SCENES_PER_VIDEO } from '../constants';

/** あと何場面足せるか（`0`＝もう足せない）。 */
export function sceneSlotsLeft(current: number): number {
  return Math.max(0, MAX_SCENES_PER_VIDEO - current);
}

/**
 * その数だけ足せるか。
 *
 * ⚠️ **「1つ足す」以外も通す**＝分けると1つ増え、複製でも1つ増える。**入口ごとに数えない**。
 */
export function canAddScenes(current: number, adding = 1): boolean {
  return current + adding <= MAX_SCENES_PER_VIDEO;
}

/**
 * これ以上足せないときの案内（§2-5＝原因＋**次の行動**）。
 *
 * ⚠️ **技術用語を出さない**（§2-3）＝「schema」「maxItems」ではなく「この動画に入れられる場面」。
 * ⚠️ **次の行動を2つ出す**＝**要らない場面を消す**（この動画の中で解決できる）／
 * **タイムライン形式へ焼き出す**（場面の数に縛られない形へ移る＝ADR-0032）。
 */
export function sceneLimitMessage(): string {
  return `場面は${MAX_SCENES_PER_VIDEO}個までです。要らない場面を消すか、「時間で編集する形」に焼き出してからお試しください。`;
}
