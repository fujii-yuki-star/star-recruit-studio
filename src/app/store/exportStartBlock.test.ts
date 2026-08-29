// 書き出しを始められない理由（#718）。**どの理由が先に出るか**まで固定する
//（順を入れ替えると、直せない理由〔この端末では書き出せない〕が先に出て、直せる理由が隠れる）。
import { describe, expect, it } from 'vitest';
import { exportStartBlock } from './timelineStore';
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from './exportLock';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_1',
  projectName: 'テスト',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
  clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
  ...over,
});

const base = {
  doc: doc(),
  isImporting: false,
  voiceRunning: false,
  knownTemplateIds: new Set<string>(),
  availableUserFontIds: null,
  otherExportRunning: false,
  cleanupPending: false,
  canExportHere: true,
};

describe('exportStartBlock（書き出しを始められるか）', () => {
  it('どれも当てはまらなければ始められる', () => {
    expect(exportStartBlock(base)).toBeNull();
  });

  it('開いていないときは何も言わない（ボタン自体が無い）', () => {
    expect(exportStartBlock({ ...base, doc: null, isImporting: true })).toBeNull();
  });

  // ⚠️ **自分の後片づけ待ちも押させない**（#843）＝終わりの合図は片づけより先に立つので、この窓では
  // ボタンが戻っているのに `acquire` が失敗する（＝押しても断られるだけ・`06 §12.1`）。
  it('自分の後片づけ待ちは、ほかの動画とは別の理由で断る', () => {
    const r = exportStartBlock({ ...base, cleanupPending: true });
    expect(r?.message).toBe(EXPORT_CLEANUP_PENDING_MESSAGE);
    // 主語が違うので流用しない（走っている「ほかの動画」は無い）。
    expect(r?.message).not.toBe(OTHER_EXPORT_RUNNING_MESSAGE);
  });

  // ⚠️ 「両方 true」のテストは**置かない**（レビュー ℹ️）＝2つは同じ `owner` から導く排他の条件で、
  // 呼び出し側が同時に真にできない。作れない組み合わせを固定すると、順序で守っているかのように読める。

  it('理由をそれぞれ返す', () => {
    expect(exportStartBlock({ ...base, isImporting: true })?.message).toContain('取り込み中');
    expect(exportStartBlock({ ...base, voiceRunning: true })?.message).toContain('声を作成中');
    expect(exportStartBlock({ ...base, otherExportRunning: true })?.message).toBeTruthy();
    expect(exportStartBlock({ ...base, canExportHere: false })).toMatchObject({ phase: 'unsupported' });
    // 文書の中身の理由（何も置いていない）。
    expect(exportStartBlock({ ...base, doc: doc({ clips: [] }) })?.phase).toBe('error');
  });

  it('**直せる理由を先に出す**（取り込み中 → 声の作成中 → ほかの書き出し）', () => {
    // 同時に当てはまるとき、先に片づけられるものから出す＝直しても次の理由が出て堂々巡り、を避ける。
    expect(exportStartBlock({ ...base, isImporting: true, voiceRunning: true })?.message).toContain('取り込み中');
    expect(exportStartBlock({ ...base, voiceRunning: true, otherExportRunning: true })?.message).toContain('声を作成中');
  });

  it('理由の**出どころ**を返す（画面が二重に出さないための拠り所・#729 レビュー）', () => {
    // 画面は中身の理由を一覧で全件並べ、いまの事情は一段の知らせで出す。どちらに属するかを
    // 画面側が数え上げ直す（例：一覧が空かどうかで判定する）と、この関数の判定順を推測することになり、
    // 順を入れ替えた瞬間に**同じ文が二重に出る**。属性として返し、画面はそれに従う。
    expect(exportStartBlock({ ...base, isImporting: true })?.source).toBe('situation');
    expect(exportStartBlock({ ...base, voiceRunning: true })?.source).toBe('situation');
    expect(exportStartBlock({ ...base, otherExportRunning: true })?.source).toBe('situation');
    expect(exportStartBlock({ ...base, canExportHere: false })?.source).toBe('situation');
    expect(exportStartBlock({ ...base, doc: doc({ clips: [] }) })?.source).toBe('content');
  });

  it('中身の理由のときは、返す文言が**一覧の1件目と同じ**（画面が重複に気づける形）', () => {
    // ここが食い違うと「一覧に無い文が知らせにだけ出る」＝どちらが本当か分からなくなる。
    const r = exportStartBlock({ ...base, doc: doc({ clips: [] }) });
    expect(r?.source).toBe('content');
    expect(r?.message).toContain('まだ何も置かれていない');
  });

  it('**直せる理由は、直せない理由（この端末では書き出せない）より先**', () => {
    // 逆にすると「この環境では書き出せません」だけが出て、直せば書き出せることに気づけない。
    const r = exportStartBlock({ ...base, doc: doc({ clips: [] }), canExportHere: false });
    expect(r?.phase).toBe('error');
    expect(r?.message).not.toContain('この環境では');
  });
});
