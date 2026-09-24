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
 *
 * ⚠️ **拡大率は掛けない**（PR #1237 レビュー 🟡）＝以前は `x * dpr` と書いていたが、**式として誤り**だった。
 * `view.offsetX` は `screenX - windowX`＝**CSS px と物理 px の引き算**なので、`dpr !== 1` では
 * **`offsetX` 自体が壊れている**。その上に掛け算を足しても直らない。
 * ⚠️ **だから 100% 以外は断る**（`tutorialRecord` と同じ）＝#1226 で決めた扱いに揃える。
 * 「掛ければよい」は**誰も確かめていない推測**で、検査に固定すると**嘘が仕様になる**（§9-2）。
 */
export function toVideoPoint(view, x, y) {
  return { x: Math.round(view.offsetX + x), y: Math.round(view.offsetY + y) };
}

/** 拡大率が 100% でないときの断り（録る側と焼く側で**同じ文**にする）。 */
export const SCALE_NOT_100_MESSAGE = (dpr) =>
  `画面の拡大率が ${Math.round(dpr * 100)}% です。100% にしてから撮ってください`;

/** 押した瞬間の印（輪）の外径。 */
export const RIPPLE_SIZE = 56;
/** 押した瞬間の印が出ている長さ（秒）。⚠️ **絵と一緒に置く**＝焼く側と検査側で同じ値を使う。 */
export const RIPPLE_SEC = 0.45;

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
 * 塗られた画素の**重心**（絵の左上からの位置）。
 *
 * ⚠️ **検査の期待値をここから作る**（PR #1237 レビュー 🟡）＝以前は「押した点」を期待値にしていたが、
 * **輪が左右対称で重心が押した点そのもの**なので、**カーソルが1画素も描かれていなくても合格**していた。
 * 重心を期待値にすると、**カーソル本体**が検査に入る。
 *
 * ⚠️ **`view` のずれは、これでは**依然として**見えない**（PR #1237 再レビュー 🔴）＝
 * 期待値も焼く位置も**同じ `view`** から出るので、両方が同じだけずれて辻褄が合う
 *（実測＝ずれを丸ごと落としても `✓` が出た）。**そちらは `tutorialRecord.mjs` が録画から実測して見る**
 *（`checkViewAgainstVideo`）。層の分け方は ADR-0046 の表にある。
 */
export function artCentroid(px, w, h) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (px[(y * w + x) * 4 + 3] > 0) { sx += x; sy += y; n += 1; }
    }
  }
  return n === 0 ? null : { x: sx / n, y: sy / n, count: n };
}

/**
 * 押した瞬間に**焼かれる絵ぜんたいの重心**（録画の中の位置）。
 *
 * ⚠️ **カーソルは先端が押した点**、**輪は中心が押した点**＝置き方が違うので、
 * それぞれの原点から重心を足して、画素数で重みを付ける。
 */
export function expectedMarkCenter(at) {
  const cur = artCentroid(cursorPixels(), CURSOR_W, CURSOR_H);
  const rip = artCentroid(ripplePixels(), RIPPLE_SIZE, RIPPLE_SIZE);
  const half = RIPPLE_SIZE / 2;
  const total = cur.count + rip.count;
  return {
    x: (cur.count * (at.x + cur.x) + rip.count * (at.x - half + rip.x)) / total,
    y: (cur.count * (at.y + cur.y) + rip.count * (at.y - half + rip.y)) / total,
    count: total,
  };
}

/** カーソルだけが出ているときの重心（輪が消えたあと＝**カーソル本体を検査するため**）。 */
export function expectedCursorCenter(at) {
  const cur = artCentroid(cursorPixels(), CURSOR_W, CURSOR_H);
  return { x: at.x + cur.x, y: at.y + cur.y, count: cur.count };
}

/**
 * 録画の終わりに残す安全代（秒）。
 *
 * ⚠️ **`totalSec` を信じきらない**＝これは **ffmpeg を起こしてからの秒**で、録画の実尺は
 * **数百 ms 短い**（`timeBaseNote`）。引かないと末尾の標本が**録画の外**に出て、
 * 不具合が無いのに「コマを取り出せません」で落ちる。
 */
export const TAIL_GUARD_SEC = 0.6;

/** 押す場所まで動く時間と、着いてから押すまでの溜め（秒）。⚠️ **検査もこの値を使う**（直書きしない）。 */
export const TRAVEL_SEC = 0.6;
export const SETTLE_SEC = 0.25;

/**
 * カーソルが**いつ・どこに居るか**（押した記録から作る）。
 *
 * ⚠️ **押す前に少し溜める**＝着いてすぐ押すと、見ている人が「どこを押したか」を追えない。
 * `travelSec` かけて動き、`settleSec` 止まってから押す。
 * ⚠️ **最初の位置は、最初に押す所の少し左上**＝画面の外から入ってこない（どこから来たか分からない）。
 */
export function cursorPath(points, { travelSec = TRAVEL_SEC, settleSec = SETTLE_SEC } = {}) {
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

/**
 * その時刻の位置を表す**式**（`overlay` と検査で**同じ木**から出す）。
 *
 * ⚠️ **写して増やさない**（PR #1237 レビュー 🟡）＝以前は `tutorialCursor.mjs` が
 * ffmpeg 用の式を**別に組み立てて**おり、`cursorAt` と**同じ意味を2つの言語で二重に書いた**形だった
 *（端の扱いまで別々＝`Math.max(0.001, span)` と `span <= 0 ? 1 : …`）。しかも**焼いた後の検査が
 * カーソル本体を見ていなかった**ので、この式は**どの網にも掛かっていなかった**。
 * ⚠️ **枝の形を共有し、方言の差は2つの関数（`lt`／`iff`）に閉じる**（PR #1237 再レビュー ℹ️）＝
 * 「ずれようがない」とまでは言えない（共有されるのは木の形と `lerp` の文字列で、方言そのものは別）。
 * それでも**位置の決め方は1か所**になるので、`js` 側を評価して `cursorAt` と突き合わせられる。
 */
export function positionExpr(path, axis, dialect = "ffmpeg") {
  const lt = (a, b) => (dialect === "js" ? `(${a} < ${b})` : `lt(${a},${b})`);
  const iff = (c, t, f) => (dialect === "js" ? `(${c} ? ${t} : ${f})` : `if(${c},${t},${f})`);
  if (path.length === 0) return "0";
  let expr = `${path[path.length - 1][axis]}`;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const a = path[i - 1];
    const b = path[i];
    const span = Math.max(0.001, b.atSec - a.atSec);
    const lerp = `(${a[axis]}+(${b[axis]}-${a[axis]})*(t-${a.atSec})/${span})`;
    expr = iff(lt("t", `${b.atSec}`), iff(lt("t", `${a.atSec}`), `${a[axis]}`, lerp), expr);
  }
  return expr;
}

/**
 * **輪が出ていない**あいだで、**カーソルが止まっている**時刻（カーソル本体だけを見るため）。
 *
 * ⚠️ **「押した後」とは限らない**（PR #1237 再レビュー 🟡）＝実測すると、選ばれる時刻の多くは
 * **押す直前**（着いてから押すまでの溜め）。名前と説明を「輪が消えたあと」にすると読む人が誤解する。
 * ⚠️ **止まっている所を選ぶ**＝動いている最中は、コマの取り出しが 1/15 秒ずれるだけで
 * 30 画素ほど動く（実測で 22 画素ずれて落ちた）。そこを見ると**正しく焼けていても落ちる**。
 * ⚠️ **並びの形（3つ組）に頼らない**＝`cursorPath` の作り方が変わっても効くよう、
 * **同じ位置が続く区間**として拾う。
 * ⚠️ **終わりに安全代（`TAIL_GUARD_SEC`）を引く**（同レビュー 🟡）＝`totalSec` は **ffmpeg を起こしてからの秒**で、
 * **録画の実尺はそれより数百 ms 短い**（`timeBaseNote`）。引かないと、末尾の標本が
 * **録画の外**に出て「コマを取り出せません」で落ちる回がある。
 */
export function stillTimes(path, points, totalSec, { least = 0.15, after = 0.2, tailGuard = TAIL_GUARD_SEC } = {}) {
  const spans = [];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (a.x === b.x && a.y === b.y && b.atSec > a.atSec) spans.push([a.atSec, b.atSec]);
  }
  const last = path[path.length - 1];
  if (last) spans.push([last.atSec, totalSec]);

  const out = [];
  for (const [from, to] of spans) {
    let s0 = from;
    for (const p of points) {
      if (p.atSec <= s0 && s0 < p.atSec + RIPPLE_SEC) s0 = p.atSec + RIPPLE_SEC + after;
    }
    const s1 = Math.min(to, totalSec - tailGuard);
    if (!(s1 - s0 >= least)) continue;
    // 輪の出ている区間と重なる窓は捨てる（カーソルだけを見たいので）
    if (points.some((p) => s0 < p.atSec + RIPPLE_SEC && p.atSec < s1)) continue;
    out.push(Number(((s0 + s1) / 2).toFixed(3)));
  }
  return out;
}
