import { describe, expect, it } from 'vitest';
import { sceneActiveAssetIds, scenesUsingAsset, sceneUsesAsset } from './assetUsage';
import type { Scene } from './types';
import type { Template } from '../template/types';

const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: 's', partId: 'p', order: 1, sceneType: 'photo_intro', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as unknown as Scene);

// 通常テンプレは category に加え **layers** も見る＝差し込み先（background/slot/logo）と character 層の実在で
// 実効使用を絞る（#547 P3-14）。FREE は freeLayout が実効表現なので category だけで足りる。
const layer = (id: string, type: Template['layers'][number]['type']) => ({ id, type, x: 0, y: 0, w: 10, h: 10 });
const normalTmpl = {
  category: 'photo_intro',
  layers: [layer('background', 'background'), layer('mainVisual', 'slot'), layer('slot', 'slot'), layer('yuko', 'character')],
} as Template;
/** 差し込み先も立ち絵枠も持たない通常テンプレ（切替先に受け皿が無い＝休眠になるケース）。 */
const textOnlyTmpl = { category: 'message', layers: [layer('title', 'text')] } as Template;
/** 層を持たない FREE テンプレ（自由配置だけが実効表現）。 */
const freeTmpl = { category: 'free', layers: [] } as unknown as Template;
/** 同梱の自由配置テンプレと同じく `background` 層を持つ FREE テンプレ（背景写真は FREE でも動画に出る）。 */
const freeWithBgTmpl = { category: 'free', layers: [layer('background', 'background')] } as unknown as Template;

describe('assetUsage（実効使用・ADR-0030）', () => {
  it('通常場面：assetRefs のスロット割当を検出（null 値は無視）', () => {
    const s = base({ assetRefs: { mainVisual: 'asset_001', logo: null } as never });
    expect(sceneUsesAsset(s, 'asset_001', normalTmpl)).toBe(true);
    expect(sceneUsesAsset(s, 'asset_999', normalTmpl)).toBe(false);
  });

  it('通常場面：character.poseAssetId を検出', () => {
    const s = base({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never });
    expect(sceneUsesAsset(s, 'asset_pose', normalTmpl)).toBe(true);
  });

  it('FREE 場面：freeLayout の assetId を検出（ADR-0008）', () => {
    const s = base({ templateId: 'free_v1', sceneType: 'free', freeLayout: [{ id: 'el1', assetId: 'asset_free' }] as never });
    expect(sceneUsesAsset(s, 'asset_free', freeTmpl)).toBe(true);
  });

  it('休眠は数えない：通常場面の freeLayout・FREE 場面の assetRefs/character（ADR-0030・#524 P2）', () => {
    // 通常場面に残った休眠 freeLayout の素材は使用扱いにしない（描画されない）。
    const normalDormant = base({ freeLayout: [{ id: 'e', assetId: 'asset_free' }] as never });
    expect(sceneUsesAsset(normalDormant, 'asset_free', normalTmpl)).toBe(false);
    // FREE 場面の休眠 assetRefs・character は使用扱いにしない（freeLayout が実効表現）。
    const freeDormant = base({
      templateId: 'free_v1', sceneType: 'free',
      assetRefs: { slot: 'asset_ref' } as never,
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never,
      freeLayout: [] as never,
    });
    expect(sceneUsesAsset(freeDormant, 'asset_ref', freeTmpl)).toBe(false);
    expect(sceneUsesAsset(freeDormant, 'asset_pose', freeTmpl)).toBe(false);
  });

  // `layoutScene` は category を見ずに層を辿るので、FREE テンプレでも background 層があれば背景写真は動画に出る
  // （場面編集の「使用素材」も FREE で出る）。category でまとめて休眠扱いにすると、出ている写真を
  // 「どの場面でも使われていません」と言って消させてしまう（#547 P3-14 レビュー）。
  it('FREE 場面：テンプレに差し込み先があれば assetRefs も数える（背景写真は FREE でも出る）', () => {
    const s = base({
      templateId: 'free_v1', sceneType: 'free',
      assetRefs: { background: 'asset_bg', mainVisual: 'asset_dormant' } as never,
      freeLayout: [{ id: 'e', assetId: 'asset_free' }] as never,
    });
    expect(sceneActiveAssetIds(s, freeWithBgTmpl).sort()).toEqual(['asset_bg', 'asset_free']);
    expect(sceneUsesAsset(s, 'asset_dormant', freeWithBgTmpl)).toBe(false); // 差し込み先が無いキーは休眠
    expect(sceneActiveAssetIds(s, freeTmpl)).toEqual(['asset_free']); // 層が無い FREE テンプレなら自由配置だけ
  });

  it('通常場面：差し込み先の層が無いキーは休眠＝数えない（切替で残った割当・#547 P3-14）', () => {
    const s = base({ assetRefs: { mainVisual: 'asset_shown', oldSlot: 'asset_dormant' } as never });
    expect(sceneUsesAsset(s, 'asset_shown', normalTmpl)).toBe(true);
    expect(sceneUsesAsset(s, 'asset_dormant', normalTmpl)).toBe(false); // 層が無い＝動画に出ない
    // 差し込み先を持たない見た目へ変えると、両方とも休眠になる（元の見た目へ戻せばまた数える＝非破壊往復）。
    expect(sceneActiveAssetIds(s, textOnlyTmpl)).toEqual([]);
  });

  it('通常場面：character 層が無い見た目では立ち絵も数えない（assetRefs と同じ規則・ADR-0026②）', () => {
    const s = base({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never });
    expect(sceneUsesAsset(s, 'asset_pose', normalTmpl)).toBe(true); // yuko 層あり
    expect(sceneUsesAsset(s, 'asset_pose', textOnlyTmpl)).toBe(false); // 立ち絵枠が無い＝出ない
  });

  it('sceneActiveAssetIds：template 未解決は通常扱い（assetRefs＋character・freeLayout は休眠）', () => {
    const s = base({
      assetRefs: { slot: 'A' } as never,
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'P' } as never,
      freeLayout: [{ id: 'e', assetId: 'F' }] as never,
    });
    expect(sceneActiveAssetIds(s, undefined).sort()).toEqual(['A', 'P']); // freeLayout(F) は数えない
  });

  it('scenesUsingAsset は実効使用場面だけ返す（順序保持・テンプレでゲート）', () => {
    const scenes = [
      base({ sceneId: 's1', assetRefs: { slot: 'A' } as never }), // 通常＝A 使用
      base({ sceneId: 's2', assetRefs: {} as never }),
      base({ sceneId: 's3', templateId: 'free_v1', sceneType: 'free', freeLayout: [{ id: 'e', assetId: 'A' }] as never }), // FREE＝A 使用
      base({ sceneId: 's4', freeLayout: [{ id: 'e', assetId: 'A' }] as never }), // 通常＋休眠 freeLayout＝不使用
    ];
    const templateOf = (s: Scene): Template => (s.templateId === 'free_v1' ? freeTmpl : normalTmpl);
    expect(scenesUsingAsset(scenes, 'A', templateOf).map((s) => s.sceneId)).toEqual(['s1', 's3']);
    expect(scenesUsingAsset(scenes, 'Z', templateOf)).toEqual([]);
  });
});
