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

  it("合う標準が無い場面は「変わります」と言わない（約束と実挙動をずらさない）", () => {
    // その向き・種類の標準を外すと、この場面は削除後も未解決のまま残る。
    useProjectStore.setState({
      templates: [userTemplate, ...sampleTemplates.filter((t) => t.category !== userTemplate.category)],
      scenes: [usingScene("s1")],
    });
    render(<LooksScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    expect(screen.getByText(/1個の場面は合う標準が無いため、見た目を選び直すまで書き出せません/)).toBeTruthy();
    expect(screen.queryByText(/標準の見た目に変わります/)).toBeNull();
  });

  it("中身が出なくなる場面があれば、その数も先に示す（削除は取り消せないため）", () => {
    // マイ見た目**にだけある差し込み先**に写真が入っている＝標準へ寄せると受け皿が無く、動画に出なくなる。
    const withOwnSlot = {
      ...userTemplate,
      layers: [...userTemplate.layers, { id: "layer_001", type: "slot", x: 0, y: 0, w: 100, h: 100 } as (typeof userTemplate.layers)[number]],
    };
    useProjectStore.setState({
      templates: [withOwnSlot, ...sampleTemplates],
      scenes: [usingScene("s1", { assetRefs: { layer_001: "asset_001" } })],
    });
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

// #547 P2-1：この画面は ExportLock（ラッパ）経由でバナーを出す。導線は inert の**外**に置いてあるので
// 書き出し中でも押せる＝どの画面からでも中止へ到達できる（15 §4）。直接 <ExportLockBanner /> を置く経路は
// HomeScreen.busy.test.tsx が担保。onNavigate は必須 prop なので「渡し忘れ」自体は型で防いでいる。
describe("LooksScreen 書き出し中は復帰導線を出す（#547 P2-1）", () => {
  afterEach(() => useProjectStore.getState().setExportRun({ phase: "idle" }));

  it("書き出し中でも「書き出しへ戻る」を押せる（ロックの抜け道に到達できる）", () => {
    useProjectStore.setState({
      exportRun: { phase: "rendering", progress: { done: 1, total: 2 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    });
    const onNavigate = vi.fn();
    render(<LooksScreen onNavigate={onNavigate} />);
    const back = screen.getByText("書き出しへ戻る");
    expect(back.closest("[inert]")).toBeNull(); // 操作不可の部分木に入っていない
    fireEvent.click(back);
    expect(onNavigate).toHaveBeenCalledWith("export");
  });
});
