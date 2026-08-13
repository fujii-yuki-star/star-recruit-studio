// 要素アニメーション（④・ADR-0019）の一覧操作。純粋・決定論（§7 テスト対象）。
// 場面複製/分割での引き継ぎ・要素削除時の孤児掃除など、timelineOverlay.animations の変換をここに集約する。
import type { ElementAnimation } from './types';

/**
 * 場面複製/分割で、元場面(srcSceneId)の要素アニメを新場面(newSceneId)向けに複製する。
 * 複製/分割は freeLayout の要素id を変えない（`{ ...src }`）ので targetId はそのまま、sceneId だけ差し替え、
 * id は makeId で新規採番する（採番中の重複を避けるため、生成済み id も渡して逐次発番）。
 * @param makeId 既存 id 群から未使用の anim_NNN を返す採番関数（createAnimationId を渡す）
 */
export function duplicateSceneAnimations(
  animations: readonly ElementAnimation[],
  srcSceneId: string,
  newSceneId: string,
  makeId: (existingIds: readonly string[]) => string,
): ElementAnimation[] {
  const ids = animations.map((a) => a.id);
  const out: ElementAnimation[] = [];
  for (const a of animations) {
    if (a.sceneId !== srcSceneId) continue;
    const id = makeId([...ids, ...out.map((o) => o.id)]);
    out.push({ ...a, id, sceneId: newSceneId, keyframes: a.keyframes.map((k) => ({ ...k })) });
  }
  return out;
}

/**
 * 指定場面(sceneId)の指定要素(targetIds)に紐づくアニメを取り除いた一覧を返す。
 * 要素削除時に孤児アニメが timelineOverlay に残らないようにする（掃除・④）。他場面/他要素のアニメは不変。
 */
export function removeAnimationsForTargets(
  animations: readonly ElementAnimation[],
  sceneId: string,
  targetIds: readonly string[],
): ElementAnimation[] {
  const targets = new Set(targetIds);
  return animations.filter((a) => !(a.sceneId === sceneId && targets.has(a.targetId)));
}

/**
 * その要素に付いている動き（キーフレーム）だけを**取り出す**（複製・コピーの前半・#770）。
 *
 * ⚠️ **コピーは押した時点で取り出すこと**＝貼るのは別の場面かもしれず、そのとき元をたどれない
 * （要素そのものを控えるのと同じ扱い＝`perUseEntriesFor` と同じ理由）。
 */
export function animationsForElement(
  animations: readonly ElementAnimation[],
  sceneId: string,
  targetId: string,
): ElementAnimation[] {
  return animations.filter((a) => a.sceneId === sceneId && a.targetId === targetId);
}

/**
 * 取り出した動きを、**複製先の場面・要素へ宛て直して**足せる形にする（複製・貼り付けの後半・#770）。
 *
 * 場面まるごとの複製（`duplicateSceneAnimations`）は要素 id が変わらないので `sceneId` だけ差し替えるが、
 * こちらは**要素ひとつ**の複製＝`targetId` が変わり、貼り付けでは場面も変わりうるので両方を宛て直す。
 *
 * **なぜ必要か**＝宛て直して足さないと**動く要素を複製したのに動かない複製**ができる（空の複製）。
 * 消す側（`removeAnimationsForTargets`）は対で片づけているのに、複製側だけ欠けていた。
 *
 * id は**一度に採る**（1つずつ採ると同じ番号を2度出す）。渡すものが無ければ**空配列**を返す
 * （呼び出し側は足すものが無いと分かる）。
 */
export function retargetAnimations(
  source: readonly ElementAnimation[],
  existing: readonly ElementAnimation[],
  sceneId: string,
  targetId: string,
  makeId: (existingIds: readonly string[]) => string,
): ElementAnimation[] {
  const ids = existing.map((a) => a.id);
  const out: ElementAnimation[] = [];
  for (const a of source) {
    const id = makeId([...ids, ...out.map((o) => o.id)]);
    out.push({ ...a, id, sceneId, targetId, keyframes: a.keyframes.map((k) => ({ ...k })) });
  }
  return out;
}
