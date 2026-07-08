// 見た目パターン（テンプレ）がどの場面で使われているかの検出（純粋ロジック・§7・#406）。
// 場面は scene.templateId でテンプレを参照する。素材の assetUsage と対で置き、逆引き導線（使用場面バッジ）で共有する。
import type { Scene } from './types';

/** この見た目（テンプレ）を使っている場面の配列（順序は scenes のまま）。逆引き（#406）に使う。 */
export function scenesUsingTemplate(scenes: Scene[], templateId: string): Scene[] {
  return scenes.filter((s) => s.templateId === templateId);
}
