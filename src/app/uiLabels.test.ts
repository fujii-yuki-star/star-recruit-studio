import { describe, expect, it } from "vitest";
import { FITS } from "../domain/enums";
import { bakeNoteText, clipLabel, deleteLookConfirmMessage, fitLabel, formatDiskSize, freeKindLabel, trackLabel, freeSwitchConfirmMessage, sentAssetTextSummary, standardLookButtonReason, standardLookResultMessage, Z_ORDER_LABEL } from "./uiLabels";

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

// #547 P2-9：FREE→通常で「何がいくつ出なくなるか」を先に示す（非破壊なので「消える」とは言わない）。
describe("自由配置→通常の確認文言（#547 P2-9）", () => {
  const none = { slot: 0, text: 0, subtitle: 0, shape: 0, total: 0 };

  it("0 の種別は書かない（「文字0個」を出さない）", () => {
    const m = freeSwitchConfirmMessage({ ...none, slot: 2, total: 2 });
    expect(m).toContain("素材2個");
    expect(m).not.toContain("文字");
    expect(m).not.toContain("図形");
  });

  it("複数の種別は並べて示す（素材だけ言って文字の消失に気づけない、を作らない）", () => {
    const m = freeSwitchConfirmMessage({ slot: 1, text: 2, subtitle: 1, shape: 3, total: 7 });
    expect(m).toContain("素材1個");
    expect(m).toContain("文字2個");
    expect(m).toContain("字幕1個");
    expect(m).toContain("図形3個");
  });

  it("非破壊であること（データは残る・自由配置に戻せば元どおり）を必ず添える", () => {
    const m = freeSwitchConfirmMessage({ ...none, shape: 1, total: 1 });
    expect(m).toContain("データは残る");
    expect(m).toContain("自由配置に戻せば");
    expect(m).not.toContain("消え"); // 「消えます」とは言わない（戻せるので）
  });

  // 確認は答えるまで消さない（ADR-0030 決定3・PR #592 レビュー）ので、確認中に中身を消して0件になった状態も
  // この文言が受け持つ。0件で「出なくなります」と言うと嘘の警告になる（ADR-0026①）。
  it("0件のときは「出なくなる物は無い」と言い切る（嘘の警告を出さない）", () => {
    const m = freeSwitchConfirmMessage(none);
    expect(m).toContain("出なくなる中身はありません");
    expect(m).not.toContain("出なくなります");
    expect(m).toContain("変えますか？"); // 次の行動（このまま変えるか）を示す（§2-5）
  });

  // 語はこのファイルの同種の確認と揃える（§6）。「画面」はこの製品では編集画面を指し、動画のことだと伝わらない。
  it("「動画に出なくなる」で語を揃える（削除確認・まとめて標準にすると同じ言い方）", () => {
    expect(freeSwitchConfirmMessage({ ...none, slot: 1, total: 1 })).toContain("動画に出なくなります");
    expect(deleteLookConfirmMessage({ changing: 1, losingContent: 1, unresolved: 0 })).toContain("動画に出なくなります");
    expect(standardLookResultMessage({ fixed: [1], unfixable: [], lostContent: [1] })).toContain("動画に出なくなった");
  });
});

describe('formatDiskSize（焼き出しで増える容量の目安・ADR-0032 決定13）', () => {
  it('MB は整数へ丸める（読みづらい端数を出さない）', () => {
    expect(formatDiskSize(12.4 * 1024 * 1024)).toBe('約 12MB');
    expect(formatDiskSize(12.6 * 1024 * 1024)).toBe('約 13MB');
  });

  it('1MB に満たないものは「1MB 未満」（0.003MB のような表記にしない）', () => {
    expect(formatDiskSize(0)).toBe('1MB 未満');
    expect(formatDiskSize(3 * 1024)).toBe('1MB 未満');
  });

  it('1024MB 以上は GB で小数1桁', () => {
    expect(formatDiskSize(2.5 * 1024 * 1024 * 1024)).toBe('約 2.5GB');
  });
});

describe('bakeNoteText（持っていけないものの案内）', () => {
  it('対象の場面と「次の行動」を並べる（§2-5）', () => {
    expect(bakeNoteText({ code: 'BAKE_DIALOGUE_SUBTITLE_SKIPPED', sceneNumbers: [2, 5] })).toBe(
      '場面2・5：セリフに合わせて切り替わる字幕は持っていけません。作ったあとに字幕を置き直してください',
    );
  });
});

describe('trackLabel / clipLabel（タイムラインの列と部品の名前・ADR-0032）', () => {
  const tracks = [
    { id: 'track_001', kind: 'visual' as const },
    { id: 'track_002', kind: 'visual' as const },
    { id: 'track_003', kind: 'audio' as const },
  ];

  it('連番は種別ごとに数える（並び全体の通し番号にしない）', () => {
    expect(trackLabel(tracks, 'track_001')).toBe('映像1');
    expect(trackLabel(tracks, 'track_002')).toBe('映像2');
    expect(trackLabel(tracks, 'track_003')).toBe('音1'); // 通し番号なら「音3」になってしまう
  });

  it('名前が付いていればそれを使う', () => {
    expect(trackLabel([{ id: 'track_001', kind: 'audio' as const, name: 'ナレーション' }], 'track_001')).toBe('ナレーション');
  });

  it('部品の名前：付いていれば優先、無ければ中身、それも無ければ種類', () => {
    expect(clipLabel({ kind: 'text', name: 'みだし', text: 'あ' })).toBe('みだし');
    expect(clipLabel({ kind: 'voice', voice: { text: 'よろしくおねがいいたします' } })).toBe('よろしくおねがいいたしま'); // 長いものは切る（列の幅を壊さない）
    expect(clipLabel({ kind: 'shape' })).toBe('図形');
  });

  it('自由配置と同じ物は同じ名前で呼ぶ（画面で語が割れない）', () => {
    expect(clipLabel({ kind: 'slot' })).toBe(freeKindLabel.slot);
  });
});
