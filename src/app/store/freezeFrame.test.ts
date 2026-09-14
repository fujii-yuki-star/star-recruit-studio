// 再生位置で**絵を止める**（#356 ②）＝分けて、後半を切り出した写真に替える。
//
// ⚠️ **押す前に断る**＝切り出し（重い処理）を始めてから「できません」と言わない（§2-5）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../renderer/export/rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,X') }));

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { EDIT_BLOCKED } from '../../domain/timeline/edit';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260914_001',
    projectName: 'テスト',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: ASSET_TYPE.video, displayName: '素材', filePath: 'assets/asset_001.mp4' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [{
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
      startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001',
    } as TimelineClip],
    ...over,
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false }, isImporting: false, editBlocked: null });
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://frame.png');
  vi.spyOn(assetFsMod, 'extractVideoFrame').mockResolvedValue('assets/asset_002.png');
});

describe('freezeSelectedClip（この瞬間で絵を止める）', () => {
  it('後半が「止めた絵」になり、写真が素材に増える', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    const cur = useTimelineStore.getState().doc!;
    expect(cur.clips).toHaveLength(2);
    expect(cur.clips[0]!.assetId, '前半まで替えている').toBe('asset_001');
    expect(cur.clips[1]!.assetId, '後半が止めた絵になっていない').not.toBe('asset_001');
    expect(cur.assets.some((a) => a.assetType === ASSET_TYPE.image), '切り出した写真が素材に増えていない').toBe(true);
  });

  // ⚠️ **速さのぶんも進む**＝置いた長さ × 速度 ＝ 使う素材の長さ（`11 §7.6.3.2`）。
  it('切り出すのは「素材の時刻」（速さ・頭出しを踏まえる）', async () => {
    await open(doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 2, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080,
        assetId: 'asset_001', sourceStartSec: 5, speed: 2,
      } as TimelineClip],
    }));
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(6);
    // 5 + (6-2)*2 = 13
    expect(vi.mocked(assetFsMod.extractVideoFrame).mock.calls[0]![2]).toBe(13);
  });

  // ⚠️ **重い処理を始めてから断らない**（§2-5）。
  it('動画でない部品は、切り出す前に断る', async () => {
    await open(doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ',
      } as TimelineClip],
    }));
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.freezeNotVideo);
    expect(vi.mocked(assetFsMod.extractVideoFrame), '断ったのに切り出している').not.toHaveBeenCalled();
  });

  it('帯の外では、切り出す前に断る', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(99);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitOutside);
    expect(vi.mocked(assetFsMod.extractVideoFrame)).not.toHaveBeenCalled();
  });

  // ⚠️ **切り出せなかったら、帯は触らない**＝中身の無い写真を置いた帯を作らない。
  it('切り出しに失敗したら、帯はそのまま', async () => {
    vi.spyOn(assetFsMod, 'extractVideoFrame').mockRejectedValue('この動画からは切り出せませんでした。別の時間をお試しください。');
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().doc!.clips, '失敗したのに分けている').toHaveLength(1);
    expect(useTimelineStore.getState().importError).toContain('別の時間をお試しください');
  });

  // ⚠️ **止めた絵を選び直す**（#1136 レビュー由来 🟡）＝「分ける」と同じ規則。
  // 案内（伸ばしたいときは引っぱる）の1手目が**止めた絵を選んでいること**なので、
  // 選択が前半に残ると噛み合わない。
  it('止めた絵を選び直す（分ける側と同じ規則）', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    const cur = useTimelineStore.getState();
    expect(cur.selectedClipIds).toEqual([cur.doc!.clips[1]!.id]);
  });

  // ⚠️ **1回の操作＝1つの取り消し**（ADR-0034 決定20・#1136 レビュー由来 🟡）＝
  // 素材の追加と帯の差し替えを別々に積むと、戻す途中に**使っていない写真だけ素材に残る**
  //（利用者が一度も作っていない状態）。
  it('取り消し1回で、動画にも素材にも戻る', async () => {
    await open(doc());
    const before = useTimelineStore.getState().doc!;
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    useTimelineStore.getState().undo();
    const cur = useTimelineStore.getState().doc!;
    expect(cur.clips, '帯が戻っていない').toHaveLength(before.clips.length);
    expect(cur.assets, '使っていない写真が素材に残っている').toHaveLength(before.assets.length);
  });

  // ⚠️ **切り出せなかったら、押した所へ返す**（#1136 レビュー由来 🟡）＝
  // 取り込みの断りは「置く」の欄にしか出ないので、そこだけだと何も見えないまま終わる。
  it('切り出しに失敗したら、押した所にも理由を出す', async () => {
    vi.spyOn(assetFsMod, 'extractVideoFrame').mockRejectedValue('この動画からは切り出せませんでした。別の時間をお試しください。');
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.freezeFailed);
  });

  // ⚠️ **黙って何も起きないを作らない**＝取り込み中は理由を出す（#1136 レビュー由来 🟡）。
  it('切り出し中に押したら、理由を出す', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'], isImporting: true });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().importError, '黙って何も起きない').toBeTruthy();
    expect(vi.mocked(assetFsMod.extractVideoFrame)).not.toHaveBeenCalled();
  });

  it('1つだけ選んでいないときは何もしない', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: [] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(vi.mocked(assetFsMod.extractVideoFrame)).not.toHaveBeenCalled();
  });
});
