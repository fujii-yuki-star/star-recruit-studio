// @vitest-environment jsdom
// 動画を開いたら、説明の無い写真を裏で読む（#1317・ADR-0052 決定4）＝取り込み時に読み終える前に閉じた／前の版で取り込んだ素材も読まれる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as aiClientMod from '../../infrastructure/aiClient';
import { AI_ENGINE, setAiEngine } from '../../infrastructure/appSettings';

const SAMPLE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'yuko_recruit_docs', 'fixtures', 'project.sample.json'), 'utf8'));

/** 写真2枚（1枚は説明あり・1枚は無し）とロゴ。 */
function docWith(projectId: string) {
  const doc = structuredClone(SAMPLE);
  doc.projectId = projectId;
  doc.assets = [
    { ...SAMPLE.assets.find((a: { assetId: string }) => a.assetId === 'asset_entrance_001'), aiDescription: '利用者が書いた説明' },
    { ...SAMPLE.assets.find((a: { assetId: string }) => a.assetId === 'asset_office_001'), aiDescription: undefined, tags: [] },
    SAMPLE.assets.find((a: { assetType: string }) => a.assetType === 'logo'),
  ];
  return doc;
}

describe('開いたときに説明の無い写真を読む', () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('説明の無い写真だけを読み、利用者が書いた説明やロゴには触れない', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(docWith('proj_20261002_101')));
    vi.spyOn(aiClientMod, 'localAiAvailable').mockResolvedValue(true);
    const describeSpy = vi.spyOn(aiClientMod, 'localAiDescribeImage').mockResolvedValue(JSON.stringify({ description: '明るいオフィス', tags: ['オフィス'] }));
    await useProjectStore.getState().loadProject('proj_20261002_101');
    await vi.waitFor(() => expect(useProjectStore.getState().assets.find((a) => a.assetId === 'asset_office_001')?.aiDescription).toBe('明るいオフィス'));
    expect(describeSpy).toHaveBeenCalledTimes(1);
    expect(describeSpy.mock.calls[0].slice(3)).toEqual(['proj_20261002_101', SAMPLE.assets.find((a: { assetId: string }) => a.assetId === 'asset_office_001').filePath]);
    expect(useProjectStore.getState().assets.find((a) => a.assetId === 'asset_entrance_001')?.aiDescription).toBe('利用者が書いた説明');
  });

  // #1317 レビュー 🟡：Gemini を選んだ人は、開いただけで同梱の AI の部品を起こさない（起動の自動復元のたびにモデルを載せない）。
  it('Gemini を選んでいるときは、開いても読まない', async () => {
    setAiEngine(AI_ENGINE.gemini);
    try {
      vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(docWith('proj_20261002_103')));
      vi.spyOn(aiClientMod, 'localAiAvailable').mockResolvedValue(true);
      const describeSpy = vi.spyOn(aiClientMod, 'localAiDescribeImage').mockResolvedValue('{}');
      await useProjectStore.getState().loadProject('proj_20261002_103');
      await new Promise((r) => setTimeout(r, 30));
      expect(describeSpy).not.toHaveBeenCalled();
    } finally {
      setAiEngine(AI_ENGINE.local);
    }
  });
});
