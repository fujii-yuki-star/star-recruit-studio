// @vitest-environment jsdom
// タイムライン編集の**自動保存の結果を伝える**ところ（#693）。共通トップバーの保存ボタンは出さない決定
// （ADR-0032）なので、失敗を伝える担い手はこの画面しかいない。黙って落とすと「閉じても消えない」
// （`06 §12.1`）が破れる（ADR-0026④）。
//
// **別ファイルにしてある**＝保存は画面の寿命（アンマウント）と時間（自動保存の待ち）に関わるので、
// 同じファイルに 100 件の他のテストがあると、前のテストが張ったタイマや走りかけの保存に結果が左右される。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as fsMod from "../../infrastructure/projectFs";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

function doc(): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260728_001",
    projectName: "焼いた動画",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
    ],
  };
}

const open = () =>
  useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  useProjectStore.setState({ templates: [] });
  localStorage.clear();
  // 自動保存が**本物の書き込み**（Tauri）へ落ちないようにする＝解決しない約束を残さない。
  //
  // ⚠️ **store のメソッドそのものは差し替えない**（`vi.spyOn(useTimelineStore.getState(), ...)`）。
  // zustand は `set` のたびに新しい state オブジェクトを作り、そのとき差し替え済みの関数も一緒に複製されるので、
  // `vi.restoreAllMocks()` が元へ戻すのは**差し替えた当時のオブジェクトだけ**＝いまの state には偽物が残り、
  // 後のテストが「呼んだのに何も起きない」状態になる。見張りは常に**この層（ディスクへの書き込み）**に置く。
  vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
});

// タイムライン編集は自動保存で、共通トップバーの保存ボタンは出さない（ADR-0032）＝失敗を伝える担い手は
// この画面しかいない。黙って落とすと「閉じても消えない」（`06 §12.1`）が破れる（#693・ADR-0026④）。
describe("TimelineProjectScreen: 自動保存の結果を伝える（#693）", () => {
  it("保存できなかったら理由と次の行動を出す（黙って落とさない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const alerts = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(alerts.some((t) => t?.includes("変更を保存できませんでした"))).toBe(true);
    expect(screen.getByRole("button", { name: "保存し直す" })).toBeInTheDocument();
  });

  it("「保存し直す」でもう一度保存する（再試行の導線）", async () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    const write = vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存し直す" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
  });

  it("保存できたことも控えめに出す（勝手に保存されているのを信じられるようにする）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("保存しました");
  });

  it("保存できていないまま一覧へ戻ろうとしたら聞く（黙って編集を捨てない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("動画の一覧へ"));
    expect(onNavigate).not.toHaveBeenCalled(); // 押しただけでは戻らない
    expect(screen.getByText(/このまま一覧へ戻ると、その変更は失われます/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(onNavigate).not.toHaveBeenCalled(); // 「やめる」なら残る＝保存し直しに戻れる
    fireEvent.click(screen.getByText("動画の一覧へ"));
    fireEvent.click(screen.getByRole("button", { name: "保存しないで戻る" }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("画面を離れるときは、待っている保存を書き切る（無言で消さない）", async () => {
    open();
    // 見張りは**実際にディスクへ書いたか**に置く（store のメソッドを差し替えて数えるより、確かめたい事実に近い）。
    const write = vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
    const view = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 前のテストが始めた保存が走っていると、それが終わるまで二重には書かない（正しい挙動）。
    // ここで見たいのは「離れるときに書き切るか」なので、走っていない状態にしてから未保存にする。
    await waitFor(() => expect(useTimelineStore.getState().saveStatus).not.toBe("saving"));
    act(() => useTimelineStore.setState({ saveStatus: "idle" }));
    write.mockClear(); // 自動保存の待ち時間（800ms）はまだ来ていない
    view.unmount();
    await waitFor(() => expect(write).toHaveBeenCalled());
  });

  it("保存済みで離れるときは書き直さない（同じ内容を無駄に書かない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const write = vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
    const view = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    write.mockClear();
    view.unmount();
    expect(write).not.toHaveBeenCalled();
  });

  it("確認を出したまま保存できたら、確認は消える（事実と食い違う文を残さない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画の一覧へ"));
    expect(screen.getByText(/このまま一覧へ戻ると、その変更は失われます/)).toBeInTheDocument();
    act(() => useTimelineStore.setState({ saveStatus: "saved" }));
    expect(screen.queryByText(/このまま一覧へ戻ると、その変更は失われます/)).not.toBeInTheDocument();
  });

  it("書いている途中に戻ろうとしたら、書き終わるまで待つ（あとで失敗しても気づけない、を作らない）", async () => {
    open();
    let release!: () => void;
    let calls = 0;
    vi.spyOn(fsMod, "saveProjectDoc").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? new Promise<string>((r) => { release = () => r("x"); }) : Promise.resolve("x");
    });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { void useTimelineStore.getState().saveTimelineProject(); }); // 書き込み中にする
    expect(useTimelineStore.getState().saveStatus).toBe("saving");
    fireEvent.click(screen.getByRole("button", { name: /動画の一覧へ/ }));
    expect(onNavigate).not.toHaveBeenCalled(); // 書き終わるまで離れない
    // 実行中はラベルを変えて押せなくする（`06 §2` 統一規約4）。
    await waitFor(() => expect(screen.getByRole("button", { name: /保存しています/ })).toBeDisabled());
    await act(async () => { release(); });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("home"));
  });

  it("書いている途中に戻ろうとして失敗したら、離れずに聞く（気づけないまま消さない）", async () => {
    open();
    vi.spyOn(fsMod, "saveProjectDoc").mockRejectedValue(new Error("disk full"));
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { useTimelineStore.setState({ saveStatus: "idle" }); });
    fireEvent.click(screen.getByRole("button", { name: /動画の一覧へ/ }));
    await waitFor(() => expect(screen.getByText(/このまま一覧へ戻ると、その変更は失われます/)).toBeInTheDocument());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("保存できているときは聞かずに戻る（毎回の確認で邪魔しない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("動画の一覧へ"));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});
