// タイムライン形式の動画の複製・縦横を入れ替えた版（ADR-0057・#1386）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProjectIdReservations } from './assetImport';

vi.mock('../../infrastructure/projectFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/projectFs')>()),
  loadProjectDoc: vi.fn(),
  saveProjectDoc: vi.fn(async () => 'ok'),
  listProjectSummaries: vi.fn(async () => []),
}));
vi.mock('../../infrastructure/bakeFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/bakeFs')>()),
  copyBakedFiles: vi.fn(async () => ({ copied: 0, cancelled: false })),
}));
vi.mock('./restorePointKeeper', () => ({ keepRestorePoints: vi.fn(async () => {}), restoreToPoint: vi.fn(async () => 0), loadRestorePoints: vi.fn(async () => []) }));

import { useTimelineStore } from './timelineStore';
import { listProjectSummaries, loadProjectDoc, saveProjectDoc } from '../../infrastructure/projectFs';
import { copyBakedFiles } from '../../infrastructure/bakeFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { EXPORT_RUN_PHASE } from '../../domain/export/exportProgress';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';
import { DUPLICATE_FAILED_MESSAGE } from '../uiLabels';

const SRC_ID = 'proj_20261008_001';
const src: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: SRC_ID, projectName: '会社紹介',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
  clips: [
    // 右下へはみ出さない位置の文字（縦にすると小さく真ん中の帯へ）。
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 760, y: 440, w: 400, h: 200, text: 'あ' },
  ],
};

const savedById = new Map<string, string>();
beforeEach(() => {
  resetProjectIdReservations();
  savedById.clear();
  vi.mocked(copyBakedFiles).mockClear();
  vi.mocked(saveProjectDoc).mockImplementation(async (id, json) => {
    savedById.set(id, json);
    return 'ok';
  });
  vi.mocked(loadProjectDoc).mockImplementation(async (id) => savedById.get(id) ?? JSON.stringify(src));
  // 一覧には元が居る（実物と同じ）＝新しい番号は元と重ならない。
  vi.mocked(listProjectSummaries).mockResolvedValue([{ projectId: SRC_ID, projectName: src.projectName, updatedAt: src.updatedAt, format: 'timeline' }]);
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://a.png');
  useTimelineStore.getState().closeTimelineProject();
});

const saved = (id: string): TimelineProject => JSON.parse(savedById.get(id)!) as TimelineProject;

describe('duplicateTimelineProject', () => {
  it('同じ向きの複製＝別の番号・「のコピー」・素材と声を運んで保存し、開く（元は書き換えない）', async () => {
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(r.message).toBeNull();
    expect(r.projectId).not.toBe(SRC_ID);
    const d = saved(r.projectId!);
    expect(d.videoSettings.aspectRatio).toBe('16:9');
    expect(d.projectName).toContain('会社紹介');
    expect(d.projectName).not.toBe('会社紹介');
    expect(d.clips).toEqual(src.clips);
    expect(copyBakedFiles).toHaveBeenCalledWith(SRC_ID, r.projectId, expect.arrayContaining(['assets/asset_001.png']), `dup_${r.projectId}`);
    expect(savedById.has(SRC_ID)).toBe(false); // 元は保存し直していない（開いていないので）
    expect(useTimelineStore.getState().doc?.projectId).toBe(r.projectId);
    expect(useTimelineStore.getState().openNotice).toBeNull();
  });

  it('縦横を入れ替えた版＝向きが変わり、部品が写り、名前に（縦）・知らせが出る', async () => {
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, true);
    const d = saved(r.projectId!);
    expect(d.videoSettings.aspectRatio).toBe('9:16');
    expect(d.projectName).toBe('会社紹介（縦）');
    expect(d.clips[0].w).toBeCloseTo(400 * (1080 / 1920));
    expect(useTimelineStore.getState().doc?.videoSettings.aspectRatio).toBe('9:16');
    expect(useTimelineStore.getState().openNotice).toContain('縦横を入れ替えた版を作りました');
    // 部品を選んでも消えない（知らせを読んで選び直すので）。閉じると消える。
    useTimelineStore.getState().selectClip('clip_001');
    expect(useTimelineStore.getState().openNotice).toContain('縦横を入れ替えた版を作りました');
    useTimelineStore.getState().dismissOpenNotice();
    expect(useTimelineStore.getState().openNotice).toBeNull();
  });

  it('運ぶのをやめたら、保存も開きもしない', async () => {
    vi.mocked(copyBakedFiles).mockResolvedValueOnce({ copied: 0, cancelled: true } as never);
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, true);
    expect(r).toEqual({ projectId: null, message: null });
    expect(savedById.size).toBe(0);
    expect(useTimelineStore.getState().doc).toBeNull();
  });

  it('読めない元は、決まった断りを返す（作りかけを残さない）', async () => {
    vi.mocked(loadProjectDoc).mockRejectedValueOnce(new Error('disk'));
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(r).toEqual({ projectId: null, message: DUPLICATE_FAILED_MESSAGE });
    expect(savedById.size).toBe(0);
  });

  it('書き出し中は作らない', async () => {
    useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.rendering } } as never);
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(r.projectId).toBeNull();
    expect(r.message).toContain('書き出しています');
    expect(copyBakedFiles).not.toHaveBeenCalled();
    useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.idle } } as never);
  });

  it('取り込み中は作らない（開けないので、元の動画が出たまま「作りました」にしない）', async () => {
    useTimelineStore.setState({ isImporting: true });
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, true);
    useTimelineStore.setState({ isImporting: false });
    expect(r.projectId).toBeNull();
    expect(r.message).toContain('取り込んでいます');
    expect(copyBakedFiles).not.toHaveBeenCalled();
  });

  it('開いている元の保存に失敗したら作らない（古い内容の複製を成功として開かない）', async () => {
    await useTimelineStore.getState().openTimelineProject(SRC_ID);
    vi.mocked(saveProjectDoc).mockRejectedValueOnce(new Error('disk full'));
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(r.projectId).toBeNull();
    expect(r.message).toContain('保存できませんでした');
    expect(copyBakedFiles).not.toHaveBeenCalled();
  });

  it('画面に出せる理由はそのまま返す（ディスクが足りない等）', async () => {
    vi.mocked(copyBakedFiles).mockRejectedValueOnce(new Error('空き容量が足りないため、コピーできませんでした。不要なファイルを消してからお試しください。'));
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(r.message).toBe('空き容量が足りないため、コピーできませんでした。不要なファイルを消してからお試しください。');
  });

  it('開いている元を複製するときは、先に保存してから読む（保存していない変更を運ぶ）', async () => {
    await useTimelineStore.getState().openTimelineProject(SRC_ID);
    useTimelineStore.setState({ doc: { ...useTimelineStore.getState().doc!, projectName: '直した名前' } });
    const r = await useTimelineStore.getState().duplicateTimelineProject(SRC_ID, false);
    expect(saved(SRC_ID).projectName).toBe('直した名前');
    expect(saved(r.projectId!).projectName).toContain('直した名前');
  });
});
