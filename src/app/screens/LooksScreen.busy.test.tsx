// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksScreen } from "./LooksScreen";

// #410 sub4 レビュー：画面が busy を配線し忘れても CI が通っていた回帰を防ぐ。
// 作成/複製/削除の各非同期操作が「実行中ラベル」になり、対象ボタンが disabled（連打不可）になることを押さえる。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

function pendingPromise<T>(): [Promise<T>, (v: T) => void] {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((r) => { resolve = r; });
  return [p, resolve];
}

describe("LooksScreen busy 表示（#410 sub4 レビュー）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], scenes: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("複製中は「複製中…」＋ボタン無効（連打不可）", () => {
    const [p] = pendingPromise<string>();
    useProjectStore.setState({ duplicateAsUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目を複製して編集する"));
    const btn = screen.getByText("複製中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("作成中は「作成中…」＋ボタン無効", () => {
    const [p] = pendingPromise<string>();
    useProjectStore.setState({ createBlankUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("＋ ゼロから新しい見た目を作る"));
    fireEvent.click(screen.getByText("作成して編集する"));
    const btn = screen.getByText("作成中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 作成中は「やめる」も無効＝フォームを閉じて裏で作成完了→遷移する逃げ道を塞ぐ（#410 sub4 レビュー P2）。
    expect((screen.getByText("やめる").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("削除中は「削除中…」＋確認ボタン無効（DeleteConfirm に busy 配線）", () => {
    const [p] = pendingPromise<boolean>();
    useProjectStore.setState({ deleteUserTemplate: vi.fn(() => p) });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    fireEvent.click(screen.getByText("削除する"));
    const btn = screen.getByText("削除中…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // 削除中はテンプレ選択カードも無効＝別テンプレを選んで確認UIを消し、削除だけ裏で進める逃げ道を塞ぐ（#410 sub4 レビュー P2）。
    expect((document.querySelector(".action-card") as HTMLButtonElement).disabled).toBe(true);
  });
});

// #547：削除は「使っている場面が標準へ変わる／中身が出なくなる」副作用を伴う（#458）。
// 文言そのものは uiLabels.test.ts で担保するので、ここは**画面が正しい件数を渡しているか**（配線）を見る。
describe("マイ見た目の削除確認は影響を先に示す（#547）", () => {
  const usingScene = (sceneId: string, over: Record<string, unknown> = {}) =>
    ({ sceneId, partId: "part_001", order: 1, sceneType: userTemplate.category, templateId: "user_tmpl_001",
       durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
       narration: { text: "", status: "none" }, warnings: [], ...over }) as never;

  it("使用中の場面数を確認ダイアログに出す（全場面数ではなく、この見た目を使っている数）", () => {
    useProjectStore.setState({
      scenes: [usingScene("s1"), usingScene("s2"), usingScene("s3", { templateId: sampleTemplates[1].templateId })],
    });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    expect(screen.getByText(/2個の場面は、標準の見た目に変わります/)).toBeTruthy(); // 3ではなく2
  });

  it("中身が出なくなる場面があれば、その数も先に示す（削除は取り消せないため）", () => {
    // マイ見た目の層 id に写真が入っている＝標準へ寄せると差し込み先が無く、動画に出なくなる。
    useProjectStore.setState({ scenes: [usingScene("s1", { assetRefs: { layer_001: "asset_001" } })] });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    expect(screen.getByText(/1個の場面は写真・文字などが動画に出なくなります/)).toBeTruthy();
  });

  it("使っていなければ場面の話は出さない（無関係な不安を作らない）", () => {
    useProjectStore.setState({ scenes: [] });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    expect(screen.queryByText(/標準の見た目に変わります/)).toBeNull();
  });
});
