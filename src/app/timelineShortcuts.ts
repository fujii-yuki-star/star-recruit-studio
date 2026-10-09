// タイムライン編集の**近道キーの一覧**（ADR-0048・#1256 c6）。
//
// ⚠️ **画面の外に知識を逃がす**＝キーで済む操作が一覧で分かれば、ボタンを減らせる（Shotcut は一覧を公開している）。
// ⚠️ **一覧と実装を食い違わせない**＝`key` は**画面が見ている `e.key` の値そのもの**を書く。
// 門番（`timelineShortcuts.test.ts`）が、画面の受け口にある値が**全部この一覧にある**ことを見る
//（キーを足したのに一覧に書き忘れる、を止める）。

/** 近道キー1つ。 */
export interface Shortcut {
  /** 画面に出すキーの書き方。 */
  keys: string;
  /** 何が起きるか（利用者の言葉＝§2-3）。 */
  action: string;
  /** 画面が見ている `e.key` の値（小文字に揃えて比べる）。修飾キー（Ctrl・Shift）は含めない。 */
  codes: readonly string[];
}

/**
 * **メニューにも出すキー**（#1268）＝右クリックのメニューと一覧が**同じ値**を見る（書き分けると食い違う）。
 */
export const SHORTCUT_KEYS = {
  split: "Ctrl+K",
  remove: "Delete",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  duplicate: "Ctrl+D",
} as const;

export const TIMELINE_SHORTCUTS: readonly Shortcut[] = [
  { keys: "Space", action: "再生／停止", codes: [" "] },
  { keys: "← →", action: "1コマ戻る／進む（Shift で1秒）。キャンバスで部品を選んでいるときは、その部品を少し動かす", codes: ["arrowleft", "arrowright"] },
  { keys: "↑ ↓", action: "キャンバスで選んだ部品を少し動かす（Shift で大きく）", codes: ["arrowup", "arrowdown"] },
  { keys: "Home／End", action: "先頭へ／最後へ", codes: ["home", "end"] },
  { keys: SHORTCUT_KEYS.split, action: "選んだ部品を再生位置で分ける", codes: ["k"] },
  { keys: SHORTCUT_KEYS.remove, action: "選んだ部品を削除", codes: ["delete"] },
  { keys: "I／O", action: "作業範囲の始まり／終わりを再生位置に置く", codes: ["i", "o"] },
  { keys: "Shift+Delete（Shift+Backspace）", action: "作業範囲を削除して、空いた所を詰める（押すと確認が出ます）", codes: ["backspace"] },
  { keys: "M", action: "再生位置に目印を置く（動画には出ません）", codes: ["m"] },
  { keys: "Ctrl+A", action: "すべての部品を選ぶ", codes: ["a"] },
  { keys: `${SHORTCUT_KEYS.copy}／${SHORTCUT_KEYS.paste}`, action: "選んだ部品を写す／再生位置へ貼る（列と間隔はそのまま・重なる所には貼らない）", codes: ["c", "v"] },
  { keys: SHORTCUT_KEYS.duplicate, action: "選んだ部品を複製して、すぐ後ろに置く（空いていなければ理由を出す）", codes: ["d"] },
  { keys: "Esc", action: "選んでいるのをやめる（開いているメニューがあれば、先にそれを閉じる）", codes: ["escape"] },
  { keys: "Ctrl+Z／Ctrl+Y", action: "取り消す／やり直す", codes: ["z", "y"] },
  { keys: "Ctrl＋ホイール", action: "並びの表示倍率を変える（マウスの位置を中心に）", codes: [] },
  { keys: "Ctrl を押しながら運ぶ", action: "吸着を一時的に切る", codes: [] },
  { keys: "Alt を押しながら運ぶ", action: "元を残して、運んだ先へ写しを置く（離すときに押していれば写す）", codes: ["alt"] },
  { keys: "`", action: "指している欄を広げる／元に戻す", codes: ["`"] },
  { keys: "?", action: "この一覧を開く", codes: ["?"] },
];
