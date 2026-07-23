import { describe, expect, it } from "vitest";
import { FITS } from "../domain/enums";
import { deleteLookConfirmMessage, fitLabel, sentAssetTextSummary, standardLookButtonReason, standardLookResultMessage, Z_ORDER_LABEL } from "./uiLabels";

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
  it("標準へ変わる場面数を示す", () => {
    expect(deleteLookConfirmMessage({ changing: 3, losingContent: 0, unresolved: 0 })).toContain("3個の場面は、標準の見た目に変わります");
  });

  it("中身が出なくなる場面数も示す（削除は取り消せないため）", () => {
    expect(deleteLookConfirmMessage({ changing: 3, losingContent: 1, unresolved: 0 })).toContain("うち1個の場面は写真・文字などが動画に出なくなります");
  });

  // 合う標準が無い場面は「変わります」に数えない＝約束と実挙動をずらさない（この場面は未解決のまま残る）。
  it("合う標準が無い場面は「変わります」と言わず、書き出せないことを伝える", () => {
    const msg = deleteLookConfirmMessage({ changing: 0, losingContent: 0, unresolved: 2 });
    expect(msg).not.toContain("標準の見た目に変わります");
    expect(msg).toContain("2個の場面は合う標準が無いため、見た目を選び直すまで書き出せません");
  });

  it("使っていなければ場面の話は出さない", () => {
    const msg = deleteLookConfirmMessage();
    expect(msg).not.toContain("標準の見た目に変わります");
    expect(msg).toContain("元に戻せません");
  });
});

// #547 P2-8：送信前確認の要約。写真/動画だけ数えて他を無視すると、展開一覧と食い違う（§2-6）。
describe("sentAssetTextSummary（送信前確認の素材要約）", () => {
  it("ある種別だけを並べる（0 の種別は書かない）", () => {
    expect(sentAssetTextSummary(3, 1, 0)).toBe("写真3枚・動画1本ぶんの文字情報");
    expect(sentAssetTextSummary(2, 0, 0)).toBe("写真2枚ぶんの文字情報");
  });

  it("写真・動画が無くても、それ以外（ゆうこ・ロゴ等）があれば件数を出す（「写真0枚」で矛盾させない）", () => {
    expect(sentAssetTextSummary(0, 0, 1)).toBe("ほか1件ぶんの文字情報");
    expect(sentAssetTextSummary(2, 0, 1)).toBe("写真2枚・ほか1件ぶんの文字情報");
  });

  it("素材が無ければ空文字（呼び出し側でフォールバック）", () => {
    expect(sentAssetTextSummary(0, 0, 0)).toBe("");
  });
});

// #547 P2-10/P2-11：収め方・重ね順の表記を正典（06_UI_SPEC §9／§3）に合わせ、画面間で1か所に集約する。
describe("収め方・重ね順の表記（#547 P2-10/P2-11）", () => {
  it("fitLabel は全ての Fit 値をもち、正典語（枠いっぱい/全体/伸縮）を使う", () => {
    for (const f of FITS) expect(fitLabel[f]).toBeTruthy(); // enum 追加漏れ検知
    expect(fitLabel.cover).toContain("枠いっぱい");
    expect(fitLabel.contain).toContain("全体");
    expect(fitLabel.stretch).toContain("伸縮");
  });

  it("重ね順の見出しは正典語「重ね順」（「重なり順」にしない）", () => {
    expect(Z_ORDER_LABEL).toBe("重ね順");
  });
});
