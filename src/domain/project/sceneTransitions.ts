// 場面間トランジション（ADR-0009）の解決と xfade タイムライン計算。純粋関数（§7 テスト対象）。
// 描画/書き出しの実適用は T2（renderer/export + Rust filtergraph）。本モジュールは型安全な値解決と
// offset/実効尺の算出だけを担い、副作用を持たない。
import { TRANSITION_DEFAULT_SEC, TRANSITION_MIN_TAIL_SEC } from '../constants';
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import type { TransitionDirection, TransitionType } from '../enums';
import type { Scene, Transition } from './types';

// MVP で実際に描画する種別。これ以外（wipe/zoom）は fade にフォールバックする。
// **`as const` なのは意図的**（`readonly TransitionType[]` に広げない）＝この配列が
// `DrawnTransitionType` の単一の参照元で、種別を1つ足した瞬間に下流の網羅 switch が落ちる。
const DRAWN_TYPES = [TRANSITION_TYPE.none, TRANSITION_TYPE.fade, TRANSITION_TYPE.slide] as const;

/**
 * **実際に描画される**切り替えの種別（`resolveTransition` の結果の型）。`TransitionType` より狭い。
 *
 * これを分けているのは、設定できる種別（`TransitionType`＝wipe/zoom を含む）と、現に画面へ出る種別が
 * 食い違っているため（wipe/zoom は fade に丸めている＝ADR-0032 決定19）。この型を消費する側を
 * **網羅 switch（`never` チェック）**で書いておくと、`DRAWN_TYPES` に wipe が入った瞬間に union が
 * 広がってビルドが落ちる＝黙って fade へ落とし続ける事故を人の注意ではなく型で防ぐ。
 */
export type DrawnTransitionType = (typeof DRAWN_TYPES)[number];

function isDrawnType(type: TransitionType): type is DrawnTransitionType {
  return (DRAWN_TYPES as readonly TransitionType[]).includes(type);
}

export interface ResolvedTransition {
  /** none/fade/slide（MVP）。wipe/zoom は fade に丸める。 */
  type: DrawnTransitionType;
  /** slide のときのみ意味を持つ（ADR-0009：MVP は in に適用）。 */
  direction: TransitionDirection;
  /** 希望の遷移時間（秒・0 以上）。境界での上限 clamp は transitionTimeline が場面尺を見て行う。 */
  durationSec: number;
}

/**
 * 場面の「入り」トランジション（transition.in）を MVP の実効値へ解決する。
 * wipe/zoom は未対応のため fade に、direction 未指定は left に、durationSec は 0 以上に丸める。
 */
export function resolveTransition(transition: Transition | undefined): ResolvedTransition {
  const raw = transition?.in ?? TRANSITION_TYPE.none;
  const type = isDrawnType(raw) ? raw : TRANSITION_TYPE.fade;
  return {
    type,
    direction: transition?.direction ?? TRANSITION_DIRECTION.left,
    durationSec: Math.max(0, transition?.durationSec ?? TRANSITION_DEFAULT_SEC),
  };
}

/**
 * SceneEdit の「画面の切り替え」select 値（`none`/`fade`/`slide:<direction>`）を transition から導く。
 * resolveTransition と同じ実効値に寄せる＝wipe/zoom は fade として表示し、書き出しの実効値と UI を一致させる。
 */
export function deriveTransitionSelectValue(transition: Transition | undefined): string {
  const r = resolveTransition(transition);
  return r.type === TRANSITION_TYPE.slide ? `slide:${r.direction}` : r.type;
}

export interface BoundaryTransition {
  type: DrawnTransitionType;
  direction: TransitionDirection;
  /** clamp 済みの実効 D（秒）。書き出しと同じく両隣の場面尺で clamp する。0＝遷移なし（プレビュー不要）。 */
  durationSec: number;
}

/**
 * A→B 境界（scenes[targetIndex] に入る遷移＝transition.in）の実効値を、**書き出しと同じ全場面 transitionTimeline**で
 * 解決する（#408 Part 2 のプレビュー用）。scenes は project.scenes と同じ再生順、targetIndex は当該場面の添字。
 * targetIndex<=0（先頭＝切り替え元なし）／type=none／希望 D<=0 は durationSec=0（プレビューしない）を返す。
 * clamp は書き出し（buildExportScenes）と同一：対象境界までの全場面尺 sceneDurations と境界希望 boundaryDs
 * （none/先頭=0）から transitionTimeline を回し steps[targetIndex-1] を採る。左 clamp を累積結合尺 acc で行うため、
 * **直前場面が実効 D より短い（prev<D）場面でもプレビュー=書き出しが一致**する（2場面近似 min(D,prev,cur) だと
 * prev で過小になっていた＝#408 レビュー P1）。type/direction は resolveTransition と同一（wipe/zoom→fade）
 * ＝プレビュー=書き出し（ADR-0001/0026）。
 */
/**
 * 場面の並びから「場面 i への入場の希望 D」を組む（#727）。**全経路がこれを通す**。
 *
 * ⚠️ 以前は同じ式が6か所に手書きされていた。`transitionTimeline` は「各段が前より前だけで決まる」関数
 * だったので写しても割れなかったが、**#727 で後ろの場面にも依存する**ようになったため、
 * **入力を1つでも欠けた形で渡すと値が割れる**（実際にプレビューが割れた＝下の ⚠️）。
 */
export function transitionBoundaryDs(scenes: readonly { transition?: Transition }[]): number[] {
  return scenes.map((s, i) => {
    if (i === 0) return 0; // 先頭に入場の切り替えは無い
    const r = resolveTransition(s.transition);
    return r.type === TRANSITION_TYPE.none ? 0 : r.durationSec;
  });
}

export function resolveBoundaryTransition(scenes: Scene[], targetIndex: number): BoundaryTransition {
  const scene = targetIndex >= 0 ? scenes[targetIndex] : undefined;
  const r = resolveTransition(scene?.transition);
  if (targetIndex <= 0 || !scene || r.type === TRANSITION_TYPE.none || r.durationSec <= 0) {
    return { type: r.type, direction: r.direction, durationSec: 0 };
  }
  // 書き出し（buildExportScenes）と**同じ入力**で回す。
  // ⚠️ **後ろを切り落としてはいけない**（#727）＝以前は対象境界までで回していたが、
  // 切り替えの上限が「その場面に退場があるか」にも依るようになったので、切り落とすと
  // **対象場面が必ず末尾になり退場が見えず、プレビューだけ上限が効かない**
  // （`[5, 0.8(0.5), 5(0.5)]` で書き出し 0.383 秒・プレビュー 0.5 秒＝ADR-0001 が破れる）。
  // `acc` は前より前だけで決まるので、全場面で回しても**対象より前の値は変わらない**。
  const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), transitionBoundaryDs(scenes));
  return { type: r.type, direction: r.direction, durationSec: steps[targetIndex - 1]?.durationSec ?? 0 };
}

/**
 * 「切り替えに飲み込まれて総尺に寄与しない場面」の番号（1始まり・公開前チェック用・#553/#554）。
 *
 * `transitionTimeline` は strict `<`（`d = min(want, acc−ε, 尺−ε)`＝#547 P3-4）で clamp するので、切り替えが尺以上でも
 * その場面は**最低1フレーム（ε）だけ残る**＝FFmpeg xfade は壊れない。ただし残りが1フレームでは**実質的に飲み込まれて見えない**
 * ので、利用者には引き続き警告する（ADR-0026④・§2-5「次の行動」）。判定の閾値は「切り替え尺 ≥ 場面尺」で据え置き
 * ＝設定した切り替えが場面を覆い尽くす意図のときに知らせる（strict clamp は"壊さない"、この警告は"直させる"の別レイヤー）。
 *
 * **#553 で場面ごとの尺の下限（3秒）を撤廃するまでは構造的に到達不能**だった（最短3秒 > 切り替え既定0.5秒）。
 * 下限撤廃で「0.3秒の場面＋フェード」が普通に作れるようになったため到達性が上がった。
 *
 * 判定は書き出し（buildExportScenes）と同じ `resolveTransition` 由来の want と場面尺の比較＝経路を共有する。
 */
export function swallowedByTransitionSceneNumbers(scenes: Scene[]): number[] {
  const nums: number[] = [];
  scenes.forEach((s, i) => {
    if (i === 0) return; // 先頭に入場の切り替えは無い（boundaryDs[0]=0）
    const r = resolveTransition(s.transition);
    if (r.type === TRANSITION_TYPE.none || r.durationSec <= 0) return;
    if (r.durationSec >= s.durationSec) nums.push(i + 1); // 切り替えが場面尺以上＝丸ごと飲まれる
  });
  return nums;
}

export interface TransitionStep {
  /** それまでの結合結果に対する xfade 開始位置（秒）。 */
  offsetSec: number;
  /** xfade の長さ（秒・clamp 済み）。0 は遷移なし（単純連結）。 */
  durationSec: number;
}

/**
 * 各場面の尺と「場面 i に入る遷移の希望 D」から、xfade の offset と実効総尺を求める。
 * - boundaryDs[i]（i≥1）＝場面 i が直前の結合結果へ重なる希望 D。boundaryDs[0] は無視（先頭は遷移なし）。
 * - D は左（それまでの結合結果）と右（場面 i）のどちらの尺も超えないよう clamp（極短場面対策）。
 * - 総尺 = Σ(durationSec) − Σ(適用 D)。
 */
export function transitionTimeline(
  sceneDurations: number[],
  boundaryDs: number[],
): { effectiveTotalSec: number; steps: TransitionStep[] } {
  const steps: TransitionStep[] = [];
  if (sceneDurations.length === 0) return { effectiveTotalSec: 0, steps };
  const budget = sceneTransitionBudgets(sceneDurations, boundaryDs);
  let acc = sceneDurations[0];
  for (let i = 1; i < sceneDurations.length; i += 1) {
    const want = Math.max(0, boundaryDs[i] ?? 0);
    // 左（それまでの結合結果 acc）と右（場面 i）のどちらの尺も **strict `<`** で超えない（ADR-0009：`0 ≤ D < 隣接場面尺`）。
    // ε＝1フレーム（TRANSITION_MIN_TAIL_SEC）を引くことで、切り替えが場面を丸ごと飲み込まず（各場面が最低1フレーム残る）、
    // FFmpeg xfade へ `duration ≥ 入力尺`（未定義動作）を渡さない（#547 P3-4／ADR-0009 未解決#4）。
    // 通常の切り替え（want が場面尺より十分小さい）は want がそのまま採られ、影響を受けるのは退化ケースだけ。
    // 場面尺 ≤ ε（1フレーム以下の極短場面）は max(0,…) で d→0＝ハードカット（重ねようがない）。
    const d = Math.max(0, Math.min(
      want,
      acc - TRANSITION_MIN_TAIL_SEC,
      sceneDurations[i] - TRANSITION_MIN_TAIL_SEC,
      budget[i - 1],
      budget[i],
    ));
    steps.push({ offsetSec: acc - d, durationSec: d });
    acc = acc + sceneDurations[i] - d;
  }
  return { effectiveTotalSec: acc, steps };
}

/**
 * 場面ごとに「**1つの切り替えが取ってよい上限**」（#727）。
 *
 * 両側に切り替えがある場面は、使える尺（`尺 − ε`）を**2つで分け合う**＝`(尺 − ε) / 2`。
 * 片側だけ（先頭・末尾・相手が切り替え無し）なら丸ごと使える。
 *
 * ⚠️ **これが無いと入場と退場が時間で重なる**。片方ずつの上限しか見ていなかったので
 * `d_in + d_out ≤ 尺` が保証されず、既定の 0.5 秒のままでも**尺 1.0 秒未満の場面すべて**で重なっていた
 * （その場面は一度も完全には表示されない）。さらに焼き出しでは、重なったぶんを**その場面のクリップだけ**
 * 切り詰めるので、**相手側の場面は元の長さのまま＝動きが左右でずれる**（#717 レビューの実測）。
 * 切り替えは1つの窓を両隣で共有しているので、ここで縮めれば**相手側も同じ長さになり、ずれが根から消える**。
 */
function sceneTransitionBudgets(sceneDurations: number[], boundaryDs: number[]): number[] {
  return sceneDurations.map((dur, i) => {
    const hasIn = i > 0 && (boundaryDs[i] ?? 0) > 0;
    const hasOut = i + 1 < sceneDurations.length && (boundaryDs[i + 1] ?? 0) > 0;
    // ⚠️ **両側にあるときだけ**縛る。片側だけの場面に上限を足すと、既存の意図
    //（左は「それまでの結合結果」なので、合成が長ければ1場面より長い切り替えも許す＝`[5,4,6]` の
    // 3境界目に 5 秒。飲み込まれる場面は `swallowedByTransitionSceneNumbers` が知らせる）を壊す。
    return hasIn && hasOut ? (dur - TRANSITION_MIN_TAIL_SEC) / 2 : Number.POSITIVE_INFINITY;
  });
}

/**
 * **希望した切り替えが場面の長さに入らず短くなった場面**の番号（1始まり・#727）。
 *
 * 黙って短くしない（§2-5・ADR-0026④）＝事前確認で知らせる。既存の `swallowedByTransitionSceneNumbers`
 * は「切り替え ≥ 場面尺」しか見ないので、**両側の合計だけが尺を超える帯**（既定なら 0.5〜1.0 秒の場面）は
 * そちらでは拾えない。
 */
export function shortenedTransitionSceneNumbers(scenes: Scene[]): number[] {
  const durations = scenes.map((s) => s.durationSec);
  // ⚠️ **希望の値**を採る（`resolveBoundaryTransition` は**クランプ後**を返すので、それと比べると
  // 何と比べても一致してしまい、この関数は常に空を返す）。
  const boundaryDs = transitionBoundaryDs(scenes);
  const budget = sceneTransitionBudgets(durations, boundaryDs);
  const { steps } = transitionTimeline(durations, boundaryDs);
  const out = new Set<number>();
  // それまでの結合結果（`acc`）＝`transitionTimeline` と同じ進み方で数える（式を2通り持たない）。
  let acc = durations[0] ?? 0;
  steps.forEach((step, k) => {
    const i = k + 1; // steps[k] は場面 i（0始まり）への入場
    const accBefore = acc;
    acc = acc + durations[i] - step.durationSec;
    if (step.durationSec >= (boundaryDs[i] ?? 0) - 1e-9) return; // 希望どおり取れている
    // ⚠️ **実際に上限を握った場面だけ**を挙げる（#727 レビュー）。両隣を機械的に出すと、
    // **伸ばしても効かない場面**（先頭場面＝切り替えの欄すら無い／上限を握っていない側）を
    // 「表示時間を長くしてください」の対象にしてしまい、言われたとおりにしても直らない（§2-5）。
    if (budget[i - 1] <= step.durationSec + 1e-9) out.add(i); // 場面 i-1 の1始まり番号
    if (budget[i] <= step.durationSec + 1e-9) out.add(i + 1); // 場面 i の1始まり番号
    // ⚠️ **それまでの結合結果で頭打ちになった場合も挙げる**（#727 レビュー）＝上限は予算だけではない。
    // 動画の頭が短いと入場がそこで切られる（`[0.4, 0.8, 5]` の1つ目の境界）。伸ばす先は
    // **それまでの場面**なので、直前の場面を挙げる（そこを長くすれば結合結果も伸びる）。
    if (accBefore - TRANSITION_MIN_TAIL_SEC <= step.durationSec + 1e-9) out.add(i);
  });
  return [...out].sort((a, b) => a - b);
}
