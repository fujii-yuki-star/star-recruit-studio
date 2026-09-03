// @vitest-environment jsdom
// タイムライン形式を開いているのに「先に動画を開いてください」と言わない（#991）。
//
// ⚠️ **この画面が扱うのは場面形式の素材**なので「入れる先が無い」こと自体は正しい。
// ただし文が「先に動画を開くか、新しく作ってください」＝**開いている人には嘘**に見え、
// しかも**次の行動が違う**（そちらの素材は、その編集画面から取り込む）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { MaterialsScreen } from "./MaterialsScreen";

beforeEach(() => {
  vi.restoreAllMocks();
  // 場面形式は**開いていない**（素材ゼロ・場面ゼロ）＝空状態の分岐へ入る。
  useProjectStore.setState({ assets: [], scenes: [], parts: [], templates: [] });
  useTimelineStore.setState({ doc: null });
});

describe("素材画面の空状態が、開いている形式で言い分ける（#991）", () => {
  it("どちらも開いていなければ、開くか作るよう言う", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/先に動画を開くか、新しく作ってください/)).toBeInTheDocument();
  });

  // ⚠️ **開いているのに「開いてください」と言わない**（§2-5＝次の行動が嘘になる）。
  it("タイムライン形式を開いていれば、その画面から取り込むよう言う", () => {
    useTimelineStore.setState({ doc: { projectName: "タイムラインの動画" } as never });
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/先に動画を開くか/), "開いているのに「開いてください」と言っている").toBeNull();
    expect(screen.getByText(/その編集画面から取り込んでください/)).toBeInTheDocument();
  });
});
