// タイムライン編集プロジェクトの編集状態（ADR-0032・#629）。開く・再生ヘッド・選択の不変条件を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: '焼いた動画',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: 'あ' },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://a.png');
});

describe('openTimelineProject', () => {
  it('開いた文書と素材の表示先を持つ', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    const s = useTimelineStore.getState();
    expect(s.doc?.projectName).toBe('焼いた動画');
    expect(s.assetSrcById).toEqual({ asset_001: 'asset://a.png' });
    expect(s.loadError).toBeNull();
  });

  it('開けなかったら理由を「次の行動」つきで持ち、前の文書を残さない', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue('{壊れ');
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    const s = useTimelineStore.getState();
    expect(s.doc).toBeNull();
    expect(s.loadError).toContain('一覧から別の動画を選んでください');
  });

  it('読み出しそのものが失敗しても生のエラーを見せない（§2-5）', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockRejectedValue(new Error('ENOENT: no such file'));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    const s = useTimelineStore.getState();
    expect(s.loadError).toBe('この動画を開けませんでした。一覧から選び直してください。');
    expect(s.loadError).not.toContain('ENOENT');
  });

  it('開き直すと前の選択・再生位置を持ち越さない（別の動画の状態が残らない）', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    useTimelineStore.getState().setPlayhead(3);
    useTimelineStore.getState().selectClip('clip_001');

    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    const s = useTimelineStore.getState();
    expect(s.playheadSec).toBe(0);
    expect(s.selectedClipIds).toEqual([]);
  });
});

describe('setPlayhead', () => {
  beforeEach(async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
  });

  it('動画の外へは出ない（[0, 尺] に収める）', () => {
    const { setPlayhead } = useTimelineStore.getState();
    setPlayhead(-1);
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    setPlayhead(99);
    expect(useTimelineStore.getState().playheadSec).toBe(5); // 尺＝クリップの終わり
  });
});

describe('selectClip', () => {
  it('通常は選び直し、追加選択は付け外しできる', () => {
    const { selectClip } = useTimelineStore.getState();
    selectClip('clip_001');
    expect(useTimelineStore.getState().selectedClipIds).toEqual(['clip_001']);
    selectClip('clip_002');
    expect(useTimelineStore.getState().selectedClipIds).toEqual(['clip_002']); // 選び直し
    selectClip('clip_001', true);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(['clip_002', 'clip_001']); // 追加
    selectClip('clip_002', true);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(['clip_001']); // 同じ操作で外す
  });
});

describe('編集操作と取り消し（#629 後半）', () => {
  const open = async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'い' },
      ],
    })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
  };

  beforeEach(async () => {
    await open();
  });

  it('動かせたら履歴に積み、取り消しで戻る', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.moveSelectedClip({ startSec: 20 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(20);

    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    useTimelineStore.getState().redo();
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(20);
  });

  it('置けなかったら文書を変えず、理由だけ持つ（黙って別の場所へ置かない）', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.moveSelectedClip({ startSec: 4 }); // clip_002（6秒〜）と重なる
    const after = useTimelineStore.getState();
    expect(after.doc!.clips[0].startSec).toBe(0);
    expect(after.editBlocked).toBe('TIMELINE_EDIT_OVERLAP');
    expect(after.history.past).toHaveLength(0); // 履歴も汚さない
  });

  it('複数選んでいるときは動かさない（対象が決まらない）', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.selectClip('clip_002', true);
    s.moveSelectedClip({ startSec: 20 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
  });

  it('消したクリップは選択からも外れる', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.removeSelectedClips();
    const after = useTimelineStore.getState();
    expect(after.doc!.clips.map((c) => c.id)).toEqual(['clip_002']);
    expect(after.selectedClipIds).toEqual([]);
  });

  it('列を消すと、その列のクリップも選択から外れる', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.removeTrack('track_001');
    const after = useTimelineStore.getState();
    expect(after.doc!.tracks.map((t) => t.id)).toEqual(['track_002']);
    expect(after.selectedClipIds).toEqual([]);
  });

  it('何も変わらない操作は履歴を汚さない（取り消しが空振りしない）', () => {
    useTimelineStore.getState().moveTrackOrder('track_001', 'back'); // 端＝動かない
    expect(useTimelineStore.getState().history.past).toHaveLength(0);
  });

  it('列を足す・重ね順を変える・表示を切り替えるも取り消せる', () => {
    const s = useTimelineStore.getState();
    s.addTrack(TRACK_KIND.audio);
    expect(useTimelineStore.getState().doc!.tracks).toHaveLength(3);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.tracks).toHaveLength(2);

    useTimelineStore.getState().setTrackFlag('track_001', 'hidden', true);
    expect(useTimelineStore.getState().doc!.tracks[0].hidden).toBe(true);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.tracks[0].hidden).toBeUndefined();
  });

  it('開き直すと履歴を持ち越さない（別の動画の取り消しが効かない）', async () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.moveSelectedClip({ startSec: 20 });
    await open();
    expect(useTimelineStore.getState().history.past).toHaveLength(0);
  });
});

describe('自動保存（編集した内容が消えない）', () => {
  beforeEach(async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('path');
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
  });

  it('編集すると「未保存」になり、保存でディスクへ書く', async () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.moveSelectedClip({ startSec: 3 });
    expect(useTimelineStore.getState().saveStatus).toBe('idle');

    await useTimelineStore.getState().saveTimelineProject();
    const after = useTimelineStore.getState();
    expect(after.saveStatus).toBe('saved');
    const [id, json] = vi.mocked(fsMod.saveProjectDoc).mock.calls[0];
    expect(id).toBe('proj_20260728_001');
    expect(JSON.parse(json).clips[0].startSec).toBe(3);
  });

  it('更新日時を書き換える（形式は保つ）', async () => {
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    await useTimelineStore.getState().saveTimelineProject();
    const saved = JSON.parse(vi.mocked(fsMod.saveProjectDoc).mock.calls[0][1]);
    expect(saved.format).toBe('timeline');
    expect(saved.updatedAt).not.toBe('2026-07-28T00:00:00.000Z');
  });

  it('スキーマに適合しない内容は書かない（開けない動画を作らない）', async () => {
    // 器を壊す（durationSec>0 は schema の要求）。焼き出し側と同じ判断＝未適合なら保存しない。
    const broken = useTimelineStore.getState().doc!;
    useTimelineStore.setState({
      doc: { ...broken, clips: [{ ...broken.clips[0], durationSec: 0 }] },
      saveStatus: 'idle',
    });
    await useTimelineStore.getState().saveTimelineProject();
    expect(useTimelineStore.getState().saveStatus).toBe('error');
    expect(fsMod.saveProjectDoc).not.toHaveBeenCalled();
  });

  it('書けなかったら「保存できていない」と分かる状態にする（成功に見せない）', async () => {
    vi.mocked(fsMod.saveProjectDoc).mockRejectedValue(new Error('disk full'));
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    await useTimelineStore.getState().saveTimelineProject();
    expect(useTimelineStore.getState().saveStatus).toBe('error');
  });

  it('取り消し／やり直しも未保存にする（戻した内容が保存されないままにしない）', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.moveSelectedClip({ startSec: 3 });
    useTimelineStore.setState({ saveStatus: 'saved' });
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().saveStatus).toBe('idle');
  });

  it('取り消しで消えたクリップは選択から外れる', () => {
    const s = useTimelineStore.getState();
    s.selectClip('clip_001');
    s.duplicateSelectedClip();
    const added = useTimelineStore.getState().doc!.clips[1].id;
    useTimelineStore.getState().selectClip(added);
    useTimelineStore.getState().undo(); // 複製を取り消す＝added は消える
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });
});
