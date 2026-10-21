// @vitest-environment jsdom
// 一覧の小さな絵（#397）：絵が読めない動画では折れた絵を出さず、印に戻す（2026-10-20 実機＝タイムライン形式の動画で折れた絵が出ていた）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../infrastructure/assetFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/assetFs")>()),
  // ⚠️ 実物も「ファイルがあるか」を見ずに道を作る＝ここでも必ず道を返す。
  assetDisplayUrl: vi.fn(async (projectId: string) => `asset://${projectId}/preview.png`),
}));

import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen 一覧の小さな絵", () => {
  afterEach(() => vi.restoreAllMocks());

  it("読めた絵は出し、読めなかった動画は印に戻す（折れた絵を出さない）", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(() =>
        Promise.resolve([
          { projectId: "proj_001", projectName: "絵のある動画", updatedAt: "2026-10-20T00:00:00Z" },
          { projectId: "proj_002", projectName: "絵の無い動画", updatedAt: "2026-10-20T00:00:00Z" },
        ] as unknown as ProjectHeader[]),
      ),
    });
    const { container } = render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText("絵の無い動画");
    const imgOf = (id: string) => container.querySelector(`img[src="asset://${id}/preview.png"]`);
    await vi.waitFor(() => expect(imgOf("proj_002")).not.toBeNull());
    fireEvent.error(imgOf("proj_002")!);
    expect(imgOf("proj_002")).toBeNull();
    // 読めた動画の絵は残る（別の動画の失敗で消さない）。
    expect(imgOf("proj_001")).not.toBeNull();
    // 印（フォルダ）に戻っている＝カードの絵の枠に svg がある。
    const card = screen.getByText("絵の無い動画").closest("button")!;
    expect(card.querySelector(".thumb svg")).not.toBeNull();
  });
});
