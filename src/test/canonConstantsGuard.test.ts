// 正典の数表（`11 §4`）と、実装の定数と、schema の制約が**同じ値**である（#1205・ADR-0045）。
//
// ⚠️ **なぜ要るか**＝動画の長さの上限は**3か所**に書いてある：
// `11 §4` の表／`src/domain/constants.ts`／`schemas/project.schema.json` の `maxDurationSec.maximum`。
// **手で3か所を揃える**しかなく、**1か所忘れても何も落ちません**（正典と実装が黙ってずれる）。
//
// ⚠️ **ADR-0045 は当初「門番がある」と書いていましたが、探したら**存在しませんでした**
// （PR #1215 レビュー 🟡）。**無い門番を「ある」と書くと、直す人が「自動で守られている」と
// 思い込んで3か所目を落とします**。この検査は、その嘘を本当にするために作ったものです。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_SCENE_MAX_DURATION_SEC,
  AI_SCENE_MIN_DURATION_SEC,
  BGM_VOLUME,
  MAX_NARRATION_LEN_DEFAULT,
  MAX_SCENES_PER_VIDEO,
  MAX_SUBTITLE_LEN_DEFAULT,
  NARRATION_VOLUME,
  ORIGINAL_AUDIO_VOLUME,
  SCENE_DEFAULT_DURATION_SEC,
  SEC_STEP,
  TRANSITION_DEFAULT_SEC,
  VIDEO_HARD_MAX_SEC,
  VIDEO_TARGET_MAX_SEC_MVP,
} from '../domain/constants';

const CANON = 'docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md';
const SCHEMA = 'docs/yuko_recruit_docs/schemas/project.schema.json';

/**
 * `11 §4` の表から、その定数の値を読む。
 *
 * 表の形＝`| \`NAME\` | \`値\` | 説明 |`。⚠️ **値は `\`` で囲まれている**ので、そこだけを採る
 *（説明の中の数字を拾わない）。
 */
function canonValue(name: string): number | null {
  const md = readFileSync(CANON, 'utf8');
  const row = md.split('\n').find((l) => l.startsWith(`| \`${name}\` |`));
  if (!row) return null;
  const m = row.split('|')[2]?.match(/`(-?\d+(?:\.\d+)?)`/);
  return m ? Number(m[1]) : null;
}

/** 正典の表に載せている定数と、その実装の値。 */
const PAIRS: readonly [string, number][] = [
  ['AI_SCENE_MIN_DURATION_SEC', AI_SCENE_MIN_DURATION_SEC],
  ['AI_SCENE_MAX_DURATION_SEC', AI_SCENE_MAX_DURATION_SEC],
  ['SCENE_DEFAULT_DURATION_SEC', SCENE_DEFAULT_DURATION_SEC],
  ['TRANSITION_DEFAULT_SEC', TRANSITION_DEFAULT_SEC],
  ['VIDEO_TARGET_MAX_SEC_MVP', VIDEO_TARGET_MAX_SEC_MVP],
  ['VIDEO_HARD_MAX_SEC', VIDEO_HARD_MAX_SEC],
  ['MAX_SCENES_PER_VIDEO', MAX_SCENES_PER_VIDEO],
  ['NARRATION_VOLUME', NARRATION_VOLUME],
  ['BGM_VOLUME', BGM_VOLUME],
  ['ORIGINAL_AUDIO_VOLUME', ORIGINAL_AUDIO_VOLUME],
  ['MAX_NARRATION_LEN_DEFAULT', MAX_NARRATION_LEN_DEFAULT],
  ['MAX_SUBTITLE_LEN_DEFAULT', MAX_SUBTITLE_LEN_DEFAULT],
  ['SEC_STEP', SEC_STEP],
];

describe('正典の数表と、実装の定数が同じ（#1205・ADR-0045）', () => {
  // ⚠️ **走査そのものを検査する**＝表の形が変わって1つも読めなくなっても緑、を防ぐ
  //（門番が「見えていないのに緑」になる型）。
  it('表から値を読めている（読めなくなったら落ちる）', () => {
    const missing = PAIRS.filter(([name]) => canonValue(name) === null).map(([n]) => n);
    expect(missing.join(', '), '`11 §4` の表から値を読めない定数がある（表の形が変わった？）').toBe('');
  });

  it.each(PAIRS)('`%s` は正典と実装で同じ値', (name, actual) => {
    expect(canonValue(name), `\`11 §4\` の表と \`domain/constants.ts\` がずれている（${name}）`).toBe(actual);
  });

  // ⚠️ **schema も同じ値でなければならない**＝ここがずれると、
  // **アプリでは作れるのに、取り込めない（外へ渡せない）動画**ができる。
  it('動画の長さの上限は、schema の制約とも同じ', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
      $defs: { VideoSettings: { properties: { maxDurationSec: { maximum: number } } } };
    };
    expect(
      schema.$defs.VideoSettings.properties.maxDurationSec.maximum,
      '`schemas/project.schema.json` の `maxDurationSec.maximum` が `VIDEO_HARD_MAX_SEC` とずれている',
    ).toBe(VIDEO_HARD_MAX_SEC);
  });

  // ⚠️ **版の一覧が置いていかれない**（PR #1220 レビュー 🟡）＝
  // `PROJECT_SCHEMA_VERSION` の docstring は**版ごとの理由を並べた唯一の一覧**（`11 §1` もそう書いている）。
  // ⚠️ **値そのものは守られても、一覧の完全性を見るものが無かった**＝
  // 次のバンプで気づかれないまま**2版ぶん抜ける**（レビューで実際に1版ぶん抜けていた）。
  it('版を上げたら、理由の一覧にもその版が載っている', () => {
    const src = readFileSync('src/domain/project/persistence.ts', 'utf8');
    const now = src.match(/export const PROJECT_SCHEMA_VERSION = '([\d.]+)';/)?.[1];
    expect(now, '現行版を読み取れない').toBeTruthy();
    // ⚠️ **版のすぐ後ろの区切りまで見る**＝`→1.30` だけで見ると `→1.300` や `→1.30x` にも当たる
    // （変異チェックで実際に素通りした）。一覧はどの項目も `→版：` の形で書かれている。
    expect(
      src.includes(`→${now}：`),
      `\`PROJECT_SCHEMA_VERSION\` の説明に「→${now}：」の項目が無い（上げた理由を1行足すこと）`,
    ).toBe(true);
  });

  // ⚠️ **タイムライン形式も同じ**＝共有 `$defs` を変えたら両方を上げる（`11 §1`）。
  it('タイムライン形式の版も、schema と実装で同じ', () => {
    const code = readFileSync('src/domain/timeline/types.ts', 'utf8');
    const impl = code.match(/export const TIMELINE_SCHEMA_VERSION = '([\d.]+)';/)?.[1];
    const schema = JSON.parse(readFileSync('docs/yuko_recruit_docs/schemas/timeline-project.schema.json', 'utf8')) as {
      properties: { schemaVersion: { const: string } };
    };
    expect(impl, 'timeline の版を読み取れない').toBeTruthy();
    expect(schema.properties.schemaVersion.const, 'schema と実装で版がずれている').toBe(impl);
  });

  // ⚠️ **場面形式も同じ**。
  it('場面形式の版も、schema と実装で同じ', () => {
    const code = readFileSync('src/domain/project/persistence.ts', 'utf8');
    const impl = code.match(/export const PROJECT_SCHEMA_VERSION = '([\d.]+)';/)?.[1];
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
      properties: { schemaVersion: { const: string } };
    };
    expect(schema.properties.schemaVersion.const, 'schema と実装で版がずれている').toBe(impl);
  });

  // ⚠️ **AI へ渡す希望尺の上限も schema にある**＝こちらは据え置き（ADR-0045）だが、同じ形でずれうる。
  it('AI へ渡す希望尺の上限も、schema の制約と同じ', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
      $defs: { VideoSettings: { properties: { targetDurationSec: { maximum: number } } } };
    };
    expect(schema.$defs.VideoSettings.properties.targetDurationSec.maximum).toBe(VIDEO_TARGET_MAX_SEC_MVP);
  });
});
