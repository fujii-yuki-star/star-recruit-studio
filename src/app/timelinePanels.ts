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

/**
 * 「置く」欄の**タブ**（#1031）。⚠️ **配置の欄ではない**＝置くものは1つの欄にタブでまとめる。
 *
 * ⚠️ **断りの行き先はタブ単位のまま受け取る**＝store は「見た目パターンを置けない」を
 * `PANEL_ID.templates` として返す。画面が `panelOfTarget` で欄へ寄せ、**そのタブへ切り替える**ので、
 * 断りと、それが指している操作が**離れない**（`15 §6`・§2-5）。
 */
export const PLACE_TAB_IDS = [PANEL_ID.place, PANEL_ID.templates, PANEL_ID.audio, PANEL_ID.voice] as const;

export type PlaceTabId = (typeof PLACE_TAB_IDS)[number];

/**
 * 「置く」欄のタブの並びと名前（#1031）。**画面に写さない**＝タブの顔ぶれは断りの行き先
 * （`PLACE_TAB_IDS`）と同じものなので、1か所に置いて食い違わせない（§6）。
 */
export const PLACE_TABS: readonly (readonly [PlaceTabId, string])[] = [
  [PANEL_ID.place, "素材・文字・図形"],
  [PANEL_ID.templates, "見た目パターン"],
  [PANEL_ID.audio, "音"],
  [PANEL_ID.voice, "読み上げ"],
];

/** 「置く」欄のタブか。 */
export function isPlaceTab(id: BlockTarget): id is PlaceTabId {
  return (PLACE_TAB_IDS as readonly string[]).includes(id);
}

/**
 * 断りの行き先を**実際に画面にある欄**へ寄せる（#1031）。
 *
 * ⚠️ **寄せないと断りが消える**＝タブになった id は配置に無いので「閉じている欄」と見なされ、
 * 出す場所を失う（黙って何も出さない・§2-5）。
 */
export function panelOfTarget(id: BlockTarget): BlockTarget {
  return isPlaceTab(id) ? PANEL_ID.place : id;
}

/**
 * 欄の id の集合（配置に出てくる id を照らす基準）。**値集合にする**＝綴り違いで
 * `normalizeLayout` に落とされ、**欄が黙って消える**のを防ぐ（§2-7）。
 *
 * ⚠️ **「置く」のタブは入れない**（#1031）＝配置の欄は4つ（仕上がり確認・並び・選んだ部品・置く）。
 * 入れると、**中身の無い欄**が配置に残り「〈欄〉を表示する」で空の箱が出る。
 * ⚠️ 以前の配置を覚えている人は、タブになった id が `normalizeLayout` で落ちる＝
 * **「置く」欄に全部まとまる**（意図した移行）。戻したいときは「配置を既定に戻す」。
 */
export const PANEL_IDS = [PANEL_ID.preview, PANEL_ID.arrange, PANEL_ID.selected, PANEL_ID.place];

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
 * **どこから始めても画面全体の話になる理由**（#869 レビュー 🟡）。
 *
 * ⚠️ **呼び出し側ごとに書かない**＝「書き出し中だけは帯」を入口ごとに書くと、入口が増えたときに
 * 片方だけ欄へ押し込まれ、**同じ状況なのに出る場所が違う**（ADR-0026②）。理由の性質なので
 * ここで1回だけ決める。
 *
 * ⚠️ **`notFound` も含める**＝対象が消えた後の操作なので、「その欄を見てください」と言っても直らない。
 */
const ALWAYS_GLOBAL = new Set<string>([
  "TIMELINE_EDIT_EXPORTING",
  "TIMELINE_PLAY_EXPORTING",
  "TIMELINE_EDIT_PLAYING",
  "TIMELINE_EDIT_NOT_FOUND",
]);

/**
 * 断りの置き場所を決める（**理由が画面全体のものなら、始めた欄より優先して帯へ**）。
 * 置く側は素直に「自分の欄」を渡してよい＝例外をここが引き受ける。
 *
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
export function blockTargetFor(reason: string, at: BlockTarget): BlockTarget {
  return ALWAYS_GLOBAL.has(reason) ? BLOCK_GLOBAL : at;
}
