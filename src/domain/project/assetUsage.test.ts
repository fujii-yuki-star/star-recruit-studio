import { describe, expect, it } from 'vitest';
import { sceneActiveAssetIds, sceneActivePlacedAssetIds, scenesUsingAsset, sceneUsesAsset, unusedAssetIds } from './assetUsage';
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

  // 立ち絵は「素材」ではなく登場人物。素材として見せる用途（台本表の素材欄）に混ぜると `assetType:'yuko'` が
  // 「写真」として並ぶ＝写真を入れていない場面が「写真あり」に見える（#547 P3-14 レビュー）。
  // 逆に**素材の生存判定**（使用中カウント・削除確認）から漏らすと、使っているゆうこの表情画像を消させる。
  it('sceneActivePlacedAssetIds は立ち絵を含めない／sceneActiveAssetIds は含める', () => {
    const s = base({
      assetRefs: { mainVisual: 'asset_photo' } as never,
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never,
    });
    expect(sceneActivePlacedAssetIds(s, normalTmpl)).toEqual(['asset_photo']);
    expect(sceneActiveAssetIds(s, normalTmpl)).toEqual(['asset_photo', 'asset_pose']);
    // 立ち絵しか無い場面＝差し込み素材はゼロ（「写真なし」）だが、素材としては使用中。
    const onlyPose = base({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } as never });
    expect(sceneActivePlacedAssetIds(onlyPose, normalTmpl)).toEqual([]);
    expect(sceneUsesAsset(onlyPose, 'asset_pose', normalTmpl)).toBe(true);
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

describe('unusedAssetIds（どこからも指されていない素材・#348）', () => {
  const sc = (over: Partial<Scene>): Scene => ({
    sceneId: 's1', partId: 'p1', order: 1, sceneType: 'photo_intro', templateId: 't1',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...over,
  } as Scene);
  const a = (id: string) => ({ assetId: id });

  it('どの場面にも置かれていないものを返す', () => {
    const scenes = [sc({ assetRefs: { main: 'asset_001' } })];
    expect(unusedAssetIds([a('asset_001'), a('asset_002')], scenes)).toEqual(['asset_002']);
  });

  it('場面がひとつも無ければ全部が未使用', () => {
    expect(unusedAssetIds([a('asset_001'), a('asset_002')], [])).toEqual(['asset_001', 'asset_002']);
  });

  /**
   * ⚠️ **休眠も「置いてある」と数える**（レビュー 🟡・`11 §5` の約束）＝差し込み先の層を失った割当は
   * **見た目を戻せば再び描かれる**。消すと戻らない（`assets` は履歴の外）ので、**安全側へ倒す**。
   * ここが公開前チェックの「使っていない素材」（＝動画に出るか）と**意図的に違う**ところ。
   */
  it('差し込み先の層が無いキー（休眠）も「置いてある」と数える', () => {
    const scenes = [sc({ assetRefs: { nowhere: 'asset_001' } })];
    expect(unusedAssetIds([a('asset_001')], scenes)).toEqual([]);
  });

  /**
   * ⚠️ **通常テンプレに残った自由配置も数える**（レビュー 🔴）＝`sceneActiveAssetIds` は
   * 見た目の category でゲートするので、**見た目が解決できない場面では自由配置が1つも数えられない**。
   * 別PCへ持ち込んだ・テンプレを消した・起動直後で読み込みが着地していない、で踏む。
   * そのまま消すと**ファイルごと**消えて #347 の選び直しも効かない。
   */
  it('自由配置に置いたものも数える（見た目が分からなくても）', () => {
    const scenes = [sc({
      templateId: 'unknown',
      freeLayout: [{ id: 'free_001', kind: 'slot', assetId: 'asset_001', x: 0, y: 0, w: 1, h: 1, zIndex: 0 }],
    } as unknown as Partial<Scene>)];
    expect(unusedAssetIds([a('asset_001')], scenes)).toEqual([]);
  });

  it('立ち絵に入れたものも数える（層が無くても）', () => {
    const scenes = [sc({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' } } as Partial<Scene>)];
    expect(unusedAssetIds([a('asset_001')], scenes)).toEqual([]);
  });

  /**
   * ⚠️ **BGM も数える**（レビュー 🟡）＝BGM は場面ではなく `bgmSettings` から使われるので、
   * 場面だけを見ると**使っている BGM を「どこにも置いていない」と数える**。
   */
  it('動画全体のBGMも数える', () => {
    expect(unusedAssetIds([a('bgm_001')], [], 'bgm_001')).toEqual([]);
    expect(unusedAssetIds([a('bgm_001')], [], null)).toEqual(['bgm_001']);
  });

  it('場面ごとのBGMも数える', () => {
    const scenes = [sc({ bgmSettings: { assetId: 'bgm_002' } } as unknown as Partial<Scene>)];
    expect(unusedAssetIds([a('bgm_002')], scenes)).toEqual([]);
  });

  it('順番は素材一覧のまま（毎回同じ並び）', () => {
    expect(unusedAssetIds([a('asset_003'), a('asset_001')], [])).toEqual(['asset_003', 'asset_001']);
  });
});
