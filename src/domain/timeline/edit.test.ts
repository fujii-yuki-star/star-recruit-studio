// タイムライン形式の編集操作（ADR-0032・#629）。置けないときに黙って別の結果にしないことを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import {
  addAudioClip, addVoiceClip, addTrack, clipCountOnTrack, duplicateClip, EDIT_BLOCKED, isFreeSpan,
  addTemplateClip, addVisualClip, firstFreeStart, setVisualClipContent, moveClip, visualPlacementIssue, moveTrackOrder, removeClips, removeSelectedClipsChecked, moveClipIssue, trimClipIssue, removeTrack, placeableAudioTracks, placeableVisualTracks, setClipAssetRef, setClipAudioSource, setClipText, setTrackFlag, trackPlacementIssue, trimClip,
} from './edit';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { TIMELINE_MIN_CLIP_SEC } from '../constants';
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
    expect(removeSelectedClipsChecked(d, ['clip_001'])).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(removeSelectedClipsChecked(d, ['clip_001', 'clip_002'])).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
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

  it('音を持たない部品には置けない（読み上げ・絵の部品）', () => {
    const d = audioDoc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.text, text: 'あ' };
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
  });

  it('**種別違いは固定より先に断る**（外しても直らない案内を出さない・#734 レビュー）', () => {
    const d = audioDoc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.text, text: 'あ' };
    d.tracks[1].locked = true; // 両方当てはまる状態
    expect(setClipAudioSource(d, 'clip_001', { assetId: 'asset_001' })).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
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

  it('もともと隠した列にある帯は**その列の中でなら動かせる**（行き止まりにしない）', () => {
    expect(moveClip(hidden(), 'h', { startSec: 5 }).ok).toBe(true);
    expect(trimClip(hidden(), 'h', 'end', 1).ok).toBe(true);
  });
});
