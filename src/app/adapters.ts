// ドメイン（Scene/Part/Asset/Warning）→ 画面用UIモデル への変換。
// UIは見た目に専念し、ドメインを正とする（CLAUDE.md §4）。表示語は非技術語。
import { ASSET_TYPE, FREE_CATEGORY, type SceneCategory } from "../domain/enums";
import { HEIGHT, MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT, WIDTH } from "../domain/constants";
import { validateFreeLayout } from "../domain/project/freeLayout";
import { missingUserFontIds, usedUserFontIds } from "../domain/font/usedFonts";
import { sceneActiveAssetIds, sceneActivePlacedAssetIds } from "../domain/project/assetUsage";
import { sceneLines, sceneNeedsVoice } from "../domain/project/narrationLines";
import { MAIN_ASSET_LAYER_KEYS } from "../domain/template/slotAssign";
import { groupIndices } from "../domain/project/lineTimeline";
import { sceneDisplayedSubtitleTexts, sceneSilentSubtitleCount } from "../domain/project/subtitleBinding";
import { afterAnimNoSettledSceneNumbers, unplaceableVideoSceneNumbers } from "../renderer/export/videoSlotPlacement";
import { shortenedTransitionSceneNumbers, swallowedByNextTransitionSceneNumbers, swallowedByOwnTransitionSceneNumbers, swallowedByTransitionSceneNumbers } from "../domain/project/sceneTransitions";
import { isSubtitleItem, sceneDrawnLayouts, subtitleOverflowsCanvas } from "../renderer/layout";
import { outsideSafeArea, safeAreaRect } from "../domain/preview/safeArea";
import { drawnTextRect } from "../domain/text/subtitleBands";
import { blurryAssets, tooFastScenes, truncatedTexts } from "../domain/project/precheckExtras";
import { hasSimultaneousLines } from "../domain/project/lineTimeline";
// 利用者向けの文言は uiLabels に集約（§6）。依存は adapters → uiLabels の一方向
//（以前は uiLabels → adapters で `formatSceneNumbers` を借りており逆向きだった・#563 レビュー）。
import { formatSceneNumbers, subtitleOverflowPrecheckDetail, swallowedByNextPrecheckDetail, userFontMissingMessage, userFontUnreadableMessage } from "./uiLabels";
import type { Asset, ElementAnimation, Part, Scene, Warning } from "../domain/project/types";
import type { Template } from "../domain/template/types";
import type { DraftRow, DraftWarning, PrecheckItem } from "./data/mockData";

// 場面種別のユーザー向けラベル（§2-3）。型付き（SceneCategory 網羅）＝場面種別追加時にコンパイル検知。
// 表示語の単一参照元＝場面編集など他画面もこれを使う（#413・二重定義の解消）。
export const sceneTypeLabel: Record<SceneCategory, string> = {
  opening: "オープニング",
  closing: "クロージング",
  photo_intro: "写真紹介",
  video_intro: "動画紹介",
  point_list: "ポイント紹介",
  message: "メッセージ",
  full_visual: "全画面",
  chapter: "区切り",
  no_yuko: "ゆうこなし",
  free: "自由配置",
};

/**
 * シーンの主役素材（mainVisual→background→最初の非null）を返す。
 * 数える対象は**その見た目が実際に描く差し込み素材だけ**（`sceneActivePlacedAssetIds`）：
 * - 切替で差し込み先を失った休眠の割当は主役にしない（台本表に「写真あり」と出るのに動画に出ない、を防ぐ・#547 P3-14）。
 * - **立ち絵（ゆうこ）は候補に入れない**＝素材ではなく登場人物。入れると `assetType:'yuko'` が「写真」として
 *   素材欄に並ぶ（写真を入れていない場面が「写真あり」に見える・#547 P3-14 レビュー）。
 */
function mainAsset(scene: Scene, template: Template | undefined, assets: Asset[]): Asset | undefined {
  const activeIds = sceneActivePlacedAssetIds(scene, template); // FREE は自由配置の素材・通常は描かれる差し込み先
  const active = new Set(activeIds);
  const find = (id: string | null | undefined): Asset | undefined =>
    id && active.has(id) ? assets.find((a) => a.assetId === id) : undefined;
  // 主役の決め方は domain に1つ（押したときの入れ先＝`slotForAsset` と共有・#1030）。
  for (const key of MAIN_ASSET_LAYER_KEYS) {
    const found = find(scene.assetRefs[key]);
    if (found) return found;
  }
  // 主役キーが無ければ実効表現の先頭（通常は assetRefs の並び順、FREE は自由配置の並び順）。
  for (const id of activeIds) {
    const found = assets.find((a) => a.assetId === id);
    if (found) return found;
  }
  return undefined;
}

/** 内部 Scene → 台本表の1行。 */
export function sceneToDraftRow(
  scene: Scene,
  parts: Part[],
  templates: Template[],
  assets: Asset[],
): DraftRow {
  const part = parts.find((p) => p.partId === scene.partId);
  const template = templates.find((t) => t.templateId === scene.templateId);
  const asset = mainAsset(scene, template, assets);
  const materialType: DraftRow["materialType"] =
    asset?.assetType === ASSET_TYPE.video ? "video" : asset ? "photo" : "none";

  return {
    id: scene.sceneId,
    order: scene.order,
    part: part?.title ?? "",
    scene: sceneTypeLabel[scene.sceneType],
    material: asset?.displayName ?? "（未設定）",
    line: scene.narration.text,
    look: template?.name ?? "見た目が見つかりません",
    materialType,
    // NarrationStatus と VoiceStatus は同一の値集合
    voiceStatus: scene.narration.status,
  };
}

/** 検証/補正の Warning → 画面表示用。 */
export function warningsToDraftWarnings(warnings: Warning[]): DraftWarning[] {
  return warnings.map((w) => ({
    message: w.message,
    severity: w.severity === "info" ? "info" : "warning",
  }));
}

/**
 * この項目が残っていると**書き出しが必ず失敗する**か（#547 P2-5）。
 * 公開前チェックの主ボタンと書き出し画面の「動画を保存」が**同じ述語**を見るための単一の参照元。
 * 片方だけ別の条件で止めると「片方からは出せるのに片方からは止まる」不整合になる（ADR-0026②）。
 * 立てる条件は書き出し側の停止条件（`renderer/export/buildExportScenes` の throw）と対で維持すること。
 */
export function isExportBlocking(item: PrecheckItem): boolean {
  return !!item.blocksExport;
}

/**
 * 上記に当てはまる項目だけを返す。**項目を既に持っている画面は `items.filter(isExportBlocking)` を使うこと**
 * （この関数は内部で `buildPrecheckItems` を呼ぶので、二重に計算しない）。
 */
export function exportBlockingItems(
  scenes: Scene[], assets: Asset[], templates: Template[], overlayAnimations?: ElementAnimation[],
  /**
   * 書き出しを止める判定に要る材料（#261）。⚠️ **`blocksExport` の項目が使う材料は、
   * ここにも通さないと直行導線ですり抜ける**（PR #886 レビュー 🔴）＝サイドバーから
   * 「動画を保存」へ直接入ると、公開前チェックを経由しないので項目そのものが作られない。
   */
  fonts?: { projectFontId?: string | null; availableUserFontIds?: readonly string[]; userFontsUnreadable?: boolean },
): PrecheckItem[] {
  return buildPrecheckItems(scenes, assets, templates, overlayAnimations, undefined, undefined, fonts).filter(isExportBlocking);
}

/**
 * 書き出しを止める項目があるときに出す案内（§2-5＝原因＋次の行動）。**文言はここ1か所**に置き、
 * 画面ごとに変えるのは「次の行動」だけにする（同じ事象で言い回しが割れない・§6）。
 * @param from 出す画面。公開前チェックは各項目行の「直す」へ、書き出し画面は公開前チェックへ誘導する。
 */
export function exportBlockedMessage(items: PrecheckItem[], from: "precheck" | "export"): string {
  const names = items.map((i) => i.label).join("・");
  const next = from === "precheck" ? "上の「直す」から直してから" : "公開前チェックで直してから";
  return `このままでは動画を書き出せない項目があります（${names}）。${next}、もう一度お試しください。`;
}


/** 公開前チェックの結果を、実際のシーン/素材から算出する（一部は自動チェック未対応の定型）。 */
export function buildPrecheckItems(
  scenes: Scene[],
  assets: Asset[],
  templates: Template[],
  overlayAnimations?: ElementAnimation[],
  /**
   * 実体が見つからない素材の id（#347）。⚠️ **省略＝調べていない**（「全部そろっている」ではない）＝
   * 調べられない場（ブラウザ・テスト）で**嘘の「問題なし」を出さない**ため、項目そのものを出さない。
   */
  missingAssetIds?: readonly string[],
  /** 動画全体の BGM の素材 id（`meta.bgmSettings.assetId`）。使用中に数える（#348 レビュー）。 */
  projectBgmAssetId?: string | null,
  /**
   * 動画全体のフォント（`meta.videoSettings.fontId`）と、いま持っている持ち込みフォントの id（#261）。
   * ⚠️ **`availableUserFontIds` の省略＝調べていない**（「全部そろっている」ではない）＝
   * 調べられない場で嘘の「問題なし」を出さない（`missingAssetIds` と同じ流儀）。
   */
  fonts?: { projectFontId?: string | null; availableUserFontIds?: readonly string[]; userFontsUnreadable?: boolean },
): PrecheckItem[] {
  const items: PrecheckItem[] = [];
  const templateOf = (s: Scene): Template | undefined => templates.find((t) => t.templateId === s.templateId);
  // 場面に紐づく項目は「どの場面か」を番号で列挙し（#403・どの場面が問題か示す）、action がある項目は最初の該当場面へ
  // 飛べるよう sceneId を持たせる（#400）。番号は scenes の位置（1始まり）＝利用者が見る場面番号。多いと先頭8件＋「ほか N 件」。
  const fmtScenes = formatSceneNumbers;
  const offending = (pred: (s: Scene) => boolean): { nums: number[]; firstId?: string } => {
    const hits: { id: string; n: number }[] = [];
    scenes.forEach((s, i) => { if (pred(s)) hits.push({ id: s.sceneId, n: i + 1 }); });
    return { nums: hits.map((h) => h.n), firstId: hits[0]?.id };
  };

  // 掛け合い・単一 narration を統一して見る（sceneNeedsVoice＝実効行の未生成・#403 P1）。scene.narration.status は直接見ない
  // ＝掛け合いは全行生成済みでも narration.status が更新されないため「要対応」に残り、「声を作成」が no-op に見えるバグを防ぐ。
  const voice = offending(sceneNeedsVoice);
  items.push(
    voice.nums.length > 0
      ? { id: "voice", label: "読み上げの声", detail: `${fmtScenes(voice.nums)}で声がまだ作成されていません。書き出し前に作成してください。`, severity: "action", action: "声を作成", sceneId: voice.firstId }
      : { id: "voice", label: "読み上げの声", detail: "すべての場面で声が作成済みです。", severity: "ok" },
  );

  // 上限のフォールバックは正典定数を使う（生成側 transformPlan と同じ参照元・§2-7）。直書き（60/120）だと
  // 将来 定数を変えたとき「AI が生成する上限」と precheck の「長すぎ」警告が食い違う（#547 P1-3）。
  // 判定対象は**その場面が実際に表示しうる全字幕**（sceneDisplayedSubtitleTexts）＝通常/FREE・単独/掛け合い・
  // subtitleSource（読み上げ/全行/話者）・字幕 OFF を、描画（layout）・書き出しと同じ経路で解決する。texts.subtitle
  // だけ／掛け合い行だけ、といった分岐ごとの取りこぼし・誤警告（FREE 字幕対象を無視する等）を構造的に断つ
  // （#547 P1-3 レビュー・ADR-0029/ADR-0026②）。#569（生成側の行テキスト長の漏れ）とは別＝これは precheck 側。
  const subtitleMax = (s: Scene) => templateOf(s)?.aiHint?.maxSubtitleLength ?? MAX_SUBTITLE_LEN_DEFAULT;
  const subtitle = offending((s) => sceneDisplayedSubtitleTexts(s, templateOf(s)).some((t) => t.length > subtitleMax(s)));
  items.push(
    subtitle.nums.length > 0
      ? { id: "subtitle", label: "字幕の長さ", detail: `${fmtScenes(subtitle.nums)}の字幕が長いです。短くすると読みやすくなります。`, severity: "action", action: "短くする", sceneId: subtitle.firstId }
      : { id: "subtitle", label: "字幕の長さ", detail: "字幕の長さは読みやすい範囲です。", severity: "ok" },
  );

  // セリフの長さ／自由配置は warning のみで action ボタンが無いため sceneId は持たせない（場面番号は内容に列挙する）。
  // 掛け合いは本文が lines[].text 側にあるため、実効行（sceneLines）で各行の長さを見る（scene.narration.text 直参照は
  // 掛け合いで空＝未検出になる・ADR-0015）。単一 narration は sceneLines が1行に写すので従来と同一。
  const line = offending((s) => sceneLines(s).some((l) => l.text.length > (templateOf(s)?.aiHint?.maxNarrationLength ?? MAX_NARRATION_LEN_DEFAULT)));
  items.push(
    line.nums.length > 0
      ? { id: "line", label: "セリフの長さ", detail: `${fmtScenes(line.nums)}のセリフが長いです。短くすると聞き取りやすくなります。`, severity: "warning" }
      : { id: "line", label: "セリフの長さ", detail: "セリフの長さは適切です。", severity: "ok" },
  );

  const used = new Set<string>();
  // 実効表現だけを「使用中」と数える（休眠は除外）＝逆引き（MaterialsScreen の「使用場面」）と同一規則
  //（ADR-0030・`sceneActiveAssetIds`）。
  //
  // ⚠️ **削除の対象選び（#348 `unusedAssetIds`）とは規則が違う**＝あちらは**休眠も「置いてある」**と
  // 数える。目的が違うため＝ここは「動画に出るか」の警告（多少ずれても「そのままでよい」で済む）、
  // あちらは「消してよいか」（間違えると**取り消せない**）。**片方に寄せない**（寄せると、警告が
  // 出なくなるか、使っている素材を消させるかのどちらかになる）。
  for (const s of scenes) {
    for (const id of sceneActiveAssetIds(s, templateOf(s))) used.add(id);
    // 場面ごとの BGM も使用中（場面だけを見ると、鳴っている BGM を「使っていない」と数える）。
    if (s.bgmSettings?.assetId) used.add(s.bgmSettings.assetId);
  }
  // ⚠️ **動画全体の BGM を数える**（レビュー 🟡）＝BGM は場面ではなく `bgmSettings` から使われるので、
  // 数えないと**鳴っている BGM が「使われていない素材」に出る**（文言は「動画には入らないので」＝**嘘**）。
  if (projectBgmAssetId) used.add(projectBgmAssetId);
  const unused = assets.filter((a) => !used.has(a.assetId)).length;
  items.push(
    unused > 0
      ? { id: "unused", label: "使っていない素材", detail: `使われていない素材が${unused}つあります。動画には入らないので、そのままでも問題ありません。`, severity: "warning" }
      : { id: "unused", label: "使っていない素材", detail: "すべての素材が使われています。", severity: "ok" },
  );

  // ── 書き出す前の安心（#346）─────────────────────────────────────
  //
  // ⚠️ **判定は描画と同じものを通す**＝`layoutScene` が作ったアイテムを見る（別に数え直すと
  // 「チェックは通ったのに動画では切れている」が起きる）。見た目が解決できない場面は見ない
  //（そちらは「場面の見た目」の項目が受け持つ＝同じことを二度言わない）。
  // ⚠️ **数え上げは共有関数（`sceneDrawnLayouts`）を通す**（レビュー 🔴・2エージェントが実測で指摘）＝
  // `layoutScene` を opts なしで1回呼ぶと、掛け合いの場面では**実際に描かれる行ごとの字幕を
  // 一度も見ず**、代わりに**動画に出ない静的字幕**を見てしまう（見落としと誤検出が同時に起きる）。
  const laidOut = scenes
    .map((s) => ({ scene: s, template: templateOf(s) }))
    .filter((x): x is { scene: Scene; template: Template } => x.template != null)
    .map((x) => ({ scene: x.scene, items: sceneDrawnLayouts(x.scene, x.template).flatMap((l) => l.items) }));

  // ⚠️ **切り詰め（`…`）は「はみ出し」とは別の壊れ方**＝画面の中で完結するので、見ただけでは
  // 「そう書いたのか」「切れたのか」が分からない。
  // ⚠️ **同じ原因で2行出さない**（レビュー 🟡・`transitionShortened` の前例と同じ）＝
  // 横型の標準テンプレは字幕の枠が 74 字ぶんあり、**60 字（`MAX_SUBTITLE_LEN_DEFAULT`）で
  // 既に「字幕の長さ」が出ている**ので、切り詰めは必ずそれと重なる（原因も直し方も同じ）。
  // ⚠️ **項目ごと消さない**＝縦型は枠が 44〜46 字ぶんなので、**45〜60 字は「字幕の長さ」を
  // 素通りして切り詰めだけで拾える**（本物の穴を塞いでいる）。
  // ⚠️ **消すのは「長すぎると既に伝えた字幕」だけ**（PR #877 再レビュー 🟡×2）。
  // 段階的に絞ってきた＝①場面ごと丸ごと飛ばしていた → ②字幕アイテム全部を外した → ③いまここ。
  // ②でも足りなかったのは、**自由配置は字幕ボックスを複数置ける**（ADR-0029・併用が推奨）ため＝
  // 長い方の字幕で場面が「伝えた」になると、**別のボックスの切り詰め**（原因も直し方も別）まで消えていた。
  // 除外の単位を**アイテムの文言**まで下ろす（長さを超えているものだけ外す）。
  const alreadyTold = new Set(scenes.filter((_, i) => subtitle.nums.includes(i + 1)).map((s) => s.sceneId));
  const truncated = offending((s) => {
    const found = laidOut.find((x) => x.scene.sceneId === s.sceneId);
    if (found == null) return false;
    // 字幕かどうかは**共有の述語**（`isSubtitleItem`）で見る＝書き出しの「字幕を入れる」OFF と同じ判定（§2-7）。
    // 長さの基準も「字幕の長さ」の項目と**同じ関数**（`subtitleMax`）から採る（2か所に数字を書かない）。
    const max = subtitleMax(s);
    const items = alreadyTold.has(s.sceneId)
      ? found.items.filter((it) => !(isSubtitleItem(it) && (it.kind === "text" ? it.text.length : 0) > max))
      : found.items;
    return truncatedTexts(items).length > 0;
  });
  if (truncated.nums.length > 0) {
    items.push({
      id: "truncatedText",
      label: "切れている文字",
      detail: `${fmtScenes(truncated.nums)}の文字が枠に入りきらず、末尾が「…」になります。短くするか、場面編集で文字を小さくしてください。`,
      severity: "action",
      action: "直す",
      sceneId: truncated.firstId,
    });
  }

  // ⚠️ **引き伸ばしでぼやける素材**＝描く枠より元の絵が小さいもの。小さいこと自体は問題ではない
  // （ロゴのように小さく置く素材もある）ので、**描かれる枠と比べる**。
  const blurry = offending((s) => {
    const found = laidOut.find((x) => x.scene.sceneId === s.sceneId);
    return found != null && blurryAssets(found.items, assets).length > 0;
  });
  if (blurry.nums.length > 0) {
    items.push({
      id: "blurryAsset",
      label: "ぼやける素材",
      detail: `${fmtScenes(blurry.nums)}の写真・動画が、置いた大きさに対して小さいため、引き伸ばすとぼやけます。そのままでも動画は作れます。`,
      severity: "warning",
    });
  }

  // ⚠️ **「セリフの長さ」とは別**＝あちらは文字数そのもの、こちらは**尺に対して**多いか。
  // 短い場面に長いセリフを入れると、声は最後まで鳴るのに**場面が先に切り替わる**。
  // ⚠️ **同時に流す行はグループにまとめて渡す**（レビュー 🟡・ADR-0031）＝素朴に合算すると
  // 2人同時が**人数ぶん二重計上**される。窓の分け方は `lineTimeline` と同じ `groupIndices`。
  const tooFast = offending((s) => {
    const lines = sceneLines(s);
    return tooFastScenes(s, groupIndices(lines).map((g) => g.map((i) => lines[i].text)));
  });
  if (tooFast.nums.length > 0) {
    items.push({
      id: "tooFast",
      label: "早口になる場面",
      detail: `${fmtScenes(tooFast.nums)}は、表示する時間に対してセリフが多いです。表示時間を延ばすか、セリフを短くしてください。`,
      severity: "warning",
    });
  }

  // ⚠️ **端に寄りすぎた文字**（#265 の任意項目）＝画面の**外**へ出るもの（`subtitleOverflow`）とは別で、
  // 画面の中だが端に近い。テレビ・SNS で**切られる媒体でだけ**問題になるので**注意止まり**。
  // 判定は編集画面の「端の目安」と**同じ数字**（`safeAreaRect`）＝線の内側なのに注意が出ない/その逆、を作らない。
  const nearEdge = offending((s) => {
    const found = laidOut.find((x) => x.scene.sceneId === s.sceneId);
    const t = templateOf(s);
    if (!found || !t) return false;
    const safe = safeAreaRect(t.canvas, t.aspectRatio);
    // 文字だけを見る（写真・背景は端まで敷くのが普通＝出すと全場面に注意が付く）。
    // ⚠️ **描かれる矩形で見る**（α-6 出口監査 ℹ️）＝字幕は `anchorBottom` で上へ伸び、高さは
    // 実際の折返し行数で決まる。置いた箱のまま見ると、**画面外の断りと別の矩形**を見ることになる。
    return found.items.some((it) => it.kind === "text" && outsideSafeArea(drawnTextRect(it), safe));
  });
  if (nearEdge.nums.length > 0) {
    items.push({
      id: "nearEdge",
      label: "端に寄った文字",
      detail: `${fmtScenes(nearEdge.nums)}の文字が画面の端に近いです。テレビやSNSで切れることがあります（編集画面の「端の目安を出す」で確かめられます）。`,
      severity: "warning",
    });
  }

  // ⚠️ **見つからない素材は書き出す前に知らせる**（#347・§2-5・ADR-0026④）＝そのまま書き出すと
  // その場面が**黙って抜けた**動画になる。「使っていない素材」（そのままでよい警告）とは重さが違う
  // ので別項目にし、**使われているものだけ**を要対応にする（使っていない素材が消えていても実害が無い）。
  // 調べていない（`undefined`）ときは項目を出さない＝調べられない場で「問題なし」と嘘をつかない。
  if (missingAssetIds) {
    const missingInUse = assets.filter((a) => missingAssetIds.includes(a.assetId) && used.has(a.assetId));
    if (missingInUse.length > 0) {
      const names = missingInUse.slice(0, 3).map((a) => a.displayName).join("、");
      const more = missingInUse.length > 3 ? `ほか${missingInUse.length - 3}つ` : "";
      items.push({
        id: "missingAsset",
        label: "見つからない素材",
        detail: `動画で使っている素材のファイルが見つかりません（${names}${more}）。素材の画面で「ファイルを選び直す」から入れ直してください。置いた場所や設定はそのまま使えます。`,
        severity: "action",
      });
    }
  }

  // 見つからない持ち込みフォント（#261・ADR-0038）。⚠️ **黙って別の字体の動画を出さない**（§2-5）＝
  // 描画は既定へ倒れてよいが、**書き出しは止める**（`blocksExport`）。字体が変わった動画を
  // 「成功しました」として出すと、利用者は見るまで気づけない。
  const usedFontIds = usedUserFontIds(scenes, fonts?.projectFontId);
  const missingFonts = missingUserFontIds(usedFontIds, fonts?.availableUserFontIds);
  // ⚠️ **「調べられなかった」は3つ目の状態**（α-6 出口監査 🟡19 のレビュー）＝一覧が読めないときに
  // 「全部見つからない」と言うのは**嘘**（案内の「取り込み直す」も同じ目録を通るので必ず失敗＝行き止まり）、
  // かといって黙ると**別の字体の動画を成功として出す**（ADR-0038）。どちらにも倒さず、そう言って止める。
  if (usedFontIds.length > 0 && fonts?.userFontsUnreadable === true) {
    items.push({
      id: "unknownFont",
      label: "文字の形を調べられません",
      detail: `${userFontUnreadableMessage(usedFontIds.length)}。`,
      severity: "action",
      blocksExport: true,
    });
  }
  if (missingFonts.length > 0) {
    items.push({
      id: "missingFont",
      label: "見つからない文字の形",
      detail: `${userFontMissingMessage(missingFonts.length)}。`,
      severity: "action",
      blocksExport: true,
    });
  }

  // 自由配置（FREE 場面）の確認：要素が画面外・素材未解決・サイズ不正などがないか（ADR-0008 §8）。
  // FREE 場面が無いプロジェクトでは項目を出さない（通常プロジェクトのノイズを避ける）。
  // 実際に FREE の場面（テンプレ category=free）だけを対象にする＝通常テンプレへ戻した休眠 freeLayout は検査しない（ADR-0030・P2）。
  const freeScenes = scenes.filter((s) => templateOf(s)?.category === FREE_CATEGORY && (s.freeLayout?.length ?? 0) > 0);
  if (freeScenes.length > 0) {
    const badFree = offending((s) => {
      if (templateOf(s)?.category !== FREE_CATEGORY || (s.freeLayout?.length ?? 0) === 0) return false;
      const cv = templateOf(s)?.canvas ?? { width: WIDTH, height: HEIGHT };
      return validateFreeLayout(s.freeLayout ?? [], assets, cv).length > 0;
    });
    items.push(
      badFree.nums.length > 0
        ? { id: "freeLayout", label: "自由配置の確認", detail: `${fmtScenes(badFree.nums)}が、見直したほうがよい状態です（画面の外・素材の未設定など）。`, severity: "warning" }
        : { id: "freeLayout", label: "自由配置の確認", detail: "自由配置の場面は問題ありません。", severity: "ok" },
    );
  }

  // 置いたのに何も表示しない字幕（#547 P3-9・ADR-0026④）：字幕ボックスは表示文を「対象」から解決するため、
  // 場面の字幕 OFF・文が空・対象話者の不在で**黙って出ない**。原因が要素の外（読み上げ側のスイッチ・行ごとの字幕 ON/OFF）
  // にもあり、置いた本人には見えないので書き出し前に**場面つきで**知らせる（§2-5＝次の行動）。判定は描画と同じ単一の
  // 参照元（`sceneSilentSubtitleCount`→`subtitleSilentReason`→`freeSubtitleElementTexts`）＝実表示と食い違わない。
  // 理由ごとの直し方は場面編集の字幕欄が出すので、ここは場面へ戻す導線だけ持つ。問題が無ければ項目を出さない。
  // 字幕が画面からはみ出す場面（#533 P2／#563）。場面編集を開かないと気づけない状態にせず、書き出し前に拾う
  // （黙って画面外に切れたまま MP4 にしない・ADR-0026④）。判定は**実描画と同じ layoutScene** を通す共有関数。
  // 書き出しは止めない＝「直せば良くなる」警告側（P2-5 のハードブロッカーとは分離）。
  const isSubtitleOverflow = (s: Scene): boolean => {
    const t = templateOf(s);
    return t != null && subtitleOverflowsCanvas(s, t);
  };
  const subtitleOverflow = offending(isSubtitleOverflow);
  if (subtitleOverflow.nums.length > 0) {
    // 「次の行動」は原因で変わる（同時＝セリフを減らす／1帯＝小さくする）。挙げた場面の原因が**揃っているときだけ**
    // 断定し、混ざっていたら場面編集へ誘導する＝片方の場面に誤った直し方を示さない（#563 レビュー・§2-5）。
    const causes = new Set(scenes.filter(isSubtitleOverflow).map(hasSimultaneousLines));
    const cause = causes.size === 1 ? (causes.has(true) ? "simultaneous" : "single") : "mixed";
    items.push({
      id: "subtitleOverflow",
      label: "画面からはみ出す字幕",
      detail: subtitleOverflowPrecheckDetail(fmtScenes(subtitleOverflow.nums), cause),
      severity: "action",
      action: "直す",
      sceneId: subtitleOverflow.firstId,
    });
  }
  const silentSubtitle = offending((s) => sceneSilentSubtitleCount(s, templateOf(s)) > 0);
  if (silentSubtitle.nums.length > 0) {
    items.push({
      id: "silentSubtitle",
      label: "表示されない字幕",
      detail: `${fmtScenes(silentSubtitle.nums)}に、いまは何も表示しない字幕があります。場面編集でその字幕を選ぶと、出ない理由と直し方が出ます。`,
      severity: "action",
      action: "直す",
      sceneId: silentSubtitle.firstId,
    });
  }

  // 場面の見た目（テンプレ・Codex 監査 2026-07-13・#434 と同流儀）：templateId が解決できない場面（利用者テンプレの削除・
  // 別環境で開く等でダングリング）は、書き出しで黙って落とすと場面が MP4 から消えテロップ/BGM もズレるため §2-5 で停止する。
  // ここでは事前に**場面つきで**警告し、該当場面へ戻れる導線（action＝直す）を出す。問題が無ければ項目を出さない。
  const noTemplate = offending((s) => !templateOf(s));
  if (noTemplate.nums.length > 0) {
    items.push({
      id: "sceneTemplate",
      label: "場面の見た目",
      detail: `${fmtScenes(noTemplate.nums)}の見た目が見つかりません。場面編集で選び直すか、「まとめて標準にする」で標準の見た目に変えてください。`,
      severity: "action",
      action: "直す",
      sceneId: noTemplate.firstId,
      blocksExport: true, // 書き出しは templateUnresolvedError で停止する
    });
  }

  // 動画の配置（#434・ADR-0026）：動画スロットがあるのにレイアウトへ配置できない場面（分割失敗＝内部不整合や
  // スロット/グループの非表示など）を**場面つきで**警告する。これを見逃すと書き出しが停止する（黙って静止画化しない）。
  // 問題がある場面が無ければ項目自体を出さない（通常プロジェクトのノイズを避ける・freeLayout チェックと同方針）。
  const templateById = new Map(templates.map((t) => [t.templateId, t] as const));
  const unplaceable = unplaceableVideoSceneNumbers(scenes, templateById, (id) => assets.find((a) => a.assetId === id));
  if (unplaceable.length > 0) {
    items.push({
      id: "videoPlacement",
      label: "動画の配置",
      detail: `${fmtScenes(unplaceable)}で動画を配置できません。場面編集で動画を置き直してから書き出してください。`,
      severity: "action",
      action: "直す",
      // 最初の該当場面（unplaceable は 1始まりの位置）へ飛ぶ。
      sceneId: scenes[unplaceable[0] - 1]?.sceneId,
      blocksExport: true, // 書き出しは videoUnplaceableError で停止する
    });
  }

  // 切り替えに飲み込まれる場面（#553/#554・ADR-0026④）：切り替えが場面尺以上だと、その場面は総尺に寄与せず
  // ⚠️ **両側に切り替えがある場面はこちらではない**＝予算（#727）が救うので、下の「短くしています」の担当。
  // ⚠️ ここ（①）は**自分の入場が自分の尺を覆う意図**だけ。**次の場面の入場に覆われる形（②）は上の項目**
  // ＝触る先が違う（自分には切り替えが無い）ので、案内を分けている（#740 レビュー）。
  // **プレビューには出るのに書き出しでは独立した尺を持たない**（preview≠export）。#553 で場面尺の下限を撤廃する
  // までは構造的に到達不能だった（最短3秒 > 切り替え既定0.5秒）が、「0.3秒の場面＋フェード」が作れるように
  // なったため**黙って壊さず警告で見せる**。原因＋次の行動を示す（§2-5）。クランプの strict 化は #554。
  // ⚠️ **原因で分ける**（#740 レビュー）＝②（次の場面の切り替えに覆われる）は、その場面自身に切り替えが
  // 無いので「切り替えを短く」だけ言うと飛んだ先が行き止まりになる。触る先まで含めて言い分ける。
  const swallowedByNext = swallowedByNextTransitionSceneNumbers(scenes);
  if (swallowedByNext.length > 0) {
    // 触るのは**次の場面**なので、番号もそちらを出す（1始まり＝`n + 1`）。
    items.push({
      id: "transitionSwallowByNext",
      label: "切り替えと表示時間",
      detail: swallowedByNextPrecheckDetail(fmtScenes(swallowedByNext), fmtScenes(swallowedByNext.map((n) => n + 1))),
      severity: "action",
      action: "直す",
      // 飛び先は**覆われている場面**＝そこで「表示時間を長くする」がすぐ押せる（もう一方の直し方は文言が示す）。
      sceneId: scenes[swallowedByNext[0] - 1]?.sceneId,
    });
  }
  const swallowed = swallowedByOwnTransitionSceneNumbers(scenes);
  if (swallowed.length > 0) {
    items.push({
      id: "transitionSwallow",
      label: "切り替えと表示時間",
      detail: `${fmtScenes(swallowed)}は画面の切り替えに飲み込まれて動画に出ません。表示時間を長くするか、切り替えを短く（または「なし」に）してください。`,
      // #444（設定できるのに効かない）と同じ重さ＝action にする。warning だと PrecheckScreen が
      // 操作列に「—」を出すだけで sceneId が読まれず（ジャンプは item.action があるときのみ描画）、
      // 「該当場面へ飛べる」が成立しない（レビュー指摘）。場面が動画から消える＝直すべき事象。
      severity: "action",
      action: "直す",
      sceneId: scenes[swallowed[0] - 1]?.sceneId,
    });
  }

  // 切り替えが場面の長さに入らず**短くなった**場面（#727・ADR-0026④）。上の「飲み込まれる」は
  // 「切り替え ≥ 場面尺」しか見ないので、**両側の合計だけが尺を超える帯**（既定なら 0.5〜1.0 秒の場面）は
  // 拾えず**無言**だった。黙って縮めない（§2-5）＝縮めたことと、直し方を出す。
  const shortened = shortenedTransitionSceneNumbers(scenes);
  // 飲み込まれる場面（①②とも）は上で言っているので、そちらに出た番号はここでは繰り返さない
  // （同じ場面に2つ出さない）。⚠️ #740 で②が加わったぶん、**これまで「短くしています」だった場面が
  // 「単独では映りません」へ入れ替わる**ことがある（直し方の案内は同じ＝表示時間を長く／切り替えを短く）。
  const allSwallowed = swallowedByTransitionSceneNumbers(scenes);
  const shortenedOnly = shortened.filter((n) => !allSwallowed.includes(n));
  if (shortenedOnly.length > 0) {
    items.push({
      id: "transitionShortened",
      // 見出しは隣（飲み込まれる＝`transitionSwallow`）と**変える**＝両方同時に立ちうるので、
      // 同じ見出しの行が2つ並ぶと原因の違いが読めない（#727 レビュー）。
      label: "切り替えの長さ",
      detail: `${fmtScenes(shortenedOnly)}は、入るときと出るときの切り替えが表示時間に収まらないので短くしています。設定どおりの長さにするには、表示時間を長くするか、切り替えを短く（または「なし」に）してください。`,
      // `warning` だと PrecheckScreen は操作列に「—」を出すだけで `sceneId` が読まれず、
      // **該当場面へ飛べない**（`transitionSwallow` が同じ理由で `action` を選んでいる）。
      // 書き出しは止めない（`blocksExport` を付けない）＝「直せば良くなる」警告（`15 §…`）。
      severity: "action",
      action: "直す",
      sceneId: scenes[shortenedOnly[0] - 1]?.sceneId,
    });
  }

  // 動画の再生タイミング（#444・ADR-0027 D3）：再生開始が「アニメの後（afterAnim）」なのにアニメが場面尺いっぱい
  // （settled 区間が無い）で、動画が一度も再生されない場面を**場面つきで**警告。UI は afterAnim を非表示にするが、
  // afterAnim を選んだ後にアニメを場面尺まで伸ばすと到達し得る。書き出しは同一判定で停止（黙って静止画にしない・§2-5）。
  const afterAnimNoPlay = afterAnimNoSettledSceneNumbers(
    scenes,
    templateById,
    (id) => assets.find((a) => a.assetId === id),
    (s) => (overlayAnimations ?? []).filter((a) => a.sceneId === s.sceneId),
  );
  if (afterAnimNoPlay.length > 0) {
    items.push({
      id: "videoStartAfterAnim",
      label: "動画の再生タイミング",
      detail: `${fmtScenes(afterAnimNoPlay)}は、アニメが場面の最後まで続くため「アニメの後」だと動画が再生されません。アニメを短くするか、「途中から」か「アニメと同時」に変えてください。`,
      severity: "action",
      action: "直す",
      sceneId: scenes[afterAnimNoPlay[0] - 1]?.sceneId,
      blocksExport: true, // 書き出しは同一判定で停止する（buildExportScenes）
    });
  }

  // 誤字脱字・誇大表現・個人情報の写り込みは自動チェック未対応のため、人の目での確認を促す
  items.push({
    id: "content",
    label: "文章・写り込みの確認",
    detail: "誤字脱字・誇大表現・個人情報の写り込みは、書き出し前に人の目でご確認ください（自動チェックは今後対応）。",
    severity: "warning",
  });

  return items;
}
