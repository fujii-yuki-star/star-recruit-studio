// @vitest-environment jsdom
// よく使う素材（ユーザー素材ライブラリ・ADR-0035・#260）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/assetLibraryFs", () => ({
  listLibraryAssets: vi.fn(),
  addLibraryAsset: vi.fn(async () => ({})),
  deleteLibraryAsset: vi.fn(async () => {}),
  updateLibraryAsset: vi.fn(async () => {}),
  usedLibraryAssetIds: vi.fn(async () => []),
}));
vi.mock("../../infrastructure/dialog", () => ({ showOpenAssetsDialog: vi.fn(async () => []) }));

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { showOpenAssetsDialog } from "../../infrastructure/dialog";
import { useProjectStore } from "../store/projectStore";
import { addLibraryAsset, deleteLibraryAsset, listLibraryAssets, updateLibraryAsset, usedLibraryAssetIds } from "../../infrastructure/assetLibraryFs";
import { ASSET_TYPE } from "../../domain/enums";
import type { LibraryAsset } from "../../domain/asset/assetLibrary";

const lib = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  id: "lib_asset_001",
  fileName: "lib_asset_001.png",
  displayName: "会社ロゴ",
  assetType: ASSET_TYPE.logo,
  tags: ["会社", "ロゴ"],
  ...over,
});

const importFromLibrary = vi.fn(async () => "asset_002");

beforeEach(() => {
  importFromLibrary.mockClear();
  vi.mocked(listLibraryAssets).mockResolvedValue([
    lib(),
    lib({ id: "lib_asset_002", displayName: "オフィス写真", assetType: ASSET_TYPE.image, tags: ["会社", "写真"] }),
    lib({ id: "lib_asset_003", displayName: "社員インタビュー", assetType: ASSET_TYPE.video, tags: ["採用"] }),
  ]);
  useProjectStore.setState({ isImporting: false, importFromLibrary, brandKit: {}, updateBrandKit: vi.fn(async () => {}) } as never);
});
afterEach(() => vi.clearAllMocks());

describe("AssetLibraryPanel", () => {
  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「アセット」「マニフェスト」「グローバル」を画面に出さない", async () => {
    const { container } = render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    expect(container.textContent).not.toMatch(/アセット|マニフェスト|グローバル|lib_asset/);
  });

  it("置いてある素材を並べる（タグも見せる）", async () => {
    render(<AssetLibraryPanel />);
    expect(await screen.findByText(/会社ロゴ/)).toBeInTheDocument();
    expect(screen.getByText(/（会社・ロゴ）/)).toBeInTheDocument();
  });

  /** ⚠️ **タグは「すべて含む」で絞る**（AND）＝選ぶほど狭まる。 */
  it("タグを選ぶと絞り込む（重ねるほど狭まる）", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getByRole("button", { name: "会社" }));
    expect(screen.queryByText("社員インタビュー")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "写真" }));
    expect(screen.queryByText("会社ロゴ")).not.toBeInTheDocument();
    expect(screen.getByText("オフィス写真")).toBeInTheDocument();
  });

  it("名前でも絞り込む", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.change(screen.getByLabelText("名前で探す"), { target: { value: "オフィス" } });
    expect(screen.queryByText("会社ロゴ")).not.toBeInTheDocument();
    expect(screen.getByText("オフィス写真")).toBeInTheDocument();
  });

  /** ⚠️ **絞り込みで0件のときは「無い」と言わない**＝条件を外せば見えることを伝える（§2-5）。 */
  it("絞り込みで0件のときは、条件を変えるよう案内する", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.change(screen.getByLabelText("名前で探す"), { target: { value: "存在しない" } });
    expect(screen.getByText(/条件に合う素材がありません/)).toBeInTheDocument();
    expect(screen.queryByText(/まだ何も置いていません/)).not.toBeInTheDocument();
  });

  it("何も置いていなければ次の行動を出す", async () => {
    vi.mocked(listLibraryAssets).mockResolvedValue([]);
    render(<AssetLibraryPanel />);
    expect(await screen.findByText(/まだ何も置いていません/)).toBeInTheDocument();
  });

  it("「この動画で使う」でコピーし、どこに増えたかまで知らせる", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    await waitFor(() => expect(importFromLibrary).toHaveBeenCalledWith("lib_asset_001"));
    expect(await screen.findByText(/素材の一覧に増えています/)).toBeInTheDocument();
  });

  it("取り込めなかったときは「増えた」と言わない", async () => {
    importFromLibrary.mockResolvedValueOnce(null as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    await waitFor(() => expect(importFromLibrary).toHaveBeenCalled());
    expect(screen.queryByText(/素材の一覧に増えています/)).not.toBeInTheDocument();
  });

  /** ⚠️ **取り込み済みの動画は影響を受けない**ことを伝える（コピーだから＝不安を残さない）。 */
  it("外すと、取り込み済みの動画はそのまま使えることを伝える", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    await waitFor(() => expect(deleteLibraryAsset).toHaveBeenCalledWith("lib_asset_001"));
    // 説明文にも同じ言い回しがあるので、**外した素材の名前つき**の知らせで照合する。
    expect(await screen.findByText(/「会社ロゴ」を置き場から外しました/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **会社の見た目が消した素材を指したままにしない**（#351・PR #888 レビュー 🟡）＝
   * 指し続けると、新しい動画を作るたびに「ロゴを取り込めませんでした」になる（直す道が分かりにくい）。
   */
  it("会社の見た目のロゴを外すと、そちらの覚えも外して知らせる", async () => {
    const updateBrandKit = vi.fn(async () => {});
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: "lib_asset_001" }, updateBrandKit } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    await waitFor(() => expect(updateBrandKit).toHaveBeenCalledWith({ logoLibraryAssetId: undefined }));
    expect(await screen.findByText(/会社の見た目のロゴも外しました/)).toBeInTheDocument();
  });

  it("会社の見た目が指していない素材なら、そちらは触らない", async () => {
    const updateBrandKit = vi.fn(async () => {});
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: "lib_asset_009" }, updateBrandKit } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    await waitFor(() => expect(deleteLibraryAsset).toHaveBeenCalled());
    expect(updateBrandKit).not.toHaveBeenCalled();
  });

  it("名前とタグを直せる（区切りは読点・カンマ・空白）", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "名前とタグ" })[0]);
    fireEvent.change(screen.getByLabelText(/タグ/), { target: { value: "会社、ロゴ 新しい,タグ" } });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    await waitFor(() =>
      expect(updateLibraryAsset).toHaveBeenCalledWith("lib_asset_001", "会社ロゴ", ["会社", "ロゴ", "新しい", "タグ"]),
    );
  });

  it("取り込み中は押せない（二重に走らせない）", async () => {
    useProjectStore.setState({ isImporting: true } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    expect(screen.getAllByRole("button", { name: "この動画で使う" })[0]).toBeDisabled();
  });

  /**
   * ⚠️ **外した番号を使い回さない**（α-6 出口監査 🟡8）＝一覧は**実体があるものだけ**なので、
   * 最大番号を外したあとに一覧から採ると同じ番号が再発行され、別の素材を指してしまう。
   */
  it("置くときの番号は「これまでに使った番号」から採る（外した番号を使い回さない）", async () => {
    vi.mocked(usedLibraryAssetIds).mockResolvedValue(["lib_asset_001", "lib_asset_007"]);
    vi.mocked(showOpenAssetsDialog).mockResolvedValue(["C:/tmp/new.png"]);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    await waitFor(() => expect(vi.mocked(addLibraryAsset)).toHaveBeenCalled());
    expect(vi.mocked(addLibraryAsset).mock.calls[0]?.[0]).toBe("lib_asset_008");
  });

  /**
   * ⚠️ **採番の口が失敗したら置かない**（PR #904 レビュー）＝`[]` として続けると番号が 001 から
   * 採り直しになり、**直したばかりの「番号の使い回し」が別経路で再現する**。理由を出して断る（§2-5）。
   */
  it("これまでの番号を取れなかったら、置かずに理由を出す", async () => {
    vi.mocked(usedLibraryAssetIds).mockRejectedValueOnce("一覧を読めませんでした。");
    vi.mocked(showOpenAssetsDialog).mockResolvedValue(["C:/a.png"]);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    expect(await screen.findByText(/一覧を読めませんでした/)).toBeInTheDocument();
    expect(vi.mocked(addLibraryAsset)).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **書き出し中は押す前に止める**（α-6 出口監査 🟡15）＝すぐ隣の「素材を追加」は押す前に
   * 無効化＋理由なのに、ここだけ押せて**画面上部のバナー**で断っていた（同じ「取り込み」で
   * 断り方が2通り＝ADR-0026②）。
   */
  it("書き出し中は押せず、理由が添えてある", async () => {
    useProjectStore.getState().setExportRun({ phase: "encoding" } as never);
    render(<AssetLibraryPanel />);
    const btn = (await screen.findAllByRole("button", { name: /この動画で使う/ }))[0];
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "書き出しが終わるまでお待ちください");
    expect(screen.getByRole("button", { name: /素材を置く/ })).toBeDisabled();
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  /**
   * ⚠️ **途中で失敗しても、置けたぶんは残して数える**（α-6 出口監査 🟡16・§2-5）＝
   * 「全部失敗した」と読めると、もう一度押して**二重に置く**。
   */
  it("まとめて置いて一部が失敗しても、置けた件数を知らせる", async () => {
    vi.mocked(showOpenAssetsDialog).mockResolvedValue(["C:/a.png", "C:/b.png", "C:/c.png"]);
    vi.mocked(addLibraryAsset).mockReset();
    vi.mocked(addLibraryAsset)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce("だめでした")
      .mockResolvedValueOnce({} as never);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    expect(await screen.findByText(/2件を置きました/)).toBeInTheDocument();
    // 1件だけ失敗したときは理由をそのまま出す（件数で案内を変えない＝ADR-0026②）。
    expect(screen.getByText(/だめでした/)).toBeInTheDocument();
  });
});
