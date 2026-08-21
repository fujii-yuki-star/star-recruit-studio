// 端送りの速さ（#714-1）。掴む操作が「見えている時間帯にしか置けない」を脱するための規則。
import { describe, expect, it } from 'vitest';
import { EDGE_MAX_PX_PER_SEC, EDGE_ZONE_PX, edgeScrollPxPerSec, nextScrollPos, playbackScrollLeft } from './autoScroll';

const at = (pointerPx: number, viewPx = 800) => edgeScrollPxPerSec({ pointerPx, viewPx });

describe('edgeScrollPxPerSec（端送りの速さ）', () => {
  it('真ん中では送らない', () => {
    expect(at(400)).toBe(0);
  });

  it('帯の外側の縁では送らない（帯に入った所から効き始める）', () => {
    expect(at(EDGE_ZONE_PX)).toBe(0);
    expect(at(800 - EDGE_ZONE_PX)).toBe(0);
  });

  it('左は負・右は正（向きを取り違えない）', () => {
    expect(at(EDGE_ZONE_PX - 1)).toBeLessThan(0);
    expect(at(800 - EDGE_ZONE_PX + 1)).toBeGreaterThan(0);
  });

  it('深いほど速い（端に貼り付けなくても少しずつ動く）', () => {
    expect(Math.abs(at(10))).toBeGreaterThan(Math.abs(at(30)));
    expect(at(795)).toBeGreaterThan(at(770));
  });

  it('いちばん端で最大になる', () => {
    expect(at(0)).toBeCloseTo(-EDGE_MAX_PX_PER_SEC, 5);
    expect(at(800)).toBeCloseTo(EDGE_MAX_PX_PER_SEC, 5);
  });

  it('枠の外へ出ても最大のまま（跳ねない・止まらない）', () => {
    // ⚠️ 窓の外まで指を出すのは普通の操作（運びながら端へ寄せる）。ここで 0 に戻ると
    // 「行き過ぎると急に止まる」＝送りたいのに止まる、という逆の手応えになる。
    expect(at(-500)).toBeCloseTo(-EDGE_MAX_PX_PER_SEC, 5);
    expect(at(1300)).toBeCloseTo(EDGE_MAX_PX_PER_SEC, 5);
  });

  it('左の帯は**見えない幅の内側**から測る（名前の欄の下に隠れない）', () => {
    // ⚠️ 0 のままだと帯 48px が欄 84px の下に丸ごと入り、左へ送っている間はどこへ入るか見えない。
    const inset = (pointerPx: number) => edgeScrollPxPerSec({ pointerPx, viewPx: 800, insetStartPx: 84 });
    expect(inset(84 + EDGE_ZONE_PX)).toBe(0); // 帯の外側の縁
    expect(inset(84 + EDGE_ZONE_PX - 1)).toBeLessThan(0); // 帯の中
    expect(inset(84)).toBeCloseTo(-EDGE_MAX_PX_PER_SEC, 5); // 欄のすぐ内側で最大
    expect(inset(40)).toBeCloseTo(-EDGE_MAX_PX_PER_SEC, 5); // 欄の上でも最大のまま（跳ねない）
  });

  it('帯2つ分に満たない幅では効かせない（真ん中でも勝手に動く、を作らない）', () => {
    expect(edgeScrollPxPerSec({ pointerPx: 40, viewPx: EDGE_ZONE_PX * 2 - 1 })).toBe(0);
  });
});

describe('nextScrollPos（行き止まりで止まる）', () => {
  it('端を越えない', () => {
    expect(nextScrollPos(10, -100, 500)).toBe(0);
    expect(nextScrollPos(490, 100, 500)).toBe(500);
  });

  it('端に着いたら同じ値を返す（これ以上動かないと呼び出し側が判る）', () => {
    expect(nextScrollPos(0, -50, 500)).toBe(0);
    expect(nextScrollPos(500, 50, 500)).toBe(500);
  });

  it('途中はそのまま足す', () => {
    expect(nextScrollPos(100, 30, 500)).toBe(130);
  });
});

// 再生に合わせて見える範囲を送る（#819-1・ページ送り）。**常に追わない**＝ヘッドが見えている間は
// 動かさず、枠の外へ出たときだけ送る（毎フレーム中央へ寄せると画面が流れ続けて位置関係が読めない）。
describe('playbackScrollLeft（再生の追従）', () => {
  const base = { scrollLeft: 0, viewPx: 600, contentPx: 3000, headPx: 100, insetStartPx: 100 };

  it('見えている間は送らない', () => {
    expect(playbackScrollLeft(base)).toBeNull();
    expect(playbackScrollLeft({ ...base, headPx: 500 })).toBeNull(); // 右端ちょうど（600-100）
  });

  it('右へ出たら、ヘッドが左端に来るよう送る（続きがいちばん長く見える）', () => {
    expect(playbackScrollLeft({ ...base, headPx: 501 })).toBe(501);
  });

  it('左へ出ても送る（前へ戻したのに画面だけ先のまま、を作らない）', () => {
    expect(playbackScrollLeft({ ...base, scrollLeft: 1000, headPx: 200 })).toBe(200);
  });

  it('行き止まりでは動かない（同じ値は返さず null）', () => {
    // 中身 3000・見える幅 500 → 最大 2500。それ以上は送れない。
    expect(playbackScrollLeft({ ...base, scrollLeft: 2500, headPx: 2900 })).toBeNull();
  });

  it('中身が見える幅より短ければ送らない', () => {
    expect(playbackScrollLeft({ ...base, contentPx: 300, headPx: 900 })).toBeNull();
  });
});
