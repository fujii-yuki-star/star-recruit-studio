// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftScreen } from "./DraftScreen";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";

// #413：たたき台は音声状態バッジを見せるのに「声を作る手段」が無かった。全場面の一括作成ボタンと、
// 完了通知（全部できた→仕上がり確認へ／一部失敗→作り直しの導線）を固定する。生成本体（VOICEVOX）は
// 既存 action generateAllNarrations を差し替えてシミュレートする（本テストはUIの導線のみを検証）。
const needVoiceScene = (id: string, order: number): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "opening", templateId: "tpl",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", voiceId: null, status: "none" }, warnings: [],
  }) as unknown as Scene;

const setScenes = (scenes: Scene[]) => useProjectStore.setState({ scenes });
const markGenerated = (scenes: Scene[], indices: number[]): Scene[] =>
  scenes.map((s, i) =>
    indices.includes(i) ? ({ ...s, narration: { ...s.narration, status: "generated" } } as Scene) : s,
  );

describe("DraftScreen 全場面の声を作成＋完了通知（#413）", () => {
  let originalGenAll: () => Promise<void>;
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    originalGenAll = useProjectStore.getState().generateAllNarrations;
    setScenes([needVoiceScene("scene_001", 1), needVoiceScene("scene_002", 2)]);
    useProjectStore.setState({ status: "ready", warnings: [] });
  });
  afterEach(() => {
    useProjectStore.setState({ generateAllNarrations: originalGenAll }); // 差し替えた action を元に戻す
    vi.clearAllMocks();
  });

  it("声が未作成の場面があると「全場面の声を作成」ボタンが出て、押すと既存 action を呼ぶ", async () => {
    const genAll = vi.fn(async () => setScenes(markGenerated(useProjectStore.getState().scenes, [0, 1])));
    useProjectStore.setState({ generateAllNarrations: genAll });
    render(<DraftScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "全場面の声を作成" }));
    await waitFor(() => expect(genAll).toHaveBeenCalled());
  });

  it("全部できたら『全場面の声ができました』＋『仕上がり確認へ』を出し、押すと preview へ（previewReturnTo=draft）", async () => {
    useProjectStore.setState({
      generateAllNarrations: vi.fn(async () => setScenes(markGenerated(useProjectStore.getState().scenes, [0, 1]))),
    });
    const onNavigate = vi.fn();
    render(<DraftScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "全場面の声を作成" }));
    await screen.findByText(/全場面の声ができました/);
    // 全部できたら一括作成ボタン自体は消える（やることが無いので出しっぱなしにしない）。
    expect(screen.queryByRole("button", { name: "全場面の声を作成" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /仕上がり確認へ/ }));
    expect(onNavigate).toHaveBeenCalledWith("preview");
    expect(useProjectStore.getState().previewReturnTo).toBe("draft");
  });

  it("一部作れなかったら理由＋作り直しの導線を出す（『仕上がり確認へ』は出さない）", async () => {
    // 1件だけ generated にして残り1件は none のまま＝remaining>0。
    useProjectStore.setState({
      generateAllNarrations: vi.fn(async () => setScenes(markGenerated(useProjectStore.getState().scenes, [0]))),
    });
    render(<DraftScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "全場面の声を作成" }));
    await screen.findByText(/うまく作れませんでした/);
    expect(screen.queryByText(/全場面の声ができました/)).toBeNull();
  });
});

// #547 P2-6：たたき台にも他画面と同じ進捗・中止を出す（共通操作への差し替えの回帰保護）。
// 上の #413 のテストはボタン文言と完了通知しか見ておらず、進捗・中止・「中止なら通知を出さない」分岐は素通りする。
describe("DraftScreen 声の作成の進捗と中止（#547 P2-6）", () => {
  let originalGenAll: () => Promise<void>;
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    originalGenAll = useProjectStore.getState().generateAllNarrations;
    setScenes([needVoiceScene("scene_001", 1), needVoiceScene("scene_002", 2)]);
    useProjectStore.setState({ status: "ready", warnings: [], isGeneratingNarration: false, narrationCancelled: false });
  });
  afterEach(() => {
    useProjectStore.setState({ generateAllNarrations: originalGenAll });
    vi.clearAllMocks();
  });

  it("未作成があると他画面と同じ「声 0/2」の進捗を出す", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 0/2")).toBeInTheDocument();
  });

  it("作成中は進捗が「作成中…」になり、止める手段（中止する）が出る", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("声 0/2（作成中…）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中止する" })).toBeEnabled();
  });

  it("中止したときは完了通知を出さない（残件は進捗が示す）", async () => {
    // 1件だけ作った時点で中止された状況を、action の差し替えで再現する。
    useProjectStore.setState({
      generateAllNarrations: vi.fn(async () => {
        setScenes(markGenerated(useProjectStore.getState().scenes, [0]));
        useProjectStore.setState({ narrationCancelled: true });
      }),
    });
    render(<DraftScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "全場面の声を作成" }));
    await screen.findByText("声 1/2（中止しました）");
    // 「うまく作れませんでした」は失敗の案内＝中止では出さない（止めたのは利用者）。
    expect(screen.queryByText(/うまく作れませんでした/)).toBeNull();
    expect(screen.queryByText(/全場面の声ができました/)).toBeNull();
  });

  it("全部作成済みなら操作ごと出さない（専用の行に空の余白を残さない）", () => {
    setScenes(markGenerated(useProjectStore.getState().scenes, [0, 1]));
    const { container } = render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "全場面の声を作成" })).toBeNull();
    expect(screen.queryByText(/^声 /)).toBeNull();
    expect([...container.querySelectorAll(".row-between")].some((el) => el.textContent === "")).toBe(false);
  });
});
