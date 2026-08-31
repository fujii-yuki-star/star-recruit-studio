/**
 * 保存の状態（#256）。**編集後＝`idle`／保存中＝`saving`／保存済み＝`saved`／失敗＝`error`**。
 *
 * ⚠️ **置き場所は `app/` 直下**（#924）＝store（`projectStore`）と、それを見ない純粋な判定
 *（`newProjectGuard`）の**両方**が使う。store に置くと、判定側が store を型だけ逆 import することになり
 * **循環参照**になる（`import type` は消えるので実害は無いが、値の import に変えた瞬間に壊れる形を残さない）。
 * ⚠️ **`domain/` へは置かない**＝これは「文書の中身」ではなく**画面が持つ状態**（§5）。
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";
