// @vitest-environment jsdom
// 書き出しが終わったあとの導線（#991・`06 §13` 完了時／#404）。
//
// ⚠️ **場面形式にしか無かった**＝タイムライン形式は「動画を保存しました。」と「閉じる」だけで、
// 保存先も開く道も無かった（`06 §12.1` に導線を落とす理由は書かれていない＝ADR-0026②）。
// 部品を共有したので、ここで**部品そのもの**を見る（画面ごとに書かない）。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExportDoneActions } from "./ExportDoneActions";
import * as opener from "../../infrastructure/opener";

describe("ExportDoneActions（#991）", () => {
  it("保存先と、そこへ辿る導線を出す", () => {
    render(<ExportDoneActions path="C:/out/movie.mp4" onBack={vi.fn()} />);
    expect(screen.getByText(/保存先：C:\/out\/movie\.mp4/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存した場所を開く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "動画を再生" })).toBeInTheDocument();
  });

  // ⚠️ **場所が分からないときは何も出さない**＝押しても何も起きないボタンを作らない（§2-5）。
  it("保存先が分からなければ、何も出さない", () => {
    const { container } = render(<ExportDoneActions path={null} onBack={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("戻り先を渡さなければ「一覧へ戻る」は出さない（画面によっては別の戻り道がある）", () => {
    render(<ExportDoneActions path="C:/out/movie.mp4" />);
    expect(screen.queryByRole("button", { name: /プロジェクト一覧へ戻る/ })).toBeNull();
  });

  // ⚠️ **開けなかったら、押した操作に応じて言う**（§2-5＝黙って何も起きない、を作らない）。
  it("再生できなければ、その理由を出す", async () => {
    vi.spyOn(opener, "openSavedFile").mockRejectedValue(new Error("x"));
    render(<ExportDoneActions path="C:/out/movie.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "動画を再生" }));
    // ⚠️ **手がかりと保存先を落とさない**（PR #1020 レビュー 🟡2）＝部品へ寄せたとき、
    // 再生の側にだけあった「再生できるアプリ」と保存先の再掲が消えていた。
    const msg = await screen.findByText(/動画を再生できませんでした/);
    expect(msg.textContent).toContain("再生できるアプリがあるかご確認ください");
    expect(msg.textContent, "探しに行く先が書かれていない").toContain("C:/out/movie.mp4");
  });

  it("場所を開けなければ、そちらの理由を出す（同じ文にしない）", async () => {
    vi.spyOn(opener, "revealSavedFile").mockRejectedValue(new Error("x"));
    render(<ExportDoneActions path="C:/out/movie.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "保存した場所を開く" }));
    const msg2 = await screen.findByText(/保存した場所を開けませんでした/);
    expect(msg2.textContent).toContain("C:/out/movie.mp4");
  });

  // ⚠️ **押し直したら断りを引っ込める**＝直ったのに古い断りが残る、を作らない。
  it("成功する操作を押し直すと、前の断りは消える", async () => {
    vi.spyOn(opener, "revealSavedFile").mockRejectedValue(new Error("x"));
    vi.spyOn(opener, "openSavedFile").mockResolvedValue(undefined);
    render(<ExportDoneActions path="C:/out/movie.mp4" />);
    fireEvent.click(screen.getByRole("button", { name: "保存した場所を開く" }));
    await waitFor(() => expect(screen.getByText(/保存した場所を開けませんでした/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "動画を再生" }));
    await waitFor(() => expect(screen.queryByText(/保存した場所を開けませんでした/)).toBeNull());
  });
});
