// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #755-3 レビュー：失敗の知らせを**印に紐づけて**出していたので、「前の声が残るときは印を据え置く」に
// したとたん**押しても何も起きなかったように見える**（無言の失敗）。掛け合いとタイムライン編集は
// 無条件で出すので、同じ操作の返事が場所で変わっていた（ADR-0026②・§2-5）。

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "ひとこと", status: "generated", voicePath: "voices/scene_001.wav" },
    warnings: [],
    ...over,
  }) as unknown as Scene;

describe("声を作れなかったときの知らせ（#755-3）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "saved",
      narrationError: "音声の作成に失敗しました。もう一度お試しください。前に作った声はそのまま使えます。",
    } as never);
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  it("印が「作成済み」のままでも、失敗の知らせは出る（無言の失敗を作らない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("音声の作成に失敗しました");
    expect(screen.getByRole("alert").textContent).toContain("前に作った声はそのまま使えます");
  });

  it("知らせが無いときは出さない（常に出しっぱなしにしない）", () => {
    useProjectStore.setState({ narrationError: null } as never);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/音声の作成に失敗しました/)).toBeNull();
  });
});
