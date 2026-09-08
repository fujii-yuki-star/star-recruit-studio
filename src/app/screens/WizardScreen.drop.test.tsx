// @vitest-environment jsdom
// **ファイルを落として取り込める**（#1026 ②）。
//
// ⚠️ 破線の枠とアップロードの絵なのに、**落としても無反応**だった（`src/app` にファイルの
//    `onDrop` は0件＝実測）。初めての人が最初に試す操作が何も起きない。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardScreen } from "./WizardScreen";
import { useProjectStore } from "../store/projectStore";

const dropZone = (): HTMLElement => screen.getByText(/ここに写真や動画を落とすか/).closest("label") as HTMLElement;

/** 素材の段（step2）から開く（必須の入力に阻まれずに枠だけを見る）。 */
const gotoAssets = (): void => {
  useProjectStore.setState({ wizardStep: 2 } as never);
  render(<WizardScreen onNavigate={() => {}} />);
};

const file = (name: string, type = "image/png"): File => new File(["x"], name, { type });
const dataTransfer = (files: File[]) => ({ files, types: ["Files"] });

describe("はじめの入力：写真・動画を落として取り込む（#1026 ②）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });

  it("落としたファイルが取り込みへ渡る", () => {
    const addAssets = vi.fn();
    useProjectStore.setState({ addAssets } as never);
    gotoAssets();
    const f = file("会社.png");
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer([f]) });
    expect(addAssets, "落としても取り込まれない").toHaveBeenCalledWith([f]);
  });

  // ⚠️ **既定を止めないと**ブラウザがそのファイルを開いて画面ごと消える。
  it("落とし込みの既定の動きを止める", () => {
    useProjectStore.setState({ addAssets: vi.fn() } as never);
    gotoAssets();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: dataTransfer([]) });
    dropZone().dispatchEvent(over);
    expect(over.defaultPrevented, "上を通ったときに止めていない").toBe(true);
  });

  // ⚠️ **黙って捨てない**（§2-5）＝落とした本人は全部入ったと思う。
  it("取り込めない形式が混ざっていたら、その場で言う（通るものは入れる）", () => {
    const addAssets = vi.fn();
    useProjectStore.setState({ addAssets } as never);
    gotoAssets();
    const ok = file("会社.png");
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer([ok, file("会社案内.pdf", "application/pdf")]) });
    expect(addAssets, "通るものまで落としている").toHaveBeenCalledWith([ok]);
    expect(screen.getByRole("alert").textContent, "通らなかったことを言っていない").toContain("会社案内.pdf");
  });

  it("1件も通らなかったときは、取り込みを呼ばない", () => {
    const addAssets = vi.fn();
    useProjectStore.setState({ addAssets } as never);
    gotoAssets();
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer([file("会社案内.pdf", "application/pdf")]) });
    expect(addAssets, "何も通らないのに取り込みを呼んでいる").not.toHaveBeenCalled();
  });

  // ⚠️ **取り込み中は受けない**＝押せないボタンと同じ扱い（黙って始めない）。
  it("取り込んでいる間は落としても受けない", () => {
    const addAssets = vi.fn();
    useProjectStore.setState({ addAssets, isImporting: true } as never);
    gotoAssets();
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer([file("会社.png")]) });
    expect(addAssets, "取り込み中なのに受けている").not.toHaveBeenCalled();
  });
});
