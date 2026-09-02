// 素材の番号を使い回さない（α-7 出口監査 🟡）。
//
// ⚠️ 素材のファイル名は `assets/<番号>.<拡張子>` で**固定**なので、空き番号を埋めると
// **同じ名前のファイルを上書きして前の写真が消える**。
// 〈素材を消す → 別の素材を入れる（同じ番号を拾う）→ 前の状態に戻す〉で、戻した文書の
// その番号が**別の写真の中身**を指す＝ファイルは在るので「見つかりません」でも拾えず、
// **黙って別の絵の動画が出る**。⚠️ **通常の取り消しでも起きる**（履歴は `assets` を持たない）。
import { afterEach, describe, expect, it } from "vitest";
import { createAssetId } from "../../domain/project/persistence";
import { reserveAssetId, resetAssetIdReservations } from "./assetImport";

describe("素材の番号を使い回さない（α-7 出口監査 🟡）", () => {
  afterEach(() => resetAssetIdReservations());

  it("消したあとに取り込んでも、消した番号を拾わない", () => {
    const first = reserveAssetId("proj_001", [], createAssetId);
    expect(first).toBe("asset_001");
    // 消した＝いまの文書には無い。しかし**ファイルは残っている**。
    const second = reserveAssetId("proj_001", [], createAssetId);
    expect(second).not.toBe(first);
  });

  it("取り消し・開き直しをまたいで覚えている（文書から消えても番号は返さない）", () => {
    reserveAssetId("proj_001", [], createAssetId); // asset_001
    reserveAssetId("proj_001", ["asset_001"], createAssetId); // asset_002
    // 開き直して文書が空になっても、使った番号は戻らない。
    expect(reserveAssetId("proj_001", [], createAssetId)).toBe("asset_003");
  });

  it("動画ごとに別々（別の動画の番号を巻き込まない）", () => {
    expect(reserveAssetId("proj_001", [], createAssetId)).toBe("asset_001");
    expect(reserveAssetId("proj_002", [], createAssetId)).toBe("asset_001");
  });

  it("いまの文書にある番号も避ける（開き直しで戻ってきたぶん）", () => {
    expect(reserveAssetId("proj_001", ["asset_001", "asset_002"], createAssetId)).toBe("asset_003");
  });
});

/**
 * 場面形式の**取り込みの入口**が、すべて予約を通ること（α-7 出口監査 🟡）。
 *
 * ⚠️ **規則を作っても、配線が漏れたら効かない**＝同じ規則は既にタイムライン形式にあったのに、
 * 場面形式だけ通っておらず、そこで実害が出ていた。**入口の数**を機械で見る。
 * ⚠️ **数で見る**＝どの行かはリファクタで動くが、「3つの入口が予約を通る」は動かない。
 */
describe("場面形式の取り込みが予約を通る（配線の漏れを見る）", () => {
  it("素材を作る3つの入口が、すべて予約経由になっている", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/app/store/projectStore.ts"), "utf8");
    const calls = [...src.matchAll(/(newAssetFrom|assetFromLibrary)\(/g)].length;
    // ⚠️ **2つ目の引数が `[]` か**で見る＝そこに `get().assets.map(...)` を渡す形が
    // 「空き番号を埋める」呼び方。番号は3つ目で渡す（予約したもの／再リンクは既にある番号）。
    const noGapFill = [...src.matchAll(/(newAssetFrom|assetFromLibrary)\([^,]+,\s*\[\],/g)].length;
    const reserved = [...src.matchAll(/(newAssetFrom|assetFromLibrary)\([^,]+,\s*\[\],\s*reserveAssetId\(/g)].length;
    expect(calls, "走査が空振りしている").toBeGreaterThanOrEqual(3);
    // ⚠️ **空き番号を埋める呼び方が1つも無い**＝ここが本体（前の写真を上書きしない）。
    expect(noGapFill, "空き番号を埋める呼び方が残っている").toBe(calls);
    // ⚠️ **取り込みの入口は予約を通る**＝再リンク（既にある番号を使い直す）だけが例外。
    expect(reserved, "予約を通る入口が減った").toBeGreaterThanOrEqual(3);
  });
});

/**
 * **両形式が復元ポイントを作る**こと（α-7 出口監査 🟡）。
 *
 * ⚠️ 場面形式にだけ入れていたので、タイムライン形式は**一度も作られない**のに
 * 一覧の「前の状態に戻す」は出ており、「編集して保存していくと増えていきます」＝
 * **来ない次の行動**を案内していた。⚠️ **配線の漏れは、規則を書くだけでは防げない**。
 */
describe("両形式が復元ポイントを作る（配線の漏れを見る）", () => {
  it("場面形式とタイムライン形式の保存が、どちらも控える経路を通る", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits = ["src/app/store/projectStore.ts", "src/app/store/timelineStore.ts"].map((rel) => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      return { rel, calls: (src.match(/await keepRestorePoints\(/g) ?? []).length };
    });
    const missing = hits.filter((h) => h.calls === 0).map((h) => h.rel);
    expect(missing, "この形式は復元ポイントを作らない（戻すボタンが空のまま）").toEqual([]);
  });
});
