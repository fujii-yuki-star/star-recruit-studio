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
import { dropRestorePoint, listRestorePoints, takeRestorePoint } from "../../infrastructure/projectFs";

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
