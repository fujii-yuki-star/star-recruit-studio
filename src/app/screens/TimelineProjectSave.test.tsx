// @vitest-environment jsdom
// タイムライン編集の**自動保存の結果を伝える**ところ（#693）。共通トップバーの保存ボタンは出さない決定
// （ADR-0032）なので、失敗を伝える担い手はこの画面しかいない。黙って落とすと「閉じても消えない」
// （`06 §12.1`）が破れる（ADR-0026④）。
//
// **別ファイルにしてある**＝保存は画面の寿命（アンマウント）と時間（自動保存の待ち）に関わるので、
// 同じファイルに 100 件の他のテストがあると、前のテストが張ったタイマや走りかけの保存に結果が左右される。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import * as fsMod from "../../infrastructure/projectFs";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { canNavigate } from "../hooks/navigationGuard";
import type { ScreenId } from "../data/mockData";
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
  // **書き出しの状態を先に戻す**＝`closeTimelineProject` は書き出し中だと何もしない（走行中に文書を
  // 差し替えないため）。戻さないと、書き出し中にしたテストの状態が以降のテスト全部に残る。
  useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
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
    expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(onNavigate).not.toHaveBeenCalled(); // 「やめる」なら残る＝保存し直しに戻れる
    fireEvent.click(screen.getByText("動画の一覧へ"));
    fireEvent.click(screen.getByRole("button", { name: "保存しないで移る" }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("サイドバーなど別の入口から離れようとしても聞く（画面内のボタンだけに確認を付けない・#719）", () => {
    // 実際の遷移は `App` の `navigate` ひとつを通るので、そこが関門に聞く。ここでは関門そのものを叩く。
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    // 「素材」画面へ移ろうとした＝画面内のボタンではない入口。
    act(() => { expect(canNavigate("materials" as ScreenId)).toBe(false); });
    expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument();
    // 「はい」と答えたら、**聞いたときの行き先**へ移る（一覧に固定しない）。
    fireEvent.click(screen.getByRole("button", { name: "保存しないで移る" }));
    expect(onNavigate).toHaveBeenCalledWith("materials");
  });

  it("画面を出したあとに保存が失敗しても、その時点から関門が効く（#719 レビュー）", () => {
    // 実際の引き金は「編集を続けている最中に自動保存が失敗する」＝**開いた後に**条件が変わる経路。
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { useTimelineStore.setState({ saveStatus: "error" }); });
    act(() => { canNavigate("materials" as ScreenId); });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/このまま画面を移ると/)).toBeInTheDocument();
  });

  it("確認を出したまま保存し直せたら、確認ごと片づける（古い行き先で蘇らせない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { canNavigate("materials" as ScreenId); });
    expect(screen.getByText(/このまま画面を移ると/)).toBeInTheDocument();
    act(() => { useTimelineStore.setState({ saveStatus: "saved" }); });
    // 直ったので確認は消える。ここで**また失敗しても**、押していない確認が蘇らない。
    act(() => { useTimelineStore.setState({ saveStatus: "error" }); });
    expect(screen.queryByText(/このまま画面を移ると/)).not.toBeInTheDocument();
  });

  it("答えたあとは同じ確認を出し続けない（永久に離れられない、を作らない・#719）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { canNavigate("materials" as ScreenId); });
    fireEvent.click(screen.getByRole("button", { name: "保存しないで移る" }));
    // 答えた直後もまだ保存は失敗のまま。その1回は通す（通さないと画面から出られない）。
    expect(canNavigate("materials" as ScreenId)).toBe(true);
    // ただし通すのは1回だけ＝次はまた聞く。
    expect(canNavigate("materials" as ScreenId)).toBe(false);
  });

  it("保存できているときは聞かずに移る（無用に足止めしない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    // 関門は常に名乗り、通してよいかは画面が決めて**自分で遷移する**（その場で true を返す形ではない）。
    act(() => { canNavigate("materials" as ScreenId); });
    expect(onNavigate).toHaveBeenCalledWith("materials");
    expect(screen.queryByText(/このまま画面を移ると/)).not.toBeInTheDocument();
  });

  it("書き出し中は離れられない（サイドバーからも・理由を出す）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved", exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    act(() => { canNavigate("materials" as ScreenId); });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/終わってから画面を移ってください/)).toBeInTheDocument(); // 黙って止めない
    // 書き出しが終わったら理由は下げる（終わっているのに「書き出しています」を残さない）。
    act(() => { useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } }); });
    expect(screen.queryByText(/終わってから画面を移ってください/)).not.toBeInTheDocument();
  });

  it("保存を待っている最中に離れようとしたら、書き切ってから移る（素通しさせない）", async () => {
    open();
    useTimelineStore.setState({ saveStatus: "idle" });
    const save = vi.spyOn(useTimelineStore.getState(), "saveTimelineProject");
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    await act(async () => { canNavigate("materials" as ScreenId); });
    expect(save).toHaveBeenCalled(); // 待っている保存を書いてから
    expect(onNavigate).toHaveBeenCalledWith("materials");
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

  it("保存を待つ間に別の行き先を押したら、移るのは1回だけ・着地は最後に押した所（#729 レビュー）", async () => {
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
    // 待っている間に2か所を続けて押す（サイドバーの素早い2クリック）。
    act(() => { canNavigate("materials" as ScreenId); });
    act(() => { canNavigate("settings" as ScreenId); });
    expect(onNavigate).not.toHaveBeenCalled(); // 書き終わるまでどちらも離れない
    await act(async () => { release(); });
    // 流れが2つ走ると、それぞれが `onNavigate` を撃つ＝一瞬だけ先の行き先を描いてから次へ飛ぶ。
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("settings"); // 最後に押した所
    // ⚠️ 2つ目の流れが起こす**余分な保存**（`if (running) return;` が消している1回）はここでは測らない
    // ＝自動保存も同じメソッドを呼ぶので、絶対数で見ると自動保存の都合で壊れるテストになる。
  });

  it("保存に失敗して断ったあとも、次の行き先を押せる（押しても何も起きない画面にしない）", async () => {
    open();
    useTimelineStore.setState({ saveStatus: "idle" });
    vi.spyOn(fsMod, "saveProjectDoc").mockRejectedValue(new Error("書けない"));
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    await act(async () => { canNavigate("materials" as ScreenId); });
    expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument();
    // 走っていた流れの目印を片づけていないと、ここから先は**何を押しても無反応**になる。
    await act(async () => { canNavigate("settings" as ScreenId); });
    expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument();
  });

  it("保存済みで離れるときは書き直さない（同じ内容を無駄に書かない）", async () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const write = vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
    const view = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    write.mockClear();
    view.unmount();
    // ⚠️ **離れたあと1周待ってから見る**（#763-3）＝書き切るかどうかの判断は、欄の後始末より後に
    // 回している。`unmount()` の直後に見ると「まだ判断していない」だけを見ることになり、
    // **常に書く形へ退行しても気づけない**（＝空振りするテストになる）。
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
  });

  it("確認を出したまま保存できたら、確認は消える（事実と食い違う文を残さない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "error" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("動画の一覧へ"));
    expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument();
    act(() => useTimelineStore.setState({ saveStatus: "saved" }));
    expect(screen.queryByText(/このまま画面を移ると、その変更は失われます/)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText(/このまま画面を移ると、その変更は失われます/)).toBeInTheDocument());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("文字を打っている間は自動保存を待つ（打つたびに全部書き直さない）", async () => {
    open();
    const write = vi.spyOn(fsMod, "saveProjectDoc").mockResolvedValue("x/project.json");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(useTimelineStore.getState().saveStatus).not.toBe("saving"));
    act(() => {
      useTimelineStore.getState().beginHistoryGroup();
      useTimelineStore.setState({ saveStatus: "idle" }); // 打っている＝未保存
    });
    write.mockClear();
    // **自動保存の待ち時間（800ms）より長く待つ**＝短く待つと、保留しているのか
    // まだ時間が来ていないのか区別できない（区別できないテストは穴を守れない）。
    await new Promise((r) => setTimeout(r, 900));
    expect(write).not.toHaveBeenCalled(); // 打っている間は書かない
    act(() => useTimelineStore.getState().endHistoryGroup());
    await waitFor(() => expect(write).toHaveBeenCalled()); // 離れたら書く
  });

  it("保存できているときは聞かずに戻る（毎回の確認で邪魔しない）", () => {
    open();
    useTimelineStore.setState({ saveStatus: "saved" });
    const onNavigate = vi.fn();
    render(<TimelineProjectScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("動画の一覧へ"));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  // #763-3：**画面を離れるときの「書き切る」は、子の後始末より後で判断する**。
  // React の後始末は**親→子**の順に走るので、画面が「保存済み」を見て降りた**後**に、子（色の欄）が
  // 打ちかけを確定して未保存へ戻す。そのときこの画面はもう無いので**誰も書かない**＝開き直すと
  // 確定したはずの色が消える（#751 と同型・自動保存が常時ある場面形式には無い穴＝ADR-0026②）。
  it("開いた色の欄に打ちかけたまま画面を離れても、その色が書き切られる（#763-3）", async () => {
    open();
    // 「保存済み」で離れる＝この状態でこそ、画面は「書くものは無い」と判断して降りる。
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], saveStatus: "saved" });
    const { unmount } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);

    // 文字の色の欄を開いて、色コードを打つ（確定はしない＝打ちかけのまま離れる）。
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    const code = within(screen.getByRole("dialog")).getByRole("textbox");
    fireEvent.change(code, { target: { value: "#123456" } });
    expect(fsMod.saveProjectDoc).not.toHaveBeenCalled(); // 打っただけでは書かない

    unmount();
    // 子の後始末が打ちかけを確定する → その未保存を拾って書く。
    await waitFor(() => expect(fsMod.saveProjectDoc).toHaveBeenCalled());
    const written = JSON.parse(vi.mocked(fsMod.saveProjectDoc).mock.calls[0][1]) as { clips: { color?: string }[] };
    expect(written.clips[0].color).toBe("#123456"); // 打った色が入っている（黙って捨てない）
  });
});
