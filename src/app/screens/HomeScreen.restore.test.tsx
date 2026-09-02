// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import * as projectFs from "../../infrastructure/projectFs";

import type { ProjectHeader } from "../../domain/project/persistence";
import type { Scene } from "../../domain/project/types";
import { canNavigate } from "../hooks/navigationGuard";
import type { ScreenId } from "../data/mockData";
import { HomeScreen } from "./HomeScreen";

// #263 段階2：前の状態に戻す。
// ⚠️ **戻したら開き直す**＝画面が持っている内容は戻す前のものなので、開き直さないと
// 次の保存で戻したはずのファイルを上書きする。
const ONE = [{ projectId: "p_001", projectName: "テスト動画", updatedAt: "2026-09-01T00:00:00Z" }];
const TIMELINE_ONE = [
  { projectId: "p_002", projectName: "タイムライン動画", updatedAt: "2026-09-01T00:00:00Z", format: "timeline" },
];

const point = (savedAt: number) => ({ name: `p-${savedAt}.json`, savedAt });

describe("前の状態に戻す（#263 段階2）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      scenes: [], assets: [], saveStatus: "saved",
      listProjects: vi.fn(async () => ONE as unknown as ProjectHeader[]),
      loadProject: vi.fn(async () => {}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const openPanel = async () => {
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("「テスト動画」を前の状態に戻す"));
  };

  it("時点を新しい順に見せる（どこまで戻るか分からないまま押させない）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(1_000_000), point(3_000_000), point(2_000_000)]);
    await openPanel();
    const buttons = await screen.findAllByText("ここへ戻す");
    expect(buttons).toHaveLength(3);
    expect(document.body.textContent).toMatch(/戻す前の状態も残る/);
  });

  it("まだ無いときは、その旨と増え方を言う（押せるのに何も無い、を説明する）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    await openPanel();
    await waitFor(() => expect(document.body.textContent).toMatch(/まだ戻れる時点がありません/));
    expect(screen.queryByText("ここへ戻す")).toBeNull();
  });

  it("押すと戻してから開き直す", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    const restore = vi.fn(async () => 0);
    const load = vi.fn(async () => {});
    useProjectStore.setState({ loadProject: load, restoreToRestorePoint: restore });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("p_001", "p-3000000.json"));
    await waitFor(() => expect(load).toHaveBeenCalledWith("p_001"));
  });

  // #967 レビュー 🟡2：音のファイルは戻らないので、セリフが変わっていた読み上げは作成前に戻す。
  // ⚠️ **黙って消したように見せない**＝何も言わないと、利用者は声が消えたように見える。
  // ⚠️ **開き直す前に出す**（α-7 出口監査 🔴）＝開くとこの画面が消えるので、
  // 後に置いた知らせは**一度も描かれない**。押してもらってから開く。
  it("作り直しが要る読み上げがあれば、開く前に知らせて、押してから開く", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    const load = vi.fn(async () => {});
    useProjectStore.setState({ restoreToRestorePoint: vi.fn(async () => 2), loadProject: load });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await waitFor(() => expect(document.body.textContent).toMatch(/2件の読み上げは、音が前のままになるので作成前に戻しました/));
    expect(document.body.textContent).toMatch(/開き直して、その場面の声の欄からもう一度作ってください/);
    // ⚠️ **まだ開いていない**＝知らせを見る前に画面が変わらない。
    expect(load).not.toHaveBeenCalled();
    // ⚠️ **知らせに答えるまで、別の操作へ抜けられない**（α-7 出口監査 🟡）＝
    // 抜けられると**この画面が消えて**、知らせを一度も見ないまま次へ進める。
    expect((screen.getByText("白紙から作る").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("動画を開く"));
    await waitFor(() => expect(load).toHaveBeenCalledWith("p_001"));
  });

  // ⚠️ **戻している間は一覧を押せない**（α-7 再監査 🟡）＝戻す操作は走っている保存の着地を待つので
  // 数秒かかりうる。その間に別の動画を押せると、開いた直後に戻した動画が開き直され、
  // **開いたばかりの動画が黙ってすり替わる**。
  it("戻している間は、一覧のほかの動画を押せない", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    let finish: (() => void) | null = null;
    useProjectStore.setState({
      restoreToRestorePoint: vi.fn(() => new Promise<number>((resolve) => { finish = () => resolve(0); })),
      loadProject: vi.fn(async () => {}),
    });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await waitFor(() => expect(finish).not.toBeNull());
    // ⚠️ **実在するボタンで見る**＝当てが外れると `for` が0回まわって**空振り**になる
    //（最初「べつの動画」で書いて、そのまま緑だった）。
    const card = screen.getAllByRole("button").find((b) => b.textContent?.includes("テスト動画"));
    expect(card, "一覧のカードが見つからない").toBeDefined();
    expect(card).toBeDisabled();
    // ⚠️ **押せない理由も出す**（#976 レビュー）＝理由の出ない無効化は「壊れている」に見える。
    expect(card).toHaveAttribute("title", "前の状態に戻しています…");
    // ⚠️ **後始末まで見届ける**＝ここで放置すると、次のテストの最中に着地して状態を書き換える。
    finish!();
    await waitFor(() => expect(screen.queryByText("ここへ戻す")).toBeNull());
  });

  // ⚠️ **サイドバーからも抜けさせない**（#971 レビュー 🟡）＝ボタンを押せなくするだけでは、
  // 画面の外にあるサイドバーから素通しできる（#719 で同じ形を直した記録がある）。
  it("知らせに答えるまで、サイドバーからも移れない", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    useProjectStore.setState({ restoreToRestorePoint: vi.fn(async () => 2), loadProject: vi.fn(async () => {}) });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await screen.findByText("あとで開く");
    expect(canNavigate("settings" as ScreenId)).toBe(false);
    fireEvent.click(screen.getByText("あとで開く"));
    await waitFor(() => expect(canNavigate("settings" as ScreenId)).toBe(true));
  });

  // ⚠️ **閉じる手段がある**＝答えるまで他を塞ぐので、「開く」しか無いと行き止まりになる。
  it("開かずに閉じられる（塞いだまま行き止まりにしない）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    const load = vi.fn(async () => {});
    useProjectStore.setState({ restoreToRestorePoint: vi.fn(async () => 2), loadProject: load });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await screen.findByText("あとで開く");
    fireEvent.click(screen.getByText("あとで開く"));
    await waitFor(() =>
      expect((screen.getByText("白紙から作る").closest("button") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(load).not.toHaveBeenCalled();
  });

  it("未保存があるときは、先に確認する（戻すと画面の編集が失われる）", async () => {
    useProjectStore.setState({ scenes: [{ sceneId: "scene_001" } as unknown as Scene], saveStatus: "idle" });
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    const restore = vi.fn(async () => 0);
    useProjectStore.setState({ restoreToRestorePoint: restore });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    expect(restore).not.toHaveBeenCalled();
    expect(await screen.findByText("戻して開く")).toBeTruthy();
    fireEvent.click(screen.getByText("戻して開く"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("p_001", "p-3000000.json"));
  });

  it("一覧を読めなかったら黙らせない（次の行動を出す）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockRejectedValue(new Error("むり"));
    await openPanel();
    await waitFor(() => expect(document.body.textContent).toMatch(/戻れる時点の一覧を読めませんでした/));
  });

  it("戻せなかったら理由をそのまま見せる", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([point(3_000_000)]);
    useProjectStore.setState({ restoreToRestorePoint: vi.fn(async () => { throw new Error("その復元ポイントが見つかりませんでした。一覧から選び直してください。"); }) });
    await openPanel();
    fireEvent.click(await screen.findByText("ここへ戻す"));
    await waitFor(() => expect(document.body.textContent).toMatch(/一覧から選び直してください/));
  });
});

// タイムライン形式でも、壊れていれば控えから戻す導線を出す（#977）。
// ⚠️ もとはタイムライン形式の失敗が store の状態に飲まれ、そのまま遷移していたので、
// **控えがあることを誰も言わなかった**（`save_project` の控えは両形式に効くのに）。
describe("タイムライン形式の控えの導線（#977）", () => {
  afterEach(() => vi.restoreAllMocks());
  it("壊れていれば、控えから戻す導線が出る", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(async () => TIMELINE_ONE as unknown as ProjectHeader[]),
    });
    vi.spyOn(projectFs, "projectBackupTime").mockResolvedValue(new Date("2026-09-01T00:00:00Z"));
    useTimelineStore.setState({
      openTimelineProject: vi.fn(async () => {
        useTimelineStore.setState({ loadError: "この動画の内容が正しくありません。", loadFailure: "broken" });
      }),
    } as never);
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("タイムライン動画"));
    await waitFor(() => expect(screen.getByText(/前に保存できていたところ/)).toBeInTheDocument());
    expect(onNavigate).not.toHaveBeenCalled(); // 壊れた先へ連れて行かない
  });

  it("版が新しいだけなら、控えの導線は出さない（壊れていないものを巻き戻させない）", async () => {
    useProjectStore.setState({
      listProjects: vi.fn(async () => TIMELINE_ONE as unknown as ProjectHeader[]),
    });
    const backup = vi.spyOn(projectFs, "projectBackupTime").mockResolvedValue(new Date("2026-09-01T00:00:00Z"));
    useTimelineStore.setState({
      openTimelineProject: vi.fn(async () => {
        useTimelineStore.setState({ loadError: "アプリを更新してください。", loadFailure: "unsupported" });
      }),
    } as never);
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByText("タイムライン動画"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("timeline-project"));
    expect(backup).not.toHaveBeenCalled();
  });
});
