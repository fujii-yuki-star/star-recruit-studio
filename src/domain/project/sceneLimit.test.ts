// 場面の数の上限（#1213）。
//
// ⚠️ **守らないと「保存も読込もできるのに、外へ渡したときだけ弾かれる動画」ができる**
//（`schemas/project.schema.json` の `scenes.maxItems` は 80。読込は `maxItems` 違反で拒否しない＝#416）。
import { describe, expect, it } from 'vitest';
import { MAX_SCENES_PER_VIDEO } from '../constants';
import { canAddScenes, sceneLimitMessage, sceneSlotsLeft } from './sceneLimit';

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

  it('あと何個足せるかを返す', () => {
    expect(sceneSlotsLeft(MAX_SCENES_PER_VIDEO - 3)).toBe(3);
    expect(sceneSlotsLeft(MAX_SCENES_PER_VIDEO)).toBe(0);
  });

  // ⚠️ **負にしない**＝既に超えている動画（前の版で作られたもの）を開いても画面を壊さない。
  it('既に超えていても、残りは負にしない', () => {
    expect(sceneSlotsLeft(MAX_SCENES_PER_VIDEO + 5)).toBe(0);
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
