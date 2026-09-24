// 場面の数の上限（#1213）。
//
// ⚠️ **守らないと「保存も読込もできるのに、外へ渡したときだけ弾かれる動画」ができる**
//（`schemas/project.schema.json` の `scenes.maxItems` は 80。読込は `maxItems` 違反で拒否しない＝#416）。
import { describe, expect, it } from 'vitest';
import { MAX_SCENES_PER_VIDEO } from '../constants';
import { readFileSync } from 'node:fs';
import { aiSceneLimitMessage, canAddScenes, isAiSceneLimitMessage, sceneLimitMessage } from './sceneLimit';

describe('場面の数の上限', () => {
  it('上限のひとつ手前なら、あと1つ足せる', () => {
    expect(canAddScenes(MAX_SCENES_PER_VIDEO - 1)).toBe(true);
  });

  // ⚠️ **ちょうど上限なら、もう足せない**（境目）。
  it('ちょうど上限なら、もう足せない', () => {
    expect(canAddScenes(MAX_SCENES_PER_VIDEO)).toBe(false);
  });

  // ⚠️ **1つ以外も通す**＝分けても複製しても1つ増える。入口ごとに数えない。
  it('まとめて足すときも、超えるなら断る', () => {
    expect(canAddScenes(MAX_SCENES_PER_VIDEO - 2, 2)).toBe(true);
    expect(canAddScenes(MAX_SCENES_PER_VIDEO - 2, 3)).toBe(false);
  });

});

describe('AI の動画案が上限を超えたときの断り（#1222）', () => {
  // ⚠️ **実際の数を出す**＝「多すぎます」だけだと、どれくらい減らせばよいか分からない。
  it('いくつだったかを出す', () => {
    expect(aiSceneLimitMessage(93)).toContain('93');
    expect(aiSceneLimitMessage(81)).toContain('81');
  });

  it('上限の数も出す（いくつまでか分かる）', () => {
    expect(aiSceneLimitMessage(93)).toContain(String(MAX_SCENES_PER_VIDEO));
  });

  // ⚠️ **取り込んでいないことを言う**＝言わないと「入ったが警告が出た」と読める
  //（実際に入れてしまうと、#1213 が塞いだのと同じ状態を作る）。
  it('取り込んでいないことを言う', () => {
    expect(aiSceneLimitMessage(93)).toContain('取り込んでいません');
  });

  // ⚠️ **次の行動が「消す」ではない**＝まだ1つも取り込んでいないので、消す対象が無い。
  it('次の行動は「減らして作り直す」（消す、ではない）', () => {
    const m = aiSceneLimitMessage(93);
    expect(m).toContain('作り直');
    expect(m, 'この道では消す対象が無い').not.toContain('要らない場面を消す');
  });

  // ⚠️ **同じ内容で頼み直すとまた超える**＝何度押しても直らない行動を勧めない（§2-5）。
  it('「もう一度お試しください」とは言わない', () => {
    expect(aiSceneLimitMessage(93)).not.toContain('もう一度お試しください');
  });

  // ⚠️ **技術用語を出さない**（§2-3）。
  it('技術用語を出さない', () => {
    const m = aiSceneLimitMessage(93);
    for (const word of ['スキーマ', 'schema', 'maxItems', 'AI', 'プラン']) expect(m).not.toContain(word);
  });

  // ⚠️ **見分けは、文と同じ目印から作る**（PR #1223 の変異チェックで生き残った）＝
  //   `isAiSceneLimitMessage` が**別の文字列を写して**持つと、文を書き換えたときに**見分けだけ古くなり**、
  //   画面が「上限の断り」と気づけなくなる（＝同じ入力の再送ボタンに戻る）。
  //   写していないことは**目印の出現数**で留める＝定義1つ＋文で1回＋見分けで1回＝**3回**。
  it('見分けと文は、同じ目印から作る（写していない）', () => {
    const src = readFileSync('src/domain/project/sceneLimit.ts', 'utf8');
    expect(
      src.split('AI_SCENE_LIMIT_MARK').length - 1,
      '目印を1か所から使っていない（どこかで文字列を写している）',
    ).toBe(3);
  });

  it('見分けは、ほかの断りを拾わない', () => {
    expect(isAiSceneLimitMessage(aiSceneLimitMessage(93))).toBe(true);
    expect(isAiSceneLimitMessage(sceneLimitMessage()), '手で足すときの断りを拾っている').toBe(false);
    expect(isAiSceneLimitMessage(null)).toBe(false);
  });
});

describe('これ以上足せないときの案内', () => {
  // ⚠️ **次の行動を2つ出す**（§2-5）＝この動画の中で解決する道と、形式を移る道。
  it('次の行動を示す', () => {
    const m = sceneLimitMessage();
    expect(m).toContain('消す');
    expect(m).toContain('焼き出し');
  });

  it('上限の数を出す（いくつまでか分かる）', () => {
    expect(sceneLimitMessage()).toContain(String(MAX_SCENES_PER_VIDEO));
  });

  // ⚠️ **技術用語を出さない**（§2-3）。
  it('技術用語を出さない', () => {
    const m = sceneLimitMessage();
    for (const ng of ['schema', 'maxItems', 'シーン', 'JSON', 'タイムライン形式']) {
      expect(m, `技術用語が出ている: ${ng}`).not.toContain(ng);
    }
  });
});
