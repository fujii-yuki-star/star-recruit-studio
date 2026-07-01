import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import {
  createTemplateAssetId, isTemplateAsset, templateAssetIdsOf, templateAssetSeq, TEMPLATE_ASSET_PREFIX,
} from './templateAsset';

describe('isTemplateAsset', () => {
  it('tmpl_asset_ 接頭辞のみテンプレ素材（プロジェクト素材 asset_ は false）', () => {
    expect(isTemplateAsset('tmpl_asset_001')).toBe(true);
    expect(isTemplateAsset('asset_001')).toBe(false);
    expect(isTemplateAsset('yuko_smile_001')).toBe(false);
    expect(isTemplateAsset(TEMPLATE_ASSET_PREFIX)).toBe(false); // 接頭辞のみ（_ なし）は対象外
  });
});

describe('createTemplateAssetId', () => {
  it('空なら tmpl_asset_001、既存があれば最大連番+1（他種 id は無視）', () => {
    expect(createTemplateAssetId([])).toBe('tmpl_asset_001');
    expect(createTemplateAssetId(['tmpl_asset_001', 'asset_009'])).toBe('tmpl_asset_002');
    // 空き番号は埋めない（max+1）。
    expect(createTemplateAssetId(['tmpl_asset_001', 'tmpl_asset_003'])).toBe('tmpl_asset_004');
  });

  it('採番した id はテンプレ素材判定を満たす', () => {
    const id = createTemplateAssetId(['tmpl_asset_005']);
    expect(id).toBe('tmpl_asset_006');
    expect(isTemplateAsset(id)).toBe(true);
    expect(templateAssetSeq(id)).toBe(6);
  });
});

describe('templateAssetSeq', () => {
  it('連番部分を数値で返す・テンプレ素材でない/非数値/末尾空は null', () => {
    expect(templateAssetSeq('tmpl_asset_001')).toBe(1);
    expect(templateAssetSeq('tmpl_asset_999')).toBe(999);
    expect(templateAssetSeq('asset_001')).toBeNull(); // プロジェクト素材は null
    expect(templateAssetSeq('tmpl_asset_abc')).toBeNull(); // 非数値は null
    expect(templateAssetSeq('tmpl_asset_')).toBeNull(); // 末尾空（Number('')=0 を弾く）
  });
});

describe('templateAssetIdsOf', () => {
  const layer = (id: string, assetId?: string): Layer => ({ id, type: 'background', x: 0, y: 0, w: 10, h: 10, ...(assetId ? { assetId } : {}) });

  it('レイヤーのテンプレ所有素材 id を重複なく出現順で返す（プロジェクト素材・未設定は除外）', () => {
    const layers: Layer[] = [
      layer('background', 'tmpl_asset_002'),
      layer('slot1', 'asset_999'), // プロジェクト素材は除外
      layer('logo'), // assetId なしは除外
      layer('slot2', 'tmpl_asset_001'),
      layer('slot3', 'tmpl_asset_002'), // 重複は1回
    ];
    expect(templateAssetIdsOf(layers)).toEqual(['tmpl_asset_002', 'tmpl_asset_001']);
  });

  it('テンプレ所有素材が無ければ空配列', () => {
    expect(templateAssetIdsOf([layer('background'), layer('slot', 'asset_001')])).toEqual([]);
  });
});
