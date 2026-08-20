import { describe, expect, it } from 'vitest';
import { ORIGINAL_AUDIO_VOLUME } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import type { VideoPlacement } from './video';
import type { Template } from '../template/types';
import { canUseOriginalAudio, clipOriginalAudio, videoAudioState, videoPlacementsOf, compositeSpansOthers, cropPivotDiffers, videoAssetIdOfClip, videoAssetIds, videoClipsOf, videoFrameIndexAt, videoSourceSecAt, videoStagePlan } from './video';

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

/** 直接置いた動画の**置き場所**（#512 段3＝コマ・時刻の計算は置き場所単位）。 */
const place = (clip: TimelineClip): VideoPlacement => ({
  clip, use: 'direct', layerId: null, assetId: clip.assetId as string,
  sourceStartSec: clip.sourceStartSec ?? 0,
  durationSec: clip.durationSec,
  speed: clip.speed != null && clip.speed > 0 ? clip.speed : 1,
});

/** 差し込み口を2つ持つ見た目パターン（片方は写真だけの枠）。背景の層も混ぜる。 */
const template = () =>
  ({
    schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
      { id: 'main', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
      { id: 'photoOnly', type: 'slot', slotType: 'image', x: 960, y: 0, w: 960, h: 1080 },
    ],
  }) as unknown as Template;
const templateOf = () => template();

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

// 動画の**置き場所**（#512 段3）＝直接置き＋見た目パターンの差し込み口。
describe('videoPlacementsOf（動画の置き場所）', () => {
  const tmplDoc = (over: Partial<TimelineClip> = {}, docOver: Partial<TimelineProject> = {}) =>
    doc({
      assets: [
        { assetId: 'asset_001', assetType: 'video', displayName: '動画A', filePath: 'a.mp4' },
        { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'b.png' },
        { assetId: 'asset_003', assetType: 'video', displayName: '動画B', filePath: 'c.mp4' },
      ],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, templateId: 'tmpl_001', ...over,
      } as TimelineClip],
      ...docOver,
    } as Partial<TimelineProject>);

  // ⚠️ **どの枠が動画を受けるかは見た目パターンが決める**（レビュー 🔴）＝場面形式と同じ規則。
  // 背景の層・写真だけの枠に入れた動画は**静止画で描かれる**ので、置き場所にしない
  //（しないと、プレビューは静止画・書き出しは実映像という食い違いになる）。
  it('差し込み口の層だけを置き場所にする（背景の層・写真だけの枠は含めない）', () => {
    const d = tmplDoc({ assetRefs: { background: 'asset_001', main: 'asset_003', photoOnly: 'asset_001' } });
    expect(videoPlacementsOf(d, templateOf).map((p) => [p.layerId, p.assetId])).toEqual([['main', 'asset_003']]);
  });

  it('見た目パターンが解けないときは置き場所にしない（静止画の側へ倒す）', () => {
    expect(videoPlacementsOf(tmplDoc({ assetRefs: { main: 'asset_003' } }))).toEqual([]);
  });

  it('直接置いた動画は層を持たない置き場所になる', () => {
    const d = doc({ clips: [slot()] });
    expect(videoPlacementsOf(d).map((p) => [p.use, p.layerId, p.assetId])).toEqual([['direct', null, 'asset_001']]);
  });

  // ⚠️ **差し込み口の使い方は場面形式と同じ解決**（`slotClips` を素材既定に重ねる＝ADR-0028）。
  it('差し込み口のトリム・速さは per-use → 素材既定の順で解く', () => {
    const d = tmplDoc({ assetRefs: { main: 'asset_001' }, slotClips: { main: { startSec: 3, speed: 2 } } });
    expect(videoPlacementsOf(d, templateOf)[0]).toMatchObject({ sourceStartSec: 3, speed: 2 });
    const inherited = tmplDoc({ assetRefs: { main: 'asset_001' } }, {
      assets: [{ assetId: 'asset_001', assetType: 'video', displayName: '動画A', filePath: 'a.mp4', clip: { startSec: 5, speed: 0.5 } }],
    } as Partial<TimelineProject>);
    expect(videoPlacementsOf(inherited, templateOf)[0]).toMatchObject({ sourceStartSec: 5, speed: 0.5 });
  });

  // ⚠️ **速さは場面形式と同じクランプ**（schema の 0.5〜2.0）を通す＝同じ値を2つの規則で読まない。
  it('速さは保存できる範囲へ収める（場面形式と同じ）', () => {
    const fast = tmplDoc({ assetRefs: { main: 'asset_001' }, slotClips: { main: { speed: 9 } } });
    expect(videoPlacementsOf(fast, templateOf)[0].speed).toBe(2);
    // ⚠️ 0 は `??` を素通りするので**下限へ寄る**（場面形式の `clampSpeed(speed ?? 既定)` と同じ結果）。
    // 直接置き（`effectiveSpeed`）は等速へ倒すが、あちらは上限の無い別の語彙＝規則も別で正しい。
    const zero = tmplDoc({ assetRefs: { main: 'asset_001' }, slotClips: { main: { speed: 0 } } });
    expect(videoPlacementsOf(zero, templateOf)[0].speed).toBe(0.5);
  });

  // ⚠️ **「ここまで」も持ち込む**（レビュー 🟡）＝場面で切った終わりを黙って無視すると、
  // 焼き出した先ではその先まで流れる（ADR-0026①）。使える長さで頭打ちにする。
  it('差し込み口の「ここまで」で、焼く長さを頭打ちにする', () => {
    const d = tmplDoc({ assetRefs: { main: 'asset_001' }, slotClips: { main: { startSec: 2, endSec: 5 } } });
    expect(videoPlacementsOf(d, templateOf)[0].durationSec).toBe(3);
    const fast = tmplDoc({ assetRefs: { main: 'asset_001' }, slotClips: { main: { startSec: 2, endSec: 5, speed: 2 } } });
    expect(videoPlacementsOf(fast, templateOf)[0].durationSec).toBe(1.5);
    const open = tmplDoc({ assetRefs: { main: 'asset_001' } });
    expect(videoPlacementsOf(open, templateOf)[0].durationSec).toBe(10);
  });

  // ⚠️ **描かれないものは含めない**＝コマを焼く必要が無い（焼けないファイルで書き出し全体が落ちない）。
  it('隠した部品・隠した列・隠したまとまりの置き場所は含めない', () => {
    expect(videoPlacementsOf(tmplDoc({ assetRefs: { main: 'asset_001' }, hidden: true }), templateOf)).toEqual([]);
    const hiddenTrack = tmplDoc({ assetRefs: { main: 'asset_001' } }, {
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }],
    } as Partial<TimelineProject>);
    expect(videoPlacementsOf(hiddenTrack, templateOf)).toEqual([]);
    const hiddenGroup = tmplDoc({ assetRefs: { main: 'asset_001' } }, {
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
    } as Partial<TimelineProject>);
    expect(videoPlacementsOf(hiddenGroup, templateOf)).toEqual([]);
  });

  // ⚠️ **立ち絵はまだ対象外**（書き出しの手前で断る側が受け持つ）。
  it('立ち絵に入れた動画は置き場所にしない', () => {
    const d = tmplDoc({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' } });
    expect(videoPlacementsOf(d, templateOf)).toEqual([]);
  });
});

describe('焼き出す区間（videoStagePlan）', () => {
  it('トリムから、置いた長さぶん、速さ込みで焼く', () => {
    expect(videoStagePlan(place(slot({ sourceStartSec: 4, durationSec: 6, speed: 2 })))).toEqual({
      sourceStartSec: 4, durationSec: 6, speed: 2,
    });
  });

  it('速さの未指定・0以下は等速として扱う（0 で割らない）', () => {
    expect(videoStagePlan(place(slot())).speed).toBe(1);
    expect(videoStagePlan(place(slot({ speed: 0 }))).speed).toBe(1);
  });

  // ⚠️ **焼ける枚数はここで決めない**（レビュー 🟡）＝実際に焼くのは Rust（`stage_clip_frames`）で、
  // その戻り値（`stagedCount`）が正。ここで別の式を持つと、後でそれを頭打ちに使ったとき**末尾が早く止まる**。
});

// 差し込み口の「ここまで」（`endSec`）で使える長さが部品の尺より短いとき（#512 段3 レビュー 🔴）。
// ⚠️ **書き出しは焼けた枚数で最後のコマに凍る**ので、プレビューも同じところで止まらないと
// **プレビューだけが素材の先へ進む**（`endSec` を越えた絵が見える＝preview≠export）。
describe('使える長さの頭打ち（差し込み口の「ここまで」）', () => {
  /** 10秒ぶん置いてあるが、素材は3秒ぶんしか使えない置き場所。 */
  const short: VideoPlacement = {
    clip: slot({ startSec: 0, durationSec: 10 }),
    use: 'slot', layerId: 'main', assetId: 'asset_001',
    sourceStartSec: 0, durationSec: 3, speed: 1,
  };

  it('プレビューは使える長さを越えて素材を進めない', () => {
    expect(videoSourceSecAt(short, 2, 30)).toBeCloseTo(2); // まだ使える範囲
    // ⚠️ 3秒より後は**最後のコマのまま**（頭打ちが無いと 5 が返り、切ったはずの先が見える）。
    expect(videoSourceSecAt(short, 5, 30)).toBeCloseTo(3);
    expect(videoSourceSecAt(short, 9, 30)).toBeCloseTo(3);
  });

  // ⚠️ **端数の長さで見る**＝コマ数が整数になる長さ（3秒×30）だと、切り上げ・切り捨てのどちらでも
  // 同じ番号になり、数え方の取り違えが素通りする。
  it('書き出しと同じところで止まる（同じコマ番号を指す）', () => {
    const fps = 30;
    const odd: VideoPlacement = { ...short, durationSec: 3.05 }; // 91.5 コマ＝切り上げ 92／切り捨て 91
    const staged = Math.ceil(odd.durationSec * fps) + 1; // Rust が焼く枚数（`ceil(尺×fps)+1`）
    expect(staged).toBe(93);
    const exportIdx = videoFrameIndexAt(odd, 5 * fps, fps, staged);
    const previewSec = videoSourceSecAt(odd, 5, fps);
    expect(exportIdx).toBe(staged - 1); // 最後のコマ＝92
    expect(previewSec).toBeCloseTo(odd.sourceStartSec + ((staged - 1) / fps) * odd.speed);
  });

  // ⚠️ 速さが掛かっていても、止まる位置は素材の時間で見る（置いた長さは速さで変わらない）。
  it('速さが掛かっていても、使える長さで止まる', () => {
    const fast: VideoPlacement = { ...short, durationSec: 1.5, speed: 2 };
    expect(videoSourceSecAt(fast, 1, 30)).toBeCloseTo(2); // 1秒×2倍速＝素材の2秒
    expect(videoSourceSecAt(fast, 5, 30)).toBeCloseTo(3); // 頭打ち後は素材の3秒（＝endSec）
  });

  // ⚠️ **直接置きでは頭打ちが効かない**（使える長さ＝置いた長さ）＝従来の出力を変えない。
  it('直接置きでは、これまでどおり尺いっぱい進む', () => {
    const direct = place(slot({ startSec: 0, durationSec: 10 }));
    expect(videoSourceSecAt(direct, 9, 30)).toBeCloseTo(9);
  });

  // ⚠️ **部品の区間の外は映らない**（頭打ちを入れても、生きている区間の判定は変わらない）。
  it('部品の区間の外では映らない', () => {
    expect(videoSourceSecAt(short, 10, 30)).toBeNull();
  });
});

describe('出力フレーム → 出すコマ（videoFrameIndexAt）', () => {
  const clip = slot({ startSec: 2, durationSec: 4 });

  // ⚠️ **丸め方向を独立に固定する**（レビュー 🟡＝端数 0.3 の材料では round と floor が同じ結果）。
  it('置いた位置の端数は四捨五入で格子へ寄せる（切り捨てない）', () => {
    // 0.517 秒 × 30 = 15.51 → 16 コマ目が先頭。切り捨てだと 15 になり1コマずれる。
    const odd = slot({ startSec: 0.517, durationSec: 3 });
    expect(videoFrameIndexAt(place(odd), 16, 30, 999)).toBe(0);
    expect(videoFrameIndexAt(place(odd), 17, 30, 999)).toBe(1);
  });

  it('置いた先頭からのコマ数で出す', () => {
    expect(videoFrameIndexAt(place(clip), 60, 30, 120)).toBe(0); // 2.0秒＝先頭
    expect(videoFrameIndexAt(place(clip), 75, 30, 120)).toBe(15); // 2.5秒
  });

  it('生きている区間の外では映らない（終わりの瞬間は含まない）', () => {
    expect(videoFrameIndexAt(place(clip), 59, 30, 120)).toBeNull(); // 手前
    expect(videoFrameIndexAt(place(clip), 180, 30, 120)).toBeNull(); // 6.0秒＝ちょうど終わり
    expect(videoFrameIndexAt(place(clip), 179, 30, 120)).not.toBeNull();
  });

  // ⚠️ **焼けた枚数で頭打ち**＝素材が置いた長さより短くても、無い番号を読みに行かない（最後のコマで止まる）。
  it('焼けた枚数を超えたら最後のコマで止まる', () => {
    expect(videoFrameIndexAt(place(clip), 179, 30, 10)).toBe(9);
    expect(videoFrameIndexAt(place(clip), 60, 30, 0)).toBeNull(); // 1枚も焼けていない
  });
});

// ⚠️ **プレビューが見る唯一の式**（#512 段1 レビュー 🔴＝直接のテストが無く、値を +5 ずらしても
// 420件が全部通ってしまった）。書き出しと同じコマ番号から導くので、ここがずれると preview≠export。
describe('その時刻に映す素材の秒（videoSourceSecAt）', () => {
  const clip = slot({ startSec: 2, durationSec: 4, sourceStartSec: 10 });

  it('トリムから始まり、置いた先頭からの経過ぶん進む', () => {
    expect(videoSourceSecAt(place(clip), 2, 30)).toBeCloseTo(10, 6); // 置いた先頭＝素材の 10 秒
    expect(videoSourceSecAt(place(clip), 3, 30)).toBeCloseTo(11, 6);
  });

  it('速さのぶんだけ素材を多く使う', () => {
    expect(videoSourceSecAt(place(slot({ startSec: 0, durationSec: 4, sourceStartSec: 0, speed: 2 })), 1, 30))
      .toBeCloseTo(2, 6);
  });

  it('生きている区間の外では映らない（終わりの瞬間は含まない）', () => {
    expect(videoSourceSecAt(place(clip), 1.9, 30)).toBeNull();
    expect(videoSourceSecAt(place(clip), 6, 30)).toBeNull(); // ちょうど終わり
    expect(videoSourceSecAt(place(clip), 5.9, 30)).not.toBeNull();
  });

  // ⚠️ **書き出しと同じコマ**を出すことが本質＝置いた位置が格子（1/fps）に乗っていなくても割れない。
  it('置いた位置が格子に乗っていなくても、書き出しと同じコマを指す', () => {
    const odd = slot({ startSec: 0.51, durationSec: 3, sourceStartSec: 0, speed: 1 });
    for (let f = 16; f < 100; f += 7) {
      const t = f / 30;
      const idx = videoFrameIndexAt(place(odd), f, 30, 999); // 書き出しが読むコマ番号
      const sec = videoSourceSecAt(place(odd), t, 30); // プレビューが合わせる素材の秒
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
    expect(cropPivotDiffers(rect, { x: 0, y: 0, w: 50, h: 100 }, 30)).toBe(true); // 横だけずれる
    // ⚠️ **縦だけずれる場合も見る**（横しか見ていない実装が素通りする＝変異チェックで判明）。
    expect(cropPivotDiffers(rect, { x: 0, y: 0, w: 100, h: 50 }, 30)).toBe(true);
  });

  // ⚠️ **中心が同じなら回しても同じ窓**（左右対称に切り抜いた場合）＝過剰に断らない。
  it('回していても、切り抜きが中心対称なら食い違わない', () => {
    expect(cropPivotDiffers(rect, { x: 25, y: 25, w: 50, h: 50 }, 30)).toBe(false);
  });
});

// 元の音（#512 段2）＝**再生・書き出し・画面が通る唯一の解決**。場面形式と同じ規準（ADR-0026②）。
describe('clipOriginalAudio（動画の元の音）', () => {
  /** 音の入っている動画を持つ文書（既定では鳴らさない）。 */
  const withAudio = (clipOver: Partial<TimelineClip> = {}, docOver: Partial<TimelineProject> = {}) =>
    doc({
      assets: [
        { assetId: 'asset_001', assetType: 'video', displayName: '紹介ムービー', filePath: 'a.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'b.png' },
      ],
      clips: [slot(clipOver)],
      ...docOver,
    } as Partial<TimelineProject>);

  // ⚠️ **既定は鳴らさない**＝既に作った動画の音が、この段で黙って変わらない。
  it('指定が無ければ鳴らない', () => {
    expect(clipOriginalAudio(withAudio(), slot())).toBeNull();
  });

  it('鳴らす設定なら、標準の音量で鳴る', () => {
    const clip = slot({ useOriginalAudio: true });
    expect(clipOriginalAudio(withAudio({ useOriginalAudio: true }), clip)).toEqual({
      assetId: 'asset_001', volume: ORIGINAL_AUDIO_VOLUME, speed: 1, sourceStartSec: 0,
    });
  });

  it('音量・速さ・使い始めは、その部品の値から採る', () => {
    const clip = slot({ useOriginalAudio: true, originalAudioVolume: 0.9, speed: 2, sourceStartSec: 3 });
    expect(clipOriginalAudio(withAudio(clip), clip)).toEqual({
      assetId: 'asset_001', volume: 0.9, speed: 2, sourceStartSec: 3,
    });
  });

  // ⚠️ **音の入っていないファイルへ音の取り出しを頼まない**（場面形式が同じ門を置いている理由＝
  // 頼むと書き出しが失敗する）。設定が残っていても鳴らさない。
  it('素材に音が入っていなければ、設定があっても鳴らない', () => {
    const clip = slot({ useOriginalAudio: true });
    const d = doc({
      assets: [{ assetId: 'asset_001', assetType: 'video', displayName: 'v', filePath: 'a.mp4', metadata: { hasAudio: false } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    expect(clipOriginalAudio(d, clip)).toBeNull();
    expect(canUseOriginalAudio(d, clip)).toBe(false);
  });

  // ⚠️ **判らないもの（`hasAudio` 未取得）は鳴らさない**＝取り出せる保証が無いので断る側へ倒す。
  it('音が入っているか判らない素材では鳴らない', () => {
    const clip = slot({ useOriginalAudio: true });
    expect(clipOriginalAudio(doc({ clips: [clip] }), clip)).toBeNull();
  });

  // ⚠️ **隠したら音も止まる**（音のクリップと同じ規則＝見えないのに聞こえる、を作らない）。
  it('隠した部品・隠した列・隠したまとまりでは鳴らない', () => {
    const hidden = slot({ useOriginalAudio: true, hidden: true });
    expect(clipOriginalAudio(withAudio({ useOriginalAudio: true, hidden: true }), hidden)).toBeNull();
    const clip = slot({ useOriginalAudio: true });
    const hiddenTrack = withAudio({ useOriginalAudio: true }, { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }] } as Partial<TimelineProject>);
    expect(clipOriginalAudio(hiddenTrack, clip)).toBeNull();
    const hiddenGroup = withAudio({ useOriginalAudio: true }, {
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
    } as Partial<TimelineProject>);
    expect(clipOriginalAudio(hiddenGroup, clip)).toBeNull();
  });

  // ⚠️ 画面が欄を出す条件は**隠しているかを見ない**＝隠した部品でも設定は変えられる。
  it('隠していても、設定を変えられるかどうかは変わらない', () => {
    const clip = slot({ hidden: true });
    expect(canUseOriginalAudio(withAudio({ hidden: true }), clip)).toBe(true);
  });

  // ⚠️ **「音が無い」と「判らない」を分ける**（レビュー 🟡）＝調べられなかった素材に
  // 「入っていません」と断定すると嘘の理由になり、次の行動（取り込み直す）も誤る。
  it('音が無いことが判っているものと、判らないものを区別する', () => {
    const clip = slot();
    expect(videoAudioState(withAudio(), clip)).toBe('available');
    const none = doc({
      assets: [{ assetId: 'asset_001', assetType: 'video', displayName: 'v', filePath: 'a.mp4', metadata: { hasAudio: false } }],
      clips: [clip],
    } as Partial<TimelineProject>);
    expect(videoAudioState(none, clip)).toBe('none');
    expect(videoAudioState(doc({ clips: [clip] }), clip)).toBe('unknown'); // metadata 無し＝調べられていない
    expect(videoAudioState(withAudio(), slot({ assetId: 'asset_002' }))).toBe('notVideo');
  });

  it('動画でない部品では鳴らない・選べない', () => {
    const img = slot({ assetId: 'asset_002', useOriginalAudio: true });
    expect(clipOriginalAudio(withAudio({ assetId: 'asset_002', useOriginalAudio: true }), img)).toBeNull();
    expect(canUseOriginalAudio(withAudio({ assetId: 'asset_002' }), img)).toBe(false);
  });
});
