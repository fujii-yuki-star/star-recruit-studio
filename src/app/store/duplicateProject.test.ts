// 動画の複製（#395）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/projectFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/projectFs')>()),
  loadProjectDoc: vi.fn(),
  saveProjectDoc: vi.fn(async () => 'ok'),
  listProjectSummaries: vi.fn(async () => []),
}));
vi.mock('../../infrastructure/bakeFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/bakeFs')>()),
  copyBakedFiles: vi.fn(async () => {}),
}));

import { useProjectStore } from './projectStore';
import { listProjectSummaries, loadProjectDoc, saveProjectDoc } from '../../infrastructure/projectFs';
import { copyBakedFiles } from '../../infrastructure/bakeFs';

const doc = {
  schemaVersion: '1.25',
  projectId: 'proj_20260101_001',
  projectName: '会社紹介',
  purpose: 'company_intro',
  videoKind: 'recruit',
  companyInfo: { companyName: 'すたりお' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
  parts: [],
  scenes: [],
};

// 保存した本文を覚えておき、複製を開くときはそれを返す（実物と同じ流れ＝保存→読込）。
const savedById = new Map<string, string>();

beforeEach(() => {
  savedById.clear();
  vi.mocked(saveProjectDoc).mockImplementation(async (id, json) => {
    savedById.set(id, json);
    return 'ok';
  });
  vi.mocked(loadProjectDoc).mockImplementation(async (id) => savedById.get(id) ?? JSON.stringify(doc));
  vi.mocked(listProjectSummaries).mockResolvedValue([]);
  useProjectStore.getState().setExportRun({ phase: 'idle' });
  useProjectStore.setState({ importError: null } as never);
});
afterEach(() => vi.clearAllMocks());

describe('duplicateProject', () => {
  it('新しい番号で保存し、名前に「のコピー」を付ける', async () => {
    const id = await useProjectStore.getState().duplicateProject('proj_20260101_001');
    expect(id).toMatch(/^proj_\d{8}_\d{3}$/);
    expect(id).not.toBe('proj_20260101_001');
    const saved = JSON.parse(vi.mocked(saveProjectDoc).mock.calls[0][1]);
    expect(saved.projectId).toBe(id);
    expect(saved.projectName).toBe('会社紹介 のコピー');
  });

  it('素材・場面・設定をそのまま持っていく（作り替えない）', async () => {
    await useProjectStore.getState().duplicateProject('proj_20260101_001');
    const saved = JSON.parse(vi.mocked(saveProjectDoc).mock.calls[0][1]);
    expect(saved.assets).toEqual(doc.assets); // `asset_NNN` は振り直さない
    expect(saved.companyInfo).toEqual(doc.companyInfo);
    // ⚠️ 読込の移行（`migrateProject`）が既定フォントを補うので、**入れたものが残る**ことを見る
    //（丸ごと一致で比べると、移行が足したぶんで落ちて検査にならない）。
    expect(saved.videoSettings).toMatchObject(doc.videoSettings);
  });

  it('素材と声のファイルを運ぶ', async () => {
    await useProjectStore.getState().duplicateProject('proj_20260101_001');
    expect(copyBakedFiles).toHaveBeenCalledWith('proj_20260101_001', expect.any(String), ['assets/asset_001.png']);
  });

  /**
   * ⚠️ **ファイルを運んでから文書を保存する**（焼き出しと同じ順）＝逆にすると、
   * 素材の無い動画が一覧に残る。
   */
  it('ファイルを運んでから文書を保存する', async () => {
    const order: string[] = [];
    vi.mocked(copyBakedFiles).mockImplementation(async () => { order.push('copy'); });
    vi.mocked(saveProjectDoc).mockImplementation(async (id, json) => {
      order.push('save');
      savedById.set(id, json);
      return 'ok';
    });
    await useProjectStore.getState().duplicateProject('proj_20260101_001');
    expect(order).toEqual(['copy', 'save']);
  });

  /** ⚠️ **元は読むだけ**＝複製で元の動画を書き換えない。 */
  it('元の動画へは書き込まない', async () => {
    await useProjectStore.getState().duplicateProject('proj_20260101_001');
    for (const [savedId] of vi.mocked(saveProjectDoc).mock.calls) {
      expect(savedId).not.toBe('proj_20260101_001');
    }
  });

  it('できたら開く（作っただけで見えない、を作らない）', async () => {
    const id = await useProjectStore.getState().duplicateProject('proj_20260101_001');
    expect(useProjectStore.getState().meta.projectId).toBe(id);
  });

  it('番号は既にあるものとかぶらない', async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    vi.mocked(listProjectSummaries).mockResolvedValue([{ projectId: `proj_${today}_001` }] as never);
    const id = await useProjectStore.getState().duplicateProject('proj_20260101_001');
    expect(id).toBe(`proj_${today}_002`);
  });

  it('読めなければ理由を出し、null を返す', async () => {
    vi.mocked(loadProjectDoc).mockRejectedValue('読めません');
    expect(await useProjectStore.getState().duplicateProject('proj_20260101_001')).toBeNull();
    expect(useProjectStore.getState().importError).toBe('読めません');
    expect(saveProjectDoc).not.toHaveBeenCalled();
  });

  /** ⚠️ 書き出し中は別の動画へ切り替えない（進行中の書き出しが見ているものを保つ・#379）。 */
  it('書き出し中は複製しない', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    expect(await useProjectStore.getState().duplicateProject('proj_20260101_001')).toBeNull();
    expect(saveProjectDoc).not.toHaveBeenCalled();
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });
});
