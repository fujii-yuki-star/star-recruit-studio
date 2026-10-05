// @vitest-environment jsdom
// 台本表の行の操作は「セリフ」と「⋮」だけ（UI/UX 監査 2026-10-02＝操作の列に7つ詰まっていた）。
// ほかの操作は「⋮」と右クリックの同じメニューへ畳む。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { DraftScreen } from "./DraftScreen";
import type { Scene } from "../../domain/project/types";

const scene = (id: string, order: number, text: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text, status: "none" }, warnings: [],
  }) as Scene;

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.setState({
    status: "ready",
    scenes: [scene("scene_001", 1, "一つ目"), scene("scene_002", 2, "二つ目")],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
    past: [], future: [], _historyGroupDepth: 0,
  });
});

const order = () => useProjectStore.getState().scenes.map((s) => s.sceneId);
const openMenu = (n: number) => fireEvent.click(screen.getByRole("button", { name: `${n}番目の場面の操作` }));

describe("台本表の行の操作", () => {
  it("行に出すのは「セリフ」と「⋮」だけ", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    const row = screen.getByText("一つ目").closest("tr")!;
    expect(within(row).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())).toEqual(["セリフ", "1番目の場面の操作"]);
  });

  it("メニューから並べ替え・複製ができ、端では押せず理由が出る", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    openMenu(1);
    const up = screen.getByRole("menuitem", { name: "上へ移動" });
    expect(up).toBeDisabled();
    expect(up.getAttribute("title")).toBe("いちばん上の場面です");
    fireEvent.click(screen.getByRole("menuitem", { name: "下へ移動" }));
    expect(order()).toEqual(["scene_002", "scene_001"]);
    openMenu(2);
    expect(screen.getByRole("menuitem", { name: "下へ移動" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "この場面を複製" }));
    expect(order()).toHaveLength(3);
  });

  it("右クリックでも同じメニューが開く", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("二つ目").closest("tr")!, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: "上へ移動" })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "下へ移動" })).toBeDisabled();
  });

  it("削除はメニューから、行の中の確認を通して消す（いきなり消さない）", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    openMenu(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "この場面を削除" }));
    expect(order()).toHaveLength(2);
    const row = screen.getByText("一つ目").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /削除する/ }));
    expect(order()).toEqual(["scene_002"]);
  });
});
