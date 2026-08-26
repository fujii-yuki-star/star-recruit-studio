// @vitest-environment jsdom
//
// 開けなかった**理由**を利用者へ届ける（#793 レビュー）。
//
// ⚠️ 以前は `catch {}` が理由を捨て、**常に固定文**「プロジェクトを開けませんでした。一覧から
// **別のプロジェクトを選んでください**」を出していた。そのため読み込み側が用意した
// 「アプリを更新してから開き直してください」等が**一度も画面に出ない**うえ、代わりに出る文は
// **§2-5 が禁じる「実行しても直らない行動」**（別のを選んでも版は新しいまま）だった。
// タイムライン形式（`timelineStore`）は既に理由を運んでいたので、**非対称**でもあった。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { ProjectLoadError } from "../../domain/project/persistence";
import type { ProjectHeader } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen 開けなかった理由を出す（#793）", () => {
  afterEach(() => vi.restoreAllMocks());

  const ONE = [{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }];

  function setup(fail: unknown) {
    useProjectStore.setState({
      listProjects: vi.fn(() => Promise.resolve(ONE as unknown as ProjectHeader[])),
      loadProject: vi.fn(() => Promise.reject(fail)),
      saveStatus: "saved",
      scenes: [],
      assets: [],
    });
  }

  const open = async () =>
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);

  it("読み込み側の理由をそのまま見せる（新しい版＝「アプリを更新して」）", async () => {
    setup(new ProjectLoadError("この動画は、いまのアプリより新しい版で作られています。アプリを更新してから開き直してください。"));
    render(<HomeScreen onNavigate={vi.fn()} />);
    await open();
    expect(await screen.findByText(/アプリを更新してから開き直してください/)).toBeInTheDocument();
  });

  // ⚠️ **理由ごとに違う文が出る**ことを2つ目で固定する＝1つだけだと「常にその文を出す」実装でも緑になる。
  it("別の理由なら別の文が出る（固定文に潰さない）", async () => {
    setup(new ProjectLoadError("プロジェクトの必須情報が欠けています。別のプロジェクトを選んでください。"));
    render(<HomeScreen onNavigate={vi.fn()} />);
    await open();
    expect(await screen.findByText(/必須情報が欠けています/)).toBeInTheDocument();
  });

  // ⚠️ **想定外は黙らせない**＝理由を持たない失敗でも案内は出す（無反応にしない）。
  it("理由の分からない失敗でも案内は出す（「もう一度お試しください」）", async () => {
    setup(new Error("なぞ"));
    render(<HomeScreen onNavigate={vi.fn()} />);
    await open();
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("もう一度お試しください");
    // §2-5＝別のを選んでも直らない行動は名指ししない。
    expect(notice.textContent).not.toContain("別のプロジェクトを選んで");
  });
});
