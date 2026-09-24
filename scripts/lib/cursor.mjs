// 仮想カーソルの**絵**と**動き**（#1227・ADR-0046 ③）。
//
// ⚠️ **後から合成する**＝実カーソルを写すには入力注入が要り、**手ブレ・行き過ぎ・迷い**が必ず写る。
// 合成なら**等速で動き、押す前に少し溜める**といった、教材として読みやすい動きが作れる。
//
// ⚠️ **OS の矢印を写さない**（ADR-0046 ③）＝環境依存になる（見た目が撮った機械で変わる）。
// **自前で組む**＝ここは純粋関数なので、**そのまま検査できる**。

/** カーソルの大きさ（画素）。⚠️ 小さいと教材で追えない。1080 で撮ることも考えて少し大きめ。 */
export const CURSOR_W = 24;
export const CURSOR_H = 36;

/**
 * 矢印の輪郭（`CURSOR_W`×`CURSOR_H` の中の座標）。
 *
 * ⚠️ **先端は必ず (0,0)**＝押した位置に**先端**が来る（中心ではない）。
 * 中心に置くと、**押した所と指している所が半分ずれる**（教材として致命的）。
 */
const OUTLINE = [
  [0, 0], [0, 26], [6, 20], [10, 32], [15, 30], [11, 18], [19, 18],
];

/** その点が輪郭の中か（交差数で見る＝形を変えても効く）。 */
function inside(px, py, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * カーソルの画素（RGBA・`CURSOR_W`×`CURSOR_H`）。
 *
 * ⚠️ **白い縁を付ける**＝暗い画面でも明るい画面でも見えるようにする
 *（この製品はダークモードがある＝ADR-0039。黒一色だと暗い画面で消える）。
 */
export function cursorPixels() {
  const px = new Uint8Array(CURSOR_W * CURSOR_H * 4);
  for (let y = 0; y < CURSOR_H; y += 1) {
    for (let x = 0; x < CURSOR_W; x += 1) {
      const i = (y * CURSOR_W + x) * 4;
      const body = inside(x + 0.5, y + 0.5, OUTLINE);
      // 縁＝本体ではないが、まわり1画素に本体がある所
      const edge = !body && [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]
        .some(([dx, dy]) => inside(x + 0.5 + dx, y + 0.5 + dy, OUTLINE));
      if (body) {
        px[i] = 20; px[i + 1] = 20; px[i + 2] = 20; px[i + 3] = 255;
      } else if (edge) {
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
      }
    }
  }
  return px;
}

/**
 * 記録の座標（**画面の中**）を、**録画の中**の位置へ直す。
 *
 * ⚠️ **ここを間違えると、押した所とは違う場所に印が出る**＝「黙って別の場所を教える」
 *（ADR-0026④）。録画は**窓の枠ごと**なので、題字の帯と枠のぶんずれる。
 * ⚠️ **拡大率を掛ける**＝125% 等の設定では CSS の1px が録画の1画素ではない。
 */
export function toVideoPoint(view, x, y) {
  return { x: Math.round(view.offsetX + x * view.dpr), y: Math.round(view.offsetY + y * view.dpr) };
}

/** 押した瞬間の印（輪）の外径。 */
export const RIPPLE_SIZE = 56;

/**
 * 押した瞬間の**輪**の画素（RGBA・`RIPPLE_SIZE` 四方）。
 *
 * ⚠️ **四角にしない**＝`drawbox` の四角は**UI の選択枠に見える**（実際に焼いて見たら紛らわしかった）。
 * ⚠️ **中心が押した点**＝カーソルと違い、こちらは**中心**を押した位置に合わせる。
 * ⚠️ **中を塗らない**＝押した先のボタンが隠れると、何を押したのか分からなくなる。
 */
export function ripplePixels(size = RIPPLE_SIZE, thickness = 3) {
  const px = new Uint8Array(size * size * 4);
  // ⚠️ **画素の真ん中で測る**（`cursorPixels` と同じ約束）＝角を基準にすると、
  //   いちばん外の画素が**わずかに外**と判定されて縁が欠ける（実際に検査が落ちた）。
  const c = size / 2;
  const outer = c;
  const inner = c - thickness;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d <= outer && d >= inner) {
        const i = (y * size + x) * 4;
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 230;
      }
    }
  }
  return px;
}

/**
 * カーソルが**いつ・どこに居るか**（押した記録から作る）。
 *
 * ⚠️ **押す前に少し溜める**＝着いてすぐ押すと、見ている人が「どこを押したか」を追えない。
 * `travelSec` かけて動き、`settleSec` 止まってから押す。
 * ⚠️ **最初の位置は、最初に押す所の少し左上**＝画面の外から入ってこない（どこから来たか分からない）。
 */
export function cursorPath(points, { travelSec = 0.6, settleSec = 0.25 } = {}) {
  if (points.length === 0) return [];
  const path = [];
  let from = { x: Math.max(0, points[0].x - 120), y: Math.max(0, points[0].y - 90) };
  for (const p of points) {
    const start = Math.max(0, p.atSec - travelSec - settleSec);
    path.push({ atSec: Number(start.toFixed(3)), x: from.x, y: from.y });
    path.push({ atSec: Number((p.atSec - settleSec).toFixed(3)), x: p.x, y: p.y });
    path.push({ atSec: Number(p.atSec.toFixed(3)), x: p.x, y: p.y, click: true });
    from = { x: p.x, y: p.y };
  }
  return path;
}

/**
 * その時刻のカーソルの位置（区間の間はまっすぐ等速）。
 *
 * ⚠️ **区間の外は端で止める**＝始まる前は最初の位置、終わったあとは最後の位置。
 * 0 に落とすと**左上へ飛ぶ**（実際に踏みやすい）。
 */
export function cursorAt(path, t) {
  if (path.length === 0) return null;
  if (t <= path[0].atSec) return { x: path[0].x, y: path[0].y };
  for (let i = 1; i < path.length; i += 1) {
    if (t <= path[i].atSec) {
      const a = path[i - 1];
      const b = path[i];
      const span = b.atSec - a.atSec;
      const r = span <= 0 ? 1 : (t - a.atSec) / span;
      return { x: Math.round(a.x + (b.x - a.x) * r), y: Math.round(a.y + (b.y - a.y) * r) };
    }
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y };
}
