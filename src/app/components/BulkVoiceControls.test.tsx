// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BulkVoiceControls } from "./BulkVoiceControls";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";

// #547 P2-6：たたき台・場面編集・公開前チェックが同じ操作を共有することの検証。
// 「進捗が出る」「作成中だけ中止が出る」「中止後は分数が残る」「やることが無ければ押せない＋理由」を固定する。
const scene = (id: string, order: number, status: Scene["narration"]["status"]): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: `セリフ${order}`, status }, warnings: [],
});

beforeEach(() => {
  useProjectStore.setState({
    scenes: [scene("scene_001", 1, "generated"), scene("scene_002", 2, "none")],
    isGeneratingNarration: false,
    narrationCancelled: false,
    exportRun: { ...useProjectStore.getState().exportRun, phase: "idle" },
  });
});

describe("BulkVoiceControls（#547 P2-6）", () => {
  it("未作成があると進捗と作成ボタンを出す（中止は出さない）", () => {
    render(<BulkVoiceControls />);
    expect(screen.getByText("声 1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "中止する" })).toBeNull();
  });

  it("作成中は「作成中…」＋中止ボタンを出し、押せない理由として止め方を示す", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceControls />);
    expect(screen.getByText("声 1/2（作成中…）")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "作成中…" });
    expect(btn).toBeDisabled();
    // 押せない理由が「次の行動」（中止する）を指す（§2-5）。
    expect(btn).toHaveAttribute("title", expect.stringContaining("中止する"));
    expect(screen.getByRole("button", { name: "中止する" })).toBeEnabled();
  });

  it("書き出し中は、作成中よりも書き出しの理由を優先して出す（重ねて出さない）", () => {
    useProjectStore.setState({
      isGeneratingNarration: true,
      exportRun: { ...useProjectStore.getState().exportRun, phase: "rendering" },
    });
    render(<BulkVoiceControls />);
    const title = screen.getByRole("button", { name: "作成中…" }).getAttribute("title") ?? "";
    expect(title).toContain("書き出し中");
    expect(title).not.toContain("中止する");
  });

  it("中止を押すと store の中止を呼ぶ", () => {
    const cancel = vi.fn();
    useProjectStore.setState({ isGeneratingNarration: true, cancelNarrationGeneration: cancel });
    render(<BulkVoiceControls />);
    fireEvent.click(screen.getByRole("button", { name: "中止する" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("中止後は分数を残したまま「中止しました」＝作った声が消えていないと分かる", () => {
    useProjectStore.setState({ isGeneratingNarration: false, narrationCancelled: true });
    render(<BulkVoiceControls />);
    expect(screen.getByText("声 1/2（中止しました）")).toBeInTheDocument();
    // 次の行動（作り直す）は隣のボタンがそのまま担う。
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeEnabled();
  });

  it("全部作成済みなら進捗は出さず、ボタンは押せない＋理由を出す（押しても何も起きない、を作らない）", () => {
    useProjectStore.setState({ scenes: [scene("scene_001", 1, "generated")] });
    render(<BulkVoiceControls />);
    expect(screen.queryByText(/^声 /)).toBeNull();
    const btn = screen.getByRole("button", { name: "全場面の声を作成" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("すべての場面の声が作成済み"));
  });

  it("hideWhenNothingToDo なら、やることが無いとき操作ごと出さない（たたき台の専用行）", () => {
    useProjectStore.setState({ scenes: [scene("scene_001", 1, "generated")] });
    render(<BulkVoiceControls hideWhenNothingToDo />);
    expect(screen.queryByRole("button", { name: "全場面の声を作成" })).toBeNull();
  });

  it("rowClassName の行は、隠れるときに空の行として残らない（余白だけの行を作らない）", () => {
    useProjectStore.setState({ scenes: [scene("scene_001", 1, "generated")] });
    const { container, rerender } = render(<BulkVoiceControls rowClassName="row-between mb" hideWhenNothingToDo />);
    expect(container.querySelector(".row-between")).toBeNull();
    // 作る声が戻れば行も戻る。
    useProjectStore.setState({ scenes: [scene("scene_001", 1, "none")] });
    rerender(<BulkVoiceControls rowClassName="row-between mb" hideWhenNothingToDo />);
    expect(container.querySelector(".row-between")).not.toBeNull();
  });

  it("書き出し中は押せず、理由を出す", () => {
    useProjectStore.setState({ exportRun: { ...useProjectStore.getState().exportRun, phase: "rendering" } });
    render(<BulkVoiceControls />);
    const btn = screen.getByRole("button", { name: "全場面の声を作成" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("書き出し中"));
  });

  it("セリフが1つも無いときは「作成済み」と言わず、セリフを入れるよう促す", () => {
    useProjectStore.setState({ scenes: [{ ...scene("scene_001", 1, "none"), narration: { text: "", status: "none" } } as Scene] });
    render(<BulkVoiceControls />);
    const btn = screen.getByRole("button", { name: "全場面の声を作成" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("まだセリフがありません"));
    expect(btn.getAttribute("title")).not.toContain("作成済み"); // 作った覚えのない声があることにしない
  });

  it("画面ごとのボタン文言を差し替えられる（公開前チェックは「声を作成」）", () => {
    render(<BulkVoiceControls label="声を作成" />);
    expect(screen.getByRole("button", { name: "声を作成" })).toBeInTheDocument();
  });
});
