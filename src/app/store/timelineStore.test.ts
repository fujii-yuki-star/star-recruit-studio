// タイムライン編集プロジェクトの編集状態（ADR-0032・#629）。開く・再生ヘッド・選択の不変条件を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as voiceFsMod from '../../infrastructure/voiceFs';
import * as bgmMod from '../../infrastructure/bundledBgm';
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

describe('createTimelineProject（完全新規・#635）', () => {
  it('id を発行して保存し、そのまま開いた状態になる', async () => {
    const list = vi.spyOn(fsMod, 'listProjectSummaries').mockResolvedValue([
      { projectId: 'proj_20260801_001', projectName: '既存', updatedAt: '2026-08-01T00:00:00.000Z' } as never,
    ]);
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    const id = await useTimelineStore.getState().createTimelineProject('新しいタイムライン');
    // 既存と重ならない番号が付く（採番は場面形式と共通）。
    expect(id).not.toBe('proj_20260801_001');
    // **採番の前に場面形式の保存を待つ**（同じ番号を二重に発行しないため）＝場面の保存 → 一覧 → 採番の順。
    // 場面形式の id は保存で初めて発行されるので、待たないと一覧に現れず同じ番号を採りうる（11 §2.1）。
    const sceneSaveOrder = save.mock.invocationCallOrder[
      save.mock.calls.findIndex((c) => JSON.parse(c[1] as string).format !== PROJECT_FORMAT.timeline)
    ];
    // 採番に使う一覧＝最後の呼び出し（その前に場面形式の保存が終わっている＝ディスクに現れている）。
    expect(sceneSaveOrder).toBeLessThan(list.mock.invocationCallOrder[list.mock.invocationCallOrder.length - 1]);
    const timelineSaves = save.mock.calls.filter((c) => JSON.parse(c[1] as string).format === PROJECT_FORMAT.timeline);
    expect(timelineSaves).toHaveLength(1);
    expect(timelineSaves[0][0]).toBe(id);
    // 開き直さずにそのまま編集できる（ディスクと同じ内容を持っている）。
    const st = useTimelineStore.getState();
    expect(st.doc?.projectId).toBe(id);
    expect(st.loadError).toBeNull();
    expect(st.doc?.clips).toEqual([]);
  });

  it('id を発行できなければ保存しない（番号の分からない動画をディスクに作らない）', async () => {
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    vi.spyOn(fsMod, 'listProjectSummaries').mockRejectedValue(new Error('一覧を読めない'));
    await expect(useTimelineStore.getState().createTimelineProject('新しい')).rejects.toThrow();
    expect(save.mock.calls.filter((c) => JSON.parse(c[1] as string).format === PROJECT_FORMAT.timeline)).toHaveLength(0);
    // 失敗しても、開いていた文書を巻き込まない（画面がいきなり空にならない）。
    expect(useTimelineStore.getState().doc).toBeNull();
  });

  it('選んだ向きで作る（縦向きが保存内容に入る・#664）', async () => {
    vi.spyOn(fsMod, 'listProjectSummaries').mockResolvedValue([]);
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().createTimelineProject('縦の動画', '9:16');
    const saved = save.mock.calls.map((c) => JSON.parse(c[1] as string)).find((d) => d.format === PROJECT_FORMAT.timeline);
    expect(saved.videoSettings.aspectRatio).toBe('9:16');
    expect(useTimelineStore.getState().doc?.videoSettings.aspectRatio).toBe('9:16');
  });

  it('前に開いていた文書の取り消し履歴・選択を持ち越さない（別の動画を書き戻さない）', async () => {
    // 先にタイムライン A を開いて履歴を積む。
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    useTimelineStore.getState().selectClip('clip_001');
    useTimelineStore.getState().trimSelectedClip('end', 3);
    expect(useTimelineStore.getState().history.past.length).toBeGreaterThan(0);
    // 新しく作ると、A の履歴・選択は残らない（残ると「取り消す」が A の中身を書き戻す）。
    vi.spyOn(fsMod, 'listProjectSummaries').mockResolvedValue([]);
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().createTimelineProject('新しい');
    const st = useTimelineStore.getState();
    expect(st.history.past).toEqual([]);
    expect(st.selectedClipIds).toEqual([]);
    expect(st.playheadSec).toBe(0);
    expect(st.saveStatus).toBe('saved');
  });

  it('書き出し中は作らない（開く・閉じると同じ扱い）', async () => {
    useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: 'rendering' } });
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await expect(useTimelineStore.getState().createTimelineProject('新しい')).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    // 断る理由をその場に出す（黙って何も起きないようにしない・§2-5）。
    expect(useTimelineStore.getState().exportRun.message).toBeTruthy();
    // 走行中の印を後続テストへ持ち越さない（この store は1つを共有していて、閉じる操作も断られる）。
    useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: 'idle' } });
  });

  it('作った内容が保存できる形であることは作る側で保証する（`create.test.ts` の検証と対）', async () => {
    vi.spyOn(fsMod, 'listProjectSummaries').mockResolvedValue([]);
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    const id = await useTimelineStore.getState().createTimelineProject('新しい');
    // 保存した JSON はそのまま読み戻せる（＝schema 検証を通ったものが書かれている）。
    expect(useTimelineStore.getState().doc?.projectId).toBe(id);
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

  it('別の動画へ移ったあとに前の動画の保存が終わっても、いまの動画の保存状態を書き換えない', async () => {
    // 書き込みを止めたまま別の動画を開く。前の動画の結果が**触ってもいない動画**の状態を動かすと、
    // 「保存できませんでした」が出たり保存済みが未保存へ化けたりする（ADR-0026①）。
    let fail!: (e: Error) => void;
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(() => new Promise<string>((_r, j) => { fail = j; }));
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    void useTimelineStore.getState().saveTimelineProject();
    expect(useTimelineStore.getState().saveStatus).toBe('saving');
    // 別の動画を開く（一覧からの経路＝閉じるを経由しない）。
    vi.mocked(fsMod.loadProjectDoc).mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260728_002' })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_002');
    expect(useTimelineStore.getState().saveStatus).toBe('saved');
    fail(new Error('disk full'));
    await Promise.resolve();
    await Promise.resolve();
    expect(useTimelineStore.getState().saveStatus).toBe('saved'); // 前の動画の失敗を持ち込まない
    expect(useTimelineStore.getState().doc?.projectId).toBe('proj_20260728_002');
  });

  it('別の動画を開いたら見張りを手放す（前の保存が返らなくても新しい動画は保存できる）', async () => {
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(() => new Promise<string>(() => {})); // 返らない
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    void useTimelineStore.getState().saveTimelineProject();
    vi.mocked(fsMod.loadProjectDoc).mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260728_002' })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_002');
    vi.mocked(fsMod.saveProjectDoc).mockResolvedValue('path');
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    await useTimelineStore.getState().saveTimelineProject();
    expect(useTimelineStore.getState().saveStatus).toBe('saved');
  });

  it('保存は同時に2本走らせない（古い内容が後着してディスクの編集を巻き戻さない）', async () => {
    // 書き込みを止めたまま2本目を頼む。走らせずに待たせ、**終わってからもう一度**書く（最後の内容が必ず載る）。
    let release!: () => void;
    let calls = 0;
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(() => {
      calls += 1;
      // 1本目だけ止める（2本目まで止めると、後ろに回した保存が終わらずテストが待ち続ける）。
      return calls === 1 ? new Promise<string>((r) => { release = () => r('path'); }) : Promise.resolve('path');
    });
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    const first = useTimelineStore.getState().saveTimelineProject();
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(1);
    useTimelineStore.getState().addTrack(TRACK_KIND.visual); // 保存中の編集
    void useTimelineStore.getState().saveTimelineProject();
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(1); // 並べて走らせない
    release();
    await first;
    // 走っていた保存に入らなかった編集は、後ろに回して書き切る（「保存しました」と言ったまま消さない）。
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(2);
    // 2本目に書かれたのは**いまの内容**（保存中に足した列が入っている）。
    const last = JSON.parse(vi.mocked(fsMod.saveProjectDoc).mock.calls[1][1]);
    expect(last.tracks.map((t: { id: string }) => t.id)).toEqual(useTimelineStore.getState().doc!.tracks.map((t) => t.id));
    const first1 = JSON.parse(vi.mocked(fsMod.saveProjectDoc).mock.calls[0][1]);
    expect(first1.tracks.length).toBeLessThan(last.tracks.length); // 1本目は古い内容＝上書きで巻き戻らないこと
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

describe('再生（#630）', () => {
  beforeEach(async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('path');
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
  });

  it('途中からはその位置で始め、止めても位置は残る（続きから再生できる）', () => {
    useTimelineStore.getState().setPlayhead(3);
    useTimelineStore.getState().play();
    expect(useTimelineStore.getState()).toMatchObject({ isPlaying: true, playheadSec: 3 });
    useTimelineStore.getState().pause();
    expect(useTimelineStore.getState()).toMatchObject({ isPlaying: false, playheadSec: 3 });
  });

  it('終端にいるときは先頭から始める（押しても動かない、を作らない）', () => {
    useTimelineStore.getState().setPlayhead(99); // 尺（5秒）へクランプされる
    useTimelineStore.getState().play();
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it('何も置いていない動画では再生を始めない', () => {
    const d = useTimelineStore.getState().doc!;
    useTimelineStore.setState({ doc: { ...d, clips: [] } });
    useTimelineStore.getState().play();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('編集したら再生を止める（動いている的を狙わせない）', () => {
    useTimelineStore.getState().play();
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('取り消しでも再生を止める', () => {
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    useTimelineStore.getState().play();
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('尺が縮んだら再生位置を収める（消した部品より後ろに取り残さない）', () => {
    useTimelineStore.getState().setPlayhead(5);
    useTimelineStore.getState().selectClip('clip_001');
    useTimelineStore.getState().removeSelectedClips();
    expect(useTimelineStore.getState().playheadSec).toBe(0); // 尺が 0 になる
  });

  it('開き直すと再生していない状態に戻る', async () => {
    useTimelineStore.getState().play();
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });
});

describe('音源の用意（#630 後半）', () => {
  it('開いたときに音源をまとめて用意する（鳴らす瞬間に読みに行かない）', async () => {
    const withAudio = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_101', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'generated', voicePath: 'voices/clip_101.wav' } },
        { id: 'clip_102', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 3, durationSec: 3, bundledBgmId: 'found-new-hope' },
      ],
    });
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(withAudio));
    vi.spyOn(voiceFsMod, 'readVoiceDataUrl').mockResolvedValue('data:audio/wav;base64,Vk9JQ0U=');
    vi.spyOn(bgmMod, 'readBundledBgmDataUrl').mockResolvedValue('data:audio/mp3;base64,QkdN');

    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    // キーは**音源の中身**（クリップ id ではない）＝複製で増えたクリップも読み直さずに鳴る。
    expect(useTimelineStore.getState().audioSrcByKey).toEqual({
      'voice:voices/clip_101.wav': 'data:audio/wav;base64,Vk9JQ0U=',
      'bgm:found-new-hope': 'data:audio/mp3;base64,QkdN',
    });
  });

  it('読めない音源はその部品だけ鳴らない（動画全体を開けなくしない）', async () => {
    const withAudio = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_101', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'generated', voicePath: 'voices/missing.wav' } }],
    });
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(withAudio));
    vi.spyOn(voiceFsMod, 'readVoiceDataUrl').mockResolvedValue(null);

    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    const s = useTimelineStore.getState();
    expect(s.doc).not.toBeNull(); // 開ける
    expect(s.audioSrcByKey).toEqual({}); // その部品は鳴らない
  });
});
