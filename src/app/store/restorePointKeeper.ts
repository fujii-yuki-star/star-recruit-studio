// 保存のたびに「戻れる世代」を保つ（#263 段階2）。
//
// ⚠️ **規則は domain に置く**（`restorePoints.ts`）＝ここは「読む→決める→やる」だけ。
// いつ作るか・どれを残すかを2か所に書くと、すぐ食い違う。
import {
  restorePointsToDrop,
  shouldTakeRestorePoint,
  sortRestorePoints,
  type RestorePoint,
} from "../../domain/project/restorePoints";
import {
  dropRestorePoint,
  listRestorePoints,
  loadProjectDoc,
  readRestorePoint,
  restoreProjectText,
  takeRestorePoint,
} from "../../infrastructure/projectFs";
import { clearStaleVoices } from "../../domain/project/restoreVoices";
import { parseProjectDoc } from "../../domain/project/persistence";

/**
 * いまの `project.json` を、必要なら復元ポイントとして控え、古いぶんを片づける。
 *
 * ⚠️ **保存の前に呼ぶ**＝控えたいのは「**この保存で上書きされる前**の状態」。
 * 後に呼ぶと、いま保存した内容がそのまま世代になり、**戻っても何も変わらない**。
 * ⚠️ **失敗しても保存は止めない**＝世代は「あると助かる」もので、保存を止める理由にならない。
 * ⚠️ **落とすのは作る前**＝作ってから消すと、一瞬だけ上限を超える。
 */
export async function keepRestorePoints(projectId: string, now: number): Promise<void> {
  try {
    const points = await listRestorePoints(projectId);
    if (!shouldTakeRestorePoint(points, now)) return;
    for (const p of restorePointsToDrop(points)) {
      await dropRestorePoint(projectId, p.name);
    }
    await takeRestorePoint(projectId, now);
  } catch {
    /* 世代を残せなくても保存は続ける */
  }
}

/** 画面に出す順（新しい順）で一覧を取る。 */
export async function loadRestorePoints(projectId: string): Promise<RestorePoint[]> {
  return sortRestorePoints(await listRestorePoints(projectId));
}


/**
 * 復元ポイントへ戻す（#263 段階2）。
 *
 * ⚠️ **書き込む前に、いまの音と食い違う読み上げを「作成前」に戻す**（#967 レビュー 🟡2）＝
 * 音のファイルは決まった名前で上書きされるので**戻らない**。そのまま書くと
 * **セリフは戻った文なのに声はいまの文**という動画が、何も言われずに出る。
 * ⚠️ **戻す内容が読めないときは、そのまま書く**＝比べられないだけで、戻すこと自体は成り立つ
 *（比べられないから戻さない、にすると壊れた文書から戻れなくなる）。
 * ⚠️ **上限もここで効かせる**（#967 レビュー 🟡4）＝戻すと「戻す前の状態」が1つ増えるので、
 * 何度も戻すと**上限を超えて溜まり続ける**（次の自動保存まで刈られない）。規則は domain に1つ。
 */
export async function restoreToPoint(projectId: string, name: string): Promise<number> {
  const text = await readRestorePoint(projectId, name);
  let finalText = text;
  let cleared = 0;
  try {
    const restored = parseProjectDoc(text);
    const current = parseProjectDoc(await loadProjectDoc(projectId));
    const fixed = clearStaleVoices(restored, current);
    cleared = fixed.count.cleared;
    finalText = JSON.stringify(fixed.project, null, 2);
  } catch {
    /* 比べられないときは、戻す内容をそのまま書く */
  }
  await restoreProjectText(projectId, finalText);
  // ⚠️ **古い世代を落とすのは、戻せてから**（α-7 再監査 🟡）＝先に落とすと、書き込みに失敗したとき
  // **戻れていないのに世代だけ減る**（次の手が1つ減る）。一瞬1つ多いのは、戻せずに減るより軽い。
  // ⚠️ **刈り取りの失敗で「戻せなかった」にしない**＝あると助かる後始末であって、戻す操作の一部ではない。
  try {
    for (const p of restorePointsToDrop(await listRestorePoints(projectId))) {
      await dropRestorePoint(projectId, p.name);
    }
  } catch {
    /* 次の保存でまた刈られる（利用者へは出さない） */
  }
  return cleared;
}
