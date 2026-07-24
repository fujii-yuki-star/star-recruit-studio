// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import App from "./App";
import { useProjectStore } from "./app/store/projectStore";
import { sampleTemplates } from "./infrastructure/sampleData";
import type { Scene } from "./domain/project/types";

// #547 P3-7 レビュー：navigation.ts の単体テストと Sidebar の props テストの"接着"＝App 側の配線
// （navigate が projectReturnTo を更新 → Sidebar の currentProjectTarget → 実クリック遷移）を統合で固定する。
// これが無いと、App.tsx の結線が崩れても両単体テストは緑のまま（レビュー指摘）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

/** サイドバー内に限定してボタンを押す（場面編集など本文にも「素材」等が出るため、ナビと取り違えない）。 */
function clickSidebar(container: HTMLElement, label: string) {
  const sidebar = container.querySelector(".sidebar") as HTMLElement;
  fireEvent.click(within(sidebar).getByText(label).closest("button")!);
}

describe("App「今の動画」の戻り先の配線（#547 P3-7 統合）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      status: "ready",
      saveStatus: "saved",
    });
  });

  it("工程画面（場面編集）へ入って工程外（素材）へ出ても、「今の動画」で場面編集に戻る（たたき台固定にしない）", () => {
    const { container } = render(<App />);

    // 動画を開いている＝サイドバーに「今の動画」が出る。押すと既定の戻り先＝たたき台。
    clickSidebar(container, "今の動画");
    expect(container.querySelector(".sidebar")).not.toBeNull();
    // たたき台の固有ボタン。
    expect(within(container).getByText("この内容で確認・編集する")).toBeInTheDocument();

    // たたき台 → 場面編集（工程内の移動＝戻り先が draft から scene-edit へ更新される）。
    fireEvent.click(within(container).getByText("この内容で確認・編集する").closest("button")!);
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument(); // 場面編集に居る

    // 工程外（素材）へ出る。
    clickSidebar(container, "素材");
    expect(within(container).queryByText("台本表へ戻る")).toBeNull(); // 場面編集を離れた
    // 「素材を管理」はトップバー見出し＋本文見出しで2箇所に出るため、トップバーで確定する（工程外＝独自ヘッダ無し）。
    expect((container.querySelector(".topbar-title") as HTMLElement).textContent).toBe("素材を管理");

    // 「今の動画」＝直近の工程画面（場面編集）へ戻る。たたき台へは飛ばない。
    clickSidebar(container, "今の動画");
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument(); // 場面編集へ復帰
    expect(within(container).queryByText("この内容で確認・編集する")).toBeNull(); // たたき台ではない
  });

  it("まだ工程画面に入っていなければ、「今の動画」は入口＝たたき台へ（既定の戻り先）", () => {
    const { container } = render(<App />);
    // 一覧（home）から直接。工程画面は未訪問＝既定の draft。
    clickSidebar(container, "今の動画");
    expect(within(container).getByText("この内容で確認・編集する")).toBeInTheDocument();
  });
});
