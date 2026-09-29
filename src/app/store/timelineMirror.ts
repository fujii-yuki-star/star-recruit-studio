// 仕上がり確認の別窓（ADR-0050）の**写しと命令**。本体の store を1つの持ち主のまま、別窓で同じ画面を動かす。
//
// - 本体→別窓：store が変わったら**変わった項目だけ**を写しとして送る（`mirrorPatch`）。
// - 別窓→本体：別窓の store の操作を**名前と引数を送るだけの物**に差し替え（`installPreviewProxies`）、
//   本体がそれを自分の store で実行する（`runPreviewCall`）＝取り消し・自動保存・書き出しは本体の1本の道を通る。
// ⚠️ **窓の間の運び方は持たない**（`infrastructure/previewWindow`）＝ここは純粋な組み立てと判定だけ。

/** store の中身（操作と値）。型は store ごとに違うので、ここでは名前で扱う。 */
type StoreState = Record<string, unknown>;

/**
 * 別窓から来ても**本体が実行しない**操作（ADR-0050 決定5）＝動画の寿命と、外への出口と、本体の時計。
 * ⚠️ 別窓には書き出しも保存も要らない（本体が持つ）。来たら黙って捨てる（別窓の画面にはそもそも出ていない）。
 */
export const PREVIEW_DENIED_ACTIONS: ReadonlySet<string> = new Set([
  // 動画を開く・閉じる・作る・手放す
  "openTimelineProject",
  "closeTimelineProject",
  "createTimelineProject",
  "discardDeletedProject",
  // 外への出口（保存・書き出し）
  "saveTimelineProject",
  "exportTimelineVideo",
  "cancelTimelineExport",
  "dismissTimelineExport",
  "setExportHd",
  // 本体の時計と内部の段取り（別窓は時計を回さない＝ADR-0050 決定2）
  "_advancePlayhead",
  "_loopTo",
  "_generateVoiceFor",
  "resetHistoryGroup",
  // 引数が窓をまたげない（`File` は写せない）。窓の外からの落とし込みはパスで来る `placeDroppedFiles` を通る。
  "addAsset",
]);

/**
 * 別窓の**手元でも先に当てる**操作（ADR-0050 決定4）＝選ぶ操作だけ。
 * 画面には「選んだ直後に選択を読み直す」箇所があり（中へ入った印など）、本体の写しを待つと古い選択を読む。
 * 選ぶ操作は保存も時計も持たないので、手元で当てても持ち主は割れない。
 */
export const PREVIEW_LOCAL_ACTIONS: ReadonlySet<string> = new Set(["selectClip", "selectClips", "clearSelection"]);

/**
 * 写さない項目＝取り消しの履歴（重い・別窓は取り消しを持たない）と、`_` で始まる内部の段取り
 * （本体の中でだけ意味がある。`Set` など窓をまたげない物も含む）。
 */
export function isMirroredKey(key: string, value: unknown): boolean {
  if (typeof value === "function") return false;
  if (key === "history") return false;
  return !key.startsWith("_");
}

export interface MirrorPatch {
  values: Record<string, unknown>;
  /** 値が `undefined` になった項目（JSON で運ぶと落ちるので別に持つ）。 */
  cleared: string[];
}

/**
 * `prev`→`next` で**変わった項目だけ**の写し（`prev` が `null`＝全部）。変わっていなければ `null`。
 * 比べるのは**同じ物かどうか**だけ＝store は変えるたびに新しい物を作るので、それで足りる（中身まで比べない＝軽い）。
 */
export function mirrorPatch(prev: StoreState | null, next: StoreState): MirrorPatch | null {
  const values: Record<string, unknown> = {};
  const cleared: string[] = [];
  let any = false;
  for (const key of Object.keys(next)) {
    const v = next[key];
    if (!isMirroredKey(key, v)) continue;
    if (prev && prev[key] === v) continue;
    any = true;
    if (v === undefined) cleared.push(key);
    else values[key] = v;
  }
  return any ? { values, cleared } : null;
}

/**
 * 写しを**窓をまたいで運べる物だけ**にする（運べない項目は落とす）。
 * ⚠️ 1つでも運べない値が混ざると、運ぶ時点で投げて**写し全体が届かない**（黙って止まる）＝項目ごとに確かめる。
 */
export function transferablePatch(patch: MirrorPatch): MirrorPatch {
  const values: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(patch.values)) {
    try {
      JSON.stringify(v);
      values[key] = v;
    } catch {
      // 運べない（循環など）＝この項目だけ送らない。
    }
  }
  return { values, cleared: patch.cleared };
}

/**
 * 写しを手元の中身へ当てたときの**差分**（当てる物だけ）。
 * ⚠️ **中身が同じなら手元の物をそのまま使う**（ADR-0050 決定3）＝画面には「同じ物か」で比べている箇所がある
 * （中へ入った印は、入った時点の選択と**同じ物**の間だけ出る）。写しが届くたびに新しい物へ差し替えると、
 * 中身は同じなのに印が消える。
 */
export function mirrorUpdate(current: StoreState, patch: MirrorPatch): StoreState {
  const out: StoreState = {};
  for (const [key, v] of Object.entries(patch.values)) {
    const cur = current[key];
    // ⚠️ **手元の操作は上書きしない**＝写しの側の値が関数でなくても、手元で操作の名前なら当てない
    //   （当てると、別窓の「送る物」が値に化けて押しても何も起きなくなる）。
    if (!isMirroredKey(key, v) || typeof cur === "function") continue;
    if (cur === v) continue;
    if (cur !== undefined && JSON.stringify(cur) === JSON.stringify(v)) continue;
    out[key] = v;
  }
  for (const key of patch.cleared) {
    const cur = current[key];
    if (isMirroredKey(key, undefined) && cur !== undefined && typeof cur !== "function") out[key] = undefined;
  }
  return out;
}

/** 別窓から来た命令の形。 */
export interface PreviewCall {
  name: string;
  args: unknown[];
}

/**
 * 引数を**窓をまたいで運べる形**にする。運べない物（押した出来事・関数・循環する物）は `undefined` にする。
 * ⚠️ 画面は `onClick={play}` のように**押した出来事をそのまま操作へ渡す**箇所がある＝そのまま送ると、
 *   運ぶ時点で投げて**黙って何も起きない**（実際に踏んだ：別窓の「再生」が効かなかった）。操作の側は
 *   その引数を使っていない（使うなら中身の値を渡している）ので、落としても意味は変わらない。
 * 末尾の `undefined` は削る（省略したのと同じ＝既定の引数が効く）。
 */
export function transferableArgs(args: readonly unknown[]): unknown[] {
  const out = args.map((a) => {
    if (a === undefined || a === null || typeof a !== "object") return typeof a === "function" ? undefined : a;
    if (typeof Event !== "undefined" && a instanceof Event) return undefined;
    if ("nativeEvent" in a) return undefined; // React の出来事
    try {
      return JSON.parse(JSON.stringify(a)) as unknown;
    } catch {
      return undefined;
    }
  });
  while (out.length > 0 && out[out.length - 1] === undefined) out.pop();
  return out;
}

/**
 * 別窓の store の操作を**送る物**に差し替える（ADR-0050 決定2・4・5）。差し替える物の一覧を返す（`setState` に渡す）。
 * - 受けない操作（`PREVIEW_DENIED_ACTIONS`）＝何もしない物にする（別窓で押しても何も起きない＝本体へも送らない）。
 * - 手元でも当てる操作（`PREVIEW_LOCAL_ACTIONS`）＝元の操作を手元で走らせてから送る。
 * - それ以外＝送るだけ。
 * ⚠️ **戻り値は無い**＝画面は store の操作の戻り値を使っていない（取り直しの `await` だけ＝`undefined` を待つ）。
 */
export function previewProxies(state: StoreState, send: (call: PreviewCall) => void): StoreState {
  const out: StoreState = {};
  for (const [name, fn] of Object.entries(state)) {
    if (typeof fn !== "function") continue;
    if (PREVIEW_DENIED_ACTIONS.has(name)) {
      out[name] = () => undefined;
      continue;
    }
    const local = PREVIEW_LOCAL_ACTIONS.has(name) ? (fn as (...a: unknown[]) => unknown) : null;
    out[name] = (...args: unknown[]) => {
      local?.(...args);
      send({ name, args: transferableArgs(args) });
    };
  }
  return out;
}

/**
 * 本体で、別窓から来た命令を実行する。実行したら `true`。
 * ⚠️ **受けない操作・store に無い名前・形の崩れた命令は捨てる**（ADR-0050 決定5）。
 */
export function runPreviewCall(state: StoreState, call: unknown): boolean {
  if (typeof call !== "object" || call == null) return false;
  const { name, args } = call as { name?: unknown; args?: unknown };
  if (typeof name !== "string" || !Array.isArray(args)) return false;
  if (PREVIEW_DENIED_ACTIONS.has(name)) return false;
  if (!Object.prototype.hasOwnProperty.call(state, name)) return false;
  const fn = state[name];
  if (typeof fn !== "function") return false;
  (fn as (...a: unknown[]) => unknown)(...args);
  return true;
}
