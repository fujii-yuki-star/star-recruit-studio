// 取り込んだ写真を、裏で同梱の AI に読ませて説明を当てる（ADR-0052 決定4・12 §4b）＝store の取り込みの道につながっているか。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAssetIdReservations } from './assetImport';
import { useProjectStore } from './projectStore';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as aiClientMod from '../../infrastructure/aiClient';

afterEach(() => resetAssetIdReservations());

describe('取り込み時に写真を読んで説明を当てる', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [], assetSrcById: {}, importError: null, importProgress: null,
      isImporting: false, saveStatus: 'saved',
      meta: { ...st.meta, projectId: 'proj_20260930_0001' },
    }));
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue(null);
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('取り込みを待たせずに、裏で読んで説明とタグを当て、未保存に戻す', async () => {
    vi.spyOn(aiClientMod, 'localAiAvailable').mockResolvedValue(true);
    let release!: () => void;
    const describeSpy = vi.spyOn(aiClientMod, 'localAiDescribeImage').mockImplementation(
      () => new Promise((r) => { release = () => r(JSON.stringify({ description: '明るいオフィス', tags: ['オフィス'] })); }),
    );
    await useProjectStore.getState().addAssetByPath('C:/pics/office.png');
    // 取り込みは読み終わる前に終わっている（待たない）。
    expect(useProjectStore.getState().isImporting).toBe(false);
    expect(useProjectStore.getState().assets[0].aiDescription).toBeUndefined();
    await vi.waitFor(() => expect(describeSpy).toHaveBeenCalled());
    expect(describeSpy.mock.calls[0].slice(3)).toEqual(['proj_20260930_0001', 'assets/asset_001.png']);
    useProjectStore.setState({ saveStatus: 'saved' });
    release();
    await vi.waitFor(() => expect(useProjectStore.getState().assets[0].aiDescription).toBe('明るいオフィス'));
    expect(useProjectStore.getState().assets[0].tags).toEqual(['オフィス']);
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });
});
