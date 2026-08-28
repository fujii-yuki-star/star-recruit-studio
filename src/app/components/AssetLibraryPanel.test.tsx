// @vitest-environment jsdom
// よく使う素材（ユーザー素材ライブラリ・ADR-0035・#260）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/assetLibraryFs", () => ({
  listLibraryAssets: vi.fn(),
  addLibraryAsset: vi.fn(async () => ({})),
  deleteLibraryAsset: vi.fn(async () => {}),
  updateLibraryAsset: vi.fn(async () => {}),
}));
vi.mock("../../infrastructure/dialog", () => ({ showOpenAssetsDialog: vi.fn(async () => []) }));

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { useProjectStore } from "../store/projectStore";
import { deleteLibraryAsset, listLibraryAssets, updateLibraryAsset } from "../../infrastructure/assetLibraryFs";
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
});
