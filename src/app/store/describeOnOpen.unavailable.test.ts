// 動画を開いたら説明の無い写真を読む（#1317）＝同梱の AI が無ければ読まない。
// ⚠️ **別のファイルに分けた**＝読む列は「使えるか」を起動中に1回だけ聞いて覚えるので、同じファイルで「使える」の検査の後に置くと覚えた答えが残る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as aiClientMod from '../../infrastructure/aiClient';

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

describe('開いたときに説明の無い写真を読む（同梱の AI が無いとき）', () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('同梱の AI が無ければ読まない', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(docWith('proj_20261002_102')));
    vi.spyOn(aiClientMod, 'localAiAvailable').mockResolvedValue(false);
    const describeSpy = vi.spyOn(aiClientMod, 'localAiDescribeImage').mockResolvedValue('{}');
    await useProjectStore.getState().loadProject('proj_20261002_102');
    await new Promise((r) => setTimeout(r, 20));
    expect(describeSpy).not.toHaveBeenCalled();
  });
});
