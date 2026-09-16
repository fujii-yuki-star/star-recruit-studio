// 「ファイルを選び直す」の呼び名が、画面のどこでも同じであること（#1169）。
//
// ⚠️ **利用者は画面の文字でボタンを探す**ので、片方だけ言い換えると**行き先が消える**（§2-5）。
// ⚠️ **2件だけは寄せられない**（PR #1180 レビュー 🟡＝最初は5件を同じ理由で束ねていたが、事実と違った）。
//    守られ方が3種類あり、**ソースの書き方まで見るもの**だけが組み立てを拒む：
//      ① `CAPTURE_FRAME_ASSET_MISSING_MESSAGE`＝`messageConstsOf` が `export const *_MESSAGE` の
//         **ソースを読んで**引用符リテラルだけで出来ているかを見る → `${…}` を混ぜると赤。
//      ② タイムラインの「音が出せない素材があります…」＝表にしか無い文なので
//         **ソースに丸ごと在るか**（`sourceBlob().includes`）で守られる → 割ると赤。
//      ③ `editBlockedMessage`／`exportBlockedMessage` の断りと `audioUnreadableMessage`＝
//         **評価後の文字列どうし**の等値（あるいは等値の対象外）なので、**組み立ててよい** → 寄せた。
//    ＝寄せられるものは寄せ、①②だけをこの検査で留める。改名したら赤くなり、直す先が名指しで出る。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAPTURE_FRAME_ASSET_MISSING_MESSAGE,
  RELINK_ASSET_LABEL,
  audioUnreadableMessage,
  editBlockedMessage,
  exportBlockedMessage,
} from "./uiLabels";
import { AUDIO_SOURCE_KIND } from "../domain/timeline/audio";
import { EDIT_BLOCKED } from "../domain/timeline/edit";
import { TIMELINE_EXPORT_BLOCK } from "../domain/timeline/export";

/**
 * 呼び名を**中に含む**と決めた文。
 *
 * ⚠️ **寄せた文もここで見る**＝組み立て（`${RELINK_ASSET_LABEL}`）にしたものは改名に自動で追随するが、
 * **素の文字列へ書き戻す変異**はここでしか捕まらない（`呼び名が写しのまま` で赤くなる）。
 */
const 呼び名を含む文: [string, string][] = [
  ["写真にする欄の断り（寄せられない①）", CAPTURE_FRAME_ASSET_MISSING_MESSAGE],
  ["絵を止めるの断り（寄せた）", editBlockedMessage[EDIT_BLOCKED.freezeAssetMissing]],
  ["書き出しの断り（動画のファイルが無い・寄せた）", exportBlockedMessage[TIMELINE_EXPORT_BLOCK.videoFileMissing]],
  ["音が読めないの断り（取り込んだ素材・寄せた）", audioUnreadableMessage(AUDIO_SOURCE_KIND.asset)],
];

describe("「ファイルを選び直す」の呼び名（#1169）", () => {
  it.each(呼び名を含む文)("%s は、同じ呼び名で言う", (_名, 文) => {
    expect(文, "呼び名が写しのまま（改名しても、この文だけ旧名で残る）").toContain(RELINK_ASSET_LABEL);
  });

  // ⚠️ **寄せた側は数で留める**（§7）＝「定数を使っている」だけだと、2か所のうち1か所を
  //    写しに戻しても緑になる。
  it("画面のボタン・案内は、定数から呼んでいる", () => {
    const 本文 = (p: string): string => readFileSync(p, "utf8");
    const timeline = 本文("src/app/screens/TimelineProjectScreen.tsx");
    // ボタン2つ（絵の側・音の側）＋案内1つ＝3か所。
    expect(timeline.split("RELINK_ASSET_LABEL").length - 1, "タイムライン形式が定数から呼んでいない").toBeGreaterThanOrEqual(4);
    expect(本文("src/app/adapters.ts"), "書き出し前の断りが写しのまま").toContain("RELINK_ASSET_LABEL");
    expect(本文("src/app/screens/MaterialsScreen.tsx"), "素材画面が定数から呼んでいない").toContain("RELINK_ASSET_LABEL");
  });

  // ⚠️ **写しが増えていないこと**も見る＝寄せた先の外で、また素の文字列を書き始めたら気づく。
  //    ⚠️ **数で留める**（下限にしない）＝増えても減っても、対応を確かめてから直す。
  //    ⚠️ **見ているのはこの4ファイルの中だけ**（PR #1180 レビュー ℹ️）＝別の画面に新しく
  //    素の文字列で書かれた分はここでは拾えない。その形は `uiMessageScan` の走査
  //   （`src/app`・`src/infrastructure` を歩き、案内らしい文を表と突き合わせる）が受け持つ。
  it("素の文字列で書いた呼び名は、決めた数しか残っていない", () => {
    const 対象 = [
      "src/app/screens/TimelineProjectScreen.tsx",
      "src/app/screens/MaterialsScreen.tsx",
      "src/app/adapters.ts",
      "src/app/uiLabels.ts",
    ];
    const 本番 = (p: string): string =>
      readFileSync(p, "utf8")
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
    const n = 対象.reduce((acc, p) => acc + (本番(p).split(RELINK_ASSET_LABEL).length - 1), 0);
    // 内訳＝`uiLabels` の定義1＋**寄せられない2件**（①写真にする欄の断り／②タイムラインの音の案内）。
    // ⚠️ **ここが増えたら、まず寄せられないかを疑う**＝守られ方が③（評価後の等値）なら寄せられる。
    expect(n, "呼び名の写しが増減した（寄せられるなら寄せる・寄せられないなら上の一覧へ足す）").toBe(3);
  });
});
