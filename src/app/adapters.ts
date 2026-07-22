// ドメイン（Scene/Part/Asset/Warning）→ 画面用UIモデル への変換。
// UIは見た目に専念し、ドメインを正とする（CLAUDE.md §4）。表示語は非技術語。
import { ASSET_TYPE, FREE_CATEGORY, type SceneCategory } from "../domain/enums";
import { HEIGHT, MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT, WIDTH } from "../domain/constants";
import { validateFreeLayout } from "../domain/project/freeLayout";
import { sceneActiveAssetIds } from "../domain/project/assetUsage";
import { sceneLines, sceneNeedsVoice } from "../domain/project/narrationLines";
import { sceneDisplayedSubtitleTexts } from "../domain/project/subtitleBinding";
import { afterAnimNoSettledSceneNumbers, unplaceableVideoSceneNumbers } from "../renderer/export/videoSlotPlacement";
import { swallowedByTransitionSceneNumbers } from "../domain/project/sceneTransitions";
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

/** シーンの主役素材（mainVisual→background→最初の非null）を返す。 */
function mainAsset(scene: Scene, assets: Asset[]): Asset | undefined {
  const preferredKeys = ["mainVisual", "background"];
  for (const key of preferredKeys) {
    const id = scene.assetRefs[key];
    if (id) {
      const found = assets.find((a) => a.assetId === id);
      if (found) return found;
    }
  }
  for (const id of Object.values(scene.assetRefs)) {
    if (id) {
      const found = assets.find((a) => a.assetId === id);
      if (found) return found;
    }
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
  const asset = mainAsset(scene, assets);
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

/** 公開前チェックの結果を、実際のシーン/素材から算出する（一部は自動チェック未対応の定型）。 */
export function buildPrecheckItems(scenes: Scene[], assets: Asset[], templates: Template[], overlayAnimations?: ElementAnimation[]): PrecheckItem[] {
  const items: PrecheckItem[] = [];
  const templateOf = (s: Scene): Template | undefined => templates.find((t) => t.templateId === s.templateId);
  // 場面に紐づく項目は「どの場面か」を番号で列挙し（#403・どの場面が問題か示す）、action がある項目は最初の該当場面へ
  // 飛べるよう sceneId を持たせる（#400）。番号は scenes の位置（1始まり）＝利用者が見る場面番号。多いと先頭8件＋「ほか N 件」。
  const fmtScenes = (nums: number[]): string =>
    nums.length <= 8 ? `場面${nums.join("・")}` : `場面${nums.slice(0, 8).join("・")} ほか${nums.length - 8}件`;
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
  // 実効表現だけを「使用中」と数える（休眠は除外）＝逆引き（MaterialsScreen）・削除確認と同一規則（ADR-0030・sceneActiveAssetIds）。
  for (const s of scenes) {
    for (const id of sceneActiveAssetIds(s, templateOf(s))) used.add(id);
  }
  const unused = assets.filter((a) => !used.has(a.assetId)).length;
  items.push(
    unused > 0
      ? { id: "unused", label: "使っていない素材", detail: `使われていない素材が${unused}つあります。動画には入らないので、そのままでも問題ありません。`, severity: "warning" }
      : { id: "unused", label: "使っていない素材", detail: "すべての素材が使われています。", severity: "ok" },
  );

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

  // 場面の見た目（テンプレ・Codex 監査 2026-07-13・#434 と同流儀）：templateId が解決できない場面（利用者テンプレの削除・
  // 別環境で開く等でダングリング）は、書き出しで黙って落とすと場面が MP4 から消えテロップ/BGM もズレるため §2-5 で停止する。
  // ここでは事前に**場面つきで**警告し、該当場面へ戻れる導線（action＝直す）を出す。問題が無ければ項目を出さない。
  const noTemplate = offending((s) => !templateOf(s));
  if (noTemplate.nums.length > 0) {
    items.push({
      id: "sceneTemplate",
      label: "場面の見た目",
      detail: `${fmtScenes(noTemplate.nums)}の見た目が見つかりません。場面編集で見た目を選び直してから書き出してください。`,
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
  // **プレビューには出るのに書き出しでは独立した尺を持たない**（preview≠export）。#553 で場面尺の下限を撤廃する
  // までは構造的に到達不能だった（最短3秒 > 切り替え既定0.5秒）が、「0.3秒の場面＋フェード」が作れるように
  // なったため**黙って壊さず警告で見せる**。原因＋次の行動を示す（§2-5）。クランプの strict 化は #554。
  const swallowed = swallowedByTransitionSceneNumbers(scenes);
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
