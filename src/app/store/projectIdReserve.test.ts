// 動画の番号が二重に出ない（#992 ③）。
//
// ⚠️ **同じ番号の動画が2つ作られ、片方が消える**＝焼き出しと複製は**ファイルを運んでから**
// `project.json` を書く（途中で失敗しても「素材の無い動画」を一覧に残さないため）。
// 番号は一覧から採り、一覧は **`project.json` を読めないフォルダを飛ばす**ので、
// **運んでいる最中は作りかけの動画が一覧に居ない**＝その間に2回目を始めると同じ番号が返る。
// 両方が同じフォルダへ運び、後から書いた `project.json` が勝つ＝**素材だけが混ざる**。
import { beforeEach, describe, expect, it } from "vitest";
import { resetProjectIdReservations, reserveProjectId } from "./assetImport";
import { createProjectId } from "../../domain/project/persistence";

const mint = (ids: readonly string[]): string => createProjectId(new Date("2026-09-03T00:00:00Z"), ids);

beforeEach(() => resetProjectIdReservations());

describe("reserveProjectId（#992 ③）", () => {
  it("同じ一覧から2回取っても、番号がぶつからない", () => {
    const listed = ["proj_20260903_001"];
    // ⚠️ **一覧は変わらない**＝1回目が運んでいる最中は `project.json` がまだ無いので、
    // 2回目が見る一覧には**1回目が現れない**。ここが元の穴。
    const a = reserveProjectId(listed, mint);
    const b = reserveProjectId(listed, mint);
    expect(a).toBe("proj_20260903_002");
    expect(b, "運んでいる最中に2回目が同じ番号を取った").toBe("proj_20260903_003");
  });

  it("一覧に出てきた番号も、続きから採る（飛ばさない・重ねない）", () => {
    reserveProjectId(["proj_20260903_001"], mint); // → 002
    // 002 が保存されて一覧に出た後。
    expect(reserveProjectId(["proj_20260903_001", "proj_20260903_002"], mint)).toBe("proj_20260903_003");
  });

  it("採番の規則そのものは持たない（`createProjectId` に委ねる）", () => {
    // ⚠️ **規則を写さない**＝予約は「使った番号を覚える」だけ。日付が変われば規則側が変える。
    const other = (ids: readonly string[]): string => createProjectId(new Date("2026-12-31T00:00:00Z"), ids);
    expect(reserveProjectId([], other)).toBe("proj_20261231_001");
  });

  it("覚えた番号は、一覧に無くても二度と出さない（アプリを閉じるまで）", () => {
    const a = reserveProjectId([], mint);
    const b = reserveProjectId([], mint);
    const c = reserveProjectId([], mint);
    expect(new Set([a, b, c]).size, "同じ番号を配った").toBe(3);
  });
});
