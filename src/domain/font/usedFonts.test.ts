// 使っているフォントの収集（ADR-0038・#261）。
import { describe, expect, it } from 'vitest';
import { missingUserFontIds, sceneFontIds, usedUserFontIds } from './usedFonts';
import type { Scene } from '../project/types';

const scene = (over: Partial<Scene> = {}): Scene =>
  ({ sceneId: 's1', templateId: 'tpl', durationSec: 5, texts: {}, ...over }) as unknown as Scene;

describe('sceneFontIds', () => {
  it('場面・種別ごと・自由配置の要素から集める', () => {
    const s = scene({
      fontId: 'user_font_001',
      textFontIds: { title: 'user_font_002', subtitle: 'gen-interface-jp' },
      freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 1, h: 1, fontId: 'user_font_003' }],
    } as unknown as Partial<Scene>);
    expect(sceneFontIds(s).sort()).toEqual(
      ['gen-interface-jp', 'user_font_001', 'user_font_002', 'user_font_003'].sort(),
    );
  });

  it('何も指定していない場面は空', () => {
    expect(sceneFontIds(scene())).toEqual([]);
  });

  it('null（継承）は集めない', () => {
    expect(sceneFontIds(scene({ fontId: null } as unknown as Partial<Scene>))).toEqual([]);
  });
});

describe('usedUserFontIds', () => {
  /** ⚠️ 同梱は必ずあるので、断る材料としては持ち込みだけを返す。 */
  it('持ち込みだけを返す（同梱は除く・重複なし）', () => {
    const r = usedUserFontIds([scene({ fontId: 'user_font_001' } as unknown as Partial<Scene>), scene({ fontId: 'user_font_001' } as unknown as Partial<Scene>)], 'gen-interface-jp');
    expect(r).toEqual(['user_font_001']);
  });

  it('動画全体の既定も数える', () => {
    expect(usedUserFontIds([], 'user_font_009')).toEqual(['user_font_009']);
  });

  /** ⚠️ 休眠の自由配置も数える＝種類を戻せば描かれる（「使っている」ことに変わりはない）。 */
  it('いまは描かれない自由配置の指定も数える', () => {
    const s = scene({ freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 1, h: 1, fontId: 'user_font_005' }] } as unknown as Partial<Scene>);
    expect(usedUserFontIds([s], null)).toEqual(['user_font_005']);
  });
});

describe('missingUserFontIds', () => {
  it('持っていないものだけ返す', () => {
    expect(missingUserFontIds(['user_font_001', 'user_font_002'], ['user_font_001'])).toEqual(['user_font_002']);
  });

  /**
   * ⚠️ **調べていないときは「問題なし」と言わない**（#347 と同じ流儀）＝
   * 調べられない場（ブラウザ・テスト）で嘘の安心を出さない。
   */
  it('一覧を渡さなければ（＝調べていない）何も返さない', () => {
    expect(missingUserFontIds(['user_font_001'], undefined)).toEqual([]);
  });

  it('全部そろっていれば空', () => {
    expect(missingUserFontIds(['user_font_001'], ['user_font_001', 'user_font_002'])).toEqual([]);
  });
});
