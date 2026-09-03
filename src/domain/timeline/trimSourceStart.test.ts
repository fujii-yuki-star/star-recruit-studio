// 左端を詰めたら、素材の頭出しも進める（#988）。
//
// ⚠️ **進めないと、頭は切れず中身が右へずれ、代わりに末尾が落ちる**（他社の型と逆の結果）。
// ⚠️ **しかも「ここで分けて前半を消す」と結果が食い違っていた**（分けるほうは進めていた）＝
// 同じことをする2つの操作で、鳴る音・映る絵が違った。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { trimClip } from './edit';
import { splitClip } from './split';
import type { Template } from '../template/types';

const clip = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001',
  kind: TIMELINE_CLIP_KIND.audio,
  trackId: 'track_002',
  startSec: 0,
  durationSec: 10,
  bundledBgmId: 'found-new-hope',
  ...over,
});

const doc = (clips: TimelineClip[]): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260902_001',
    projectName: 'テスト',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips,
  }) as TimelineProject;

describe('左端を詰めると、素材の頭出しが進む（#988）', () => {
  it('音の部品＝詰めたぶんだけ進む', () => {
    const r = trimClip(doc([clip()]), 'clip_001', 'start', 3);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(3);
  });

  it('速さのぶんも進む（置いた長さ × 速さ ＝ 使う素材の長さ）', () => {
    const r = trimClip(doc([clip({ speed: 2 })]), 'clip_001', 'start', 3);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(6);
  });

  it('既に頭出しがあるときは、そこから足す', () => {
    const r = trimClip(doc([clip({ sourceStartSec: 5 })]), 'clip_001', 'start', 2);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(7);
  });

  it('右端は進めない（素材の使い始めは変わらない）', () => {
    const r = trimClip(doc([clip({ sourceStartSec: 5 })]), 'clip_001', 'end', 8);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(5);
  });

  it('素材の時間を持たない部品（文字）には書かない', () => {
    const text = clip({ kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', bundledBgmId: undefined });
    const r = trimClip(doc([text]), 'clip_001', 'start', 3);
    expect(r.ok && 'sourceStartSec' in r.doc.clips[0]).toBe(false);
  });
});

// ⚠️ **ここが本体**＝同じことをする2つの操作で、結果が同じになる。
describe('「分けて前半を消す」と「左端を詰める」が同じ結果になる（#988）', () => {
  it('音の部品', () => {
    const before = doc([clip()]);
    // ① 3秒で分けて、前半を消す＝後半だけが残る。
    const split = splitClip(before, 'clip_001', 3, () => 1);
    expect(split.ok).toBe(true);
    const tail = split.ok ? split.doc.clips.find((c) => c.id !== 'clip_001')! : null;
    // ② 左端を3秒まで詰める。
    const trimmed = trimClip(before, 'clip_001', 'start', 3);
    expect(trimmed.ok).toBe(true);
    const head = trimmed.ok ? trimmed.doc.clips[0] : null;
    expect(head?.sourceStartSec, '素材のどこから使うかが食い違う').toBe(tail?.sourceStartSec);
    expect(head?.startSec).toBe(tail?.startSec);
    expect(head?.durationSec).toBe(tail?.durationSec);
  });

  it('速さが掛かっていても同じ', () => {
    const before = doc([clip({ speed: 1.5, sourceStartSec: 2 })]);
    const split = splitClip(before, 'clip_001', 4, () => 1);
    const tail = split.ok ? split.doc.clips.find((c) => c.id !== 'clip_001')! : null;
    const trimmed = trimClip(before, 'clip_001', 'start', 4);
    const head = trimmed.ok ? trimmed.doc.clips[0] : null;
    expect(head?.sourceStartSec).toBe(tail?.sourceStartSec);
  });
});

// ⚠️ **差し込み口に入れた動画も同じ**（#988）＝値はクリップ自身でなく**置き場所ごと**に持つので、
// `kind` で絞ると取り残され、**同じ動画が置き場所で挙動が割れる**（直接置きは進むのに）。
describe('差し込み口に入れた動画も、左端を詰めたら進む（#988）', () => {
  const template = {
    schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    layers: [{ id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 }],
  } as unknown as Template;
  const opts = { templateOf: () => template };
  const tmplDoc = (over: Partial<TimelineClip> = {}): TimelineProject =>
    ({
      ...doc([]),
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, templateId: 'tmpl_001', assetRefs: { main: 'asset_v' }, ...over,
      } as TimelineClip],
    }) as TimelineProject;

  it('置き場所ごとの使い始めが進む', () => {
    const r = trimClip(tmplDoc(), 'clip_001', 'start', 3, opts);
    expect(r.ok && r.doc.clips[0].slotClips?.main?.startSec).toBe(3);
  });

  it('「分けて前半を消す」と同じ結果になる', () => {
    const before = tmplDoc();
    const split = splitClip(before, 'clip_001', 3, () => 1, opts);
    const tail = split.ok ? split.doc.clips.find((c) => c.id !== 'clip_001')! : null;
    const trimmed = trimClip(before, 'clip_001', 'start', 3, opts);
    const head = trimmed.ok ? trimmed.doc.clips[0] : null;
    expect(head?.slotClips?.main?.startSec, '置き場所で挙動が割れている').toBe(tail?.slotClips?.main?.startSec);
  });
});

// ⚠️ **画面が見た目パターンを渡しているか**（#988）＝domain が正しくても、
// store が渡さなければ**差し込み口だけ取り残される**（同じ動画が置き場所で挙動が割れる）。
// 分けるほうは渡しているので、**片方だけ渡し忘れる**のがこのリポジトリで繰り返している型。
describe('画面が、見た目パターンを渡している（#988）', () => {
  it('トリムも「分ける」と同じように渡している', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'store', 'timelineStore.ts'), 'utf8');
    const trims = [...src.matchAll(/trimClip\((?:[^;]*?)\)/g)].map((m) => m[0]);
    expect(trims.length, '走査が空振りしている').toBeGreaterThanOrEqual(2);
    // ⚠️ **左端を動かしうる呼び出しだけを見る**＝`'end'` と決め打った呼び出し
    //（声の実尺合わせ）は頭出しに関係しないので、渡していなくても問題にならない。
    // ここを絞らないと、**関係の無い呼び出しのせいで門番が鳴り続け、信用されなくなる**。
    const movesHead = trims.filter((t) => !/,\s*'end'\s*,/.test(t));
    expect(movesHead.length, '左端を動かしうる呼び出しを1つも拾えていない').toBeGreaterThanOrEqual(2);
    const without = movesHead.filter((t) => !t.includes('templateOf'));
    expect(without, '見た目パターンを渡していない呼び出しがある').toEqual([]);
  });
});
