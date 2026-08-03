// @vitest-environment jsdom
// 場面編集の欄の配置（ADR-0033 段階4）。**いままでの見え方を保ったまま**、組み替えられることを固定する。
// #276（左の折りたたみ・右幅のドラッグ）でやっていたことを、配置の仕組みへ畳んだ。
// #550（節の開閉）は**そのまま**＝あれは欄の中身の話で、配置とは別の層（ADR-0033 段階4）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const template = {
  schemaVersion: "1.0", templateId: "photo_intro_v1", name: "写真で始める", category: "photo_intro",
  aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "photo_intro_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

beforeEach(() => {
  useProjectStore.setState({
    templates: [template],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene()], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  // 配置はアプリの設定に残る＝テスト間で持ち越さない。
  localStorage.clear();
});

describe("SceneEditScreen: 欄の配置（ADR-0033 段階4）", () => {
  it("既定はいままでと同じ顔ぶれ（素材一覧・仕上がり確認・場面の並び・編集が同時に見える）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    for (const title of ["素材一覧", "仕上がり確認", "場面の並び", "選択中の場面を編集"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("欄を閉じられて、戻す導線が出る（#276 の折りたたみを置き換える）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("素材一覧の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    expect(screen.queryByRole("heading", { name: "素材一覧" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "「素材一覧」を表示する" }));
    expect(screen.getByRole("heading", { name: "素材一覧" })).toBeInTheDocument();
  });

  it("配置は覚えていて、開き直しても同じ（#276 の幅の記憶を置き換える）", () => {
    const first = render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("素材一覧の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    first.unmount();
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "素材一覧" })).not.toBeInTheDocument();
  });

  it("「配置を既定に戻す」で戻る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("素材一覧の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "配置を既定に戻す" }));
    expect(screen.getByRole("heading", { name: "素材一覧" })).toBeInTheDocument();
  });

  it("境界を掴んで大きさを変えられる（#276 の右幅ドラッグを置き換える）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("左の欄の幅")).toBeInTheDocument();
    expect(screen.getByLabelText("右の欄の幅")).toBeInTheDocument();
  });

  it("タイムライン編集とは別に覚える（画面ごとに1つ）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("素材一覧の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    expect(localStorage.getItem("app.panelLayout.timeline")).toBeNull();
  });
});

describe("SceneEditScreen: 触っていない画面は覚えない（#550 の教訓・/canon-check の指摘）", () => {
  it("配置を触らずに開いているだけでは、既定を焼き付けない（あとで既定を良くしたときに届く）", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<SceneEditScreen onNavigate={vi.fn()} />);
      // 保存は少し待ってから走る＝**その待ちを実際に越えても**書かれないことを見る。
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(localStorage.getItem("app.panelLayout.scene")).toBeNull();
      unmount();
      expect(localStorage.getItem("app.panelLayout.scene")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("「配置を既定に戻す」を押したら、覚えていたものも消える（次に開いても既定）", () => {
    const first = render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("素材一覧の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "配置を既定に戻す" }));
    first.unmount();
    expect(localStorage.getItem("app.panelLayout.scene")).toBeNull();
  });
});

describe("SceneEditScreen: 見出しを欄へ移したあとの並び（/canon-check の指摘）", () => {
  it("3つの欄とも、右にある操作は右のまま（`space-between` の片方が空いたままにしない）", () => {
    const { container } = render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 欄の見出しを欄の側（`PanelSpec.title`）へ移したので、中の `row-between` は子が1つになりうる。
    // 子が1つだと `space-between` は左寄せになる＝右にあった操作が左へ動いてしまう。
    const rows = Array.from(container.querySelectorAll(".row-between"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.children.length).toBeGreaterThanOrEqual(2);
    }
  });
});
