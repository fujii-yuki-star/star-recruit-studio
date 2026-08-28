// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

// #392：プロジェクトを開く最中は「開いています…」＋カード無効にし、連打・別プロジェクト並走で
// loadProject が後勝ちするのを防ぐ。開始中を pending 固定して観測する。
describe("HomeScreen プロジェクトを開く busy（#392）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("開いている間は「開いています…」＋カード無効（後勝ち防止）", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(() =>
        Promise.resolve([{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }] as unknown as ProjectHeader[]),
      ),
      loadProject: vi.fn(() => new Promise<void>(() => {})), // 永久 pending＝開いている最中を保つ
    });
    render(<HomeScreen onNavigate={vi.fn()} />);
    const card = (await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement;
    fireEvent.click(card);
    expect(await screen.findByText("開いています…")).toBeTruthy();
    expect((screen.getByText("テスト動画").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

// #570 レビュー：書き出し中は「開いているプロジェクトの改名」が project.json の保存と競合する（lost-update）。
// store も no-op で守るが、鉛筆（名前を変更）を無効化して「押せるのに効かない」を避ける（ADR-0026④）。
describe("HomeScreen 書き出し中は改名を無効化（#570 レビュー）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({ exportRun: { phase: "idle", progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false } });
  });

  it("書き出し中：鉛筆（名前を変更）ボタンを無効化する", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(() =>
        Promise.resolve([{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }] as unknown as ProjectHeader[]),
      ),
      exportRun: { phase: "rendering", progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    });
    render(<HomeScreen onNavigate={vi.fn()} />);
    const pencil = (await screen.findByLabelText("「テスト動画」の名前を変更")) as HTMLButtonElement;
    expect(pencil.disabled).toBe(true); // 書き出し中は改名を開始できない（lost-update 防止の UI 側）
  });
});

// #547 P2-1：ここは独自 notice（進捗なし・戻る導線なし）だった。書き出し中に「新しい動画づくり」を試す
// ＝二重書き出しの引き金が最も出やすい画面なので、進捗と復帰導線を他画面と同じバナーで出す（ADR-0026②）。
describe("HomeScreen 書き出し中は共通バナーで進捗と復帰導線を出す（#547 P2-1）", () => {
  afterEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    vi.restoreAllMocks();
  });

  it("進捗・この画面でできなくなること・書き出しへ戻る導線をまとめて出す", () => {
    useProjectStore.setState({
      listProjects: vi.fn(() => Promise.resolve([] as unknown as ProjectHeader[])),
      exportRun: { phase: "rendering", progress: { done: 1, total: 4 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    });
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);

    const note = screen.getByRole("status");
    expect(note.textContent).toContain("20%"); // 1/4 の 80% 換算＝他画面と同じ数字
    expect(note.textContent).toContain("切り替え・削除はできません"); // この画面固有の補足
    fireEvent.click(screen.getByText("書き出しへ戻る"));
    expect(onNavigate).toHaveBeenCalledWith("export");
  });
});
