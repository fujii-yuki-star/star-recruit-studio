// 再生位置で**絵を止める**（#356 ②・フリーズフレーム）。
import { describe, expect, it } from 'vitest';
import { FREEZE_BLOCKED, freezeFrameAt, freezeFrameIssue, freezeSourceSec, freezeStopsOriginalAudio } from './freeze';
import { SPLIT_BLOCKED } from './split';
import { EDIT_BLOCKED, setClipHoldFrame, trimClip } from './edit';
import { splitClip } from './split';
import { clipIsPassThroughVideo } from './exportSegments';
import { silenceSourceOf } from './silence';
import { volumeAt } from './audio';
import { canUseOriginalAudio, videoPlacementsOfClip, videoSourceSecAt } from './video';
import { effectiveFps } from './playback';
import { frameTimeSec } from './persistence';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { Asset } from '../project/types';
import type { TimelineClip, TimelineProject } from './types';

const movie: Asset = {
  assetId: 'asset_001', assetType: ASSET_TYPE.video, displayName: '素材', filePath: 'assets/asset_001.mp4',
};
const still: Asset = {
  assetId: 'asset_002', assetType: ASSET_TYPE.image, displayName: '写真', filePath: 'assets/asset_002.png',
};

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
    assets: [movie, still],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

const video = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
    startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080,
    assetId: 'asset_001', useOriginalAudio: true, ...over,
  }) as TimelineClip;

const freeze = (d: TimelineProject, at: number, id = 'clip_001') =>
  freezeFrameAt(d, id, at, volumeAt);

describe('freezeFrameIssue（そこで止められるか）', () => {
  it('直接置いた動画の中なら止められる', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_001', 4)).toBeNull();
  });

  // ⚠️ **枠ごと写真に化ける**のを避ける＝押した結果と食い違う（文字も立ち絵も消える）。
  it('見た目パターンのクリップは止められない（枠ごと写真に化ける）', () => {
    const d = doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, templateId: 'tmpl_001',
      } as TimelineClip],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(FREEZE_BLOCKED.notVideo);
  });

  it('写真は止められない（もう止まっている）', () => {
    expect(freezeFrameIssue(doc({ clips: [video({ assetId: 'asset_002' })] }), 'clip_001', 4))
      .toBe(FREEZE_BLOCKED.notVideo);
  });

  it('文字は止められない', () => {
    const d = doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ',
      } as TimelineClip],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(FREEZE_BLOCKED.notVideo);
  });

  // ⚠️ **分ける側の理由をそのまま使う**＝止める形は「分けて、後半を替える」なので、
  // 断る条件を2つに割らない（片方だけ直る形にしない＝§6）。
  it('帯の外では止められない（分ける側の理由をそのまま返す）', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_001', 99)).toBe(SPLIT_BLOCKED.outside);
  });

  it('固定された列では止められない', () => {
    const d = doc({
      clips: [video()],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.locked);
  });

  it('見つからないものは止められない', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_999', 4)).toBe(SPLIT_BLOCKED.notFound);
  });
});

describe('freezeSourceSec（どの瞬間で止めるか）', () => {
  /** その帯だけを置いた文書（`freezeSourceSec` は文書ごと受け取る＝正準を通すため）。 */
  const withClip = (c: TimelineClip): TimelineProject => doc({ clips: [c] });

  it('帯の頭からの秒を、素材の時刻へ直す', () => {
    const c = video({ startSec: 2, sourceStartSec: 5 });
    expect(freezeSourceSec(withClip(c), c, 6)).toBe(9); // 5 + (6-2)
  });

  // ⚠️ **速さのぶんも進む**＝置いた長さ × 速度 ＝ 使う素材の長さ（`11 §7.6.3.2`）。
  it('速さのぶんも進む（2倍なら素材は倍だけ進んでいる）', () => {
    const c = video({ startSec: 0, sourceStartSec: 0, speed: 2 });
    expect(freezeSourceSec(withClip(c), c, 3)).toBe(6);
  });

  it('頭出しを持っていなくても 0 から数える', () => {
    const c = video();
    expect(freezeSourceSec(withClip(c), c, 4)).toBe(4);
  });

  // ⚠️ **ここが #1147 の本体**（α 出口監査 🔴2）。
  //
  // 以前はここだけ `sourceStartSec + (t − startSec) × speed` と**秒の引き算で写して**いた。
  // プレビューと書き出しは `videoSourceSecAt` ＝**コマ番号から**導くので、
  // **置いた位置が格子（1/fps）に乗っていないと別のコマ**になる（最大1.5コマ×速さ）。
  // そして**置いた位置は格子に乗らない**＝置くのも分けるのも生の秒。
  //
  // ⚠️ **前の検査は `startSec: 2`（格子上）しか見ていなかった**ので、写しのままでも緑だった。
  describe('置いた位置が格子に乗っていないとき（#1147）', () => {
    /** 正準（プレビュー＝書き出し）が出す素材の秒。 */
    const canonical = (d: TimelineProject, c: TimelineClip, atSec: number): number | null => {
      const place = videoPlacementsOfClip(d, c).find((pl) => pl.clip.id === c.id);
      return place ? videoSourceSecAt(place, frameTimeSec(d, atSec), effectiveFps(d)) : null;
    };

    const cases: { name: string; over: Partial<TimelineClip>; atSec: number }[] = [
      { name: '端数のある開始', over: { startSec: 2.017, sourceStartSec: 5 }, atSec: 6 },
      { name: '端数＋倍速', over: { startSec: 2.017, sourceStartSec: 5, speed: 2 }, atSec: 6 },
      { name: '端数＋頭出しなし', over: { startSec: 0.49, sourceStartSec: 0 }, atSec: 3.2 },
      { name: '半コマちょうど', over: { startSec: 1 / 60, sourceStartSec: 0 }, atSec: 5 },
    ];
    it.each(cases)('$name：プレビュー＝書き出しと同じ秒を返す', ({ over, atSec }) => {
      const c = video(over);
      const d = withClip(c);
      expect(freezeSourceSec(d, c, atSec)).toBe(canonical(d, c, atSec));
    });

    // ⚠️ **写しのままなら本当に違う値になる**ことを、この検査自身で示す（等価な変異にしない）。
    it('写しの式は、正準と違う値を出す（だから写してはいけない）', () => {
      const c = video({ startSec: 2.017, sourceStartSec: 5, speed: 2 });
      const d = withClip(c);
      const 写し = (c.sourceStartSec ?? 0) + (6 - c.startSec) * (c.speed ?? 1);
      expect(freezeSourceSec(d, c, 6)).not.toBe(写し);
    });

    // ⚠️ **1件だけ実数で留める**（#1157 レビュー由来 ℹ️）＝上の突き合わせは**正準を呼んで比べる**
    // 形なので、丸めの取り違えは捕まえるが**相手（置き場所）の取り違えは両方に同じだけ乗って**緑になる。
    // 手で解いた値を1つ置いて、その穴を閉じる：
    // `local = round(6×30) − round(2.017×30) = 180 − 61 = 119` → `5 + 119/30`
    //（写しの式なら `5 + (6−2.017)×1 = 8.983`）。
    it('手で解いた値と合う（正準を呼ばずに留める）', () => {
      const c = video({ startSec: 2.017, sourceStartSec: 5 });
      expect(freezeSourceSec(withClip(c), c, 6)).toBeCloseTo(5 + 119 / 30, 9);
    });
  });

  // ⚠️ **速さの既定も正準へ**＝写していた側は `speed ?? 1`、正準は `effectiveSpeed`（`speed > 0` を見る）。
  it('速さが 0 でも止まらない（正準の既定に揃える）', () => {
    const c = video({ startSec: 0, sourceStartSec: 0, speed: 0 });
    const d = withClip(c);
    expect(freezeSourceSec(d, c, 4)).toBe(4);
  });

  it('映っていない相手は null（黙って 0 を返さない）', () => {
    const c = video({ assetId: 'asset_002' }); // 写真＝動画の置き場所にならない
    expect(freezeSourceSec(withClip(c), c, 4)).toBeNull();
  });

  // ⚠️ **相手を取り違えない**（#1157 レビュー由来 🟡）＝見た目パターンの帯を渡しても、
  // 差し込み口や立ち絵の置き場所を掴まない。
  // ⚠️ **いまは構造で守られている**＝`freezeSourceSec` は `templateOf` を受け取らないので、
  // 直接置きでない帯では `videoPlacementsOfClip` が見た目を解けず `[]` を返す。
  // この検査が留めているのは**その構造**（`templateOf` を足したら、ここが意味を持ち始める）。
  it('見た目パターンの帯は null（差し込み口の置き場所を掴まない）', () => {
    const c: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080,
      templateId: 'tpl_001', slotClips: { layer_slot: { startSec: 0, endSec: 5 } },
    };
    expect(freezeSourceSec(withClip(c), c, 4)).toBeNull();
  });

  // ⚠️ **格子へ落とすのは丸めだけではない**（#1147 の変異チェックで生き残った）＝
  // `frameTimeSec` は**尺のちょうど末尾を1コマ手前へ寄せる**（半開区間なので、末尾ちょうどでは
  // どの帯も外れて真っ白になる）。生の秒をそのまま渡すと、**いちばん最後で「映っていない」**になり、
  // 止められなくなる。丸めだけを見る検査では、この違いが出ない。
  it('尺のちょうど末尾でも止められる（末尾は1コマ手前へ寄る）', () => {
    const c = video({ startSec: 0, durationSec: 10, sourceStartSec: 0 });
    const d = withClip(c);
    expect(freezeSourceSec(d, c, 10)).not.toBeNull();
    expect(freezeSourceSec(d, c, 10)).toBeCloseTo(299 / 30, 6); // 30fps の最後のコマ
  });

  // ⚠️ **関門と出し口が食い違わない**（#1147 の変異チェックで生き残った）＝
  // 呼び口は `freezeFrameIssue` を通してから `freezeSourceSec` を呼ぶので、
  // **関門が通した帯で `null` が返ると「押せたのに何も起きない」**になる。
  // いまは `isDirectVideoClip` を両方が見ているので起きないが、**片方だけ緩めたら破れる**。
  it('関門が通した帯なら、素材の時刻は必ず出る', () => {
    for (const over of [{}, { startSec: 2.017 }, { speed: 0 }, { sourceStartSec: 3 }]) {
      const c = video(over);
      const d = withClip(c);
      const at = c.startSec + 1;
      expect(freezeFrameIssue(d, c.id, at)).toBeNull();
      expect(freezeSourceSec(d, c, at), `${JSON.stringify(over)} で映っていない`).not.toBeNull();
    }
  });
});

// ⚠️ **他社の同じ操作は「絵だけ止まって音は流れ続ける」**＝何も言わないと、利用者が入れた
// 「元の音を鳴らす」設定を黙って捨てたことになる（ADR-0026①・#1136 レビュー由来 🟡）。
describe('freezeStopsOriginalAudio（止めると元の音が止まるか）', () => {
  it('元の音を鳴らす設定なら、止まると知らせる', () => {
    expect(freezeStopsOriginalAudio(video({ useOriginalAudio: true }))).toBe(true);
  });

  it('既定（鳴らさない）なら、失うものが無いので知らせない', () => {
    expect(freezeStopsOriginalAudio(video({ useOriginalAudio: undefined }))).toBe(false);
    expect(freezeStopsOriginalAudio(video({ useOriginalAudio: false }))).toBe(false);
  });
});

describe('freezeFrameAt（そのコマで止める・ADR-0065）', () => {
  it('後半が「そのコマで止める」になる（前半は流れるまま）', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [head, tail] = r.doc.clips;
    expect(head!.holdFrame, '前半まで止めている').toBeUndefined();
    expect(head!.durationSec).toBe(4);
    expect(tail!.holdFrame, '後半が止まっていない').toBe(true);
    expect(tail!.startSec).toBe(4);
    expect(tail!.durationSec).toBe(6);
  });

  // ⚠️ **ファイルを作らない**＝素材は増えない・同じ動画を指したまま（ADR-0064 の発端を断つ）。
  it('素材を増やさない（同じ動画のまま）', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 4);
    if (!r.ok) return;
    expect(r.doc.assets).toBe(d.assets);
    expect(r.doc.clips[1]!.assetId).toBe('asset_001');
  });

  // ⚠️ **時間は増やさない**（ADR-0034 決定11＝押しのけは採らない）。
  it('全体の長さは変わらない（押しのけない）', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 4);
    if (!r.ok) return;
    const end = (cs: TimelineClip[]) => Math.max(...cs.map((c) => c.startSec + c.durationSec));
    expect(end(r.doc.clips)).toBe(end(d.clips));
  });

  // ⚠️ **音は連れていかない**＝止めた絵は鳴らさない（効かない項目を残さない）。
  // 使い始めと速さは**残す**＝止めるのをやめたとき、そこから同じ速さで流れる。
  it('止めた絵は音の項目を持たず、使い始めと速さは持つ', () => {
    const clip = video({
      sourceStartSec: 3, speed: 2, useOriginalAudio: true, originalAudioVolume: 0.8,
      volumePoints: [{ timeSec: 0, volume: 1 }, { timeSec: 10, volume: 0.5 }],
    });
    const r = freeze(doc({ clips: [clip] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    expect(tail.useOriginalAudio).toBeUndefined();
    expect(tail.originalAudioVolume).toBeUndefined();
    expect(tail.volumePoints).toBeUndefined();
    expect(tail.speed).toBe(2);
    expect(tail.sourceStartSec).toBe(11); // 3 + 4×2
  });

  // ⚠️ **見えていたコマで止める**（#1147 と同じ理由）＝分ける側は使い始めを生の秒で進めるので、
  // 置いた位置が格子に乗っていないと隣のコマになる。押した時に映っていた秒と同じであること。
  it('止まるのは、押した時に映っていたコマ（置いた位置が格子に乗っていなくても）', () => {
    for (const over of [{ startSec: 2.017, sourceStartSec: 5 }, { startSec: 0.49, speed: 2 }, {}]) {
      const c = video(over);
      const d = doc({ clips: [c] });
      const r = freeze(d, 6);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const tail = r.doc.clips[1]!;
      const seen = freezeSourceSec(d, c, 6);
      // 止めた後に映る秒（どの時刻でも同じ）＝押した時に映っていた秒。
      const place = videoPlacementsOfClip(r.doc, tail)[0]!;
      for (const t of [6, 7.5, tail.startSec + tail.durationSec - 0.01]) {
        expect(videoSourceSecAt(place, frameTimeSec(r.doc, t), effectiveFps(r.doc)), `${JSON.stringify(over)} @${t}`).toBe(seen);
      }
    }
  });

  // ⚠️ 上の突き合わせは正準どうしの比較なので、**手で解いた値でも1件留める**：
  // 2.017 秒に置いた動画を 6 秒で止める＝`round(6×30) − round(2.017×30) = 119` コマ目 → `5 + 119/30`。
  // 分ける側の生の秒なら `5 + 3.983 = 8.983`（隣のコマ）。
  it('手で解いた値と合う（分ける側の生の秒ではない）', () => {
    const r = freeze(doc({ clips: [video({ startSec: 2.017, sourceStartSec: 5 })] }), 6);
    if (!r.ok) return;
    expect(r.doc.clips[1]!.sourceStartSec).toBeCloseTo(5 + 119 / 30, 9);
  });

  // ⚠️ **描き方は「使える長さ 0」**＝既存の「最後のコマで凍る」を共有（プレビュー＝書き出し）。
  it('止めた部品は、使える長さ 0・音なしとして描かれる', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    if (!r.ok) return;
    const place = videoPlacementsOfClip(r.doc, r.doc.clips[1]!)[0]!;
    expect(place.durationSec).toBe(0);
    expect(place.useOriginalAudio).toBe(false);
  });

  it('箱（位置・大きさ）はそのまま引き継ぐ', () => {
    const r = freeze(doc({ clips: [video({ x: 100, y: 200, w: 640, h: 360 })] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    expect([tail.x, tail.y, tail.w, tail.h]).toEqual([100, 200, 640, 360]);
  });

  // ⚠️ **止めても動かし続けられる**＝寄る・回す演出は絵が止まってからが本番。
  it('動き（キーフレーム）は分ける側が整えたものを引き継ぐ', () => {
    const d = doc({
      clips: [video()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scale: 1 }, { timeSec: 10, scale: 2 }] }],
    });
    const r = freeze(d, 4);
    if (!r.ok) return;
    const tailId = r.doc.clips[1]!.id;
    const forTail = (r.doc.animations ?? []).find((a) => a.targetId === tailId);
    expect(forTail, '止めた絵に動きが引き継がれていない').toBeTruthy();
    expect(forTail!.keyframes[0]!.timeSec, '後半の時刻が自分の先頭からになっていない').toBe(0);
  });

  it('止められない所では、理由を返して文書を変えない', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(SPLIT_BLOCKED.outside);
  });

  it('できた文書は正典（schema）に通る', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateTimelineProject(r.doc), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});

describe('setClipHoldFrame（止めるのをやめる・止める）', () => {
  it('やめると流れる動画に戻る（使い始めと速さはそのまま）', () => {
    const r = freeze(doc({ clips: [video({ speed: 2 })] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    const u = setClipHoldFrame(r.doc, tail.id, false);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    const back = u.doc.clips[1]!;
    expect(back.holdFrame).toBeUndefined();
    expect(back.sourceStartSec).toBe(tail.sourceStartSec);
    expect(back.speed).toBe(2);
    expect(videoPlacementsOfClip(u.doc, back)[0]!.durationSec, '流れる長さに戻っていない').toBe(back.durationSec);
  });

  it('止めると音の項目を落とす（止める側と同じ形）', () => {
    const r = setClipHoldFrame(doc({ clips: [video({ useOriginalAudio: true, originalAudioVolume: 0.5 })] }), 'clip_001', true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.doc.clips[0]!;
    expect(c.holdFrame).toBe(true);
    expect(c.useOriginalAudio).toBeUndefined();
    expect(c.originalAudioVolume).toBeUndefined();
  });

  it('同じ状態なら文書をそのまま返す（履歴を積まない）', () => {
    const d = doc({ clips: [video()] });
    const r = setClipHoldFrame(d, 'clip_001', false);
    expect(r.ok && r.doc).toBe(d);
  });

  it('動画でない部品・固定した列・見つからないものは断る', () => {
    expect(setClipHoldFrame(doc({ clips: [video({ assetId: 'asset_002' })] }), 'clip_001', true))
      .toEqual({ ok: false, reason: EDIT_BLOCKED.freezeNotVideo });
    const locked = doc({
      clips: [video()],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }],
    });
    expect(setClipHoldFrame(locked, 'clip_001', true)).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    expect(setClipHoldFrame(doc({ clips: [video()] }), 'clip_999', true)).toEqual({ ok: false, reason: EDIT_BLOCKED.notFound });
  });

  // ⚠️ **手で書いた文書でも鳴らさない**＝`useOriginalAudio` が残っていても、止めている間は音なし。
  it('止めた部品は、元の音の設定が残っていても鳴らない・欄も出さない', () => {
    const c = video({ holdFrame: true, useOriginalAudio: true });
    // 音の入った動画（止めていなければ鳴る・欄も出る）。
    const d = doc({ clips: [c], assets: [{ ...movie, metadata: { hasAudio: true } }, still] });
    expect(canUseOriginalAudio(d, { ...c, holdFrame: undefined }), '前提：止めていなければ欄が出る').toBe(true);
    expect(videoPlacementsOfClip(d, { ...c, holdFrame: undefined })[0]!.useOriginalAudio, '前提：止めていなければ鳴る').toBe(true);
    expect(videoPlacementsOfClip(d, c)[0]!.useOriginalAudio).toBe(false);
    expect(canUseOriginalAudio(d, c)).toBe(false);
  });
});

// ⚠️ **止めた絵は素材の時間を進めない**（PR レビュー由来 🔴）＝分ける・詰める・伸ばすで映るコマを変えず、
// 素材の終わりを理由に断らない（押しのけを採らないので、伸ばすのが止めた絵を長くする唯一の道＝ADR-0034 決定11）。
describe('止めた絵の編集（素材の時間を進めない）', () => {
  // 10 秒の動画を 9 秒で止める＝後半は使い始め 9 秒・長さ 1 秒。
  const movie10: Asset = { ...movie, metadata: { durationSec: 10, hasAudio: true } };
  const held = (): { d: TimelineProject; id: string } => {
    const r = freeze(doc({ assets: [movie10, still], clips: [video({ useOriginalAudio: undefined })] }), 9);
    if (!r.ok) throw new Error(r.reason);
    return { d: r.doc, id: r.newClipId };
  };

  it('素材の終わり近くで止めても、右端を伸ばせる', () => {
    const { d, id } = held();
    const moved = { ...d, clips: d.clips.filter((c) => c.id === id) }; // 後ろに隣を置かない
    const r = trimClip(moved, id, 'end', 15);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('止めていない動画は、素材の終わりより先へは伸ばせない（比べる相手）', () => {
    const d = doc({ assets: [movie10, still], clips: [video({ sourceStartSec: 9, durationSec: 1, useOriginalAudio: undefined })] });
    expect(trimClip(d, 'clip_001', 'end', 5).ok).toBe(false);
  });

  it('止めた絵を分けても、どちらも同じコマのまま（素材の終わり近くでも断らない）', () => {
    const { d, id } = held();
    // 伸ばしてから、素材の終わり（10 秒）を越えた所で分ける＝進めて数えると「使い切った」で断られる。
    const long = trimClip({ ...d, clips: d.clips.filter((c) => c.id === id) }, id, 'end', 15);
    if (!long.ok) throw new Error(long.reason);
    const r = splitClip(long.doc, id, 13, volumeAt);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const src = r.doc.clips.map((c) => c.sourceStartSec);
    expect(src[0]).toBe(src[1]);
  });

  it('止めた絵の左端を詰めても、映るコマは変わらない', () => {
    const { d, id } = held();
    const before = d.clips.find((c) => c.id === id)!.sourceStartSec;
    const r = trimClip({ ...d, clips: d.clips.filter((c) => c.id === id) }, id, 'start', 9.5);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips[0]!.sourceStartSec).toBe(before);
  });

  // ⚠️ **書き出しで流さない**（PR レビュー由来 🔴）＝「そのまま流せる動画」に数えると FFmpeg が動画を流す。
  it('書き出しで「そのまま流す動画」に数えない（止めていなければ数える）', () => {
    const { d, id } = held();
    const tail = d.clips.find((c) => c.id === id)!;
    expect(clipIsPassThroughVideo({ ...tail, holdFrame: undefined }, () => false), '前提').toBe(true);
    expect(clipIsPassThroughVideo(tail, () => false)).toBe(false);
  });

  it('無音探し・文字起こしの相手にしない（鳴っていない音）', () => {
    const { d, id } = held();
    const tail = d.clips.find((c) => c.id === id)!;
    expect(silenceSourceOf(d, { ...tail, holdFrame: undefined }), '前提').not.toBeNull();
    expect(silenceSourceOf(d, tail)).toBeNull();
  });
});
