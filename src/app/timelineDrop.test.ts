// @vitest-environment jsdom
// 落とした位置の翻訳（#684）。ゴーストと実際の置き場所が同じ計算を通ることを、ここで固定する。
import { describe, expect, it } from 'vitest';
import { canvasPointAt, clampToVisible, intersectRects, laneTimeAt, pointInRect, visibleRectOf } from './timelineDrop';

const stage = { left: 100, top: 50, width: 640, height: 360 }; // 16:9 の枠

describe('canvasPointAt（仕上がり確認の中で落とした点）', () => {
  it('横型は枠いっぱいに描かれる（左上・中央・右下）', () => {
    const c = { width: 1920, height: 1080 };
    expect(canvasPointAt(stage, c, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(canvasPointAt(stage, c, 420, 230)).toEqual({ x: 960, y: 540 });
    expect(canvasPointAt(stage, c, 740, 410)).toEqual({ x: 1920, y: 1080 });
  });

  it('縦型は左右に余白が入る（枠の px をそのまま比で割らない）', () => {
    // 1080x1920 を 640x360 の枠へ収める＝高さ基準（scale = 360/1920 = 0.1875）。
    // 描かれる幅は 1080*0.1875 = 202.5px、左右の余白は (640-202.5)/2 = 218.75px ずつ。
    const c = { width: 1080, height: 1920 };
    expect(canvasPointAt(stage, c, 100 + 218.75, 50)).toEqual({ x: 0, y: 0 });
    // 枠の真ん中＝動画の真ん中。
    expect(canvasPointAt(stage, c, 420, 230)).toEqual({ x: 540, y: 960 });
    // 枠の左端は**動画の外**（負の座標）＝余白を無視すると 0 になってしまう所。
    expect(canvasPointAt(stage, c, 100, 230).x).toBeLessThan(0);
  });

  it('枠より横長の動画は上下に余白が入る（余白を半分にし忘れない）', () => {
    // 2000x500 を 640x360 の枠へ収める＝幅基準（scale = 640/2000 = 0.32）。
    // 描かれる高さは 500*0.32 = 160px、上下の余白は (360-160)/2 = 100px ずつ。
    const c = { width: 2000, height: 500 };
    expect(canvasPointAt(stage, c, 100, 50 + 100)).toEqual({ x: 0, y: 0 });
    expect(canvasPointAt(stage, c, 420, 230)).toEqual({ x: 1000, y: 250 }); // 枠の真ん中＝動画の真ん中
    expect(canvasPointAt(stage, c, 100, 50).y).toBeLessThan(0); // 枠の上端は動画の外
  });

  it('枠の外に落ちた点も寄せずに返す（置ける/置けないは呼び出し側が決める）', () => {
    const c = { width: 1920, height: 1080 };
    expect(canvasPointAt(stage, c, 60, 20)).toEqual({ x: -120, y: -90 });
  });

  it('大きさが取れないときは 0 を返す（0 除算で NaN を返さない）', () => {
    expect(canvasPointAt({ left: 0, top: 0, width: 0, height: 0 }, { width: 1920, height: 1080 }, 10, 10))
      .toEqual({ x: 0, y: 0 });
    expect(canvasPointAt(stage, { width: 0, height: 0 }, 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('laneTimeAt（列の中で落とした点）', () => {
  it('列の左端からの距離を時刻にする', () => {
    expect(laneTimeAt({ left: 200 }, 40, 200)).toBe(0);
    expect(laneTimeAt({ left: 200 }, 40, 400)).toBe(5);
  });

  it('0秒より手前へは行かない（負の時刻を作らない）', () => {
    expect(laneTimeAt({ left: 200 }, 40, 100)).toBe(0);
  });

  it('尺が取れないときは 0（0 除算で Infinity を返さない）', () => {
    expect(laneTimeAt({ left: 200 }, 0, 400)).toBe(0);
  });
});

describe('pointInRect', () => {
  const r = { left: 10, top: 20, right: 110, bottom: 70 };
  it('中と縁は入っている・外は入っていない', () => {
    expect(pointInRect(r, 50, 50)).toBe(true);
    expect(pointInRect(r, 10, 20)).toBe(true);
    expect(pointInRect(r, 110, 70)).toBe(true);
    expect(pointInRect(r, 9, 50)).toBe(false);
    expect(pointInRect(r, 50, 71)).toBe(false);
  });
});

describe('intersectRects（見えている分だけを落とし先にする）', () => {
  const a = { left: 0, top: 0, right: 100, bottom: 100 };
  it('重なった分を返す', () => {
    expect(intersectRects(a, { left: 50, top: 50, right: 200, bottom: 200 }))
      .toEqual({ left: 50, top: 50, right: 100, bottom: 100 });
  });
  it('重なっていなければ null（触れているだけも null）', () => {
    expect(intersectRects(a, { left: 200, top: 0, right: 300, bottom: 100 })).toBeNull();
    expect(intersectRects(a, { left: 100, top: 0, right: 200, bottom: 100 })).toBeNull(); // 端が接するだけ
  });
  it('片方がもう片方をすっかり含むときは内側', () => {
    expect(intersectRects(a, { left: -10, top: -10, right: 110, bottom: 110 })).toEqual(a);
  });
});

describe('visibleRectOf（スクロールで隠れた分を落とし先にしない）', () => {
  const rect = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
  };
  const build = (overflow: string) => {
    document.body.innerHTML = '';
    const box = document.createElement('div');
    box.style.overflow = overflow;
    const inner = document.createElement('div');
    box.appendChild(inner);
    document.body.appendChild(box);
    return { box, inner };
  };

  it('中身を切っている祖先があると、見えている分だけになる', () => {
    const { box, inner } = build('auto');
    rect(box, { left: 0, top: 0, width: 100, height: 50 });   // 欄の見えている範囲
    rect(inner, { left: 0, top: 0, width: 800, height: 50 }); // 列は横へはみ出している
    expect(visibleRectOf(inner)).toEqual({ left: 0, top: 0, right: 100, bottom: 50 });
  });

  it('すっかり外へ出ていたら落とし先にしない', () => {
    const { box, inner } = build('auto');
    rect(box, { left: 0, top: 0, width: 100, height: 50 });
    rect(inner, { left: 0, top: 200, width: 800, height: 50 }); // 縦にスクロールして欄の外
    expect(visibleRectOf(inner)).toBeNull();
  });

  it('切っていない祖先は数えない（指定なしの `overflow` を「切っている」と読まない）', () => {
    const { box, inner } = build('visible');
    rect(box, { left: 0, top: 0, width: 100, height: 50 });
    rect(inner, { left: 0, top: 0, width: 800, height: 50 });
    expect(visibleRectOf(inner)).toEqual({ left: 0, top: 0, right: 800, bottom: 50 });
  });
});

// 運ぶ側（`useDragReorder`）と列の並べ替え（`TimelineProjectScreen`）が**共有する**丸めの規則。
// 2か所に書いていたものを1つへ寄せた（#802-3 レビュー）＝ここが規則の持ち主。
describe('clampToVisible（見えている範囲へ丸める）', () => {
  const view = { left: 10, top: 20, right: 110, bottom: 220 };

  it('外へ出た指を、その向きの端で止める', () => {
    expect(clampToVisible(view, 500, 'y')).toBe(220);
    expect(clampToVisible(view, -50, 'y')).toBe(20);
    expect(clampToVisible(view, 500, 'x')).toBe(110);
    expect(clampToVisible(view, -50, 'x')).toBe(10);
  });

  it('中にいる指はそのまま（丸めが位置を動かさない）', () => {
    expect(clampToVisible(view, 100, 'y')).toBe(100);
    expect(clampToVisible(view, 100, 'x')).toBe(100);
  });

  it('向きの取り違えで丸めない（縦の端で横を止めない）', () => {
    // 横は 10〜110・縦は 20〜220＝同じ位置でも向きで結果が変わる。
    expect(clampToVisible(view, 200, 'x')).toBe(110);
    expect(clampToVisible(view, 200, 'y')).toBe(200);
  });

  // ⚠️ **測れないときは丸めない**＝潰れた矩形で丸めると、すべての位置が端へ潰れて
  // 「どこへ運んでも先頭のすき間」になる（jsdom や、まだ描かれていない欄で実際に起きる）。
  it('高さ・幅の無い箱では丸めない（全部が端へ潰れない）', () => {
    const flat = { left: 10, top: 50, right: 110, bottom: 50 };
    expect(clampToVisible(flat, 500, 'y')).toBe(500);
    expect(clampToVisible(flat, 500, 'x')).toBe(110); // 横は測れている＝そちらは丸める
    const thin = { left: 60, top: 20, right: 60, bottom: 220 };
    expect(clampToVisible(thin, 500, 'x')).toBe(500);
  });

  it('測れる箱が無いとき（null）は丸めない', () => {
    expect(clampToVisible(null, 500, 'y')).toBe(500);
  });
});
