// 複数画面で共有するユーザー向けラベル（§6：文言は1か所に集約／§2-3：技術用語を出さない）。
import { AI_ASSET_SEND_MAX, MAX_INLINE_ASSET_BYTES, VOLUME_POINTS_MAX } from "../domain/constants";
import { FREE_ELEMENT_KINDS, LAYER_TYPE, SUBTITLE_SOURCE_KIND } from "../domain/enums";
import type { AssetType, Fit, FreeElementKind, FreeShapeType, SubtitleSourceKind, TextKey, TimelineClipKind, TrackKind } from "../domain/enums";
import type { FreeContentHidden } from "../domain/project/sceneOps";
import type { SubtitleSilentReason } from "../domain/project/subtitleBinding";
import type { BakeNote, BakeNoteCode } from "../domain/timeline/bake";
import type { Layer } from "../domain/template/types";
import type { EditBlockedReason } from "../domain/timeline/edit";
import { TIMELINE_EXPORT_BLOCK, volumePointsTooManyHasSplittable } from "../domain/timeline/export";
import type { TimelineExportBlockCode } from "../domain/timeline/export";
import type { TimelineProject } from "../domain/timeline/types";
// 型のみ（実行時 import なし＝store との循環を作らない）。空状態の文言が状態で変わるため（#590）。
import type { GenerateStatus } from "./store/projectStore";
/**
 * 場面番号の並べ方（1始まり・多いと先頭8件＋「ほか N 件」）。公開前チェックの各項目と、
 * 一括操作の結果表示（`standardLookResultMessage`）で**同じ見せ方**にするための単一の参照元（§2-7）。
 * 利用者に見える文言なので置き場はここ（§6）。以前は `adapters` にあり `uiLabels → adapters` の逆向き依存を作っていた
 * （adapters は利用者向け文字列を組み立てる側なので、依存は adapters → uiLabels が正しい・#563 レビュー）。
 */
export function formatSceneNumbers(nums: number[]): string {
  return nums.length <= 8 ? `場面${nums.join("・")}` : `場面${nums.slice(0, 8).join("・")} ほか${nums.length - 8}件`;
}

/** 「枠への収め方」欄の見出し。正典 `06_UI_SPEC §9`（右パネル）＝「枠への収め方」。テンプレ編集・場面編集で共有（§6・#547 P2-10）。 */
export const FIT_FIELD_LABEL = "枠への収め方";

/**
 * 「枠への収め方」（Fit）のユーザー向け名称。全値必須＝enum 追加漏れをコンパイル検知。
 * 語彙は `06_UI_SPEC §9`（シーン編集→右パネル・枠いっぱい/全体/伸縮）に合わせる。FitSelect（動画クリップ・画像スロット）と
 * LooksEditScreen（テンプレ編集）が**同じ語**を使うための単一の参照元（§6・#547 P2-10）。
 */
export const fitLabel: Record<Fit, string> = {
  cover: "枠いっぱいに表示（はみ出しは切り取り）",
  contain: "全体を表示（余白が入る）",
  stretch: "枠に合わせて伸縮",
};

/**
 * 図形の形のユーザー向け名称（#684）。**全値必須**＝形が増えたら名前の決め漏れをコンパイル検知。
 * 場面編集（自由配置）とタイムライン編集が**同じ形を同じ名で呼ぶ**ための単一の参照元（§6・ADR-0026②）。
 */
export const freeShapeLabel: Record<FreeShapeType, string> = {
  rect: "四角",
  rounded_rect: "角丸四角",
  ellipse: "丸",
  triangle: "三角",
  star: "星",
  arrow: "矢印",
  speech_bubble: "吹き出し",
};

/** 重ね順（要素の前後関係）のユーザー向け見出し。正典は「重ね順」（`06_UI_SPEC §3`＝layer→要素・並び順）。#547 P2-11。 */
export const Z_ORDER_LABEL = "重ね順";

/**
 * **同じ操作は同じ言い方**（#763-6）。右クリックのメニューで、キャンバスは「複製／削除」、
 * 帯は「同じものを足す／消す」と割れていた（同じ部品への同じ操作なのに場所で別の語）。
 *
 * 一般的な動画編集用語をそのまま使う（ADR-0034 決定21＝**分かりやすさ最優先**）＝
 * 「複製」「削除」に寄せる。アプリの他の場所（「この場面を複製」「この配置を削除」）とも揃う。
 * ⚠️ §2-3 が禁じるのは**実装用語**であって、動画編集の一般語ではない。
 */
export const DUPLICATE_LABEL = "複製";
export const DELETE_LABEL = "削除";

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
 * 字幕が画面からはみ出すときの案内（#533 P2／#563）。**原因で「次の行動」が変わる**ので出し分ける（§2-5）。
 * - 同時に流れるセリフがある＝帯を積むのではみ出す → 同時のセリフを減らすか、字幕を短くする。
 * - 単独/逐次＝1つの帯が大きすぎ/長すぎ（#555 で場面ごとに拡大できる） → 文字を小さくするか、字幕を短くする。
 * 「黙って画面外に切らない」ための案内（ADR-0026④）。
 */
export function subtitleOverflowMessage(hasSimultaneous: boolean): string {
  return hasSimultaneous
    ? `同時に表示するセリフが多く、一部の字幕が画面からはみ出します。${SUBTITLE_OVERFLOW_FIX.simultaneous}`
    : `字幕が画面からはみ出します。${SUBTITLE_OVERFLOW_FIX.single}`;
}
/** はみ出しの「次の行動」句。場面編集と公開前チェックで**同一の言い回し**にするための単一の参照元（§6・#563 レビュー）。 */
const SUBTITLE_OVERFLOW_FIX = {
  /** 同時に流れるセリフが多い＝帯を積むのではみ出す。 */
  simultaneous: "同時のセリフを減らすか、字幕を短くしてください。",
  /** 1つの帯が大きすぎ・長すぎ（#555 で場面ごとに拡大できる）。 */
  single: "文字の大きさを小さくするか、字幕を短くしてください。",
} as const;

/**
 * 公開前チェックの「画面からはみ出す字幕」の説明（#563 レビュー）。**原因が揃っているときだけ断定**する。
 *
 * 複数場面をまとめて挙げるので、原因が混ざったまま片方の文言を出すと**もう片方の場面に誤った次の行動**を示す
 * （例：同時が1件でもあると単独原因の場面にも「同時のセリフを減らして」と言ってしまう）。混在時は原因を断定せず
 * 場面編集へ誘導する（そこで原因ごとの案内が出る＝`subtitleOverflowMessage`）。§2-5。
 */
export function subtitleOverflowPrecheckDetail(scenesText: string, cause: "simultaneous" | "single" | "mixed"): string {
  const head = `${scenesText}の字幕が画面からはみ出します。`;
  if (cause === "mixed") return `${head}場面によって理由が違うので、場面編集で確認して直してください。`;
  return `${head}場面編集で${SUBTITLE_OVERFLOW_FIX[cause]}`;
}

/**
 * **次の場面の切り替えに覆われて、単独では映らない場面**の案内（#740）。
 *
 * ⚠️ **「動画に出ません」とは言わない**（実測＝重なっている間は見えているし、総尺にも効いている）。
 * 言うのは「**単独では映らない**」＝一度も自分だけの時間を持たない、という起きていることそのもの。
 * ⚠️ **触る先を取り違えない**＝その場面自身は切り替えを持っていない（持っているのは**次の場面**）ので、
 * 「切り替えを短く」だけ言うと、飛んだ先の欄が既に「なし」で行き止まりになる（§2-5・#740 レビュー）。
 */
export function swallowedByNextPrecheckDetail(scenesText: string, nextSceneText: string): string {
  return `${scenesText}は、次の場面（${nextSceneText}）の切り替えに覆われて単独では映りません。`
    + `表示時間を長くするか、${nextSceneText}の切り替えを短く（または「なし」に）してください`;
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

/**
 * 「場面が1つも無い」ときの見出し・説明（#590）。**公開前チェック／仕上がり確認／書き出し／たたき台の4画面で共有**する。
 *
 * 以前は画面ごとに手書きで、見た目（共有コンポーネントの有無）も次の行動も揃っていなかった。とくに
 * **生成が失敗したとき**（`status: "error"`）、たたき台以外は理由に触れず「まだ場面がありません」とだけ出していた
 * ＝原因も次の行動も分からない（§2-5）。状態の見分けをここ1か所に置く（ADR-0026②）。
 *
 * `purpose`＝その画面で何ができるようになるか（例「仕上がりを確認できます」）。
 * `canAddScene`＝その画面自身で場面を作れるか（たたき台のみ true）。
 */
export function noScenesTitle(status: GenerateStatus, canAddScene: boolean): string {
  switch (status) {
    case "generating": return "動画案を作成中です…";
    case "error": return GENERATE_FAILED_TITLE;
    case "ready": return canAddScene ? "場面を追加して作り始めましょう" : "まだ場面がありません";
    case "idle": return "まだ動画案がありません";
  }
}

export function noScenesMessage(status: GenerateStatus, canAddScene: boolean, purpose: string, reason?: string | null): string {
  switch (status) {
    case "generating": return `できあがると、${purpose}。`;
    case "error": return generateFailedMessage(reason);
    case "ready": return canAddScene
      ? "「場面を追加」で最初の場面を作り、セリフ・素材・見た目を設定していきましょう。"
      : `場面を作ると、${purpose}。`;
    case "idle": return "「新しい動画を作る」から、会社情報と素材を入れて動画案を作成しましょう。";
  }
}

/** 空状態から「場面を作る画面」へ行く導線のラベル（4画面で同じ言葉＝同じ行き先）。 */
export const GO_TO_DRAFT_LABEL = "たたき台へ";

/**
 * 動画案の作成に失敗したときの見出し・説明・復帰の2択（#393 P1）。**生成中の画面と空状態（4画面）で共有**する（#590）。
 * 挙動（再試行／`startManualEdit`＋たたき台へ）が同じなのにラベルだけ2通りあると、片方だけ直って言葉が割れる（§6・PR #615 レビュー）。
 * 「手動で作成する」でなく**「手動で場面を作る」**なのは、押した先で実際にすることを言うため（§2-5）。
 */
export const GENERATE_FAILED_TITLE = "動画案の作成に失敗しました";
export const RETRY_GENERATE_LABEL = "もう一度試す";
export const START_MANUAL_LABEL = "手動で場面を作る";
/** 失敗の理由は生成が持っている（`aiError`）。無いときも「次に何をすればよいか」だけは必ず出す（§2-5）。 */
export function generateFailedMessage(reason?: string | null): string {
  return reason ?? "通信状況や設定を確認して、もう一度お試しください。手動で場面を作ることもできます。";
}

/**
 * ディスク容量のユーザー向け表記（焼き出し前の「増える容量」＝ADR-0032 決定13）。
 * **目安として伝えるもの**なので桁を丸め、単位は身近な MB/GB を使う（KB 未満は「1MB 未満」に寄せる＝
 * 「0.003MB」のような読みづらい数字を出さない）。
 */
export function formatDiskSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "1MB 未満";
  if (mb < 1024) return `約 ${Math.round(mb)}MB`;
  return `約 ${(mb / 1024).toFixed(1)}GB`;
}

/**
 * 焼き出しで持っていけないものの案内（`15 §6` の `BAKE_*`）。**全コードに文言が要る**＝
 * 種類が増えたらコンパイルエラーで気づく（黙って無言の項目を作らない・§2-5）。
 */
export const bakeNoteMessage: Record<BakeNoteCode, string> = {
  BAKE_DIALOGUE_SUBTITLE_SKIPPED: "セリフに合わせて切り替わる字幕は持っていけません。作ったあとに字幕を置き直してください",
  BAKE_VIDEO_START_TIMING_SKIPPED: "動画を再生し始めるタイミングは持っていけません。作ったあとに動画の位置で調整してください",
};

/** 持っていけないもの1件の案内＋対象の場面（例:「場面2・5 …」）。 */
export function bakeNoteText(note: BakeNote): string {
  return `${formatSceneNumbers(note.sceneNumbers)}：${bakeNoteMessage[note.code]}`;
}

/**
 * トラック（列）のユーザー向け名称（ADR-0032・#629）。未設定のときの自動名＝種別＋番号。
 * 全値必須＝`TrackKind` が増えたらコンパイルエラーで気づく。`トラック` は技術語なので「列」と言う（§2-3）。
 */
const trackKindLabel: Record<TrackKind, string> = {
  visual: "映像",
  audio: "音",
};

/**
 * 連番は**種別ごと**に数える（`11 §7.6`「未指定＝種別＋連番の自動名」）。
 * 並び全体の通し番号にすると、映像3本＋音2本の動画で「音1」が無く「音4・音5」になる。
 */
export function trackLabel(tracks: readonly { id: string; kind: TrackKind; name?: string }[], trackId: string): string {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return "";
  if (track.name) return track.name;
  const order = tracks.filter((t) => t.kind === track.kind).findIndex((t) => t.id === trackId) + 1;
  return `${trackKindLabel[track.kind]}${order}`;
}

/**
 * クリップのユーザー向け名称（ADR-0032・#629）。名前が付いていれば優先し、無ければ中身から短く作る。
 * 全値必須＝`TimelineClipKind` が増えたらコンパイルエラーで気づく（無名の部品ができない）。
 */
// 空間の語彙は自由配置と**同じもの**（`TIMELINE_CLIP_KIND` は `FREE_ELEMENT_KIND` を広げた集合＝`11 §7.6`）。
// 名前も `freeKindLabel` から広げる＝同じ物を画面によって別の名で呼ばない（§6・ADR-0026②）。
const clipKindLabel: Record<TimelineClipKind, string> = {
  ...freeKindLabel,
  template: "見た目パターン",
  audio: "音",
  voice: "読み上げ",
};

export function clipLabel(clip: { kind: TimelineClipKind; name?: string; text?: string; voice?: { text: string } }): string {
  if (clip.name) return clip.name;
  // 文字が入っているものは中身を見せたほうが見分けやすい（長いものは切る＝列の幅を壊さない）。
  const body = clip.voice?.text ?? clip.text;
  return body ? body.slice(0, 12) : clipKindLabel[clip.kind];
}

/**
 * 音量の変化を置いている間の案内（#512 段4）。点があるとその点が音量を決めるので、部品の「音量」欄
 * （一定の音量）は使われない＝**設定したのに音が変わらない**を作らないため、欄を押せなくして理由を出す
 * （ADR-0026①・§2-5）。
 */
export const VOLUME_POINTS_OVERRIDE_HINT =
  "音量の変化を置いている間は、その点が音量を決めます。一定の音量に戻すには「音量の変化をすべて外す」を押してください";

/**
 * 自動保存に失敗したときの案内（`15 §6` の `TIMELINE_SAVE_FAILED`・#693）。タイムライン編集は**自動保存**
 * （`06 §12.1`）で、共通トップバーの保存ボタンは出さない（ADR-0032＝押すと場面形式の文書を保存してしまう）
 * ＝**失敗を伝える担い手はこの画面しかいない**。黙って落とすと「閉じても消えない」の前提が破れる
 * （ADR-0026④）ので、次の行動（もう一度保存する）を添えて出す（§2-5）。
 */
export const TIMELINE_SAVE_FAILED_MESSAGE =
  "変更を保存できませんでした。もう一度「保存し直す」を押してください。押しても直らないときは、直前の操作を取り消してからお試しください";

/**
 * 保存の状態の控えめな表示（#693）。**場面形式と同じ言い方**にする（`saveButtonLabel`／`SaveStatusBadge` が
 * 「保存中…」「保存しました」を使っている＝同じ概念を別の言い方にしない・ADR-0026②）。
 * 失敗は文言でなく `TIMELINE_SAVE_FAILED_MESSAGE`＋再試行の導線として出すのでここでは扱わない。
 * `idle`（保存待ち）は出さない＝**画面を離れるときに書き切る**ので、数百ミリ秒だけ「未保存」を点滅させない。
 */
export function timelineSaveStatusLabel(saveStatus: "idle" | "saving" | "saved" | "error"): string {
  return saveStatus === "saving" ? "保存中…" : saveStatus === "saved" ? "保存しました" : "";
}

/**
 * 秒を「m:ss」表記へ。**場面形式の見わたす画面とタイムライン編集で同じ書き方にする**ための単一の参照元
 * （§6・ADR-0026②＝同じ概念を同じ見せ方に）。短い動画でも "0:05" と読める。
 */
export function clockLabel(sec: number): string {
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 帯（クリップ）のツールチップ＝名前と時間帯。両方の画面で同じ形にする。 */
export function clipRangeTitle(label: string, startSec: number, endSec: number): string {
  return `${label}（${clockLabel(startSec)}〜${clockLabel(endSec)}）`;
}

/**
 * 素材が大きすぎるときの案内（#712＝両形式で共有）。**次の行動は画面ごとに違う**ので受け取る
 * （場面形式には大きいファイル用のボタンがあり、タイムライン編集には無い＝実行できない案内にしない）。
 * MB への換算もここ1か所（`Math.round` を画面ごとに書かない）。
 */
export function assetTooLargeMessage(nextAction: string): string {
  const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
  return `このファイルは大きすぎます（上限${limitMb}MB）。${nextAction}`;
}

/**
 * 種類の違うファイルを選んだときの案内（#347・§2-5）。
 *
 * ⚠️ **黙って種類を変えない**（ADR-0026④）＝写真の素材を動画で差し替えると、置いてある差し込み口が
 * その種類を受け付けない場合があり（`assignableAssetsFor`）、**置いた場所から黙って消える**。
 * かといって種類を変えずに中身だけ入れ替えると、**写真として動画を描く**ことになり何も映らない。
 * どちらも「黙って別の結果」なので、**差し替えずに断り、代わりの手を示す**。
 *
 * ⚠️ **判定は「動画かどうか」**（`changesAssetKind`）＝種類と直接くらべると、ロゴ・ゆうこ・QR・装飾が
 * 素通りして**無言で差し替わる**（この画面はそれらも一覧に出す）。文言も「写真」でひとまとめにする＝
 * 利用者に「ロゴ素材」「QR 素材」と言い分けても直し方は同じ。
 */
export function assetTypeMismatchMessage(isVideo: boolean): string {
  const kind = isVideo ? '動画' : '写真';
  const other = isVideo ? '写真' : '動画';
  return `この素材は${kind}です。${kind}のファイルをお選びください。${other}に変えたいときは、${other}を取り込んでから場面で選び直してください。`;
}

/**
 * 差し替えた素材が短くなり、**切り出す範囲を収め直した**ときの案内（#347・§2-5・§6）。
 *
 * ⚠️ **黙って直さない**＝範囲は利用者が決めたものなので、勝手に変わったことを知らせる
 *（`§2-5`＝直した結果と次に見るところを示す）。「失敗」ではないので原因は書かない。
 */
export function clipClampedMessage(count: number): string {
  return `差し替えた素材が短いため、${count}か所の使う範囲を新しい長さに合わせました。場面編集でご確認ください。`;
}

/**
 * まとめて取り込んで**一部が入らなかった**ときの案内（#858・§2-5・§6）。
 *
 * ⚠️ **1件だけのときはこれを使わない**＝その1件の理由をそのまま出す（単発で取り込んだときと
 * 同じ文言になる＝ADR-0026②「件数で案内が変わらない」）。呼び出し側が2件以上のときだけ通す。
 * ⚠️ **名前で示す**＝何を入れ直せばよいかが分かる。置き場所（絶対パス）までは出さない（読みにくい）。
 * **両形式で同じ文言**（§6）。
 */
export function importPartlyFailedMessage(failedNames: readonly string[], firstReason: string | null): string {
  return `${failedNames.length}件を取り込めませんでした（${failedNames.join("、")}）。${firstReason ?? ""}`;
}

/**
 * **よく使う素材に置く**とき、まとめて置いて一部が失敗したときの案内（PR #905 レビュー）。
 *
 * ⚠️ **言い回しを増やさない**（§6）＝同じ状況（まとめて入れて一部だけ失敗）に対して
 * `importPartlyFailedMessage` があるのに、画面の中で**3つ目の言い方**を作りかけていた。
 * ⚠️ **語彙だけ変える**＝よく使う素材は「取り込む」ではなく**「置く」**（`06 §4`）なので、
 * 形（件数＋名前＋最初の理由）は揃えたうえで動詞だけ合わせる。
 */
export function libraryPartlyFailedMessage(failedNames: readonly string[], firstReason: string | null): string {
  return `${failedNames.length}件を置けませんでした（${failedNames.join("、")}）。${firstReason ?? ""}`;
}

/**
 * 取り込んでいる最中に、もう一度まとめて取り込もうとしたときの案内（#858・§2-5）。
 *
 * ⚠️ **黙って落とさない**＝単発の取り込みは取り込み中を**黙って return** する（1件が入らないだけ）が、
 * まとめて渡すと**N件がそっくり消える**。入口で断り、いつやり直せばよいかを言う。
 * **両形式で同じ文言**（同じ状況で同じことを言う＝ADR-0026②・§6）。
 */
export const IMPORT_BUSY_MESSAGE =
  "いま素材を取り込んでいます。終わってからもう一度お試しください。";

/**
 * 取り込み先の動画が無いときの断り（差分再監査 7巡目 ℹ️）。**判定（`hasOpenProject`）は共有したのに
 * 文言は各画面の直書きだった**＝片方だけ直る形が残る（§6・ADR-0026②「同じ断りを2通りにしない」）。
 *
 * ⚠️ **ボタンに添える短い理由**（なぜ押せないか）。**次の行動**（先に動画を開くか、新しく作る）は、
 * 空の一覧の案内文など**操作できる場所**に置く＝ホバーにしか無い、を作らない（§2-5）。
 */
export const IMPORT_NO_PROJECT_MESSAGE = "先に動画を開いてください";

/**
 * いま使っていない種別・要素にフォントの指定が残っているときの知らせ（差分再監査 9巡目 ℹ️）。
 *
 * ⚠️ **両形式で同じ文言**（場面編集とタイムライン編集）＝2画面に直書きすると片方だけ直る形が残る（§6）。
 * ⚠️ **出すのは「もう描かれないもの」だけ**＝描かれている文字を「使っていない」と言うと嘘になり、
 * 案内どおり戻すと**動画に出ている字体が変わる**（§2-5）。
 */
export const DORMANT_FONT_HINT =
  "いまの見た目パターンでは使っていない文字にも、フォントの指定が残っています。使わないなら「動画全体に合わせる」に戻せます。";

/**
 * 取り込みを待っている間に書き出しが始まっていたときの案内（#712）。**逆向き**の
 * `EXPORT_BLOCKED_IMPORTING_MESSAGE` と対で、どちらが先でも「消えた理由」が分かるようにする。
 */
export const IMPORT_BLOCKED_EXPORTING_MESSAGE =
  "いま動画を書き出しているので、取り込めませんでした。書き出しが終わってからもう一度お試しください。";

/**
 * 素材を取り込んでいる最中に書き出しを始めようとしたときの案内（#570 P1）。
 * **両形式で同じ文言**（同じ状況で同じことを言う＝ADR-0026②・§6）。
 */
export const EXPORT_BLOCKED_IMPORTING_MESSAGE = "素材の取り込み中です。取り込みが終わってから書き出してください。";

/**
 * 声を作っている最中に書き出しを始めようとしたときの案内（#718）。
 * **両形式で同じ文言**（場面形式は `ExportScreen` の `startBlockedMessage` が出す・ADR-0026②・§6）。
 */
export const VOICE_BUSY_EXPORT_MESSAGE = "声を作成中です。作成が終わってから書き出してください。";

/** 書き出し中に画面を離れようとしたときの案内（#719）。進み具合も中止もこの画面の中にしかない。 */
export const LEAVE_BLOCKED_EXPORTING_MESSAGE = "いま動画を書き出しています。終わってから画面を移ってください。";

/** 大きいファイルを取り込む道がある画面（はじめの入力・素材の画面）の次の行動。 */
export const ASSET_TOO_LARGE_USE_PICKER = "大きいファイルは「写真・動画を選ぶ」から取り込んでください。";
/** その道が無い画面（タイムライン編集）の次の行動。 */
export const ASSET_TOO_LARGE_PICK_SMALLER = "もっと小さいファイルをお選びください。";

/**
 * 素材を取り込めなかったときの案内（#712＝両形式で共有）。アプリの中の取り込みは文字列で失敗を返す
 * （Rust 側が §2-5 準拠で整えた文言）のでそのまま出し、それ以外は定型文へ落とす。生の例外は見せない。
 */
export function importErrorMessage(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return "素材を取り込めませんでした。もう一度お選びください。";
}

/**
 * 置けなかった理由の案内（`15 §6` の `TIMELINE_EDIT_*`・ADR-0032）。**全コードに文言が要る**＝
 * 理由が増えたらコンパイルエラーで気づく（無言で操作が効かない状態を作らない）。
 * どれも「なぜ置けないか」でなく**次にどうすれば置けるか**を言う（§2-5）。
 */
export const editBlockedMessage: Record<EditBlockedReason, string> = {
  TIMELINE_EDIT_OVERLAP: "その場所には先に置いてある部品があります。ずらすか、列を足して重ねてください",
  TIMELINE_EDIT_TRACK_KIND: "音の部品は音の列に、絵や文字の部品は映像の列に置いてください",
  TIMELINE_EDIT_LOCKED: "この列は固定されています。動かすには固定を外してください",
  TIMELINE_EDIT_LOCKED_SELECTION: "固定された列の部品が選ばれています。固定を外すか、選び直してください",
  TIMELINE_EDIT_GROUP_ACROSS_TRACKS: "この列の部品が、ほかの列の部品とまとまりになっています。まとまりを外してから複製してください",
  TIMELINE_EDIT_HIDDEN_TRACK: "この列は「出さない」設定なので、置いても動画に出ません。ほかの列へ置くか、列の「⋮」から「動画に出す」を選んでください",
  TIMELINE_EDIT_NOT_FOUND: "その部品は見つかりませんでした。選び直してください",
  TIMELINE_EDIT_NOT_AUDIO: "その部品は音を持っていません。音の設定は、音や読み上げの部品で変えてください",
  TIMELINE_EDIT_NO_ORIGINAL_AUDIO: "この動画には音が入っていないので、元の音は鳴らせません。音を付けるなら、音の列に音を置いてください",
  TIMELINE_EDIT_EXPORTING: "いま動画を書き出しています。終わってから編集してください",
  TIMELINE_EDIT_ORIENTATION: "この見た目パターンは向き（横長・縦長）がこの動画と違うので置けません。同じ向きのものを選んでください",
  TIMELINE_EDIT_EXPLODE_ANCHOR: "動き（拡大・回転）が付いた部品は、そのままバラすと絵がずれます。動きを外してからバラしてください",
  // ⚠️ **「素材の画面で外す」とは案内しない**（#816-5・ADR-0034 決定5 に記録済み）＝素材の画面は
  // 場面形式の画面で、この動画の切り出し（`asset.clip`）はここからは触れない＝**従っても解除されない
  // 行き止まり**になる。この形式で実際にできるのは「切り出していない動画に入れ替える」ことだけ。
  // ⚠️ **切り抜きは部品の箱ぜんぶを切る**ので、要素ごとに分けると**各要素が自分の箱で切られる**＝別の絵。
  // ⚠️ **寄せも名指しする**（差分再監査 5巡目 🟡）＝断るのは切り抜きだけでなく**素材の寄せ**も
  // 含む（`cropAlign`）ので、切り抜きしか言わないと**寄せだけ設定した人は案内どおり解除できない**。
  TIMELINE_EDIT_EXPLODE_CROP:
    "切り抜き・素材の寄せがしてある部品はバラせません。そのままバラすと切り取り方が変わります。切り抜きを外し、寄せを「中央」に戻してからバラすか、バラさずに使ってください",
  TIMELINE_EDIT_EXPLODE_TRIM_END: "切り出す終わりを決めた動画が入っています。そのままバラすと流れる長さが変わります。その枠に切り出していない動画を入れ直すか、バラさずに使ってください",
  TIMELINE_EDIT_EXPLODE_TRIM_END_PER_USE:
    "この枠だけ切り出す終わりを決めた動画が入っています。そのままバラすと流れる長さが変わります。その枠の動画をいったん「なし」にして入れ直してからバラしてください",
  // ⚠️ 「短くしてから」ではなく**分ける位置**を案内する＝素材の切り出しはこの形式から触れない
  // 枠がある（`asset.clip`）ので、そこを直せと言うと行き止まりになる（#816-5 と同じ筋）。
  TIMELINE_EDIT_SPLIT_PAST_SOURCE:
    "そこは動画を使い切った後なので分けられません。動画が流れている間（映像が止まる前）の位置で分けてください",
  TIMELINE_EDIT_EXPLODE_BACKGROUND_VIDEO:
    "差し込み口ではない場所（背景など）に動画が入っています。そのままバラすと動き出して見た目が変わります。その動画を差し込み口へ入れるか、写真に差し替えてからバラしてください",
  // ⚠️ **書き出しの断り（`TIMELINE_EXPORT_VIDEO_ASSET_UNSUPPORTED`）と言い方を揃える**（#831）＝
  // 「差し替えてから」ではなく「列へ直接置くか、差し込み口へ入れる」＝この部品ではなく**動画の置き方**を
  // 変える案内。立ち絵を触る欄がここに無いので、それ以外に実在する行動が無い。
  TIMELINE_EDIT_LINKED_SUBTITLE: "連動している字幕を置ける場所がありません。字幕をほかの列へ移すか、連動をやめてください",
  TIMELINE_EDIT_CURVED_EASING: "この動き方は途中で分けられません。「動き」の欄に出ている秒数の位置か、動きの付いていない所で分けてください",
  TIMELINE_EDIT_PLAYING: "再生を止めてから使えます",
  TIMELINE_PLAY_EXPORTING: "いま動画を書き出しています。終わってから再生できます",
  TIMELINE_EDIT_UNSPLITTABLE: "読み上げと、それに合わせている字幕は分けられません（文と音がずれるため）。字幕だけ分けたいときは「連動する読み上げ」で連動をやめてください",
  TIMELINE_EDIT_SPLIT_OUTSIDE: "その位置では分けられません。再生位置を部品の中（両側が0.1秒以上残る所）へ動かしてください",
  TIMELINE_EDIT_LINKED_SUBTITLE_TIME: "連動している字幕の時間は読み上げに合わせています。連動をやめると自分で動かせます",
  TIMELINE_EDIT_VOLUME_POINTS_FULL: `音量の変化は1つの部品に${VOLUME_POINTS_MAX}か所までです。ほかの点を外してから置いてください`,
  TIMELINE_EDIT_VOLUME_POINTS_KIND: "音量の変化を置けるのは、音や読み上げの部品だけです。音の部品を選び直してください",
  TIMELINE_EDIT_CONTENT_FIELD: "この部品にはその項目がありません。直したい部品を選び直してください",
};

/**
 * 音の入っていない動画を選んだときの知らせ（#512 段2・`15 §6`）。**元の音の欄は出さず、代わりにこれを出す**。
 * ⚠️ **押せない欄を並べない／押しても何も起きない、も作らない**（§2-5）＝その場で次の行動を出す。
 * 断りではなく知らせなので `exportBlockedMessage` には入れない。
 */
export const TIMELINE_VIDEO_NO_AUDIO =
  "この動画には音が入っていません（音を付けるなら、音の列に音を置いてください）";

/**
 * 動画に音が入っているか**確かめられなかった**とき（#512 段2・`15 §6`）。
 * ⚠️ 「入っていません」と断定しない＝取り込みのときに調べられなかっただけかもしれないので、
 * 次の行動は「取り込み直す」（音の列に音を置く、ではない）。場面形式も同じ2文で分けている。
 */
export const TIMELINE_VIDEO_AUDIO_UNKNOWN =
  "この動画に音が入っているか確かめられませんでした。もう一度取り込むと使えることがあります";

/**
 * まとまり全体を薄くする動きが掛かっている間、仕上がり確認では実映像を出さない（#512 段1・`11 §7.6.4`）。
 * ⚠️ 層ごとに薄さを掛けると**重なった所で下が透ける**＝書き出し（1枚にしてから掛ける）と別の絵になるため。
 * 黙って静止画に見せず、**書き出しには出る**ことまで言う（§2-5）。
 */
export const TIMELINE_VIDEO_STILL_IN_GROUP_FADE =
  "まとまり全体を薄くしている間は、ここでは動かずに見えます（書き出した動画では動きます）";

/**
 * この画面（WebView）が**復号できない形式**の動画は、仕上がり確認で実映像にできない（#816-1）。
 * ⚠️ **黙って静止＋無音にしない**＝`.avi`/`.mkv` は取り込めるが復号できず、必ずこの状態になる
 *（例外ではなく主要ケース）。復号できる形式なら書き出しには実映像＋元の音が入るので、言わないと
 * **見えていたものと違う動画**が出る（ADR-0001・ADR-0026④）。音も鳴らせない（同じ復号器を通るため）。
 * ⚠️ **「書き出しには入る」と言い切らない**（レビュー申し送り）＝この状態には**素材のファイルが
 * 見つからない**ときも落ちてくる（`video` の失敗の合図は理由を区別しない）。そちらは書き出しも
 * 失敗するので、約束すると嘘になる。**両方に当たる行動**（取り込み直す）だけを出す（§2-5）。
 */
export const TIMELINE_VIDEO_STILL_UNPLAYABLE =
  "この動画は、ここでは映像も音も出せません（形式が合わないか、ファイルが見つかりません）。MP4 で取り込み直すと、ここでも確かめられます";

/**
 * 回した部品を左右非対称に切り抜いているとき、仕上がり確認では実映像を出さない（#512 段1・`11 §7.6.4.1`）。
 * ⚠️ 書き出しは切り抜きの矩形を**矩形自身の中心**で回すが、画面の実映像は**部品の中心**で回るため
 * **別の窓**になる。直せるまでは出さない側へ倒し、黙って別の絵にしない（§2-5）。
 */
export const TIMELINE_VIDEO_STILL_ROTATED_CROP =
  "回した部品を切り抜いている間は、ここでは動かずに見えます（書き出した動画では動きます）";

/**
 * 書き出せない理由の案内（`15 §6` の `TIMELINE_EXPORT_*`・ADR-0032・#631）。`editBlockedMessage` と同じ流儀で
 * **全コードに文言が要る**＝理由が増えたら気づく。
 * ⚠️ 動画は **#512 段1〜段3b で直接置きも差し込み口も映るようになった**＝断るのは**立ち絵に入れたぶん**
 * だけ（そこだけ静止画のまま）。静止画で出すのを成功にしない（ADR-0026④）。
 * ⚠️ **`volumePointsTooMany` はここに無い**（#831）＝挙げる部品に読み上げが混ざりうる集計型の理由で、
 * 「分けてください」を添えてよいかが**部品ごとに違う**。`lockedTrackMessage` と同じ流儀＝呼び出し側が
 * 状況を渡して締めを変える {@link volumePointsTooManyMessage} を直接呼ぶ。
 */
export const exportBlockedMessage: Record<Exclude<TimelineExportBlockCode, typeof TIMELINE_EXPORT_BLOCK.volumePointsTooMany>, string> = {
  TIMELINE_EXPORT_EMPTY: "まだ何も置かれていないので、動画を書き出せません。素材や文字を置いてから書き出してください",
  TIMELINE_EXPORT_TEMPLATE_UNRESOLVED:
    // ⚠️ 「読み込み直す」は書かない（#812）＝読み直す操作が画面に無く、自作のものを消した場合は
    // 読み直しても戻らない（実行できない／効果の無い行動を名指ししない・§2-5）。
    "見た目パターンが見つからない部品があります。そのままでは動画に出ません。その部品を消して、置き直してください",
  TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN:
    "連動する読み上げが見つからない字幕があります。そのままでは動画に出ません。連動先を選び直すか、字幕の文を入れてください",
  TIMELINE_EXPORT_ASSET_UNREADABLE:
    "素材のファイルを読めませんでした。そのままでは動画にその絵が出ません。素材を取り込み直すか、その部品を置き直してください",
  // ⚠️ **場面形式と同じことを言う**（ADR-0026②）＝`USER_FONT_MISSING` と同じ「別の字になる」を伝え、
  // 次の行動（取り込み直す／別の文字の形を選ぶ）まで出す。
  TIMELINE_EXPORT_USER_FONT_MISSING:
    "この動画で使っている文字の形（フォント）が見つかりません。このまま書き出すと別の字になります。設定の「文字の形」から取り込み直すか、使っている文字で別の文字の形を選び直してください",
  // ⚠️ **「見つからない」とは別**＝目録が読めないので待っても埋まらない（場面形式の `unknownFont` と同じ）。
  TIMELINE_EXPORT_USER_FONT_UNREADABLE:
    "この動画は取り込んだ文字の形（フォント）を使っていますが、いま手元にあるかを調べられませんでした。このまま書き出すと別の字になることがあります。アプリを開き直してから、もう一度お試しください",
};

/**
 * 音量の点が多すぎる、の案内（#831）。
 *
 * ⚠️ #723 の時点では「部品を分けてください」を書けなかった（分割が未実装＝実在しない操作を案内すると
 * 行き止まりになる・決定5）。**分割は land 済み**（`splitClip`＝「ここで分ける」／`Ctrl+K`）だが、
 * **読み上げは分けられない**（`isUnsplittableClipKind`）。挙げた部品が読み上げだけのとき「分けてください」
 * を添えると、従っても分けられない＝実行できない行動を名指しすることになる（§2-5・#812 と同型）。
 * @param hasSplittable 挙げた部品のうち分けられる種類が1つでもあるか（{@link volumePointsTooManyHasSplittable}）。
 */
export function volumePointsTooManyMessage(hasSplittable: boolean): string {
  return hasSplittable
    ? `音量の変化の点が多すぎる部品があります。1つの部品に置けるのは${VOLUME_POINTS_MAX}個までです。いらない点を外すか、部品を分けてください`
    : `音量の変化の点が多すぎる部品があります。1つの部品に置けるのは${VOLUME_POINTS_MAX}個までです。いらない点を外してください`;
}

/**
 * 見た目パターンが見つからない部品の案内（`15 §6` `TIMELINE_TEMPLATE_NOT_FOUND`・ADR-0032・#834-2）。
 *
 * ⚠️ **画面で手書きしない**＝{@link lockedTrackMessage} と同じ理由（#819-2）。手書きは
 * `uiLabels.test.ts` の禁止語の検査が見る**走査対象（Record と共有関数）の外**に落ちるので、
 * 混ざっても誰も気づかない。実際この文言は**画面2か所と `15 §6` を手でそろえて**成立していた
 *（#812 の直しがそうなっていた）。
 * ⚠️ **`TIMELINE_EXPORT_TEMPLATE_UNRESOLVED`（{@link exportBlockedMessage}）とは別物**＝あちらは
 * 書き出しを断るコードで、締めも意図して違う（「そのままでは動画に出ません」）。ここへ寄せない。
 *
 * ⚠️ **「読み込み直す」は名指ししない**（#812）＝見た目パターンを読み直す操作は画面のどこにも無く
 * （起動時に一度だけ）、自作のものを消した場合は読み直しても戻らない＝**実行できない／効果の無い
 * 行動**になる（§2-5）。消して置き直す側だけを出す。
 *
 * @param count 件数。**省略＝選んでいるその部品1つ**の話（詳しい欄＝相手が画面に出ている）。
 *   渡すと**全体の警告**になり、何が起きるか（動画に出ない）を添える＝一覧では消す相手が
 *   画面に出ているとは限らず、「直さないとどうなるか」が分からないと後回しの判断ができない。
 */
export function missingTemplateMessage(count?: number): string {
  return count == null
    ? "この部品の見た目パターンが見つかりません。この部品を消して、置き直してください。"
    : `見た目パターンが見つからない部品が${count}個あります。その部品は動画に出ません。その部品を消して、置き直してください。`;
}

/**
 * 場面の見た目が**見つからない／合っていない**ときの断り（差分再監査 10巡目 🟡・`15 §6` `TEMPLATE_NOT_FOUND`）。
 *
 * ⚠️ **文言は1か所から**＝画面に直書きすると、同じ状態に**2通りの断り**が並ぶ（実際、節の外と中で
 * 「選び直してください」と「合う見た目パターンがまだありません」が食い違っていた）。⚠️ **検査にも
 * 載せる**（`uiLabels.test.ts` の `MAPS.sharedFunctions`）＝Record しか見ない検査は、関数で作る文を
 * そのままでは見ない（登録して初めて §2-3 の禁止語走査に入る・#819-2 の先例）。
 * ⚠️ **実行できない次の行動を出さない**＝候補が1つも無いときに「選び直してください」と言わない（§2-5）。
 *
 * @param unresolved 見つからない（`true`）か、向き・場面に合っていない（`false`）か。
 * @param pickableCount いま選べる見た目パターンの数。
 * @param avail 候補ゼロのときの次の行動を分ける材料。**「できる手」を実際の在庫から決める**。
 *   - `otherKind` … **別の種類なら**この向きに見た目がある（＝種類を変えれば選べる）。
 *   - `anyLoaded` … 見た目パターンが**1つでも読み込めている**（＝作る画面が使える）。
 */
export function sceneTemplateProblemMessage(
  unresolved: boolean,
  pickableCount: number,
  avail: { otherKind: boolean; anyLoaded: boolean } = { otherKind: false, anyLoaded: true },
): string {
  const what = unresolved ? "今の見た目が見つかりません。" : "今の見た目は動画の向き・場面に合っていません。";
  // ⚠️ **どこを指すかは呼ぶ側が足す**（差分再監査 11巡目）＝ここで「下から」と書くと、節の外へ出した
  // 文でも「下から」と言い、呼ぶ側の「（下の…にあります）」と**方向を二重に指す**。
  if (pickableCount > 0) return what + "選び直してください。";
  const none = "この向き・場面に合う見た目パターンがまだありません。";
  // ⚠️ **次の行動は「いま実際にできる手」から選ぶ**（差分再監査 12巡目 🟡・§2-5）＝**3段**に分かれる。
  //   ①別の種類にある → 種類を変える（同じ画面でできる）
  //   ②読み込めてはいる → 「見た目パターン」の画面で作る（作成の入口が出る）
  //   ③1つも読み込めていない → 開き直す／連絡する（種類も変えられず、作成の入口も出ない）
  // ⚠️ ②と③を混ぜると、**読み込めているのに「読み込まれていません」と嘘をつく**（PR #921 レビュー 🔴）。
  if (avail.otherKind) return what + none + "種類を変えると、別の見た目パターンを選べます。";
  if (avail.anyLoaded) return what + none + "「見た目パターン」の画面で作れます。";
  return what + none + "見た目パターンが読み込まれていません。アプリを開き直してください。改善しない場合は、お手数ですがご連絡ください。";
}

/**
 * BGM を下げる区間を**つないだ**ときの知らせ（ADR-0032 追補4・α-6 出口監査 🟡）。
 *
 * ⚠️ **黙ってやらない**（§2-5）＝つなぐと「セリフとセリフの間でも BGM が下がったまま」になる。
 * ⚠️ **両形式で同じ文言**＝場面形式（`ExportScreen`）とタイムライン形式で同じことを言う（ADR-0026②）。
 * ⚠️ **次の行動は画面に実在する名前で書く**（`/canon-check` 🟡・§2-5）＝もとは「「BGM を下げる」を
 * 弱く」と書いていたが、**その名前の操作はどこにも無い**（実物は「音の自動調整」の中の
 * 「どのくらい控えめにするか」＝`AudioAutoField`・`06 §13`）。探しても見つからない案内は
 * 「次の行動」になっていない。**共有したことで露出が2か所へ増えた**ので、ここで直す。
 */
export const DUCK_MERGED_MESSAGE =
  "セリフが多いため、BGM を下げる区間をつないで保存しました。セリフとセリフの間でも BGM が下がったままになります。気になる場合は「音の自動調整」の「どのくらい控えめにするか」を弱くするか、動画を分けてお試しください。";

/** 複製そのものに失敗したとき（読めた・書けた以外の理由）。読めない理由は `ProjectLoadError` を出す。 */
export const DUPLICATE_FAILED_MESSAGE = "動画を複製できませんでした。もう一度お試しください。";

/**
 * 会社の見た目の**文字の形が入らなかった**ときの案内（#929・§2-5）。
 *
 * ⚠️ **黙って飛ばして「反映しました」と言わない**＝覚えている字体が手元に無いと入らないので、
 * ロゴだけ入った状態を「全部入った」と見せると**失敗を成功に見せる**ことになる。
 * ⚠️ **次の行動は2通りある**（取り込み直す／覚え直す）ので、両方を出す。
 */
export const BRAND_FONT_NOT_APPLIED_MESSAGE =
  "覚えている文字の形は、いまこのパソコンにありません。設定の「文字の形」で取り込み直すか、「会社の見た目」で選び直してください。";

/**
 * 会社の見た目のロゴが入らなかったときの案内（ADR-0036・α-6 出口監査 🟡）。
 * ⚠️ **明示適用と新規作成で同じことを言う**＝片方だけ黙る、を作らない（ADR-0026②・§6）。
 */
export const BRAND_LOGO_NOT_APPLIED_MESSAGE =
  "ロゴを取り込めませんでした。「よく使う素材」に置いてあるか確かめてください。";

/** 持ち込みフォントを外したので、会社の見た目の指定も外したときの知らせ（α-6 出口監査 🟡）。 */
export const BRAND_FONT_CLEARED_MESSAGE =
  "この文字の形を外したので、会社の見た目の指定も外しました。設定の「会社の見た目」から選び直せます。";

/** 上の片づけに失敗したときの案内＝**黙って指したままにしない**（§2-5）。 */
export const BRAND_FONT_CLEAR_FAILED_MESSAGE =
  "この文字の形を外しましたが、会社の見た目の指定を外せませんでした。設定の「会社の見た目」から選び直してください。";

/**
 * 文字の形の「継承」を選ぶ項目の名前（#925）。
 *
 * ⚠️ **継承先の名前を言う**＝どこに合わせるかは**場所によって違う**（`resolveFontId`＝
 * 場面の指定 → 動画全体 → 既定）。**場面が自分の指定を持っているとき**は、そこに合わせるのに
 * 「動画全体に合わせる」と書くと**設定した意味と違うことを言う**（ADR-0026①）。
 * ⚠️ **画面ごとに文言を書き分けない**（§6）＝どちらを出すかは呼ぶ側が決め、言葉はここに置く。
 */
export const FONT_INHERIT_PROJECT_LABEL = "動画全体に合わせる";
/** 場面が自分の文字の形を持っているとき（そこに合わせる）。 */
export const FONT_INHERIT_SCENE_LABEL = "この場面の文字の形に合わせる";

/**
 * 見た目が見つからず、そのフォントを**どの文字に使っているか調べられない**ときの知らせ（12巡目 🟡）。
 *
 * ⚠️ **双子（{@link DORMANT_FONT_HINT}）が `uiLabels` にあるのに片方だけ画面直書き**だった＝
 * §6（文言は1か所）／検査（`uiLabels.test.ts` の走査）の外に落ちる。
 */
export const UNKNOWN_FONT_HINT =
  "見た目が見つからないので、どの文字に使っているかは分かりません。フォントだけここで選べます。";

/** {@link exportBlockedMessage} と {@link volumePointsTooManyMessage} をコードで振り分けて1本にする。 */
export function resolveExportBlockedMessage(code: TimelineExportBlockCode, doc: TimelineProject, clipIds: string[]): string {
  if (code === TIMELINE_EXPORT_BLOCK.volumePointsTooMany) return volumePointsTooManyMessage(volumePointsTooManyHasSplittable(doc, clipIds));
  return exportBlockedMessage[code];
}

// ── 差し込み口（素材を入れる場所）の名前（§2-3：`layer.id` の生表示を防ぐ）。 ──
// 場面編集（`SceneEditScreen`）とタイムライン編集（`TimelineProjectScreen`）が**同じ差し込み口を同じ名前で
// 呼ぶ**ための単一の参照元（§6）。別々に持つと、同じテンプレなのに画面によって「素材2」の指す先が変わる。

/** レイヤー id 別の表示名（複数スロットでも区別できるよう id をキーにする）。 */
const SLOT_LABEL_BY_ID: Record<string, string> = {
  background: "背景",
  mainVisual: "メイン素材",
  logo: "ロゴ",
};

/**
 * 声を作れなかったが、**前に作った声はそのまま使える**ときに添える一言（#755-3）。
 *
 * ⚠️ **添えるのは本当に鳴るときだけ**＝場面形式は保存済みの音声（`narrationAudioById`）、
 * タイムライン形式は `voicePath` が鳴らす材料なので、**その材料があるか**で判断する
 *（印だけで判断すると「読み込めなかった声」にも「使えます」と言ってしまう）。
 */
export const KEPT_PREVIOUS_VOICE_SUFFIX = "前に作った声はそのまま使えます。";

/**
 * 固定した列でできないことの断り（#819-2）。**やろうとしたこと**で締めだけ変える。
 *
 * ⚠️ **画面で手書きしない**（§9-3・`canvasHoldMessage` と同じ流儀）＝以前は「動かす」（共有の
 * `TIMELINE_EDIT_LOCKED`）と「変える」「削除する」（画面直書き）が混ざり、**同じ状況に2通りの文**が
 * 出ていた（`Ctrl+K` は共有・ボタンは手書き）。手書きは禁止語の検査（`uiLabels.test.ts`）の外にも
 * 落ちる＝出したまま誰も気づかない。
 * ⚠️ **「動かす」は共有コードのまま**（`TIMELINE_EDIT_LOCKED`）＝あちらは domain が返す断りで、
 * 画面の外（`editBlocked`）からも出る。ここは**画面が先回りして押せなくするときの説明**。
 * ⚠️ **`"duplicate"` は持たない**（#831）＝複製ボタン・メニューはどちらも `editGuard` を通り、
 * 固定は**選択の関門が先に締める**ので `"content"` が出る（`duplicateExtra` まで届かない）。
 * 「複製するには」の文はどこからも呼ばれない定義だけが残っていた＝到達しない文言は持たない
 * （§2-5・#812 と同型の後始末）。
 */
export type LockedTrackAction = "content" | "delete";

export function lockedTrackMessage(action: LockedTrackAction): string {
  const what = action === "content" ? "中身を変える" : "削除する";
  return `この列は固定されています。${what}には固定を外してください`;
}

/**
 * 「動画に出さない」列では**複製できない**（#819-2）。
 *
 * ⚠️ **共有の `TIMELINE_EDIT_HIDDEN_TRACK` は使えない**＝あちらの次の行動は「ほかの列へ置く」だが、
 * **複製は必ず元の列に作る**ので、言われたとおりにしても増やせない（行き止まり・§2-5）。
 * 別の文が要るのは正しいが、**画面で手書きしない**＝ここに置いて1か所から出す。
 */
export function hiddenTrackDuplicateMessage(): string {
  return "動画に出さない列では増やせません。列の「⋮」から「動画に出す」を選んでください";
}

/**
 * キャンバスで**掴めない理由**（タイムライン編集）。`count` を渡すとまとめて動かしたときの言い方になる。
 *
 * ⚠️ **1か所にまとめる**（#788-1）＝以前は単体選択のときだけ理由別に出し分け、まとめて動かしたときは
 * 常に「**固定を外してください**」だった＝**動きが原因のときは従っても直らない**案内になっていた。
 * 言い方が2か所にあると、片方だけ直す（＝今回の割れそのもの）ので、単体もまとめても同じ文からつくる。
 *
 * ⚠️ **次の行動は「その場面で本当に押せるもの」だけを言う**（§2-5・#788 レビュー 🔴）。
 * **単体**（`count` 無し）＝「位置・大きさ」の欄の中に出るので、**下の数値**も**「動き」**も目の前にある。
 * **まとめて**（`count` あり）＝2つ以上選んでいるときにしか出ず、そのとき「選んだ部品」の欄は
 * 「1つだけ選ぶと、位置や長さを変えられます」に替わっていて、**数値の欄も「動き」も画面に無い**。
 * そこで数値や「動き」を案内すると、言われたとおりに探しても見つからない＝行き止まりになる。
 * まとめてのときに**実在するのは矢印キーだけ**（そちらは列の固定しか見ないので、動き・まとまりでは効く）。
 */
export type CanvasHoldReason = "track" | "animation" | "group";

export function canvasHoldMessage(reason: CanvasHoldReason, count?: number): string {
  const many = count != null;
  const n = many ? `${count}個` : "";
  // 単体＝いま触ろうとしている／まとめて＝もう動かした後、なので締めの言い方だけ変える。
  const tail = many ? "動かしていません。" : "仕上がり確認の上では動かせません。";
  // 動き・まとまりは**矢印キーでも変えられる**（そちらは列の固定しか見ない）＝行き止まりにしない。
  // まとめてのときは数値の欄が画面に無いので、**1つだけ選べば数値でも変えられる**ことを添える。
  const byNumbers = many ? "矢印キーで動かせます。1つだけ選ぶと数値でも変えられます。" : "下の数値（または矢印キー）で変えるか、";
  switch (reason) {
    // 固定は**外せば直る**＝行き先が固定の切り替えなので、数値の案内は添えない。
    // ⚠️ 固定した列では**矢印も効かない**ので、まとめてのときも矢印を案内しない。
    case "track":
      return `固定された列の部品${n}は${tail}動かすには固定を外してください。`;
    case "animation":
      return many
        ? `動きが効いている部品${n}は${tail}${byNumbers}`
        : `動きが効いている部品は${tail}${byNumbers}「動き」で調整してください。`;
    case "group":
      return many
        ? `まとまりの変形が効いている部品${n}は${tail}${byNumbers}`
        : `まとまりの変形が効いている部品は${tail}下の数値（または矢印キー）で変えてください。`;
  }
}

/** 差し込み口1つの表示名。未登録 id は種別から日本語化する。 */
export function slotLabelFor(layer: Pick<Layer, "id" | "type">): string {
  if (SLOT_LABEL_BY_ID[layer.id]) return SLOT_LABEL_BY_ID[layer.id];
  if (layer.type === LAYER_TYPE.background) return "背景";
  if (layer.type === LAYER_TYPE.logo) return "ロゴ";
  return "素材";
}

/**
 * 差し込み口の並びぶんの表示名。**同じ名前が複数あるときだけ連番を付ける**（「素材1」「素材2」）＝
 * 1つしかないのに「素材1」と出さない。並び順は渡された層の順（描画の並びと同じ）。
 */
export function slotLabelsFor(layers: readonly Pick<Layer, "id" | "type">[]): string[] {
  const total = new Map<string, number>();
  for (const l of layers) total.set(slotLabelFor(l), (total.get(slotLabelFor(l)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return layers.map((l) => {
    const base = slotLabelFor(l);
    if ((total.get(base) ?? 0) <= 1) return base;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}${n}`;
  });
}

/**
 * α-6 で足した断り・知らせの文言（読み方辞書・持ち込みフォント・会社の見た目）。
 *
 * ⚠️ **`15 §6` の表と機械で突き合わせる**（α-6 出口監査 🟡18）＝これらは画面や
 * `infrastructure` に直書きされていて `errorStateTable.test.ts` の走査の外にあり、
 * **既に1件ズレていた**（句点の有無）。表と実装のどちらかだけ直すと落ちる形にする。
 * ⚠️ **件数が入る文は関数**（下）＝表は `N` と書くので、`N` を入れて突き合わせる。
 */
export const alpha6Message = {
  READING_DICT_WORD_CONFLICT: "音声ソフトに、同じ言葉で違う読み方が登録されています。この読み方は上書きしていません",
  READING_DICT_IMPORT_DUPLICATE:
    "読み込んだ一覧に、同じ言葉で読みが違うものがありました。そのままにするか、読み込んだ方に置き換えるかを選べます",
  BRAND_KIT_SAVE_FAILED: "会社の見た目を保存できませんでした。しばらくしてから、もう一度お試しください",
} as const;

/**
 * 開けなかった動画を、控えから戻せると知らせる（#263）。
 *
 * ⚠️ **どこまで戻るかを言う**＝日時が無いと「どれだけの作業が消えるか」が分からず、決められない。
 * ⚠️ **開けなかったほうを消さないことも言う**＝戻すのをためらわせない。
 */
export function restoreOfferMessage(savedAt: string): string {
  return (
    `この動画は開けませんでしたが、${savedAt} に保存できていたところが残っています。` +
    "そこから開き直せます。開けなかったほうも消さずに残ります。"
  );
}

/**
 * 控えの日時の見せ方。
 *
 * ⚠️ **文言と分けてある**＝差し込む値を外から渡せる形にしておくと、
 * `15 §6` の表と**等値で突き合わせられる**（`errorStateTable.test.ts` は families としか比べない）。
 * 日時を中で作ると、表に書けるのは実際に出る文と違うものになる。
 */
export function backupSavedAtLabel(savedAt: Date): string {
  return savedAt.toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 控えへ戻せなかったとき（§2-5＝次の行動）。 */
export const RESTORE_FAILED_MESSAGE =
  "前に保存できていたところから開けませんでした。一覧から別の動画を選んでください。";

/**
 * 動画を書き出せなかったとき（`15 §6` `EXPORT_FAILED`）。
 *
 * ⚠️ **繰り返す人に次が無かった**（#962）＝「もう一度お試しください」で終わっており、
 * 何度やっても失敗する人は行き止まりだった。#396 で**うまくいかないときの記録**ができたので、
 * そこへ案内する。⚠️ **記録は外へ送られない**ので、送るかどうかは利用者が決める。
 * ⚠️ **場面形式とタイムライン形式で言い方が違う**（「保存」と「書き出し」）＝画面の言葉に合わせる。
 */
export const exportFailedMessage = {
  EXPORT_FAILED_SCENE:
    "動画の保存に失敗しました。もう一度お試しください。何度も失敗するときは、設定の「記録の場所を開く」から記録をお送りください",
  EXPORT_FAILED_TIMELINE:
    "動画を書き出せませんでした。しばらくしてから、もう一度お試しください。何度も失敗するときは、設定の「記録の場所を開く」から記録をお送りください",
} as const;

/**
 * 見た目パターンの保存で断るときの文言（`15 §6`）。
 *
 * ⚠️ **表と機械で結ぶために family にする**（#960 レビュー）＝`errorStateTable.test.ts` は
 * `codeMessages()` に載っている文言としか突き合わせないので、画面や store に直書きすると
 * **表にだけ行があってコードとずれても緑**のまま通る（`alpha6Message` を作ったのと同じ穴）。
 */
export const templateSaveMessage = {
  USER_TEMPLATE_SAVE_INVALID:
    "この見た目パターンは、いまの内容では保存できません。直前に変えた項目を「取り消す」で元に戻してから、もう一度お試しください。",
} as const;

/**
 * 使っている持ち込みフォントが**見つからない**（`USER_FONT_MISSING`）。
 * ⚠️ **件数を差し込む**＝表は `N` と書くので、テストは `N` を渡して突き合わせる。
 */
export function userFontMissingMessage(count: string | number): string {
  return (
    `この動画で使っている文字の形（フォント）が${count}つ見つかりません。` +
    `このまま書き出すと別の字になります。設定の「文字の形」から取り込み直すか、` +
    `使っている場面で別の文字の形を選び直してください`
  );
}

/**
 * 使っている持ち込みフォントを**調べられなかった**（`USER_FONT_UNREADABLE`）。
 * ⚠️ **「見つからない」とは別**＝目録そのものが読めないので、待っても埋まらない（§2-5）。
 */
export function userFontUnreadableMessage(count: string | number): string {
  return (
    `この動画は取り込んだ文字の形（フォント）を${count}つ使っていますが、` +
    `いま手元にあるかを調べられませんでした。このまま書き出すと別の字になることがあります。` +
    `アプリを開き直してから、もう一度お試しください`
  );
}

/**
 * うまくいかないときの記録（#396）。**「ログ」とは言わない**（§2-3＝実装用語の置き換え・`06 §3`）。
 *
 * ⚠️ **外へ送らないことを先に言う**＝「記録が残る」とだけ書くと、勝手に送られると受け取られうる（§2-6）。
 * ⚠️ **中身は見せない**＝入っているのは実装の言葉なので、導線は「場所を開く」までにする。
 */
export const TROUBLE_LOG_TITLE = "うまくいかないときの記録";
/**
 * ⚠️ **中身に何が入るかまで言う**（#957 レビュー）＝この記録には、入力した会社名や案件の内容から
 * 作られた文章の一部が混じることがある（例：たたき台づくりの応答が形に合わなかったときの中身）。
 * このパソコンから出ないので §2-6 には触れないが、**利用者はこのファイルを人に送る**ので、
 * 送る前に中身の見当がつくようにしておく。**送るのは利用者の判断**なので、伏せずに知らせる側を採る。
 */
export const TROUBLE_LOG_DESC =
  "動画の書き出しや声づくりがうまくいかないとき、原因を調べるための記録がこのパソコンに残ります。"
  + "外へは何も送りません。入力した内容の一部が記録に含まれることがあるので、"
  + "作った側に見てもらうときは、この場所のファイルをお送りください。";
export const TROUBLE_LOG_OPEN = "記録の場所を開く";
/** 開けなかったとき（§2-5＝次の行動を示す）。 */
export const TROUBLE_LOG_OPEN_FAILED =
  "記録の場所を開けませんでした。もう一度お試しください。";
