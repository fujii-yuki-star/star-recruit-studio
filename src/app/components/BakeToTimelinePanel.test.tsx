// @vitest-environment jsdom
// 焼き出しの導線（ADR-0032 決定16/17・#628）。押した瞬間に作らない／範囲を変えたら確認をやり直す、を固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BakeError } from "../../domain/timeline/bake";
import { BakeToTimelinePanel } from "./BakeToTimelinePanel";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { canNavigate } from "../hooks/navigationGuard";
import { BAKE_LEAVE_BLOCKED_MESSAGE } from "../uiLabels";
import type { Scene } from "../../domain/project/types";

function scene(id: string, partId = "part_001"): Scene {
  return {
    sceneId: id,
    partId,
    order: 1,
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

const estimateBake = vi.fn();
const bakeToTimeline = vi.fn();

beforeEach(() => {
  estimateBake.mockReset().mockResolvedValue({ bytes: 12 * 1024 * 1024, notes: [] });
  bakeToTimeline.mockReset().mockResolvedValue({ projectId: "proj_20260728_001", notes: [] });
  useProjectStore.setState({
    meta: { ...useProjectStore.getState().meta, projectName: "採用動画" },
    parts: [
      { partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] },
      { partId: "part_002", title: "パート2", order: 2, sceneIds: [] },
    ],
    scenes: [scene("scene_001"), scene("scene_002"), scene("scene_003")],
    estimateBake,
    bakeToTimeline,
  });
});

describe("BakeToTimelinePanel", () => {
  it("元の動画が残ることを、押す前に伝える（片道・決定16）", () => {
    render(<BakeToTimelinePanel />);
    expect(screen.getByText(/いまの動画はそのまま残ります/)).toBeInTheDocument();
  });

  it("いきなり作らない＝まず内容を確かめ、増える容量を見せてから作る（決定13）", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText(/約 12MB増えます/)).toBeInTheDocument());
    expect(bakeToTimeline).not.toHaveBeenCalled(); // 確認しただけでは作らない

    fireEvent.click(screen.getByText("この内容で作る"));
    await waitFor(() => expect(screen.getByText(/を作りました/)).toBeInTheDocument());
    expect(bakeToTimeline).toHaveBeenCalledWith({ kind: "whole" }, "採用動画（タイムライン）");
  });

  it("持っていけないものを、作る前に見せる（§2-5）", async () => {
    estimateBake.mockResolvedValue({ bytes: 0, notes: [{ code: "BAKE_VIDEO_START_TIMING_SKIPPED", sceneNumbers: [2] }] });
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText(/場面2：動画を再生し始めるタイミングは持っていけません/)).toBeInTheDocument());
  });

  it("範囲を変えたら確認をやり直させる（古い容量のまま作らせない）", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    expect(screen.queryByText("この内容で作る")).not.toBeInTheDocument();
    expect(screen.getByText("作る内容を確かめる")).toBeInTheDocument();
  });

  it("名前を変えても確認をやり直させる（違う名前の確認内容のまま作らせない）", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("新しい動画の名前"), { target: { value: "べつの名前" } });
    expect(screen.queryByText("この内容で作る")).not.toBeInTheDocument();
    expect(screen.getByText("作る内容を確かめる")).toBeInTheDocument();
  });

  it("パートを選ぶと、そのパートだけを作る", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(estimateBake).toHaveBeenCalledWith({ kind: "part", partId: "part_001" }));
  });

  it("場面の範囲を選ぶと、両端を含む場面だけを作る", async () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "between" } });
    fireEvent.change(screen.getByLabelText("ここから"), { target: { value: "scene_002" } });
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() =>
      expect(estimateBake).toHaveBeenCalledWith({ kind: "scenes", sceneIds: ["scene_002", "scene_003"] }),
    );
  });

  it("場面の入らない範囲では作らせない（中身の無い動画を作らない）", () => {
    render(<BakeToTimelinePanel />);
    fireEvent.change(screen.getByLabelText("どこまでを作り直しますか"), { target: { value: "part" } });
    fireEvent.change(screen.getByLabelText("パート"), { target: { value: "part_002" } }); // 空のパート
    expect(screen.getByText(/選んだ範囲に場面がありません/)).toBeInTheDocument();
    expect(screen.getByText("作る内容を確かめる")).toBeDisabled();
  });

  it("作成に失敗したら「次の行動」を出す（§2-5）", async () => {
    bakeToTimeline.mockRejectedValue(new Error("disk full"));
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());
    fireEvent.click(screen.getByText("この内容で作る"));
    await waitFor(() => expect(screen.getByText(/空き容量を確かめて、もう一度お試しください/)).toBeInTheDocument());
  });

  // ⚠️ **作れない理由は「置き場所が足りない」だけではない**（PR #820 レビュー・ℹ️）＝作った中身の
  // 問題（適合しない・id が重なる）を「空き容量を確かめて」と案内すると、言われたとおりにしても
  // 直らない（§2-5／ADR-0026④）。理由を持っている例外はその文言を出す。
  it("中身の問題で作れなかったときは、空き容量の話にしない", async () => {
    bakeToTimeline.mockRejectedValue(new BakeError("作れませんでした。元の動画の中身に問題があるようです。作る範囲を狭めるか、元の動画を直してからお試しください。"));
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    await waitFor(() => expect(screen.getByText("この内容で作る")).toBeInTheDocument());
    fireEvent.click(screen.getByText("この内容で作る"));
    await waitFor(() => expect(screen.getByText(/元の動画の中身に問題があるようです/)).toBeInTheDocument());
    expect(screen.queryByText(/空き容量/)).not.toBeInTheDocument();
  });
});

// 待ち時間と失敗の面倒（#992 ②⑤⑥）。
describe("BakeToTimelinePanel：作っている間と、作ったあと（#992）", () => {
  /** 「確かめる」→「この内容で作る」まで進める。 */
  const runBake = async (onNavigate?: (s: never) => void) => {
    render(<BakeToTimelinePanel onNavigate={onNavigate as never} />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    fireEvent.click(await screen.findByText("この内容で作る"));
  };

  // ⚠️ **作っただけで見えないと、できたかどうか分からない**（複製が同じ理屈で「作ったら開く」）。
  it("作った動画を、その場で開ける", async () => {
    const openTimelineProject = vi.fn(async () => {});
    useTimelineStore.setState({ openTimelineProject, loadError: null } as never);
    const onNavigate = vi.fn();
    await runBake(onNavigate);
    fireEvent.click(await screen.findByText("作った動画を開く"));
    await waitFor(() => expect(openTimelineProject).toHaveBeenCalledWith("proj_20260728_001"));
    expect(onNavigate).toHaveBeenCalledWith("timeline-project");
  });

  // ⚠️ **開けなかったら、そう言う**（黙って何も起きない、を作らない・§2-5）。
  it("開けなかったら理由を出し、画面は移らない", async () => {
    useTimelineStore.setState({
      openTimelineProject: vi.fn(async () => {
        useTimelineStore.setState({ loadError: "この動画の内容が正しくありません。" } as never);
      }),
      loadError: null,
    } as never);
    const onNavigate = vi.fn();
    await runBake(onNavigate);
    fireEvent.click(await screen.findByText("作った動画を開く"));
    await waitFor(() => expect(screen.getByText(/この動画の内容が正しくありません/)).toBeInTheDocument());
    expect(onNavigate, "開けていないのに画面を移した").not.toHaveBeenCalled();
  });

  // ⚠️ **行き先が無ければ押させない**＝押しても何も起きないボタンを作らない。
  it("行き先を渡していなければ「開く」を出さない", async () => {
    await runBake();
    await screen.findByText(/を作りました/);
    expect(screen.queryByText("作った動画を開く")).toBeNull();
  });

  // ⚠️ **作った先で何ができなくなるかを言う**（#992 ⑥）。
  it("作った先では AI と場面編集が使えないことを伝える", async () => {
    await runBake();
    expect(await screen.findByText(/ゆうこにたたき台を作ってもらうことと、場面ごとの編集はできません/)).toBeInTheDocument();
  });

  // ⚠️ **作っている間は離れさせない**＝離れると成否の受け皿ごと消える（#992 ②）。
  it("作っている間は画面を離れられず、理由が出る", async () => {
    let finish: (v: unknown) => void = () => {};
    bakeToTimeline.mockImplementation(() => new Promise((res) => { finish = res; }));
    render(<BakeToTimelinePanel />);
    fireEvent.click(screen.getByText("作る内容を確かめる"));
    fireEvent.click(await screen.findByText("この内容で作る"));
    await screen.findByText("作成中…");
    expect(canNavigate("home" as never), "作っている最中に離れられる").toBe(false);
    expect(await screen.findByText(BAKE_LEAVE_BLOCKED_MESSAGE)).toBeInTheDocument();
    // 終われば、また離れられる（塞ぎっぱなしにしない）。
    finish({ projectId: "proj_20260728_001", notes: [] });
    await waitFor(() => expect(canNavigate("home" as never)).toBe(true));
  });
});

