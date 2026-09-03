// @vitest-environment jsdom
// 押した言葉の欄から見せる（#995 ③）。
//
// ⚠️ **「セリフ」「素材」「見た目」は3つとも同じ場所へ行くだけ**で、行き先でその欄に寄る
// 仕掛けが無かった＝**押した言葉と着地がずれる**。3つ並べる意味が無い状態だった。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { DraftScreen } from "./DraftScreen";
import type { Scene } from "../../domain/project/types";

const scene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as Scene;

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.setState({
    status: "ready",
    scenes: [scene("scene_001")],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    editingSceneId: null,
    editingSceneFocus: null,
  });
});

describe("たたき台の行ボタンが、押した言葉の欄へ連れて行く（#995 ③）", () => {
  const press = (label: string) => {
    const onNavigate = vi.fn();
    render(<DraftScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    return onNavigate;
  };

  it.each([
    ["セリフ", "narration"],
    ["素材", "assets"],
    ["見た目", "look"],
  ])("「%s」を押すと、その欄を指して場面編集へ行く", (label, focus) => {
    const onNavigate = press(label);
    expect(onNavigate).toHaveBeenCalledWith("scene-edit");
    expect(useProjectStore.getState().editingSceneId).toBe("scene_001");
    expect(useProjectStore.getState().editingSceneFocus, "押した言葉と着地がずれている").toBe(focus);
  });

  // ⚠️ **3つが同じ値では意味が無い**＝直す前はここが全部同じだった。
  it("3つが違う欄を指す（同じ場所へ行くだけ、を作らない）", () => {
    // ⚠️ **1回ずつ描き直す**＝同じ画面に残したまま続けて押すと、
    // 2つ目以降が**前の描画の要素**に当たって（同名のボタンが複数見つかって）読み取れない。
    const seen = ["セリフ", "素材", "見た目"].map((label) => {
      cleanup();
      useProjectStore.setState({ editingSceneFocus: null });
      press(label);
      return useProjectStore.getState().editingSceneFocus;
    });
    expect(new Set(seen).size, "押した言葉が違うのに、指す欄が同じ").toBe(3);
  });
});
