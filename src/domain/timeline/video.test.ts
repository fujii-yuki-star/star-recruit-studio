import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { compositeSpansOthers, cropPivotDiffers, videoAssetIdOfClip, videoAssetIds, videoClipsOf, videoFrameIndexAt, videoSourceSecAt, videoStagePlan } from './video';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260819_001',
    projectName: 'テスト',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: 'video', displayName: '紹介ムービー', filePath: 'a.mp4' },
      { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'b.png' },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [],
    ...over,
  }) as TimelineProject;

const slot = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
    startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001', ...over,
  }) as TimelineClip;

describe('動画を映す部品を見分ける（#512 段1）', () => {
  it('直接置いた動画の素材だけを対象にする', () => {
    const ids = videoAssetIds(doc());
    expect(videoAssetIdOfClip(slot(), ids)).toBe('asset_001');
    expect(videoAssetIdOfClip(slot({ assetId: 'asset_002' }), ids)).toBeNull(); // 写真
    expect(videoAssetIdOfClip(slot({ assetId: undefined }), ids)).toBeNull(); // 空の枠
  });

  // ⚠️ 段1 は**直接置き**だけ＝見た目パターンの差し込み口（`assetRefs`）は段3。
  // ここで拾ってしまうと「映ると思ったのに映らない」を黙って作る。
  it('見た目パターンの差し込み口はまだ対象にしない', () => {
    const ids = videoAssetIds(doc());
    const tmpl = { ...slot(), kind: TIMELINE_CLIP_KIND.template, assetId: undefined, templateId: 'tmpl_001', assetRefs: { background: 'asset_001' } } as TimelineClip;
    expect(videoAssetIdOfClip(tmpl, ids)).toBeNull();
  });

  // ⚠️ **種類を見ないと素通りする**（変異チェックで判明）＝上の材料は `assetId` を持たないので、
  // 種類の判定を外しても落ちなかった。**動画のファイルを音として置いた部品**は `assetId` を持つので、
  // ここで「絵として映る部品」と取り違えると、音の列に絵を出そうとする。
  it('動画のファイルを音として置いた部品は、絵の対象にしない', () => {
    const ids = videoAssetIds(doc());
    const audio = { ...slot(), kind: TIMELINE_CLIP_KIND.audio, assetId: 'asset_001' } as TimelineClip;
    expect(videoAssetIdOfClip(audio, ids)).toBeNull();
  });

  it('文書から動画の部品だけを集める', () => {
    const d = doc({ clips: [slot(), slot({ id: 'clip_002', assetId: 'asset_002' })] });
    expect(videoClipsOf(d).map((c) => c.id)).toEqual(['clip_001']);
  });

  // ⚠️ **描かれないものは含めない**＝動画に出ない素材のコマまで焼くと、そのファイルが欠けているだけで
  // **書き出し全体が失敗する**（出ないものを理由に断ることになる）。
  it('隠した部品・隠した列・隠したまとまりは含めない', () => {
    expect(videoClipsOf(doc({ clips: [slot({ hidden: true })] }))).toEqual([]);
    expect(
      videoClipsOf(doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }], clips: [slot()] })),
    ).toEqual([]);
    expect(
      videoClipsOf(
        doc({
          clips: [slot()],
          groups: [{ id: 'group_001', members: ['clip_001'], hidden: true, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('焼き出す区間（videoStagePlan）', () => {
  it('トリムから、置いた長さぶん、速さ込みで焼く', () => {
    expect(videoStagePlan(slot({ sourceStartSec: 4, durationSec: 6, speed: 2 }))).toEqual({
      sourceStartSec: 4, durationSec: 6, speed: 2,
    });
  });

  it('速さの未指定・0以下は等速として扱う（0 で割らない）', () => {
    expect(videoStagePlan(slot()).speed).toBe(1);
    expect(videoStagePlan(slot({ speed: 0 })).speed).toBe(1);
  });

  // ⚠️ **焼ける枚数はここで決めない**（レビュー 🟡）＝実際に焼くのは Rust（`stage_clip_frames`）で、
  // その戻り値（`stagedCount`）が正。ここで別の式を持つと、後でそれを頭打ちに使ったとき**末尾が早く止まる**。
});

describe('出力フレーム → 出すコマ（videoFrameIndexAt）', () => {
  const clip = slot({ startSec: 2, durationSec: 4 });

  // ⚠️ **丸め方向を独立に固定する**（レビュー 🟡＝端数 0.3 の材料では round と floor が同じ結果）。
  it('置いた位置の端数は四捨五入で格子へ寄せる（切り捨てない）', () => {
    // 0.517 秒 × 30 = 15.51 → 16 コマ目が先頭。切り捨てだと 15 になり1コマずれる。
    const odd = slot({ startSec: 0.517, durationSec: 3 });
    expect(videoFrameIndexAt(odd, 16, 30, 999)).toBe(0);
    expect(videoFrameIndexAt(odd, 17, 30, 999)).toBe(1);
  });

  it('置いた先頭からのコマ数で出す', () => {
    expect(videoFrameIndexAt(clip, 60, 30, 120)).toBe(0); // 2.0秒＝先頭
    expect(videoFrameIndexAt(clip, 75, 30, 120)).toBe(15); // 2.5秒
  });

  it('生きている区間の外では映らない（終わりの瞬間は含まない）', () => {
    expect(videoFrameIndexAt(clip, 59, 30, 120)).toBeNull(); // 手前
    expect(videoFrameIndexAt(clip, 180, 30, 120)).toBeNull(); // 6.0秒＝ちょうど終わり
    expect(videoFrameIndexAt(clip, 179, 30, 120)).not.toBeNull();
  });

  // ⚠️ **焼けた枚数で頭打ち**＝素材が置いた長さより短くても、無い番号を読みに行かない（最後のコマで止まる）。
  it('焼けた枚数を超えたら最後のコマで止まる', () => {
    expect(videoFrameIndexAt(clip, 179, 30, 10)).toBe(9);
    expect(videoFrameIndexAt(clip, 60, 30, 0)).toBeNull(); // 1枚も焼けていない
  });
});

// ⚠️ **プレビューが見る唯一の式**（#512 段1 レビュー 🔴＝直接のテストが無く、値を +5 ずらしても
// 420件が全部通ってしまった）。書き出しと同じコマ番号から導くので、ここがずれると preview≠export。
describe('その時刻に映す素材の秒（videoSourceSecAt）', () => {
  const clip = slot({ startSec: 2, durationSec: 4, sourceStartSec: 10 });

  it('トリムから始まり、置いた先頭からの経過ぶん進む', () => {
    expect(videoSourceSecAt(clip, 2, 30)).toBeCloseTo(10, 6); // 置いた先頭＝素材の 10 秒
    expect(videoSourceSecAt(clip, 3, 30)).toBeCloseTo(11, 6);
  });

  it('速さのぶんだけ素材を多く使う', () => {
    expect(videoSourceSecAt(slot({ startSec: 0, durationSec: 4, sourceStartSec: 0, speed: 2 }), 1, 30))
      .toBeCloseTo(2, 6);
  });

  it('生きている区間の外では映らない（終わりの瞬間は含まない）', () => {
    expect(videoSourceSecAt(clip, 1.9, 30)).toBeNull();
    expect(videoSourceSecAt(clip, 6, 30)).toBeNull(); // ちょうど終わり
    expect(videoSourceSecAt(clip, 5.9, 30)).not.toBeNull();
  });

  // ⚠️ **書き出しと同じコマ**を出すことが本質＝置いた位置が格子（1/fps）に乗っていなくても割れない。
  it('置いた位置が格子に乗っていなくても、書き出しと同じコマを指す', () => {
    const odd = slot({ startSec: 0.51, durationSec: 3, sourceStartSec: 0, speed: 1 });
    for (let f = 16; f < 100; f += 7) {
      const t = f / 30;
      const idx = videoFrameIndexAt(odd, f, 30, 999); // 書き出しが読むコマ番号
      const sec = videoSourceSecAt(odd, t, 30); // プレビューが合わせる素材の秒
      if (idx == null) { expect(sec).toBeNull(); continue; }
      expect(sec).toBeCloseTo(idx / 30, 6); // 同じコマを指している
    }
  });
});

// ⚠️ **合成の単位が跨るときは実映像を出さない**（`11 §7.6.4`＝帯分割は単位を跨いで切る）。
// 出してしまうと、まとまり全体のフェード中に**重なった所で下が透ける**＝書き出しと別の絵。
describe('合成の単位が跨っているか（compositeSpansOthers）', () => {
  it('自分だけの単位なら跨っていない（実映像を出せる）', () => {
    const items = [{ id: 'a', composite: { key: 'a', opacity: 0.5 } }, { id: 'b' }];
    expect(compositeSpansOthers(items, 'a')).toBe(false);
  });

  it('同じ単位がほかの部品にも付いていれば跨っている', () => {
    const items = [
      { id: 'a', composite: { key: 'group_001', opacity: 0.5 } },
      { id: 'b', composite: { key: 'group_001', opacity: 0.5 } },
    ];
    expect(compositeSpansOthers(items, 'a')).toBe(true);
  });

  it('単位が無ければ跨っていない（薄くしていない＝そのまま出せる）', () => {
    expect(compositeSpansOthers([{ id: 'a' }, { id: 'b' }], 'a')).toBe(false);
  });

  it('別の単位が付いているだけなら跨っていない', () => {
    const items = [
      { id: 'a', composite: { key: 'group_001', opacity: 0.5 } },
      { id: 'b', composite: { key: 'group_002', opacity: 0.5 } },
    ];
    expect(compositeSpansOthers(items, 'a')).toBe(false);
  });
});

// ⚠️ 回した部品を左右非対称に切り抜くと、書き出し（矩形自身の中心で回す）と画面（部品の中心で回る）で
// **別の窓**になる。出さない側へ倒すための判定（#512 段1 レビュー 🔴）。
describe('切り抜きの回す中心が食い違うか（cropPivotDiffers）', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };

  it('回していなければ食い違わない', () => {
    expect(cropPivotDiffers(rect, { x: 0, y: 0, w: 50, h: 100 }, 0)).toBe(false);
    expect(cropPivotDiffers(rect, { x: 0, y: 0, w: 50, h: 100 }, undefined)).toBe(false);
  });

  it('切り抜いていなければ食い違わない', () => {
    expect(cropPivotDiffers(rect, undefined, 30)).toBe(false);
  });

  it('回していて、切り抜きが中心からずれていれば食い違う', () => {
    expect(cropPivotDiffers(rect, { x: 0, y: 0, w: 50, h: 100 }, 30)).toBe(true);
  });

  // ⚠️ **中心が同じなら回しても同じ窓**（左右対称に切り抜いた場合）＝過剰に断らない。
  it('回していても、切り抜きが中心対称なら食い違わない', () => {
    expect(cropPivotDiffers(rect, { x: 25, y: 25, w: 50, h: 50 }, 30)).toBe(false);
  });
});
