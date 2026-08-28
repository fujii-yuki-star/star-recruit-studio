// 「バラす」の前後で**絵が変わらない**ことを固定する（ADR-0032 決定6・#632 の完了条件）。
//
// 変換の書き方（どの層をどの要素へ写すか）ではなく、**描いた結果**を比べる＝実装を書き換えても
// 「見た目が変わらない」だけは守られる（ADR-0001 のパリティと同じ考え方）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import type { Template } from '../domain/template/types';
import { explodeTemplateClip } from '../domain/timeline/explode';
import { setClipAssetRef } from '../domain/timeline/edit';
import { bakeTimelineProject } from '../domain/timeline/bake';
import { DEFAULT_LINE_HEIGHT, layoutScene } from './layout';
import { wrapText } from '../domain/text/textWrap';
import type { Scene } from '../domain/project/types';
import { layoutTimelineAt } from './timelineLayout';
import { layoutToSvg } from './sceneSvg';
import { validateTimelineProject } from '../domain/validation/generated/validators.js';

const template: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_001',
  name: 'いろいろ入り',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  defaults: { backgroundColor: '#102030' },
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'deco', type: 'shape', x: 40, y: 40, w: 200, h: 120, fillColor: '#ff0000', shapeType: 'ellipse' },
    { id: 'mainVisual', type: 'slot', x: 100, y: 200, w: 800, h: 600 },
    { id: 'logo', type: 'logo', x: 1600, y: 60, w: 240, h: 120 },
    { id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 860, w: 900, h: 90, fontSize: 60, color: '#ffffff' },
    { id: 'subtitleBand', type: 'subtitle', textKey: 'subtitle', x: 200, y: 950, w: 1520, h: 80, background: { enabled: true, color: '#000000', opacity: 0.5 } },
    { id: 'character', type: 'character', x: 1200, y: 300, w: 500, h: 700 },
  ],
};

function clip(over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_001',
    kind: TIMELINE_CLIP_KIND.template,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 5,
    templateId: 'tmpl_001',
    assetRefs: { background: 'asset_bg', mainVisual: 'asset_main', logo: 'asset_logo' },
    texts: { title: 'こんにちは', subtitle: 'ごあいさつ' },
    character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' },
    ...over,
  };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_009', kind: TRACK_KIND.audio },
    ],
    clips: [clip()],
    ...over,
  };
}

const opts = { templateOf: (id: string) => (id === 'tmpl_001' ? template : undefined) };

/**
 * **実際に描かれる絵**（SVG）を比べる。アイテムの持ち物ではなく出力そのものを見る＝
 * 内部の持ち方（役割名やラベルなど、絵に出ないもの）が変わっても、絵が同じなら通る。
 */
function drawn(d: TimelineProject, timeSec = 1): string {
  return layoutToSvg(layoutTimelineAt(d, timeSec, opts), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
}

function exploded(d: TimelineProject, clipId = 'clip_001'): TimelineProject {
  const r = explodeTemplateClip(d, clipId, template);
  if (!r.ok) throw new Error(`バラせなかった: ${r.reason}`);
  return r.doc;
}

// ⚠️ **絵だけでなく「枠の使い方」も持ち越す**（#512 段3b レビュー 🟡）＝差し込み口の元の音・
// 切り出す先頭・速さを捨てると、バラした瞬間に**鳴っていた音が黙って消える**（決定23）。
describe('バラしても枠の使い方が残る', () => {
  const videoTemplate = {
    schemaVersion: '1.0', templateId: 'tmpl_v', name: '動画枠', category: 'opening',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [{ id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 }],
  } as unknown as Template;

  it('元の音・切り出す先頭・速さがクリップ自身の語彙へ移る', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v',
      assetRefs: { main: 'asset_v' },
      slotClips: { main: { useOriginalAudio: true, originalAudioVolume: 0.8, startSec: 3, speed: 2 } },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', videoTemplate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const slot = r.doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.slot && c.assetId === 'asset_v');
    expect(slot).toMatchObject({ useOriginalAudio: true, originalAudioVolume: 0.8, sourceStartSec: 3, speed: 2 });
    expect(validateTimelineProject(r.doc)).toBe(true);
  });

  // ⚠️ **素材既定だけに頼っている枠も持ち越す**（レビュー 🔴）＝per-use を書いていなくても、
  // 描画・再生は `asset.clip` を継承して鳴らしている。**展開後は継承経路が無くなる**
  //（直接置きは `asset.clip` を見ない）ので、ここで実効値を書き切らないと音が黙って消える。
  it('素材の画面で決めた既定（per-use なし）も、実効値として持ち越す', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
    } as TimelineClip;
    const d = doc({
      assets: [{
        assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4',
        metadata: { hasAudio: true },
        clip: { useOriginalAudio: true, originalAudioVolume: 0.9, startSec: 2, speed: 0.5 },
      }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', videoTemplate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const slot = r.doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.slot && c.assetId === 'asset_v');
    expect(slot).toMatchObject({ useOriginalAudio: true, originalAudioVolume: 0.9, sourceStartSec: 2, speed: 0.5 });
  });

  // ⚠️ **差し込み口でない層に入れた動画は、バラすと動き出す**（#816-4）＝いまは静止画として描かれる
  // のに、バラすと直接置きになり実映像になる＝決定23「前後で絵が変わらない」に反する（確認の文言も
  // 「動画の見た目は変わりません」と約束している）。UI から素直に踏める（背景の層は同梱テンプレにもある）。
  it('背景の層に入れた動画があったら、バラす前に断る（バラすと動き出すため）', () => {
    const withBg = {
      ...videoTemplate,
      layers: [
        { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
        { id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
      ],
    } as unknown as Template;
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { background: 'asset_v' },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', withBg);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('TIMELINE_EDIT_EXPLODE_BACKGROUND_VIDEO');
  });

  it('差し込み口に入れた動画は、そのままバラせる（動き出すのは背景の層のとき）', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' }],
      clips: [clip],
    } as Partial<TimelineProject>);
    expect(explodeTemplateClip(d, 'clip_001', videoTemplate).ok).toBe(true);
  });

  // ⚠️ **立ち絵に入れた動画も同じく断るが、コードは別**（#831）＝変換は立ち絵も要素にするので、
  // `assetRefs` だけを見ていると素通りして動き出す。しかも**バラす前は書き出しを断っていた**のに、
  // バラした後は黙って通る。⚠️ **`explodeBackgroundVideo` と同じコードにしない**＝あちらの逃げ道
  // 「差し込み口へ入れるか、写真に差し替えてから」は立ち絵を触る欄がこの画面に無く実行できない
  // （§2-5・#812 と同型のバグだった＝差分再監査で発覚）。
  // ⚠️ **立ち絵の断りは退役した**（#809）＝かつては「バラすと動き出す」（前は静止）が理由だったが、
  // **バラす前から動く**ようになったので前提が消えた。いまは**バラせる**（動きは変わらない）。
  it('立ち絵に入れた動画はバラせる（#809 で映るようになった＝前後で動きが変わらない）', () => {
    const withChar = {
      ...videoTemplate,
      layers: [
        { id: 'character', type: 'character', x: 0, y: 0, w: 400, h: 800 },
        { id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
      ],
    } as unknown as Template;
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v',
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', withChar);
    expect(r.ok).toBe(true);
  });

  /**
   * ⚠️ **立ち絵の per-use も持ち越す**（PR #871 レビュー 🔴）＝差し込み口の要素は
   * `slotLayerByElementId` から使い方を引けるが、**立ち絵の要素はそこに入っていない**ので、
   * 引き方を `layerOfElement` に揃え忘れると**キーごと落ちて既定へ戻る**
   *（元の音が鳴らなくなる・等速になる・先頭から流れる）＝ADR-0032 決定23 に反する。
   *
   * ⚠️ **上の「バラせる」テストでは捕まらない**＝あちらは `slotClips` を置いていないので、
   * 落ちても既定と同じ値になり差が出ない。**per-use を置いた状態**で見る必要がある。
   */
  it('立ち絵に入れた動画の使い方（元の音・速さ・使い始め）もバラした後に残る', () => {
    const withChar = {
      ...videoTemplate,
      layers: [
        { id: 'character', type: 'character', x: 0, y: 0, w: 400, h: 800 },
        { id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
      ],
    } as unknown as Template;
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v',
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
      slotClips: { character: { useOriginalAudio: true, originalAudioVolume: 0.7, startSec: 4, speed: 1.5 } },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', withChar);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const slot = r.doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.slot && c.assetId === 'asset_v');
    expect(slot).toMatchObject({ useOriginalAudio: true, originalAudioVolume: 0.7, sourceStartSec: 4, speed: 1.5 });
    expect(validateTimelineProject(r.doc)).toBe(true);
  });

  // ⚠️ **背景の動画はいまも断る**（立ち絵だけが退役した）＝背景の層は差し込み口として描かれず、
  // バラすと直接置きの動画になって**動き出す**（前提が残っている）。
  it('立ち絵は通るが、背景に入れた動画は今までどおり断る', () => {
    const withBoth = {
      ...videoTemplate,
      layers: [
        { id: 'character', type: 'character', x: 0, y: 0, w: 400, h: 800 },
        { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
        { id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
      ],
    } as unknown as Template;
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v',
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
      assetRefs: { background: 'asset_v2' },
    } as TimelineClip;
    const d = doc({
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' },
        { assetId: 'asset_v2', assetType: 'video', displayName: '動画2', filePath: 'v2.mp4' },
      ],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', withBoth);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('TIMELINE_EDIT_EXPLODE_BACKGROUND_VIDEO');
  });

  it('背景の層でも、写真なら断らない（動画のときだけの話）', () => {
    const withBg = {
      ...videoTemplate,
      layers: [
        { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
        { id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
      ],
    } as unknown as Template;
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { background: 'asset_p' },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_p', assetType: 'image', displayName: '写真', filePath: 'p.png' }],
      clips: [clip],
    } as Partial<TimelineProject>);
    expect(explodeTemplateClip(d, 'clip_001', withBg).ok).toBe(true);
  });

  // ⚠️ **持っていけないものは黙って落とさない**＝「切り出す終わり」は直接置きの語彙に無いので、
  // 縮めても縮めなくても絵が変わる。動きが付いた部品と同じ流儀で先に断る。
  it('その枠だけ切り出す終わりを決めた動画が入っていたら、バラす前に断る', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
      slotClips: { main: { startSec: 1, endSec: 3 } },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', videoTemplate);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('TIMELINE_EDIT_EXPLODE_TRIM_END_PER_USE');
  });

  // ⚠️ **案内どおりに操作すれば本当に解除される**（レビュー 🟡・ADR-0034 決定5＝行き止まりを作らない）。
  // その枠だけの設定は素材の画面では外せないので、「なし」にして入れ直す道を案内している。
  it('その枠だけの「ここまで」は、いったん「なし」にして入れ直すとバラせるようになる', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
      slotClips: { main: { startSec: 1, endSec: 3 } },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    // まずは断られる（その枠だけの設定＝素材の画面の話ではない）。
    const blocked = explodeTemplateClip(d, 'clip_001', videoTemplate);
    expect(!blocked.ok && blocked.reason).toBe('TIMELINE_EDIT_EXPLODE_TRIM_END_PER_USE');
    // 案内どおり「なし」→入れ直す。
    const cleared = setClipAssetRef(d, 'clip_001', 'main', null);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const again = setClipAssetRef(cleared.doc, 'clip_001', 'main', 'asset_v');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.doc.clips[0].slotClips).toBeUndefined(); // その枠だけの設定は落ちている
    expect(explodeTemplateClip(again.doc, 'clip_001', videoTemplate).ok).toBe(true);
  });

  // ⚠️ **素材の既定から来ているときは、素材の画面の案内**（そちらでしか外せない）。
  it('素材の既定の「ここまで」は、素材の画面を案内する', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
    } as TimelineClip;
    const d = doc({
      assets: [{
        assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4',
        metadata: { hasAudio: true }, clip: { endSec: 3 },
      }],
      clips: [clip],
    } as Partial<TimelineProject>);
    const r = explodeTemplateClip(d, 'clip_001', videoTemplate);
    expect(!r.ok && r.reason).toBe('TIMELINE_EDIT_EXPLODE_TRIM_END');
  });

  // 「ここまで」が置いた長さより長ければ、実質の切り詰めは無い＝断らない（過剰に止めない）。
  it('切り出す終わりが置いた長さより先なら、そのままバラせる', () => {
    const clip: TimelineClip = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, templateId: 'tmpl_v', assetRefs: { main: 'asset_v' },
      slotClips: { main: { startSec: 0, endSec: 20 } },
    } as TimelineClip;
    const d = doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { hasAudio: true } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    expect(explodeTemplateClip(d, 'clip_001', videoTemplate).ok).toBe(true);
  });
});

describe('バラす前後で絵が変わらない', () => {
  it('置いた中身（背景・素材・ロゴ・文字・字幕・立ち絵・図形）がそのまま出る', () => {
    const before = doc();
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('差し込み口が空でも変わらない（未設定の枠もそのまま）', () => {
    const before = doc({ clips: [clip({ assetRefs: {}, character: { enabled: false, characterId: 'yuko' } })] });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('背景の層に素材が入っていなくても下地の色が残る（白く抜けない）', () => {
    const before = doc({ clips: [clip({ assetRefs: { mainVisual: 'asset_main' } })] });
    const after = exploded(before);
    expect(drawn(after)).toEqual(drawn(before));
    expect(drawn(after)).toContain('#102030'); // 下地の色が残っている
  });

  it('文字の体裁を場面ごとに変えていても、そのまま出る', () => {
    const before = doc({ clips: [clip({ textStyles: { title: { color: '#00ff00', fontSize: 90 } } })] });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('縦型でも変わらない', () => {
    const portrait: Template = { ...template, aspectRatio: '9:16', canvas: { width: 1080, height: 1920 } };
    const before = doc({ videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
    const r = explodeTemplateClip(before, 'clip_001', portrait);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withPortrait = { templateOf: () => portrait };
    const strip = (d: TimelineProject): string =>
      layoutToSvg(layoutTimelineAt(d, 1, withPortrait), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    expect(strip(r.doc)).toEqual(strip(before));
  });

  it('動きを付けていても、同じ時刻で同じ絵になる（バラしても動きが止まらない）', () => {
    const before = doc({
      animations: [
        {
          id: 'anim_001',
          targetId: 'clip_001',
          keyframes: [
            { timeSec: 0, x: 0, y: 0, scale: 1, opacity: 1 },
            { timeSec: 4, x: 200, y: 100, scale: 1.5, opacity: 0.5 },
          ],
        },
      ],
    });
    const after = exploded(before);
    for (const t of [0, 1, 2.5, 4]) {
      expect(drawn(after, t)).toEqual(drawn(before, t));
    }
  });

  it('ほかの部品との前後関係が変わらない（手前の文字は手前のまま）', () => {
    const front: TimelineClip = {
      id: 'clip_front', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002',
      startSec: 0, durationSec: 5, x: 0, y: 0, w: 500, h: 80, text: '手前',
    };
    const before = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.visual },
        { id: 'track_009', kind: TRACK_KIND.audio },
      ],
      clips: [clip(), front],
    });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('隠した列の部品をバラしても表に出さない（列の「隠す」も引き継ぐ）', () => {
    const before = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }, { id: 'track_009', kind: TRACK_KIND.audio }],
    });
    const after = exploded(before);
    expect(drawn(after)).toEqual(drawn(before));
    expect(after.tracks.filter((t) => t.kind === TRACK_KIND.visual).every((t) => t.hidden)).toBe(true);
  });

  /**
   * ⚠️ **写すのは「描かれるもの」だけ**（ADR-0032 決定23）。何が描かれるかは変わりうる：
   * - **図形の枠線**は通常テンプレでは**描かれない**ので写さない（元の絵に無い線を足さない）。
   * - **文字の帯**は #264 で**描かれるようになった**ので、いまは**写す**（写さないと絵が変わる）。
   *
   * このテストは「写す/写さない」の一覧ではなく、**バラす前後で絵が同じ**であることを見る
   *（だから何が描かれるかが変わっても、直すのは実装であってこのテストの主張ではない）。
   */
  /**
   * ⚠️ **影・字間もバラす前後で同じ**（PR #879 レビュー 🔴）＝`freeLayoutFromPlacedContent` は
   * `strokeColor`/`strokeWidth` だけを運んでいたので、**新しい項目を足したときに落ちた**。
   * 落ちると**影付きテンプレをバラすと影が消える**（ADR-0032 決定23 に反する）。
   */
  it('影と字間を持つ見た目でも、バラす前後で絵が同じ', () => {
    const styled: Template = {
      ...template,
      layers: [
        {
          id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 200, w: 900, h: 140, fontSize: 72,
          letterSpacing: 0.1,
          shadow: { enabled: true, color: '#112233', opacity: 0.6, blur: 8, dx: 3, dy: 4 },
        },
      ],
    } as unknown as Template;
    const before = doc();
    const r = explodeTemplateClip(before, 'clip_001', styled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withStyled = { templateOf: () => styled };
    const strip = (d: TimelineProject): string =>
      layoutToSvg(layoutTimelineAt(d, 1, withStyled), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    expect(strip(r.doc)).toEqual(strip(before));
  });

  it('バラす前後で絵が同じ（図形の枠線・文字の帯を持つ見た目でも）', () => {
    const decorated: Template = {
      ...template,
      layers: [
        { id: 'deco', type: 'shape', x: 40, y: 40, w: 200, h: 120, fillColor: '#ff0000', strokeColor: '#00ff00', strokeWidth: 8 },
        { id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 860, w: 900, h: 90, background: { enabled: true, color: '#000000', opacity: 0.5 } },
      ],
    };
    const before = doc();
    const r = explodeTemplateClip(before, 'clip_001', decorated);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withDecorated = { templateOf: () => decorated };
    const strip = (d: TimelineProject): string =>
      layoutToSvg(layoutTimelineAt(d, 1, withDecorated), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    expect(strip(r.doc)).toEqual(strip(before));
  });

  it('動きの支点が変わる形（中身が枠からはみ出す＋拡大）はバラさずに断る', () => {
    const bleeding: Template = {
      ...template,
      layers: [{ id: 'deco', type: 'shape', x: -200, y: 0, w: 400, h: 200, fillColor: '#ff0000' }],
    };
    const d = doc({
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scale: 1 }, { timeSec: 4, scale: 2 }] },
      ],
    });
    const r = explodeTemplateClip(d, 'clip_001', bleeding);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TIMELINE_EDIT_EXPLODE_ANCHOR');
  });

  it('平行移動だけの動きなら、はみ出していてもバラせる（支点に依らない）', () => {
    const bleeding: Template = {
      ...template,
      layers: [{ id: 'deco', type: 'shape', x: -200, y: 0, w: 400, h: 200, fillColor: '#ff0000' }],
    };
    const d = doc({
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 4, x: 300 }] },
      ],
    });
    const r = explodeTemplateClip(d, 'clip_001', bleeding);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withBleeding = { templateOf: () => bleeding };
    const strip = (dd: TimelineProject, t: number): string =>
      layoutToSvg(layoutTimelineAt(dd, t, withBleeding), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    for (const t of [0, 2, 4]) expect(strip(r.doc, t)).toEqual(strip(d, t));
  });

  it('渡した見た目パターンが違う部品のものならバラさない（取り違えたまま進めない）', () => {
    const other: Template = { ...template, templateId: 'tmpl_other' };
    const r = explodeTemplateClip(doc(), 'clip_001', other);
    expect(r.ok).toBe(false);
  });
});

describe('explodeTemplateClip（文書の形）', () => {
  it('元の部品は無くなり、中身ぶんの部品になる', () => {
    const after = exploded(doc());
    expect(after.clips.some((c) => c.id === 'clip_001')).toBe(false);
    expect(after.clips).toHaveLength(8); // 下地＋層7つ
    expect(after.clips.every((c) => c.startSec === 0 && c.durationSec === 5)).toBe(true);
  });

  it('バラした文書はスキーマに適合する（保存できない文書を作らない）', () => {
    // 描いた結果が同じでも、置けない持ち物が混ざっていると保存が黙って失敗する（自動保存は書かない）。
    expect(validateTimelineProject(exploded(doc()))).toBe(true);
  });

  it('隠してある部品をバラしても表に出さない', () => {
    const before = doc({ clips: [clip({ hidden: true })] });
    const after = exploded(before);
    expect(after.clips.every((c) => c.hidden)).toBe(true);
    expect(drawn(after)).toEqual(drawn(before));
  });

  it('まとめて動かせるように1つのグループにする', () => {
    const after = exploded(doc());
    const group = after.groups?.[after.groups.length - 1];
    expect(group?.members).toEqual(after.clips.map((c) => c.id));
  });

  it('元の列のすぐ手前に列を足す（ほかの列との前後関係を変えない）', () => {
    const before = doc();
    const after = exploded(before);
    expect(after.tracks[0].id).toBe('track_001'); // 元の列はその場所のまま
    expect(after.tracks[after.tracks.length - 1].kind).toBe(TRACK_KIND.audio); // 音の列は最後のまま
    // 足すのは**部品の数より1つ少ない**＝元の列を使い切る（空の列を残さない）。
    expect(after.tracks.length - before.tracks.length).toBe(after.clips.length - 1);
    expect(after.tracks.every((t) => after.clips.some((c) => c.trackId === t.id) || t.kind === TRACK_KIND.audio)).toBe(true);
  });

  it('元の部品が入っていたグループの席を引き継ぐ', () => {
    const before = doc({
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    const after = exploded(before);
    const parent = after.groups?.find((g) => g.id === 'group_001');
    expect(parent?.members).toHaveLength(1);
    expect(parent?.members[0]).not.toBe('clip_001');
    expect(after.groups?.some((g) => g.id === parent?.members[0])).toBe(true);
  });

  it('見た目パターン以外の部品はバラせない', () => {
    const d = doc({
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
    });
    const r = explodeTemplateClip(d, 'clip_001', template);
    expect(r.ok).toBe(false);
  });

  it('固定した列の部品はバラせない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_009', kind: TRACK_KIND.audio }] });
    const r = explodeTemplateClip(d, 'clip_001', template);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TIMELINE_EDIT_LOCKED');
  });
});

// ── 焼き出した掛け合い字幕が、場面形式と同じ位置に出るか（#633） ──
// 「焼く前と焼いた後で字幕の位置が変わらない」を、**描いた結果**で確かめる（変換の書き方に依らない）。
describe('焼いた掛け合い字幕の位置が場面形式と一致する', () => {
  const tmpl: Template = {
    schemaVersion: '1.0',
    templateId: 'tmpl_dialog',
    name: '掛け合い',
    category: 'message',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, fillColor: '#101010' },
      { id: 'subtitleBand', type: 'subtitle', textKey: 'subtitle', x: 100, y: 950, w: 1720, h: 120, fontSize: 52 },
    ],
  };

  /** 場面形式の1フレーム（その時刻に出ている字幕を `layoutScene` へ渡す＝書き出しと同じ経路）。 */
  function sceneFrameSubtitleY(subtitleText: string, parallel?: string): number[] {
    const sc: Scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'message', templateId: 'tmpl_dialog',
      durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
      texts: {}, narration: { text: '', status: 'none' }, warnings: [],
      lines: [
        { lineId: 'line_001', text: subtitleText, status: 'none' },
        ...(parallel ? [{ lineId: 'line_002', text: parallel, startWithPrevious: true, status: 'none' as const }] : []),
      ],
    };
    const layout = layoutScene(sc, tmpl, {
      subtitleText,
      ...(parallel ? { subtitleSegment: { startSec: 0, durationSec: 4, isFirst: true, lineId: 'line_001', subtitleText: subtitleText, parallelLineIds: ['line_002'] } } : {}),
    });
    return layout.items.filter((it) => it.kind === 'text' && it.isSubtitle).map((it) => it.y);
  }

  it('単独の行：焼いた字幕クリップの描画位置が場面形式と一致する', () => {
    const [sceneY] = sceneFrameSubtitleY('こんにちは');
    const baked = bakeTimelineProject(
      {
        schemaVersion: '1.0', projectId: 'proj_20260730_001', projectName: 'x',
        createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
        videoKind: 'recruit', purpose: 'company_intro',
        videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
        voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
        assets: [], parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
        scenes: [{
          sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'message', templateId: 'tmpl_dialog',
          durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
          texts: {}, narration: { text: '', status: 'none' }, warnings: [],
          lines: [{ lineId: 'line_001', text: 'こんにちは', status: 'none' }],
        }],
      },
      {
        range: { kind: 'whole' }, projectId: 'proj_20260730_002', projectName: 'y',
        nowIso: '2026-07-30T00:00:00.000Z', templateOf: () => tmpl, lineDurationsFor: () => ({ line_001: 4 }),
      },
    ).doc;
    // 焼いた字幕クリップを、タイムラインの描画（`layoutTimelineAt`）で1フレーム描く。
    const items = layoutTimelineAt(baked, 1, { templateOf: () => tmpl }).items;
    const drawnY = items.filter((it) => it.kind === 'text' && it.isSubtitle).map((it) => it.y);
    expect(drawnY).toHaveLength(1);
    // 場面形式は**下端基準**（`anchorBottom`）・タイムラインは上端起点。1行なら同じ位置に出る。
    expect(drawnY[0]).toBeCloseTo(sceneY);
  });
  it('同時に流れる2行：積んだ字幕の位置も場面形式と一致する', () => {
    const sceneYs = sceneFrameSubtitleY('いちばんめ', 'にばんめ');
    const baked = bakeTimelineProject(
      {
        schemaVersion: '1.0', projectId: 'proj_20260730_001', projectName: 'x',
        createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
        videoKind: 'recruit', purpose: 'company_intro',
        videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
        voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
        assets: [], parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
        scenes: [{
          sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'message', templateId: 'tmpl_dialog',
          durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
          texts: {}, narration: { text: '', status: 'none' }, warnings: [],
          lines: [
            { lineId: 'line_001', text: 'いちばんめ', status: 'none' },
            { lineId: 'line_002', text: 'にばんめ', startWithPrevious: true, status: 'none' },
          ],
        }],
      },
      {
        range: { kind: 'whole' }, projectId: 'proj_20260730_002', projectName: 'y',
        nowIso: '2026-07-30T00:00:00.000Z', templateOf: () => tmpl,
        lineDurationsFor: () => ({ line_001: 4, line_002: 4 }),
      },
    ).doc;
    const drawnYs = layoutTimelineAt(baked, 1, { templateOf: () => tmpl })
      .items.filter((it) => it.kind === 'text' && it.isSubtitle)
      .map((it) => it.y)
      .sort((a, b) => b - a); // 下→上
    expect(drawnYs).toHaveLength(2);
    expect(drawnYs[0]).toBeCloseTo(sceneYs.sort((a, b) => b - a)[0]);
    expect(drawnYs[1]).toBeCloseTo(sceneYs.sort((a, b) => b - a)[1]);
  });
  it('2行に折り返す字幕：アンカーの違い（下端基準→上端起点）を座標へ翻訳する', () => {
    // 場面形式のテンプレ字幕層は**下端基準**（行が増えると上へ伸びる）。タイムラインの字幕クリップは
    // **上端起点**なので、y をそのまま写すと2行の字幕が1行ぶん下がる（画面外へも出うる）。
    const long = 'これはとても長い字幕の文で、かならず二行に折り返される長さになっています。';
    const sceneYs = sceneFrameSubtitleY(long);
    const baked = bakeTimelineProject(
      {
        schemaVersion: '1.0', projectId: 'proj_20260730_001', projectName: 'x',
        createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
        videoKind: 'recruit', purpose: 'company_intro',
        videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
        voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
        assets: [], parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
        scenes: [{
          sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'message', templateId: 'tmpl_dialog',
          durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
          texts: {}, narration: { text: '', status: 'none' }, warnings: [],
          lines: [{ lineId: 'line_001', text: long, status: 'none' }],
        }],
      },
      {
        range: { kind: 'whole' }, projectId: 'proj_20260730_002', projectName: 'y',
        nowIso: '2026-07-30T00:00:00.000Z', templateOf: () => tmpl, lineDurationsFor: () => ({ line_001: 4 }),
      },
    ).doc;
    const items = layoutTimelineAt(baked, 1, { templateOf: () => tmpl }).items;
    const sub = items.find((it) => it.kind === 'text' && it.isSubtitle);
    expect(sub).toBeDefined();
    if (sub?.kind !== 'text') return;
    // 折り返しが2行以上あること（この検査が意味を持つ前提）。
    expect(wrapText(long, 1720, 52, sub.maxLines).length).toBeGreaterThan(1);
    // 場面形式の帯の**上端**＝タイムラインの y（上端起点）。
    const lineHeightPx = 52 * DEFAULT_LINE_HEIGHT;
    const n = wrapText(long, 1720, 52, sub.maxLines).length;
    expect(sub.y).toBeCloseTo(sceneYs[0] - (n - 1) * lineHeightPx);
  });
  it('回転した字幕層：焼いても同じ位置に出る（回転の軸が動くぶんを打ち消す）', () => {
    const rotated: Template = {
      ...tmpl,
      layers: tmpl.layers.map((l) => (l.type === 'subtitle' ? { ...l, rotation: 20 } : l)),
    };
    const text = 'かいてん';
    // 場面形式の1フレーム（回転あり）。
    const sc: Scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'message', templateId: 'tmpl_dialog',
      durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
      texts: {}, narration: { text: '', status: 'none' }, warnings: [],
      lines: [{ lineId: 'line_001', text, status: 'none' }],
    };
    const sceneSvgOut = layoutToSvg(layoutScene(sc, rotated, { subtitleText: text }), {});
    const baked = bakeTimelineProject(
      {
        schemaVersion: '1.0', projectId: 'proj_20260730_001', projectName: 'x',
        createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
        videoKind: 'recruit', purpose: 'company_intro',
        videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
        voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
        assets: [], parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
        scenes: [sc],
      },
      {
        range: { kind: 'whole' }, projectId: 'proj_20260730_002', projectName: 'y',
        nowIso: '2026-07-30T00:00:00.000Z', templateOf: () => rotated, lineDurationsFor: () => ({ line_001: 4 }),
      },
    ).doc;
    const bakedSvg = layoutToSvg(layoutTimelineAt(baked, 1, { templateOf: () => rotated }), {});
    // **回した後の文字の位置**を比べる（`rotate(...)` の軸そのものは箱が違えば当然変わる）。
    // 軸 (cx,cy) まわりに角度 deg で回した文字の始点 (x,y) が、焼く前と後で同じ場所に来るか。
    const drawnPoint = (svg: string): { x: number; y: number } => {
      const g = svg.match(/rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)"><text x="([-\d.]+)" y="([-\d.]+)"/);
      if (!g) throw new Error(`回転した文字が見つからない: ${svg.slice(0, 200)}`);
      const [deg, cx, cy, x, y] = g.slice(1).map(Number);
      const rad = (deg * Math.PI) / 180;
      return {
        x: cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
        y: cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad),
      };
    };
    const before = drawnPoint(sceneSvgOut);
    const after = drawnPoint(bakedSvg);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });
});

// 焼き出しの側の絵の一致（#811）＝**場面内のグループが2つ以上ある FREE の場面**を焼いても、
// 焼く前と同じ場所に描かれる。グループ id が重なると `composeGroupGeometry` の引き当てが
// 後勝ち／親は先勝ちで食い違い、**片方の変形がもう片方のメンバーに掛かる**（実測で要素が
// 2倍になり画面外へ飛んだ）。id の一意性ではなく**描いた結果**で守る（ADR-0032 決定23 の流儀）。
describe('焼き出し：場面内のグループが2つ以上でも絵が変わらない（#811）', () => {
  const freeTemplate: Template = {
    schemaVersion: '1.0', templateId: 'tmpl_free', name: '自由配置', category: 'free',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, fillColor: '#ffffff' }],
  };
  const freeSceneWithTwoGroups: Scene = {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'tmpl_free',
    durationSec: 5, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [],
    freeLayout: [
      { id: 'free_001', kind: 'text', x: 100, y: 200, w: 400, h: 90, text: 'ひだり', fontSize: 40, zIndex: 1 },
      { id: 'free_002', kind: 'text', x: 100, y: 500, w: 400, h: 90, text: 'みぎ', fontSize: 40, zIndex: 2 },
    ],
    // 別々の変形＝取り違えると位置も大きさも変わる。
    groups: [
      { id: 'group_001', members: ['free_001'], transform: { x: 60, y: 10, rotation: 0, scale: 1 } },
      { id: 'group_002', members: ['free_002'], transform: { x: 800, y: 0, rotation: 0, scale: 2 } },
    ],
  } as Scene;

  /** 文言 → 描かれた位置と大きさ（どちらの描画経路でも同じ形で採る）。 */
  const drawnText = (layout: { items: readonly { kind: string }[] }): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const it of layout.items as readonly Record<string, unknown>[]) {
      if (it.kind !== 'text') continue;
      out[String(it.text)] = { x: it.x, y: it.y, w: it.w, h: it.h, fontSize: it.fontSize };
    }
    return out;
  };

  it('焼く前後で、それぞれの文字が同じ場所・同じ大きさで描かれる', () => {
    const before = drawnText(layoutScene(freeSceneWithTwoGroups, freeTemplate));
    expect(Object.keys(before).sort()).toEqual(['ひだり', 'みぎ']); // 材料が効いていることの確認
    const baked = bakeTimelineProject(
      {
        schemaVersion: '1.0', projectId: 'proj_20260820_001', projectName: 'x',
        createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
        videoKind: 'recruit', purpose: 'company_intro',
        videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
        voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
        assets: [], parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
        scenes: [freeSceneWithTwoGroups],
      },
      {
        range: { kind: 'whole' }, projectId: 'proj_20260820_002', projectName: 'y',
        nowIso: '2026-08-20T00:00:00.000Z', templateOf: () => freeTemplate, lineDurationsFor: () => ({}),
      },
    ).doc;
    expect(drawnText(layoutTimelineAt(baked, 0, { templateOf: () => freeTemplate }))).toEqual(before);
  });
});
