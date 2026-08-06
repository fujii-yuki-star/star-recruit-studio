// タイムライン形式（ADR-0032・#627）の意味検証（11 §8 V22–V26）と、schema と TS 定数の照合。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND, CROP_ALIGN_X, CROP_ALIGN_Y } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { clipEndSec, danglingTimelineRefs, overlappingClipPairs, validateTimelineDoc } from './validateTimelineDoc';

const SCHEMA_PATH = join(process.cwd(), 'docs/yuko_recruit_docs/schemas/timeline-project.schema.json');
const FIXTURE_PATH = join(process.cwd(), 'docs/yuko_recruit_docs/fixtures/timeline-project.sample.json');

function doc(overrides: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 300 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...overrides,
  };
}

function clip(overrides: Partial<TimelineClip> & Pick<TimelineClip, 'id'>): TimelineClip {
  return {
    kind: TIMELINE_CLIP_KIND.text,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 1,
    ...overrides,
  };
}

const codes = (d: TimelineProject): string[] => validateTimelineDoc(d).map((w) => w.code);

describe('validateTimelineDoc: V22 trackId が実在するか', () => {
  it('実在しない列を指すクリップは警告する（黙って消さない・§2-5）', () => {
    const w = validateTimelineDoc(doc({ clips: [clip({ id: 'clip_001', trackId: 'track_999' })] }));
    expect(w.map((x) => x.code)).toEqual(['TIMELINE_TRACK_NOT_FOUND']);
    expect(w[0].field).toBe('clips.clip_001');
    expect(w[0].severity).toBe('warning');
  });

  it('実在する列なら警告しない', () => {
    expect(codes(doc({ clips: [clip({ id: 'clip_001' })] }))).toEqual([]);
  });

  it('列が無いときは種別の一致（V23）を重ねて出さない（原因は1つ）', () => {
    const w = codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_999' })] }));
    expect(w).toEqual(['TIMELINE_TRACK_NOT_FOUND']);
  });
});

describe('validateTimelineDoc: V23 クリップ種別とトラック種別の一致', () => {
  it('音の部品を映像の列に置くと警告する', () => {
    const w = codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001' })] }));
    expect(w).toEqual(['TIMELINE_CLIP_TRACK_KIND']);
  });

  it('文字の部品を音の列に置くと警告する', () => {
    const w = codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002' })] }));
    expect(w).toEqual(['TIMELINE_CLIP_TRACK_KIND']);
  });

  it('テンプレを素材として置いたものは映像の列（ADR-0032 決定5）', () => {
    expect(codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001' })] }))).toEqual([]);
    expect(codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_002' })] }))).toEqual(['TIMELINE_CLIP_TRACK_KIND']);
  });

  it('音の部品を音の列に置けば警告しない', () => {
    expect(codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002' })] }))).toEqual([]);
  });
});

describe('validateTimelineDoc: V24 同一トラック内で時間が重ならない', () => {
  it('重なると警告する（後ろ側のクリップに付く）', () => {
    const w = validateTimelineDoc(doc({
      clips: [
        clip({ id: 'clip_001', startSec: 0, durationSec: 5 }),
        clip({ id: 'clip_002', startSec: 3, durationSec: 5 }),
      ],
    }));
    expect(w.map((x) => x.code)).toEqual(['TIMELINE_CLIP_OVERLAP']);
    expect(w[0].field).toBe('clips.clip_002');
  });

  it('端が接するだけ（前の終わり＝次の始まり）は重なりではない', () => {
    expect(codes(doc({
      clips: [
        clip({ id: 'clip_001', startSec: 0, durationSec: 5 }),
        clip({ id: 'clip_002', startSec: 5, durationSec: 5 }),
      ],
    }))).toEqual([]);
  });

  it('列が違えば同じ時間に置ける（重ねたいなら列を増やす＝本形式の要）', () => {
    expect(codes(doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual },
      ],
      clips: [
        clip({ id: 'clip_001', startSec: 0, durationSec: 5 }),
        clip({ id: 'clip_002', startSec: 0, durationSec: 5, trackId: 'track_003' }),
      ],
    }))).toEqual([]);
  });

  it('長いクリップに覆われた3本目も検知する（直前だけ見ると漏れる）', () => {
    const w = validateTimelineDoc(doc({
      clips: [
        clip({ id: 'clip_001', startSec: 0, durationSec: 100 }),
        clip({ id: 'clip_002', startSec: 1, durationSec: 1 }),
        clip({ id: 'clip_003', startSec: 50, durationSec: 1 }),
      ],
    }));
    // clip_003 は直前（開始順で clip_002）とは重ならないが、clip_001 に覆われている。
    expect(w.map((x) => x.field).sort()).toEqual(['clips.clip_002', 'clips.clip_003']);
  });

  it('3本重なっても同じクリップに同じ案内を重ねて出さない', () => {
    const w = validateTimelineDoc(doc({
      clips: [
        clip({ id: 'clip_001', startSec: 0, durationSec: 10 }),
        clip({ id: 'clip_002', startSec: 1, durationSec: 10 }),
        clip({ id: 'clip_003', startSec: 2, durationSec: 10 }),
      ],
    }));
    expect(w.map((x) => x.field)).toEqual(['clips.clip_002', 'clips.clip_003']);
  });
});

describe('validateTimelineDoc: V25 素材の実在と音の出どころの排他', () => {
  const withAsset = (clips: TimelineClip[]) => doc({
    assets: [{ assetId: 'asset_001', assetType: 'image', displayName: 'a.jpg', filePath: 'assets/a.jpg' }],
    clips,
  });

  it('実在しない素材を指すと警告する', () => {
    expect(codes(withAsset([clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_999' })])))
      .toEqual(['ASSET_NOT_FOUND']);
  });

  it('assetId が null（空）なら警告しない', () => {
    expect(codes(withAsset([clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, assetId: null })]))).toEqual([]);
  });

  it('素材と同梱BGMの両方を指すと警告する（排他）', () => {
    expect(codes(withAsset([
      clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', assetId: 'asset_001', bundledBgmId: 'found-new-hope' }),
    ]))).toEqual(['TIMELINE_AUDIO_SOURCE_CONFLICT']);
  });

  it('同梱BGMだけなら警告しない', () => {
    expect(codes(withAsset([
      clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', bundledBgmId: 'found-new-hope' }),
    ]))).toEqual([]);
  });
});

describe('validateTimelineDoc: 読み上げクリップ（#628）', () => {
  const voice = (over: Partial<TimelineClip> = {}) => clip({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002',
    voice: { text: 'やあ', speaker: 3, status: 'none' }, ...over,
  });

  it('読み上げは音の列に置く（V23）', () => {
    expect(codes(doc({ clips: [voice()] }))).toEqual([]);
    expect(codes(doc({ clips: [voice({ trackId: 'track_001' })] }))).toEqual(['TIMELINE_CLIP_TRACK_KIND']);
  });

  it('読み上げに素材や同梱BGMを重ねると音の出どころが2つになる（V25）', () => {
    expect(codes(doc({ clips: [voice({ bundledBgmId: 'found-new-hope' })] }))).toEqual(['TIMELINE_AUDIO_SOURCE_CONFLICT']);
  });

  it('読み上げ文が空白だけなら知らせる（声を作っても無音になる）', () => {
    const w = validateTimelineDoc(doc({ clips: [voice({ voice: { text: '   ', status: 'none' } })] }));
    expect(w.map((x) => x.code)).toEqual(['TIMELINE_VOICE_TEXT_EMPTY']);
    expect(w[0].severity).toBe('info');
  });

  it('読み上げ以外のクリップに読み上げの中身を置くと知らせる（黙って無視しない）', () => {
    const w = codes(doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, voice: { text: 'やあ', status: 'none' } })] }));
    expect(w).toEqual(['TIMELINE_VOICE_ON_NON_VOICE']);
  });

  it('話者・話速の指定なし（既定を継承）は警告しない', () => {
    expect(codes(doc({ clips: [voice({ voice: { text: 'やあ', status: 'none' } })] }))).toEqual([]);
  });
});

describe('validateTimelineDoc: 立ち絵の表情（テンプレクリップ・V27）', () => {
  const withYuko = (clips: TimelineClip[]) => doc({
    assets: [
      { assetId: 'yuko_smile_001', assetType: 'yuko', displayName: 'ゆうこ', filePath: 'assets/y.png' },
      { assetId: 'asset_img_001', assetType: 'image', displayName: '写真', filePath: 'assets/a.jpg' },
    ],
    clips,
  });
  const tmpl = (poseAssetId: string | null) => clip({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, templateId: 'opening_yuko_right_v1',
    character: { enabled: true, characterId: 'yuko', poseAssetId },
  });

  it('実在しない表情を指すと知らせる', () => {
    const w = validateTimelineDoc(withYuko([tmpl('yuko_angry_999')]));
    expect(w.map((x) => x.code)).toEqual(['ASSET_NOT_FOUND']);
    expect(w[0].field).toBe('clips.clip_001.character');
  });

  it('実在する表情なら警告しない', () => {
    expect(codes(withYuko([tmpl('yuko_smile_001')]))).toEqual([]);
  });

  it('実在しても yuko でない素材（写真）を指すと知らせる＝実在するだけでは立ち絵にならない', () => {
    const w = validateTimelineDoc(withYuko([tmpl('asset_img_001')]));
    expect(w.map((x) => x.code)).toEqual(['ASSET_NOT_FOUND']);
    expect(w[0].field).toBe('clips.clip_001.character');
  });

  it('表情の指定なし（null）は警告しない', () => {
    expect(codes(withYuko([tmpl(null)]))).toEqual([]);
  });
});

describe('danglingTimelineRefs: V26 グループ members / アニメ targetId の参照切れ', () => {
  it('実在しないクリップ/グループを指す参照を返す', () => {
    const d = doc({
      clips: [clip({ id: 'clip_001' })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_999'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [
        { id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0 }] },
        { id: 'anim_002', targetId: 'clip_999', keyframes: [{ timeSec: 0 }] },
      ],
    });
    expect(danglingTimelineRefs(d)).toEqual({ groupMembers: ['clip_999'], animationTargets: ['clip_999'] });
  });

  it('グループ id を指すネスト・アニメ対象は参照切れではない', () => {
    const d = doc({
      clips: [clip({ id: 'clip_001' })],
      groups: [
        { id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
        { id: 'group_002', members: ['group_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
      ],
      animations: [{ id: 'anim_001', targetId: 'group_002', keyframes: [{ timeSec: 0 }] }],
    });
    expect(danglingTimelineRefs(d)).toEqual({ groupMembers: [], animationTargets: [] });
  });

  it('groups/animations 未指定でも落ちない', () => {
    expect(danglingTimelineRefs(doc())).toEqual({ groupMembers: [], animationTargets: [] });
  });
});

describe('clipEndSec / overlappingClipPairs', () => {
  it('終端は開始＋尺', () => {
    expect(clipEndSec(clip({ id: 'clip_001', startSec: 2.5, durationSec: 1.25 }))).toBe(3.75);
  });

  it('重なりの組は（先に始まる方, 後に始まる方）の順で返る', () => {
    const [pair] = overlappingClipPairs([
      clip({ id: 'clip_002', startSec: 3, durationSec: 5 }),
      clip({ id: 'clip_001', startSec: 0, durationSec: 5 }),
    ]);
    expect(pair.map((c) => c.id)).toEqual(['clip_001', 'clip_002']);
  });
});

describe('正典との照合（ドリフト検知）', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

  it('TIMELINE_SCHEMA_VERSION が schema の const と一致する', () => {
    expect(TIMELINE_SCHEMA_VERSION).toBe(schema.properties.schemaVersion.const);
  });

  it('format の const が PROJECT_FORMAT.timeline と一致する', () => {
    expect(schema.properties.format.const).toBe(PROJECT_FORMAT.timeline);
  });

  it('読み上げの中身は場面形式の NarrationLine と制約を共有する（$ref・コピーしない）', () => {
    const v = schema.$defs.TimelineVoice.properties;
    for (const k of ['text', 'speaker', 'speed', 'pitch', 'intonation', 'voicePath', 'status']) {
      expect(v[k].$ref).toBe(`https://yuko-recruit/schemas/project.schema.json#/$defs/NarrationLine/properties/${k}`);
    }
  });

  it('読み上げの中身は時間・字幕の語彙を持たない（時間はクリップ、字幕は字幕クリップの担当）', () => {
    const keys = Object.keys(schema.$defs.TimelineVoice.properties);
    for (const k of ['startSec', 'startWithPrevious', 'subtitleText', 'subtitleEnabled', 'lineId']) {
      expect(keys).not.toContain(k);
    }
  });

  it('TimelineClipKind が schema の kind enum と一致する', () => {
    expect([...schema.$defs.TimelineClip.properties.kind.enum].sort())
      .toEqual(Object.values(TIMELINE_CLIP_KIND).sort());
  });

  it('TrackKind が schema の kind enum と一致する', () => {
    expect([...schema.$defs.Track.properties.kind.enum].sort()).toEqual(Object.values(TRACK_KIND).sort());
  });

  it('素材の寄せ（cropAlign）が schema の enum と一致する（#634）', () => {
    expect([...schema.$defs.TimelineClip.properties.cropAlign.properties.x.enum].sort()).toEqual(
      Object.values(CROP_ALIGN_X).sort(),
    );
    expect([...schema.$defs.TimelineClip.properties.cropAlign.properties.y.enum].sort()).toEqual(
      Object.values(CROP_ALIGN_Y).sort(),
    );
  });

  it('代表データ（fixtures）は意味検証を1件も警告しない', () => {
    const sample = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as TimelineProject;
    expect(validateTimelineDoc(sample)).toEqual([]);
    expect(danglingTimelineRefs(sample)).toEqual({ groupMembers: [], animationTargets: [] });
  });
});

describe('V31：同じ対象に動きは1本まで（#717）', () => {
  const anim = (id: string, targetId: string) => ({ id, targetId, keyframes: [{ timeSec: 0, opacity: 1 }] });

  it('同じ対象に2本あると知らせる（片方が黙って無視されるため）', () => {
    // 読む側（描画・キーフレーム編集・バラす）は `targetId` で `find` して1本しか見ない。
    const w = validateTimelineDoc(doc({
      clips: [clip({ id: 'clip_001' })],
      animations: [anim('anim_001', 'clip_001'), anim('anim_002', 'clip_001')],
    }));
    expect(w.map((x) => x.code)).toContain('TIMELINE_ANIMATION_DUPLICATE');
    // 知らせるのは2本目だけ（同じ話を何度も出さない）。
    expect(w.filter((x) => x.code === 'TIMELINE_ANIMATION_DUPLICATE')).toHaveLength(1);
  });

  it('対象が違えば何も言わない', () => {
    const w = validateTimelineDoc(doc({
      clips: [clip({ id: 'clip_001' }), clip({ id: 'clip_002', startSec: 10 })],
      animations: [anim('anim_001', 'clip_001'), anim('anim_002', 'clip_002')],
    }));
    expect(w.map((x) => x.code)).not.toContain('TIMELINE_ANIMATION_DUPLICATE');
  });
});
