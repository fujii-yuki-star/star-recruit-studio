// @vitest-environment jsdom
// 見わたすタイムラインが**見るだけ**だと分かる（#1032）。
//
// 見出しが「タイムライン」だけで、**編集画面（タイムライン編集）と見分けがつかず**、
// 読み取り専用であることは説明文の一文にしか無かった＝帯を掴もうとして空振りしてから気づく。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { TimelineScreen } from "./TimelineScreen";

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  } as unknown as Scene);

describe("見わたすタイムライン：見るだけだと分かる（#1032）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], status: "ready", saveStatus: "saved",
    });
  });

  it("見出しは正典の呼び名（編集画面と見分けがつく）", () => {
    render(<TimelineScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("見わたすタイムライン");
  });

  it("「見るだけ」の印を見出しの並びに出す（説明文を読まなくても分かる）", () => {
    render(<TimelineScreen onNavigate={vi.fn()} />);
    const head = screen.getByRole("heading", { level: 1 }).closest(".page-head");
    expect(head, "見出しの行が見つからない").not.toBeNull();
    // ⚠️ **行の文字を見るだけでは足りない**（変異チェックで生き残った）＝
    //   説明文にも「ここでは見るだけで…」とあるので、**印を消しても緑のまま**になる。
    const badge = head?.querySelector(".badge");
    expect(badge, "「見るだけ」の印が無い").not.toBeNull();
    expect(badge?.textContent).toBe("見るだけ");
  });
});
