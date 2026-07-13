import { describe, expect, it } from "vitest";
import { saveButtonLabel } from "./saveButtonLabel";

// 保存ボタン文言の単一参照元（#410 sub5）。idle は「保存」1種・状態文言もここに集約されることを固定する。
describe("saveButtonLabel（保存ボタン文言の単一参照元・#410 sub5）", () => {
  it("idle は「保存」に統一（ここまで保存／変更を保存／プロジェクトを保存を廃止）", () => {
    expect(saveButtonLabel("idle")).toBe("保存");
  });
  it("状態ごとの文言（保存中／保存しました／失敗は次の行動＝§2-5）", () => {
    expect(saveButtonLabel("saving")).toBe("保存中…");
    expect(saveButtonLabel("saved")).toBe("保存しました");
    expect(saveButtonLabel("error")).toBe("保存に失敗（もう一度押す）");
  });
});
