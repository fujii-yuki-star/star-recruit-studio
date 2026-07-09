// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// #410 sub3 レビュー：書き出し画面→仕上がり確認（BGM選び）→「書き出しへ戻る」で書き出し入力が
// 初期化される問題の回帰防止。App は画面ごとに別コンポーネントを返す＝往復で ExportScreen は再マウント
// されるため、入力を store（exportForm）に退避して失わないことを固定する。
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

describe("ExportScreen 書き出し入力の保持（#410 sub3 レビュー）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      saveStatus: "saved",
    });
  });

  it("ファイル名・画質・字幕を変えて再マウントしても（Export→仕上がり確認→Export）入力が保持される", () => {
    const first = render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.change(first.container.querySelector("#fileName") as HTMLInputElement, { target: { value: "my-movie" } });
    fireEvent.change(first.container.querySelector("#size") as HTMLSelectElement, { target: { value: "hd" } });
    fireEvent.click(first.getByRole("switch")); // 字幕を入れる → OFF（既定 true）

    expect(useProjectStore.getState().exportForm.fileName).toBe("my-movie");
    expect(useProjectStore.getState().exportForm.size).toBe("hd");
    expect(useProjectStore.getState().exportForm.withSubtitle).toBe(false);

    // 仕上がり確認へ往復＝ExportScreen 再マウント。入力が既定に戻らず保持される。
    first.unmount();
    const second = render(<ExportScreen onNavigate={vi.fn()} />);
    expect((second.container.querySelector("#fileName") as HTMLInputElement).value).toBe("my-movie");
    expect((second.container.querySelector("#size") as HTMLSelectElement).value).toBe("hd");
    expect((second.getByRole("switch") as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
  });
});
