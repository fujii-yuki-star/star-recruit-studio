// @vitest-environment jsdom
// 素材を取り込むボタン（#712）。**3画面（＋はじめの入力）が同じ分岐を共有する**ようになったので、
// 「アプリの中はネイティブの『開く』／ブラウザはファイル選択」の出し分けをここで固定する。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AssetImportButton } from "./AssetImportButton";
import * as assetFsMod from "../../infrastructure/assetFs";
import * as dialogMod from "../../infrastructure/dialog";

const props = () => ({ onFile: vi.fn(), onPath: vi.fn(), isImporting: false });

afterEach(() => { vi.restoreAllMocks(); });

describe("AssetImportButton（取り込みの入口）", () => {
  beforeEach(() => { vi.spyOn(dialogMod, "showOpenAssetDialog").mockResolvedValue("C:/pics/a.png"); });

  it("アプリの中ではネイティブの「開く」で選ぶ（素材のバイトを読まない）", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    const p = props();
    render(<AssetImportButton {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /素材を追加/ }));
    await vi.waitFor(() => expect(p.onPath).toHaveBeenCalledWith("C:/pics/a.png"));
    expect(p.onFile).not.toHaveBeenCalled();
  });

  it("ブラウザではファイル選択に落ちる", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(false);
    const p = props();
    const { container } = render(<AssetImportButton {...p} />);
    const input = container.querySelector("input")!;
    const file = new File(["x"], "外観.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(p.onFile).toHaveBeenCalledWith(file);
    expect(p.onPath).not.toHaveBeenCalled();
    // ※「同じファイルを選び直しても届くよう値を空に戻す」（`e.target.value = ""`）は、
    //   jsdom のファイル入力が値を持たないため断言できない＝守れない検査は置かない。
  });

  it("キーボードでも同じところへ行ける（ドラッグ専用の操作を作らない・ADR-0034 決定19）", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    const p = props();
    render(<AssetImportButton {...p} />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    // 関係ないキーでは開かない（フォーカスが乗っているだけで「開く」が出る、を作らない）。
    fireEvent.keyDown(btn, { key: "a" });
    fireEvent.keyDown(btn, { key: "Tab" });
    expect(dialogMod.showOpenAssetDialog).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: "Enter" });
    await vi.waitFor(() => expect(p.onPath).toHaveBeenCalled());
  });

  it("「開く」を出している間は二重に開かない", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    let release: (v: string | null) => void = () => {};
    const open = vi.spyOn(dialogMod, "showOpenAssetDialog").mockReturnValue(new Promise((r) => { release = r; }));
    const p = props();
    render(<AssetImportButton {...p} />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(btn).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(btn);
    expect(open).toHaveBeenCalledTimes(1);
    release(null);
  });

  it("取り込み中・押せない理由があるときは押しても何もしない", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    const p = { ...props(), isImporting: true };
    render(<AssetImportButton {...p} />);
    const btn = screen.getByRole("button", { name: /取り込み中/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    // 「開く」を出そうとした時点で捕まえる（`onPath` は非同期なので、後で見ると素通りに見える）。
    expect(dialogMod.showOpenAssetDialog).not.toHaveBeenCalled();
    expect(p.onPath).not.toHaveBeenCalled();
    expect(p.onFile).not.toHaveBeenCalled();
  });

  it("押せない理由は指したときに出す（黙って効かないボタンにしない・§2-5）", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    render(<AssetImportButton {...props()} disabledReason="書き出しが終わるまでお待ちください" />);
    expect(screen.getByRole("button", { name: /素材を追加/ })).toHaveAttribute("title", "書き出しが終わるまでお待ちください");
  });
});
