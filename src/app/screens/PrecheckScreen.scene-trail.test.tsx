// @vitest-environment jsdom
// 公開前チェック →「直す」→ 場面編集 → 公開前チェックへ戻る（UI/UX 監査 2026-10-02）。
// 以前は戻るが常に「台本表へ戻る」で、ひっかかった場面が複数あっても最初の1場面しか開かなかった。
//
// ⚠️ **公開前チェックと場面編集を続けて動かす**＝片方だけだと「並びは預けたが受け手が読まない」が緑のまま通る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Scene } from "../../domain/project/types";
import { useProjectStore } from "../store/projectStore";
import { PrecheckScreen } from "./PrecheckScreen";
import { SceneEditScreen } from "./SceneEditScreen";
import { DraftScreen } from "./DraftScreen";
import { BACK_TO_PRECHECK_LABEL, TRAIL_NEXT_LABEL, TRAIL_PREV_LABEL } from "../uiLabels";

const scene = (sceneId: string, order: number, text: string, templateId = "photo_left_text_right_yuko_v1"): Scene =>
  ({
    sceneId, partId: "part_001", order, sceneType: "photo_intro",
    templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text, status: "generated" }, warnings: [],
  }) as Scene;

beforeEach(() => {
  cleanup();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    status: "ready",
    // 見た目が見つからない場面を **2番目と4番目**に置く＝先頭から順に並べただけでは位置が合わない。
    scenes: [scene("scene_001", 1, "FIRST"), scene("scene_002", 2, "SECOND", "missing_template"), scene("scene_003", 3, "THIRD"), scene("scene_004", 4, "FOURTH", "missing_template")],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003", "scene_004"] }],
    sceneEditTrail: null, past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
});

const openFromPrecheck = (): void => {
  render(<PrecheckScreen onNavigate={vi.fn()} />);
  const row = screen.getByText("場面の見た目").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "直す" }));
  cleanup();
};

describe("公開前チェックから来た場面編集（UI/UX 監査 2026-10-02）", () => {
  it("ひっかかった場面の並びを預け、場面編集は最初の場面を開いて「n/全体」を出す", () => {
    openFromPrecheck();
    expect(useProjectStore.getState().sceneEditTrail?.sceneIds).toEqual(["scene_002", "scene_004"]);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const bar = screen.getByTestId("scene-edit-trail");
    expect(bar).toHaveTextContent("1/2 場面目");
    expect(screen.getByDisplayValue("SECOND")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: TRAIL_PREV_LABEL })).toBeDisabled();
  });

  it("「次の場面」で並びの次（間の場面は飛ばす）へ、端では押せない・「前の場面」で戻る", () => {
    openFromPrecheck();
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const bar = screen.getByTestId("scene-edit-trail");
    fireEvent.click(within(bar).getByRole("button", { name: TRAIL_NEXT_LABEL }));
    expect(screen.getByDisplayValue("FOURTH")).toBeInTheDocument(); // THIRD ではない
    expect(bar).toHaveTextContent("2/2 場面目");
    expect(within(bar).getByRole("button", { name: TRAIL_NEXT_LABEL })).toBeDisabled();
    fireEvent.click(within(bar).getByRole("button", { name: TRAIL_PREV_LABEL }));
    expect(screen.getByDisplayValue("SECOND")).toBeInTheDocument();
  });

  it("戻るは「公開前チェックへ戻る」で公開前チェックへ行く", () => {
    openFromPrecheck();
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: BACK_TO_PRECHECK_LABEL }));
    expect(onNavigate).toHaveBeenCalledWith("precheck");
    expect(screen.queryByRole("button", { name: /台本表へ戻る/ })).toBeNull();
  });

  it("仕上がり確認を挟んでも並びは残る（戻ると同じ帯と戻る先）", () => {
    openFromPrecheck();
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    fireEvent.click(within(screen.getByTestId("scene-edit-trail")).getByRole("button", { name: TRAIL_NEXT_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /仕上がり確認へ/ }));
    expect(onNavigate).toHaveBeenCalledWith("preview");
    cleanup();
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId("scene-edit-trail")).toHaveTextContent("2/2 場面目");
    expect(screen.getByRole("button", { name: BACK_TO_PRECHECK_LABEL })).toBeInTheDocument();
  });

  it("並びが無ければ（ほかの入口）「台本表へ戻る」で、帯も出ない", () => {
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    expect(screen.queryByTestId("scene-edit-trail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /台本表へ戻る/ }));
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("ひっかかった場面が1つなら帯は出さない（戻る先は公開前チェック）", () => {
    useProjectStore.setState((st) => ({ scenes: st.scenes.map((s) => (s.sceneId === "scene_004" ? { ...s, templateId: "photo_left_text_right_yuko_v1" } : s)) }));
    openFromPrecheck();
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("scene-edit-trail")).toBeNull();
    expect(screen.getByRole("button", { name: BACK_TO_PRECHECK_LABEL })).toBeInTheDocument();
  });

  it("帯の場面を消したら、残りだけで数える（2つが1つになれば帯を下ろす）", () => {
    openFromPrecheck();
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId("scene-edit-trail")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("scene-edit-trail")).getByRole("button", { name: TRAIL_NEXT_LABEL }));
    // 外から消す（画面の削除操作の確認ダイアログは別の検査が見ている）。
    act(() => useProjectStore.getState().removeScene("scene_004"));
    expect(screen.queryByTestId("scene-edit-trail")).toBeNull();
  });
});

describe("上の帯の主ボタンは1つ（UI/UX 監査 2026-10-02）", () => {
  it("場面編集の保存は控えめ・「仕上がり確認へ」だけが主", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /保存/ })).toHaveClass("btn-secondary");
    expect(screen.getByRole("button", { name: /仕上がり確認へ/ })).toHaveClass("btn-primary");
  });

  it("台本表の「AI が作りました」の案内はお知らせの色（警告の色にしない）", () => {
    useProjectStore.setState({ draftFromAi: true });
    render(<DraftScreen onNavigate={vi.fn()} />);
    const notice = screen.queryByTestId("draft-ai-notice");
    expect(notice).not.toBeNull();
    expect(notice).toHaveClass("notice-info");
    expect(notice).not.toHaveClass("notice-warn");
  });
});
