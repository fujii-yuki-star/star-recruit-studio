// 一覧に出すプロジェクトの小さな絵（#397）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **保存のたびに焼き直さない**＝先頭の場面が変わっていないなら作り直す意味が無い。
// 「作り直すべきか」を**印（signature）の比較**で決める（保存が体感で重くならない＝受け入れ条件）。
import type { Project, Scene } from './types';

/** 一覧に出す絵の横幅（px）。小さくしてよい＝カードに並ぶだけ。 */
export const PROJECT_THUMBNAIL_WIDTH = 320;

/** 一覧に出す絵の置き場所（プロジェクトフォルダからの相対パス）。 */
export const PROJECT_THUMBNAIL_PATH = 'preview.png';

/** 一覧に出す絵に使う場面（**先頭の場面**）。場面が無ければ `undefined`。 */
export function thumbnailScene(scenes: readonly Scene[]): Scene | undefined {
  return scenes[0];
}

/**
 * 「作り直すべきか」を決める印。
 *
 * ⚠️ **絵に効くものだけを混ぜる**＝場面の中身・見た目パターン・置いた素材・動画全体のフォント。
 * 名前や更新時刻は絵に出ないので混ぜない（混ぜると打つたびに焼き直す）。
 * ⚠️ **場面が無いときも印を返す**＝「絵が無い」状態も1つの状態として覚える
 *（場面を消したのに古い絵が残り続ける、を防ぐ）。
 */
export function thumbnailSignature(project: Pick<Project, 'scenes' | 'assets' | 'videoSettings'>): string {
  const scene = thumbnailScene(project.scenes);
  if (!scene) return 'empty';
  // 置いた素材は「どの絵か」が変われば焼き直したいので、参照している素材のパスも混ぜる。
  const usedPaths = Object.values(scene.assetRefs ?? {})
    .filter((id): id is string => typeof id === 'string')
    .map((id) => project.assets.find((a) => a.assetId === id)?.filePath ?? id)
    .sort();
  return JSON.stringify([scene, usedPaths, project.videoSettings.fontId, project.videoSettings.aspectRatio]);
}
