// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { TimelineEditScreen } from "./TimelineEditScreen";

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

describe("TimelineEditScreen（③(4a) 編集ループ）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      assets: [],
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      past: [],
      future: [],
      _historyGroupDepth: 0,
      saveStatus: "saved",
    });
  });

  it("テロップ追加→編集パネル表示→文言反映→削除で消える", () => {
    render(<TimelineEditScreen onNavigate={() => {}} />);
    // 追加前は編集パネルなし（案内文のみ）。
    expect(screen.queryByTestId("overlay-clip-editor")).not.toBeInTheDocument();

    // 追加 → パネルが出て既定文言「テロップ」。store にも 1 本追加される。
    fireEvent.click(screen.getByText("＋ テロップを追加"));
    const panel = screen.getByTestId("overlay-clip-editor");
    const textInput = panel.querySelector("input") as HTMLInputElement;
    expect(textInput).toHaveValue("テロップ");
    expect(useProjectStore.getState().meta.timelineOverlay?.clips).toHaveLength(1);

    // 文言編集 → store の overlay クリップに反映。
    fireEvent.change(textInput, { target: { value: "ここがポイント" } });
    expect(useProjectStore.getState().meta.timelineOverlay?.clips?.[0].text).toBe("ここがポイント");

    // 削除 → クリップが消え、編集パネルも消える。
    fireEvent.click(screen.getByText("このテロップを削除"));
    expect(useProjectStore.getState().meta.timelineOverlay?.clips).toEqual([]);
    expect(screen.queryByTestId("overlay-clip-editor")).not.toBeInTheDocument();
  });

  it("「時間の合わせ方」を絶対時間へ切り替えても実効グローバル秒を保つ（無警告ジャンプ防止）", () => {
    // 場面2つ：scene_001(0-8s)・scene_002(8-16s)。clip を場面2アンカー・相対2秒＝実効10秒で置く。
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { clips: [{ id: "ovclip_001", track: "telop", anchorSceneId: "scene_002", startSec: 2, durationSec: 3, text: "x" }] },
      },
    });
    render(<TimelineEditScreen onNavigate={() => {}} />);
    // タイムライン上の overlay クリップをクリックして選択 → 編集パネル。
    fireEvent.click(screen.getByText("x"));
    const select = screen.getByTestId("overlay-clip-editor").querySelector("select") as HTMLSelectElement;
    // 絶対時間へ切替 → 実効10秒（8+2）を保持して startSec=10 になる（無警告ジャンプしない）。
    fireEvent.change(select, { target: { value: "" } });
    const clip = useProjectStore.getState().meta.timelineOverlay?.clips?.[0];
    expect(clip?.anchorSceneId).toBeUndefined();
    expect(clip?.startSec).toBe(10);
  });
});
