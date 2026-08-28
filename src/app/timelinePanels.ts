// タイムライン編集の欄（ADR-0033＝ドッキング配置）の名前。
//
// ⚠️ **画面と store の両方が同じ名前を見る**（#869）＝置けなかった理由を**操作した欄の中**に
// 返す（ADR-0034 決定10）ために、store は「どの欄の話か」を持つ。画面の中に閉じたままだと
// **同じ一覧が2つ**になり、片方だけ増えたときに黙って行き先を失う。

/** 欄の名前。`PanelSpec.id` と配置の保存キーに使う。 */
export const PANEL_ID = {
  preview: "preview",
  arrange: "arrange",
  selected: "selected",
  templates: "templates",
  place: "place",
  audio: "audio",
  voice: "voice",
} as const;

export const PANEL_IDS = Object.values(PANEL_ID);

export type TimelinePanelId = (typeof PANEL_ID)[keyof typeof PANEL_ID];

/**
 * 断りを出す場所。欄のどれか、または **`global`＝どの欄にも属さない**。
 *
 * ⚠️ **全部を欄の中へ押し込まない**（#869）＝書き出し中・再生中・対象が見つからない、は
 * **画面全体に効く**ので、欄の中に入れると**閉じている欄の断りが消える**（§2-5＝黙って何も
 * 出さない、を作らない）。こういう断りは今までどおり帯で出す。
 */
export const BLOCK_GLOBAL = "global" as const;

export type BlockTarget = TimelinePanelId | typeof BLOCK_GLOBAL;

/**
 * **どこに返すか**の決め方（#869・ADR-0034 決定10）。⚠️ **理由ではなく「操作」で決める**＝
 * 同じ「重なっています」でも、置くボタンで出たなら置く欄・帯を掴んで出たなら並びの欄が正しい。
 *
 * | 始め方 | 返す先 |
 * |---|---|
 * | 欄のボタン・メニュー | **その欄** |
 * | キャンバス／並びの帯を掴む | 掴んだ面（`preview` / `arrange`） |
 * | キーボードだけの操作 | `global`（**押せない見た目が無い**＝欄に閉じると気づけない） |
 * | 画面全体に効く断り（書き出し中・再生中・対象が無い） | `global` |
 * | 入口が2つ以上ある操作 | 始めた所を**引数で受ける**（`splitSelectedClip` 等） |
 *
 * ⚠️ **行き先の欄を閉じているときも `global` へ倒す**（画面側が見る）＝出しても見えないので、
 * 押した結果が黙って消える（§2-5）。
 */
