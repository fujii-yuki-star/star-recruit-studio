// @vitest-environment jsdom
// 素材を取り込むボタン（#712）。**3画面（＋はじめの入力）が同じ分岐を共有する**ようになったので、
// 「アプリの中はネイティブの『開く』／ブラウザはファイル選択」の出し分けをここで固定する。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AssetImportButton } from "./AssetImportButton";
import * as assetFsMod from "../../infrastructure/assetFs";
import * as dialogMod from "../../infrastructure/dialog";

const props = () => ({ onPick: vi.fn(), isImporting: false });

afterEach(() => { vi.restoreAllMocks(); });

describe("AssetImportButton（取り込みの入口）", () => {
  beforeEach(() => { vi.spyOn(dialogMod, "showOpenAssetsDialog").mockResolvedValue(["C:/pics/a.png"]); });

  it("アプリの中ではネイティブの「開く」で選ぶ（素材のバイトを読まない）", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    const p = props();
    render(<AssetImportButton {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /素材を追加/ }));
    await vi.waitFor(() => expect(p.onPick).toHaveBeenCalledWith(["C:/pics/a.png"]));
  });

  it("ブラウザではファイル選択に落ちる", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(false);
    const p = props();
    const { container } = render(<AssetImportButton {...p} />);
    const input = container.querySelector("input")!;
    const file = new File(["x"], "外観.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(p.onPick).toHaveBeenCalledWith([file]);
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
    expect(dialogMod.showOpenAssetsDialog).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: "Enter" });
    await vi.waitFor(() => expect(p.onPick).toHaveBeenCalled());
  });

  it("「開く」を出している間は二重に開かない", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    let release: (v: string[]) => void = () => {};
    const open = vi.spyOn(dialogMod, "showOpenAssetsDialog").mockReturnValue(new Promise((r) => { release = r; }));
    const p = props();
    render(<AssetImportButton {...p} />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(btn).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(btn);
    expect(open).toHaveBeenCalledTimes(1);
    release([]);
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
    expect(dialogMod.showOpenAssetsDialog).not.toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it("置き場所ごとの見た目を落とさない（置き換えで幅や余白が黙って変わらない）", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    render(<AssetImportButton {...props()} variant="secondary" className="btn-block mt" />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    // `.btn` は inline-flex なので、`btn-block` が落ちるとボタンが中身の幅に縮む。
    expect(btn).toHaveClass("btn", "btn-secondary", "btn-block", "mt");
  });

  it("押せない理由は指したときに出す（黙って効かないボタンにしない・§2-5）", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    render(<AssetImportButton {...props()} disabledReason="書き出しが終わるまでお待ちください" />);
    expect(screen.getByRole("button", { name: /素材を追加/ })).toHaveAttribute("title", "書き出しが終わるまでお待ちください");
  });
  // ── まとめて取り込む（#858）──────────────────────────────────────
  //
  // ⚠️ **1つずつしか選べなかった**＝10枚入れるのに10回ダイアログを開くことになっていた。
  // ⚠️ **この部品の責務は「選んだものをまとめて渡す」ところまで**＝取り込みの成否・失敗の案内は
  //    取り込み側（store の `addAssets`）が持つ（4画面とも `importError` を自分で出しているので、
  //    ここでも出すと同じ失敗が二重に見える）。だからここでは**渡し方と進み具合の表示**を固定する。

  it("まとめて選ぶと、選んだものを1回でまとめて渡す", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    vi.spyOn(dialogMod, "showOpenAssetsDialog").mockResolvedValue(["C:/pics/a.png", "C:/pics/b.png", "C:/pics/c.png"]);
    const p = props();
    render(<AssetImportButton {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /素材を追加/ }));
    // ⚠️ **1件ずつに割らない**＝`asset_NNN` の採番は取り込み側が直列で回すことに依っている（11.2）。
    await vi.waitFor(() => expect(p.onPick).toHaveBeenCalledTimes(1));
    expect(p.onPick).toHaveBeenCalledWith(["C:/pics/a.png", "C:/pics/b.png", "C:/pics/c.png"]);
  });

  it("何も選ばずに閉じたら何もしない", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    vi.spyOn(dialogMod, "showOpenAssetsDialog").mockResolvedValue([]);
    const p = props();
    render(<AssetImportButton {...p} />);
    const btn = screen.getByRole("button", { name: /素材を追加/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(btn).toHaveAttribute("aria-disabled", "false"));
    expect(p.onPick).not.toHaveBeenCalled();
  });

  // ⚠️ **進み具合を出す**＝10枚入れている間「取り込み中…」だけだと、進んでいるのか止まっているのか分からない。
  it("進み具合が渡されたら何件目かを出す", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    render(<AssetImportButton {...props()} isImporting progress={{ done: 3, total: 10 }} />);
    expect(screen.getByRole("button", { name: "取り込み中… 3/10" })).toBeInTheDocument();
  });

  it("進み具合が無ければ件数を出さない（1件だけのとき＝一瞬出て消える表示にしない）", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    render(<AssetImportButton {...props()} isImporting progress={null} />);
    expect(screen.getByRole("button", { name: "取り込み中…" })).toBeInTheDocument();
    expect(screen.queryByText(/取り込み中… \d/)).toBeNull();
  });

  // ⚠️ **ブラウザ側も同じ**（ADR-0026②＝同じボタンで挙動を割らない）。
  it("ブラウザでも複数まとめて渡せる", async () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(false);
    const p = props();
    const { container } = render(<AssetImportButton {...p} />);
    const input = container.querySelector("input")!;
    expect(input).toHaveAttribute("multiple");
    const files = [new File(["x"], "1.png"), new File(["y"], "2.png")];
    fireEvent.change(input, { target: { files } });
    await vi.waitFor(() => expect(p.onPick).toHaveBeenCalledWith(files));
  });
});
