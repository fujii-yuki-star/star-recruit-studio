// 再生位置で**絵を止める**（#356 ②・フリーズフレーム）。
import { describe, expect, it } from 'vitest';
import { FREEZE_BLOCKED, freezeFrameAt, freezeFrameIssue, freezeSourceSec, freezeStopsOriginalAudio } from './freeze';
import { SPLIT_BLOCKED } from './split';
import { volumeAt } from './audio';
import { videoPlacementsOfClip, videoSourceSecAt } from './video';
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
  assetId: 'asset_002', assetType: ASSET_TYPE.image, displayName: '止めた絵', filePath: 'assets/asset_002.png',
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
  freezeFrameAt(d, id, at, 'asset_002', volumeAt);

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

describe('freezeSourceSec（どの瞬間を切り出すか）', () => {
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

describe('freezeFrameAt（止めた絵に替える）', () => {
  it('後半が「止めた絵」になる（前半は動画のまま）', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [head, tail] = r.doc.clips;
    expect(head!.assetId, '前半まで写真に替えている').toBe('asset_001');
    expect(head!.durationSec).toBe(4);
    expect(tail!.assetId, '後半が止めた絵になっていない').toBe('asset_002');
    expect(tail!.startSec).toBe(4);
    expect(tail!.durationSec).toBe(6);
  });

  // ⚠️ **時間は増やさない**（ADR-0034 決定11＝押しのけは採らない）。
  it('全体の長さは変わらない（押しのけない）', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 4);
    if (!r.ok) return;
    const end = (cs: TimelineClip[]) => Math.max(...cs.map((c) => c.startSec + c.durationSec));
    expect(end(r.doc.clips)).toBe(end(d.clips));
  });

  // ⚠️ **効かない項目を残さない**＝写真に速さ・頭出し・元の音は無い（置いた覚えのない値を作らない）。
  it('止めた絵は、動画だけの項目を持たない', () => {
    const clip = video({ sourceStartSec: 3, speed: 2, useOriginalAudio: true, originalAudioVolume: 0.8 });
    const r = freeze(doc({ clips: [clip] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    expect(tail.sourceStartSec).toBeUndefined();
    expect(tail.speed).toBeUndefined();
    expect(tail.useOriginalAudio).toBeUndefined();
    expect(tail.originalAudioVolume).toBeUndefined();
    expect(tail.volumePoints).toBeUndefined();
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
    if (!r.ok) return;
    expect(validateTimelineProject(r.doc), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});
