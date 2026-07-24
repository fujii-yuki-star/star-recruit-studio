// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// #547 P3-11：書き出しの実行状態は画面横断で保持する（#379＝書き出し中に他画面へ移っても進捗が見える）。
// その副作用で、書き出しが終わったあとに画面を離れて戻ると「100%・保存しました」「失敗しました」が
// **いま起きたこと**のように残り続ける＝そのあとに直した内容まで書き出し済みに見える（ADR-0026④）。
// 「前回の結果」だと分かる出し方に変え、保存したファイルへの導線（#404）は消さないことを固定する。
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

describe("ExportScreen 前回の書き出しの結果（#547 P3-11）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      saveStatus: "saved",
    });
  });

  it("完了のまま入り直すと「前回の…」と分かる形にし、100%の進捗は再現しない", () => {
    useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:\\動画\\会社紹介.mp4" });
    const { container, getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/前回の書き出しは完了しています/)).toBeInTheDocument();
    // 進捗パネル（バー・見出し）は今回の書き出しのもの＝前回の完了では出さない。
    expect(container.querySelector(".progress")).toBeNull();
    expect(container.textContent).not.toContain("保存しました");
  });

  it("前回の結果でも保存先と「保存した場所を開く」は残す（#404 の導線を消さない）", () => {
    useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:\\動画\\会社紹介.mp4" });
    const { getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/保存先：C:\\動画\\会社紹介\.mp4/)).toBeInTheDocument();
    expect(getByText("保存した場所を開く")).toBeInTheDocument();
    expect(getByText("動画を再生")).toBeInTheDocument();
  });

  it("BGMが欠けた案内は前回の結果でも残す（保存したファイルの中身の話だから）", () => {
    useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:\\動画\\a.mp4", bgmWarning: "all" });
    const { getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/BGMなしで保存しました/)).toBeInTheDocument();
  });

  it("この訪問で完了したときは「前回の…」と言わず、進捗（100%・保存しました）を出す", () => {
    // 書き出し中に開いた画面で、そのまま完了を迎えた場合＝いま起きたこと。
    useProjectStore.getState().setExportRun({ phase: "rendering", progress: { done: 1, total: 2 } });
    const { container, queryByText, getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    act(() => {
      useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:\\動画\\a.mp4" });
    });
    expect(queryByText(/前回の書き出し/)).toBeNull();
    expect(container.querySelector(".progress")).not.toBeNull();
    expect(getByText("保存しました")).toBeInTheDocument();
  });

  it("失敗のまま入り直すと、原因と次の行動は残しつつ前回のことだと示す（読み上げも割り込ませない）", () => {
    useProjectStore.getState().setExportRun({ phase: "error", message: "保存先を選べませんでした。もう一度お試しください。" });
    const { container, getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/前回の書き出しは失敗しました/)).toBeInTheDocument();
    expect(getByText("保存先を選べませんでした。もう一度お試しください。")).toBeInTheDocument();
    // 入り直すたびに「たったいま失敗した」と再通知しない（alert では出さない）。
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("中止のまま入り直すと、中止の案内は1つだけ（同じことを二重に出さない）", () => {
    useProjectStore.getState().setExportRun({ phase: "cancelled" });
    const { getAllByText, getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/前回の書き出しは中止しました/)).toBeInTheDocument();
    expect(getAllByText(/中止しました/)).toHaveLength(1);
  });

  it("この端末で書き出せない（unsupported）は今の事情＝前回の結果として出さない", () => {
    useProjectStore.getState().setExportRun({ phase: "unsupported" });
    const { container, getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(/デスクトップアプリでご利用いただけます/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("前回の書き出し");
    // 空の枠だけが出ることもない（文言が空のまま案内の箱を描かない）。
    const notices = Array.from(container.querySelectorAll(".notice"));
    expect(notices.every((n) => (n.textContent ?? "").trim() !== "")).toBe(true);
  });

  it("完了を見ている画面で書き出し中に切り替わったら、前回の表示は消える", () => {
    useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:\\動画\\a.mp4" });
    const { container, queryByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(queryByText(/前回の書き出し/)).not.toBeNull();
    act(() => {
      useProjectStore.getState().setExportRun({ phase: "rendering", progress: { done: 0, total: 2 } });
    });
    expect(queryByText(/前回の書き出し/)).toBeNull();
    expect(container.textContent).toContain("動画を書き出しています");
  });
});
