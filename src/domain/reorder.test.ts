import { describe, expect, it } from 'vitest';
import { gapAtPosition, insertIndexForGap } from './reorder';

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

// #714 項目5＝端まで運んで**送っている間は指が止まる**ので、位置からすき間を引き直せる必要がある。
describe('gapAtPosition（位置 → すき間）', () => {
  const items = [
    { start: 0, end: 100 },
    { start: 100, end: 200 },
    { start: 200, end: 300 },
  ];

  it('半分より手前ならその手前のすき間・後ろなら後ろのすき間', () => {
    expect(gapAtPosition(items, 10)).toBe(0);
    expect(gapAtPosition(items, 60)).toBe(1); // 1つ目の後ろ半分
    expect(gapAtPosition(items, 140)).toBe(1); // 2つ目の前半分
    expect(gapAtPosition(items, 160)).toBe(2);
    expect(gapAtPosition(items, 290)).toBe(3);
  });

  it('ちょうど半分は「後ろ」（要素の上で測るときと同じ規則）', () => {
    expect(gapAtPosition(items, 50)).toBe(1);
  });

  // ⚠️ 送っている最中は窓の外へ指がはみ出しうる＝そこで線が消えると「どこに入るか分からないまま」になる。
  it('並びの外は端のすき間（線が消えない）', () => {
    expect(gapAtPosition(items, -50)).toBe(0);
    expect(gapAtPosition(items, 999)).toBe(3);
  });

  // ⚠️ 実寸が取れない環境（jsdom の既定）で**先頭に総取りされない**＝0px の項目は当たりにしない。
  it('大きさの無い項目しかなければ決めない（いまの線を保つ）', () => {
    expect(gapAtPosition([{ start: 0, end: 0 }, { start: 0, end: 0 }], 0)).toBeNull();
    expect(gapAtPosition([], 10)).toBeNull();
  });

  // ⚠️ **大きさの無い項目を当たりから外す**のは、位置がたまたま重なったときに**そこで決めてしまわない**ため
  // （変異チェックで「行は通るが結果を左右しない」状態だと分かったので、結果が変わる材料にした）。
  it('大きさの無い項目が余白に重なっていても、そこでは決めない', () => {
    const ghost = [{ start: 0, end: 100 }, { start: 140, end: 140 }, { start: 150, end: 250 }];
    expect(gapAtPosition(ghost, 140)).toBeNull();
  });

  // ⚠️ 末尾のすき間は**元の並びの数**（大きさの無い項目を数え落とすと1つ手前になる）。
  it('末尾より後ろのすき間は、元の並びの数で返す', () => {
    expect(gapAtPosition([{ start: 0, end: 100 }, { start: 300, end: 300 }], 500)).toBe(2);
  });

  it('項目と項目の間（余白）では決めない', () => {
    const spaced = [{ start: 0, end: 100 }, { start: 150, end: 250 }];
    expect(gapAtPosition(spaced, 120)).toBeNull();
  });

  // ⚠️ **すき間の番号は元の並びの添字**＝大きさの無い項目を飛ばしても番号がずれない。
  it('大きさの無い項目が混ざっても、すき間の番号は元の並びのまま', () => {
    const mixed = [{ start: 0, end: 0 }, { start: 0, end: 100 }, { start: 100, end: 200 }];
    expect(gapAtPosition(mixed, 10)).toBe(1);
    expect(gapAtPosition(mixed, 160)).toBe(3);
  });
});
