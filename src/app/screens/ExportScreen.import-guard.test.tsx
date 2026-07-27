// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import * as dialog from "../../infrastructure/dialog";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// #570 P1 レビュー：取り込み↔書き出しの相互排他（書き出し側）。進行中の素材/BGM 取り込みが同一パスへ上書きし、
// 書き出しが後から読む実ファイルと競合するのを防ぐため、書き出し開始時に isImporting を見て止まる。
const scene = (id: string, order: number): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
  templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "", status: "none" }, warnings: [],
});

describe("ExportScreen 取り込み中は書き出しを始めない（#570 P1・相互排他）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      isImporting: false,
      status: "ready", // 生成中でない既定（前テストの status:'generating' を持ち越さない＝相互排他テストの isolation）
      saveStatus: "saved",
    });
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true); // jsdom は Tauri 非検出＝canExport false のため真にする
  });
  afterEach(() => { vi.restoreAllMocks(); useProjectStore.setState({ isImporting: false, isTemplateMutating: false, status: "ready" }); });

  it("取り込み中に「動画を保存」を押すと理由を出して止まり、beginExport を呼ばない", async () => {
    const saveDialog = vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useProjectStore.setState({ isImporting: true }); // 取り込みが進行中
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(screen.getByText(/取り込み中/)).toBeTruthy(); // 理由（次の行動）を表示
    expect(begin).not.toHaveBeenCalled(); // 書き出しは始めない（相互排他）
    expect(saveDialog).toHaveBeenCalled(); // 保存先ダイアログの後に弾く＝#570 のチェック位置（無駄な準備をしない）
  });

  it("beginExport の途中で取り込みが始まっても捕捉して止める（post-beginExport 再チェック・残り窓）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    // beginExport を保留にして「IPC 往復中」を作る（この窓で取り込みが始まると一度きりチェックは取りこぼす）。
    let resolveBegin!: () => void;
    const begin = vi.spyOn(ffmpeg, "beginExport").mockReturnValue(new Promise<void>((r) => { resolveBegin = () => r(); }));
    // 開始時は取り込み中でない＝pre-beginExport チェックは通過する。
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(begin).toHaveBeenCalled()); // beginExport の待機に入った
    useProjectStore.setState({ isImporting: true }); // ここで取り込みが始まる（beginExport 窓）
    resolveBegin();
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error")); // 再チェックが捕捉
    expect(screen.getByText(/取り込み中/)).toBeTruthy();
  });

  it("音声生成中（pending 行）は書き出しを始めない＝無音MP4が成功扱いにならない（#570 P1 レビュー・#547 P2-6）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    // 生成中＝pending 行がある場面（掛け合い・sceneLines 正準経路）。書き出しは開始時 snap を使うので、生成完了は今のMP4に入らない。
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001", 1), narration: { text: "", status: "none" }, lines: [{ lineId: "l1", text: "A", status: "pending" }] } as unknown as Scene],
    });
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(screen.getByText(/声を作成中/)).toBeTruthy(); // 理由（次の行動）
    expect(begin).not.toHaveBeenCalled(); // 生成中は書き出しを始めない
  });

  it("動画案生成中（status='generating'）は書き出しを始めない（#570 P1 レビュー・生成中分岐）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useProjectStore.setState({ status: "generating" }); // AI 動画案を生成中
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(screen.getByText(/動画案を作成中/)).toBeTruthy(); // 理由（次の行動）
    expect(begin).not.toHaveBeenCalled(); // スナップショットも作らない（beginExport 未実行）
  });

  it("beginExport の途中で声作成が始まっても捕捉して止める（post-beginExport 再チェック・生成版・残り窓）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    let resolveBegin: () => void = () => {};
    const begin = vi.spyOn(ffmpeg, "beginExport").mockReturnValue(new Promise<void>((r) => { resolveBegin = () => r(); }));
    render(<ExportScreen onNavigate={vi.fn()} />); // 開始時は生成中でない＝pre チェック通過
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(begin).toHaveBeenCalled()); // beginExport の待機に入った
    // beginExport 窓で声作成が始まる（pending 行＝isNarrationGenerating が true に）。
    useProjectStore.setState({ scenes: [{ ...scene("scene_001", 1), narration: { text: "", status: "none" }, lines: [{ lineId: "l1", text: "A", status: "pending" }] } as unknown as Scene] });
    resolveBegin();
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error")); // 後段の再チェックが捕捉
    expect(screen.getByText(/声を作成中/)).toBeTruthy();
  });

  it("見た目パターンの変更中（isTemplateMutating）は書き出しを始めない（#570 P1 レビュー・テンプレ保存/削除の非同期境界）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useProjectStore.setState({ isTemplateMutating: true }); // 見た目の保存/削除が進行中（最初の await 前に立つ排他）
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(screen.getByText(/見た目パターンの変更中/)).toBeTruthy(); // 理由（次の行動）
    expect(begin).not.toHaveBeenCalled(); // スナップショットも作らない
  });

  it("beginExport の途中で動画案生成が始まっても捕捉して止める（post-beginExport 再チェック・status 版）", async () => {
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    let resolveBegin: () => void = () => {};
    const begin = vi.spyOn(ffmpeg, "beginExport").mockReturnValue(new Promise<void>((r) => { resolveBegin = () => r(); }));
    render(<ExportScreen onNavigate={vi.fn()} />); // 開始時は生成中でない＝pre チェック通過
    fireEvent.click(screen.getByText("動画を保存").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(begin).toHaveBeenCalled()); // beginExport の待機に入った
    useProjectStore.setState({ status: "generating" }); // beginExport 窓で動画案生成が始まる
    resolveBegin();
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error")); // 後段の再チェックが捕捉
    expect(screen.getByText(/動画案を作成中/)).toBeTruthy();
  });
});
