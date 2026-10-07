// @vitest-environment jsdom
// 「新しい動画を作る」は1か所だけ（UI/UX 監査 2026-10-02＝上の大きなボタンと下の入口に同じ操作が並んでいた）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen 新しい動画を作る", () => {
  afterEach(() => vi.restoreAllMocks());

  it("押せる「新しい動画を作る」は1つ・下の入口は見た目パターンと設定", async () => {
    useProjectStore.setState({ listProjects: vi.fn(() => Promise.resolve([])) });
    render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText(/保存した動画はまだありません/);
    expect(screen.getAllByRole("button", { name: /新しい動画を作る/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /見た目パターンを管理/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^設定/ })).toBeTruthy();
  });
});
