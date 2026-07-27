// 複数画面で共有するユーザー向けラベル（§6：文言は1か所に集約／§2-3：技術用語を出さない）。
import { AI_ASSET_SEND_MAX } from "../domain/constants";
import { FREE_ELEMENT_KINDS, SUBTITLE_SOURCE_KIND } from "../domain/enums";
import type { AssetType, Fit, FreeElementKind, SubtitleSourceKind, TextKey } from "../domain/enums";
import type { FreeContentHidden } from "../domain/project/sceneOps";
import type { SubtitleSilentReason } from "../domain/project/subtitleBinding";
import { formatSceneNumbers } from "./adapters";

/**
 * 「枠への収め方」（Fit）のユーザー向け名称。全値必須＝enum 追加漏れをコンパイル検知。
 * 語彙は `06_UI_SPEC §9`（シーン編集→右パネル・枠いっぱい/全体/伸縮）に合わせる。FitSelect（動画クリップ・画像スロット）と
 * LooksEditScreen（テンプレ編集）が**同じ語**を使うための単一の参照元（§6・#547 P2-10）。
 */
/** 「枠への収め方」欄の見出し。正典 `06_UI_SPEC §9`（右パネル）＝「枠への収め方」。テンプレ編集・場面編集で共有（§6・#547 P2-10）。 */
export const FIT_FIELD_LABEL = "枠への収め方";

export const fitLabel: Record<Fit, string> = {
  cover: "枠いっぱいに表示（はみ出しは切り取り）",
  contain: "全体を表示（余白が入る）",
  stretch: "枠に合わせて伸縮",
};

/** 重ね順（要素の前後関係）のユーザー向け見出し。正典は「重ね順」（`06_UI_SPEC §3`＝layer→要素・並び順）。#547 P2-11。 */
export const Z_ORDER_LABEL = "重ね順";

/**
 * 自由配置の要素種別のユーザー向け名称（§2-3：技術語を出さない）。全 kind 必須＝追加時にコンパイル検知。
 * 自由配置エディタ（要素名・編集ポップオーバー・貼り付け）と、切替の確認文言が**同じ語**を使うための単一の参照元（§6・#547 P2-9）。
 */
export const freeKindLabel: Record<FreeElementKind, string> = {
  slot: "素材",
  text: "文字",
  shape: "図形",
  subtitle: "字幕",
};

/**
 * 自由配置→通常の見た目へ変えるときの確認（#547 P2-9・ADR-0030）。
 *
 * 切替は非破壊（自由配置のデータは残る）なので「消えます」とは言わない。ただし通常の見た目には自由配置の枠が無く、
 * **差し込み先を超えた分は動画に出なくなる**。何がいくつ出なくなるかを先に示す（15 §5 の件数表示の流儀・ADR-0026④）。
 * 数は `freeContentHiddenBySwitch` で描画と同じ規則から出す＝「出なくなる」と言った数だけ実際に出なくなる。
 * 語はこのファイルの他の確認（`deleteLookConfirmMessage`／`standardLookResultMessage`）と揃えて「**動画に**出なくなる」（§6）。
 *
 * 種別名は自由配置エディタと同じ `freeKindLabel` を使う（同じ物を画面内で別の名で呼ばない）。並べる順・対象は
 * `FREE_ELEMENT_KINDS` を回して決める＝**種別が増えても文言から漏れない**（増えた種別の名前は `freeKindLabel` が
 * Record なのでコンパイルエラーになり、決めるまでビルドが通らない）。
 *
 * 0件のとき（確認中に中身を消した）も**確認は残す**ので、ここで言い切る。件数で確認ごと出し入れすると、消して
 * 足し直しただけで**触ってもいない確認が蘇る**（ADR-0030 決定3・PR #592 レビュー）。嘘の警告も出さない（ADR-0026①）。
 */
export function freeSwitchConfirmMessage(hidden: FreeContentHidden): string {
  const parts = FREE_ELEMENT_KINDS.filter((k) => hidden[k] > 0).map((k) => `${freeKindLabel[k]}${hidden[k]}個`);
  if (parts.length === 0) return "通常の見た目に変えても、動画に出なくなる中身はありません。この見た目に変えますか？";
  return `通常の見た目に変えると、${parts.join("・")}が動画に出なくなります。データは残るので、自由配置に戻せば元どおりになります。`;
}

// ── 字幕（#547 P3-9）。置いた字幕が出ないときの案内が、実際のスイッチ名・欄名と同じ語で呼ぶための単一の参照元（§6）。 ──

/** 場面の字幕スイッチの表示名（場面編集の読み上げ欄）。案内文が別名で呼ぶと、探しても見つからない指示になる。 */
export const SCENE_SUBTITLE_TOGGLE_LABEL = "この場面の字幕を表示する";
/** セリフごとの字幕スイッチの表示名（掛け合いの各行）。上と同じ理由でここに置く。 */
export const LINE_SUBTITLE_TOGGLE_LABEL = "字幕を表示する";
/** 自由配置の字幕要素で、読み上げの字幕文を入れる欄の見出し。 */
export const SUBTITLE_TEXT_FIELD_LABEL = "字幕の文";

/**
 * 理由ごとの「どうすれば出るか」（#547 P3-9）。全 reason 必須＝理由が増えたら文言の決め漏れをコンパイル検知。
 * `noText` だけは対象で直す場所が変わる（読み上げ＝この欄／セリフ＝各セリフ側）ので、対象種別を受けて出し分ける。
 */
const SILENT_SUBTITLE_NEXT_ACTION: Record<SubtitleSilentReason, (sourceKind: SubtitleSourceKind) => string> = {
  sceneSubtitleOff: () => `「${SCENE_SUBTITLE_TOGGLE_LABEL}」がオフになっています。オンにすると出ます。`,
  noTargetLine: () => "選んだ話者のセリフが、この場面にありません。対象を選び直すか、その話者のセリフを足してください。",
  noText: (sourceKind) =>
    sourceKind === SUBTITLE_SOURCE_KIND.narration
      ? `「${SUBTITLE_TEXT_FIELD_LABEL}」に文字を入れると出ます。`
      : `対象のセリフの字幕が空か、そのセリフの「${LINE_SUBTITLE_TOGGLE_LABEL}」がオフになっています。`,
};

/**
 * 置いた字幕が動画に出ないときの手がかり（#547 P3-9・§2-5＝原因ではなく次の行動／ADR-0026④）。
 *
 * 字幕ボックスは表示文を「対象」から解決するため、**要素の外**（場面の字幕スイッチ・セリフごとの字幕・話者の顔ぶれ）
 * が原因で何も出ないことがある。置いた本人はその外側を見ていないので、黙って出ないと「置いたのに出ない」だけが残る。
 * どの理由かは `subtitleSilentReason`（domain・公開前チェックと同じ単一の参照元）が決め、ここは言い方だけを持つ。
 */
export function silentSubtitleMessage(reason: SubtitleSilentReason, sourceKind: SubtitleSourceKind): string {
  return `この字幕は、いまは動画に出ません。${SILENT_SUBTITLE_NEXT_ACTION[reason](sourceKind)}`;
}

// ── 声の一括作成（#547 P2-6）。たたき台・場面編集・公開前チェックの3画面で同じ語・同じ挙動にする（§6・ADR-0026②）。 ──

/** 一括作成ボタンの通常時の文言（既定）。公開前チェックだけは検査項目側の導線名（「声を作成」）を使う。 */
export const BULK_VOICE_LABEL = "全場面の声を作成";
/** 作成中のボタン文言。以前は画面ごとに「作成中…」「準備中…」が混在していた（#547 ④）。 */
export const BULK_VOICE_BUSY_LABEL = "作成中…";
/** 一括作成を止めるボタンの文言。 */
export const BULK_VOICE_CANCEL_LABEL = "中止する";

/** 一括作成の状態（進捗表示の括弧書き）。 */
export type BulkVoiceState = "generating" | "cancelled" | "idle";

/**
 * 「声 3/10（作成中…）」。行単位の進捗（掛け合いは行ごと）＝`narrationProgress` の結果をそのまま見せる。
 *
 * 中止したときは同じ形で「（中止しました）」を出す＝**分数がそのまま残る**ので、作った声は消えていないことが
 * 数字で分かる（別の注意書きを足さなくても済み、上部バーや表の狭い場所にも同じ表示を置ける・§2-5）。
 * 次の行動（作成し直す）は隣のボタンがそのまま担う。
 */
export function bulkVoiceProgressText(done: number, total: number, state: BulkVoiceState): string {
  const suffix = state === "generating" ? `（${BULK_VOICE_BUSY_LABEL}）` : state === "cancelled" ? "（中止しました）" : "";
  return `声 ${done}/${total}${suffix}`;
}

/**
 * 一括作成が押せない理由（押せないのに理由が出ない、を作らない＝§2-5）。押せるときは undefined。
 *
 * 「作る対象が無い」は2種類あり、混同すると嘘になる：**セリフが1つも無い**（まだ何も書いていない）と
 * **全部作成済み**（書いた声はもうある）。前者に「作成済みです」と言うと、作った覚えのない声があることになる。
 */
export function bulkVoiceDisabledReason(state: {
  isExporting: boolean;
  generating: boolean;
  /** まだ声が要る場面があるか（`sceneNeedsVoice`）。 */
  needsVoice: boolean;
  /** 声の対象になるセリフが1つでもあるか（`narrationProgress().total > 0`）。 */
  hasNarrationText: boolean;
}): string | undefined {
  if (state.isExporting) return "動画の書き出し中は声を作成できません。書き出しが終わってから、もう一度お試しください。";
  if (state.generating) return "いま声を作成しています。止めるときは「中止する」を押してください。";
  // 対象が無いのに押せると「押しても何も起きない」になる（ADR-0026④）。どうすれば押せるようになるかを添える。
  if (!state.hasNarrationText) return "まだセリフがありません。場面にセリフを入れると、ここで声を作れます。";
  if (!state.needsVoice) return "すべての場面の声が作成済みです。セリフを書き直すと、その場面の声を作り直せます。";
  return undefined;
}

/**
 * 送信前確認の「素材の説明・タグ」行の要約（#547 P2-8）。写真・動画・それ以外（ゆうこ/ロゴ等）の件数を出す。
 * **写真・動画だけを数えて他を無視すると、展開一覧に出るのに要約が「写真0枚・動画0本」と食い違う**（§2-6 の確認を妨げる）。
 * 0 の種別は書かない（「写真0枚」を出さない）。素材が無ければ空文字（呼び出し側で扱う）。
 */
export function sentAssetTextSummary(photo: number, video: number, other: number): string {
  const parts: string[] = [];
  if (photo > 0) parts.push(`写真${photo}枚`);
  if (video > 0) parts.push(`動画${video}本`);
  if (other > 0) parts.push(`ほか${other}件`);
  return parts.length === 0 ? "" : `${parts.join("・")}ぶんの文字情報`;
}

/**
 * 素材が多くて送りきれなかった件数の案内（12§6 の「無言の打ち切りをしない」・#585）。
 * **何が起きるか（送られない）＋なぜ（多いから説明の詳しい順）＋次の行動（説明を足す／減らす）**を出す（§2-5）。
 * 件数は `selectAssetsForSend` の `omitted` と同じ数＝画面と実送信がズレない（§2-6・ADR-0026②）。
 */
export function omittedAssetsNote(omitted: number): string {
  return `素材が多いため、説明の詳しい順に${AI_ASSET_SEND_MAX}件だけ送ります（残り${omitted}件は送りません）。送りたい素材には説明やタグを足すか、使わない素材を減らしてください。`;
}

/** 素材種別（assetType）のユーザー向け名称。全値必須＝enum 追加漏れをコンパイル検知。§2-3（技術用語を出さない）。 */
export const assetTypeLabel: Record<AssetType, string> = {
  image: "写真",
  video: "動画",
  bgm: "BGM",
  voice: "音声",
  yuko: "ゆうこ",
  decor: "飾り",
  logo: "ロゴ",
  qr: "QRコード",
};

/** テキスト種別（textKey）のユーザー向け名称。テンプレ編集・場面編集の双方で使う。全値必須＝enum 追加漏れをコンパイル検知。 */
export const textKeyLabel: Record<TextKey, string> = {
  title: "見出し",
  main: "本文",
  subtitle: "字幕",
  caption: "キャプション",
  url: "URL",
};

/**
 * マイ見た目の削除確認に出す文言（#547）。
 *
 * 削除は**場面の見た目が変わる**という副作用を伴う（開いているプロジェクトで使用中の場面は標準の見た目へ
 * 置き換わる＝`substituteDeletedTemplateInScenes`・#458）。「元に戻せません」だけでは何がどれだけ変わるのか
 * 分からず、**黙って別の見た目に差し替わったのと同じ**になるため、影響を先に示す
 * （§2-5／`15_ERROR_STATE_MODEL` の `TEMPLATE_NOT_FOUND` ③＝納得のうえ行う明示操作にする）。
 *
 * 数は `templateDeleteImpact` で置換と同じ規則から出す＝「変わります」と言った場面が実際に変わる。
 * 他プロジェクトの場面はここでは直せない（マイ見た目はプロジェクト横断で共有＝ADR-0017）。そちらは開いたときに
 * 「見つからない」として書き出しが止まる（同 ②）ので、選び直しが要ることを併せて伝える。
 */
export function deleteLookConfirmMessage(
  impact: { changing: number; losingContent: number; unresolved: number } = { changing: 0, losingContent: 0, unresolved: 0 },
): string {
  const parts = ["この見た目パターンを削除しますか？元に戻せません。"];
  if (impact.changing > 0) parts.push(`この見た目を使っている${impact.changing}個の場面は、標準の見た目に変わります。`);
  // 標準に同じ差し込み先・文字枠が無いと、写真や文字が動画に出なくなる。削除は取り消せないので**先に**知らせる。
  if (impact.losingContent > 0) parts.push(`うち${impact.losingContent}個の場面は写真・文字などが動画に出なくなります。`);
  // 合う標準が無い場面は変わらず「見つからない」まま残る＝そのままでは書き出せない（§2-5）。
  if (impact.unresolved > 0) parts.push(`${impact.unresolved}個の場面は合う標準が無いため、見た目を選び直すまで書き出せません。`);
  parts.push("他のプロジェクトで使っている場面は、開いたときに見た目を選び直してください。");
  return parts.join("");
}

/**
 * 「まとめて標準にする」（#547）が押せない理由。押せないのに理由が出ない／実行内容の説明が出続ける、を作らない（§2-5）。
 */
export function standardLookButtonReason(fixableCount: number, isExporting: boolean): string {
  if (isExporting) return "動画の書き出し中は変更できません。書き出しが終わってから、もう一度お試しください。";
  if (fixableCount === 0) return "この向き・種類に合う標準の見た目がありません。場面編集で選び直してください。";
  return "見つからない見た目の場面を、標準の見た目にまとめて変えます（取り消せます）";
}

/**
 * 「まとめて標準にする」の結果（#547）。
 *
 * 件数だけを見せると、**動画に出なくなった中身のある場面**（マイ見た目は層 id・層構成が標準と違うことが多い）に気づけないまま
 * 「チェックOK」で書き出せてしまう。15 §5 の表示原則（「3件を自動調整、1件は確認が必要」）どおり、
 * 直した件数・**選び直しが要る場面**・直せなかった場面を分けて示す（ADR-0026④）。
 */
export function standardLookResultMessage(r: { fixed: number[]; unfixable: number[]; lostContent: number[] }): string {
  const parts: string[] = [];
  if (r.fixed.length > 0) parts.push(`${r.fixed.length}個の場面を標準の見た目にしました。`);
  if (r.lostContent.length > 0) {
    parts.push(`このうち${formatSceneNumbers(r.lostContent)}は写真・文字などが動画に出なくなったので、場面編集で入れ直してください。`);
  }
  if (r.unfixable.length > 0) {
    parts.push(`${formatSceneNumbers(r.unfixable)}は合う標準の見た目が無いため、場面編集で選び直してください。`);
  }
  return parts.join("");
}
