// 複数画面で共有するユーザー向けラベル（§6：文言は1か所に集約／§2-3：技術用語を出さない）。
import { AI_ASSET_SEND_MAX, VOLUME_POINTS_MAX } from "../domain/constants";
import { FREE_ELEMENT_KINDS, LAYER_TYPE, SUBTITLE_SOURCE_KIND } from "../domain/enums";
import type { AssetType, Fit, FreeElementKind, SubtitleSourceKind, TextKey, TimelineClipKind, TrackKind } from "../domain/enums";
import type { FreeContentHidden } from "../domain/project/sceneOps";
import type { SubtitleSilentReason } from "../domain/project/subtitleBinding";
import type { BakeNote, BakeNoteCode } from "../domain/timeline/bake";
import type { Layer } from "../domain/template/types";
import type { EditBlockedReason } from "../domain/timeline/edit";
import type { TimelineExportBlockCode } from "../domain/timeline/export";
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
 * 置けなかった理由の案内（`15 §6` の `TIMELINE_EDIT_*`・ADR-0032）。**全コードに文言が要る**＝
 * 理由が増えたらコンパイルエラーで気づく（無言で操作が効かない状態を作らない）。
 * どれも「なぜ置けないか」でなく**次にどうすれば置けるか**を言う（§2-5）。
 */
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

export const editBlockedMessage: Record<EditBlockedReason, string> = {
  TIMELINE_EDIT_OVERLAP: "その場所には先に置いてある部品があります。ずらすか、列を足して重ねてください",
  TIMELINE_EDIT_TRACK_KIND: "音の部品は音の列に、絵や文字の部品は映像の列に置いてください",
  TIMELINE_EDIT_LOCKED: "この列は固定されています。動かすには固定を外してください",
  TIMELINE_EDIT_NOT_FOUND: "その部品は見つかりませんでした。選び直してください",
  TIMELINE_EDIT_EXPORTING: "いま動画を書き出しています。終わってから編集してください",
  TIMELINE_EDIT_ORIENTATION: "この見た目パターンは向き（横長・縦長）がこの動画と違うので置けません。同じ向きのものを選んでください",
  TIMELINE_EDIT_EXPLODE_ANCHOR: "動き（拡大・回転）が付いた部品は、そのままバラすと絵がずれます。動きを外してからバラしてください",
  TIMELINE_EDIT_LINKED_SUBTITLE: "連動している字幕を置ける場所がありません。字幕をほかの列へ移すか、連動をやめてください",
  TIMELINE_EDIT_LINKED_SUBTITLE_TIME: "連動している字幕の時間は読み上げに合わせています。連動をやめると自分で動かせます",
  TIMELINE_EDIT_VOLUME_POINTS_FULL: `音量の変化は1つの部品に${VOLUME_POINTS_MAX}か所までです。ほかの点を外してから置いてください`,
  TIMELINE_EDIT_VOLUME_POINTS_KIND: "音量の変化を置けるのは、音や読み上げの部品だけです。音の部品を選び直してください",
};

/**
 * 書き出せない理由の案内（`15 §6` の `TIMELINE_EXPORT_*`・ADR-0032・#631）。`editBlockedMessage` と同じ流儀で
 * **全コードに文言が要る**＝理由が増えたら気づく。動画の素材は「まだ動かせず音も鳴らない」ので、
 * 静止画＋無音の動画を成功として出さずに断る（ADR-0026④）。
 */
export const exportBlockedMessage: Record<TimelineExportBlockCode, string> = {
  TIMELINE_EXPORT_EMPTY: "まだ何も置かれていないので、動画を書き出せません。素材や文字を置いてから書き出してください",
  TIMELINE_EXPORT_VIDEO_ASSET_UNSUPPORTED:
    "動画の素材はまだ書き出せません。その部品を外すか、写真に置き換えてから書き出してください",
  TIMELINE_EXPORT_TEMPLATE_UNRESOLVED:
    "見た目パターンが見つからない部品があります。そのままでは動画に出ません。見た目パターンを読み込み直すか、その部品を置き直してください",
  TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN:
    "連動する読み上げが見つからない字幕があります。そのままでは動画に出ません。連動先を選び直すか、字幕の文を入れてください",
  TIMELINE_EXPORT_VOLUME_POINTS_TOO_MANY: `音量の変化の点が多すぎる部品があります。1つの部品に置けるのは${VOLUME_POINTS_MAX}個までです。点を減らすか、部品を分けてください`,
};

// ── 差し込み口（素材を入れる場所）の名前（§2-3：`layer.id` の生表示を防ぐ）。 ──
// 場面編集（`SceneEditScreen`）とタイムライン編集（`TimelineProjectScreen`）が**同じ差し込み口を同じ名前で
// 呼ぶ**ための単一の参照元（§6）。別々に持つと、同じテンプレなのに画面によって「素材2」の指す先が変わる。

/** レイヤー id 別の表示名（複数スロットでも区別できるよう id をキーにする）。 */
const SLOT_LABEL_BY_ID: Record<string, string> = {
  background: "背景",
  mainVisual: "メイン素材",
  logo: "ロゴ",
};

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
