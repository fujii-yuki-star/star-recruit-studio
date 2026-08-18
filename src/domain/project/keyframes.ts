// キーフレーム補間（④・ADR-0019）。純粋・決定論（§7 テスト対象）。preview/export が同一関数を共有＝フレーム単位パリティ。
// 各プロパティは独立に補間する（キーフレームは変えたいプロパティだけ持てる）。区間 [前KF, 当KF] のイージングは「当KF.easing」。
// 区間外は端でクランプ（最初のKF前＝最初の値／最後のKF後＝最後の値）。
// 補間するのは値そのもの。x/y/scale/rotation を「本来値からの相対」として要素に重ねるか（既定）、絶対で使うかは
// 適用側（layoutScene）が決める（④ の適用は相対＝CSS transform 相当・opacity のみ絶対）。
import { EASING } from '../enums';
import type { BezierEasing, EasingSpec } from '../enums';
import type { Keyframe } from './types';

/** timeSec の補間結果（設定されたプロパティのみ）。 */
export interface InterpolatedTransform {
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  rotation?: number;
}

/**
 * 補間するプロパティ＝**単一の参照元**（§2-7）。補間する側と、分割（`domain/timeline/split`）で
 * 「どのプロパティが区間をまたぐか」を数える側、置く側（`domain/timeline/keyframeEdit` が再エクスポート）が
 * 同じ並びを見る＝`$defs/Keyframe` に項目が増えたとき片方だけ直って**数え落とす**、を作らない。
 */
export const KEYFRAME_PROPS = ['x', 'y', 'scale', 'opacity', 'rotation'] as const;
const PROPS = KEYFRAME_PROPS;
type AnimProp = (typeof PROPS)[number];

/**
 * イージング（進捗 0..1 → 0..1）。名前つき（`EASINGS`）と**自由なカーブ**（#262・制御点4つ）の両方を受ける。
 * `ease-in-out` は既存の式のまま＝**既に作った動画の動きを変えない**（自由なカーブでは表せない形なので、
 * カーブへ移すときは画面が「動きが少し変わる」と断る＝ADR-0026④）。
 */
export function applyEasing(t: number, easing: EasingSpec | undefined): number {
  if (easing == null) return t; // linear
  if (typeof easing !== 'string') return bezierEasing(easing.bezier, t);
  switch (easing) {
    case EASING.easeInOut:
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case EASING.easeIn:
    case EASING.easeOut:
      // 名前つきのうち、CSS と同じ定義で**制御点にそのまま置き換えられる**もの（`easingCurveOf`）。
      return bezierEasing(easingCurveOf(easing) as BezierEasing['bezier'], t);
    case EASING.linear:
      return t;
    default: {
      // 値が増えたらここがコンパイルエラーになる＝黙って linear に落とさない（§2-7）。
      const exhaustive: never = easing;
      return exhaustive;
    }
  }
}

/**
 * 「両端ゆっくり」を**カーブで置き換えるときの初期値**（#262）。等価ではない（`easingCurveOf` が `null` を
 * 返すとおり正確には表せない）ので、**画面は動きが変わることを断ってから**この値を置く（ADR-0026④）。
 * CSS の `ease-in-out` と同じ制御点。
 */
export const EASE_IN_OUT_APPROX_CURVE: BezierEasing['bezier'] = [0.42, 0, 0.58, 1];

/**
 * 名前つきイージングの**制御点による等価な表し方**（#262）。「自由なカーブにする」で使う。
 * `ease-in-out` は3次ベジェでは**正確に表せない**ので `null`＝**近い値で黙って置き換えない**（ADR-0026④）。
 */
export function easingCurveOf(easing: EasingSpec | undefined): BezierEasing['bezier'] | null {
  if (easing == null || easing === EASING.linear) return [0, 0, 1, 1];
  if (typeof easing !== 'string') return easing.bezier;
  if (easing === EASING.easeIn) return [0.42, 0, 1, 1];
  if (easing === EASING.easeOut) return [0, 0, 0.58, 1];
  return null;
}

/**
 * 3次ベジェのイージング（CSS の `cubic-bezier` と同じ）。進捗 `x` に対する `y` を返す。
 * `x` から媒介変数 `t` をニュートン法で求め、収束しなければ二分法へ落とす＝**同じ入力なら必ず同じ値**
 * （プレビューと書き出しが同じ関数を通る＝フレーム単位のパリティ・ADR-0019）。
 */
function bezierEasing(p: BezierEasing['bezier'], x: number): number {
  const [x1, y1, x2, y2] = p;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // 制御点が対角線上（＝linear）なら計算するまでもない。
  if (x1 === y1 && x2 === y2) return x;
  return bezierAxis(y1, y2, bezierParamAt(p, x));
}

/** 3次ベジェの1軸ぶん（P0=0・P3=1・制御点 a,b）。 */
function bezierAxis(a: number, b: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

/**
 * `x(t) = x` を満たす**媒介変数 `t`**（ニュートン法＋収束しなければ二分法）。
 *
 * ⚠️ **値を解く側（`bezierEasing`）と形を切る側（`splitEasingCurve`・#753）が同じ解き方を通る**＝
 * 分けた前後で同じ時刻の値が食い違わない（解き方が2つあると、境界の値だけが微妙にずれる）。
 */
function bezierParamAt(p: BezierEasing['bezier'], x: number): number {
  const [x1, , x2] = p;
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const dx = bezierAxis(x1, x2, t) - x;
    if (Math.abs(dx) < 1e-7) return t;
    const u = 1 - t;
    const d = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(d) < 1e-7) break;
    t -= dx / d;
  }
  // ニュートン法が効かない形（制御点が端に寄っている等）でも必ず答えを返す。
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 30; i += 1) {
    const cx = bezierAxis(x1, x2, t);
    if (Math.abs(cx - x) < 1e-7) break;
    if (cx > x) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return t;
}

/** 丸めの誤差として飲み込む幅（これより外れたら書かずに断る）。 */
const CURVE_EPS = 1e-9;

/**
 * 動き方（イージング）を進捗 `atX` で**2つに切る**（#753・de Casteljau）。
 * 返すのは前半・後半それぞれを **[0,1]×[0,1] へ正規化した制御点**＝そのまま `Keyframe.easing` に書ける。
 *
 * ⚠️ **切った前後で軌跡が変わらない**のが唯一の要件（値だけ合わせて速さの変わり方を黙って変えない）。
 * そのため**表せないときは `null` を返して呼び出し側に断らせる**（近い形で置き換えない＝ADR-0026④・#262 と同じ流儀）：
 * - `ease-in-out`＝3次ベジェで表せない（`easingCurveOf` が `null`）
 * - 切れ目で**進み具合が端に着いている**（`y` が 0 か 1）＝残り半分の値幅が 0 になり、正規化できない
 *   （行き過ぎて戻るカーブがちょうど端を通る場合。値が同じでも**途中の膨らみ**は表せない）
 * - 正規化した `x` が 0〜1 に収まらない（schema が拒む値を作らない＝防御）
 */
export function splitEasingCurve(
  easing: EasingSpec | undefined,
  atX: number,
): { head: BezierEasing['bezier']; tail: BezierEasing['bezier'] } | null {
  if (!(atX > 0 && atX < 1)) return null;
  const curve = easingCurveOf(easing);
  if (curve == null) return null;
  const [x1, y1, x2, y2] = curve;
  const t = bezierParamAt(curve, atX);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  // de Casteljau（P0=(0,0) / P1=(x1,y1) / P2=(x2,y2) / P3=(1,1)）。
  const ax = mix(0, x1);
  const ay = mix(0, y1);
  const bx = mix(x1, x2);
  const by = mix(y1, y2);
  const cx = mix(x2, 1);
  const cy = mix(y2, 1);
  const dx = mix(ax, bx);
  const dy = mix(ay, by);
  const ex = mix(bx, cx);
  const ey = mix(by, cy);
  const sx = mix(dx, ex); // 切れ目（前半の終わり＝後半の始まり）
  const sy = mix(dy, ey);
  const headSpan = sx;
  const tailSpan = 1 - sx;
  if (!(headSpan > CURVE_EPS) || !(tailSpan > CURVE_EPS)) return null;
  // ⚠️ **`y` は行き過ぎて戻ることがある**ので幅は負にもなる（`sy > 1`）＝符号ごと割る。
  // 0 のときだけ表せない（値幅が無い＝正規化できない）。
  if (!(Math.abs(sy) > CURVE_EPS) || !(Math.abs(1 - sy) > CURVE_EPS)) return null;
  const head = fitX([ax / headSpan, ay / sy, dx / headSpan, dy / sy]);
  const tail = fitX([(ex - sx) / tailSpan, (ey - sy) / (1 - sy), (cx - sx) / tailSpan, (cy - sy) / (1 - sy)]);
  if (head == null || tail == null) return null;
  return { head, tail };
}

/**
 * `x` を 0〜1 に収める（正典 `11 §7.6`＝時間は戻らない）。**丸めの誤差ぶんだけ**戻し、
 * それより外れていれば `null`＝**書かずに断る**（schema を通らない値を保存しない）。
 * `y` は丸めない（行き過ぎて戻る動きを潰さない）。
 */
function fitX(c: BezierEasing['bezier']): BezierEasing['bezier'] | null {
  const fix = (v: number): number | null =>
    v >= -CURVE_EPS && v <= 1 + CURVE_EPS ? Math.min(1, Math.max(0, v)) : null;
  const x1 = fix(c[0]);
  const x2 = fix(c[2]);
  if (x1 == null || x2 == null) return null;
  return [x1, c[1], x2, c[3]];
}

/**
 * 2つのカーブが**同じ進み具合**か（分けたときに1つの `easing` へまとめられるか＝#753）。
 *
 * ⚠️ **数値だけで比べない**＝制御点が**対角線上どうし**なら、数値が違っても `y(x)=x` で同じ
 * （媒介変数が付け替わるだけ）。直線の区間を切った部分曲線がこれに当たるので、数値で比べると
 * **同じ直線どうしを「別のカーブが要る」と誤って断る**。
 */
export function sameEasingCurve(
  a: BezierEasing['bezier'] | null,
  b: BezierEasing['bezier'] | null,
): boolean {
  if (a == null || b == null) return false;
  if (isLinearCurve(a) && isLinearCurve(b)) return true;
  return a.every((v, i) => Math.abs(v - b[i]) <= CURVE_EPS);
}

/**
 * そのカーブが**進み具合を変えない**か（＝`easing` を書かないで済む＝未指定と同じ意味）。
 *
 * ⚠️ **`[0,0,1,1]` と比べてはいけない**（#753）＝直線を切った部分曲線は制御点が `[0,0,1,1]` へは戻らず、
 * **対角線上の別の点**になる（媒介変数が付け替わるだけで `y(x)=x` は保たれる）。判定は
 * `bezierEasing` が直線の近道に使っているのと同じ条件＝**制御点が対角線上にあるか**で見る。
 */
export function isLinearCurve(c: BezierEasing['bezier']): boolean {
  return Math.abs(c[0] - c[1]) <= CURVE_EPS && Math.abs(c[2] - c[3]) <= CURVE_EPS;
}

/**
 * キーフレーム列（timeSec 昇順想定）を timeSec で補間する。プロパティごとに、そのプロパティを持つKFだけで補間する。
 * 空／該当プロパティ無しは undefined（＝アニメ対象外＝基準値のまま）。
 */
export function interpolateKeyframes(keyframes: readonly Keyframe[], timeSec: number): InterpolatedTransform {
  const out: InterpolatedTransform = {};
  if (keyframes.length === 0) return out;
  for (const prop of PROPS) {
    // 該当プロパティを持つKFを timeSec 昇順に（手編集/将来オーサリングで順序が崩れても補間が狂わないよう防御的にソート）。
    const kfs = keyframes.filter((k) => k[prop] != null).sort((a, b) => a.timeSec - b.timeSec);
    if (kfs.length === 0) continue;
    if (timeSec <= kfs[0].timeSec) {
      out[prop] = kfs[0][prop];
      continue;
    }
    if (timeSec >= kfs[kfs.length - 1].timeSec) {
      out[prop] = kfs[kfs.length - 1][prop];
      continue;
    }
    for (let i = 1; i < kfs.length; i += 1) {
      if (timeSec < kfs[i].timeSec) {
        const a = kfs[i - 1];
        const b = kfs[i];
        const span = b.timeSec - a.timeSec;
        const raw = span > 0 ? (timeSec - a.timeSec) / span : 0;
        const e = applyEasing(raw, b.easing); // b へ入るイージング
        const av = a[prop] as number;
        const bv = b[prop] as number;
        out[prop] = av + (bv - av) * e;
        break;
      }
    }
  }
  return out;
}

/** 型補助：AnimProp を明示（PROPS の要素）。 */
export type { AnimProp };
