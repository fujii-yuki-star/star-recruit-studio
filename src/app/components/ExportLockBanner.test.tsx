// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ExportPhase } from "../store/projectStore";
import { useProjectStore } from "../store/projectStore";
import { ExportLock, ExportLockBanner } from "./ExportLockBanner";

// #570 P2：書き出し中はバナーを出すだけでなく、囲んだ編集 UI を inert で実際に操作不可にする（「押せるのに効かない」を無くす）。
const setExport = (phase: ExportPhase, progress = { done: 0, total: 0 }) =>
  useProjectStore.setState({ exportRun: { phase, progress, resultPath: "", message: "", bgmWarning: "", cancelling: false, resultUnseen: false } });

describe("ExportLockBanner / ExportLock（#570 P2）", () => {
  afterEach(() => setExport("idle"));

  it("書き出しでない：バナー無し・子は inert で囲まれない（従来どおり操作可）", () => {
    setExport("idle");
    render(<ExportLock onNavigate={vi.fn()}><button>編集ボタン</button></ExportLock>);
    expect(screen.queryByText(/動画を書き出し中です/)).toBeNull();
    expect(screen.getByText("編集ボタン").closest("[inert]")).toBeNull();
  });

  it("書き出し中：バナーを出し、子を inert 部分木で囲む（操作不可）", () => {
    setExport("rendering");
    render(<ExportLock onNavigate={vi.fn()}><button>編集ボタン</button></ExportLock>);
    expect(screen.getByText(/動画を書き出し中です/)).toBeTruthy();
    expect(screen.getByText("編集ボタン").closest("[inert]")).not.toBeNull();
  });

  it("ExportLockBanner 単体：書き出し中だけ表示（encoding も真）", () => {
    setExport("encoding");
    const { rerender } = render(<ExportLockBanner onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を書き出し中です/)).toBeTruthy();
    setExport("done");
    rerender(<ExportLockBanner onNavigate={vi.fn()} />);
    expect(screen.queryByText(/動画を書き出し中です/)).toBeNull();
  });

  // #547 P2-1：書き出し中も他の画面へ移動できるのに、進捗が書き出し画面にしか無いと「止まった」ように見える
  // （→二重書き出しの引き金）。どの画面のバナーでも同じ進捗と、戻る導線を出す。
  it("進捗（%といま何をしているか）を出す", () => {
    setExport("rendering", { done: 2, total: 8 });
    render(<ExportLockBanner onNavigate={vi.fn()} />);
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("20%"); // 2/8 の 80% 換算
    expect(note.textContent).toContain("場面 3 / 8 を処理中"); // 処理中は1始まり
  });

  it("onNavigate を渡すと書き出し画面へ戻れる（中止もそこから）", () => {
    setExport("rendering", { done: 0, total: 4 });
    const onNavigate = vi.fn();
    render(<ExportLockBanner onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("書き出しへ戻る"));
    expect(onNavigate).toHaveBeenCalledWith("export");
  });

  it("画面ごとの補足（何ができなくなるか）を差し込める", () => {
    setExport("rendering", { done: 0, total: 4 });
    render(<ExportLockBanner onNavigate={vi.fn()} detail="切り替えと削除はできません。" />);
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("切り替えと削除はできません。");
    expect(note.textContent).not.toContain("編集できません"); // 既定文は出さない
  });

  // 待つ以外の「次の行動」を示す（中止＝編集ロックの唯一の抜け道・15 §2.3/§4）。
  it("中止できることを伝える", () => {
    setExport("rendering", { done: 0, total: 4 });
    render(<ExportLockBanner onNavigate={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("中止できます");
  });

  // ExportLock を使わない画面（ウィザード等）は入力欄が生きたままで、この文だけが
  // 「入れても保存されない」を伝える唯一の手段になる（§2-5・ADR-0026④）。
  it("「できません」と明示する（進捗を足したせいで禁止の明示を失わない）", () => {
    setExport("rendering", { done: 0, total: 4 });
    render(<ExportLockBanner onNavigate={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("編集できません");
  });

  // バナーは1文の括弧内に差し込むので、句点で終わる完結文を入れて文を入れ子にしない。
  it("進捗イベント未受信のエンコード段でも文が入れ子にならない", () => {
    setExport("encoding", { done: 4, total: 4 });
    render(<ExportLockBanner onNavigate={vi.fn()} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("最後の仕上げ中）"); // 括弧内は短い語
    expect(text).not.toContain("そのままお待ちください");
  });

  it("ExportLock は導線を inert の外に置く（書き出し中でも押せる）", () => {
    setExport("rendering", { done: 0, total: 4 });
    render(<ExportLock onNavigate={vi.fn()}><button>編集ボタン</button></ExportLock>);
    expect(screen.getByText("書き出しへ戻る").closest("[inert]")).toBeNull();
    expect(screen.getByText("編集ボタン").closest("[inert]")).not.toBeNull();
  });
});
