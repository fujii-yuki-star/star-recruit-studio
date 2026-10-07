// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { ScreenId } from "../data/mockData";

// ⚠️ **並ぶものそのものを渡す**（#1006）＝「開いているか」「名前」「行き先」を
// 部品が組み立てていた形をやめ、`navigation.ts` の `currentProjectEntries` が決めたものを受ける。
const setup = (over: {
  current?: ScreenId;
  hasProjectContent?: boolean;
  projectName?: string;
  currentProjectTarget?: ScreenId;
  currentProjects?: { kind: "scene" | "timeline"; name: string; target: ScreenId; sub: string }[];
} = {}) => {
  const onNavigate = vi.fn();
  const onCollapse = vi.fn();
  const fallback: { kind: "scene" | "timeline"; name: string; target: ScreenId; sub: string }[] =
    over.hasProjectContent ?? false
      ? [{ kind: "scene", name: over.projectName ?? "無題の動画", target: over.currentProjectTarget ?? "draft", sub: "今の動画" }]
      : [];
  render(
    <Sidebar
      current={over.current ?? "home"}
      onNavigate={onNavigate}
      currentProjects={over.currentProjects ?? fallback}
      onCollapse={onCollapse}
    />,
  );
  return { onNavigate, onCollapse };
};

// `setup` は container を返さないので、帯まるごとを見る検査のためだけに1つ用意する。
const render2 = () =>
  render(
    <Sidebar current="home" onNavigate={vi.fn()} currentProjects={[]} onCollapse={vi.fn()} />,
  );

// 「今の動画」ボタン（2行構成）を取得。ラベル「今の動画」の最寄り button。
const currentVideoButton = (): HTMLElement | null => screen.queryByText("今の動画")?.closest("button") ?? null;

describe("Sidebar（IA再構成・#399 B案）", () => {
  it("先頭は「動画」＝一覧。押すと一覧（home）へ", () => {
    const { onNavigate } = setup();
    fireEvent.click(screen.getByText("動画").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("動画未オープン（idle・非工程画面）では「今の動画」を出さない＝一覧へ誘導", () => {
    setup({ current: "home", hasProjectContent: false });
    expect(currentVideoButton()).toBeNull();
  });

  it("動画を開いている間は「今の動画（名前）」を出し、押すと戻り先（既定＝たたき台）へ", () => {
    const { onNavigate } = setup({ current: "home", hasProjectContent: true, projectName: "採用2026" });
    expect(currentVideoButton()).not.toBeNull();
    expect(screen.getByText("採用2026")).toBeTruthy(); // 名前を表示（#252 合流）
    fireEvent.click(currentVideoButton()!);
    expect(onNavigate).toHaveBeenCalledWith("draft"); // currentProjectTarget 既定
  });

  it("「今の動画」は直近に開いていた工程画面（currentProjectTarget）へ戻る＝たたき台固定にしない（#547 P3-7）", () => {
    // 素材画面から「今の動画」を押す。直前は書き出し画面にいた＝そこへ戻る（先頭のたたき台へ飛ばさない）。
    const { onNavigate } = setup({ current: "materials", hasProjectContent: true, currentProjectTarget: "export" });
    fireEvent.click(currentVideoButton()!);
    expect(onNavigate).toHaveBeenCalledWith("export");
  });

  // ⚠️ **「出すかどうか」の規則は `navigation.ts` へ移した**（#1006）＝ここは**渡されたものを描く**だけ。
  // 規則そのものの検査は `navigation.test.ts`（工程画面にいる間は開いていなくても出す）。
  it("工程画面にいる間も「今の動画」を出す（active）", () => {
    setup({ current: "wizard", currentProjects: [{ kind: "scene", name: "無題の動画", target: "draft", sub: "今の動画" }] });
    const btn = currentVideoButton();
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain("active"); // 工程画面では「今の動画」が active
  });

  it("一覧画面では「動画」が active・「今の動画」は非active", () => {
    setup({ current: "home", hasProjectContent: true });
    expect(screen.getByText("動画").closest("button")!.className).toContain("active");
    expect(currentVideoButton()!.className).not.toContain("active");
  });

  it("見た目パターン編集中（looks-edit）でも「見た目パターン」が active＝現在地が消えない", () => {
    setup({ current: "looks-edit" });
    expect(screen.getByText("見た目パターン").closest("button")!.className).toContain("active");
  });
});

// 2つの形式を同時に開いているとき（#1006＝実機の指摘「どちらも確認できるべき」）。
describe("Sidebar: 開いている形式のぶんだけ並べる（#1006）", () => {
  const both: { kind: "scene" | "timeline"; name: string; target: ScreenId; sub: string }[] = [
    { kind: "scene", name: "採用2026", target: "draft", sub: "今の動画" },
    { kind: "timeline", name: "焼いた動画", target: "timeline-project", sub: "今の動画（タイムライン）" },
  ];

  it("両方開いていれば両方出て、それぞれの動画へ行ける", () => {
    const { onNavigate } = setup({ current: "home", currentProjects: both });
    expect(screen.getByText("採用2026")).toBeTruthy();
    expect(screen.getByText("焼いた動画")).toBeTruthy();
    fireEvent.click(screen.getByText("焼いた動画").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("timeline-project");
  });

  // ⚠️ **どちらへ行くのか押す前に分かる**＝同じ「今の動画」が2つ並ぶと見分けられない。
  it("どちらの形式かを添える", () => {
    setup({ current: "home", currentProjects: both });
    expect(screen.getByText("今の動画")).toBeTruthy();
    expect(screen.getByText("今の動画（タイムライン）")).toBeTruthy();
  });

  it("いま見ている方だけに印が付く（両方に付けない）", () => {
    setup({ current: "timeline-project", currentProjects: both });
    expect(screen.getByText("採用2026").closest("button")!.className).not.toContain("active");
    expect(screen.getByText("焼いた動画").closest("button")!.className).toContain("active");
  });

  it("場面形式の工程画面にいるときは、そちらだけに印が付く", () => {
    setup({ current: "draft", currentProjects: both });
    expect(screen.getByText("採用2026").closest("button")!.className).toContain("active");
    expect(screen.getByText("焼いた動画").closest("button")!.className).not.toContain("active");
  });
});

// 帯の掃除（#1229・利用者判断 2026-09-25）。
// ⚠️ **「準備中」は3つ並んでいた**（ヘルプ・お問い合わせ・お知らせ）＝押せない項目が並ぶだけで、
// **使い方を伝える手段がどこにも無かった**。お問い合わせ・お知らせは入れる予定が無いので廃止し、
// ヘルプは中身（使い方）を入れて押せるようにした。
describe("Sidebar: 準備中の項目を残さない（#1229）", () => {
  it("「使い方」は押せて、使い方の画面へ行く", () => {
    const { onNavigate } = setup();
    fireEvent.click(screen.getByText("使い方").closest("button")!);
    expect(onNavigate).toHaveBeenCalledWith("help");
  });

  it("使い方の画面にいる間は印が付く", () => {
    setup({ current: "help" });
    expect(screen.getByText("使い方").closest("button")!.className).toContain("active");
  });

  it("お問い合わせ・お知らせは出さない", () => {
    setup();
    expect(screen.queryByText("お問い合わせ")).toBeNull();
    expect(screen.queryByText("お知らせ")).toBeNull();
  });

  // ⚠️ **1つずつ数え上げない**＝項目を足したときに漏れる。**帯まるごと**で見る（§7「画面まるごとで見る検査」）。
  it("帯のどこにも「準備中」を出さない", () => {
    const { container } = render2();
    expect(container.textContent).not.toContain("準備中");
    expect(container.querySelectorAll("button[disabled]").length).toBe(0);
  });
});
