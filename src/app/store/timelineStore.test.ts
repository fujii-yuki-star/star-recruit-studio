// タイムライン編集プロジェクトの編集状態（ADR-0032・#629）。開く・再生ヘッド・選択の不変条件を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';
import { emitProjectDeleted } from './projectDeletion';
import { useProjectStore } from './projectStore';
import { resetAssetIdReservations } from './assetImport';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as voiceFsMod from '../../infrastructure/voiceFs';
import * as bgmMod from '../../infrastructure/bundledBgm';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { EXPORT_RUN_PHASE } from '../../domain/export/exportProgress';
import { MAX_INLINE_ASSET_BYTES } from '../../domain/constants';
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
    // ⚠️ **返らない書き込みは、テストの最後に必ず着地させる**（#763-4 レビュー）＝飛んでいる書き込みは
    // 動画ごとに覚えていて（`inFlightWrites`・消すときに待つため）、永久に返らないものを残すと
    // **後のテストがその動画を消せずに固まる**（実際に固まった）。「返らない」のは検査したい間だけでよい。
    let land = (): void => { /* 着地させる前は何もしない */ };
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(() => new Promise<string>((resolve) => { land = (): void => { resolve('path'); }; }));
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    const stuck = useTimelineStore.getState().saveTimelineProject();
    vi.mocked(fsMod.loadProjectDoc).mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260728_002' })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_002');
    vi.mocked(fsMod.saveProjectDoc).mockResolvedValue('path');
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    await useTimelineStore.getState().saveTimelineProject();
    expect(useTimelineStore.getState().saveStatus).toBe('saved');
    land();
    await stuck; // 飛ばしっぱなしにしない
  });

  it('前の動画の保存が終わっても、いま走っている保存の見張りを外さない（同じ動画で並走させない）', async () => {
    // 動画を切り替えたあと、**前の保存の後始末**が新しい保存の見張りを外してしまうと、次の依頼が
    // 並走して上書きが起き、このPRが潰したはずの巻き戻りが同じ動画の中で再発する（#700 レビュー）。
    const pending: Array<(v: string) => void> = [];
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(() => new Promise<string>((r) => { pending.push(r); }));
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    void useTimelineStore.getState().saveTimelineProject(); // 前の動画（A）の書き込みが始まる
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(1);

    vi.mocked(fsMod.loadProjectDoc).mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260728_002' })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_002'); // 見張りを手放す
    useTimelineStore.getState().addTrack(TRACK_KIND.audio);
    void useTimelineStore.getState().saveTimelineProject(); // 新しい動画（B）の書き込みが始まる
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(2);

    pending[0]('path'); // A の書き込みだけ完了＝A の後始末が走る
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    void useTimelineStore.getState().saveTimelineProject(); // B へさらに依頼
    expect(fsMod.saveProjectDoc).toHaveBeenCalledTimes(2); // B に合流する（3本目を始めない）
  });

  it('まとめて選ぶときは、実在しない id と重複を落とす（消えたものを選んだままにしない）', () => {
    // いま置いてある部品から取る（前のテストで顔ぶれが変わっていても、規則そのものを見られる）。
    const ids = useTimelineStore.getState().doc!.clips.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    useTimelineStore.getState().selectClips([ids[0], 'no_such_id', ids[0], ...ids.slice(1)]);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(ids);
  });

  it('選び直すと、前の操作の返事は落ちる（いまの部品の返事に見せない）', () => {
    useTimelineStore.setState({ editBlocked: 'TIMELINE_EDIT_OVERLAP', voiceError: '声を作れませんでした。' });
    useTimelineStore.getState().selectClip('clip_001');
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    expect(useTimelineStore.getState().voiceError).toBeNull();
    useTimelineStore.setState({ editBlocked: 'TIMELINE_EDIT_OVERLAP' });
    useTimelineStore.getState().clearSelection();
    expect(useTimelineStore.getState().editBlocked).toBeNull();
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

  // ⚠️ **止めた後に残ったフレームで位置を書き戻さない**（#833 レビュー ℹ️）＝`pause()` は `isPlaying` を
  // 倒すだけで、時計（rAF）は**画面側の後始末が走るまで**1フレーム回りうる。この入口は「再生の時計だけが
  // 使う」ものなので、ここで見れば1か所で閉じる。見ないと、掴んだ瞬間に止めて置いた位置を
  // **次の1フレームが再生位置で上書き**する（目盛りを掴むと止まる＝#833-2 で通る道になった）。
  it('止めた後に届いた再生フレームは、位置を書き戻さない', () => {
    useTimelineStore.getState().setPlayhead(3);
    useTimelineStore.getState().play();
    useTimelineStore.getState().pause();       // 掴んだ瞬間に止めた
    useTimelineStore.getState().setPlayhead(1); // 指が置いた位置
    useTimelineStore.getState()._advancePlayhead(4.5); // 止める前に積まれていた1フレームが遅れて届く
    expect(useTimelineStore.getState().playheadSec).toBe(1); // 置いた位置のまま
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

  it('書き出し中は再生を始めない（#752-6）', () => {
    // ⚠️ 成果物は壊れないが、走っている間だけ音が鳴り出す入口が開くのは、編集も声の作成も
    // 塞いであるのと揃わない（ADR-0026②）。画面の押せない見た目とここの関門は同じ理由を見る。
    const before = useTimelineStore.getState().exportRun;
    try {
      useTimelineStore.setState({ exportRun: { phase: 'rendering', percent: 0, message: null, cancelling: false } });
      useTimelineStore.getState().play();
      expect(useTimelineStore.getState().isPlaying).toBe(false);
    } finally {
      // ⚠️ **走っている印を残さない**＝この file の後のテストが「書き出し中」のまま走り、
      // 別の理由で落ちる（実際に2件落ちた）。
      useTimelineStore.setState({ exportRun: before });
    }
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

describe('素材の取り込み（#712）', () => {
  // 素材番号の予約は**アプリ起動中ずっと**残る（取り消し・開き直しをまたいで効かせるため）。
  // テストは1本ずつが別の起動なので、毎回捨てる。
  beforeEach(() => {
    resetAssetIdReservations();
    // 書き出し中は**開くことも閉じることもしない**のが仕様（走行中の締めを外さない）。
    // 走行を残したまま次へ行くと `open()` が黙って何もせず、前のテストの文書を見てしまう。
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false } });
  });

  const open = async (over: Partial<TimelineProject> = {}) => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({ assets: [], ...over })));
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('saved');
  };
  // ブラウザ経路（`addAsset`）は File を読むので、パス経路（`addAssetByPath`）で手順を固定する。
  const importPath = (p = 'C:/pics/会社の外観.png') => useTimelineStore.getState().addAssetByPath(p);

  it('取り込むと一覧に増え、表示先も付く', async () => {
    await open();
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.png');
    await importPath();
    const s = useTimelineStore.getState();
    expect(copy).toHaveBeenCalledWith('proj_20260728_001', 'asset_001.png', 'C:/pics/会社の外観.png');
    expect(s.doc!.assets).toEqual([
      { assetId: 'asset_001', assetType: 'image', displayName: '会社の外観', filePath: 'assets/asset_001.png' },
    ]);
    expect(s.assetSrcById.asset_001).toBe('asset://a.png');
    expect(s.importError).toBeNull();
    expect(s.isImporting).toBe(false);
  });

  it('取り消せる（この形式の履歴は文書まるごと・#712 決定）', async () => {
    await open();
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.png');
    await importPath();
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(1);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(0);
    useTimelineStore.getState().redo();
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(1);
  });

  it('取り込めなかったら一覧に足さない（幽霊を作らない）＋次の行動を出す', async () => {
    await open();
    vi.spyOn(assetFsMod, 'importAssetByPath').mockRejectedValue(new Error('書き込めませんでした。空き容量をご確認ください。'));
    await importPath();
    const s = useTimelineStore.getState();
    expect(s.doc!.assets).toEqual([]);
    expect(s.importError).toContain('空き容量');
    expect(s.isImporting).toBe(false);
    expect(s.history.past).toHaveLength(0); // 失敗だけで取り消しが増えない
  });

  it('取り込んでいる間の編集を巻き戻さない', async () => {
    await open();
    let release: (v: string) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((r) => { release = r; }));
    const running = importPath();
    // 取り込みの最中に別の編集が入る（自動保存の非同期と同じ型のハザード）。
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    release('assets/asset_001.png');
    await running;
    const s = useTimelineStore.getState();
    expect(s.doc!.assets).toHaveLength(1);   // 素材は足される
    expect(s.doc!.clips).toHaveLength(2);    // 途中の編集も残る
  });

  it('取り込んでいる間に文書が変わったら、そちらへ足さない', async () => {
    await open();
    let release: (v: string) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((r) => { release = r; }));
    const running = importPath();
    // ⚠️ **開く・作るの入口は #724 で塞いだ**（取り込み中は文書を入れ替えない）ので、ここで見るのは
    // **着地の二重防御**＝残っている経路（閉じる）で文書が消えても、あとから何も書かない。
    useTimelineStore.getState().closeTimelineProject();
    release('assets/asset_001.png');
    await running;
    const s = useTimelineStore.getState();
    expect(s.doc).toBeNull();
    expect(s.assetSrcById.asset_001).toBeUndefined(); // 文書に無い素材の絵を残さない
  });

  it('別の動画へ移ったあとの失敗は、そちらへ出さない（触っていない動画に案内が出る）', async () => {
    await open();
    let fail: (e: unknown) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((_r, j) => { fail = j; }));
    const running = importPath();
    // 入口は塞いだので、ここも**着地の二重防御**を見る（上と同じ理由）。
    useTimelineStore.getState().closeTimelineProject();
    fail(new Error('書き込めませんでした。'));
    await running;
    const st = useTimelineStore.getState();
    expect(st.doc).toBeNull();
    expect(st.importError).toBeNull();  // 触っていない動画に案内を出さない
    expect(st.isImporting).toBe(false); // 閉じたときに畳まれている（取り込みの札が残らない）
  });

  it('二重には取り込まない（同じ番号の素材が2つできる）', async () => {
    await open();
    let release: (v: string) => void = () => {};
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((r) => { release = r; }));
    const first = importPath();
    await importPath(); // 走っている間の2回目は素通りする
    expect(copy).toHaveBeenCalledTimes(1);
    release('assets/asset_001.png');
    await first;
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(1);
  });

  it('動画は長さ・代表フレームまで揃える', async () => {
    await open();
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.mp4');
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 12.5, hasAudio: true, width: 1920, height: 1080 });
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue('assets/thumb_001.png');
    await importPath('C:/pics/紹介ムービー.mp4');
    const a = useTimelineStore.getState().doc!.assets[0];
    expect(a.assetType).toBe('video');
    expect(a.metadata?.durationSec).toBe(12.5);
    expect(a.thumbnailPath).toBe('assets/thumb_001.png');
    expect(useTimelineStore.getState().assetSrcById.asset_001).toBe('asset://a.png'); // 代表フレームを見せる
  });

  it('大きすぎるファイルは、この画面で実行できる次の行動を出す', async () => {
    await open();
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath');
    // 50MB 超（`MAX_INLINE_ASSET_BYTES`）。File は size だけ見るのでダミーで足りる。
    await useTimelineStore.getState().addAsset({ name: '大きい.mp4', size: MAX_INLINE_ASSET_BYTES + 1 } as File);
    const msg = useTimelineStore.getState().importError ?? '';
    expect(msg).toContain('大きすぎます');
    // 場面形式の案内（「『写真・動画を選ぶ』から取り込んでください」）はこの画面に無いボタンを指す
    // ＝**実行できない案内**にしない（ADR-0034 決定5）。
    expect(msg).not.toContain('写真・動画を選ぶ');
    expect(copy).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().doc!.assets).toEqual([]);
  });

  it('取り消したあとの取り込みは、番号を使い回さない（前の写真を上書きしない）', async () => {
    await open();
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockImplementation(async (_p, f) => `assets/${f}`);
    await importPath('C:/pics/1枚目.png');
    useTimelineStore.getState().undo();                 // 一覧からは消えるが、ファイルは残っている
    await importPath('C:/pics/2枚目.png');
    // 空き番号を埋めると `asset_001.png` を上書きし、やり直しで戻った1枚目が2枚目の写真になる。
    expect(copy.mock.calls.map((c) => c[1])).toEqual(['asset_001.png', 'asset_002.png']);
    expect(useTimelineStore.getState().doc!.assets[0].assetId).toBe('asset_002');
  });

  it('文字を打っているまとめに、あとから着地した取り込みを混ぜない', async () => {
    await open();
    let release: (v: string) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((r) => { release = r; }));
    const running = importPath();
    // 取り込みを待っている間に、利用者が文字欄を触ってまとめが開く。
    useTimelineStore.getState().beginHistoryGroup();
    release('assets/asset_001.png');
    await running;
    const before = useTimelineStore.getState().history.past.length;
    // まとめの「最初の1回」を取り込みが食べていないので、この編集はちゃんと積まれる。
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    useTimelineStore.getState().endHistoryGroup();
  });

  // ⚠️ **まとめが開いたまま取り消しても、次の編集は積まれる**（#817-1）＝畳まないと、戻した後の編集が
  // 「まとめの続き」とみなされて**履歴に積まれず**、やり直しの分（`future`）も捨てられない。
  // 実際に踏むのは矢印での微調整（600ms のまとめが開いている間に `Ctrl+Z` を押すと入る）。
  it('まとめが開いたまま取り消しても、その後の編集は取り消せる', async () => {
    await open();
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    const base = useTimelineStore.getState().doc!.clips.length;
    useTimelineStore.getState().beginHistoryGroup(); // 矢印のまとめが開いている
    useTimelineStore.getState().undo();             // 閉じる前に取り消す
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(base - 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 畳まれている
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text }); // 戻した後の編集
    expect(useTimelineStore.getState().history.future).toHaveLength(0); // やり直しの分は捨てる
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(base - 1); // ちゃんと戻る
  });

  it('待っている間に書き出しが始まったら、取り込めなかったと伝える（黙って捨てない）', async () => {
    await open();
    let release: (v: string) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise<string>((r) => { release = r; }));
    const running = importPath();
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.rendering, percent: 50, message: null, cancelling: false } });
    release('assets/asset_001.png');
    await running;
    const st = useTimelineStore.getState();
    expect(st.doc!.assets).toEqual([]);
    expect(st.importError).toContain('書き出しが終わってから');
    expect(st.assetSrcById.asset_001).toBeUndefined(); // 文書に無い素材の絵を残さない
  });

  it('取り込み先が分からないときも、保存できる置き場所を持つ', async () => {
    await open();
    // ブラウザでは実体を保存できず null が返る。`filePath` が欠けると保存そのものが通らない。
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue(null);
    await importPath();
    expect(useTimelineStore.getState().doc!.assets[0].filePath).toBe('assets/asset_001.png');
  });

  it('書き出し中は取り込まない（始めた時点の文書を焼くので入らない）', async () => {
    await open();
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.rendering, percent: 50, message: null, cancelling: false } });
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.png');
    await importPath();
    expect(copy).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_EXPORTING');
  });

  it('ファイルから取り込むとき、動画と写真で経路を分ける', async () => {
    await open();
    const bytes = vi.spyOn(assetFsMod, 'importAssetBytes').mockResolvedValue('assets/asset_001.mp4');
    const asFile = vi.spyOn(assetFsMod, 'importAssetFile').mockResolvedValue('assets/asset_002.png');
    vi.spyOn(assetFsMod, 'fileToDataUrl').mockResolvedValue('data:image/png;base64,AA');
    // 動画は生バイト（大容量でもメモリを食わない）。
    await useTimelineStore.getState().addAsset({ name: '紹介.mp4', size: 10, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as File);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(asFile).not.toHaveBeenCalled();
    // 写真は data URL 経由。
    await useTimelineStore.getState().addAsset({ name: '外観.png', size: 10 } as File);
    expect(asFile).toHaveBeenCalledTimes(1);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().doc!.assets.map((a) => a.assetType)).toEqual(['video', 'image']);
  });
});

// ボタンで置く経路の置き先（#722）。**列をまたいでは探さない**＝奥の列が空いていてもそちらへは置かない。
// 置いた部品が手前の全画面の部品の裏に入ると、`06 §12.1` の「押して置いたときも必ず仕上がり確認に
// 現れる」が守れない（再生位置を移すだけでは足りない）。代わりに時刻は後ろへずれる（利用者判断・案A）。
describe('置く先の探し方（#722）', () => {
  // 列は**配列の末尾が手前**（`11 §7.6` 重ね順）＝track_002 が手前。
  const twoLanes = (over: Partial<TimelineProject> = {}) =>
    doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual }, // 奥
        { id: 'track_002', kind: TRACK_KIND.visual }, // 手前
      ],
      clips: [
        // 手前の列だけ 0〜5 秒が塞がっている。奥の列は空。
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
      ],
      ...over,
    });

  it('手前の列が塞がっていても、奥の列へは逃がさない（裏に隠れる部品を作らない）', () => {
    useTimelineStore.setState({ doc: twoLanes(), playheadSec: 0, selectedClipIds: [] });
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.id !== 'clip_001')!;
    expect(placed.trackId).toBe('track_002'); // 手前の列
    expect(placed.startSec).toBe(5); // まるごと収まる最初の空き（再生位置 0 は塞がっている）
  });

  it('置いた所へ再生位置も移る（押したのに何も現れない、を作らない）', () => {
    useTimelineStore.setState({ doc: twoLanes(), playheadSec: 0, selectedClipIds: [] });
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    expect(useTimelineStore.getState().playheadSec).toBe(5);
  });

  it('手前の列が固定・非表示なら、その次に手前の列へ置く', () => {
    useTimelineStore.setState({
      doc: twoLanes({ tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.visual, locked: true },
      ] }),
      playheadSec: 0, selectedClipIds: [],
    });
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.id !== 'clip_001')!;
    expect(placed.trackId).toBe('track_001');
    expect(placed.startSec).toBe(0); // その列は空いているので再生位置のまま
  });

  it('置ける列が1本も無いときは理由を出す（押しても何も起きない、を作らない）', () => {
    useTimelineStore.setState({
      doc: doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }], clips: [] }),
      playheadSec: 0, selectedClipIds: [], editBlocked: null,
    });
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_NOT_FOUND');
  });

  it('落とした場所が指されているときは探さない（寄せない・ADR-0034 決定10）', () => {
    useTimelineStore.setState({ doc: twoLanes(), playheadSec: 0, selectedClipIds: [], editBlocked: null });
    // 手前の列の 0 秒＝塞がっている所へ落とす。空きへ寄せずに断る。
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.text, at: { trackId: 'track_002', startSec: 0 } });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_OVERLAP');
  });
});

// 取り込みの最中に文書を入れ替えない（#724）。着地したときには別の動画なので、取り込んだ素材は
// `projectId` 違いで黙って捨てられる（ファイルだけディスクに残る）。書き出し中と同じ形で先に断る。
describe('取り込み中は文書を入れ替えない（#724）', () => {
  beforeEach(() => {
    resetAssetIdReservations();
    useTimelineStore.setState({
      exportRun: { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false },
      isImporting: false,
    });
  });

  it('取り込みの最中は別の動画を開かない（理由を出す）', async () => {
    const load = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    useTimelineStore.setState({ isImporting: true });
    await useTimelineStore.getState().openTimelineProject('proj_20260728_002');
    expect(load).not.toHaveBeenCalled(); // 読みに行かない＝走っている取り込みの着地先が変わらない
    expect(useTimelineStore.getState().exportRun.message).toContain('取り込んでいます');
  });

  it('取り込みの最中は新しい動画も作らない（理由を出す）', async () => {
    useTimelineStore.setState({ isImporting: true });
    await expect(useTimelineStore.getState().createTimelineProject('新規', '16:9')).rejects.toThrow();
    expect(useTimelineStore.getState().exportRun.message).toContain('取り込んでいます');
  });

  it('閉じれば取り込みの札は畳まれる（開けなくなったまま固まらない）', () => {
    useTimelineStore.setState({ isImporting: true });
    useTimelineStore.getState().closeTimelineProject();
    // ⚠️ 取り込みの `finally` は「始めた動画のまま」のときしか札を外さないので、閉じる側が
    // 畳まないと `isImporting` が残り、**このガードのせいで二度と開けなくなる**。
    expect(useTimelineStore.getState().isImporting).toBe(false);
  });

  it('取り込みが終わっていれば今までどおり開ける', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    useTimelineStore.setState({ isImporting: false });
    await useTimelineStore.getState().openTimelineProject('proj_20260728_001');
    expect(useTimelineStore.getState().doc?.projectId).toBe('proj_20260728_001');
  });
});

// 見た目パターンを置く経路（#724）。**成功する経路のテストが store・画面のどちらにも無かった**
//（あったのは「書き出し中は選べない」という断りだけ）＝置けなくなっても気づけない状態だった。
describe('見た目パターンを置く（#724）', () => {
  const tmpl = {
    schemaVersion: '1.0', templateId: 'tmpl_001', name: '見本', category: 'photo_intro',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 }],
    defaults: { durationSec: 7 },
  } as unknown as Parameters<ReturnType<typeof useTimelineStore.getState>['addTemplateClip']>[0]['template'];

  beforeEach(() => {
    useTimelineStore.setState({
      doc: doc({ clips: [], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }] }),
      selectedClipIds: [], playheadSec: 0, editBlocked: null,
      exportRun: { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false },
    });
  });

  it('置ける（長さは見た目パターンが決める＝場面形式と同じ関数）', () => {
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_001', startSec: 2 });
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', trackId: 'track_001', startSec: 2, durationSec: 7 });
  });

  it('置いたらそのまま選ばれる（続けて中身を直せる）', () => {
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_001', startSec: 0 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([useTimelineStore.getState().doc!.clips[0].id]);
  });

  it('取り消しで戻る（置いたことが履歴に積まれている）', () => {
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_001', startSec: 0 });
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
  });

  it('塞がっているところへは置かず、理由を出す（寄せない）', () => {
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_001', startSec: 0 });
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_001', startSec: 3 });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_OVERLAP');
  });

  it('音の列へは置かない（置いても映らない部品を作らない）', () => {
    useTimelineStore.getState().addTemplateClip({ template: tmpl, trackId: 'track_002', startSec: 0 });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_TRACK_KIND');
  });
});

// 分ける（#686 段階4）。断られたのに選択だけ差し替わる、を作らない（#750 レビュー）。
describe('分ける（#750 レビュー）', () => {
  const one = () => doc({
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
  });

  it('書き出し中は**選択も差し替えない**（存在しない部品を選んだ状態にしない）', () => {
    useTimelineStore.setState({
      doc: one(), selectedClipIds: ['clip_001'], playheadSec: 4,
      exportRun: { phase: 'rendering', percent: 0, message: null, cancelling: false },
    });
    useTimelineStore.getState().splitSelectedClip(4);
    const st = useTimelineStore.getState();
    expect(st.doc!.clips).toHaveLength(1); // 分かれない
    // ⚠️ 選択を `commit` の外で差し替えると、断られたときに**存在しない id** が残り、
    // 以後の操作が「見つかりません」（嘘の理由）で空振りする。
    expect(st.selectedClipIds).toEqual(['clip_001']);
    useTimelineStore.setState({ exportRun: { ...st.exportRun, phase: 'idle' } });
  });

  it('通ったときは後半を選ぶ（続きを触れる状態にして返す）', () => {
    useTimelineStore.setState({ doc: one(), selectedClipIds: ['clip_001'], playheadSec: 4 });
    useTimelineStore.getState().splitSelectedClip(4);
    const st = useTimelineStore.getState();
    expect(st.doc!.clips).toHaveLength(2);
    expect(st.selectedClipIds).toEqual([st.doc!.clips[1].id]);
  });
});

// 消した動画を持ったままにしない（#755）。持っていると、非同期の着地が保存して一覧へ復活する。
describe('消した動画を手放す（#755）', () => {
  const one = () => doc({
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
  });

  it('その動画が消えたら文書を手放す＝以後どこからも書かない', async () => {
    useTimelineStore.setState({ doc: one(), selectedClipIds: ['clip_001'] });
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    useTimelineStore.getState().discardDeletedProject(one().projectId);
    expect(useTimelineStore.getState().doc).toBeNull();
    await useTimelineStore.getState().saveTimelineProject();
    // ⚠️ 書くと `save_project` がフォルダごと作り直す＝**消したはずの動画が一覧へ戻る**
    //（素材と声のファイルは消えているので、開いても壊れている）。
    expect(save).not.toHaveBeenCalled();
  });

  // #763-4 レビュー🔴：**手放す前に掴む**。`releaseSaveGuard()` が見張り（`currentSave`）を捨てるので、
  // 手放した後に読むと必ず空になり、**消す側の待ちが丸ごと空振り**していた（＝この修正の意味が消える）。
  it('**飛行中の書き込みの約束を返す**（消す側が着地を待てる・#763-4）', async () => {
    let land = (): void => { /* 着地させる前は何もしない */ };
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockImplementation(
      () => new Promise<string>((resolve) => { land = (): void => { resolve('x/project.json'); }; }),
    );
    // ⚠️ **走らせた仕事は `finally` でも待つ**＝途中で落ちたとき、見張りを外した後も裏で走り続け、
    // 次のテストの数え上げに紛れ込む。
    let saving: Promise<void> | undefined;
    try {
      useTimelineStore.setState({ doc: one(), selectedClipIds: [] });
      saving = useTimelineStore.getState().saveTimelineProject(); // 書き込みを飛ばしたまま
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      const { pending } = useTimelineStore.getState().discardDeletedProject(one().projectId);
      expect(pending).toBeInstanceOf(Promise); // ⚠️ ここが undefined だと待ちが空振りする

      let landed = false;
      void pending!.then(() => { landed = true; });
      await new Promise((r) => setTimeout(r, 0));
      expect(landed).toBe(false); // まだ着地していない＝この間に消してはいけない

      land();
      await saving;
      await pending;
      expect(landed).toBe(true);
    } finally {
      land();
      await Promise.allSettled([saving]);
      save.mockRestore();
    }
  });

  // #763-4 レビュー🟡：**別の動画へ移った後も走っている書き込み**も待てないと、同じ復活が起きる。
  it('開いていない動画でも、その書き込みが飛んでいれば約束を返す', async () => {
    let land = (): void => { /* 同上 */ };
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockImplementation(
      () => new Promise<string>((resolve) => { land = (): void => { resolve('x/project.json'); }; }),
    );
    let saving: Promise<void> | undefined;
    try {
      const a = one();
      useTimelineStore.setState({ doc: a, selectedClipIds: [] });
      saving = useTimelineStore.getState().saveTimelineProject(); // A への書き込みが飛ぶ
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      // 別の動画へ移る＝**実際に見張りを手放す道を通す**（`closeTimelineProject` が `releaseSaveGuard`）。
      // ⚠️ `setState` で文書だけ差し替えると手放しの道を通らず、この検査が空振りする。
      useTimelineStore.getState().closeTimelineProject();

      const { pending } = useTimelineStore.getState().discardDeletedProject(a.projectId);
      expect(pending).toBeInstanceOf(Promise); // 開いていなくても待たせる
      land();
      await saving;
      await pending;
    } finally {
      land();
      await Promise.allSettled([saving]);
      save.mockRestore();
    }
  });

  // #763-4 レビュー🔴：**消せなかったら、こちらも開き直す**。`deleteProject` は両形式の共通の入口だが、
  // 開き直しは場面形式の判定（`meta.projectId`）でしか動いておらず、**タイムライン形式を消し損ねた
  // ときだけ空のまま**残っていた（一覧には動画が残るのに画面だけ空＝場面形式で直したのと同じ症状）。
  it('**消せなかったら開き直す**（一覧に残っているのに画面だけ空、を作らない・#763-4）', async () => {
    const target = 'proj_20260728_777';
    const mine = doc({ projectId: target });
    useTimelineStore.setState({ doc: mine });
    const del = vi.spyOn(fsMod, 'deleteProjectDoc').mockRejectedValue(new Error('消せなかった'));
    const load = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(mine));
    try {
      await expect(useProjectStore.getState().deleteProject(target)).rejects.toThrow();
      // 消す最中は手放している（着地が保存してフォルダを作り直さない）が、失敗したので戻す。
      await vi.waitFor(() => expect(useTimelineStore.getState().doc?.projectId).toBe(target));
      expect(load).toHaveBeenCalledWith(target);
    } finally {
      del.mockRestore(); load.mockRestore();
    }
  });

  // #763-4 再レビュー🟡：**待っている間に別の動画を開かれていたら戻さない**。この待ちは意図的に
  // 長くしたので、その間に一覧から別の動画を開ける＝無条件に開き直すと**いま開いている方を黙って
  // 上書き**する（未保存の編集が消える・§2-5）。
  it('待っている間に別の動画を開かれていたら、開き直さない（開いている方を上書きしない）', async () => {
    const target = 'proj_20260728_778';
    const other = doc({ projectId: 'proj_20260728_779' });
    useTimelineStore.setState({ doc: doc({ projectId: target }) });
    const del = vi.spyOn(fsMod, 'deleteProjectDoc').mockImplementation(async () => {
      // 消している最中に別の動画を開く（手放した後の窓）。
      useTimelineStore.setState({ doc: other });
      throw new Error('消せなかった');
    });
    const load = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({ projectId: target })));
    try {
      await expect(useProjectStore.getState().deleteProject(target)).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 0));
      expect(useTimelineStore.getState().doc?.projectId).toBe('proj_20260728_779'); // 開いた方が残る
      expect(load).not.toHaveBeenCalledWith(target); // 消した方を開き直さない
    } finally {
      del.mockRestore(); load.mockRestore();
    }
  });

  // #763-4 レビュー🟡：飛んでいる書き込みは**動画ごと**に覚える。1件だけ覚える形だと、
  // A が飛んでいる最中に B の保存が始まった時点で A を見失い、A を消すときに待てない
  //（この形式は文書を切り替えると新しい書き込みをすぐ許すので、2つが同時に飛びうる）。
  it('**2つの動画の書き込みが同時に飛んでいても**、消す相手のものを待つ', async () => {
    const landers: Array<() => void> = [];
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockImplementation(
      () => new Promise<string>((resolve) => { landers.push(() => { resolve('path'); }); }),
    );
    const a = doc({ projectId: 'proj_20260728_801' });
    let saveA: Promise<void> | undefined;
    let saveB: Promise<void> | undefined;
    try {
      useTimelineStore.setState({ doc: a });
      saveA = useTimelineStore.getState().saveTimelineProject(); // A の書き込みが飛ぶ
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      // B へ移って B の保存も始める＝**1件だけ覚える形だとここで A を見失う**。
      const load = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260728_802' })));
      await useTimelineStore.getState().openTimelineProject('proj_20260728_802');
      load.mockRestore();
      useTimelineStore.getState().addTrack(TRACK_KIND.audio);
      saveB = useTimelineStore.getState().saveTimelineProject();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

      const { pending } = useTimelineStore.getState().discardDeletedProject('proj_20260728_801');
      expect(pending).toBeInstanceOf(Promise); // A の書き込みを待たせる
      landers.forEach((l) => l());
      await pending;
    } finally {
      landers.forEach((l) => l());
      await Promise.allSettled([saveA, saveB]);
      save.mockRestore();
    }
  });

  it('別の動画を消しただけなら触らない', () => {
    const d = one();
    useTimelineStore.setState({ doc: d, selectedClipIds: ['clip_001'] });
    useTimelineStore.getState().discardDeletedProject('proj_99999999_999');
    expect(useTimelineStore.getState().doc).toBe(d);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(['clip_001']);
  });

  it('**走行中の印は残す**（書き出し中の締めが外れて二重に始められる、を作らない）', () => {
    const running = { phase: 'rendering' as const, percent: 40, message: null, cancelling: false };
    useTimelineStore.setState({ doc: one(), exportRun: running });
    useTimelineStore.getState().discardDeletedProject(one().projectId);
    expect(useTimelineStore.getState().doc).toBeNull();
    expect(useTimelineStore.getState().exportRun).toEqual(running);
    useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false } });
  });

  it('削除の知らせが store まで届く（画面を離れていても効く）', () => {
    useTimelineStore.setState({ doc: one() });
    // ⚠️ 画面ではなく **store で受ける**＝本番の導線は `closeTimelineProject` を通らない。
    emitProjectDeleted(one().projectId);
    expect(useTimelineStore.getState().doc).toBeNull();
  });

  it('**本番の削除**から届く（知らせを出す側の配線も見る）', async () => {
    // ⚠️ 受け手だけを直に叩くテストでは、**出す側を外しても気づけない**（実際に変異が生き残った）。
    // ⚠️ **消している最中**にはもう手放していること＝そこで着地が保存すると、
    // フォルダごと作り直されて**素材と声だけ消えた動画が一覧へ戻る**。
    let heldWhileDeleting: unknown = 'not-called';
    vi.spyOn(fsMod, 'deleteProjectDoc').mockImplementation(async () => {
      heldWhileDeleting = useTimelineStore.getState().doc;
    });
    useTimelineStore.setState({ doc: one() });
    await useProjectStore.getState().deleteProject(one().projectId);
    expect(heldWhileDeleting).toBeNull();
    expect(useTimelineStore.getState().doc).toBeNull();
  });
});
