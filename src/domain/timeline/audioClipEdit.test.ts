// 音のクリップの編集（速さ・トリム・音量・フェード／音を置く）＝#634 の「中位」。
import { describe, expect, it } from 'vitest';
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN, VOLUME_MAX } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';
import { addAudioClip, EDIT_BLOCKED, setClipAssetRef, setClipSlotAudio, setVisualClipContent, setClipFade, setClipOriginalAudioVolume, setClipSourceStart, setClipSpeed, setClipUseOriginalAudio, setClipVolume } from './edit';
import { timelineAudioRuns } from './export';
import { audioCuesAt } from './audio';
import { validateTimelineProject } from '../validation/generated/validators.js';

const bgm = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001',
  kind: TIMELINE_CLIP_KIND.audio,
  trackId: 'track_002',
  startSec: 0,
  durationSec: 10,
  bundledBgmId: 'found-new-hope',
  ...over,
});

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260730_001',
    projectName: 'テスト',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [bgm()],
    ...over,
  };
}

describe('addAudioClip', () => {
  it('同梱BGMを音の列へ置ける', () => {
    const r = addAudioClip(doc({ clips: [] }), { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 3 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 3,
    });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('持ち込んだ音の素材も置ける', () => {
    const d = doc({
      clips: [],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
    });
    const r = addAudioClip(d, { assetId: 'asset_001', trackId: 'track_002', startSec: 0 });
    expect(r.ok && r.doc.clips[0].assetId).toBe('asset_001');
  });

  it('無い素材は置けない', () => {
    const r = addAudioClip(doc({ clips: [] }), { assetId: 'asset_999', trackId: 'track_002', startSec: 0 });
    expect(r.ok).toBe(false);
  });

  it('音の出どころを2つ渡したら置かない（黙って一方を選ばない）', () => {
    const d = doc({ clips: [], assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'a.mp3' }] });
    expect(addAudioClip(d, { bundledBgmId: 'summer-morning', assetId: 'asset_001', trackId: 'track_002', startSec: 0 }).ok).toBe(false);
    expect(addAudioClip(d, { trackId: 'track_002', startSec: 0 }).ok).toBe(false);
  });

  it('映像の列・固定した列・重なる場所には置けない', () => {
    const d = doc({ clips: [] });
    expect(addAudioClip(d, { bundledBgmId: 'summer-morning', trackId: 'track_001', startSec: 0 }).ok).toBe(false);
    const locked = doc({ clips: [], tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, locked: true }] });
    expect(addAudioClip(locked, { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 0 }).ok).toBe(false);
    const r = addAudioClip(doc(), { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });
});

describe('setClipSpeed', () => {
  it('速さを変えても長さは変わらない（素材のどれだけを流すかが変わる）', () => {
    const r = setClipSpeed(doc(), 'clip_001', 2);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ speed: 2, durationSec: 10 });
  });

  it('等速に戻すと値を持たない（既定と同じ値を書かない）', () => {
    const a = setClipSpeed(doc(), 'clip_001', 2);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipSpeed(a.doc, 'clip_001', 1);
    expect(r.ok && r.doc.clips[0].speed).toBeUndefined();
  });

  it('範囲へ収める（0 以下は保存できない文書になる）', () => {
    const slow = setClipSpeed(doc(), 'clip_001', 0);
    expect(slow.ok && slow.doc.clips[0].speed).toBe(CLIP_SPEED_MIN);
    expect(slow.ok && validateTimelineProject(slow.doc)).toBe(true);
    const fast = setClipSpeed(doc(), 'clip_001', 99);
    expect(fast.ok && fast.doc.clips[0].speed).toBe(CLIP_SPEED_MAX);
  });

  it('同じ値なら文書は変わらない', () => {
    const d = doc();
    const same = setClipSpeed(d, 'clip_001', 1);
    expect(same.ok && same.doc).toBe(d);
  });

  it('再生と書き出しの両方へ同じ値が渡る（聞いた音と書き出した音が一致する）', () => {
    const r = setClipSpeed(doc(), 'clip_001', 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(audioCuesAt(r.doc, 1)[0].speed).toBe(2);
    expect(timelineAudioRuns(r.doc).runs[0].speed).toBe(2);
  });

  it('固定した列では変えられない', () => {
    const d = doc({ tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, locked: true }] });
    const r = setClipSpeed(d, 'clip_001', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('setClipSourceStart', () => {
  it('素材の途中から使える（再生の頭出しと書き出しの切り出しに同じ値が渡る）', () => {
    const r = setClipSourceStart(doc(), 'clip_001', 30);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(30);
    if (!r.ok) return;
    expect(audioCuesAt(r.doc, 0)[0].offsetSec).toBe(30);
    expect(timelineAudioRuns(r.doc).runs[0].sourceStartSec).toBe(30);
  });

  it('0 に戻すと値を持たない／負にはしない', () => {
    const a = setClipSourceStart(doc(), 'clip_001', 30);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const back = setClipSourceStart(a.doc, 'clip_001', 0);
    expect(back.ok && back.doc.clips[0].sourceStartSec).toBeUndefined();
    const neg = setClipSourceStart(doc(), 'clip_001', -5);
    expect(neg.ok && neg.doc.clips[0].sourceStartSec).toBeUndefined();
  });
});

describe('setClipVolume / setClipFade', () => {
  it('音量を変えられる（範囲へ収める）', () => {
    const r = setClipVolume(doc(), 'clip_001', 9);
    expect(r.ok && r.doc.clips[0].volume).toBe(VOLUME_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('null で「動画全体に合わせる」へ戻せる（継承）', () => {
    const a = setClipVolume(doc(), 'clip_001', 0.8);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipVolume(a.doc, 'clip_001', null);
    expect(r.ok && r.doc.clips[0].volume).toBeUndefined();
    // 継承＝BGM の既定音量で鳴る。
    expect(r.ok && audioCuesAt(r.doc, 1)[0].volume).toBeCloseTo(0.25);
  });

  it('フェードを前後それぞれ付けられる（0 で外れる）', () => {
    const a = setClipFade(doc(), 'clip_001', 'in', 2);
    expect(a.ok && a.doc.clips[0].fadeInSec).toBe(2);
    if (!a.ok) return;
    const b = setClipFade(a.doc, 'clip_001', 'out', 3);
    expect(b.ok && b.doc.clips[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 3 });
    if (!b.ok) return;
    const off = setClipFade(b.doc, 'clip_001', 'in', 0);
    expect(off.ok && off.doc.clips[0].fadeInSec).toBeUndefined();
  });

  it('フェードは書き出しでも尺の半分までに切り詰められる（再生と同じ規則）', () => {
    const r = setClipFade(doc({ clips: [bgm({ durationSec: 2 })] }), 'clip_001', 'in', 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(timelineAudioRuns(r.doc).runs[0].fadeInSec).toBe(1);
  });
});

// 動画の**元の音**（#512 段2）。音のクリップの設定とは別物なので、断り方も別に持つ。
describe('setClipUseOriginalAudio / setClipOriginalAudioVolume', () => {
  const videoDoc = (over: Partial<TimelineClip> = {}, hasAudio: boolean | undefined = true): TimelineProject =>
    doc({
      assets: [{
        assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4',
        ...(hasAudio == null ? {} : { metadata: { hasAudio } }),
      }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_v', ...over,
      } as TimelineClip],
    } as Partial<TimelineProject>);

  it('鳴らす・やめるを切り替えられる（やめたらキーごと落とす）', () => {
    const on = setClipUseOriginalAudio(videoDoc(), 'clip_001', true);
    expect(on.ok && on.doc.clips[0].useOriginalAudio).toBe(true);
    expect(on.ok && validateTimelineProject(on.doc)).toBe(true);
    if (!on.ok) return;
    const off = setClipUseOriginalAudio(on.doc, 'clip_001', false);
    // 既定と同じ値は書かない（他の編集操作と同じ規則）。
    expect(off.ok && off.doc.clips[0].useOriginalAudio).toBeUndefined();
  });

  it('音量を変えられ、null で標準へ戻せる', () => {
    const a = setClipOriginalAudioVolume(videoDoc(), 'clip_001', 0.9);
    expect(a.ok && a.doc.clips[0].originalAudioVolume).toBe(0.9);
    expect(a.ok && validateTimelineProject(a.doc)).toBe(true);
    if (!a.ok) return;
    const b = setClipOriginalAudioVolume(a.doc, 'clip_001', null);
    expect(b.ok && b.doc.clips[0].originalAudioVolume).toBeUndefined();
  });

  it('音量は保存できる範囲へ収める（schema の上限と同じ）', () => {
    const r = setClipOriginalAudioVolume(videoDoc(), 'clip_001', 9);
    expect(r.ok && r.doc.clips[0].originalAudioVolume).toBe(VOLUME_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  // ⚠️ **音の部品の断り（`notAudio`）を流用しない**＝「音や読み上げの部品で変えてください」は
  // 動画の話をしていないので、従っても直らない（§2-5）。
  it('音の入っていない動画では、動画むけの理由で断る', () => {
    const r = setClipUseOriginalAudio(videoDoc({}, false), 'clip_001', true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
    expect(!r.ok && r.reason).not.toBe(EDIT_BLOCKED.notAudio);
  });

  it('動画ではない部品でも、動画むけの理由で断る', () => {
    const r = setClipUseOriginalAudio(doc(), 'clip_001', true); // 既定の文書は BGM
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
  });

  it('固定した列では変えられない', () => {
    const d = videoDoc();
    const locked = { ...d, tracks: d.tracks.map((t) => (t.id === 'track_001' ? { ...t, locked: true } : t)) };
    expect(setClipUseOriginalAudio(locked, 'clip_001', true).ok).toBe(false);
    const r = setClipOriginalAudioVolume(locked, 'clip_001', 0.5);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });

  // ⚠️ **素材を差し替えたら設定は落とす**（レビュー ℹ️）＝残すと、写真へ替えて欄が消えている間に
  // 設定だけ生き残り、別の音入り動画を入れた瞬間に**頼んでいない音が鳴り出す**。
  it('素材を差し替えると、元の音の設定は落ちる', () => {
    const d = {
      ...videoDoc({ useOriginalAudio: true, originalAudioVolume: 0.9 }),
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_w', assetType: 'video', displayName: '別の動画', filePath: 'w.mp4', metadata: { hasAudio: true } },
      ],
    } as TimelineProject;
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_w' });
    expect(r.ok && r.doc.clips[0].assetId).toBe('asset_w');
    expect(r.ok && r.doc.clips[0].useOriginalAudio).toBeUndefined();
    expect(r.ok && r.doc.clips[0].originalAudioVolume).toBeUndefined();
  });

  // ⚠️ **切り出す位置・速さも落ちる**（#816-3）＝分ける・バラすで付くので、置いた覚えが無くても
  // 付いている（しかも直す欄が画面に無い）。残すと新しい素材が**頼んでいない位置から・頼んでいない
  // 速さ**で流れる。差し込み口（`setClipAssetRef`）は `slotClips[layerId]` を丸ごと落としており、
  // こちらだけ音の2つに絞ると**同じ動画が置き場所で挙動を割る**（ADR-0026②）。
  it('素材を差し替えると、切り出す位置と速さも落ちる', () => {
    const d = {
      ...videoDoc({ sourceStartSec: 5, speed: 2, useOriginalAudio: true }),
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_w', assetType: 'video', displayName: '別の動画', filePath: 'w.mp4', metadata: { hasAudio: true } },
      ],
    } as TimelineProject;
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_w' });
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBeUndefined();
    expect(r.ok && r.doc.clips[0].speed).toBeUndefined();
  });

  it('同じ素材を置き直しただけなら、切り出す位置と速さは残る', () => {
    const d = videoDoc({ sourceStartSec: 5, speed: 2 });
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_v', fit: 'contain' });
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(5);
    expect(r.ok && r.doc.clips[0].speed).toBe(2);
  });

  it('同じ素材を置き直しただけなら、元の音の設定は残る', () => {
    const d = videoDoc({ useOriginalAudio: true });
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_v', fit: 'contain' });
    expect(r.ok && r.doc.clips[0].useOriginalAudio).toBe(true);
  });

  // ⚠️ **何も変わらない操作は同じ文書を返す**（取り消しに空の1手を積まない＝他の操作と同じ規則）。
  it('同じ値を置き直しても文書は変わらない', () => {
    const d = videoDoc({ useOriginalAudio: true, originalAudioVolume: 0.5 });
    const a = setClipUseOriginalAudio(d, 'clip_001', true);
    expect(a.ok && a.doc).toBe(d);
    const b = setClipOriginalAudioVolume(d, 'clip_001', 0.5);
    expect(b.ok && b.doc).toBe(d);
  });
});

// 差し込み口ごとの元の音（#512 段3b）＝値は `slotClips[layerId]` へ（場面形式と同じ語彙・schema 不変）。
describe('setClipSlotAudio', () => {
  // ⚠️ **見た目パターンが要る**（`/canon-check` 🔴）＝どの枠が動画を受けるか・立ち絵に動画が入って
  // いるかは見た目が決めるので、素材の解決は `videoPlacementsOfClip` を通す（画面が欄を出す条件と同じ述語）。
  const template = {
    schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'main', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
      { id: 'sub', type: 'slot', x: 960, y: 0, w: 960, h: 1080 },
      { id: 'chara', type: 'character', x: 1200, y: 200, w: 400, h: 800 },
    ],
  } as unknown as Template;
  const opts = { templateOf: () => template };
  // ⚠️ `null` で「調べられていない」を表す（`undefined` は既定引数に吸われて `true` になる）。
  const tmplDoc = (over: Partial<TimelineClip> = {}, hasAudio: boolean | null = true): TimelineProject =>
    doc({
      assets: [{
        assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4',
        ...(hasAudio == null ? {} : { metadata: { hasAudio } }),
      }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, templateId: 'tmpl_001', assetRefs: { main: 'asset_v' }, ...over,
      } as TimelineClip],
    } as Partial<TimelineProject>);

  it('その枠だけに置く（ほかの枠の設定を触らない）', () => {
    const d = tmplDoc({ assetRefs: { main: 'asset_v', sub: 'asset_v' }, slotClips: { sub: { speed: 2 } } });
    const r = setClipSlotAudio(d, 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(r.ok && r.doc.clips[0].slotClips).toEqual({ sub: { speed: 2 }, main: { useOriginalAudio: true } });
  });

  // ⚠️ **既定と同じ値は書かない**＝空の入れ物を文書に残さない（他の編集操作と同じ規則）。
  it('鳴らすのをやめると、キーごと落ちる（空になった枠の項目も落とす）', () => {
    const on = setClipSlotAudio(tmplDoc(), 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const off = setClipSlotAudio(on.doc, 'clip_001', 'main', { useOriginalAudio: false }, opts);
    expect(off.ok && off.doc.clips[0].slotClips).toBeUndefined();
  });

  // ⚠️ **落とすのは対象の枠だけ**＝ほかの枠の設定が残っていれば、入れ物ごと消してはいけない。
  it('ほかの枠の設定が残っていれば、入れ物は消さずにその枠だけ落とす', () => {
    const d = tmplDoc({
      assetRefs: { main: 'asset_v', sub: 'asset_v' },
      slotClips: { main: { useOriginalAudio: true }, sub: { speed: 2 } },
    });
    const r = setClipSlotAudio(d, 'clip_001', 'main', { useOriginalAudio: false }, opts);
    expect(r.ok && r.doc.clips[0].slotClips).toEqual({ sub: { speed: 2 } });
  });

  it('ほかの設定が残っていれば、枠の項目は残る', () => {
    const d = tmplDoc({ slotClips: { main: { speed: 2, useOriginalAudio: true } } });
    const r = setClipSlotAudio(d, 'clip_001', 'main', { useOriginalAudio: false }, opts);
    expect(r.ok && r.doc.clips[0].slotClips).toEqual({ main: { speed: 2 } });
  });

  it('音量を置ける・null で標準へ戻せる・範囲へ収める', () => {
    const a = setClipSlotAudio(tmplDoc(), 'clip_001', 'main', { originalAudioVolume: 0.9 }, opts);
    expect(a.ok && a.doc.clips[0].slotClips).toEqual({ main: { originalAudioVolume: 0.9 } });
    if (!a.ok) return;
    const b = setClipSlotAudio(a.doc, 'clip_001', 'main', { originalAudioVolume: null }, opts);
    expect(b.ok && b.doc.clips[0].slotClips).toBeUndefined();
    const c = setClipSlotAudio(tmplDoc(), 'clip_001', 'main', { originalAudioVolume: 9 }, opts);
    expect(c.ok && c.doc.clips[0].slotClips).toEqual({ main: { originalAudioVolume: VOLUME_MAX } });
  });

  // ⚠️ **音の入っていない動画・動画でない素材の枠では断る**（動画むけの理由で・§2-5）。
  it('音の入っていない枠・写真の枠では断る', () => {
    const noAudio = setClipSlotAudio(tmplDoc({}, false), 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(!noAudio.ok && noAudio.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
    const unknown = setClipSlotAudio(tmplDoc({}, null), 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(!unknown.ok && unknown.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
    const empty = setClipSlotAudio(tmplDoc({ assetRefs: {} }), 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(!empty.ok && empty.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
  });

  it('固定した列では変えられない', () => {
    const d = tmplDoc();
    const locked = { ...d, tracks: d.tracks.map((t) => (t.id === 'track_001' ? { ...t, locked: true } : t)) };
    const r = setClipSlotAudio(locked, 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });

  it('同じ値を置き直しても文書は変わらない（空の取り消しを積まない）', () => {
    const d = tmplDoc({ slotClips: { main: { useOriginalAudio: true } } });
    const r = setClipSlotAudio(d, 'clip_001', 'main', { useOriginalAudio: true }, opts);
    expect(r.ok && r.doc).toBe(d);
  });

  // ⚠️ **素材既定（`asset.clip`）を覆せる**（レビュー 🔴）＝解決は `slotClips ?? asset.clip ?? 既定`
  // なので、素材側が「鳴らす」のときキーを消すだけでは止まらない（消すと継承へ戻って鳴り続ける）。
  describe('素材既定を継承しているとき', () => {
    /** 素材側で「元の音を使う」が ON になっている動画（焼き出した文書が持ちうる形）。 */
    const inherited = (over: Partial<TimelineClip> = {}): TimelineProject =>
      doc({
        assets: [{
          assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4',
          metadata: { hasAudio: true }, clip: { useOriginalAudio: true, originalAudioVolume: 0.8 },
        }],
        clips: [{
          id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
          startSec: 0, durationSec: 10, templateId: 'tmpl_001', assetRefs: { main: 'asset_v' }, ...over,
        } as TimelineClip],
      } as Partial<TimelineProject>);

    it('チェックを外すと、明示的に「鳴らさない」を保存する', () => {
      const r = setClipSlotAudio(inherited(), 'clip_001', 'main', { useOriginalAudio: false }, opts);
      expect(r.ok && r.doc.clips[0].slotClips).toEqual({ main: { useOriginalAudio: false } });
    });

    it('チェックを入れ直すと、継承へ戻す（同じ値は書かない）', () => {
      const off = setClipSlotAudio(inherited(), 'clip_001', 'main', { useOriginalAudio: false }, opts);
      expect(off.ok).toBe(true);
      if (!off.ok) return;
      const on = setClipSlotAudio(off.doc, 'clip_001', 'main', { useOriginalAudio: true }, opts);
      expect(on.ok && on.doc.clips[0].slotClips).toBeUndefined();
    });

    // 素材側が OFF のときは、これまでどおり「鳴らす」だけを書く（既定と同じ値は書かない）。
    it('素材既定が OFF なら、鳴らさないはキーごと落ちる', () => {
      const d = tmplDoc();
      const on = setClipSlotAudio(d, 'clip_001', 'main', { useOriginalAudio: true }, opts);
      expect(on.ok).toBe(true);
      if (!on.ok) return;
      const off = setClipSlotAudio(on.doc, 'clip_001', 'main', { useOriginalAudio: false }, opts);
      expect(off.ok && off.doc.clips[0].slotClips).toBeUndefined();
    });
  });
  // ⚠️ **立ち絵に入れた動画でも書き込みが通る**（`/canon-check` 🔴・#809）＝素材は
  // `character.poseAssetId` にあり `assetRefs[層 id]` は誰も書かないので、`assetRefs` だけを見ていると
  // **欄は出るのに押すと毎回断られ**、しかも理由は「音が入っていない」＝事実と違う（§2-5）。
  // 値の置き場も解決も差し込み口と共有（`slotClips[層 id]`／`resolveSlotClip`）なので、書く側だけ別にしない。
  describe('立ち絵に入れた動画（#809）', () => {
    const charDoc = (over: Partial<TimelineClip> = {}): TimelineProject => doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, templateId: 'tmpl_001',
        character: { characterId: 'yuko', poseAssetId: 'asset_v' }, ...over,
      } as TimelineClip],
    } as Partial<TimelineProject>);

    it('元の音を鳴らす設定が立ち絵の層に載る（差し込み口と同じ入れ物）', () => {
      const r = setClipSlotAudio(charDoc(), 'clip_001', 'chara', { useOriginalAudio: true }, opts);
      expect(r.ok && r.doc.clips[0].slotClips).toEqual({ chara: { useOriginalAudio: true } });
    });

    it('音量も置ける', () => {
      const r = setClipSlotAudio(charDoc(), 'clip_001', 'chara', { originalAudioVolume: 0.4 }, opts);
      expect(r.ok && r.doc.clips[0].slotClips).toEqual({ chara: { originalAudioVolume: 0.4 } });
    });

    // ⚠️ **見た目パターンが無いと置き場所が作れない**＝断る（黙って別の場所へ書かない）。
    it('見た目パターンを渡さないと断る', () => {
      const r = setClipSlotAudio(charDoc(), 'clip_001', 'chara', { useOriginalAudio: true });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
    });
  });

});

// 差し込み口の素材を差し替えたときの後始末（#512 段3b レビュー 🔴）。
describe('setClipAssetRef の後始末', () => {
  const withUse = (): TimelineProject =>
    doc({
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '動画1', filePath: 'v.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_w', assetType: 'video', displayName: '動画2', filePath: 'w.mp4', metadata: { hasAudio: true } },
      ],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, templateId: 'tmpl_001',
        assetRefs: { main: 'asset_v', sub: 'asset_v' },
        slotClips: { main: { useOriginalAudio: true, startSec: 3, speed: 2 }, sub: { useOriginalAudio: true } },
      } as TimelineClip],
    } as Partial<TimelineProject>);

  // ⚠️ **頼んでいない音が鳴り出さない**＝別の動画を入れた瞬間に前の設定が効く、を作らない。
  it('素材を差し替えたら、その枠の使い方（元の音・範囲・速さ）は落とす', () => {
    const r = setClipAssetRef(withUse(), 'clip_001', 'main', 'asset_w');
    expect(r.ok && r.doc.clips[0].slotClips).toEqual({ sub: { useOriginalAudio: true } }); // 触っていない枠は残る
  });

  it('「なし」にしたときも落とす', () => {
    const r = setClipAssetRef(withUse(), 'clip_001', 'main', null);
    expect(r.ok && r.doc.clips[0].slotClips).toEqual({ sub: { useOriginalAudio: true } });
  });

  it('同じ素材を選び直しただけなら、何も変わらない', () => {
    const d = withUse();
    const r = setClipAssetRef(d, 'clip_001', 'main', 'asset_v');
    expect(r.ok && r.doc).toBe(d);
  });
});

// 直接置いた動画にも「速さ」「素材の使い始め」がある（#1019 ⑦）。
//
// ⚠️ **持てるのに触れなかった**＝`videoPlacementsOfClip` は直接置きで `sourceStartSec`／`speed` を
// **読んで**いるのに、書く側は `kind === 'audio'` で断っていた。しかも `splitClip`／
// `explodeTemplateClip` は**その値を書く**ので、**置いた覚えのない頭出し・速さが付いた部品**ができ、
// 見ることも直すことも既定へ戻すこともできなかった（§2-5・ADR-0026④）。
describe('直接置いた動画の速さ・素材の使い始め（#1019 ⑦）', () => {
  const videoDoc = (over: Partial<TimelineClip> = {}): TimelineProject =>
    doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_v', ...over,
      } as TimelineClip],
    } as Partial<TimelineProject>);

  it('速さを変えられる（等速は持たない）', () => {
    const r = setClipSpeed(videoDoc(), 'clip_001', 2);
    expect(r.ok && r.doc.clips[0].speed).toBe(2);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
    if (!r.ok) return;
    const back = setClipSpeed(r.doc, 'clip_001', 1);
    expect(back.ok && back.doc.clips[0].speed).toBeUndefined();
  });

  it('素材の使い始めを変えられる（0 は持たない）', () => {
    const r = setClipSourceStart(videoDoc(), 'clip_001', 5);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(5);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
    if (!r.ok) return;
    const back = setClipSourceStart(r.doc, 'clip_001', 0);
    expect(back.ok && back.doc.clips[0].sourceStartSec).toBeUndefined();
  });

  // ⚠️ **分ける・バラすで付いた値を、既定へ戻せる**（#1019 ⑦の実害）。
  it('置いた覚えのない値を、既定へ戻せる', () => {
    const r = setClipSourceStart(videoDoc({ sourceStartSec: 5, speed: 2 }), 'clip_001', 0);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBeUndefined();
  });

  it('保存できる範囲へ収める（速さの上下限・使い始めは負にしない）', () => {
    const hi = setClipSpeed(videoDoc(), 'clip_001', 99);
    expect(hi.ok && hi.doc.clips[0].speed).toBe(CLIP_SPEED_MAX);
    expect(hi.ok && validateTimelineProject(hi.doc)).toBe(true);
    const lo = setClipSpeed(videoDoc(), 'clip_001', -1);
    expect(lo.ok && lo.doc.clips[0].speed).toBe(CLIP_SPEED_MIN);
    const neg = setClipSourceStart(videoDoc(), 'clip_001', -3);
    expect(neg.ok && neg.doc.clips[0].sourceStartSec).toBeUndefined();
  });

  // ⚠️ **写真の差し込み口には出さない**＝動かない絵に「速さ」は意味が無い。
  it('写真の部品は断る（音の理由を流用しない）', () => {
    const d = doc({
      assets: [{ assetId: 'asset_p', assetType: 'image', displayName: '外観', filePath: 'p.png' }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_p',
      } as TimelineClip],
    } as Partial<TimelineProject>);
    const r = setClipSpeed(d, 'clip_001', 2);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.notPlayable);
    // 「音や読み上げの部品で変えてください」は動画の話をしていない＝流用しない（§2-5）。
    expect(!r.ok && r.reason).not.toBe(EDIT_BLOCKED.notAudio);
  });

  // ⚠️ **読み上げは断ったまま**＝長さは声の実尺で決まっており、速さを変えると
  //   連動している字幕の区間も意味を失う（決定24）。
  it('読み上げは断ったまま（この項目が無い、と言う）', () => {
    const d = doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002',
        startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'none' },
      } as unknown as TimelineClip],
    } as Partial<TimelineProject>);
    const r = setClipSpeed(d, 'clip_001', 2);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.contentField);
  });

  // ⚠️ **2つの setter が同じ門を通る**＝片方だけ開くと、速さは変えられるのに使い始めは断られる。
  it('速さと使い始めは、同じ相手に対して同じ答えを返す', () => {
    const photo = doc({
      assets: [{ assetId: 'asset_p', assetType: 'image', displayName: '外観', filePath: 'p.png' }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_p',
      } as TimelineClip],
    } as Partial<TimelineProject>);
    for (const d of [videoDoc(), photo]) {
      const a = setClipSpeed(d, 'clip_001', 2);
      const b = setClipSourceStart(d, 'clip_001', 2);
      expect(a.ok).toBe(b.ok);
      if (!a.ok && !b.ok) expect(a.reason).toBe(b.reason);
    }
  });

  it('固定した列では変えられない', () => {
    const d = videoDoc();
    const locked = { ...d, tracks: d.tracks.map((t) => (t.id === 'track_001' ? { ...t, locked: true } : t)) };
    const r = setClipSpeed(locked, 'clip_001', 2);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });
});
