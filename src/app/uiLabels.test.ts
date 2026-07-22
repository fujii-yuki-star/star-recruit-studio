import { describe, expect, it } from "vitest";
import { deleteLookConfirmMessage, standardLookButtonReason, standardLookResultMessage } from "./uiLabels";

// #547：一括操作は「押せない理由」と「やった結果」を言葉で出す（§2-5・15 §5「3件を自動調整、1件は確認が必要」）。
describe("standardLookButtonReason（押せない理由・#547）", () => {
  it("書き出し中は書き出し中だと言う（実行内容の説明を出し続けない）", () => {
    const r = standardLookButtonReason(3, true);
    expect(r).toContain("書き出し中");
    expect(r).toContain("もう一度"); // 次の行動
  });

  it("当て先が無いときは選び直しを促す", () => {
    expect(standardLookButtonReason(0, false)).toContain("選び直してください");
  });

  it("押せるときは何が起きるかを説明する", () => {
    expect(standardLookButtonReason(3, false)).toContain("まとめて変えます");
  });

  it("書き出し中の理由が当て先なしより優先される（押せない実際の原因を示す）", () => {
    expect(standardLookButtonReason(0, true)).toContain("書き出し中");
  });
});

describe("standardLookResultMessage（一括適用の結果・#547）", () => {
  it("直しただけなら件数を伝える（余計な注意を足さない）", () => {
    const r = standardLookResultMessage({ fixed: [1, 2], unfixable: [], lostContent: [] });
    expect(r).toBe("2個の場面を標準の見た目にしました。");
  });

  it("動画に出なくなった中身のある場面は名指しで入れ直しを促す", () => {
    const r = standardLookResultMessage({ fixed: [1, 3], unfixable: [], lostContent: [3] });
    expect(r).toContain("2個の場面");
    expect(r).toContain("場面3");
    expect(r).toContain("入れ直してください");
  });

  it("直せなかった場面も混ざったら、両方を分けて伝える（どちらの理由かが分かる）", () => {
    const r = standardLookResultMessage({ fixed: [1], unfixable: [4], lostContent: [1] });
    expect(r).toContain("このうち場面1は写真・文字などが動画に出なくなった");
    expect(r).toContain("場面4は合う標準の見た目が無い");
  });

  it("1件も直せなければ、直せない場面の話だけをする（0件を「しました」と言わない）", () => {
    const r = standardLookResultMessage({ fixed: [], unfixable: [2], lostContent: [] });
    expect(r).not.toContain("しました");
    expect(r).toContain("場面2");
  });

  it("場面が多いときの並べ方は公開前チェックの各項目と同じ（先頭8件＋ほかN件）", () => {
    const r = standardLookResultMessage({ fixed: [], unfixable: [1, 2, 3, 4, 5, 6, 7, 8, 9], lostContent: [] });
    expect(r).toContain("場面1・2・3・4・5・6・7・8 ほか1件");
  });
});

describe("deleteLookConfirmMessage（削除の影響を先に示す・#547）", () => {
  it("使用中の場面数を示す", () => {
    expect(deleteLookConfirmMessage(3)).toContain("3個の場面");
  });

  it("使っていなければ場面の話は出さない", () => {
    expect(deleteLookConfirmMessage(0)).not.toContain("標準の見た目に変わります");
  });
});
