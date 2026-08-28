// 動画が使っているフォントの id を集める（ADR-0038・#261）。純粋関数（§7 テスト対象）。
//
// ⚠️ **「使っている」＝持ち込みフォントが見つからないときに断るための材料**。
// 同梱フォントは必ずあるので、集めるのは**持ち込み（`user_font_NNN`）だけ**でよいが、
// **判定は呼ぶ側に任せる**（全部返す）＝ここが「同梱かどうか」を知っていると、
// 同梱が増えたときに直す場所が2つになる。
import { isUserFontId } from './fontCatalog';
import type { FreeElement, Scene } from '../project/types';
import type { Template } from '../template/types';

/**
 * 場面が使っているフォントの id（動画全体の既定は含めない＝呼ぶ側が足す）。
 *
 * 集める場所は**保存されているすべての `fontId`**＝場面（`scene.fontId`）／種別ごと
 *（`scene.textFontIds`）／自由配置の要素（`freeLayout[].fontId`）。
 * ⚠️ **休眠のものも数える**＝いまは描かれない自由配置でも、種類を戻せば描かれる。
 * 「消えたフォントを使っている」ことに変わりはないので、知らせる側は広く採る。
 */
export function sceneFontIds(scene: Scene): string[] {
  const out: string[] = [];
  if (typeof scene.fontId === 'string') out.push(scene.fontId);
  for (const v of Object.values(scene.textFontIds ?? {})) {
    if (typeof v === 'string') out.push(v);
  }
  for (const el of scene.freeLayout ?? []) {
    const f = (el as FreeElement).fontId;
    if (typeof f === 'string') out.push(f);
  }
  return out;
}

/** 見た目パターンが使っているフォントの id（テンプレは `fontId` を持たないが、将来のために入口を1つにする）。 */
export function templateFontIds(template: Template): string[] {
  const out: string[] = [];
  for (const layer of template.layers ?? []) {
    const f = (layer as { fontId?: unknown }).fontId;
    if (typeof f === 'string') out.push(f);
  }
  return out;
}

/**
 * 動画が使っている**持ち込みフォント**の id（重複なし）。
 * `projectFontId` は動画全体の既定（`videoSettings.fontId`）。
 */
export function usedUserFontIds(
  scenes: readonly Scene[],
  projectFontId: string | null | undefined,
  templates: readonly Template[] = [],
): string[] {
  const all = [
    ...(typeof projectFontId === 'string' ? [projectFontId] : []),
    ...scenes.flatMap(sceneFontIds),
    ...templates.flatMap(templateFontIds),
  ];
  return [...new Set(all.filter(isUserFontId))];
}

/**
 * 使っているのに**見つからない**持ち込みフォントの id。
 *
 * ⚠️ **`availableIds` を渡さなかったら「調べていない」**＝空配列を返す。
 * 調べられない場（ブラウザ・テスト）で**嘘の「問題なし」を出さない**ため、
 * 呼ぶ側は「調べたときだけ渡す」（`missingAssetIds` と同じ流儀・#347）。
 */
export function missingUserFontIds(
  usedIds: readonly string[],
  availableIds: readonly string[] | undefined,
): string[] {
  if (!availableIds) return [];
  const have = new Set(availableIds);
  return usedIds.filter((id) => !have.has(id));
}
