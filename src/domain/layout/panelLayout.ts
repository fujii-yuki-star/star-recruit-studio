// 編集画面の「欄の配置」（ADR-0033 段階1）。純粋関数（副作用なし・§7 テスト対象）。
//
// **画面の見た目の好みであって、動画の中身ではない**＝プロジェクトの schema には入れない（ADR-0033 決定5）。
// 保存はアプリの設定（`infrastructure/appSettings`）。ここが持つのは**形と整え方**だけで、
// ドラッグの操作感や見た目は UI 側にある（`§4`）。
//
// 形（決定11）＝**領域の中は入れ子で分割**する。縦にも横にも積めるので、**置ける欄の数に上限が要らない**
// （4つの領域に1つずつだと足りない、という利用者指摘への構造的な答え）。
//
//   配置 = { 左: ノード, 中央: ノード, 右: ノード, 下: ノード }
//   ノード = 分かれ目（向き＋割合＋子）| 葉（欄id）
//
// **大きさは割合**（合計 1）で持つ＝ウィンドウの幅が変わっても崩れない。

/** 欄を置ける領域（画面の外枠・決定1）。`as const` で値集合を1か所に持つ（§2-7）。 */
export const PANEL_REGION = {
  left: 'left',
  center: 'center',
  right: 'right',
  bottom: 'bottom',
} as const;
export type PanelRegion = (typeof PANEL_REGION)[keyof typeof PANEL_REGION];
export const PANEL_REGIONS: readonly PanelRegion[] = Object.values(PANEL_REGION);

/** 分かれ目の向き。`row`＝左右に並べる／`column`＝上下に並べる。 */
export const SPLIT_DIR = { row: 'row', column: 'column' } as const;
export type SplitDir = (typeof SPLIT_DIR)[keyof typeof SPLIT_DIR];

/**
 * 配置を覚える画面（決定4＝**画面ごとに1つ**）。綴り違いで別のキーへ黙って逃げないよう値集合にする（§2-7）。
 * 顔ぶれは ADR-0033 の段階（まずタイムライン編集・のちに場面編集と見た目パターン編集）に対応する。
 */
export const PANEL_SCREEN = { timeline: 'timeline', scene: 'scene', looks: 'looks' } as const;
export type PanelScreenId = (typeof PANEL_SCREEN)[keyof typeof PANEL_SCREEN];

/** 欄の識別子（画面が決める。ここでは中身を知らない）。 */
export type PanelId = string;

/** 葉＝欄そのもの。 */
export interface PanelLeaf {
  panelId: PanelId;
}

/** 分かれ目＝子を向きの順に並べ、`sizes`（割合・合計1）で分ける。 */
export interface PanelSplit {
  dir: SplitDir;
  sizes: number[];
  children: PanelNode[];
}

export type PanelNode = PanelLeaf | PanelSplit;

/** 画面ぜんぶの配置。欄が1つも無い領域は `null`（枠を描かない）。 */
export type PanelLayout = Record<PanelRegion, PanelNode | null>;

/**
 * 欄1つの最小の割合。0 にすると**掴めない欄**ができる（戻せない＝§2-5）。
 * **正典（`11.4`）の定数ではない**（動画のデータに出てこない画面だけの下限）ので `domain/constants.ts` へは
 * 置かず、使う側がここを参照する（単一の参照元・§2-7）。
 */
export const MIN_PANEL_RATIO = 0.1;

export function isSplit(node: PanelNode): node is PanelSplit {
  return typeof node === 'object' && node != null && 'children' in node;
}

/**
 * 分かれ目を作る**唯一の入口**（子と割合を**対で**受ける）。子が1つなら分かれ目にしない・0 なら無い。
 * 子と割合を別々に組み立てると、**子を落とした位置と割合を切る位置がずれる**（末尾から切ってしまう等）。
 */
function makeSplit(dir: SplitDir, pairs: readonly { node: PanelNode; size: number }[]): PanelNode | null {
  if (pairs.length === 0) return null;
  if (pairs.length === 1) return pairs[0].node;
  return { dir, sizes: normalizeSizes(pairs.map((p) => p.size)), children: pairs.map((p) => p.node) };
}

/** 空の配置（どの領域にも何も置いていない）。 */
export function emptyLayout(): PanelLayout {
  return { left: null, center: null, right: null, bottom: null };
}

/** その配置に**いま置かれている**欄の id（前から順）。閉じている欄＝ここに出てこないもの。 */
export function placedPanelIds(layout: PanelLayout): PanelId[] {
  const out: PanelId[] = [];
  const walk = (node: PanelNode | null): void => {
    if (!node) return;
    if (isSplit(node)) node.children.forEach(walk);
    else out.push(node.panelId);
  };
  PANEL_REGIONS.forEach((r) => walk(layout[r]));
  return out;
}

/**
 * **いま閉じている欄**（画面が持っている欄のうち、配置に出てこないもの）。
 * 「表示する欄」の一覧はここから作る＝**閉じたまま戻せない欄を作らない**（決定8）。
 */
export function closedPanelIds(layout: PanelLayout, knownPanelIds: readonly PanelId[]): PanelId[] {
  const placed = new Set(placedPanelIds(layout));
  return knownPanelIds.filter((id) => !placed.has(id));
}

/**
 * 配置を**読める形へ整える**（保存から読んだもの・操作の結果の両方が通る）。
 *
 * - **知らない欄は落とす**（画面から消えた欄が残っても描けない）。
 * - **同じ欄は1か所だけ**（2か所に出ると、片方を動かしたときに追えない）。
 * - **子が1つの分かれ目は畳む**・**子が0の枝は消す**（空の器を残さない）。
 * - **割合は数を合わせ、最小値で押し上げ、合計1へそろえる**（欄が潰れて掴めなくならない）。
 */
export function normalizeLayout(layout: PanelLayout, knownPanelIds: readonly PanelId[]): PanelLayout {
  const known = new Set(knownPanelIds);
  const seen = new Set<PanelId>();

  const walk = (node: PanelNode | null): PanelNode | null => {
    if (!node) return null;
    if (!isSplit(node)) {
      if (!known.has(node.panelId) || seen.has(node.panelId)) return null;
      seen.add(node.panelId);
      return { panelId: node.panelId };
    }
    // 残った子と**その割合を対で拾う**（落ちた子のぶんだけ割合もずらす＝幅の対応が崩れない）。
    const kept: PanelNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, i) => {
      const c = walk(child);
      if (c) {
        kept.push(c);
        sizes.push(node.sizes[i] ?? 1 / node.children.length);
      }
    });
    // 向きが壊れた値でも必ず有効な向きにする（読み込んだ設定で描けなくならない）。
    const dir = node.dir === SPLIT_DIR.row ? SPLIT_DIR.row : SPLIT_DIR.column;
    return makeSplit(dir, kept.map((n, i) => ({ node: n, size: sizes[i] })));
  };

  const next = emptyLayout();
  PANEL_REGIONS.forEach((r) => {
    next[r] = walk(layout[r] ?? null);
  });
  return next;
}

/**
 * 割合を**合計1**にそろえ、**最小値を下回らない**ようにする。
 * 壊れた値（負・NaN・全部0）でも必ず有効な割合を返す＝読み込んだ設定で画面が壊れない。
 */
export function normalizeSizes(sizes: readonly number[]): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const safe = sizes.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  const even = 1 / n;
  // 最小値 × 個数が 1 を超える（欄が多すぎる）ときは、等分にするしかない。
  if (MIN_PANEL_RATIO * n >= 1) return safe.map(() => even);
  const base = total > 0 ? safe.map((v) => v / total) : safe.map(() => even);
  // 最小値へ押し上げたぶんは、余裕のある欄から比例して差し引く。
  const lifted = base.map((v) => Math.max(MIN_PANEL_RATIO, v));
  const over = lifted.reduce((a, b) => a + b, 0) - 1;
  if (over <= 0) return spread(lifted);
  const slack = lifted.map((v) => v - MIN_PANEL_RATIO);
  const slackTotal = slack.reduce((a, b) => a + b, 0);
  return spread(lifted.map((v, i) => (slackTotal > 0 ? v - (over * slack[i]) / slackTotal : v)));
}

/** 端数を最後の1つへ寄せて、合計をきっちり1にする（描くときに1pxの隙間を作らない）。 */
function spread(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return sizes;
  const scaled = sizes.map((v) => v / total);
  const sum = scaled.slice(0, -1).reduce((a, b) => a + b, 0);
  return [...scaled.slice(0, -1), 1 - sum];
}

/** 欄を取り除いた配置（閉じる／移動の前半）。**空になった枝は畳む**。 */
export function removePanel(layout: PanelLayout, panelId: PanelId): PanelLayout {
  const next = emptyLayout();
  PANEL_REGIONS.forEach((r) => {
    next[r] = removeFrom(layout[r] ?? null, panelId);
  });
  return next;
}

function removeFrom(node: PanelNode | null, panelId: PanelId): PanelNode | null {
  if (!node) return null;
  if (!isSplit(node)) return node.panelId === panelId ? null : node;
  const kept: PanelNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const c = removeFrom(child, panelId);
    if (c) {
      kept.push(c);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  return makeSplit(node.dir, kept.map((n, i) => ({ node: n, size: sizes[i] })));
}

/**
 * 欄を**領域の末尾へ**入れる（「表示する欄」から戻すとき・既定の組み立て）。
 * すでにどこかにあれば**先に取り除く**＝同じ欄が2か所に出ない。
 */
export function addPanelToRegion(layout: PanelLayout, panelId: PanelId, region: PanelRegion): PanelLayout {
  const base = removePanel(layout, panelId);
  const current = base[region];
  const leaf: PanelLeaf = { panelId };
  if (!current) return { ...base, [region]: leaf };
  // 領域の直下が縦並びならその末尾へ。そうでなければ縦に分ける（上下に積むのが既定）。
  if (isSplit(current) && current.dir === SPLIT_DIR.column) {
    const pairs = current.children.map((n, i) => ({ node: n, size: current.sizes[i] ?? 1 / current.children.length }));
    return { ...base, [region]: makeSplit(SPLIT_DIR.column, [...pairs, { node: leaf, size: 1 / (pairs.length + 1) }]) };
  }
  // 直下が横並び（または葉）なら、それごと縦に分ける＝**中の並びは崩さない**。
  return { ...base, [region]: makeSplit(SPLIT_DIR.column, [{ node: current, size: 1 }, { node: leaf, size: 1 }]) };
}

/** 落とせる場所（欄のどの辺に差すか）＝ドラッグの受け口。 */
export const DROP_SIDE = { top: 'top', bottom: 'bottom', left: 'left', right: 'right' } as const;
export type DropSide = (typeof DROP_SIDE)[keyof typeof DROP_SIDE];

/**
 * 欄を**別の欄の辺へ**差す（ドラッグの本体・決定11＝縦にも横にも積める）。
 *
 * - `left`/`right` は横並び、`top`/`bottom` は縦並びの分かれ目を作る。
 * - **同じ向きの分かれ目の中なら、新しい分かれ目を作らずその並びへ挿す**（入れ子が無駄に深くならない）。
 * - 自分自身の辺へ落としたときは**何も変えない**（同じ参照を返す＝履歴・保存を汚さない）。
 */
export function dropPanelBeside(
  layout: PanelLayout,
  panelId: PanelId,
  targetPanelId: PanelId,
  side: DropSide,
): PanelLayout {
  if (panelId === targetPanelId) return layout;
  const base = removePanel(layout, panelId);
  const dir = side === DROP_SIDE.left || side === DROP_SIDE.right ? SPLIT_DIR.row : SPLIT_DIR.column;
  const before = side === DROP_SIDE.left || side === DROP_SIDE.top;
  let done = false;

  const walk = (node: PanelNode | null): PanelNode | null => {
    if (!node || done) return node;
    if (!isSplit(node)) {
      if (node.panelId !== targetPanelId) return node;
      done = true;
      const pair = { node: { panelId } as PanelNode, size: 1 };
      return makeSplit(dir, before ? [pair, { node, size: 1 }] : [{ node, size: 1 }, pair]);
    }
    // 同じ向きの並びの中に対象があるなら、その並びへ直接挿す（入れ子を増やさない）。
    const idx = node.children.findIndex((c) => !isSplit(c) && c.panelId === targetPanelId);
    if (idx >= 0 && node.dir === dir) {
      done = true;
      const at = before ? idx : idx + 1;
      const pairs = node.children.map((n, i) => ({ node: n, size: node.sizes[i] ?? 1 / node.children.length }));
      const inserted = [...pairs.slice(0, at), { node: { panelId } as PanelNode, size: 1 / (pairs.length + 1) }, ...pairs.slice(at)];
      return makeSplit(node.dir, inserted);
    }
    // 子と割合は**対で**持ち直す（`slice` で末尾から切ると、落ちた子の位置とずれる）。
    const pairs = node.children
      .map((child, i) => ({ node: walk(child), size: node.sizes[i] ?? 1 / node.children.length }))
      .filter((p): p is { node: PanelNode; size: number } => p.node != null);
    return makeSplit(node.dir, pairs);
  };

  const next = emptyLayout();
  PANEL_REGIONS.forEach((r) => {
    next[r] = walk(base[r] ?? null);
  });
  // 落とし先が見つからない（消された直後など）なら、何も変えない＝黙って別の場所へ置かない。
  return done ? next : layout;
}

/**
 * 欄を**隣と入れ替える**（メニューの「上へ／下へ／左へ／右へ」・決定12＝ドラッグが使えないときの逃げ道）。
 * その向きの並びに入っていない、または端にいるときは**何も変えない**（同じ参照）。
 */
export function movePanelStep(layout: PanelLayout, panelId: PanelId, side: DropSide): PanelLayout {
  const dir = side === DROP_SIDE.left || side === DROP_SIDE.right ? SPLIT_DIR.row : SPLIT_DIR.column;
  const back = side === DROP_SIDE.left || side === DROP_SIDE.top;
  let done = false;

  const walk = (node: PanelNode | null): PanelNode | null => {
    if (!node || done) return node;
    if (!isSplit(node)) return node;
    const idx = node.children.findIndex((c) => !isSplit(c) && c.panelId === panelId);
    if (idx >= 0 && node.dir === dir) {
      const to = back ? idx - 1 : idx + 1;
      if (to < 0 || to >= node.children.length) return node; // 端＝動かせない
      done = true;
      const children = [...node.children];
      [children[idx], children[to]] = [children[to], children[idx]];
      const sizes = children.map((_, i) => node.sizes[i] ?? 1 / children.length);
      [sizes[idx], sizes[to]] = [sizes[to], sizes[idx]];
      return makeSplit(node.dir, children.map((n, i) => ({ node: n, size: sizes[i] })));
    }
    const pairs = node.children
      .map((child, i) => ({ node: walk(child), size: node.sizes[i] ?? 1 / node.children.length }))
      .filter((p): p is { node: PanelNode; size: number } => p.node != null);
    return makeSplit(node.dir, pairs);
  };

  const next = emptyLayout();
  PANEL_REGIONS.forEach((r) => {
    next[r] = walk(layout[r] ?? null);
  });
  return done ? next : layout;
}

/**
 * 分かれ目の大きさを変える（境界のドラッグ）。`path`＝領域の根からの子の番号の並び。
 * 割合は必ず整えるので、**最小より小さくは絞れない**（掴めない欄を作らない）。
 * 見つからない・数が合わないときは**何も変えない**（同じ参照）。
 */
export function resizeSplit(
  layout: PanelLayout,
  region: PanelRegion,
  path: readonly number[],
  sizes: readonly number[],
): PanelLayout {
  let changed = false;
  const walk = (node: PanelNode | null, depth: number): PanelNode | null => {
    if (!node || !isSplit(node)) return node;
    if (depth === path.length) {
      if (sizes.length !== node.children.length) return node;
      changed = true;
      return makeSplit(node.dir, node.children.map((n, i) => ({ node: n, size: sizes[i] })));
    }
    const i = path[depth];
    if (i < 0 || i >= node.children.length) return node;
    const children = [...node.children];
    const replaced = walk(children[i], depth + 1);
    if (!replaced) return node;
    children[i] = replaced;
    // 差し替えでも `makeSplit` を通す＝分かれ目を作る道を1本に保つ（コメントの主張を実装で守る）。
    return makeSplit(node.dir, children.map((n, k) => ({ node: n, size: node.sizes[k] ?? 1 / children.length })));
  };
  const next: PanelLayout = { ...layout, [region]: walk(layout[region] ?? null, 0) };
  return changed ? next : layout;
}

/**
 * 保存から読んだ**素性の分からない値**を配置として受け取る。形が合わないところは**落とす**（例外にしない）。
 *
 * **これが無いと、壊れた設定で画面が開けなくなる**（`{"left":5}` や `sizes` の無い分かれ目で、
 * 描く前に落ちる）。落ちる先が初期描画なので「配置を既定に戻す」にも辿り着けない＝**設定のせいで
 * 二度と開けない**（§2-5・ADR-0033 判断軸3）。`normalizeLayout` は**形が整っている前提**の整え役なので、
 * 入口はここで守る。
 *
 * 何も残らなければ `null`＝呼び出し側が既定を使う。
 */
export function parsePanelLayout(raw: unknown): PanelLayout | null {
  if (!isRecord(raw)) return null;
  const next = emptyLayout();
  let parsedAny = false;
  let brokenAny = false;
  for (const region of PANEL_REGIONS) {
    const node = parseNode(raw[region]);
    if (node) {
      next[region] = node;
      parsedAny = true;
    } else if (raw[region] != null) {
      brokenAny = true; // 値はあるのに読めない＝壊れている（「閉じてある」ではない）
    }
  }
  // **欄をすべて閉じた配置**は「まだ保存していない」と区別する＝しないと、開き直すたびに閉じた欄が黙って戻る。
  // ただし**壊れた値が混ざっているとき**は「閉じてある」と読まない＝何も出ない画面にせず、既定へ落とす。
  const closedOnPurpose = !brokenAny && PANEL_REGIONS.some((r) => r in raw);
  return parsedAny || closedOnPurpose ? next : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v);
}

function parseNode(raw: unknown): PanelNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.panelId === 'string') return raw.panelId === '' ? null : { panelId: raw.panelId };
  if (!Array.isArray(raw.children)) return null;
  // 割合が欠けている・数が合わないのは**壊れた値ではなく足りない値**として扱う（等分へ倒す）。
  const sizes = Array.isArray(raw.sizes) ? raw.sizes : [];
  const pairs = raw.children
    .map((child, i) => ({ node: parseNode(child), size: typeof sizes[i] === 'number' ? (sizes[i] as number) : 0 }))
    .filter((p): p is { node: PanelNode; size: number } => p.node != null);
  const dir = raw.dir === SPLIT_DIR.row ? SPLIT_DIR.row : SPLIT_DIR.column;
  return makeSplit(dir, pairs.map((p) => ({ node: p.node, size: p.size > 0 ? p.size : 1 / Math.max(1, pairs.length) })));
}
