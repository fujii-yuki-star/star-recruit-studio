// @vitest-environment jsdom
// 「使い方」画面（#1229・ADR-0046 ①）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ⚠️ **映像は「在るとき」と「無いとき」の両方を見る**＝同梱の目録はいま空なので、
// 空のときだけ検査すると**映像を入れた側の道を一度も通さないまま**「置き場所を用意した」と言える。
const videos = vi.hoisted(() => ({ list: [] as { id: string; title: string; desc: string; file: string; durationLabel: string }[] }));
vi.mock("../data/tutorialVideos", async (orig) => {
  const actual = await orig<typeof import("../data/tutorialVideos")>();
  return { ...actual, get TUTORIAL_VIDEOS() { return videos.list; } };
});

import { HelpScreen } from "./HelpScreen";

beforeEach(() => {
  videos.list = [];
});

describe("使い方：操作案内", () => {
  it("動画ができるまでの流れを、画面の名前つきで順に出す", () => {
    render(<HelpScreen />);
    expect(screen.getByText("動画ができるまで")).toBeTruthy();
    // 先頭＝新しい動画を作る、最後＝動画を書き出す（`SCREEN_TITLES` から引いた名前）。
    expect(screen.getByText("新しい動画を作る")).toBeTruthy();
    expect(screen.getByText("動画を書き出す")).toBeTruthy();
  });

  it("いつでも行ける場所・時間を細かく作るとき・覚えておくと楽なことも出す", () => {
    render(<HelpScreen />);
    expect(screen.getByText("いつでも行ける場所")).toBeTruthy();
    expect(screen.getByText("タイムライン編集")).toBeTruthy();
    expect(screen.getByText("覚えておくと楽なこと")).toBeTruthy();
  });

  it("「準備中」と出さない（押せない案内を残さない）", () => {
    render(<HelpScreen />);
    expect(screen.queryByText(/準備中/)).toBeNull();
  });
});

describe("使い方：同梱した映像", () => {
  it("映像がまだ無いときは、一覧ごと出さない（押しても何も起きない項目を作らない）", () => {
    render(<HelpScreen />);
    expect(screen.queryByText("見て覚える")).toBeNull();
  });

  it("映像があれば一覧に並び、選ぶとこの画面の中で再生する", () => {
    videos.list = [
      { id: "t01", title: "はじめての1本", desc: "入口から書き出しまで", file: "t01.mp4", durationLabel: "2分" },
    ];
    const { container } = render(<HelpScreen />);
    expect(screen.getByText("見て覚える")).toBeTruthy();
    expect(container.querySelector("video")).toBeNull(); // 選ぶ前は出さない
    fireEvent.click(screen.getByText("はじめての1本").closest("button")!);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    // ⚠️ **同梱を指す**＝外の動画サイトへ取りに行かない（`13`）。
    expect(video!.getAttribute("src")).toBe("/tutorials/t01.mp4");
  });
});
