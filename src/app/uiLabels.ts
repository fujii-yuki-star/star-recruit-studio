// 複数画面で共有するユーザー向けラベル（§6：文言は1か所に集約／§2-3：技術用語を出さない）。
import type { TextKey } from "../domain/enums";

/** テキスト種別（textKey）のユーザー向け名称。テンプレ編集・場面編集の双方で使う。全値必須＝enum 追加漏れをコンパイル検知。 */
export const textKeyLabel: Record<TextKey, string> = {
  title: "見出し",
  main: "本文",
  subtitle: "字幕",
  caption: "キャプション",
  url: "URL",
};
