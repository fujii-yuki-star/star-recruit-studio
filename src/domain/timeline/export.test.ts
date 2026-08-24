// タイムラインの書き出しの並べ方（ADR-0032 決定22・#631）。全フレーム描画と音の配置を固定する。
import { describe, expect, it } from 'vitest';
import { FPS } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { TIMELINE_EXPORT_BLOCK, frameTimeAt, timelineAudioRuns, timelineExportBlockers, timelineFramePlan, timelineImageAssetIds, volumePointsTooManyHasSplittable } from './export';
import { frameTimeSec } from './persistence';

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return { id, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, ...over };
}

const voiceClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip(id, { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav` }, ...over });

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
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

const textClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip(id, { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over });

describe('timelineFramePlan（全フレーム描画・決定22）', () => {
  it('尺ぶんのフレームを描き、出力の尺はフレーム数から導く（映像と音の長さが食い違わない）', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5 })] }));
    expect(p).toEqual({ fps: FPS, frameCount: 150, durationSec: 5 });
  });

  it('端数の尺でも、出力の尺はフレーム数と一致する', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5.52 })] }));
    expect(p.frameCount).toBe(166); // 5.52 × 30 = 165.6 → 166
    expect(p.durationSec).toBeCloseTo(166 / FPS);
  });

  it('端数は切り上げる＝末尾が切れない（四捨五入だと語尾が落ちる尺）', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5.505 })] }));
    expect(p.frameCount).toBe(166); // 165.15 を四捨五入すると 165＝5.5 秒で末尾 5ms が落ちる
    expect(p.durationSec).toBeGreaterThanOrEqual(5.505);
  });

  it('切り上げても最後のフレームの時刻は尺の中に入る（空白のフレームを増やさない）', () => {
    for (const durationSec of [5.505, 5.52, 5, 0.001]) {
      const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec })] }));
      expect(frameTimeAt(p.frameCount - 1, p.fps)).toBeLessThan(durationSec);
    }
  });

  it('何も置いていない動画は 0 フレーム（呼び出し側が書き出しを止める）', () => {
    expect(timelineFramePlan(doc()).frameCount).toBe(0);
  });

  it('とても短い動画でも1フレームは描く（空のMP4を作らない）', () => {
    expect(timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 0.001 })] })).frameCount).toBe(1);
  });
});

describe('frameTimeAt', () => {
  it('どのフレームも同じ絵を二度描かない（連番の時刻が必ず1フレームぶん進む）', () => {
    // 123 番は「掛け算の誤差で1つ前へ落ちる」代表（123/30*30 = 122.99999999999999）。
    for (const i of [0, 1, 29, 30, 122, 123, 124, 151, 999]) {
      expect(frameTimeAt(i, FPS)).toBeCloseTo(i / FPS);
      expect(frameTimeAt(i + 1, FPS) - frameTimeAt(i, FPS)).toBeCloseTo(1 / FPS);
    }
  });

  it('総当たりで、どの番号も同じ時刻を返さない（フレームの取りこぼし・重複が無い）', () => {
    for (const fps of [24, 25, 30, 60]) {
      const seen = new Set<number>();
      for (let i = 0; i < 4000; i += 1) {
        const t = frameTimeAt(i, fps);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  it('描画時刻（`frameTimeSec`）と同じ値になる時刻がある＝経路がずれていない', () => {
    const d = doc({ clips: [textClip('clip_001', { durationSec: 5 })] });
    // 途中のフレームは、再生で同じ時刻を指したときの描画時刻と一致する。
    expect(frameTimeSec(d, frameTimeAt(60, FPS))).toBeCloseTo(frameTimeAt(60, FPS));
  });
});

/** 音の入っている動画を直接置いた文書（#512 段2）。 */
const videoDoc = (over: Partial<TimelineClip> = {}, docOver: Partial<TimelineProject> = {}): TimelineProject =>
  doc({
    assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'media/v.mp4', metadata: { hasAudio: true } }],
    clips: [clip('clip_001', {
      kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', x: 0, y: 0, w: 1920, h: 1080,
      assetId: 'asset_v', startSec: 2, durationSec: 3, ...over,
    })],
    ...docOver,
  });

// 元の音（#512 段2）＝**再生で聞こえたものが書き出しにも出る**（ADR-0001）。
// 差し込み口の元の音（#512 段3b）＝直接置きと同じ関数を通る（置き場所で挙動を割らない）。
describe('timelineAudioRuns（差し込み口の元の音）', () => {
  const tmpl = () =>
    ({
      schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
      aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
      layers: [
        { id: 'left', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
        { id: 'right', type: 'slot', x: 960, y: 0, w: 960, h: 1080 },
      ],
    }) as unknown as Template;
  const twoVideos = (slotClips: Record<string, Record<string, unknown>>) =>
    doc({
      assets: [
        { assetId: 'asset_v1', assetType: 'video', displayName: '動画1', filePath: 'v1.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_v2', assetType: 'video', displayName: '動画2', filePath: 'v2.mp4', metadata: { hasAudio: true } },
      ],
      clips: [clip('clip_t', {
        kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 1, durationSec: 4,
        templateId: 'tmpl_001', assetRefs: { left: 'asset_v1', right: 'asset_v2' },
        slotClips: slotClips as never,
      })],
    });

  it('鳴らす設定にした枠だけが出る（枠ごとに別の音）', () => {
    const runs = timelineAudioRuns(twoVideos({ left: { useOriginalAudio: true } }), tmpl);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      clipId: 'clip_t/left', // ⚠️ 部品 id だけだと、同じ id の音が並んで見分けられない
      assetPath: 'v1.mp4',
      delaySec: 1,
      playSec: 4,
      volume: 0.2,
      loop: false,
    });
  });

  it('枠ごとに音量・速さ・使い始めを解く（場面形式と同じ語彙）', () => {
    const runs = timelineAudioRuns(
      twoVideos({ right: { useOriginalAudio: true, originalAudioVolume: 0.8, speed: 2, startSec: 3 } }),
      tmpl,
    );
    expect(runs[0]).toMatchObject({ clipId: 'clip_t/right', speed: 2, sourceStartSec: 3, volume: 0.8 });
  });

  // ⚠️ **「ここまで」で切った動画の音は、その先まで鳴らさない**＝絵は最後のコマで凍るので、
  // 音だけ流れると食い違う。
  it('「ここまで」で切った枠は、音も同じところで終わる', () => {
    const runs = timelineAudioRuns(twoVideos({ left: { useOriginalAudio: true, startSec: 2, endSec: 4 } }), tmpl);
    expect(runs[0].playSec).toBe(2); // 置いたのは4秒だが、使える素材は2秒ぶん
  });

  it('見た目パターンを渡さなければ鳴らない（枠を解決できない）', () => {
    expect(timelineAudioRuns(twoVideos({ left: { useOriginalAudio: true } }))).toEqual([]);
  });

  it('鳴らす設定でなければ出ない', () => {
    expect(timelineAudioRuns(twoVideos({}), tmpl)).toEqual([]);
  });

  // ⚠️ **同じ部品の2つの枠が同時に鳴る**＝`clipId` を部品 id だけにすると衝突して見分けられない
  //（この形が `<部品 id>/<層 id>` にした理由そのもの）。
  it('同じ部品の2つの枠が同時に鳴っても、見分けられる', () => {
    const runs = timelineAudioRuns(
      twoVideos({ left: { useOriginalAudio: true }, right: { useOriginalAudio: true } }),
      tmpl,
    );
    expect(runs.map((r) => r.clipId)).toEqual(['clip_t/left', 'clip_t/right']);
    expect(new Set(runs.map((r) => r.clipId)).size).toBe(2);
    expect(runs.map((r) => r.assetPath)).toEqual(['v1.mp4', 'v2.mp4']);
  });
});

describe('timelineAudioRuns（動画の元の音）', () => {
  it('鳴らす設定なら、その動画をパスで渡す（中身は運ばない）', () => {
    expect(timelineAudioRuns(videoDoc({ useOriginalAudio: true }))).toEqual([
      {
        clipId: 'clip_001',
        sourceKey: 'asset:asset_v',
        assetPath: 'media/v.mp4', // ⚠️ base64 にしない（動画は数百MBになりうる）
        fileExt: 'mp4',
        delaySec: 2,
        playSec: 3,
        sourceStartSec: 0,
        speed: 1,
        volume: 0.2,
        fadeInSec: 0,
        fadeOutSec: 0,
        loop: false, // ⚠️ 繰り返さない（素材が尽きたら終わる＝絵も終わっている）
      },
    ]);
  });

  it('鳴らす設定でなければ出さない', () => {
    expect(timelineAudioRuns(videoDoc())).toEqual([]);
  });

  it('音の入っていない動画は出さない（設定が残っていても）', () => {
    const d = videoDoc({ useOriginalAudio: true }, {
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'media/v.mp4', metadata: { hasAudio: false } }],
    } as Partial<TimelineProject>);
    expect(timelineAudioRuns(d)).toEqual([]);
  });

  it('速さ・使い始め・音量は、その部品の値で出る', () => {
    const runs = timelineAudioRuns(videoDoc({ useOriginalAudio: true, speed: 2, sourceStartSec: 4, originalAudioVolume: 0.9 }));
    expect(runs[0]).toMatchObject({ speed: 2, sourceStartSec: 4, volume: 0.9 });
  });

  it('隠した部品は書き出しにも出ない（聞こえないものを混ぜない）', () => {
    expect(timelineAudioRuns(videoDoc({ useOriginalAudio: true, hidden: true }))).toEqual([]);
  });
});

describe('timelineAudioRuns', () => {
  it('置く位置・長さ・音源を返す', () => {
    const d = doc({ clips: [voiceClip('clip_001', { startSec: 2, durationSec: 3 })] });
    expect(timelineAudioRuns(d)).toEqual([
      {
        clipId: 'clip_001',
        sourceKey: 'voice:voices/clip_001.wav',
        fileExt: 'wav',
        delaySec: 2,
        playSec: 3,
        sourceStartSec: 0,
        speed: 1,
        volume: 1,
        fadeInSec: 0,
        fadeOutSec: 0,
        loop: false,
      },
    ]);
  });

  it('読み上げは繰り返さない／BGM は繰り返す（言葉が二重に鳴らない）', () => {
    const d = doc({ clips: [voiceClip('clip_001'), clip('clip_002', { bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d).map((r) => r.loop)).toEqual([false, true]);
  });

  it('音量は再生と同じ解決（BGM の既定は 0.25）', () => {
    const d = doc({ clips: [clip('clip_001', { bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0].volume).toBeCloseTo(0.25);
  });

  it('読み上げは動画全体の声の音量を継承する', () => {
    const d = doc({
      voiceSettings: { defaultVoiceId: 'voicevox_zundamon', volume: 0.5 },
      clips: [voiceClip('clip_001')],
    });
    expect(timelineAudioRuns(d)[0].volume).toBeCloseTo(0.5);
  });

  it('フェードは尺の半分までに切り詰めて渡す（再生と同じ規則）', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 2, fadeInSec: 4, fadeOutSec: 4, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0]).toMatchObject({ fadeInSec: 1, fadeOutSec: 1 });
  });

  it('速度を変えても、鳴らす長さは置いた長さのまま（素材側で長く読む）', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 3, speed: 2, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0].playSec).toBeCloseTo(3);
  });

  it('素材のトリムと速度を渡す', () => {
    const d = doc({ clips: [clip('clip_001', { sourceStartSec: 10, speed: 2, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0]).toMatchObject({ sourceStartSec: 10, speed: 2 });
  });

  it('隠した列・隠したクリップの音は置かない（再生と同じ判定を通す）', () => {
    const hiddenTrack = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, hidden: true }],
      clips: [voiceClip('clip_001')],
    });
    expect(timelineAudioRuns(hiddenTrack)).toEqual([]);
    const hiddenClip = doc({ clips: [voiceClip('clip_001', { hidden: true })] });
    expect(timelineAudioRuns(hiddenClip)).toEqual([]);
  });

  it('まだ作っていない読み上げは置かない（音源が無い）', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'none' } })] });
    expect(timelineAudioRuns(d)).toEqual([]);
  });

  it('絵のクリップは音として置かない', () => {
    expect(timelineAudioRuns(doc({ clips: [textClip('clip_001')] }))).toEqual([]);
  });
});

describe('timelineExportBlockers（書き出す前に止める理由）', () => {
  const videoAsset = {
    assetId: 'asset_video_001',
    assetType: 'video' as const,
    displayName: '会社紹介',
    filePath: 'assets/a.mp4',
  };

  it('置いたものがあれば止めない', () => {
    expect(timelineExportBlockers(doc({ clips: [textClip('clip_001')] }))).toEqual([]);
  });

  it('何も置いていなければ止める', () => {
    expect(timelineExportBlockers(doc())).toEqual([{ code: TIMELINE_EXPORT_BLOCK.empty, clipIds: [] }]);
  });

  // ⚠️ #512 段1 で**直接置いた動画は映るようになった**＝ここは止めない。
  // （止め続けると、映るのに書き出せないという逆の食い違いになる。元の音は段2＝画面が知らせる。）
  it('直接置いた動画は止めない（段1 で映るようになった）', () => {
    const d = doc({
      assets: [videoAsset],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_video_001' })],
    });
    expect(timelineExportBlockers(d)).toEqual([]);
  });

  // ⚠️ 差し込み口の動画も**段3 で映るようになった**＝止めない（止めると、映るのに書き出せない）。
  it('枠の差し込み口に入れた動画は止めない（段3 で映るようになった）', () => {
    const inSlot = doc({
      assets: [videoAsset],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.template, assetRefs: { bg: 'asset_video_001' } })],
    });
    expect(timelineExportBlockers(inSlot)).toEqual([]);
  });

  // ⚠️ **立ち絵に入れた動画はまだ静止画のまま**＝置いたのに静止画で出る、を成功として出さない。
  it('立ち絵として入れた動画は止める（まだ静止画のまま）', () => {
    const asPose = doc({
      assets: [videoAsset],
      clips: [
        textClip('clip_001', {
          kind: TIMELINE_CLIP_KIND.template,
          character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_video_001' },
        }),
      ],
    });
    expect(timelineExportBlockers(asPose)[0].clipIds).toEqual(['clip_001']);
  });

  it('持っているだけで使っていない動画素材では止めない（消し忘れで書き出せなくならない）', () => {
    const d = doc({ assets: [videoAsset], clips: [textClip('clip_001')] });
    expect(timelineExportBlockers(d)).toEqual([]);
  });
});

// #831＝「部品を分けてください」は読み上げには実行できない（読み上げは分けられない・`isUnsplittableClipKind`）。
// 案内を出してよいかは**挙げた部品の種類**で決まるので、分割の関門と同じものを見て判定する。
describe('volumePointsTooManyHasSplittable（分けを案内してよいか・#831）', () => {
  it('音の部品（audio）は分けられる＝案内してよい', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.audio })] });
    expect(volumePointsTooManyHasSplittable(d, ['clip_001'])).toBe(true);
  });

  it('読み上げ（voice）だけは分けられない＝案内してはいけない', () => {
    const d = doc({ clips: [voiceClip('clip_001')] });
    expect(volumePointsTooManyHasSplittable(d, ['clip_001'])).toBe(false);
  });

  it('読み上げと音が混ざっていれば、音の分だけ案内してよい', () => {
    const d = doc({ clips: [voiceClip('clip_001'), clip('clip_002', { kind: TIMELINE_CLIP_KIND.audio })] });
    expect(volumePointsTooManyHasSplittable(d, ['clip_001', 'clip_002'])).toBe(true);
  });

  it('見つからない id は分けられない扱い（無いものを分けてとは言わない）', () => {
    const d = doc({ clips: [] });
    expect(volumePointsTooManyHasSplittable(d, ['clip_missing'])).toBe(false);
  });
});

describe('音源ファイルの拡張子', () => {
  it('同梱BGM・持ち込みの音・読み上げで、実際のファイルに合わせる', () => {
    const d = doc({
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/song.M4A' }],
      clips: [
        clip('clip_001', { bundledBgmId: 'found-new-hope' }),
        clip('clip_002', { assetId: 'asset_001', startSec: 10 }),
        voiceClip('clip_003', { startSec: 20 }),
      ],
    });
    expect(timelineAudioRuns(d).map((r) => r.fileExt)).toEqual(['mp3', 'm4a', 'wav']);
  });

  it('拡張子が判らないときも空にしない（形式を判定できる手がかりを渡す）', () => {
    const d = doc({
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/song' }],
      clips: [clip('clip_001', { assetId: 'asset_001' })],
    });
    expect(timelineAudioRuns(d)[0].fileExt).toBe('mp3');
  });
});

describe('見た目が見つからない部品（書き出しを止める）', () => {
  const tmplClip = (id: string, templateId: string): TimelineClip =>
    clip(id, { kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', templateId, x: 0, y: 0, w: 100, h: 100 });

  it('読み込めている見た目が渡されたとき、見つからない部品があれば止める', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_missing')] });
    expect(timelineExportBlockers(d, { knownTemplateIds: new Set(['tmpl_001']) })).toEqual([
      { code: TIMELINE_EXPORT_BLOCK.templateUnresolved, clipIds: ['clip_001'] },
    ]);
  });

  it('見つかっていれば止めない', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_001')] });
    expect(timelineExportBlockers(d, { knownTemplateIds: new Set(['tmpl_001']) })).toEqual([]);
  });

  it('判定材料が無いときは見ない（嘘の理由を出さない）', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_missing')] });
    expect(timelineExportBlockers(d)).toEqual([]);
  });
});

// #512 段1＝**直接置いた動画は実フレームで描く**ので、代表フレーム（静止画）を要求しない。
// 要求すると「実フレームで描けるのに**素材が読めませんで永久に書き出せない**」組み合わせができる。
describe('timelineImageAssetIds：動画の扱い（#512 段1）', () => {
  const videoAssetDef = { assetId: 'asset_v', assetType: 'video' as const, displayName: '動画', filePath: 'v.mp4' };

  it('直接置いた動画は静止画を要求しない', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_v' })],
    });
    expect(timelineImageAssetIds(d)).toEqual([]);
  });

  // ⚠️ **隠した動画も静止画を要求しない**（レビュー 🔴）＝「実フレームで描く部品」を数える述語が
  // 片方だけ隠しを見ていると、**隠した瞬間に代表フレームが必須へ戻り**、それが作れていない動画で
  // 書き出し全体が止まる（描かれもしない部品を理由に断る）。
  it('隠した動画も静止画を要求しない', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_v', hidden: true })],
    });
    expect(timelineImageAssetIds(d)).toEqual([]);
  });

  // ⚠️ **変更は動画だけに閉じる**＝隠した写真の扱いは従来どおり（この PR で広げない）。
  // 広げると「隠した素材は読めなくてよい」という別の判断を黙って持ち込むことになる。
  it('隠した写真は従来どおり静止画を要求する（変更は動画だけ）', () => {
    const d = doc({
      assets: [{ assetId: 'asset_p', assetType: 'image' as const, displayName: '写真', filePath: 'p.png' }],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_p', hidden: true })],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_p']);
  });

  // ⚠️ **立ち絵で使っていれば残す**＝立ち絵はまだ静止画で描くので、外すとその絵が出ない。
  it('同じ動画を立ち絵でも使っていれば、静止画は要る', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [
        textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_v' }),
        textClip('clip_002', { kind: TIMELINE_CLIP_KIND.template, character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' } }),
      ],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_v']);
  });

  // ⚠️ **差し込み口の動画は実フレームで描く**（段3）＝代表フレームは要らない。要求すると、
  // 代表フレームが作れなかった動画で**書き出し全体が止まる**（描けるのに断る）。
  it('差し込み口だけで使っている動画は、静止画を要らない（段3 で実フレーム）', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_002', { kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', assetRefs: { main: 'asset_v' } })],
    });
    expect(timelineImageAssetIds(d, slotTemplateOf)).toEqual([]);
  });

  // ⚠️ **見た目パターンが解けなければ静止画の側へ倒す**＝実フレームで描けると決めつけない。
  it('見た目パターンが解けないときは、差し込み口の動画も静止画として数える', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_002', { kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', assetRefs: { main: 'asset_v' } })],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_v']);
  });

  // ⚠️ **同じ部品でも枠ごとに要否が変わる**＝実フレームで描く枠と静止画で描く枠が混じる。
  it('同じ部品で、動画の枠は実フレーム・写真の枠は静止画', () => {
    const d = doc({
      assets: [videoAssetDef, { assetId: 'asset_p', assetType: 'image', displayName: '写真', filePath: 'p.png' }],
      clips: [textClip('clip_002', { kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_001', assetRefs: { main: 'asset_v', sub: 'asset_p' } })],
    });
    expect(timelineImageAssetIds(d, slotTemplateOf)).toEqual(['asset_p']);
  });

  // ⚠️ **直接置きと立ち絵はどちらも層を持たない**＝層 id だけで突き合わせると別の使い方が同じ鍵になり、
  // 立ち絵の代表フレームまで「要らない」扱いになる（灰色の枠が焼き込まれる）。使い方まで込みで見分ける。
  // （部品の型は平らなので、この組み合わせは**保存しうる**＝守りとして固定する。）
  it('直接置きの動画がある部品でも、立ち絵の静止画は要る', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_001', {
        kind: TIMELINE_CLIP_KIND.slot,
        assetId: 'asset_v',
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
      })],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_v']);
  });

  // ⚠️ **同じ部品の中で、同じ動画が実フレームと静止画の両方に使われうる**＝枠は実フレーム、
  // 立ち絵はまだ静止画。部品まるごとで判じると立ち絵の絵が出ない（灰色の枠が焼き込まれる）。
  it('同じ部品で、動画の枠は実フレーム・同じ動画の立ち絵は静止画', () => {
    const d = doc({
      assets: [videoAssetDef],
      clips: [textClip('clip_002', {
        kind: TIMELINE_CLIP_KIND.template,
        templateId: 'tmpl_001',
        assetRefs: { main: 'asset_v' },
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
      })],
    });
    expect(timelineImageAssetIds(d, slotTemplateOf)).toEqual(['asset_v']);
  });
});

/** 差し込み口（`main`）と写真だけの枠（`sub`）を持つ見た目パターン。 */
const slotTemplateOf = () =>
  ({
    schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'main', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
      { id: 'sub', type: 'slot', x: 960, y: 0, w: 960, h: 1080 },
    ],
  }) as unknown as Template;

describe('timelineImageAssetIds（書き出しで絵として描く素材・#716）', () => {
  const assets = [
    { assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'a.png' },
    { assetId: 'asset_002', assetType: 'bgm', displayName: '曲', filePath: 'b.mp3' },
    { assetId: 'asset_003', assetType: 'image', displayName: '使わない写真', filePath: 'c.png' },
  ] as TimelineProject['assets'];

  it('部品が使っている素材と、差し込み口に入れた素材を集める', () => {
    const d = doc({
      assets,
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_001' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 6, durationSec: 5, templateId: 't1', assetRefs: { slot1: 'tmpl_asset_009', slot2: null } },
      ] as TimelineClip[],
    });
    expect(timelineImageAssetIds(d).sort()).toEqual(['asset_001', 'tmpl_asset_009']);
  });

  it('立ち絵も集める（描画が引く出どころと同じ数だけ集める）', () => {
    // 落とすと、その絵だけ動画から消える（#716 レビュー）。
    const d = doc({
      assets,
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 0, durationSec: 5,
        templateId: 't1', character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_003' },
      }] as TimelineClip[],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_003']);
  });

  it('使っていない素材は含めない（読まなくてよいものを読ませない）', () => {
    const d = doc({ assets, clips: [] });
    expect(timelineImageAssetIds(d)).toEqual([]);
  });

  it('音だけの素材は含めない（音のファイルを絵として読ませない）', () => {
    // 音の部品が指す素材は、そもそも集めない。
    const audioClip = doc({
      assets,
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_002' }] as TimelineClip[],
    });
    expect(timelineImageAssetIds(audioClip)).toEqual([]);
    // 手で直した文書などで**絵の部品が音の素材を指していても**、絵としては読まない。
    const oddSlot = doc({
      assets,
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_002' }] as TimelineClip[],
    });
    expect(timelineImageAssetIds(oddSlot)).toEqual([]);
    // 読み上げの素材（`voice`）も音＝BGM だけを見て判定しない。
    const voiceAsset = doc({
      assets: [{ assetId: 'asset_009', assetType: 'voice', displayName: '声', filePath: 'v.wav' }] as TimelineProject['assets'],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_009' }] as TimelineClip[],
    });
    expect(timelineImageAssetIds(voiceAsset)).toEqual([]);
  });

  it('同じ素材を何度使っても1つ', () => {
    const d = doc({
      assets,
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_001' },
        { id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 6, durationSec: 5, assetId: 'asset_001' },
      ] as TimelineClip[],
    });
    expect(timelineImageAssetIds(d)).toEqual(['asset_001']);
  });
});
