// 動画が使っているフォントの id を集める（ADR-0038・#261）。純粋関数（§7 テスト対象）。
//
// ⚠️ **「使っている」＝持ち込みフォントが見つからないときに断るための材料**。
// 同梱フォントは必ずあるので、集めるのは**持ち込み（`user_font_NNN`）だけ**でよいが、
// **判定は呼ぶ側に任せる**（全部返す）＝ここが「同梱かどうか」を知っていると、
// 同梱が増えたときに直す場所が2つになる。
import { isUserFontId } from './fontCatalog';
import type { FreeElement, Scene } from '../project/types';

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

/**
 * 動画が使っている**持ち込みフォント**の id（重複なし）。
 * `projectFontId` は動画全体の既定（`videoSettings.fontId`）。
 *
 * ⚠️ **見た目パターンは見ない**（α-6 出口監査 🟡34）＝`template.schema.json` に `fontId` は無いので、
 * 見に行く枝は**一度も動かない**（「将来のために」置いていた `templateFontIds` を消した）。
 * 正典に無いフィールドを先回りで読むと、動かない枝が残り**通っているつもり**になる（§9-2）。
 * 見た目パターンがフォントを持つようになったら、そのとき schema と一緒に足す。
 */
export function usedUserFontIds(
  scenes: readonly Scene[],
  projectFontId: string | null | undefined,
): string[] {
  const all = [
    ...(typeof projectFontId === 'string' ? [projectFontId] : []),
    ...scenes.flatMap(sceneFontIds),
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

/**
 * **タイムライン形式**の動画が使っている持ち込みフォントの id（重複なし）。
 *
 * ⚠️ **形式で挙動を割らない**（ADR-0026②）＝場面形式には「見つからない文字の形」の門があるのに
 * タイムライン形式に無いと、**同じ設定・同じ字体で片方だけ黙って既定の字体の動画が出る**
 *（ADR-0038「黙って別の字体の動画を成功として出さない」）。α-6 出口監査の 🔴1 を直して
 * タイムラインの文字クリップでも持ち込みフォントを選べるようになったので、門も要る。
 *
 * 集める場所は**保存されているすべての `fontId`**＝動画全体（`videoSettings.fontId`）／
 * クリップ（`clip.fontId`）／テンプレクリップの種別ごと（`clip.textFontIds`）。
 * ⚠️ **隠したクリップも数える**＝表示を戻せば描かれる（場面形式が休眠の自由配置を数えるのと同じ）。
 */
export function usedTimelineUserFontIds(doc: {
  videoSettings?: { fontId?: string | null };
  clips: readonly { fontId?: string | null; textFontIds?: Record<string, string | null | undefined> }[];
}): string[] {
  const all: string[] = [];
  const push = (v: unknown): void => { if (typeof v === 'string') all.push(v); };
  push(doc.videoSettings?.fontId);
  for (const c of doc.clips) {
    push(c.fontId);
    for (const v of Object.values(c.textFontIds ?? {})) push(v);
  }
  return [...new Set(all.filter(isUserFontId))];
}
