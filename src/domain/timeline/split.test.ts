// 帯を再生位置で分ける（#686 段階4・ADR-0034 決定16）。
import { describe, expect, it } from 'vitest';
import { splitClip, splitClipIssue, splitKeyframes, splitVolumePoints, SPLIT_BLOCKED } from './split';
import { VOLUME_POINTS_MAX } from '../constants';
import { interpolateKeyframes, KEYFRAME_PROPS } from '../project/keyframes';
import { volumeAt } from './audio';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { Keyframe } from '../project/types';
import type { TimelineClip, TimelineProject } from './types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260810_001',
    projectName: 'テスト',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

const text = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ', ...over }) as TimelineClip;

const split = (d: TimelineProject, id: string, at: number) => splitClip(d, id, at, volumeAt);

describe('splitClipIssue（そこで分けられるか）', () => {
  it('帯の中なら分けられる', () => {
    expect(splitClipIssue(doc({ clips: [text()] }), 'clip_001', 4)).toBeNull();
  });

  it('**読み上げは切れない**（文と音がずれる）', () => {
    const d = doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 10, voice: { text: 'あ', status: 'none' } } as TimelineClip] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.unsplittable);
  });

  it('**連動している字幕も切れない**（時間は読み上げが決める）', () => {
    const d = doc({ clips: [text({ kind: TIMELINE_CLIP_KIND.subtitle, voiceClipId: 'clip_009' })] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.unsplittable);
  });

  it('固定した列では分けられない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }], clips: [text()] });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.locked);
  });

  it('帯の外・端では分けられない（片方が潰れる切り方をさせない）', () => {
    const d = doc({ clips: [text()] });
    expect(splitClipIssue(d, 'clip_001', 0)).toBe(SPLIT_BLOCKED.outside);
    expect(splitClipIssue(d, 'clip_001', 10)).toBe(SPLIT_BLOCKED.outside);
    expect(splitClipIssue(d, 'clip_001', 0.05)).toBe(SPLIT_BLOCKED.outside); // 最小の長さに満たない
    expect(splitClipIssue(d, 'clip_001', 20)).toBe(SPLIT_BLOCKED.outside);
  });
});

describe('splitClip（分ける）', () => {
  it('前半は**同じ id のまま**・後半が新しい id（選択や連動の参照が切れない）', () => {
    const r = split(doc({ clips: [text()] }), 'clip_001', 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips[0]).toMatchObject({ id: 'clip_001', startSec: 0, durationSec: 4 });
    expect(r.doc.clips[1]).toMatchObject({ id: r.newClipId, startSec: 4, durationSec: 6 });
    expect(r.newClipId).not.toBe('clip_001');
  });

  it('合計の長さは変わらない（切っただけ）', () => {
    const r = split(doc({ clips: [text({ startSec: 2, durationSec: 9 })] }), 'clip_001', 5);
    expect(r.ok && r.doc.clips[0].durationSec + r.doc.clips[1].durationSec).toBeCloseTo(9, 6);
  });

  it('**素材のどこから使うか**を進める（速度ぶんも進む）', () => {
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 10, assetId: 'asset_001', sourceStartSec: 3, speed: 2 } as TimelineClip],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(3); // 前半はそのまま
    expect(r.ok && r.doc.clips[1].sourceStartSec).toBeCloseTo(3 + 4 * 2, 6); // 置いた長さ×速度ぶん進む
  });

  it('**フェードは前後に残す**（真ん中に切れ目の音を作らない）', () => {
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 10, assetId: 'asset_001', fadeInSec: 1, fadeOutSec: 2 } as TimelineClip],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ fadeInSec: 1 });
    expect(r.ok && 'fadeOutSec' in r.doc.clips[0]).toBe(false); // 前半に抜けは付けない
    expect(r.ok && r.doc.clips[1]).toMatchObject({ fadeOutSec: 2 });
    expect(r.ok && 'fadeInSec' in r.doc.clips[1]).toBe(false); // 後半に入りは付けない
  });

  it('分けた結果はスキーマに適合する（開けない動画を作らない）', () => {
    const r = split(doc({ clips: [text()] }), 'clip_001', 4);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('分けられないときは文書を変えない', () => {
    const d = doc({ clips: [text()] });
    const r = split(d, 'clip_001', 0);
    expect(r.ok).toBe(false);
    expect(d.clips).toHaveLength(1);
  });
});

/** 分けられる前提で取り出す（分けられない場合は別のテストで見る）。 */
function cut(keyframes: readonly Keyframe[], headSec: number): { head: Keyframe[]; tail: Keyframe[] } {
  const r = splitKeyframes(keyframes, headSec);
  expect(r).not.toBeNull();
  return r as { head: Keyframe[]; tail: Keyframe[] };
}

describe('splitKeyframes（動きを分ける）', () => {
  const kf = [
    { timeSec: 0, x: 0 },
    { timeSec: 10, x: 100 },
  ];

  it('**分割点の値を両端に焼く**（切っただけで絵が飛ばない）', () => {
    const { head, tail } = cut(kf, 4);
    expect(head[head.length - 1]).toMatchObject({ timeSec: 4, x: 40 }); // 前半の終わり＝そのときの値
    expect(tail[0]).toMatchObject({ timeSec: 0, x: 40 }); // 後半の始まり＝同じ値
  });

  it('後半の時刻は**自分の先頭からの秒**へ直す', () => {
    const { tail } = cut(kf, 4);
    expect(tail[tail.length - 1]).toMatchObject({ timeSec: 6, x: 100 });
  });

  it('動きが無ければ何も作らない', () => {
    expect(splitKeyframes([], 4)).toEqual({ head: [], tail: [] });
  });

  it('**持っていない項目は焼かない**（切っただけで動く対象が増えない）', () => {
    const { head, tail } = cut([{ timeSec: 0, opacity: 1 }, { timeSec: 10, opacity: 0 }], 4);
    expect(Object.keys(head[head.length - 1]).sort()).toEqual(['opacity', 'timeSec']);
    expect(Object.keys(tail[0]).sort()).toEqual(['opacity', 'timeSec']);
  });
});

// #753＝**部分曲線を焼く**。分割点の値だけでなく**動き方（カーブ）の形**を前後へ持ち越す。
// 確かめ方は Issue のとおり＝**切る前と切った後で、区間の中の複数点の値が一致する**
// （境界だけ合っていて軌跡が別物、を通さない）。
/** 切る前後で同じ時刻の値が一致するか（全プロパティ・区間の中を細かく見る）。 */
function expectSameMotion(keyframes: readonly Keyframe[], headSec: number, totalSec: number): void {
  const { head, tail } = cut(keyframes, headSec);
  for (let i = 0; i <= 40; i += 1) {
    const t = (totalSec * i) / 40;
    const before = interpolateKeyframes(keyframes, t);
    const after = t < headSec ? interpolateKeyframes(head, t) : interpolateKeyframes(tail, t - headSec);
    for (const prop of KEYFRAME_PROPS) {
      if (before[prop] == null) {
        expect(after[prop]).toBeUndefined();
        continue;
      }
      // ⚠️ 比べる桁＝**目に見えない桁**まで。カーブを解く許容誤差（進み具合で 1e-7）が制御点へ伝わるので
      // 完全一致にはならない。1e-4 は 1920px の画面で**1画素の1万分の1**＝見た目に出ない。
      // 取り違え（前後の入れ替え・別のキーフレームを見る・動き方の落ち）は**桁が違う**ので捕まる。
      expect(after[prop] ?? Number.NaN).toBeCloseTo(before[prop] as number, 4);
    }
  }
}

describe('動き方（カーブ）を前後へ焼く（#753）', () => {
  it('名前つきのカーブ（だんだん速く）の途中で切っても軌跡が変わらない', () => {
    expectSameMotion([{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100, easing: 'ease-in' }], 4, 10);
  });

  // ⚠️ **切れ目の進み具合が 0〜1 の外にある形**を2つとも通す（変異チェックで判明）。
  // `y` は丸めない＝**行き過ぎて戻る**動きが書けるので、正規化は**符号ごと**割る必要がある。
  // 「カーブが自由」というだけの材料では、切れ目がたまたま 0〜1 の中に来て**符号の取り違えが素通り**する。
  it('切れ目が**行き過ぎた先**（着く値を追い越した所）にあっても軌跡が変わらない', () => {
    // 進み具合は切れ目で 1.29＝後半は「戻る」動き（残りの幅が負）。
    const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 8, x: 100, easing: { bezier: [0.2, 2.5, 0.8, 1.0] } }];
    expectSameMotion(kfs, 2, 8);
  });

  it('切れ目が**戻った先**（始まりより手前へ振れた所）にあっても軌跡が変わらない', () => {
    // 進み具合は切れ目で −0.51＝前半の幅が負。
    const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 8, x: 100, easing: { bezier: [0.2, -1.5, 0.8, 0.5] } }];
    expectSameMotion(kfs, 1.2, 8);
  });

  it('同じ区間を複数のプロパティがまたいでも軌跡が変わらない', () => {
    const kfs: Keyframe[] = [
      { timeSec: 0, x: 0, y: 10, opacity: 0 },
      { timeSec: 10, x: 100, y: -20, opacity: 1, easing: 'ease-out' },
    ];
    expectSameMotion(kfs, 6.5, 10);
  });

  it('またがないプロパティ（区間が前半・後半で完結）が混ざっていても軌跡が変わらない', () => {
    const kfs: Keyframe[] = [
      { timeSec: 0, x: 0 },
      { timeSec: 2, opacity: 0 },
      { timeSec: 3, opacity: 1, easing: 'ease-in' }, // 前半で完結
      { timeSec: 10, x: 100, easing: 'ease-out' }, // またぐ
      { timeSec: 12, scale: 2 },
      { timeSec: 14, scale: 3, easing: 'ease-in' }, // 後半で完結
    ];
    expectSameMotion(kfs, 6, 14);
  });

  // ⚠️ **直線どうしは「同じ形」**（レビュー前の自己点検で判明）＝直線を切った部分曲線は
  // **対角線上の別の数値**になるので、数値だけで比べると**別のカーブが要る**と誤って断る。
  it('別々の直線の区間を2つのプロパティがまたいでも分けられる（数値の違いで断らない）', () => {
    // ⚠️ **切れ目までの進み具合をわざと変える**（x は 0.5・opacity は 0.3）＝同じなら
    // 部分曲線もたまたま一致してしまい、比べ方の誤りが素通りする。
    const kfs: Keyframe[] = [
      { timeSec: 0, x: 0 },
      { timeSec: 2, opacity: 0 },
      { timeSec: 10, x: 100 },
      { timeSec: 12, opacity: 1 },
    ];
    expect(splitKeyframes(kfs, 5)).not.toBeNull();
    expectSameMotion(kfs, 5, 12);
  });

  it('直線の区間なら動き方を書かない（いままでの形のまま）', () => {
    const { head, tail } = cut([{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100 }], 4);
    expect(head[head.length - 1].easing).toBeUndefined();
    expect(tail[tail.length - 1].easing).toBeUndefined();
  });

  // ⚠️ ここが #753 の本体＝**前半の最後**と**またいだ区間の行き先**にカーブが書かれる。
  it('前半の最後と、後半の行き先に、切り分けたカーブが入る', () => {
    const { head, tail } = cut([{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100, easing: 'ease-in' }], 4);
    expect(head[head.length - 1].easing).toHaveProperty('bezier');
    expect(tail[tail.length - 1].easing).toHaveProperty('bezier');
    // 後半の先頭は**いちばん最初**＝手前に区間が無いので持たない。
    expect(tail[0].easing).toBeUndefined();
  });

  // ⚠️ レビュー 🔴（2観点が独立に検出）＝**切れ目ちょうどのキーフレームの動き方が落ちていた**。
  // `head` は「切れ目より前」で絞るのでそのキーフレームは消え、置き換わる境界の値には動き方が載らない
  // ＝**その手前の区間が直線になる**（実測で最大 7.5px ずれた）。しかも断り文言は
  // 「『動き』の欄に出ている秒数の位置で分けてください」＝**この経路を薦めている**。
  describe('切れ目ちょうどのキーフレーム（薦めている分け方）', () => {
    it('その動き方を引き継ぐ（前半が直線に化けない）', () => {
      expectSameMotion([{ timeSec: 0, x: 0 }, { timeSec: 4, x: 40, easing: 'ease-in' }, { timeSec: 10, x: 100 }], 4, 10);
    });

    it('またぐ区間と形が食い違うときは分けない（どちらかの動きが黙って変わる）', () => {
      const kfs: Keyframe[] = [
        { timeSec: 0, x: 0, opacity: 0 },
        { timeSec: 4, opacity: 1, easing: 'ease-out' }, // 切れ目ちょうど＝そのまま引き継ぎたい
        { timeSec: 10, x: 100, easing: 'ease-in' }, // またぐ＝切り分けたい
      ];
      expect(splitKeyframes(kfs, 4)).toBeNull();
    });

    // ⚠️ 引き継ぐのは**手前から入る区間があるとき**だけ（変異チェックで判明）＝そこが最初の
    // キーフレームなら、その動き方は前半のどの区間にも効かない。条件を見ずに引き継ぐと、
    // **表せない形（「両端ゆっくり」）が付いているだけで断ってしまう**（何も変わらないのに）。
    it('そこが最初のキーフレームなら、表せない動き方が付いていても断らない', () => {
      const kfs: Keyframe[] = [
        { timeSec: 0, x: 0 },
        { timeSec: 4, opacity: 1, easing: 'ease-in-out' }, // opacity はこれ1つ＝どの区間にも効かない
        { timeSec: 10, x: 100, easing: 'ease-in' },
      ];
      expect(splitKeyframes(kfs, 4)).not.toBeNull();
      expectSameMotion(kfs, 4, 10);
    });

    it('開始秒の引き算でずれても「ちょうど」と見なす（開始秒で結果が変わらない）', () => {
      const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 4.033333, x: 40, easing: 'ease-in' }, { timeSec: 10, x: 100 }];
      for (const start of [0, 20, 12.3, 7.1]) {
        // 画面と同じ引き算（`atSec − clip.startSec`）＝**丸めのずれが出る**。
        expect(splitKeyframes(kfs, start + 4.033333 - start)).not.toBeNull();
      }
    });
  });

  // ⚠️ レビュー ℹ️＝「同じ形なら通す」側（断らない方）も見る。断る側だけだと、
  // **何でも断る**実装でもテストが通ってしまう。
  it('書き直す相手が後半だけの区間の行き先でもあっても、形が同じなら分けられる', () => {
    const kfs: Keyframe[] = [
      { timeSec: 0, x: 0 },
      { timeSec: 7, scale: 1 },
      { timeSec: 10, x: 100, scale: 2 }, // どちらも直線＝食い違わない
    ];
    expect(splitKeyframes(kfs, 4)).not.toBeNull();
    expectSameMotion(kfs, 4, 10);
  });

  describe('焼けないときは分けない（近い形で置き換えない・#262 と同じ流儀）', () => {
    // ⚠️ レビュー 🔴＝**置けない値を焼こうとしていた**。行き過ぎて戻るカーブは区間の途中で端を越えるので、
    // そこで切ると濃さ 1.09・大きさ −0.07 のような値を焼くことになり、**schema が拒む＝保存されない**
    // （画面では分かれて見えるのに保存だけ落ちる）。収めて焼くと軌跡が変わるので断る側に倒す。
    it('切れ目の値が「置ける値」の外へ出るときは分けない（保存できない文書を作らない）', () => {
      const kfs: Keyframe[] = [
        { timeSec: 0, opacity: 0, scale: 2 },
        { timeSec: 10, opacity: 1, scale: 0.1, easing: { bezier: [0.34, 1.56, 0.64, 1] } },
      ];
      expect(splitKeyframes(kfs, 5)).toBeNull();
    });

    // ⚠️ レビュー 🟡＝**ハンドルが交差した形**（始めの強さ > 終わりの強さ）は、切ると制御点の
    // 時間軸が 0〜1 を外れる＝そのまま書けない。画面の「自由なカーブ」で普通に作れる値なので、
    // 「切れないことがある」を規則として固定しておく（正典 `11 §7.6.3` にも記載）。
    it('ハンドルが交差したカーブは、真ん中以外では分けない', () => {
      const kfs: Keyframe[] = [{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100, easing: { bezier: [1, 0, 0, 1] } }];
      expect(splitKeyframes(kfs, 3)).toBeNull();
      expect(splitKeyframes(kfs, 7)).toBeNull();
      expect(splitKeyframes(kfs, 5)).not.toBeNull(); // 対称な形なので真ん中だけは書ける
    });

    it('「両端ゆっくり」は3次ベジェで表せないので分けない', () => {
      expect(splitKeyframes([{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100, easing: 'ease-in-out' }], 4)).toBeNull();
    });

    it('プロパティごとに別のカーブが要るときは分けない', () => {
      // x は [0,10] を ease-in／opacity は [2,8] を ease-out＝同じ切れ目でも前半のカーブが別物。
      const kfs: Keyframe[] = [
        { timeSec: 0, x: 0 },
        { timeSec: 2, opacity: 0 },
        { timeSec: 8, opacity: 1, easing: 'ease-out' },
        { timeSec: 10, x: 100, easing: 'ease-in' },
      ];
      expect(splitKeyframes(kfs, 5)).toBeNull();
    });

    it('またぐ区間の行き先が、後半だけで完結する区間の行き先でもあるときは分けない', () => {
      // 同じキーフレーム（t=10）へ x はまたいで入り、scale は後半（t=7）から入る。
      const kfs: Keyframe[] = [
        { timeSec: 0, x: 0 },
        { timeSec: 7, scale: 1 },
        { timeSec: 10, x: 100, scale: 2, easing: 'ease-in' },
      ];
      expect(splitKeyframes(kfs, 4)).toBeNull();
    });
  });

  // ⚠️ **区間の動き方は「入る側（当KF）」が持つ**（正典 `11 §7.6`・`interpolateKeyframes` も当KF を見る）。
  // 門が「出る側」を見ていたため、**カーブの区間を素通りさせ**（軌跡が黙って変わる）、
  // **直線の区間を断って**いた（#753 で判明）。
  describe('区間の動き方は入る側のキーフレームが持つ', () => {
    const animDoc = (keyframes: Keyframe[]): TimelineProject =>
      doc({
        clips: [text()],
        animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes }],
      });

    it('入る側がカーブの区間は分けない（素通りさせない）', () => {
      const d = animDoc([{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100, easing: 'ease-in-out' }]);
      expect(splitClipIssue(d, 'clip_001', 5)).toBe(SPLIT_BLOCKED.curvedEasing);
    });

    it('出る側だけがカーブの区間は分けられる（実際は直線＝断る理由が無い）', () => {
      const d = animDoc([{ timeSec: 0, x: 0, easing: 'ease-in-out' }, { timeSec: 10, x: 100 }]);
      expect(splitClipIssue(d, 'clip_001', 5)).toBeNull();
    });
  });
});

describe('splitVolumePoints（音量の変化を分ける）', () => {
  it('切れ目の音量を両端に焼く', () => {
    const pts = [{ timeSec: 0, volume: 1 }, { timeSec: 10, volume: 0 }];
    const { head, tail } = splitVolumePoints(pts, 4, volumeAt(pts, 4));
    expect(head?.[head.length - 1]).toMatchObject({ timeSec: 4, volume: 0.6 });
    expect(tail?.[0]).toMatchObject({ timeSec: 0, volume: 0.6 });
    expect(tail?.[tail.length - 1]).toMatchObject({ timeSec: 6, volume: 0 });
  });

  it('点が無ければ何も持たせない（空の入れ物を作らない）', () => {
    expect(splitVolumePoints(undefined, 4, undefined)).toEqual({});
  });
});

// #750 レビューで出た穴（2名のレビュアが独立に指摘したものを含む）。
describe('分けたときに持ち越すもの（#750 レビュー）', () => {
  const audio = (over: Partial<TimelineClip> = {}): TimelineClip =>
    ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 10, assetId: 'asset_001', ...over }) as TimelineClip;
  const withAudio = (clip: TimelineClip, over: Partial<TimelineProject> = {}) => doc({
    assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
    clips: [clip],
    ...over,
  });

  it('🔴 **置いたばかりの音**でも後半は続きから鳴る（曲の頭へ戻らない）', () => {
    // ⚠️ 「`sourceStartSec` か `speed` を持っていたら」という条件だと、既定の音（両方とも持たない）が
    // 漏れて**後半が曲の頭から鳴り直す**。持っているかどうかでなく**種類**で決める。
    const r = split(withAudio(audio()), 'clip_001', 4);
    expect(r.ok && r.doc.clips[1].sourceStartSec).toBeCloseTo(4, 6);
  });

  it('素材の時間を持たない種類には書かない（意味の無い項目を増やさない）', () => {
    const r = split(doc({ clips: [text()] }), 'clip_001', 4);
    expect(r.ok && 'sourceStartSec' in r.doc.clips[1]).toBe(false);
  });

  it('🔴 **後半もまとまりに入る**（分割点から先だけフェードや変形が外れない）', () => {
    const d = doc({
      clips: [text(), text({ id: 'clip_002', startSec: 0, durationSec: 10 })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.groups?.[0].members).toContain(r.newClipId);
    expect(r.doc.groups?.[0].members).toContain('clip_001'); // 前半も残る
  });

  it('まとまりに入っていない帯は、まとまりを増やさない', () => {
    const d = doc({
      clips: [text(), text({ id: 'clip_002', startSec: 20, durationSec: 5 })],
      groups: [{ id: 'group_001', members: ['clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    const r = split(d, 'clip_001', 4);
    expect(r.ok && r.doc.groups?.[0].members).toEqual(['clip_002']);
  });

  it('🟡 音量の点が上限を超えるなら断る（置けたのに書き出しで断られる、を作らない）', () => {
    const pts = Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));
    const d = withAudio(audio({ volumePoints: pts }));
    // 全部が前半側＝境界の点を足すと上限+1。
    expect(splitClipIssue(d, 'clip_001', 9)).toBe(SPLIT_BLOCKED.volumePointsFull);
  });

  // ⚠️ #753 で**通るようになった**＝カーブは前後へ焼けるので、断るのは**焼けない形のときだけ**。
  // （このテストは以前「出る側にカーブがある区間」を断る想定だったが、**区間の動き方は入る側が持つ**
  //   ＝あの並びの区間は実際には直線で、断る理由が無かった。）
  it('🟡 **焼けない動き方**の区間の中では断る（軌跡が黙って変わる）', () => {
    const d = doc({
      clips: [text()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [
        { timeSec: 0, x: 0 },
        { timeSec: 10, x: 100, easing: 'ease-in-out' },
      ] }],
    });
    expect(splitClipIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.curvedEasing);
  });

  it('焼けるカーブの区間の中なら分けられる（#753）', () => {
    const d = doc({
      clips: [text()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [
        { timeSec: 0, x: 0 },
        { timeSec: 10, x: 100, easing: 'ease-in' },
      ] }],
    });
    expect(splitClipIssue(d, 'clip_001', 4)).toBeNull();
  });

  it('直線の動き・キーフレームちょうどなら通す（切っても軌跡が変わらない）', () => {
    const straight = doc({
      clips: [text()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [
        { timeSec: 0, x: 0 }, { timeSec: 4, x: 40, easing: 'ease-in' }, { timeSec: 10, x: 100 },
      ] }],
    });
    expect(splitClipIssue(straight, 'clip_001', 4)).toBeNull(); // 区間の境目
    // ⚠️ **通ることだけでなく軌跡も見る**（レビュー指摘）＝この題は「切っても軌跡が変わらない」と
    // 名乗るのに戻り値しか見ておらず、**切れ目のキーフレームの動き方が落ちる**のを見逃していた。
    expectSameMotion([{ timeSec: 0, x: 0 }, { timeSec: 4, x: 40, easing: 'ease-in' }, { timeSec: 10, x: 100 }], 4, 10);
    const linear = doc({
      clips: [text()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 10, x: 100 }] }],
    });
    expect(splitClipIssue(linear, 'clip_001', 4)).toBeNull();
  });
});
