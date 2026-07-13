// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// 送信判定（willSendExternally）が reject する状況（鍵ストア/invoke 失敗）を模す。他の export は実体を保つ
// （store も同モジュールから import するため）。
vi.mock("../../infrastructure/aiClient", async (importActual) => ({
  ...(await importActual<typeof import("../../infrastructure/aiClient")>()),
  willSendExternally: vi.fn(() => Promise.reject(new Error("key store unavailable"))),
}));

import { DraftScreen } from "./DraftScreen";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";

const scene = {
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "tpl",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "こんにちは", voiceId: null, status: "generated" }, warnings: [],
} as unknown as Scene;

describe("DraftScreen 作り直す：送信判定失敗は fail-closed で送信前確認へ（#423 P2）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    useProjectStore.setState({ scenes: [scene], status: "ready", warnings: [], confirmReturnTo: null });
  });
  afterEach(() => vi.clearAllMocks());

  it("willSendExternally が reject しても無反応にせず、ConfirmScreen へ送り confirmReturnTo='draft' を立てる", async () => {
    const onNavigate = vi.fn();
    render(<DraftScreen onNavigate={onNavigate} />);
    // 主操作の「作り直す」→ 破棄確認を開く（この時点では画面に1つ）。
    fireEvent.click(screen.getByRole("button", { name: "作り直す" }));
    // 破棄確認（alert）の中の「作り直す」を押す＝判定→ルーティングが走る。
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "作り直す" }));
    // 判定 reject → fail-closed で送信前確認へ倒れる（無反応にならない）。
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("confirm"));
    expect(useProjectStore.getState().confirmReturnTo).toBe("draft");
  });
});
