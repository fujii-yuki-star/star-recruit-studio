// 字幕と読み上げの連動（ADR-0032 決定24・#633）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { boundVoiceClip, danglingSubtitleLinks, subtitleTextOf, subtitlesBoundTo } from './subtitleLink';
import {
  addLinkedSubtitleClip, addVoiceClip, duplicateClip, EDIT_BLOCKED, moveClip,
  setSubtitleText, setSubtitleVoiceLink, setVoiceSpeaker, setVoiceText, trimClip,
} from './edit';
import { VOICE_PLACEHOLDER_SEC } from '../constants';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { validateTimelineDoc } from './validateTimelineDoc';
import { timelineExportBlockers } from './export';

const voice = (id: string, over: Partial<TimelineClip> = {}, text = 'こんにちは'): TimelineClip => ({
  id,
  kind: TIMELINE_CLIP_KIND.voice,
  trackId: 'track_002',
  startSec: 2,
  durationSec: 3,
  voice: { text, status: 'generated', voicePath: `voices/${id}.wav` },
  ...over,
});

const subtitle = (id: string, over: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  kind: TIMELINE_CLIP_KIND.subtitle,
  trackId: 'track_001',
  startSec: 0,
  durationSec: 1,
  x: 0,
  y: 900,
  w: 1920,
  h: 120,
  ...over,
});

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
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

describe('連動の解決', () => {
  it('連動先の読み上げ文を字幕として出す', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' })] });
    expect(subtitleTextOf(d, d.clips[1])).toBe('こんにちは');
  });

  it('自分の文が入っていればそちらを出す（言い換えの上書き）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', text: '言い換え' })] });
    expect(subtitleTextOf(d, d.clips[1])).toBe('言い換え');
  });

  it('連動していない字幕は自分の文を出す', () => {
    const d = doc({ clips: [subtitle('clip_002', { text: 'ふつうの字幕' })] });
    expect(subtitleTextOf(d, d.clips[0])).toBe('ふつうの字幕');
  });

  it('連動先が見つからないときは自分の文へ落ちる（黙って消さない）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999', text: '残る文' })] });
    expect(subtitleTextOf(d, d.clips[0])).toBe('残る文');
    expect(boundVoiceClip(d, d.clips[0])).toBeUndefined();
    expect(danglingSubtitleLinks(d).map((c) => c.id)).toEqual(['clip_002']);
  });

  it('読み上げでない部品を指していても連動しない（見つからない扱い）', () => {
    const d = doc({
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 1, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
        subtitle('clip_002', { voiceClipId: 'clip_001' }),
      ],
    });
    expect(boundVoiceClip(d, d.clips[1])).toBeUndefined();
  });

  it('連動先が見つからないことを検証が知らせる（V29）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999' })] });
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_SUBTITLE_LINK_NOT_FOUND');
  });

  it('字幕でない部品に連動先が付いていることも知らせる', () => {
    const d = doc({
      clips: [voice('clip_001'), { ...voice('clip_003'), voiceClipId: 'clip_001' }],
    });
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_SUBTITLE_LINK_ON_NON_SUBTITLE');
  });

  it('その読み上げに連動している字幕を引ける', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' }), subtitle('clip_003')],
    });
    expect(subtitlesBoundTo(d, 'clip_001').map((c) => c.id)).toEqual(['clip_002']);
  });
});

describe('時間の追従', () => {
  const linked = () =>
    doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })] });

  it('読み上げを動かすと字幕も同じ区間になる', () => {
    const r = moveClip(linked(), 'clip_001', { startSec: 5 });
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 5, durationSec: 3 });
  });

  it('読み上げの端を動かすと字幕も同じ区間になる（声を作り直して長さが変わったときも同じ）', () => {
    const r = trimClip(linked(), 'clip_001', 'end', 7);
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 2, durationSec: 5 });
  });

  it('連動していない字幕は動かない', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { startSec: 2, durationSec: 3 })] });
    const r = moveClip(d, 'clip_001', { startSec: 5 });
    expect(r.ok && r.doc.clips[1].startSec).toBe(2);
  });

  it('字幕を置けない場所へは動かさない（片方だけ動いた結果を作らない）', () => {
    const d = doc({
      clips: [
        voice('clip_001'),
        subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 }),
        subtitle('clip_003', { startSec: 6, durationSec: 3 }), // 動かした先で重なる
      ],
    });
    const r = moveClip(d, 'clip_001', { startSec: 7 });
    expect(r.ok).toBe(false);
    // 理由は**連動のせいで置けない**と分かるもの（触っていない列の話にしない）。
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.linkedSubtitle);
  });

  it('連動している字幕の時間は自分では変えられない（読み上げが決める）', () => {
    const move = moveClip(linked(), 'clip_002', { startSec: 9 });
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.reason).toBe(EDIT_BLOCKED.linkedSubtitleTime);
    const trim = trimClip(linked(), 'clip_002', 'end', 9);
    expect(trim.ok).toBe(false);
    if (!trim.ok) expect(trim.reason).toBe(EDIT_BLOCKED.linkedSubtitleTime);
  });

  it('連動している字幕でも、置く列は変えられる（重なったときの逃げ道）', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })],
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
    });
    const r = moveClip(d, 'clip_002', { trackId: 'track_003' });
    expect(r.ok && r.doc.clips[1]).toMatchObject({ trackId: 'track_003', startSec: 2, durationSec: 3 });
  });

  it('複製した字幕は連動を引き継がない（複製した瞬間に必ず重なるため）', () => {
    const r = duplicateClip(linked(), 'clip_002');
    expect(r.ok && r.doc.clips[2].voiceClipId).toBeUndefined();
  });
});

describe('setSubtitleVoiceLink', () => {
  it('連動を始めると、その場で時間も合わせる', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002')] });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok && r.doc.clips[1]).toMatchObject({ voiceClipId: 'clip_001', startSec: 2, durationSec: 3 });
  });

  it('連動をやめると、その場に残る（消さない）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })] });
    const r = setSubtitleVoiceLink(d, 'clip_002', null);
    expect(r.ok && r.doc.clips[1].voiceClipId).toBeUndefined();
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it('付け替えられる', () => {
    const d = doc({
      clips: [voice('clip_001'), voice('clip_003', { startSec: 10, durationSec: 2 }), subtitle('clip_002', { voiceClipId: 'clip_001' })],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_003');
    expect(r.ok && r.doc.clips[2]).toMatchObject({ voiceClipId: 'clip_003', startSec: 10, durationSec: 2 });
  });

  it('読み上げでないものへは連動できない', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002'), subtitle('clip_004')] });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_004');
    expect(r.ok).toBe(false);
  });

  it('連動先の場所に置けないときは断る（黙って別の場所に置かない）', () => {
    const d = doc({
      clips: [
        voice('clip_001'),
        subtitle('clip_002'),
        subtitle('clip_003', { startSec: 2, durationSec: 3 }), // 連動先の区間を先に使っている
      ],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it('固定した列の字幕は連動を変えられない', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002')],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('setSubtitleText', () => {
  it('自分の文を入れると、そちらが出る（言い換え）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' })] });
    const r = setSubtitleText(d, 'clip_002', '言い換え');
    expect(r.ok && subtitleTextOf(r.doc, r.doc.clips[1])).toBe('言い換え');
  });

  it('空にすると連動先の読み上げ文に戻る（キーごと落とす）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', text: '言い換え' })] });
    const r = setSubtitleText(d, 'clip_002', '');
    expect(r.ok && r.doc.clips[1].text).toBeUndefined();
    expect(r.ok && subtitleTextOf(r.doc, r.doc.clips[1])).toBe('こんにちは');
  });

  it('同じ文なら文書は変わらない', () => {
    const d = doc({ clips: [subtitle('clip_002', { text: 'あ' })] });
    const r = setSubtitleText(d, 'clip_002', 'あ');
    expect(r.ok && r.doc).toBe(d);
  });
});

describe('書き出しの手前で断る', () => {
  it('連動先が見つからず、自分の文も無い字幕は書き出さない（何も出ないため）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999' })] });
    expect(timelineExportBlockers(d).map((b) => b.code)).toContain('TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN');
  });

  // ⚠️ **ここを「何も描かれない字幕」全部へ広げない**（#787 で試して取り下げ）＝文も連動先も無い字幕は
  // **焼き出しが普通に作る**（場面側で字幕 OFF・文が空・隠してある箱＝元から出ていない）ので、止めると
  // **焼いた直後の動画が書き出せなくなる**。関門が見るのは「**指しているのに見つからない**」だけ。
  it('文も連動先も無い字幕は止めない（焼き出しが普通に作るため）', () => {
    const d = doc({ clips: [subtitle('clip_002')] });
    expect(timelineExportBlockers(d).map((b) => b.code)).not.toContain('TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN');
  });

  it('自分の文があれば止めない（その文で描かれる）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999', text: '残る文' })] });
    expect(timelineExportBlockers(d).map((b) => b.code)).not.toContain('TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN');
  });
});

describe('読み上げを置く・書き換える（#633）', () => {
  const base = () => doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }] });

  it('音の列に置ける（まだ声は作っていない＝仮の長さ）', () => {
    const r = addVoiceClip(base(), { text: 'ひとこと', trackId: 'track_002', startSec: 3 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 3, durationSec: VOICE_PLACEHOLDER_SEC,
    });
    expect(r.ok && r.doc.clips[0].voice).toMatchObject({ text: 'ひとこと', status: 'none' });
  });

  it('映像の列には置けない', () => {
    const r = addVoiceClip(base(), { text: 'あ', trackId: 'track_001', startSec: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.trackKind);
  });

  it('置いた読み上げはスキーマに適合する', () => {
    const r = addVoiceClip(base(), { text: 'あ', trackId: 'track_002', startSec: 0 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('文を書き換えると、作成済みの音声は外れる（別の文の声を指さない）', () => {
    const d = doc({ clips: [voice('clip_001')] });
    const r = setVoiceText(d, 'clip_001', 'べつの文');
    expect(r.ok && r.doc.clips[0].voice).toMatchObject({ text: 'べつの文', voicePath: null, status: 'none' });
  });

  it('話者を変えても、作成済みの音声は外れる', () => {
    const d = doc({ clips: [voice('clip_001')] });
    const r = setVoiceSpeaker(d, 'clip_001', 2);
    expect(r.ok && r.doc.clips[0].voice).toMatchObject({ speaker: 2, voicePath: null, status: 'none' });
  });

  it('話者を「動画全体に合わせる」に戻せる', () => {
    const d = doc({ clips: [{ ...voice('clip_001'), voice: { text: 'あ', status: 'generated', speaker: 2 } }] });
    const r = setVoiceSpeaker(d, 'clip_001', null);
    expect(r.ok && r.doc.clips[0].voice?.speaker).toBeUndefined();
  });

  it('同じ文・同じ話者なら文書は変わらない（作った声を無駄に捨てない）', () => {
    const d = doc({ clips: [voice('clip_001')] });
    expect(setVoiceText(d, 'clip_001', 'こんにちは').ok && setVoiceText(d, 'clip_001', 'こんにちは')).toMatchObject({ doc: d });
    expect(setVoiceSpeaker(d, 'clip_001', null)).toMatchObject({ doc: d });
  });
});

describe('その読み上げの字幕を置く（#633）', () => {
  it('同じ時間・連動つきで置く（見た目の既定は自由配置の字幕と同じ）', () => {
    const d = doc({ clips: [voice('clip_001', { startSec: 4, durationSec: 2 })] });
    const r = addLinkedSubtitleClip(d, 'clip_001');
    expect(r.ok && r.doc.clips[1]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.subtitle, voiceClipId: 'clip_001', startSec: 4, durationSec: 2, trackId: 'track_001',
    });
    expect(r.ok && r.doc.clips[1].fontSize).toBeGreaterThan(0);
  });

  it('置ける映像の列が無ければ列を足す（置けないと言って終わらせない）', () => {
    const d = doc({
      clips: [
        voice('clip_001', { startSec: 0, durationSec: 5 }),
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
      ],
    });
    const r = addLinkedSubtitleClip(d, 'clip_001');
    expect(r.ok && r.doc.tracks).toHaveLength(3);
    expect(r.ok && r.doc.clips[2].trackId).toBe(r.ok ? r.doc.tracks[2].id : '');
  });

  it('置いた字幕は連動先の文を出す', () => {
    const d = doc({ clips: [voice('clip_001')] });
    const r = addLinkedSubtitleClip(d, 'clip_001');
    expect(r.ok && subtitleTextOf(r.doc, r.doc.clips[1])).toBe('こんにちは');
  });

  it('読み上げでない部品には置けない', () => {
    const d = doc({ clips: [subtitle('clip_002')] });
    expect(addLinkedSubtitleClip(d, 'clip_002').ok).toBe(false);
  });

  // 同時にしゃべる2人（重複ナレーション）＝#1009。
  // ⚠️ **実測で見つけた**＝2人ぶん置くと `y:900` で**まったく同じ箱**に重なり、下が読めなかった。
  describe('同じ時間に字幕があれば、その上へ積む（#1009）', () => {
    /** 同じ時間に鳴る読み上げを2本（別々の音の列）。 */
    const two = () => doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
        { id: 'track_003', kind: TRACK_KIND.audio },
      ],
      clips: [
        voice('clip_001', { startSec: 0, durationSec: 3 }),
        voice('clip_002', { startSec: 0, durationSec: 3, trackId: 'track_003' }, 'よろしく'),
      ],
    });

    it('2人目は上へ置く（同じ場所に重ねない）', () => {
      const r1 = addLinkedSubtitleClip(two(), 'clip_001');
      expect(r1.ok).toBe(true);
      const r2 = r1.ok ? addLinkedSubtitleClip(r1.doc, 'clip_002') : null;
      const subs = r2?.ok ? r2.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle) : [];
      expect(subs).toHaveLength(2);
      expect(subs[1]!.y, '2人目が1人目より上に来ていない').toBeLessThan(subs[0]!.y!);
      // 縦に重なっていない（帯どうしが接するのも許さない＝読みやすさのすき間を空ける）。
      expect(subs[1]!.y! + subs[1]!.h!, '2人ぶんの字幕が縦に重なっている').toBeLessThan(subs[0]!.y!);
    });

    it('3人目はさらに上へ（人数が増えても重ならない）', () => {
      const d = two();
      const withThird = { ...d, clips: [...d.clips, voice('clip_003', { startSec: 0, durationSec: 3, trackId: 'track_003' }, 'どうも')] };
      const r1 = addLinkedSubtitleClip(withThird, 'clip_001');
      const r2 = r1.ok ? addLinkedSubtitleClip(r1.doc, 'clip_002') : null;
      const r3 = r2?.ok ? addLinkedSubtitleClip(r2.doc, 'clip_003') : null;
      const ys = r3?.ok ? r3.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle).map((c) => c.y!) : [];
      expect(ys).toHaveLength(3);
      expect(ys[2]).toBeLessThan(ys[1]!);
      expect(ys[1]).toBeLessThan(ys[0]!);
    });

    // ⚠️ **時間が重ならない字幕は避ける相手ではない**＝避けると、1本ずつ置くたびに
    // 上へ上へと逃げて画面の外へ出る。
    it('時間が重なっていなければ、いつもの場所に置く', () => {
      const d = doc({
        tracks: [
          { id: 'track_001', kind: TRACK_KIND.visual },
          { id: 'track_002', kind: TRACK_KIND.audio },
        ],
        clips: [
          voice('clip_001', { startSec: 0, durationSec: 3 }),
          voice('clip_002', { startSec: 10, durationSec: 3 }),
        ],
      });
      const r1 = addLinkedSubtitleClip(d, 'clip_001');
      const r2 = r1.ok ? addLinkedSubtitleClip(r1.doc, 'clip_002') : null;
      const subs = r2?.ok ? r2.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle) : [];
      expect(subs[1]!.y).toBe(subs[0]!.y);
    });

    // ⚠️ **画面の外へは出さない**＝出すと「置いたのに映らない」字幕が黙って生まれる。
    // 止めた結果また重なることはあるが、**見えない**より**見えて重なっている**ほうが気づける。
    it('積み上げても画面の外へは出さない', () => {
      const d = doc({
        tracks: [
          { id: 'track_001', kind: TRACK_KIND.visual },
          { id: 'track_002', kind: TRACK_KIND.audio },
        ],
        clips: [
          voice('clip_001', { startSec: 0, durationSec: 3 }),
          // 画面のいちばん上を、同じ時間の字幕がすでに占めている。
          subtitle('clip_900', { startSec: 0, durationSec: 3, y: 0, h: 1000 }),
        ],
      });
      const r = addLinkedSubtitleClip(d, 'clip_001');
      const placed = r.ok ? r.doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle && c.voiceClipId === 'clip_001') : null;
      expect(placed?.y, '画面の外（負の位置）へ置いている').toBe(0);
    });

    // ⚠️ **「置くその瞬間」しか見ない**ことを、検査として固定する（#1010 レビュー 🔴）＝
    // これは**不具合ではなく承知のうえの線引き**（あとから計算し直すと、利用者が手で置いた
    // 場所を黙って動かす）。線引きが黙って変わらないよう、いまの挙動を書いておく。
    // 重なりを**知らせる**ほうは #1014 で追う。
    it('置いた後にずらして重なっても、位置は動かさない（手で置いた場所を奪わない）', () => {
      const d = doc({
        tracks: [
          { id: 'track_001', kind: TRACK_KIND.visual },
          { id: 'track_002', kind: TRACK_KIND.audio },
          { id: 'track_003', kind: TRACK_KIND.audio },
        ],
        clips: [
          voice('clip_001', { startSec: 0, durationSec: 3 }),
          voice('clip_002', { startSec: 20, durationSec: 3, trackId: 'track_003' }, 'よろしく'),
          // 2本目の字幕が別の映像列へ行くよう、track_001 の 20〜23 を塞ぐ。
          { id: 'clip_900', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 19, durationSec: 6, x: 0, y: 0, w: 10, h: 10, text: 'x' },
        ],
      });
      const r1 = addLinkedSubtitleClip(d, 'clip_001');
      const r2 = r1.ok ? addLinkedSubtitleClip(r1.doc, 'clip_002') : null;
      // 置いた時点では時間が重なっていないので、どちらも既定の位置。
      const placed = r2?.ok ? r2.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle) : [];
      expect(placed.map((c) => c.y)).toEqual([placed[0]?.y, placed[0]?.y]);
      // あとから読み上げをずらして同じ時間にする。
      const r3 = r2?.ok ? moveClip(r2.doc, 'clip_002', { startSec: 0 }) : null;
      const after = r3?.ok ? r3.doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle) : [];
      expect(after.map((c) => c.startSec), '連動している字幕の時間は追従する').toEqual([0, 0]);
      expect(after.map((c) => c.y), '位置は据え置き（重なるが、手で置いた場所を奪わない）').toEqual(placed.map((c) => c.y));
    });

    it('積み上げた字幕もスキーマに適合する', () => {
      const r1 = addLinkedSubtitleClip(two(), 'clip_001');
      const r2 = r1.ok ? addLinkedSubtitleClip(r1.doc, 'clip_002') : null;
      expect(r2?.ok && validateTimelineProject(r2.doc)).toBe(true);
    });
  });

  it('置いた字幕はスキーマに適合する', () => {
    const d = doc({ clips: [voice('clip_001')] });
    const r = addLinkedSubtitleClip(d, 'clip_001');
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });
});
