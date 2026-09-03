// 画面遷移まわりの純粋ヘルパー（§7 テスト対象・副作用なし）。ScreenId の集合と派生を1か所に置き、
// App（遷移状態）と Sidebar（表示・遷移先）で同じ線引きを共有する（§6＝2箇所で工程画面の定義がずれない）。
import type { ScreenId } from "./data/mockData";

/**
 * 動画づくりの工程画面群（サイドバーの「今の動画」で束ねる＝#399 B案）。
 * 「今の動画」の active 判定（Sidebar）と、そこへ戻る先＝直近に開いていた工程画面の記憶（App・#547 P3-7）で
 * 共有する単一の集合。別々に持つと「工程画面か」の線引きが2箇所でずれる（ADR-0026②）。
 */
export const PROJECT_SCREENS: readonly ScreenId[] = [
  // ⚠️ **タイムライン形式の編集も工程画面**（#987）＝入っていなかったので、
  // タイムライン編集を開いている間**サイドバーの「今の動画」が出ず、戻る道が無かった**
  //（場面形式も開いていると、**別の動画の名前を出したまま、押すと別の文書へ飛ぶ**）。
  "timeline-project",
  "wizard",
  "confirm",
  "generating",
  "draft",
  "scene-edit",
  "preview",
  "timeline",
  "precheck",
  "export",
];

/** その画面が動画づくりの工程画面か（工程外＝一覧・素材・見た目・設定・About）。 */
export function isProjectScreen(screen: ScreenId): boolean {
  return PROJECT_SCREENS.includes(screen);
}

/** 「今の動画」を押したときに戻る先の初期値＝工程の入口（まだ工程画面に入っていないとき）。 */
export const DEFAULT_PROJECT_RETURN: ScreenId = "draft";

/**
 * 「今の動画」を押したときに戻る先＝**直近に開いていた工程画面**（#547 P3-7）。
 * 工程画面にいる間はその画面を覚え、工程外（素材・設定・一覧など）へ出ても位置を保持する
 * ＝押すと"たたき台"固定で先頭へ飛ばされず、居場所（例：書き出し）に戻れる。
 *
 * @param prev これまで覚えている戻り先（初期は {@link DEFAULT_PROJECT_RETURN}）。
 * @param current いまの画面。工程画面ならそこを新しい戻り先にし、工程外なら prev を保つ。
 */
export function stickyProjectScreen(prev: ScreenId, current: ScreenId): ScreenId {
  return isProjectScreen(current) ? current : prev;
}

/**
 * サイドバーの「今の動画」に出すもの（#987）。
 *
 * ⚠️ **2つの形式は同時に開いたままが正規の状態**＝一覧はタイムラインを開くとき
 * 「別の文書なので」と確認を出さず、場面形式を閉じさせない。だから
 * **「どちらを開いているか」では決まらない**＝**いま（直近に）いる方**で決める。
 *
 * ⚠️ **これを画面の中で書かない**＝場面形式からしか採っていなかったせいで、
 * タイムライン編集中は「今の動画」が出ないか、**別の動画の名前を出したまま押すと別の文書へ飛んだ**。
 */
export function currentProjectLabel(input: {
  /** 「今の動画」を押したときの戻り先（`stickyProjectScreen` が覚えているもの）。 */
  returnTo: ScreenId;
  /** 場面形式を開いているか。 */
  sceneOpen: boolean;
  sceneName: string;
  /** タイムライン形式の動画名（開いていなければ `null`）。 */
  timelineName: string | null;
}): { show: boolean; name: string } {
  const onTimeline = input.returnTo === "timeline-project" && input.timelineName != null;
  if (onTimeline) return { show: true, name: input.timelineName as string };
  return { show: input.sceneOpen, name: input.sceneName };
}
