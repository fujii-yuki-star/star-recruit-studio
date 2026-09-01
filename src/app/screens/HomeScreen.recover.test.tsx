// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import * as projectFs from "../../infrastructure/projectFs";
import type { ProjectHeader } from "../../domain/project/persistence";
import { ProjectLoadError } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

// #263：開けなかった動画を「前に保存できていたところ」から戻す導線。
// ⚠️ **壊れているときだけ**出す＝新しい版・別の形式は壊れていないので、戻しても直らず
// 古い内容へ黙って巻き戻すことになる（§2-5）。
const ONE = [{ projectId: "p_001", projectName: "テスト動画", updatedAt: "2026-09-01T00:00:00Z" }];

describe("開けなかった動画の復旧（#263）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      scenes: [], assets: [], saveStatus: "saved",
      listProjects: vi.fn(async () => ONE as unknown as ProjectHeader[]),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function openAndFail(failure: "broken" | "unsupported", backup: Date | null) {
    useProjectStore.setState({
      loadProject: vi.fn(async () => { throw new ProjectLoadError("開けません。", failure); }),
    });
    vi.spyOn(projectFs, "projectBackupTime").mockResolvedValue(backup);
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
  }

  it("壊れていて控えがあるときだけ、戻す導線を出す（いつのものかも見せる）", async () => {
    await openAndFail("broken", new Date("2026-09-01T03:04:00.000Z"));
    expect(await screen.findByText("前に保存できていたところから開く")).toBeTruthy();
    expect(document.body.textContent).toMatch(/保存できていたところが残っています/);
  });

  it("壊れていないときは出さない（古い内容へ巻き戻さない）", async () => {
    await openAndFail("unsupported", new Date("2026-09-01T03:04:00.000Z"));
    await waitFor(() => expect(document.body.textContent).toMatch(/開けません/));
    expect(screen.queryByText("前に保存できていたところから開く")).toBeNull();
  });

  it("控えが無いときは出さない（押せるのに何も起きない導線を作らない）", async () => {
    await openAndFail("broken", null);
    await waitFor(() => expect(document.body.textContent).toMatch(/開けません/));
    expect(screen.queryByText("前に保存できていたところから開く")).toBeNull();
  });

  it("押すと戻してから開き直す", async () => {
    await openAndFail("broken", new Date("2026-09-01T03:04:00.000Z"));
    const restore = vi.spyOn(projectFs, "restoreProjectBackup").mockResolvedValue(undefined);
    const load = vi.fn(async () => {});
    useProjectStore.setState({ loadProject: load });
    fireEvent.click(await screen.findByText("前に保存できていたところから開く"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("p_001"));
    await waitFor(() => expect(load).toHaveBeenCalledWith("p_001"));
  });

  // #964 レビュー 🟡2：別の動画を開こうとしたら、前の動画の「戻す」は消える。
  it("次に別の動画を開こうとしたら、前の「戻す」は残らない", async () => {
    await openAndFail("broken", new Date("2026-09-01T03:04:00.000Z"));
    expect(await screen.findByText("前に保存できていたところから開く")).toBeTruthy();
    // 2つ目は壊れていない理由で失敗＝戻す導線は出ない。前のものも消えている。
    useProjectStore.setState({
      loadProject: vi.fn(async () => { throw new ProjectLoadError("新しい版です。", "unsupported"); }),
    });
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
    await waitFor(() => expect(document.body.textContent).toMatch(/新しい版です/));
    expect(screen.queryByText("前に保存できていたところから開く")).toBeNull();
  });


  it("理由が取れないときは決まり文句へ倒す（黙らない）", async () => {
    await openAndFail("broken", new Date("2026-09-01T03:04:00.000Z"));
    vi.spyOn(projectFs, "restoreProjectBackup").mockRejectedValue("");
    fireEvent.click(await screen.findByText("前に保存できていたところから開く"));
    await waitFor(() => expect(document.body.textContent).toMatch(/一覧から別の動画を選んでください/));
  });

  it("戻せなかったら黙らせない（次の行動を出す）", async () => {
    await openAndFail("broken", new Date("2026-09-01T03:04:00.000Z"));
    // ⚠️ **断った側の理由をそのまま見せる**（次の行動はそこに書いてある）。
    vi.spyOn(projectFs, "restoreProjectBackup").mockRejectedValue(
      new Error("開けなかったほうを取っておけなかったので、戻していません。別のアプリで開いていないか確かめてください。"),
    );
    fireEvent.click(await screen.findByText("前に保存できていたところから開く"));
    await waitFor(() => expect(document.body.textContent).toMatch(/別のアプリで開いていないか/));
  });
});
