// タイムライン形式の編集操作（ADR-0032・#629）。置けないときに黙って別の結果にしないことを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND, NARRATION_STATUS } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import {
  addAudioClip, addVoiceClip, addTrack, clipCountOnTrack, clipPlacementIssue, duplicateClip, EDIT_BLOCKED, isFreeSpan, placedDurationSec, VISUAL_CLIP_DURATION_SEC,
  addTemplateClip, addVisualClip, duplicateTrack, moveClips, moveTrackTo, setClipBox, setClipBoxes, firstFreeStart, setVisualClipContent, moveClip, visualPlacementIssue, moveTrackOrder, removeClips, removeSelectedClipsChecked, moveClipIssue, trimClipIssue, removeTrack, placeableAudioTracks, placeableVisualTracks, setClipAssetRef, setClipAudioSource, setClipFade, setClipSourceStart, setClipSpeed, setClipText, setClipVolume, setTrackFlag, trackPlacementIssue, trimClip, trimClips, trimTargetsAt,
} from './edit';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { validateTimelineDoc } from './validateTimelineDoc';
import { subtitleTextOf } from './subtitleLink';
import { AUDIO_PLACEHOLDER_SEC, TIMELINE_MIN_CLIP_SEC, MIN_BOX_SIZE_PX, VOICE_PLACEHOLDER_SEC } from '../constants';
import { BGM_CATALOG } from '../bgm/bgmCatalog';
import { DEFAULT_SHAPE_COLOR } from '../project/freeLayoutOps';

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
    // ⚠️ **同一参照**で見る（#724）。`toMatchObject` は値が同じなら通るので、**新しい文書を作って返す**
    // 変異が生き残る＝呼び出し側は同一参照で「積まない」を決めているので、値一致では守れていない。
    // 兄弟（`trimClip`／`setClipAssetRef`／`setClipText`／`setClipSpeed`／crop 系）は `.toBe()` を使っており、
    // ここだけが例外だった。
    const r = moveClip(d, 'clip_001', { startSec: -5 });
    expect(r.ok).toBe(true);
    expect((r as { ok: true; doc: TimelineProject }).doc).toBe(d);
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

describe('removeSelectedClipsChecked（利用者が「消す」を押す入口・#701）', () => {
  it('固定した列の部品が混ざっていたら断る（全部選んでから消す、で固定が意味を失わない）', () => {
    const d = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual, locked: true },
        { id: 'track_002', kind: TRACK_KIND.visual },
      ],
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })],
    });
    // 固定列のものだけ／固定でないものと混ぜた場合、どちらも断る（黙って一部だけ消さない・ADR-0026④）。
    // ⚠️ 断る語彙は**画面と同じ**（#752 レビュー）＝同じ述語に2つの言い方を持たない。
    expect(removeSelectedClipsChecked(d, ['clip_001'])).toEqual({ ok: false, reason: EDIT_BLOCKED.lockedSelection });
    expect(removeSelectedClipsChecked(d, ['clip_001', 'clip_002'])).toEqual({ ok: false, reason: EDIT_BLOCKED.lockedSelection });
  });

  it('固定でない列だけなら、消した結果は removeClips と同じ', () => {
    const d = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual, locked: true },
        { id: 'track_002', kind: TRACK_KIND.visual },
      ],
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })],
    });
    const r = removeSelectedClipsChecked(d, ['clip_002']);
    expect(r.ok).toBe(true);
    expect(r.ok && r.doc).toEqual(removeClips(d, ['clip_002']));
  });

  it('実在しない id だけなら「見つからない」で断る（何も起きない、を作らない）', () => {
    const d = doc({ clips: [clip('clip_001')] });
    expect(removeSelectedClipsChecked(d, ['no_such_id'])).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  it('列ごと消すときは固定の判定を通さない（removeClips は内部の道具のまま）', () => {
    // `removeTrack` は列そのものの固定を見る＝クリップ側でもう一度断ると、外した固定が二重にかかる。
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }],
      clips: [clip('clip_001')],
    });
    expect(removeClips(d, ['clip_001']).clips).toEqual([]);
  });
});

describe('firstFreeStart（次に空いている時刻・#684 レビュー）', () => {
  const withSpans = (spans: [number, number][]) => doc({
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: spans.map(([st, en], i) => clip(`clip_${String(i + 1).padStart(3, '0')}`, { startSec: st, durationSec: en - st })),
  }).clips;

  it('**間の空きを飛び越さない**（いちばん後ろの終わりではない）', () => {
    // [0,3) と [10,15)。5秒ぶんは [3,10) の空きに収まるので 3（15 ではない）。
    expect(firstFreeStart(withSpans([[0, 3], [10, 15]]), 'track_001', 0, 5)).toBe(3);
  });

  it('ちょうど収まる空きは使う（端が接するのは可＝11 §8 V24）', () => {
    // [0,3) と [8,10)。空き [3,8) は5秒ちょうど＝そこへ置く。
    expect(firstFreeStart(withSpans([[0, 3], [8, 10]]), 'track_001', 0, 5)).toBe(3);
  });

  it('その空きに収まらなければ、次の空きを見る', () => {
    // [0,3) と [6,10)。5秒は [3,6) に収まらないので 10。
    expect(firstFreeStart(withSpans([[0, 3], [6, 10]]), 'track_001', 0, 5)).toBe(10);
  });

  it('その時刻が空いていれば、後ろに部品があってもそのまま置く', () => {
    // [10,15) だけ。再生位置0は [0,10) が空いているので 0（15 へ飛ばさない）。
    expect(firstFreeStart(withSpans([[10, 15]]), 'track_001', 0, 5)).toBe(0);
  });

  it('並び順に関わらず同じ答えになる（保存の順に依存しない）', () => {
    // 同じ [0,3)+[10,15) を後ろから並べても 3。
    const reversed = [...withSpans([[0, 3], [10, 15]])].reverse();
    expect(firstFreeStart(reversed, 'track_001', 0, 5)).toBe(3);
    // 収まらない空きが先にある形も。[0,3)+[4,6)+[10,20) を混ぜて並べても 6。
    const shuffled = withSpans([[4, 6], [10, 20], [0, 3]]);
    expect(firstFreeStart(shuffled, 'track_001', 0, 4)).toBe(6);
  });

  it('空いていればその時刻のまま・後ろに何も無ければ最後の終わり', () => {
    expect(firstFreeStart(withSpans([]), 'track_001', 2, 5)).toBe(2);
    expect(firstFreeStart(withSpans([[0, 4]]), 'track_001', 0, 5)).toBe(4);
    // 探し始めより前に終わる部品は関係ない。
    expect(firstFreeStart(withSpans([[0, 1]]), 'track_001', 5, 5)).toBe(5);
  });

  it('ほかの列の部品は見ない', () => {
    const clips = [...withSpans([[0, 20]])].map((c) => ({ ...c, trackId: 'track_009' }));
    expect(firstFreeStart(clips, 'track_001', 0, 5)).toBe(0);
  });
});

describe('visualPlacementIssue（そこへ置けるか・#684）', () => {
  const base = () => doc({
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_004', kind: TRACK_KIND.visual, locked: true },
      { id: 'track_005', kind: TRACK_KIND.visual, hidden: true },
    ],
    clips: [clip('clip_001', { trackId: 'track_001', startSec: 0, durationSec: 5 })],
    assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/a.png' }],
  });
  const at = (trackId: string, startSec = 10) => ({ kind: TIMELINE_CLIP_KIND.text, trackId, startSec });

  it('置ける所は理由なし', () => {
    expect(visualPlacementIssue(base(), at('track_001'))).toBeNull();
  });

  it('無い列・音の列・固定した列・**出さない列**・重なる場所は、それぞれの理由で断る', () => {
    expect(visualPlacementIssue(base(), at('track_999'))).toBe(EDIT_BLOCKED.notFound);
    expect(visualPlacementIssue(base(), at('track_002'))).toBe(EDIT_BLOCKED.trackKind);
    expect(visualPlacementIssue(base(), at('track_004'))).toBe(EDIT_BLOCKED.locked);
    // 「出さない」は固定とは別＝動かせないのではなく**映らない**。
    expect(visualPlacementIssue(base(), at('track_005'))).toBe(EDIT_BLOCKED.hiddenTrack);
    expect(visualPlacementIssue(base(), at('track_001', 0))).toBe(EDIT_BLOCKED.overlap);
  });

  it('素材の部品は、この動画が持っている素材でなければ断る', () => {
    const slot = (assetId?: string) => ({ kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 10, assetId });
    expect(visualPlacementIssue(base(), slot('asset_001'))).toBeNull();
    expect(visualPlacementIssue(base(), slot('asset_999'))).toBe(EDIT_BLOCKED.notFound);
    expect(visualPlacementIssue(base(), slot(undefined))).toBe(EDIT_BLOCKED.notFound);
  });

  it('置く判定と同じものを見る（ゴーストと結果が食い違わない）', () => {
    // 断る所は `addVisualClip` も同じ理由で断り、置ける所は置ける。
    for (const t of ['track_001', 'track_002', 'track_004', 'track_005', 'track_999']) {
      const issue = visualPlacementIssue(base(), at(t));
      const r = addVisualClip(base(), at(t));
      expect(r.ok ? null : r.reason).toBe(issue);
    }
  });
});

describe('addVisualClip（写真・文字・図形を置く・#684）', () => {
  const base = () => doc({
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'a.png' }],
  });

  it('画面の真ん中に置く（置いた瞬間に見える）', () => {
    const r = addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0 });
    expect(r.ok).toBe(true);
    const c = r.ok ? r.doc.clips[0] : undefined;
    // 16:9＝1920×1080。文字は横長の帯（0.8×0.14）を真ん中へ。
    expect(c).toMatchObject({ kind: 'text', x: 192, y: 465, w: 1536, h: 151, text: 'テキスト' });
  });

  it('落とした場所は**箱の中心**として扱い、画面の外へは出さない', () => {
    const r = addVisualClip(base(), {
      kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, center: { x: 0, y: 0 },
    });
    expect(r.ok).toBe(true);
    // 左上に落としても、箱ごと画面の中へ収める（負の座標を作らない）。
    expect(r.ok && r.doc.clips[0]).toMatchObject({ x: 0, y: 0 });
    const far = addVisualClip(base(), {
      kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0, center: { x: 9999, y: 9999 },
    });
    expect(far.ok && far.doc.clips[0]).toMatchObject({ x: 1920 - 576, y: 1080 - 324 });
  });

  it('図形の既定は場面形式の「図形を足す」と同じ（形式で色が変わらない）', () => {
    const r = addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_001', startSec: 0 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({ shapeType: 'rect', fillColor: DEFAULT_SHAPE_COLOR, opacity: 1 });
  });

  it('この動画が持っていない素材は置かない（存在しない枠を作らない）', () => {
    expectBlocked(
      addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, assetId: 'no_such' }),
      EDIT_BLOCKED.notFound,
    );
    expectBlocked(
      addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0 }),
      EDIT_BLOCKED.notFound,
    );
  });

  it('置いた部品はスキーマに適合する（一覧に出るのに開けない動画を作らない）', () => {
    for (const kind of [TIMELINE_CLIP_KIND.text, TIMELINE_CLIP_KIND.shape] as const) {
      const r = addVisualClip(base(), { kind, trackId: 'track_001', startSec: 0 });
      expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
    }
    const slot = addVisualClip(base(), {
      kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, assetId: 'asset_001',
    });
    expect(slot.ok && validateTimelineProject(slot.doc)).toBe(true);
  });

  it('その種類が持たない項目は断る（意味の無いデータを書かない）', () => {
    const placed = addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0 });
    const d = placed.ok ? placed.doc : base();
    const id = d.clips[0].id;
    // 文字の部品に図形の色は書けない（`TimelineClip` は平らな形なので、型ではなく関数が断る）。
    // **列の種別違いとは別の理由**（#684 レビュー）＝「列に置き直してください」は項目違いには当たらない案内。
    expectBlocked(setVisualClipContent(d, id, { fillColor: '#ff0000' }), EDIT_BLOCKED.contentField);
    // 音の部品には中身の項目そのものが無い。
    const audio = doc({ clips: [{ id: 'clip_009', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, bundledBgmId: 'found-new-hope' }] });
    expectBlocked(setVisualClipContent(audio, 'clip_009', { text: 'あ' }), EDIT_BLOCKED.contentField);
    // 直せる項目は通る（断りすぎていない）。
    expect(setVisualClipContent(d, id, { text: 'こんにちは' }).ok).toBe(true);
  });

  it('音の列には置けない・固定した列にも置けない・重なる場所にも置けない', () => {
    expectBlocked(
      addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0 }),
      EDIT_BLOCKED.trackKind,
    );
    const locked = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }], clips: [] });
    expectBlocked(
      addVisualClip(locked, { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0 }),
      EDIT_BLOCKED.locked,
    );
    const busy = addVisualClip(base(), { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0 });
    expectBlocked(
      addVisualClip(busy.ok ? busy.doc : base(), { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 1 }),
      EDIT_BLOCKED.overlap,
    );
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

  const tracksOf = (r: ReturnType<typeof moveTrackTo>): string[] => (r.ok ? r.doc.tracks.map((t) => t.id) : []);

  it('重ね順を1つ動かす（端では何も起きない）', () => {
    const d = doc();
    expect(tracksOf(moveTrackOrder(d, 'track_001', 'front'))).toEqual(['track_002', 'track_001', 'track_003']);
    expect(tracksOf(moveTrackOrder(d, 'track_001', 'back'))).toEqual(['track_001', 'track_002', 'track_003']);
  });

  it('**中身ごと複製して、元のすぐ手前へ入る**（空の列だけ増やすなら「足す」と同じ・#767）', () => {
    const d = doc({
      clips: [
        clip('clip_001', { startSec: 0 }),
        clip('clip_002', { startSec: 6 }),
        clip('clip_003', { trackId: 'track_002' }), // 別の列＝運ばれない
      ],
    });
    const r = duplicateTrack(d, 'track_001');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.tracks.map((t) => t.id)).toEqual(['track_001', 'track_004', 'track_002', 'track_003']);
    const copied = r.doc.clips.filter((c) => c.trackId === 'track_004');
    expect(copied.map((c) => c.id)).toEqual(['clip_004', 'clip_005']); // 番号を飛ばさず、二度出さない
    expect(copied.map((c) => c.startSec)).toEqual([0, 6]); // 時間はそのまま
    expect(r.doc.clips.filter((c) => c.trackId === 'track_001')).toHaveLength(2); // 元は減らない
  });

  it('名前は引き継がない（同じ名前の列が2つ並ぶと区別できない）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, name: '見出し', hidden: true, locked: true }] });
    const r = duplicateTrack(d, 'track_001');
    expect(r.ok && r.doc.tracks[1]).toMatchObject({ kind: TRACK_KIND.visual, hidden: true, locked: true });
    expect(r.ok && r.doc.tracks[1].name).toBeUndefined(); // 設定は引き継ぐが、名前は引き継がない
  });

  it('読み上げは**作成済みの音声を引き継がない**（部品ひとつの複製と同じ規則・#767）', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_001', startSec: 0, durationSec: 3, voice: { text: 'あ', status: NARRATION_STATUS.generated, voicePath: 'a.wav' } }],
    });
    const r = duplicateTrack(d, 'track_001');
    const copied = r.ok ? r.doc.clips.find((c) => c.trackId !== 'track_001') : undefined;
    expect(copied?.voice).toMatchObject({ text: 'あ', status: NARRATION_STATUS.none, voicePath: null });
  });

  // ⚠️ #787：以前ここは「連動先も一緒に複製されるときだけ結び直す」を見ていたが、その分岐は
  // **列の種別の決まり（V23）により一度も通らない**。しかも試験は**その決まりを破った文書**を作って
  // 到達不能な枝を通しており、**実際に起きること（連動が必ず落ちて見えない帯になる）を隠していた**。
  const linkedDoc = () => doc({
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: NARRATION_STATUS.none } },
      // ⚠️ **自分の文を持たない**連動字幕＝`addLinkedSubtitleClip`／掛け合いの焼き出しが作る典型形で、
      // #787 が起きるのはこの形だけ（自分の文があると、連動が落ちてもその文で描かれるので露見しない）。
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_001' },
    ],
  });

  it('連動している字幕は列を複製しても**元の読み上げを指したまま**（#787）', () => {
    const r = duplicateTrack(linkedDoc(), 'track_001');
    const copied = r.ok ? r.doc.clips.find((c) => c.id === 'clip_003') : undefined;
    expect(copied?.voiceClipId).toBe('clip_001'); // 元は複製しても必ず残るので、指したままで追従する
  });

  // ⚠️ 見るのは**描かれるかどうか**（`subtitleTextOf`）＝書き出しの関門は「指しているのに見つからない」
  // ものしか数えないので、連動ごと落ちた字幕は関門をすり抜ける（そこが #787 の「最悪の点」だった）。
  it('複製した字幕は「何も出ない帯」にならない（#787）', () => {
    const r = duplicateTrack(linkedDoc(), 'track_001');
    const copied = r.ok ? r.doc.clips.find((c) => c.id === 'clip_003') : undefined;
    expect(r.ok && copied && subtitleTextOf(r.doc, copied)).toBe('あ');
  });

  // ⚠️ この変更で**1つの読み上げに複数の字幕**が普通の操作から作れるようになった（レビュー指摘）。
  // 決定24「連動している＝区間が一致している」は**全部**について保たれる必要があるので、
  // 元と複製の**両方**が追従することを固定する（片方だけ動くと、連動と言いながら合っていない状態になる）。
  it('1つの読み上げに複数の字幕が付いても、動かすと**全部**が同じ区間になる（#787）', () => {
    const dup = duplicateTrack(linkedDoc(), 'track_001');
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    const moved = moveClip(dup.doc, 'clip_001', { startSec: 10 }); // 読み上げを動かす
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const subs = moved.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(subs).toHaveLength(2);
    expect(subs.map((c) => c.startSec)).toEqual([10, 10]);

    const trimmed = trimClip(moved.doc, 'clip_001', 'end', 16); // 読み上げを伸ばす
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    const after = trimmed.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(after.map((c) => c.durationSec)).toEqual([6, 6]);
  });

  // ⚠️ **前提そのものを固定する**＝「同じ列に字幕と読み上げが同居する文書」は作れない。
  // ここが崩れたら上の2件の理由づけも崩れるので、到達不能な枝を書き足す前に気づけるようにする。
  it('字幕と読み上げが同じ列に居る文書は V23 が知らせる（編集からは作れない・前提の裏取り）', () => {
    const same = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_001', startSec: 0, durationSec: 3, voice: { text: 'あ', status: NARRATION_STATUS.none } },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_001' },
      ],
    });
    expect(validateTimelineDoc(same).map((w) => w.code)).toContain('TIMELINE_CLIP_TRACK_KIND');
  });

  // #787 の同型（部品ひとつの複製）＝連動は落とすのが正しいが、落とす前に**いま出ている文を焼き付ける**。
  // 焼き付けないと「文も連動先も無い＝何も出ない帯」ができ、黙って中身が消えたのと同じになる。
  it('部品ひとつの複製は、連動を落とす前に**いま出ている文を焼き付ける**（#787）', () => {
    const r = duplicateClip(linkedDoc(), 'clip_002');
    const copied = r.ok ? r.doc.clips.find((c) => c.id === 'clip_003') : undefined;
    expect(copied?.voiceClipId).toBeUndefined(); // 連動は引き継がない（同じ列・直後＝必ず重なる）
    expect(copied?.text).toBe('あ');             // 連動先の文が焼き付いている
    expect(r.ok && copied && subtitleTextOf(r.doc, copied)).toBe('あ'); // 描かれる
  });

  it('まとまりと動きは**複製した部品を指すように張り替える**（参照切れを作らない・#767）', () => {
    const d = doc({
      clips: [clip('clip_001'), clip('clip_002', { startSec: 6 })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 10, y: 0, scale: 1, rotation: 0 } }],
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 5 }] },
        { id: 'anim_002', targetId: 'group_001', keyframes: [{ timeSec: 0, x: 7 }] },
      ],
    });
    const r = duplicateTrack(d, 'track_001');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.doc.groups!.find((x) => x.id === 'group_002')!;
    expect(g.members).toEqual(['clip_003', 'clip_004']); // 複製した部品を指す
    expect(g.transform).toEqual({ x: 10, y: 0, scale: 1, rotation: 0 }); // 見た目は同じ
    const anims = r.doc.animations!;
    expect(anims.map((a) => a.targetId)).toEqual(['clip_001', 'group_001', 'clip_003', 'group_002']);
    expect(anims.map((a) => a.id)).toEqual(['anim_001', 'anim_002', 'anim_003', 'anim_004']); // 番号を二度出さない
  });

  it('**まとまりが列をまたぐときは断る**（片側だけ複製すると絵が変わる・#767）', () => {
    const d = doc({
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_002' })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 10, y: 0, scale: 1, rotation: 0 } }],
    });
    expectBlocked(duplicateTrack(d, 'track_001'), EDIT_BLOCKED.groupAcrossTracks);
  });

  it('無い列は複製できない', () => {
    expectBlocked(duplicateTrack(doc(), 'track_999'), EDIT_BLOCKED.notFound);
  });

  it('**指した位置へ動かす**（端は端で止める・変わらないなら同じ文書・#767）', () => {
    const d = doc();
    expect(tracksOf(moveTrackTo(d, 'track_001', 2))).toEqual(['track_002', 'track_003', 'track_001']);
    expect(tracksOf(moveTrackTo(d, 'track_003', 0))).toEqual(['track_003', 'track_001', 'track_002']);
    expect(tracksOf(moveTrackTo(d, 'track_001', 99))).toEqual(['track_002', 'track_003', 'track_001']); // 端で止める
    const same = moveTrackTo(d, 'track_001', 0);
    expect(same.ok && same.doc).toBe(d); // 変わらない＝同じ文書（空振りの取り消しを積まない）
    expectBlocked(moveTrackTo(d, 'track_999', 1), EDIT_BLOCKED.notFound);
  });

  it('**固定した列は並べ替えられない**（消せないのと揃える・#767 レビュー）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expectBlocked(moveTrackTo(d, 'track_001', 1), EDIT_BLOCKED.locked);
    expectBlocked(moveTrackOrder(d, 'track_001', 'front'), EDIT_BLOCKED.locked); // 1段ずつも同じ
  });

  it('1段ずつの移動と、指した位置への移動は**同じ規則**を通る（#767）', () => {
    const d = doc();
    expect(tracksOf(moveTrackOrder(d, 'track_001', 'front'))).toEqual(tracksOf(moveTrackTo(d, 'track_001', 1)));
  });

  it('表示/固定を切り替える', () => {
    expect(setTrackFlag(doc(), 'track_001', 'hidden', true).tracks[0].hidden).toBe(true);
    expect(setTrackFlag(doc(), 'track_001', 'locked', true).tracks[0].locked).toBe(true);
  });
});

// #724：兄弟は全部持っているのに `setTrackFlag` だけ同値チェックが無く、空振りの取り消しを積んでいた。
describe('setTrackFlag（列の固定・非表示）', () => {
  it('同じ値なら同じ文書を返す（取り消しが空振りしない）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expect(setTrackFlag(d, 'track_001', 'locked', true)).toBe(d);
    expect(setTrackFlag(d, 'track_001', 'hidden', false)).toBe(d); // 未指定＝false と同じ
  });

  it('値が変われば新しい文書を返す', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }] });
    const next = setTrackFlag(d, 'track_001', 'locked', true);
    expect(next).not.toBe(d);
    expect(next.tracks[0].locked).toBe(true);
  });

  it('無い列は何もしない（作らない）', () => {
    const d = doc();
    expect(setTrackFlag(d, 'track_999', 'locked', true)).toBe(d);
  });
});

// #724：音の設定を**音を持たない部品**へ書けてしまい、誰も読まない値が文書に残っていた。
describe('音の設定は鳴る音を持つ部品だけ（#724）', () => {
  const withText = () => doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.text, text: 'あ' })] });

  it('文字の部品には速さ・使い始め・音量・フェードを書けない', () => {
    const d = withText();
    // ⚠️ **音量・フェードは「音を持っていない」**（`notAudio`）。
    for (const r of [
      setClipVolume(d, 'clip_001', 0.5),
      setClipFade(d, 'clip_001', 'in', 1),
    ]) {
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.notAudio });
    }
    // ⚠️ **速さ・使い始めは「その2つを持っていない」**（`notPlayable`・#1019 ⑦）＝この2つは
    // **動画にもある**ので、「音や読み上げの部品で変えてください」だと動画の部品を探せない（§2-5）。
    for (const r of [
      setClipSpeed(d, 'clip_001', 2),
      setClipSourceStart(d, 'clip_001', 1),
    ]) {
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.notPlayable });
    }
  });

  // ⚠️ **「見つかりません」で断らない**＝選び直しても直らない案内になる（§2-5）。
  it('理由は「音を持っていない」＝見つからないではない', () => {
    expect(EDIT_BLOCKED.notAudio).not.toBe(EDIT_BLOCKED.notFound);
    expect(EDIT_BLOCKED.notPlayable).not.toBe(EDIT_BLOCKED.notFound);
    // ⚠️ **2つは別物**（音を持たない／速さ・使い始めを持たない）＝同じ値に潰さない。
    expect(EDIT_BLOCKED.notPlayable).not.toBe(EDIT_BLOCKED.notAudio);
  });

  // ⚠️ **速さ・使い始めは音だけ**（`11 §7.6.3.2` の**既存の**決定）＝読み上げの長さは声の実尺で `trimClip`
  // してあるので、速さを変えると尺と実尺がずれ、**連動している字幕の区間も意味を失う**（決定24）。
  // レビューで判明＝追記した節に既に書いてあった決定を読まずに `isAudioClip` へ広げていた。
  it('読み上げには速さ・使い始めを書けない（音量とフェードは書ける）', () => {
    const v = doc({
      tracks: [{ id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 0, durationSec: 5, voice: { text: 'あ', status: NARRATION_STATUS.none } }],
    });
    // ⚠️ **断りは `contentField`**（#795・PR #865 レビュー）＝読み上げは**音を持っている**ので、
    // `notAudio`（「その部品は音を持っていません。音の設定は、音や**読み上げの部品で**変えてください」）は
    // **読み上げを操作しているのに読み上げでやれと言う**自己矛盾になる。`§7.6.3` の規準どおり
    // 「持ってはいるが、その項目が無い」＝3。
    expect(setClipSpeed(v, 'clip_001', 2)).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
    expect(setClipSourceStart(v, 'clip_001', 1)).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
    expect(setClipVolume(v, 'clip_001', 0.5).ok).toBe(true);
    expect(setClipFade(v, 'clip_001', 'in', 1).ok).toBe(true);

    // ⚠️ **速さ・使い始めを持たない部品は `notPlayable`**（#1019 ⑦）＝2と3が別のものを指していることを対で固定する。
    const t = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.text, text: 'あ' })] });
    expect(setClipSpeed(t, 'clip_001', 2)).toEqual({ ok: false, reason: EDIT_BLOCKED.notPlayable });
    expect(setClipSourceStart(t, 'clip_001', 1)).toEqual({ ok: false, reason: EDIT_BLOCKED.notPlayable });
  });

  // ⚠️ **断る順は「音を持たない部品か」→「固定した列か」**（同節・#734 レビュー）＝逆だと
  // 「固定を外してください」と言われて外しても直らない（§2-5）。
  it('固定した列の文字部品でも、理由は「固定」ではなく「音を持っていない」', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }],
      clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.text, text: 'あ' })],
    });
    // レビュー指摘＝4つとも固定する（2つだけだと順序の書き違いが残る）。
    // ⚠️ **どちらの断りでも「固定」より先**＝外しても直らない案内にしない。
    for (const r of [setClipVolume(d, 'clip_001', 0.5), setClipFade(d, 'clip_001', 'in', 1)]) {
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.notAudio });
    }
    for (const r of [setClipSpeed(d, 'clip_001', 2), setClipSourceStart(d, 'clip_001', 1)]) {
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.notPlayable });
    }
  });

  it('音・読み上げには従来どおり書ける', () => {
    const d = doc({
      tracks: [{ id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_003', startSec: 0, durationSec: 5, bundledBgmId: 'found-new-hope' }],
    });
    const r = setClipVolume(d, 'clip_001', 0.5);
    expect(r.ok && r.doc.clips[0].volume).toBe(0.5);
    const v = doc({
      tracks: [{ id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 0, durationSec: 5, voice: { text: 'あ', status: NARRATION_STATUS.none } }],
    });
    const rv = setClipVolume(v, 'clip_001', 0.25);
    expect(rv.ok && rv.doc.clips[0].volume).toBe(0.25);
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

// #714＝**置き方（ボタン／掴んで運ぶ）で流儀を割らない**ために、置ける条件と置いたときの長さを
// 1か所へ寄せた。運んでいる最中の枠・色と、実際に置く関数が同じものを見る。
describe('clipPlacementIssue / placedDurationSec（置く前の姿・#714）', () => {
  const tmpl = { templateId: 'tmpl_001', defaults: {}, aspectRatio: '16:9' } as Parameters<typeof addTemplateClip>[1]['template'];
  const base = () => doc({ assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'a.mp3' }] });

  it('置いたときの長さは種類ごとに違う（枠の幅と重なりの判定が同じ値を見る）', () => {
    expect(placedDurationSec({ kind: TIMELINE_CLIP_KIND.text })).toBe(VISUAL_CLIP_DURATION_SEC);
    expect(placedDurationSec({ kind: TIMELINE_CLIP_KIND.audio })).toBe(AUDIO_PLACEHOLDER_SEC);
    expect(placedDurationSec({ kind: TIMELINE_CLIP_KIND.voice })).toBe(VOICE_PLACEHOLDER_SEC);
    // 見た目パターンは場面形式と同じ既定（`defaultDurationForTemplate`）。
    expect(placedDurationSec({ kind: TIMELINE_CLIP_KIND.template, template: tmpl })).toBeGreaterThan(0);
  });

  it('長さの違いは重なりの判定に効く（短い部品は入るが、長い部品は入らない）', () => {
    // 0〜4秒に部品があり、その後ろ 4〜9秒が空いている（9秒から別の部品）。
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 4, bundledBgmId: BGM_CATALOG[0].id } as TimelineClip,
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 9, durationSec: 5, bundledBgmId: BGM_CATALOG[0].id } as TimelineClip,
      ],
    });
    // 読み上げ（3秒）は入るが、音（10秒）は入らない＝長さを1か所から採っている証拠。
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.voice }, 'track_002', 4)).toBeNull();
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: BGM_CATALOG[0].id }, 'track_002', 4))
      .toBe(EDIT_BLOCKED.overlap);
  });

  it('列の種別が合わなければ断る（音を絵の列へ置かせない）', () => {
    expect(clipPlacementIssue(base(), { kind: TIMELINE_CLIP_KIND.voice }, 'track_001', 0)).toBe(EDIT_BLOCKED.trackKind);
    expect(clipPlacementIssue(base(), { kind: TIMELINE_CLIP_KIND.text }, 'track_003', 0)).toBe(EDIT_BLOCKED.trackKind);
  });

  // ⚠️ 断る順＝**部品そのもの → 列**（§2-5）。向きの違う見た目パターンはどの列へ置いても直らないので、
  // 「別の列へ置き直してください」を先に出さない。
  it('向きの違う見た目パターンは、置けない列を指していても「向き」で断る', () => {
    const portrait = { ...tmpl, aspectRatio: '9:16' } as typeof tmpl;
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.template, template: portrait }, 'track_001', 0))
      .toBe(EDIT_BLOCKED.orientation);
  });

  it('音の出どころは高々1つ（両方・どちらも無しは置かない）', () => {
    const d = base();
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.audio }, 'track_003', 0)).toBe(EDIT_BLOCKED.notFound);
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: BGM_CATALOG[0].id, assetId: 'asset_001' }, 'track_003', 0))
      .toBe(EDIT_BLOCKED.notFound);
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.audio, assetId: 'asset_001' }, 'track_003', 0)).toBeNull();
  });

  it('文書に無い素材は置けない（差し込み口も音も）', () => {
    const d = base();
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_999' }, 'track_001', 0)).toBe(EDIT_BLOCKED.notFound);
    expect(clipPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.audio, assetId: 'asset_999' }, 'track_003', 0)).toBe(EDIT_BLOCKED.notFound);
  });
});

describe('見た目パターンのクリップ（差し込み口が生きている・#632）', () => {
  const tmplClip = (over: Partial<TimelineClip> = {}): TimelineClip =>
    clip('clip_001', { kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', x: 0, y: 0, w: 1920, h: 1080, ...over });
  /**
   * ⚠️ **素材は文書に実在させる**（#724）＝入れる素材の実在を確かめるようになったので、
   * 材料にも置いておく。以前は無い素材で通っており、**この穴をテストが隠していた**。
   */
  const withAsset = (over: Partial<TimelineProject> = {}): TimelineProject =>
    doc({
      // ⚠️ **2件以上置く**（レビュー指摘）＝1件だけだと `.some` と `.every` が同じ結果になり、
      // 「どれか1つでも一致すれば良い」を「全部一致しないと駄目」に書き違えても**変異が生き残る**。
      assets: [
        { assetId: 'asset_001', assetType: 'image', displayName: '写真1', filePath: 'assets/a.png' },
        { assetId: 'asset_002', assetType: 'image', displayName: '写真2', filePath: 'assets/b.png' },
      ],
      ...over,
    });

  describe('setClipAssetRef', () => {
    it('差し込み口に素材を入れる', () => {
      const r = setClipAssetRef(withAsset({ clips: [tmplClip()] }), 'clip_001', 'layer_bg', 'asset_001');
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({ layer_bg: 'asset_001' });
    });

    // ⚠️ **先頭でない素材も入れられる**（レビュー指摘）＝「どれか1つでも一致すれば良い」を書き違えると、
    // 2件目以降を選んだときだけ「見つかりません」になる（材料が1件では気づけない）。
    it('先頭でない素材も入れられる', () => {
      const r = setClipAssetRef(withAsset({ clips: [tmplClip()] }), 'clip_001', 'layer_bg', 'asset_002');
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({ layer_bg: 'asset_002' });
    });

    // ⚠️ **差し込み口を持たない部品には書けない**（#795）＝ここだけ種別を見ていなかった。
    // 画面は種別で欄を出し分けているので到達しないが、`clipImageAssetIds`（書き出しの関門）は
    // **種別を問わず `assetRefs` を読む**ので、書けてしまうと**その素材の読めることを要求される**。
    it('見た目パターン以外の部品には差し込み口の素材を入れられない', () => {
      const d = withAsset({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.text, text: 'あ' })] });
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', 'asset_001');
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
    });

    // ⚠️ **断る順は「種別 → 固定」**（#724 で揃えた流儀）＝固定を先に返すと、
    // 外しても直らない案内になる（§2-5）。
    it('固定された列でも、種別違いのほうを先に返す', () => {
      const d = withAsset({
        clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.text, text: 'あ' })],
        tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, name: '映像1', locked: true }],
      });
      expect(setClipAssetRef(d, 'clip_001', 'layer_bg', 'asset_001')).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
    });

    // ⚠️ #724（利用者判断＝操作側で塞ぐ）＝兄弟は全部持っている確認がここだけ無く、**無い素材を指したまま
    // 保存できた**（開き直すと灰色の枠が焼き込まれる）。V25 を広げるのは見送り＝ここで止める。
    it('文書に無い素材は入れられない（灰色の枠を作らせない）', () => {
      const r = setClipAssetRef(withAsset({ clips: [tmplClip()] }), 'clip_001', 'layer_bg', 'asset_999');
      expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
    });

    // ⚠️ **主張どおりの状態で確かめる**（レビュー指摘）＝正典（`§7.6.3`）の「**素材が消えた後でも空にできる**」は、
    // **参照先が既に無い文書**でしか確かめられない。材料に素材を置いたままだと、実在確認を
    // 「参照先が壊れている部品は触らせない」まで広げても（＝**外す道を塞いでも**）気づけない。
    it('参照先の素材が消えていても「なし」で外せる（外す道を塞がない）', () => {
      const d = withAsset({ clips: [tmplClip({ assetRefs: { layer_bg: 'asset_999' } })] }); // 既に消えた素材を指している
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', null);
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({});
    });

    it('「なし」はキーごと落とす（null と未指定は解決が同じ＝形も揃える）', () => {
      const d = withAsset({ clips: [tmplClip({ assetRefs: { layer_bg: 'asset_001' } })] });
      const r = setClipAssetRef(d, 'clip_001', 'layer_bg', null);
      expect(r.ok && r.doc.clips[0].assetRefs).toEqual({});
    });

    it('同じものを入れ直しても文書は変わらない（取り消しが空振りしない）', () => {
      const d = withAsset({ clips: [tmplClip({ assetRefs: { layer_bg: 'asset_001' } })] });
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

describe('setClipAudioSource（鳴らす音を選び直す・#695/#723）', () => {
  const audioDoc = (over: Partial<TimelineClip> = {}) =>
    doc({
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/asset_001.mp3' }],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, bundledBgmId: 'summer-morning', volume: 0.5, ...over }],
    });

  it('同梱BGM から素材へ替えると、同梱BGM は落ちる（音の出どころは高々1つ＝V25）', () => {
    const r = setClipAudioSource(audioDoc(), 'clip_001', { assetId: 'asset_001' });
    expect(r.ok).toBe(true);
    const c = (r as { ok: true; doc: TimelineProject }).doc.clips[0];
    expect(c.assetId).toBe('asset_001');
    expect('bundledBgmId' in c).toBe(false); // 残すと両方持つ部品ができる
  });

  it('素材から同梱BGM へ替えると、素材は落ちる', () => {
    const r = setClipAudioSource(audioDoc({ bundledBgmId: undefined, assetId: 'asset_001' }), 'clip_001', { bundledBgmId: 'summer-morning' });
    const c = (r as { ok: true; doc: TimelineProject }).doc.clips[0];
    expect(c.bundledBgmId).toBe('summer-morning');
    expect('assetId' in c).toBe(false);
  });

  it('速さ・音量・フェードは残る（消して置き直すのと違う点）', () => {
    const r = setClipAudioSource(audioDoc({ speed: 1.5, fadeInSec: 1 }), 'clip_001', { assetId: 'asset_001' });
    expect((r as { ok: true; doc: TimelineProject }).doc.clips[0]).toMatchObject({ volume: 0.5, speed: 1.5, fadeInSec: 1 });
  });

  it('同じ音を選び直したら文書はそのまま（取り消しが空振りしない）', () => {
    const d = audioDoc();
    const r = setClipAudioSource(d, 'clip_001', { bundledBgmId: 'summer-morning' });
    expect((r as { ok: true; doc: TimelineProject }).doc).toBe(d);
  });

  it('この動画が持っていない素材は選べない', () => {
    expect(setClipAudioSource(audioDoc(), 'clip_001', { assetId: 'asset_999' })).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  it('固定した列では選び直せない（ほかの編集と同じ扱い）', () => {
    const d = audioDoc();
    d.tracks[1].locked = true;
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
  });

  // ⚠️ **音を持たない部品は `notAudio`**（#795）＝以前はここも `contentField` を返しており、
  // **同じ文字の部品**に対して `setClipSpeed` は「音を持っていません」・こちらは「その項目がありません」と
  // **案内が割れていた**（ADR-0026②）。`15 §6` の区別（`CONTENT_FIELD` は**音はあるが**項目が無い）へ実装を寄せた。
  it('音を持たない部品には置けない（絵・文字の部品＝「音を持っていません」）', () => {
    const d = audioDoc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.text, text: 'あ' };
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.notAudio });
  });

  // ⚠️ **読み上げは音を持つが、音源は選べない**（文から作る）＝ここが本来の `contentField`。
  // 上のテストと対で「2つの断り方が別のものを指している」ことを固定する（片方だけでは区別が守れない）。
  it('読み上げの部品は「その項目がありません」（音は持っているが音源は選べない）', () => {
    const d = audioDoc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: NARRATION_STATUS.pending } };
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
  });

  it('**種別違いは固定より先に断る**（外しても直らない案内を出さない・#734 レビュー）', () => {
    const d = audioDoc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.text, text: 'あ' };
    d.tracks[1].locked = true; // 両方当てはまる状態
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.notAudio });
  });
});

describe('placeableVisualTracks（置ける列・#722）', () => {
  const d = (tracks: TimelineProject['tracks']): TimelineProject => doc({ tracks, clips: [] });

  it('手前が先で返す（配列の末尾が手前＝重ね順）', () => {
    const r = placeableVisualTracks(d([
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.visual },
    ]));
    expect(r.map((t) => t.id)).toEqual(['track_003', 'track_002', 'track_001']);
  });

  it('音の列・固定した列・隠した列は外す（置けても動画に出ない部品を作らない）', () => {
    const r = placeableVisualTracks(d([
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_003', kind: TRACK_KIND.visual, locked: true },
      { id: 'track_004', kind: TRACK_KIND.visual, hidden: true },
      { id: 'track_005', kind: TRACK_KIND.visual },
    ]));
    expect(r.map((t) => t.id)).toEqual(['track_005', 'track_001']);
  });

  it('置ける列が無ければ空（呼ぶ側が理由を出せる）', () => {
    expect(placeableVisualTracks(d([{ id: 'track_001', kind: TRACK_KIND.audio }]))).toEqual([]);
  });

  it('**`trackPlacementIssue` と食い違わない**（条件を片方だけ足せない）', () => {
    // ⚠️ このテストは「同じ規則から導かれている」ことを固定する（#722 レビュー）。
    // 条件を `trackPlacementIssue` に足せば両方へ効き、`placeableVisualTracks` 側だけ独自に
    // 足すと**ここで食い違う**＝「同じ判断を2通りに書かない」を主張だけで終わらせない。
    const doc2 = d([
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_003', kind: TRACK_KIND.visual, locked: true },
      { id: 'track_004', kind: TRACK_KIND.visual, hidden: true },
      { id: 'track_005', kind: TRACK_KIND.visual },
    ]);
    const fromIssue = doc2.tracks.filter((t) => trackPlacementIssue(doc2, t.id, TRACK_KIND.visual) == null).map((t) => t.id);
    const fromList = placeableVisualTracks(doc2).map((t) => t.id).reverse(); // 手前が先なので戻して比べる
    expect(fromList).toEqual(fromIssue);
  });

  it('理由は種類ごとに違うものを返す（次の行動が違うので真偽値に畳まない）', () => {
    const doc2 = d([
      { id: 'track_001', kind: TRACK_KIND.visual, locked: true },
      { id: 'track_002', kind: TRACK_KIND.visual, hidden: true },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ]);
    expect(trackPlacementIssue(doc2, 'track_001', TRACK_KIND.visual)).toBe(EDIT_BLOCKED.locked);
    expect(trackPlacementIssue(doc2, 'track_002', TRACK_KIND.visual)).toBe(EDIT_BLOCKED.hiddenTrack);
    expect(trackPlacementIssue(doc2, 'track_003', TRACK_KIND.visual)).toBe(EDIT_BLOCKED.trackKind);
    expect(trackPlacementIssue(doc2, 'track_999', TRACK_KIND.visual)).toBe(EDIT_BLOCKED.notFound);
  });

  it('音の列も**同じ規則・同じ向き**（種別で割らない・#724）', () => {
    const doc2 = d([
      { id: 'track_001', kind: TRACK_KIND.audio },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.audio, locked: true },
      { id: 'track_004', kind: TRACK_KIND.audio, hidden: true },
      { id: 'track_005', kind: TRACK_KIND.audio },
    ]);
    expect(placeableAudioTracks(doc2).map((t) => t.id)).toEqual(['track_005', 'track_001']); // 手前が先
    // 導出も映像側と同じ（条件を片方だけ足せない）。
    const fromIssue = doc2.tracks.filter((t) => trackPlacementIssue(doc2, t.id, TRACK_KIND.audio) == null).map((t) => t.id);
    expect(placeableAudioTracks(doc2).map((t) => t.id).reverse()).toEqual(fromIssue);
  });

  it('音・読み上げを置く側も**隠した列は断る**（数える側と断る側で規則が割れない・#724）', () => {
    const doc2 = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio, hidden: true }],
      clips: [],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'a.mp3' }],
    });
    // 手書きの判定だと `hidden` を見落とし、**置けても動画に出ない部品**が黙って生まれていた。
    expect(addAudioClip(doc2, { assetId: 'asset_001', trackId: 'track_002', startSec: 0 }))
      .toEqual({ ok: false, reason: EDIT_BLOCKED.hiddenTrack });
    expect(addVoiceClip(doc2, { text: '', trackId: 'track_002', startSec: 0 }))
      .toEqual({ ok: false, reason: EDIT_BLOCKED.hiddenTrack });
  });

  it('元の並びを壊さない（`reverse` が文書の列を並べ替えない）', () => {
    const doc = d([
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
    ]);
    placeableVisualTracks(doc);
    expect(doc.tracks.map((t) => t.id)).toEqual(['track_001', 'track_002']);
  });
});

// `null` = 継承（#731）。**`null` と未指定は解決が同じ**（CLAUDE.md §5）なので、
// 片方をもう片方へ書き換えても**絵は変わらないのに文書だけ変わる**＝取り消しが1段空振りする。
// `setClipAssetRef`（`11 §7.6.3`）が既にこの流儀なので、こちらも揃える。
describe('setVisualClipContent の null（継承）の扱い（#731）', () => {
  const textClip = (over: Partial<TimelineClip> = {}) =>
    doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over }] });

  it('未指定のフォントに「動画全体に合わせる」を選んでも、文書はそのまま（空振りしない）', () => {
    const d = textClip(); // fontId は未指定＝継承
    const r = setVisualClipContent(d, 'clip_001', { fontId: null });
    expect((r as { ok: true; doc: TimelineProject }).doc).toBe(d);
  });

  it('選んでいたフォントを「動画全体に合わせる」へ戻すと、キーごと落ちる（null を残さない）', () => {
    const d = textClip({ fontId: 'gen-interface-jp-display' });
    const r = setVisualClipContent(d, 'clip_001', { fontId: null });
    const c = (r as { ok: true; doc: TimelineProject }).doc.clips[0];
    expect('fontId' in c).toBe(false); // `null` を保存すると、未指定との違いが文書に残る
  });

  it('素材の「なし」も同じ扱い（未指定へ戻す・空振りしない）', () => {
    const withAsset = doc({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, assetId: 'asset_001' }],
    });
    const r = setVisualClipContent(withAsset, 'clip_001', { assetId: null });
    expect('assetId' in (r as { ok: true; doc: TimelineProject }).doc.clips[0]).toBe(false);
    // すでに「なし」のものへもう一度「なし」を選んでも、文書は動かない。
    const empty = doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10 }] });
    expect((setVisualClipContent(empty, 'clip_001', { assetId: null }) as { ok: true; doc: TimelineProject }).doc).toBe(empty);
  });

  it('値を入れる側は今までどおり（継承から実際のフォントへ）', () => {
    const d = textClip();
    const r = setVisualClipContent(d, 'clip_001', { fontId: 'gen-interface-jp-display' });
    expect((r as { ok: true; doc: TimelineProject }).doc.clips[0].fontId).toBe('gen-interface-jp-display');
  });
});

// ドラッグ中のゴーストと、離したときの結果が**同じ規則**を見る（#686・ADR-0034 決定10）。
describe('moveClipIssue / trimClipIssue（掴んでいる間の判定・#686）', () => {
  const twoClips = (over: Partial<TimelineProject> = {}) =>
    doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        clip('clip_001', { startSec: 0, durationSec: 3 }),
        clip('clip_002', { startSec: 5, durationSec: 3 }),
      ],
      ...over,
    });

  it('空いている所へは動かせる', () => {
    expect(moveClipIssue(twoClips(), 'clip_001', { startSec: 10 })).toBeNull();
  });

  it('自分の元の場所とは重ならない扱い（自分を避けて数える）', () => {
    expect(moveClipIssue(twoClips(), 'clip_001', { startSec: 0 })).toBeNull();
    expect(moveClipIssue(twoClips(), 'clip_001', { startSec: 1 })).toBeNull();
  });

  it('ほかの帯と重なる所は断る（寄せない＝決定10 の材料）', () => {
    expect(moveClipIssue(twoClips(), 'clip_001', { startSec: 4 })).toBe(EDIT_BLOCKED.overlap);
  });

  it('**離したときの結果と一致する**（見えていた色と違う結果にしない）', () => {
    const d = twoClips();
    for (const startSec of [0, 1, 4, 5, 10]) {
      const issue = moveClipIssue(d, 'clip_001', { startSec });
      const r = moveClip(d, 'clip_001', { startSec });
      expect(r.ok).toBe(issue === null);
      if (!r.ok) expect(r.reason).toBe(issue);
    }
  });

  it('固定した列の帯は動かせない', () => {
    const d = twoClips();
    d.tracks[0].locked = true;
    expect(moveClipIssue(d, 'clip_001', { startSec: 10 })).toBe(EDIT_BLOCKED.locked);
  });

  it('種別の合わない列へは動かせない（映像の部品を音の列へ）', () => {
    expect(moveClipIssue(twoClips(), 'clip_001', { trackId: 'track_002' })).toBe(EDIT_BLOCKED.trackKind);
  });

  it('端を縮めるのも同じ流儀（結果と一致する）', () => {
    const d = twoClips();
    for (const sec of [1, 2, 6]) {
      const issue = trimClipIssue(d, 'clip_001', 'end', sec);
      const r = trimClip(d, 'clip_001', 'end', sec);
      expect(r.ok).toBe(issue === null);
      if (!r.ok) expect(r.reason).toBe(issue);
    }
  });

  it('連動している字幕は時間を動かせない（列は変えられる）', () => {
    const d = twoClips();
    d.clips[0] = { ...d.clips[0], voiceClipId: 'clip_002' };
    expect(moveClipIssue(d, 'clip_001', { startSec: 10 })).toBe(EDIT_BLOCKED.linkedSubtitleTime);
    expect(trimClipIssue(d, 'clip_001', 'end', 2)).toBe(EDIT_BLOCKED.linkedSubtitleTime);
  });
});

// 掴んでいる間の色と、離したときの結果が割れないこと（#686 レビュー）。
// ⚠️ 判定を**書き写して**いたときは `withBoundSubtitles`（連動する字幕の置き場）が抜けていて、
// 読み上げの帯だけ「置ける色のまま断られる」状態だった。走らせて導く形なら構造的に割れない。
describe("moveClipIssue／trimClipIssue は操作そのものから導く（#686 レビュー）", () => {
  /** 読み上げ＋連動する字幕。字幕の隣を埋めて、字幕だけ置けない状況を作る。 */
  const linked = (): TimelineProject => doc({
    tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },
    ],
    clips: [
      { id: "v1", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } },
      { id: "s1", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: "v1" },
      { id: "blk", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "邪魔" },
    ],
  });

  it("連動する字幕の置き場が無いときは**掴んでいる間から**断る", () => {
    const doc = linked();
    // 読み上げを 4秒へ動かすと、連動する字幕が `blk`（3〜8秒）と重なる＝`moveClip` は断る。
    expect(moveClip(doc, "v1", { startSec: 4 }).ok).toBe(false);
    expect(moveClipIssue(doc, "v1", { startSec: 4 })).not.toBeNull(); // 色も同じ判断
  });

  it("端を縮めるときも同じ（結果と色が割れない）", () => {
    const doc = linked();
    const r = trimClip(doc, "v1", "end", 4);
    expect(trimClipIssue(doc, "v1", "end", 4) === null).toBe(r.ok);
  });
});

// 「出さない」列の扱いを、置くときと動かすときで揃える（#714-3）。
describe('隠した列（#714-3）', () => {
  const hidden = (): TimelineProject => doc({
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_009', kind: TRACK_KIND.visual, hidden: true },
    ],
    clips: [
      { id: 'a', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
      { id: 'h', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_009', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: 'い' },
    ],
  });

  it('隠した列へは**動かせない**（置くときは断るのに黙って移せた）', () => {
    const r = moveClip(hidden(), 'a', { trackId: 'track_009' });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.hiddenTrack);
  });

  it('置くときと同じ理由を返す（同じ状況で言うことが変わらない）', () => {
    const d = hidden();
    expect(visualPlacementIssue(d, { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_009', startSec: 5 }))
      .toBe(moveClipIssue(d, 'a', { trackId: 'track_009' }));
  });

  it('見た目パターンは隠した列へ**置けない**（新しく入れる側なので断る）', () => {
    // ⚠️ 3条件を手書きで並べていて `hidden` だけ抜けていた（画面が一覧を絞るので届いていなかっただけ）。
    const t = { templateId: 'tmpl_001', aspectRatio: '16:9' } as const;
    const r = addTemplateClip(hidden(), { trackId: 'track_009', startSec: 30, template: t });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.hiddenTrack);
  });

  it('複製も列の事情を見る（種別の違う列に載った帯を増やさない）', () => {
    // `locked` しか見ていなかったので、種別違いの列に載った帯は素通しで増えていた。
    const broken = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [{ id: 't', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
    });
    const r = duplicateClip(broken, 't');
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trackKind);
  });

  it('隠した列では**複製できない**（動画に出ない部品を新しく作らない）', () => {
    // ⚠️ `placementIssue` を通していたときは、免除が「行き先が元の列と同じ」しか見ないので
    // **複製は必ず免除**され、隠した列に黙って増えていた（自分で書いた規則と矛盾していた）。
    const r = duplicateClip(hidden(), 'h');
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.hiddenTrack);
  });

  it('もともと隠した列にある帯は**その列の中でなら動かせる**（行き止まりにしない）', () => {
    expect(moveClip(hidden(), 'h', { startSec: 5 }).ok).toBe(true);
    expect(trimClip(hidden(), 'h', 'end', 1).ok).toBe(true);
  });
});

// 置いた部品の位置・大きさ・向き（#685）。
describe('setClipBox（置いた部品を動かす）', () => {
  const canvas = { width: 1920, height: 1080 };
  const d = () => doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, text: 'あ' }] });

  it('**触った時点で箱ぜんぶ**を書き込む（見えている値を編集している状態を保つ）', () => {
    // ⚠️ `x` だけ足すと幅は画面いっぱいのままで右へはみ出す＝画面の数値と保存する値が食い違う。
    const r = setClipBox(d(), 'clip_001', canvas, { x: 100 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({ x: 100, y: 0, w: 1920, h: 1080, rotation: 0 });
  });

  it('大きさは 0 にできない（保存はできるが画面から消えて掴めなくなる）', () => {
    const r = setClipBox(d(), 'clip_001', canvas, { w: 0, h: -5 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({ w: MIN_BOX_SIZE_PX, h: MIN_BOX_SIZE_PX });
    // ⚠️ **schema にも通す**＝手書きの期待値だけだと、schema 側の下限と食い違っても気づけない
    // （適合しない文書は保存されない＝自動保存が黙って止まる）。
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('向きは 0〜360 未満へ**回り込ませる**（schema が拒むと自動保存が止まる）', () => {
    expect(setClipBox(d(), 'clip_001', canvas, { rotation: -10 })).toMatchObject({ doc: { clips: [{ rotation: 350 }] } });
    expect(setClipBox(d(), 'clip_001', canvas, { rotation: 360 })).toMatchObject({ doc: { clips: [{ rotation: 0 }] } });
    expect(setClipBox(d(), 'clip_001', canvas, { rotation: 725 })).toMatchObject({ doc: { clips: [{ rotation: 5 }] } });
    const back = setClipBox(d(), 'clip_001', canvas, { rotation: -10 });
    expect(back.ok && validateTimelineProject(back.doc)).toBe(true);
  });

  it('見た目パターンのクリップは断る（枠そのもの＝幾何は「バラす」で触る）', () => {
    const t = doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 0, durationSec: 2, templateId: 'tmpl_001' }] });
    expectBlocked(setClipBox(t, 'clip_001', canvas, { x: 10 }), EDIT_BLOCKED.contentField);
  });

  it('音の部品は断る（画面に出ないので位置が無い）', () => {
    const a = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 2, assetId: 'asset_001' }],
    });
    expectBlocked(setClipBox(a, 'clip_001', canvas, { x: 10 }), EDIT_BLOCKED.contentField);
  });

  it('固定した列では変えられない', () => {
    const l = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, text: 'あ' }],
    });
    expectBlocked(setClipBox(l, 'clip_001', canvas, { x: 10 }), EDIT_BLOCKED.locked);
  });

  it('まとめて変えるときは**1つでも置けなければ何もしない**（決定15）', () => {
    // ⚠️ 1件ずつ流すと、固定した列の部品だけ黙って取り残されて**群の形が崩れる**（理由も最後の1件ぶんだけ）。
    const two = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_009', kind: TRACK_KIND.visual, locked: true }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_009', startSec: 0, durationSec: 2, text: 'い' },
      ],
    });
    const r = setClipBoxes(two, canvas, [{ id: 'clip_001', patch: { x: 50 } }, { id: 'clip_002', patch: { x: 50 } }]);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.locked);
    expect(two.clips[0].x).toBeUndefined(); // 途中まで動いた文書を返さない
  });

  it('全部通るならまとめて変える', () => {
    const r = setClipBoxes(d(), canvas, [{ id: 'clip_001', patch: { x: 50, y: 60 } }]);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ x: 50, y: 60 });
  });

  it('何も変わらないなら**同じ文書**を返す（空振りの取り消しを積まない）', () => {
    const once = setClipBox(d(), 'clip_001', canvas, { x: 100 });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const again = setClipBox(once.doc, 'clip_001', canvas, { x: 100 });
    // ⚠️ **同一参照**で見る（中身の一致では、新しい文書を作っても通ってしまう＝取り消しが空振りする）。
    expect(again.ok && again.doc).toBe(once.doc);
  });
});

// 吸着で「ぴったり隣」にしたときに断られない（#686 段階4 レビュー 🔴）。
describe('接している端は重なりとみなさない', () => {
  it('丸めで数十兆分の1秒はみ出しても置ける（吸着が使い物にならなくなる）', () => {
    // ⚠️ 指の位置から出た時刻は15桁あるのに、長さは 1µs へ丸めて保存する（`applyClipEdge`）。
    // 隣の開始 4.166666666666667 へ終わりを吸着すると、丸めた長さは 4.166667 ＝
    // 終わりが 3.3e-7 秒だけはみ出す。許容が無いと**隣へ寄せるトリムの 44.5% が断られた**（実測）。
    const nbStart = 150 / 36;
    const d = doc({
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 1, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: nbStart, durationSec: 2, text: 'い' },
      ],
    });
    const r = trimClip(d, 'clip_001', 'end', nbStart);
    expect(r.ok).toBe(true);
    // 保存される長さは丸めたもの＝終わりは隣の開始をわずかに超えるが、**接していると見る**。
    expect(r.ok && r.doc.clips[0].durationSec).toBe(4.166667);
  });

  it('本当に重なるときは断る（許容を口実に重ねない）', () => {
    const d = doc({
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 1, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 5, durationSec: 2, text: 'い' },
      ],
    });
    expectBlocked(trimClip(d, 'clip_001', 'end', 5.001), EDIT_BLOCKED.overlap); // 1ミリ秒でも重なれば断る
  });
});

// まとめて動かす（#686 段階4・ADR-0034 決定15）。
describe('moveClips（まとめて動かす）', () => {
  const three = (over: Partial<TimelineProject> = {}) => doc({
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3, text: 'あ' },
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 5, durationSec: 3, text: 'い' },
      { id: 'clip_003', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 20, durationSec: 3, text: 'う' },
    ],
    ...over,
  });

  it('全部通るならまとめて動かす', () => {
    const r = moveClips(three(), [{ id: 'clip_001', startSec: 10 }, { id: 'clip_002', startSec: 15 }]);
    expect(r.ok && r.doc.clips.map((c) => c.startSec)).toEqual([10, 15, 20]);
  });

  // ⚠️ #787 レビュー（tests）＝**件数で理由が変わる境界**が未検証だった。1つなら「この列は固定」、
  // まとめてなら「選んだ中に固定がある」＝次の行動が違う（固定を外す／選び直す・#773）。
  it('固定した列の部品は、1つなら「この列」・まとめてなら「選んだ中」と言い分ける', () => {
    const d = three({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expect(moveClips(d, [{ id: 'clip_001', startSec: 10 }]))
      .toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(moveClips(d, [{ id: 'clip_001', startSec: 10 }, { id: 'clip_002', startSec: 15 }]))
      .toEqual({ ok: false, reason: EDIT_BLOCKED.lockedSelection });
  });

  it('**1つでも置けなければ全体を動かさない**（決定15）', () => {
    const r = moveClips(three(), [{ id: 'clip_001', startSec: 10 }, { id: 'clip_002', startSec: 20 }]);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it('**入れ替え**も通る（順に見ると途中で重なって断られる）', () => {
    // ⚠️ 1件ずつ `moveClip` を通すと、clip_001 を 5秒へ動かした時点で clip_002 と重なって断られる。
    // まとめて動かせば収まる形を、順番のせいで拒まない。
    const r = moveClips(three(), [{ id: 'clip_001', startSec: 5 }, { id: 'clip_002', startSec: 0 }]);
    expect(r.ok && r.doc.clips.map((c) => c.startSec)).toEqual([5, 0, 20]);
  });

  it('固定した列が混ざったら全体を断る（一部だけ動かさない）', () => {
    const d = three({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expect(moveClips(d, [{ id: 'clip_001', startSec: 10 }]).ok).toBe(false);
  });

  it('**連動している字幕は対象から外す**（混ざっただけで全体が動かせなくならない）', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'none' } },
        { id: 'clip_003', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_002' },
      ],
    });
    const r = moveClips(d, [{ id: 'clip_001', startSec: 10 }, { id: 'clip_003', startSec: 10 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips.find((c) => c.id === 'clip_001')!.startSec).toBe(10);
    expect(r.doc.clips.find((c) => c.id === 'clip_003')!.startSec).toBe(0); // 時間は読み上げが決める
  });

  it('**連動する字幕も同じ地図へ畳む**＝選択の順で結果が変わらない（`/canon-check`）', () => {
    // ⚠️ 後から1件ずつ当てると、**まだ動いていない別の字幕の旧位置**と衝突して断られる。
    // 読み上げ2本を選んで動かすのは、声を作る導線が字幕を自動で置く以上ふつうの操作。
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 3, durationSec: 2, voice: { text: 'い', status: 'none' } },
        { id: 'clip_003', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_001' },
        { id: 'clip_004', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_002' },
      ],
    });
    const up = [{ id: 'clip_001', startSec: 3 }, { id: 'clip_002', startSec: 6 }];
    const a = moveClips(d, up);
    const b = moveClips(d, [...up].reverse()); // **順を変えても同じ結果**
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.doc.clips.map((c) => c.startSec)).toEqual([3, 6, 3, 6]); // 字幕も付いてくる
    expect(b.doc.clips.map((c) => c.startSec)).toEqual(a.doc.clips.map((c) => c.startSec));
  });

  it('連動している字幕は**列だけ動かせる**（まとめても単体と同じ意味）', () => {
    const d = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_005', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_001' },
      ],
    });
    const r = moveClips(d, [{ id: 'clip_002', startSec: 10, trackId: 'track_005' }]);
    expect(r.ok && r.doc.clips[1]).toMatchObject({ trackId: 'track_005', startSec: 0 }); // 列は動く・時間は据え置き
  });

  it('字幕と**その連動先**を一緒に選んでも、字幕の列は変えられる（#754 再レビュー）', () => {
    // ⚠️ 連動の畳み込みで列まで上書きすると、**直接指定した列が元へ戻り**、
    // 「置ける色のまま離せるのに何も起きず、理由も出ない」になる。
    // 単体で選んだときは通るので、**選択の件数で同じ操作の意味が変わる**（ADR-0026②）。
    const d = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_005', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: 'clip_001' },
      ],
    });
    const r = moveClips(d, [
      { id: 'clip_002', startSec: 10, trackId: 'track_005' }, // 字幕を別の列へ
      { id: 'clip_001', startSec: 0 },                        // 連動先も選択に入っている
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sub = r.doc.clips.find((c) => c.id === 'clip_002')!;
    expect(sub.trackId).toBe('track_005'); // 列は利用者が決める
    expect(sub.startSec).toBe(0);          // 時間は読み上げが決める
  });

  it('何も変わらないなら**同じ文書**を返す（空振りの取り消しを積まない）', () => {
    const d = three();
    const r = moveClips(d, [{ id: 'clip_001', startSec: 0 }]);
    expect(r.ok && r.doc).toBe(d);
  });

  it('空なら何もしない', () => {
    const d = three();
    expect(moveClips(d, []).ok && moveClips(d, []) as { doc: TimelineProject }).toMatchObject({ doc: d });
  });
});

// まとめて長さをそろえる（#1005＝実機の指摘「帯を複数選択できるのに長さを一緒に調整できない」）。
describe('trimClips（まとめて長さをそろえる）', () => {
  const three = (over: Partial<TimelineProject> = {}) => doc({
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, text: 'あ' },
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 8, text: 'い' },
      { id: 'clip_003', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_003', startSec: 0, durationSec: 2, text: 'う' },
    ],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.visual },
    ],
    ...over,
  });

  it('選んだ全部の終わりを、同じ時刻へそろえる', () => {
    const r = trimClips(three(), ['clip_001', 'clip_002'], 'end', 5);
    expect(r.ok && r.doc.clips.map((c) => c.durationSec)).toEqual([5, 5, 2]);
  });

  it('始まりも同じ時刻へそろえる（置いた場所ごと動く）', () => {
    const r = trimClips(three(), ['clip_001', 'clip_002'], 'start', 3);
    expect(r.ok && r.doc.clips.map((c) => [c.startSec, c.durationSec])).toEqual([[3, 7], [3, 5], [0, 2]]);
  });

  // ⚠️ **ここで絞らない**＝この関数は数値の欄（「長さ（秒）」）からも通るので、
  // 「再生位置をまたいでいるか」で絞ると**長くする操作が黙って断られる**（伸ばす先は必ず帯の外）。
  // どれを相手にするかは押す側が決める（下の `trimTargetsAt`）。
  it('伸ばす向きも通る（数値の欄が通る道を塞がない）', () => {
    const r = trimClips(three(), ['clip_002', 'clip_003'], 'end', 12);
    expect(r.ok && r.doc.clips.map((c) => c.durationSec)).toEqual([10, 12, 12]);
  });

  // ⚠️ **1件のときは今までどおり**＝理由の言い分けも `moveClips` と同じ（「この列」／「選んだ中」）。
  it('1件なら trimClip と同じ結果になる（入口が増えても挙動を割らない）', () => {
    const d = three();
    expect(trimClips(d, ['clip_001'], 'end', 5)).toEqual(trimClip(d, 'clip_001', 'end', 5));
  });

  it('固定した列は、1つなら「この列」・まとめてなら「選んだ中」と言い分ける', () => {
    const locked = three({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual, locked: true },
        { id: 'track_002', kind: TRACK_KIND.visual, locked: true },
        { id: 'track_003', kind: TRACK_KIND.visual },
      ],
    });
    expect(trimClips(locked, ['clip_001'], 'end', 5)).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(trimClips(locked, ['clip_001', 'clip_002'], 'end', 5)).toEqual({ ok: false, reason: EDIT_BLOCKED.lockedSelection });
  });

  it('固定が混ざったら、当て始める前に断る（一部だけ変わった結果を作らない）', () => {
    const locked = three({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual, locked: true },
      ],
    });
    expect(trimClips(locked, ['clip_001', 'clip_003'], 'end', 5)).toEqual({ ok: false, reason: EDIT_BLOCKED.lockedSelection });
  });

  // ⚠️ **自分で書いた「1つでも通らなければ全体を変えない」を検査にする**（変異チェックで生き残った）＝
  // 途中で断ったのに、そこまで当てた文書を返す形が緑のままだった。
  it('1つが置けなければ、先に通ったぶんも戻す（半分だけ変わった状態を残さない）', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, text: 'あ' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 3, text: 'い' },
        { id: 'clip_003', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 6, durationSec: 3, text: 'う' }, // clip_002 の伸ばす先
      ],
    });
    // clip_001 は 8 秒へ縮められるが、clip_002 を 8 秒まで伸ばすと clip_003 と重なる。
    const r = trimClips(d, ['clip_001', 'clip_002'], 'end', 8);
    expect(r).toEqual({ ok: false, reason: EDIT_BLOCKED.overlap });
  });

  // ⚠️ **連動している字幕は前もって弾いていない**＝`trimClip` の中で断る。
  // 途中で握り潰すと、**字幕だけ元の区間に取り残される**（`11 §7.6.2.3` の「連動＝区間が一致」が崩れる）。
  it('連動している字幕が混ざったら、全体を断る', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 10, voice: { text: 'あ', status: NARRATION_STATUS.none } },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 0, durationSec: 10, voiceClipId: 'clip_001' },
      ],
    });
    expect(trimClips(d, ['clip_002', 'clip_001'], 'end', 5)).toEqual({ ok: false, reason: EDIT_BLOCKED.linkedSubtitleTime });
  });

  it('見つからない部品が混ざったら断る（残りだけ変えない）', () => {
    expect(trimClips(three(), ['clip_001', 'clip_999'], 'end', 5)).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  it('何も選んでいなければ、そのままの文書を返す（履歴に積まない）', () => {
    const d = three();
    const r = trimClips(d, [], 'end', 5);
    expect(r.ok && r.doc).toBe(d);
  });
});

describe('trimTargetsAt（実際に長さが変わる部品）', () => {
  const d = doc({
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, text: 'あ' },
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 20, durationSec: 5, text: 'い' },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
  });

  it('その時刻が中にかかっているものだけを返す', () => {
    expect(trimTargetsAt(d, ['clip_001', 'clip_002'], 5)).toEqual(['clip_001']);
  });

  // ⚠️ **端はまたいでいない**＝端で切ると長さ0か、何も変わらない（どちらも操作の意味が無い）。
  it('端ちょうどは数えない', () => {
    expect(trimTargetsAt(d, ['clip_001'], 0)).toEqual([]);
    expect(trimTargetsAt(d, ['clip_001'], 10)).toEqual([]);
  });

  it('見つからない id は数えない（ボタンの数が実際より多くならない）', () => {
    expect(trimTargetsAt(d, ['clip_999'], 5)).toEqual([]);
  });
});
