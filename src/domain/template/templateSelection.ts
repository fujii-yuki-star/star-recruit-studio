// 見た目パターンの選択整合（ADR-0012・#415／FREE 全場面化・0.4.2 動確）。純粋関数（副作用なし・テスト容易）。
import { FREE_CATEGORY, LAYER_TYPE, SCENE_CATEGORIES } from '../enums';
import type { Orientation, SceneCategory, TextKey } from '../enums';
import type { Template } from './types';
import type { Scene } from '../project/types';
import { templateSlotIds } from './layerOps';
import { isUserTemplate } from './userTemplate';
import { freeContentHiddenBySwitch } from '../project/sceneOps';

/** 場面編集の見た目ピッカーに渡す整合結果（#415）。 */
export interface PickableTemplates {
  /** そのまま選べる見た目＝同じ向きで、同じ場面カテゴリ＋FREE（自由配置は全場面で選べる）。FREE 場面はどのカテゴリへも切替可。 */
  options: Template[];
  /**
   * 現在のテンプレが向き不一致のときの、それ（旧データ等）。表示用＝選択値を消さないために出すが、
   * **有効な選択肢（options）とは分ける**＝「整合済み」に見せない（不一致を明示・選択不可にして選び直させる・#415 P2）。
   */
  mismatchedCurrent?: Template;
}

/**
 * 見た目ピッカーの選択肢を返す。同じ向き（ADR-0012）で、
 * - **同じ場面カテゴリの見た目**（役割どおり・#415）、
 * - **FREE（自由配置）は全場面で選べる**（0.4.2 動確・利用者要望＝どのシーンでも自由配置へ切替可・選ぶと FREE 化＝`switchSceneTemplate` が sceneType を追従）、
 * - **FREE 場面はどのカテゴリの見た目へも切替可**（FREE 化から元の役割の見た目へ戻れる＝一方通行の罠を防ぐ）。
 * 向きが合わない現行テンプレは options に入れず mismatchedCurrent として返す（呼び出し側で「合っていない・選び直して」と明示）。純粋関数。
 */
export function pickableTemplatesForScene(
  templates: Template[],
  sceneType: SceneCategory,
  orientation: Orientation,
  current: Template | undefined,
): PickableTemplates {
  const options = templates.filter(
    (t) =>
      t.aspectRatio === orientation &&
      (t.category === sceneType || // 同じ役割の見た目
        t.category === FREE_CATEGORY || // FREE は全場面で選べる（自由配置への切替）
        sceneType === FREE_CATEGORY), // FREE 場面はどのカテゴリへも戻れる
  );
  const mismatchedCurrent =
    current && !options.some((t) => t.templateId === current.templateId) ? current : undefined;
  return { options, mismatchedCurrent };
}

/**
 * その向きで少なくとも1つ見た目パターンがある場面カテゴリ（＝「種類」の選択肢・#528）。`SCENE_CATEGORIES` の順で安定。
 * 場面編集の「種類」セレクタに渡す＝FREE を含む全カテゴリへ**直接**切り替えられる（追加場面がオープニング固定になる罠を解く）。純粋関数。
 */
export function sceneCategoriesForOrientation(templates: Template[], orientation: Orientation): SceneCategory[] {
  const present = new Set(templates.filter((t) => t.aspectRatio === orientation).map((t) => t.category));
  return SCENE_CATEGORIES.filter((c) => present.has(c));
}

/**
 * その場面に当てる「標準の見た目」（#547・TEMPLATE_NOT_FOUND は自動置換しない方針の**明示操作**用）。
 * 同じ向き・同じ場面カテゴリで、**マイ見た目（ユーザーテンプレ）以外**の先頭（同梱＋取り込んだパック）。マイ見た目は選ばない
 * ＝「見つからない」原因がマイ見た目の削除/別環境であることが多く、標準へ寄せる操作の趣旨に合わないため。
 * 当てられる相手が無ければ undefined（その場面は手で選び直す）。純粋関数。
 */
export function standardTemplateForScene(
  templates: Template[], sceneType: SceneCategory, orientation: Orientation,
): Template | undefined {
  return templates.find(
    (t) => t.aspectRatio === orientation && t.category === sceneType && !isUserTemplate(t.templateId),
  );
}

/** 見た目が見つからない場面を標準へ寄せる1件分（`standardLookFixesForUnresolved`）。 */
export interface StandardLookFix {
  sceneId: string;
  /** 当てる標準の見た目。 */
  template: Template;
  /**
   * 当てると**動画に出なくなる中身**がある（写真・文字・立ち絵。`contentHiddenBySwitch`）。
   * マイ見た目は層 id や層構成が独自なので、標準に同じ差し込み先・文字枠・立ち絵枠が無いことが多い。
   * 一括適用は**直った件数だけを見せると、中身が減ったことに気づけないまま書き出せてしまう**ため、
   * ここで先に判定して利用者に示す（#547・§2-5・ADR-0026④）。
   */
  losesContent: boolean;
}

/**
 * 見た目が見つからない場面のうち、**標準へ寄せられる**ものを返す。
 * 公開前チェックのボタン活性（当てられないなら押させない＝無言 no-op を作らない）と、
 * store の一括適用が**同じ判定**を使うための単一の参照元。純粋関数。
 */
export function standardLookFixesForUnresolved(
  scenes: Scene[],
  templates: Template[],
  orientation: Orientation,
): StandardLookFix[] {
  const fixes: StandardLookFix[] = [];
  for (const s of scenes) {
    if (templates.some((t) => t.templateId === s.templateId)) continue; // 解決できている＝対象外
    const template = standardTemplateForScene(templates, s.sceneType, orientation);
    if (template) fixes.push({ sceneId: s.sceneId, template, losesContent: losesContentBySwitch(s, template) });
  }
  return fixes;
}

/** 切替で**動画に出なくなる**中身。`contentHiddenBySwitch` の結果。 */
export interface HiddenContent {
  /** 表示されなくなる素材の差し込み先 id（写真・動画）。データは `scene.assetRefs` に残る（休眠・ADR-0030 追補6）。 */
  slotIds: string[];
  /** 表示されなくなる文字の種別（中身が入っているものだけ）。データは `scene.texts` に残る（休眠）。 */
  textKeys: TextKey[];
  /** 立ち絵（ゆうこ）が表示されなくなる。データは残る（休眠）。 */
  character: boolean;
  /** 自由配置の中身が表示されなくなる（FREE→通常）。データは `scene.freeLayout` に残る（休眠・ADR-0030）。 */
  freeLayout: boolean;
}

/**
 * この場面をこの見た目へ切り替えたときに、**動画に出なくなる中身**。
 *
 * 通常テンプレの描画は層駆動＝素材は `templateSlotIds` の差し込み先、文字は `layer.textKey` のある層、
 * 立ち絵は character 層があるときだけ出る（`renderer/layout.ts`）。当て先にその層が無ければ動画から消える。
 * 件数だけ伝えると「直った」ように見えて中身が減るので、先に洗い出して利用者に示す（#547・§2-5・ADR-0026④）。
 *
 * `prev`（切替前の見た目）を渡すと「**いま実際に出ているもの**」だけを数える。渡さないとデータの有無で数えるため、
 * 元から出ていない休眠データまで「消える」と言ってしまう（過大開示）。見た目が見つからない場面は `prev` を
 * 解決できないので省略する＝安全側に倒す。
 */
export function contentHiddenBySwitch(scene: Scene, next: Template, prev?: Template): HiddenContent {
  const nextIsFree = next.category === FREE_CATEGORY;
  const hasFreeLayout = (scene.freeLayout?.length ?? 0) > 0;
  // FREE→FREE で自由配置が残っているなら、出ている中身はそのまま出続ける（通常配置は休眠保持＝ADR-0030）。
  // `prev` が分からないときの安全側の近似：sceneType で当て先を選ぶので、元も FREE だったとみなせる。
  if (!prev && nextIsFree && hasFreeLayout) {
    return { slotIds: [], textKeys: [], character: false, freeLayout: false };
  }
  const keepSlots = templateSlotIds(next.layers);
  const keepTexts = textKeysOfTemplate(next);
  // `prev` があれば「切替前に出ていたか」で絞る（休眠のままだったものは「消える」に数えない）。
  const shownSlots = prev ? templateSlotIds(prev.layers) : null;
  const shownTexts = prev ? textKeysOfTemplate(prev) : null;
  const shownCharacter = prev ? prev.layers.some((l) => l.type === LAYER_TYPE.character) : true;
  const shownFree = prev ? prev.category === FREE_CATEGORY : true;
  return {
    slotIds: Object.entries(scene.assetRefs ?? {})
      .filter(([id, assetId]) => assetId && !keepSlots.has(id) && (!shownSlots || shownSlots.has(id)))
      .map(([id]) => id),
    textKeys: filledTextKeys(scene).filter((k) => !keepTexts.has(k) && (!shownTexts || shownTexts.has(k))),
    character: !!scene.character?.poseAssetId && shownCharacter && !next.layers.some((l) => l.type === LAYER_TYPE.character),
    // 自由配置は FREE テンプレのときだけ描かれる（それ以外では休眠＝ADR-0030）。
    // 「中身が出なくなるか」の数え方は場面編集の切替確認と**同じ関数**に委ねる（§6・ADR-0026②）。
    // 別々に書くと、往復で見た目が保たれる場面に対して片方は「出なくなる」と言い片方は言わない、が起きる。
    freeLayout: hasFreeLayout && shownFree && freeContentHiddenBySwitch(scene, next).total > 0,
  };
}

/** テンプレが表示できる文字の種別。 */
function textKeysOfTemplate(t: Template): Set<TextKey> {
  return new Set(t.layers.map((l) => l.textKey).filter((k): k is TextKey => !!k));
}

/** 中身が入っている文字の種別（空文字は「失うもの」に数えない）。 */
function filledTextKeys(scene: Scene): TextKey[] {
  return Object.entries(scene.texts ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k]) => k as TextKey);
}

/** 切替で動画に出なくなる中身があるか（`contentHiddenBySwitch` の便利述語）。 */
export function losesContentBySwitch(scene: Scene, next: Template, prev?: Template): boolean {
  const h = contentHiddenBySwitch(scene, next, prev);
  return h.slotIds.length > 0 || h.textKeys.length > 0 || h.character || h.freeLayout;
}
