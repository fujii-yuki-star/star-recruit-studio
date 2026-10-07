// 依存の脆弱性チェックの**見分け**（#1038・PR #1039 レビュー）。
//
// ⚠️ **門番そのもの**なので検査を置く（§7「必ず自動テストを書く対象＝純粋ロジック」）。
// 走らせるのは `readAudit` だけ＝`npm audit` は叩かない（レジストリに依存する検査は置かない）。
import { describe, expect, it } from "vitest";
import { readAudit } from "./node-audit.mjs";

const report = (counts, vulns = {}) =>
  JSON.stringify({ auditReportVersion: 2, vulnerabilities: vulns, metadata: { vulnerabilities: counts } });

describe("readAudit（脆弱性ありと、エンドポイントのエラーを分ける）", () => {
  it("脆弱性が無ければ通す", () => {
    expect(readAudit(report({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }))).toEqual({
      ok: true,
      blocking: 0,
      names: [],
    });
  });

  it("high と critical を数え、名前を挙げる", () => {
    const r = readAudit(
      report({ high: 2, critical: 1 }, { lodash: { severity: "high" }, minimist: { severity: "critical" } }),
    );
    expect(r).toEqual({ ok: true, blocking: 3, names: ["high: lodash", "critical: minimist"] });
  });

  // ⚠️ **落とす範囲は変えない**＝`--audit-level=high` と同じ（low / moderate では落とさない）。
  it("low・moderate では落とさない（門番を厳しくもしない）", () => {
    const r = readAudit(report({ low: 5, moderate: 3, high: 0, critical: 0 }, { x: { severity: "moderate" } }));
    expect(r).toEqual({ ok: true, blocking: 0, names: [] });
  });

  // ⚠️ **ここが #1038 の本体**＝エンドポイントのエラーを「脆弱性あり」と混ぜない。
  it("エンドポイントのエラーは「読めなかった」（理由も返す）", () => {
    expect(readAudit(JSON.stringify({ error: { code: "E503", summary: "Service Unavailable" } }))).toEqual({
      ok: false,
      reason: "Service Unavailable",
    });
  });

  // ⚠️ **形を当てに行かない**＝読めなければ全部「読めなかった」（fail-closed）。
  it("JSON でない・空・集計が無い、はどれも「読めなかった」", () => {
    expect(readAudit("").ok).toBe(false);
    expect(readAudit("npm warn audit 503").ok).toBe(false);
    expect(readAudit("{}").ok).toBe(false);
    expect(readAudit(JSON.stringify({ metadata: {} })).ok).toBe(false);
    expect(readAudit("null").ok).toBe(false);
  });

  it("集計が0件でも「読めた」（脆弱性が無いことと、読めないことを混ぜない）", () => {
    expect(readAudit(report({ high: 0, critical: 0 })).ok).toBe(true);
  });
});
