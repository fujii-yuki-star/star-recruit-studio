// @vitest-environment jsdom
// #952：**白紙から作る**の着地先はたたき台なのに、この画面だけ知らせ（`importError`）を描いていなかった。
// 会社の見た目の文字の形が入らなかったこと（#929）は**新しい動画を作った直後**に立つので、
// 描かないと**誰にも届かない**まま既定の字体で作り始めることになる（素材画面へ寄って初めて出る）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DraftScreen } from "./DraftScreen";
import { PrecheckScreen } from "./PrecheckScreen";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";

describe("たたき台でも知らせを描く（#952）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useExportLockStore.setState({ owner: null });
    useProjectStore.setState({
      status: "ready", scenes: [], parts: [], templates: [], assets: [], warnings: [],
      importError: null,
      exportRun: { phase: "idle", progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    } as never);
  });

  it("会社の見た目の文字の形が入らなかった知らせが出る", () => {
    useProjectStore.setState({ importError: "覚えている文字の形は、いまこのパソコンにありません。" } as never);
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/いまこのパソコンにありません/)).toBeTruthy();
  });

  // ⚠️ **立ちっぱなしにしない**＝他の画面と同じく閉じる道を付ける。
  it("「閉じる」で消える", () => {
    const clearImportError = vi.fn();
    useProjectStore.setState({ importError: "なにかの理由", clearImportError } as never);
    render(<DraftScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(clearImportError).toHaveBeenCalled();
  });

  // ⚠️ **場面があるときの枝でも描く**＝この画面は場面ゼロと有りで `return` が分かれている。
  // 片方だけに置くと、もう片方で黙る（最初は場面ゼロの枝に入れ忘れて捕まった）。
  it("場面があるときも出る（枝が2つあるので両方見る）", () => {
    useProjectStore.setState({
      importError: "なにかの理由",
      scenes: [{ sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "t", durationSec: 5, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {}, narration: { text: "", status: "none" }, warnings: [] }],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    } as never);
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("なにかの理由")).toBeTruthy();
  });

  it("知らせが無いときは出さない", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/なにかの理由/)).toBeNull();
  });

  // ⚠️ **同じ型は同じ所で留める**（PR #953 レビュー）＝公開前チェックも場面ゼロと場面ありで
  // `return` が分かれており、声の一括生成に失敗した理由が**場面ゼロのときだけ消えて**いた。
  describe("公開前チェックも枝の両方で知らせを描く", () => {
    it("場面ゼロでも声の失敗の理由が出る", () => {
      useProjectStore.setState({ scenes: [], parts: [], narrationError: "声を作れませんでした。" } as never);
      render(<PrecheckScreen onNavigate={vi.fn()} />);
      expect(screen.getByText("声を作れませんでした。")).toBeTruthy();
    });

    it("場面があるときも出る", () => {
      useProjectStore.setState({
        narrationError: "声を作れませんでした。",
        scenes: [{ sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "t", durationSec: 5, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {}, narration: { text: "", status: "none" }, warnings: [] }],
        parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      } as never);
      render(<PrecheckScreen onNavigate={vi.fn()} />);
      expect(screen.getByText("声を作れませんでした。")).toBeTruthy();
    });
  });
});
