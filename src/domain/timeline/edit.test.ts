// タイムライン形式の編集操作（ADR-0032・#629）。置けないときに黙って別の結果にしないことを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import {
  addTrack, clipCountOnTrack, duplicateClip, EDIT_BLOCKED, isFreeSpan,
  addTemplateClip, moveClip, moveTrackOrder, removeClips, removeTrack, setClipAssetRef, setClipText, setTrackFlag, trimClip,
} from './edit';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { TIMELINE_MIN_CLIP_SEC } from '../constants';

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return { id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips: [clip('clip_001')],
    ...over,
  };
}

const expectBlocked = (r: ReturnType<typeof moveClip>, reason: string): void => {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe(reason);
};

describe('isFreeSpan（同じ列で時間が重ならない＝11 §8 V24）', () => {
  const clips = [clip('clip_001', { startSec: 2, durationSec: 3 })]; // [2, 5)
  it('端が接するだけなら置ける', () => {
    expect(isFreeSpan(clips, 'track_001', 5, 1)).toBe(true);
    expect(isFreeSpan(clips, 'track_001', 1, 1)).toBe(true);
  });
  it('少しでも重なると置けない', () => {
    expect(isFreeSpan(clips, 'track_001', 4.9, 1)).toBe(false);
    expect(isFreeSpan(clips, 'track_001', 1, 1.5)).toBe(false);
  });
  it('別の列なら重なってよい（重ねたいなら列を足す）', () => {
    expect(isFreeSpan(clips, 'track_002', 2, 3)).toBe(true);
  });
  it('自分自身とは重ならない（動かす当人を数えない）', () => {
    expect(isFreeSpan(clips, 'track_001', 3, 3, 'clip_001')).toBe(true);
  });
});

describe('moveClip', () => {
  it('同じ列で時間をずらす', () => {
    const r = moveClip(doc(), 'clip_001', { startSec: 10 });
    expect(r.ok && r.doc.clips[0].startSec).toBe(10);
  });

  it('何も変わらない移動は文書をそのまま返す（履歴を汚さない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0 })] });
    expect(moveClip(d, 'clip_001', { startSec: -5 }).ok && moveClip(d, 'clip_001', { startSec: -5 })).toMatchObject({ doc: d });
  });

  it('別の列へ移す', () => {
    const r = moveClip(doc(), 'clip_001', { trackId: 'track_002' });
    expect(r.ok && r.doc.clips[0].trackId).toBe('track_002');
  });

  it('重なる位置へは動かさない（勝手に寄せたり上書きしたりしない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 6, durationSec: 5 })] });
    expectBlocked(moveClip(d, 'clip_001', { startSec: 4 }), EDIT_BLOCKED.overlap);
  });

  it('時間の外（0 より前）へは出さない', () => {
    const r = moveClip(doc(), 'clip_001', { startSec: -5 });
    expect(r.ok && r.doc.clips[0].startSec).toBe(0);
  });

  it('音の部品は映像の列に置けない（置いても鳴らない）', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', voice: { text: 'あ', status: 'none' } })] });
    expectBlocked(moveClip(d, 'clip_001', { trackId: 'track_001' }), EDIT_BLOCKED.trackKind);
  });

  it('固定した列のクリップは動かせない（移動先が固定でも同じ）', () => {
    const locked = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expectBlocked(moveClip(locked, 'clip_001', { startSec: 9 }), EDIT_BLOCKED.locked);
    const lockedTarget = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, locked: true }] });
    expectBlocked(moveClip(lockedTarget, 'clip_001', { trackId: 'track_002' }), EDIT_BLOCKED.locked);
  });

  it('見つからないクリップは理由を返す（黙って何もしない、にしない）', () => {
    expectBlocked(moveClip(doc(), 'clip_999', { startSec: 1 }), EDIT_BLOCKED.notFound);
  });
});

describe('trimClip', () => {
  it('先頭を動かすと、終わりは動かない', () => {
    const r = trimClip(doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] }), 'clip_001', 'start', 2);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it('終わりを動かすと、先頭は動かない', () => {
    const r = trimClip(doc({ clips: [clip('clip_001', { startSec: 1, durationSec: 5 })] }), 'clip_001', 'end', 4);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ startSec: 1, durationSec: 3 });
  });

  it('短くしすぎは最小の長さで止める（**下限を割らない**＝丸め誤差でも下回らせない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] });
    const fromStart = trimClip(d, 'clip_001', 'start', 99);
    expect(fromStart.ok && fromStart.doc.clips[0].durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
    const fromEnd = trimClip(d, 'clip_001', 'end', -99);
    expect(fromEnd.ok && fromEnd.doc.clips[0].durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
  });

  it('端数の秒でも下限を割らない（長さを引き算してから丸めると割る）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 3 })] }); // [2, 5)
    const r = trimClip(d, 'clip_001', 'start', 4.95); // 残り 0.05 秒＝下限より短い
    expect(r.ok && r.doc.clips[0].durationSec).toBeGreaterThanOrEqual(TIMELINE_MIN_CLIP_SEC);
    const r2 = trimClip(doc({ clips: [clip('clip_001', { startSec: 0.3, durationSec: 3 })] }), 'clip_001', 'end', 0.4);
    expect(r2.ok && r2.doc.clips[0].durationSec).toBeGreaterThanOrEqual(TIMELINE_MIN_CLIP_SEC);
  });

  it('何も変わらないトリムは文書をそのまま返す（履歴を汚さない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 3 })] });
    const r = trimClip(d, 'clip_001', 'end', 5);
    expect(r.ok && r.doc).toBe(d);
  });

  it('伸ばして隣と重なるなら止める', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 5, durationSec: 5 })] });
    expectBlocked(trimClip(d, 'clip_001', 'end', 7), EDIT_BLOCKED.overlap);
  });
});

describe('removeClips', () => {
  it('消したクリップへの参照（グループ・動き）も片づける', () => {
    const d = doc({
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0 }] },
        { id: 'anim_002', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }] },
      ],
    });
    const next = removeClips(d, ['clip_001']);
    expect(next.clips.map((c) => c.id)).toEqual(['clip_002']);
    expect(next.groups![0].members).toEqual(['clip_002']); // メンバーから落ちる
    expect(next.animations!.map((a) => a.id)).toEqual(['anim_002']); // 消えた対象の動きは残さない
  });

  it('中身が無くなったグループは畳む（中身の無い入れ物を残さない）', () => {
    const d = doc({
      clips: [clip('clip_001')],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }] }],
    });
    const next = removeClips(d, ['clip_001']);
    expect(next.groups).toBeUndefined();
    expect(next.animations).toBeUndefined(); // 対象が消えた動きも残らない
  });
});

describe('トラック（列）', () => {
  it('足した列はいちばん手前（配列の末尾）に入る', () => {
    const next = addTrack(doc(), TRACK_KIND.audio);
    expect(next.tracks[next.tracks.length - 1]).toMatchObject({ id: 'track_004', kind: TRACK_KIND.audio });
  });

  it('消すと、その列のクリップも一緒に消える（数は事前に分かる）', () => {
    const d = doc({ clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })] });
    expect(clipCountOnTrack(d, 'track_001')).toBe(1);
    const r = removeTrack(d, 'track_001');
    expect(r.ok && r.doc.tracks.map((t) => t.id)).toEqual(['track_002', 'track_003']);
    expect(r.ok && r.doc.clips.map((c) => c.id)).toEqual(['clip_002']);
  });

  it('固定した列は消せない（動かせないのに消せる、を作らない）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expectBlocked(removeTrack(d, 'track_001'), EDIT_BLOCKED.locked);
  });

  it('重ね順を1つ動かす（端では何も起きない）', () => {
    const d = doc();
    expect(moveTrackOrder(d, 'track_001', 'front').tracks.map((t) => t.id)).toEqual(['track_002', 'track_001', 'track_003']);
    expect(moveTrackOrder(d, 'track_001', 'back').tracks.map((t) => t.id)).toEqual(['track_001', 'track_002', 'track_003']);
  });

  it('表示/固定を切り替える', () => {
    expect(setTrackFlag(doc(), 'track_001', 'hidden', true).tracks[0].hidden).toBe(true);
    expect(setTrackFlag(doc(), 'track_001', 'locked', true).tracks[0].locked).toBe(true);
  });
});

describe('duplicateClip', () => {
  it('同じ列の直後へ複製する（新しい id が付く）', () => {
    const r = duplicateClip(doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 })] }), 'clip_001');
    expect(r.ok && r.doc.clips[1]).toMatchObject({ id: 'clip_002', startSec: 5, durationSec: 5, trackId: 'track_001' });
  });

  it('読み上げは作成済みの音声を引き継がない（別の部品の音声を指さない）', () => {
    const d = doc({
      tracks: [{ id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', voice: { text: 'あ', status: 'generated', voicePath: 'voices/a.wav' } })],
    });
    const r = duplicateClip(d, 'clip_001');
    expect(r.ok && r.doc.clips[1].voice).toEqual({ text: 'あ', status: 'none', voicePath: null });
  });

  it('直後が空いていなければ置けない（勝手に別の場所へ置かない）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 5 }), clip('clip_002', { startSec: 5, durationSec: 5 })] });
    expectBlocked(duplicateClip(d, 'clip_001'), EDIT_BLOCKED.overlap);
  });
});

describe('見た目パターンのクリップ（差し込み口が生きている・#632）', () => {
  const tmplClip = (over: Partial<TimelineClip> = {}): TimelineClip =>
    clip('clip_001', { kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', x: 0, y: 0, w: 1920, h: 1080, ...over });

  describe('setClipAssetRef', () => {
    it('差し込み口に素材を入れる', () => {
      const r = setClipAssetRef(doc({ clips: [tmplClip()] }), 'clip_001', 'layer_bg', 'asset_001');
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({ layer_bg: 'asset_001' });
    });

    it('「なし」はキーごと落とす（null と未指定は解決が同じ＝形も揃える）', () => {
      const d = doc({ clips: [tmplClip({ assetRefs: { layer_bg: 'asset_001' } })] });
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', null);
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({});
    });

    it('同じものを入れ直しても文書は変わらない（取り消しが空振りしない）', () => {
      const d = doc({ clips: [tmplClip({ assetRefs: { layer_bg: 'asset_001' } })] });
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', 'asset_001');
      expect(r.ok && r.doc).toBe(d);
    });

    it('入っていない差し込み口に「なし」を選んでも文書は変わらない（絵は変わらないのに履歴が1段積まれない）', () => {
      const d = doc({ clips: [tmplClip()] });
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', null);
      expect(r.ok && r.doc).toBe(d);
    });

    it('固定した列の部品は変えられない', () => {
      const d = doc({ clips: [tmplClip()], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
      expectBlocked(setClipAssetRef(d, 'clip_001', 'layer_bg', 'asset_001'), EDIT_BLOCKED.locked);
    });

    it('無い部品は変えられない', () => {
      expectBlocked(setClipAssetRef(doc(), 'clip_999', 'layer_bg', 'asset_001'), EDIT_BLOCKED.notFound);
    });
  });

  describe('setClipText', () => {
    it('文字を書き換える', () => {
      const r = setClipText(doc({ clips: [tmplClip()] }), 'clip_001', 'title', 'こんにちは');
      expect(r.ok && r.doc.clips[0].texts).toEqual({ title: 'こんにちは' });
    });

    it('空にしたら持たない（空文字と未入力を別扱いにしない）', () => {
      const d = doc({ clips: [tmplClip({ texts: { title: 'あ' } })] });
      const r = setClipText(d, 'clip_001', 'title', '');
      expect(r.ok && r.doc.clips[0].texts).toEqual({});
    });

    it('同じ文字なら文書は変わらない', () => {
      const d = doc({ clips: [tmplClip({ texts: { title: 'あ' } })] });
      const r = setClipText(d, 'clip_001', 'title', 'あ');
      expect(r.ok && r.doc).toBe(d);
    });

    it('固定した列の部品は変えられない', () => {
      const d = doc({ clips: [tmplClip()], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
      expectBlocked(setClipText(d, 'clip_001', 'title', 'あ'), EDIT_BLOCKED.locked);
    });
  });

  describe('addTemplateClip', () => {
    const tmpl = { templateId: 'tmpl_001', aspectRatio: '16:9' } as const;

    it('指定の列・時刻に置き、画面いっぱいの大きさにする', () => {
      const r = addTemplateClip(doc({ clips: [] }), { template: tmpl, trackId: 'track_001', startSec: 3 });
      expect(r.ok && r.doc.clips[0]).toMatchObject({
        kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', trackId: 'track_001',
        startSec: 3, durationSec: 8,
      });
      // 箱は持たない（未指定＝画面いっぱい）＝焼き出しと同じ持ち方（向きを変えても古い大きさが残らない）。
      const placed = r.ok ? r.doc.clips[0] : undefined;
      expect(placed?.w).toBeUndefined();
      expect(placed?.h).toBeUndefined();
    });

    it('長さはテンプレの既定を使う（場面形式の「新しい場面」と同じ）', () => {
      const r = addTemplateClip(doc({ clips: [] }), { template: { ...tmpl, defaults: { durationSec: 4 } }, trackId: 'track_001', startSec: 0 });
      expect(r.ok && r.doc.clips[0].durationSec).toBe(4);
    });

    it('短すぎる長さは最小で止める（潰れた部品を作らない）', () => {
      const r = addTemplateClip(doc({ clips: [] }), { template: { ...tmpl, defaults: { durationSec: 0 } }, trackId: 'track_001', startSec: 0 });
      expect(r.ok && r.doc.clips[0].durationSec).toBe(TIMELINE_MIN_CLIP_SEC);
    });

    it('先に置いてあるものと重なる場所には置かない（寄せない・上書きしない）', () => {
      expectBlocked(
        addTemplateClip(doc(), { template: tmpl, trackId: 'track_001', startSec: 1 }),
        EDIT_BLOCKED.overlap,
      );
    });

    it('音の列には置けない', () => {
      expectBlocked(
        addTemplateClip(doc(), { template: tmpl, trackId: 'track_003', startSec: 0 }),
        EDIT_BLOCKED.trackKind,
      );
    });

    it('固定した列には置けない', () => {
      const d = doc({ clips: [], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
      expectBlocked(addTemplateClip(d, { template: tmpl, trackId: 'track_001', startSec: 0 }), EDIT_BLOCKED.locked);
    });

    it('無い列には置けない', () => {
      expectBlocked(addTemplateClip(doc(), { template: tmpl, trackId: 'track_999', startSec: 0 }), EDIT_BLOCKED.notFound);
    });

    it('向きが違う見た目パターンは置かない（画面からはみ出した絵を作らない）', () => {
      const d = doc({ clips: [] });
      expectBlocked(
        addTemplateClip(d, { template: { templateId: 'tmpl_p', aspectRatio: '9:16' }, trackId: 'track_001', startSec: 0 }),
        EDIT_BLOCKED.orientation,
      );
    });

    it('縦型の動画には縦型の見た目パターンを置ける', () => {
      const d = doc({ clips: [], videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
      const r = addTemplateClip(d, { template: { templateId: 'tmpl_p', aspectRatio: '9:16' }, trackId: 'track_001', startSec: 0 });
      expect(r.ok).toBe(true);
    });

    it('置いた部品は適合する（一覧に出るのに開けない動画を作らない）', () => {
      const r = addTemplateClip(doc({ clips: [] }), { template: tmpl, trackId: 'track_001', startSec: 0 });
      expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
    });
  });
});
