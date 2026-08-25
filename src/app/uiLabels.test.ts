import { describe, expect, it } from "vitest";
import { FITS } from "../domain/enums";
import { EDIT_BLOCKED } from "../domain/timeline/edit";
import { DELETE_LABEL, canvasHoldMessage, DUPLICATE_LABEL, bakeNoteText, clipLabel, editBlockedMessage, deleteLookConfirmMessage, fitLabel, formatDiskSize, freeKindLabel, trackLabel, freeSwitchConfirmMessage, sentAssetTextSummary, standardLookButtonReason, standardLookResultMessage, Z_ORDER_LABEL, exportBlockedMessage, bakeNoteMessage, lockedTrackMessage, hiddenTrackDuplicateMessage, volumePointsTooManyMessage, missingTemplateMessage, resolveExportBlockedMessage } from "./uiLabels";
import { TIMELINE_EXPORT_BLOCK } from "../domain/timeline/export";
import { TIMELINE_CLIP_KIND, PROJECT_FORMAT } from "../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../domain/timeline/types";
import type { TimelineClip, TimelineProject } from "../domain/timeline/types";

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

  // #763-6：同じ操作は同じ言い方。以前はキャンバス「複製／削除」・帯「同じものを足す／消す」と
  // 割れていた。一般的な動画編集用語をそのまま使う（ADR-0034 決定21）。
  it("複製・削除は一般語のまま（言い換えへ戻さない）", () => {
    expect(DUPLICATE_LABEL).toBe("複製");
    expect(DELETE_LABEL).toBe("削除");
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

describe('editBlockedMessage（置けなかった理由の案内）', () => {
  it('全ての理由に文言がある（無言で操作が効かない状態を作らない）', () => {
    for (const reason of Object.values(EDIT_BLOCKED)) {
      expect(editBlockedMessage[reason]).toBeTruthy();
    }
  });

  it('「なぜ置けないか」でなく「次にどうすれば置けるか」を言う（§2-5）', () => {
    expect(editBlockedMessage.TIMELINE_EDIT_OVERLAP).toContain('ずらすか、列を足して');
    expect(editBlockedMessage.TIMELINE_EDIT_LOCKED).toContain('固定を外して');
    expect(editBlockedMessage.TIMELINE_EDIT_CONTENT_FIELD).toContain('選び直して');
  });

  it('項目違いを「列に置き直して」と案内しない（別の失敗に別の理由・#684 レビュー）', () => {
    // 列の種別違い（V23）専用の案内を、中身の項目違いへ流用すると**無関係な次の行動**を出す。
    expect(editBlockedMessage.TIMELINE_EDIT_CONTENT_FIELD).not.toBe(editBlockedMessage.TIMELINE_EDIT_TRACK_KIND);
    expect(editBlockedMessage.TIMELINE_EDIT_CONTENT_FIELD).not.toContain('列');
  });
});

// §2-3（通常UIに技術用語を出さない）を**機械で**守る（#750 再レビュー）。
//
// ⚠️ この漏れは目視レビューで繰り返し見つかっている。文言を1つ直すだけでは次が漏れるので、
// **一覧をまとめて走査する**。ここに載っている表は、そのまま画面に出る（断りのバナー・
// ボタンの理由・焼き出しの注意）。
describe("canvasHoldMessage（キャンバスで掴めない理由・#788-1）", () => {
  // ⚠️ **単体とまとめてで示す行き先が違う**＝まとめて（2つ以上選んでいる）ときは「位置・大きさ」の欄が
  // 画面から消えるので、数値や「動き」を案内すると**探しても見つからない**（§2-5 の行き止まり）。
  it("単体は目の前にある行き先（下の数値・「動き」）を示す", () => {
    expect(canvasHoldMessage("animation")).toContain("下の数値（または矢印キー）");
    expect(canvasHoldMessage("animation")).toContain("「動き」で調整してください");
    expect(canvasHoldMessage("group")).toContain("下の数値（または矢印キー）");
    expect(canvasHoldMessage("group")).not.toContain("「動き」"); // まとまりの変形は「動き」では外せない
  });

  it("まとめては、その場面で本当に押せるもの（矢印キー）だけを示す", () => {
    for (const reason of ["animation", "group"] as const) {
      const m = canvasHoldMessage(reason, 2);
      expect(m).toContain("矢印キーで動かせます");
      expect(m).toContain("1つだけ選ぶと数値でも変えられます");
      expect(m).not.toContain("下の数値（または矢印キー）"); // 画面に無いものを指さない
      expect(m).not.toContain("「動き」で調整");
    }
  });

  // ⚠️ 固定した列は**矢印も効かない**ので、まとめてでも矢印を案内しない（効かない道を示さない）。
  it("固定した列は、単体でもまとめても「固定を外す」だけを示す", () => {
    expect(canvasHoldMessage("track")).toBe("固定された列の部品は仕上がり確認の上では動かせません。動かすには固定を外してください。");
    expect(canvasHoldMessage("track", 3)).toBe("固定された列の部品3個は動かしていません。動かすには固定を外してください。");
  });

  it("個数はそのまま出る（1個に固定されない）", () => {
    expect(canvasHoldMessage("animation", 1)).toContain("部品1個は");
    expect(canvasHoldMessage("animation", 5)).toContain("部品5個は");
    expect(canvasHoldMessage("animation")).not.toContain("個は"); // 単体は個数を言わない
  });
});

describe("利用者に出す文言に技術用語を混ぜない（§2-3）", () => {
  // CLAUDE.md §2-3 の禁止語。置換語は `06_UI_SPEC.md §3`。
  // ⚠️ 「動画編集の一般語」（分割・ズーム・吸着・トリム）は対象外＝ADR-0034 決定21 で整理済み。
  const BANNED = [
    "キーフレーム", "JSON", "FFmpeg", "LLM", "Provider", "templateId", "assetId", "clipId",
    "レンダリング", "バリデーション", "スキーマ", "プロパティ", "オブジェクト", "パース",
    "null", "undefined", "boolean", "enum",
  ];

  const MAPS: Record<string, Record<string, string>> = {
    editBlockedMessage,
    exportBlockedMessage,
    bakeNoteMessage,
    // ⚠️ **共有関数が返す文も走査に入れる**（#819-2）＝この検査は Record しか見ないので、
    // 関数で作る文は**そのままだと検査の外**に落ちる（画面直書きが見つからなかったのと同じ穴）。
    sharedFunctions: {
      lockedTrackContent: lockedTrackMessage("content"),
      lockedTrackDelete: lockedTrackMessage("delete"),
      hiddenTrackDuplicate: hiddenTrackDuplicateMessage(),
      volumePointsTooManySplittable: volumePointsTooManyMessage(true),
      volumePointsTooManyUnsplittable: volumePointsTooManyMessage(false),
      missingTemplateOne: missingTemplateMessage(),
      missingTemplateMany: missingTemplateMessage(3),
    },
  };

  for (const [name, map] of Object.entries(MAPS)) {
    it(`${name} は禁止語を含まない`, () => {
      const bad: string[] = [];
      for (const [key, text] of Object.entries(map)) {
        for (const word of BANNED) {
          if (text.includes(word)) bad.push(`${key}: 「${word}」← ${text}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

// 固定した列の断り（#819-2）。**画面で手書きしない**ために共有関数へ寄せたので、
// 「何をしようとしたか」で締めが変わることと、禁止語が混ざらないことをここで見る
//（画面側のテストは「共有関数を通っているか」を見るので、文そのものはここでしか守れない）。
describe("lockedTrackMessage（固定した列でできないこと）", () => {
  it("やろうとしたことで締めが変わる（全部同じ文にしない）", () => {
    const texts = (["content", "delete"] as const).map((a) => lockedTrackMessage(a));
    expect(new Set(texts).size).toBe(2);
    expect(lockedTrackMessage("content")).toContain("中身を変える");
    expect(lockedTrackMessage("delete")).toContain("削除する");
  });

  it("どれも次の行動（固定を外す）で終わる＝行き止まりにしない", () => {
    for (const a of ["content", "delete"] as const) {
      expect(lockedTrackMessage(a)).toContain("固定を外してください");
    }
  });

  // #831＝複製は `editGuard` の選択の関門（"content"）が先に締めるので、複製専用の変種は
  // どこからも呼ばれていなかった（テストだけが呼ぶ到達不能な定義）。型から `"duplicate"` を
  // 落としたので、これ以上は `tsc` が守る（呼べば型エラー）＝ここでは残る2件の文言だけを見る。
  it("「複製する」の文言は持たない", () => {
    expect(lockedTrackMessage("content")).not.toContain("複製する");
    expect(lockedTrackMessage("delete")).not.toContain("複製する");
  });

  // ⚠️ **共有の `TIMELINE_EDIT_HIDDEN_TRACK` を使えない理由がここにある**＝あちらの次の行動
  //（ほかの列へ置く）は、複製では効かない（複製は必ず元の列に作る）。**その列を出す**まで言う。
  it("動画に出さない列の複製は、その列を出す道を示す（ほかの列へ、では効かない）", () => {
    expect(hiddenTrackDuplicateMessage()).toContain("動画に出す");
  });

});

// #834-2＝画面2か所に手書きされていた（`15 §6` の `TIMELINE_TEMPLATE_NOT_FOUND`）。手書きは上の
// 禁止語の検査の走査対象の外に落ちるので、共有関数へ寄せたうえで**文そのものはここで守る**
//（画面側のテストは「共有関数を通っているか」しか見られない＝`lockedTrackMessage` と同じ流儀）。
describe("missingTemplateMessage（見た目パターンが見つからない・#834-2）", () => {
  it("1つのときは件数を出さず、その部品の話にする", () => {
    expect(missingTemplateMessage()).toContain("この部品");
    expect(missingTemplateMessage()).not.toMatch(/\d+個/);
  });

  it("件数を渡すと件数と「どうなるか」を添える（後回しの判断ができる）", () => {
    expect(missingTemplateMessage(3)).toContain("3個");
    expect(missingTemplateMessage(3)).toContain("動画に出ません");
  });

  it("どちらも次の行動（消して置き直す）で終わる＝行き止まりにしない", () => {
    for (const t of [missingTemplateMessage(), missingTemplateMessage(2)]) {
      expect(t).toContain("置き直してください");
    }
  });

  // ⚠️ **「読み込み直す」は名指ししない**（#812）＝読み直す操作は画面に無く、自作のものを消した
  // 場合は読み直しても戻らない＝実行できない／効果の無い行動になる（§2-5）。
  it("「読み込み直す」を薦めない（実行できない行動を出さない）", () => {
    for (const t of [missingTemplateMessage(), missingTemplateMessage(2)]) {
      expect(t).not.toContain("読み込み直");
    }
  });
});

// #831＝「部品を分けてください」は読み上げには実行できない行動だった。分けられる部品が
// 1つでもあるかで締めを変える（`lockedTrackMessage` と同じ流儀）。
describe("volumePointsTooManyMessage（音量の点が多すぎる・分けを案内してよいか＝#831）", () => {
  it("分けられる部品があるときだけ「部品を分けてください」を添える", () => {
    expect(volumePointsTooManyMessage(true)).toContain("部品を分けてください");
    expect(volumePointsTooManyMessage(false)).not.toContain("分けて");
  });

  it("読み上げだけのときも、行き止まりにしない（外すだけでも次の行動になる）", () => {
    expect(volumePointsTooManyMessage(false)).toContain("いらない点を外してください");
  });
});

function timelineDoc(clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260824_001",
    projectName: "テスト",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [],
    clips,
  };
}

// `resolveExportBlockedMessage` は画面（`TimelineProjectScreen`）・`exportStartBlock` の両方が呼ぶ
// 実際の窓口。ここが割り振りを誤ると、両方が同時に間違った文言を出す（#831）。
describe("resolveExportBlockedMessage（コードで振り分け・#831）", () => {
  it("volumePointsTooMany は部品の種類を見て振り分ける", () => {
    const audio = { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "t", startSec: 0, durationSec: 1 } as TimelineClip;
    const voice = { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "t", startSec: 0, durationSec: 1 } as TimelineClip;
    expect(resolveExportBlockedMessage(TIMELINE_EXPORT_BLOCK.volumePointsTooMany, timelineDoc([audio]), ["clip_001"])).toBe(
      volumePointsTooManyMessage(true),
    );
    expect(resolveExportBlockedMessage(TIMELINE_EXPORT_BLOCK.volumePointsTooMany, timelineDoc([voice]), ["clip_002"])).toBe(
      volumePointsTooManyMessage(false),
    );
  });

  it("ほかのコードは exportBlockedMessage をそのまま返す（doc/clipIds は見ない）", () => {
    expect(resolveExportBlockedMessage(TIMELINE_EXPORT_BLOCK.empty, timelineDoc([]), [])).toBe(exportBlockedMessage.TIMELINE_EXPORT_EMPTY);
  });
});
