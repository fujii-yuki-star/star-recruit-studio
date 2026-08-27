// クレジットの見せ方（ADR-0025・#359）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **About 画面のクレジットは必須で不変**（`13 §4`・ADR-0025）＝ここで扱うのは**動画に焼く側**だけ。
// ⚠️ **非表示にできる**のは事業側の判断（社内利用・ADR-0025）。非表示のときは
// 「概要欄などに書いてください」の案内と、**貼り付けられる一覧**を出す（それが無いと規約を守れない）。

/**
 * 見せ方の5つ（ADR-0025）。⚠️ **値は1か所**（§2-7）＝設定・描画・画面が同じものを見る。
 */
export const CREDIT_MODE = {
  always: 'always',
  head: 'head',
  tail: 'tail',
  both: 'both',
  hidden: 'hidden',
} as const;
export type CreditMode = (typeof CREDIT_MODE)[keyof typeof CREDIT_MODE];
export const CREDIT_MODES = Object.values(CREDIT_MODE) as readonly CreditMode[];

/** 既定＝**最初と最後**（ADR-0025 の利用者決定）。 */
export const DEFAULT_CREDIT_MODE: CreditMode = CREDIT_MODE.both;
/** 「数秒」の既定と範囲（秒）。 */
export const DEFAULT_CREDIT_SECONDS = 3;
export const CREDIT_SECONDS_MIN = 1;
export const CREDIT_SECONDS_MAX = 10;

/** クレジットの見せ方の設定（`videoSettings.creditDisplay`）。 */
export interface CreditDisplay {
  mode?: CreditMode;
  /** 「最初/最後の数秒」の秒数。未指定＝`DEFAULT_CREDIT_SECONDS`。 */
  seconds?: number;
}

/** 設定を既定で埋める（未指定＝既定＝**最初と最後・3秒**）。 */
export function resolveCreditDisplay(d: CreditDisplay | undefined): { mode: CreditMode; seconds: number } {
  const mode = d?.mode && CREDIT_MODES.includes(d.mode) ? d.mode : DEFAULT_CREDIT_MODE;
  const raw = d?.seconds;
  const seconds = typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(CREDIT_SECONDS_MAX, Math.max(CREDIT_SECONDS_MIN, raw))
    : DEFAULT_CREDIT_SECONDS;
  return { mode, seconds };
}

/**
 * その時刻にクレジットを出すか（ADR-0025）。
 *
 * ⚠️ **区間の決め方をここ1か所に**（§2-7・ADR-0001）＝プレビューと書き出しが**同じ関数**を通る。
 * 別々に書くと「プレビューでは出ているのに動画に入っていない」が起きる。
 * ⚠️ **区間は半開ではなく閉じる**＝先頭 `[0, N]`・末尾 `[尺-N, 尺]`（ADR-0025 の定義）。
 * ⚠️ **尺が短いときは全部に出す**＝`尺 <= N` なら先頭と末尾が重なるので、切れ目を作らない。
 */
export function creditVisibleAt(
  display: CreditDisplay | undefined,
  totalSec: number,
  timeSec: number,
): boolean {
  const { mode, seconds } = resolveCreditDisplay(display);
  if (mode === CREDIT_MODE.hidden) return false;
  if (mode === CREDIT_MODE.always) return true;
  if (!(totalSec > 0) || !Number.isFinite(timeSec)) return true; // 尺が分からないときは出す側へ倒す
  const inHead = timeSec <= seconds;
  const inTail = timeSec >= totalSec - seconds;
  if (mode === CREDIT_MODE.head) return inHead;
  if (mode === CREDIT_MODE.tail) return inTail;
  return inHead || inTail; // both
}

/**
 * **場面形式**で、その場面にクレジットを焼くか（#359）。
 *
 * ⚠️ **場面ごとにしか決められない**＝静止の場面は**1枚の絵**なので、途中で消すには
 * その場面だけ毎フレーム描き直すことになる（書き出しが目に見えて遅くなる）。
 * ADR-0025 が「再利用する」と書いていたテロップの重ね合わせ（`enable='between(t,S,E)'`）は
 * **#635 で外した**ので、そのままでは使えない。
 *
 * ⚠️ **区間に少しでも重なれば、その場面いっぱい出す**＝ずれる向きを**「多め」に固定**する。
 * 規約（`13 §4`）で困るのは**足りない**ときだけなので、多い側へ倒せば守りは崩れない。
 * タイムライン形式は毎フレーム描くので**秒どおり**（`creditVisibleAt`）＝**同じ設定で
 * 場面形式のほうが長く出る**ことがある。この違いは `15 §3` に書いてある。
 */
export function creditVisibleForScene(
  display: CreditDisplay | undefined,
  totalSec: number,
  sceneStartSec: number,
  sceneDurationSec: number,
): boolean {
  const { mode } = resolveCreditDisplay(display);
  if (mode === CREDIT_MODE.hidden) return false;
  if (mode === CREDIT_MODE.always) return true;
  const end = sceneStartSec + Math.max(0, sceneDurationSec);
  // 区間の端でも「重なっている」と見る（境界の場面で消えない）。
  return creditVisibleAt(display, totalSec, sceneStartSec) || creditVisibleAt(display, totalSec, end);
}

/**
 * 概要欄などへ貼り付ける文（#359・非表示のときの補助）。
 *
 * ⚠️ **並びを決める**＝毎回同じ文になる（貼り直すたびに順が変わると差分が読めない）。
 */
export function creditClipboardText(credits: readonly string[]): string {
  return [...new Set(credits)].sort((a, b) => a.localeCompare(b, 'ja')).join('\n');
}
