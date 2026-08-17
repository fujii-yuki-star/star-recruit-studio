import { describe, expect, it } from 'vitest';
import { insertIndexForGap } from './reorder';

// #771(c)：落とし先を「重なった項目」で決めると、同じ手つきが向きで別の意味になる
//（前へ動かすとその手前・後ろへ動かすとその後ろ＝1つずれる）。すき間で決めれば向きに依らない。

/** 実際に動かしてみる（`splice` は抜いてから入れる＝`moveSceneToIndexInList` と同じ手順）。 */
const move = (list: string[], from: number, gap: number): string[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(insertIndexForGap(gap, from), 0, item);
  return next;
};

describe('insertIndexForGap（すき間 → 入れる位置・#771(c)）', () => {
  const abcd = ['A', 'B', 'C', 'D'];

  it('先頭の手前（すき間0）へ入れる', () => {
    expect(move(abcd, 2, 0)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('末尾の後ろ（すき間n）へ入れる', () => {
    expect(move(abcd, 0, 4)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('**同じすき間なら、どちらから来ても同じ結果**（向きで意味が変わらない）', () => {
    // B と C の間（すき間2）へ入れる。A は後ろから、D は前から来る。
    expect(move(abcd, 0, 2)).toEqual(['B', 'A', 'C', 'D']); // A を B と C の間へ
    expect(move(abcd, 3, 2)).toEqual(['A', 'B', 'D', 'C']); // D を B と C の間へ
    // どちらも「B の後ろ・C の手前」に入っている＝手つきの意味が向きに依らない。
  });

  it('自分の手前・自分の後ろのすき間は動かない（no-op）', () => {
    expect(move(abcd, 1, 1)).toEqual(abcd); // B の手前＝いまの位置
    expect(move(abcd, 1, 2)).toEqual(abcd); // B の後ろ＝いまの位置
  });

  it('抜いた場所より後ろは1つ手前へずれる／手前はそのまま', () => {
    expect(insertIndexForGap(3, 1)).toBe(2); // 後ろへ入れる＝ずれる
    expect(insertIndexForGap(1, 3)).toBe(1); // 手前へ入れる＝そのまま
    expect(insertIndexForGap(2, 2)).toBe(2); // 同じ位置＝そのまま
  });
});
