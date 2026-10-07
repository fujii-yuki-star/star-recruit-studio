// @vitest-environment jsdom
//
// 拡大縮小が**3画面すべてに出ている**こと（#142）。
//
// ⚠️ **共有部品として作る**のが利用者条件（2026-08-17）＝場面編集だけに付けると ADR-0032 の
// 凍結（場面形式の編集機能の拡張）とぶつかる。部品と domain が緑でも、**どこかの画面へ
// 配線し忘れれば条件を満たさない**ので、画面ごとに出ていることを直接見る
//（#855・#793 で「単体は緑でも画面まで届いていない」を2度踏んでいる）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";
import { LooksEditScreen } from "./LooksEditScreen";
import { PreviewScreen } from "./PreviewScreen";

const scene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "opening", templateId: "opening_yuko_right_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("拡大縮小は3画面すべてに出る（#142・共有部品の条件）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: [{ ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" }, ...sampleTemplates],
      scenes: [scene("scene_001"), scene("scene_002")],
      parts: [{ partId: "part_001", title: "本編", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      assets: [], editingSceneId: "scene_001", editingTemplateId: "user_tmpl_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  const hasControl = () => {
    expect(screen.getByLabelText("表示を広げる")).toBeInTheDocument();
    expect(screen.getByLabelText("表示を縮める")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全体表示" })).toBeInTheDocument();
  };

  it("場面編集に出る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    hasControl();
  });

  it("見た目パターン編集に出る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    hasControl();
  });

  it("仕上がり確認に出る", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    hasControl();
  });
});
