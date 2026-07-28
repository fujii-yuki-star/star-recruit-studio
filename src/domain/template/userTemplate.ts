// ユーザーが作成したテンプレート（ADR-0017）。同梱テンプレと同じ Template 型で、ID 接頭辞で区別する。
// グローバル（全プロジェクト再利用）に永続化し、AI 入力からは除外する（誤選択防止＝ADR-0017 不変条件）。
import { TEMPLATE_SCHEMA_VERSION } from './types';
import type { Layer, Template } from './types';
import type { Orientation, SceneCategory } from '../enums';
import { dimsForOrientation } from '../constants';

/** ユーザーテンプレの templateId 接頭辞。`user_tmpl_NNN`（11 §2.1 拡張）。 */
export const USER_TEMPLATE_PREFIX = 'user_tmpl';

/** templateId がユーザー作成テンプレか（同梱は記述的 id・ユーザーは user_tmpl_ 接頭辞）。 */
export function isUserTemplate(templateId: string): boolean {
  return templateId.startsWith(`${USER_TEMPLATE_PREFIX}_`);
}

/** user_tmpl_NNN の連番部分を数値で返す（ユーザーテンプレでなければ null）。 */
export function userTemplateSeq(templateId: string): number | null {
  if (!isUserTemplate(templateId)) return null;
  const n = Number(templateId.slice(`${USER_TEMPLATE_PREFIX}_`.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 新しいユーザーテンプレ id を採番する（既存の全テンプレ id を渡す・グローバル一意）。
 * **最大連番+1**（空き番号は埋めない）＝scene/part の §2.1 gap-fill とは別方針。
 * 削除した番号を再利用すると、別プロジェクトの参照（scene.templateId）が後発テンプレに化けるため（ADR-0017）。
 * `minSeq` ＝払い出し済みの最大連番（永続層が保持＝削除済みファイルが現存 id から消えても番号を戻さない）。
 * `user_tmpl_NNN`（3桁ゼロ詰め・999超は桁上がり）。
 */
export function createUserTemplateId(existingIds: readonly string[], minSeq = 0): string {
  const max = existingIds.reduce((m, id) => Math.max(m, userTemplateSeq(id) ?? 0), minSeq);
  return `${USER_TEMPLATE_PREFIX}_${String(max + 1).padStart(3, '0')}`;
}

/**
 * templates のユーザーテンプレ部分を userTemplates で置き換える（同梱・取り込みパックは保持）。
 * 起動時の読込マージに使う（再実行しても重複しない＝冪等）。
 */
export function replaceUserTemplates(templates: Template[], userTemplates: Template[]): Template[] {
  return [...templates.filter((t) => !isUserTemplate(t.templateId)), ...userTemplates];
}

/** template を id 一致で置換、無ければ末尾に追加する（保存後の一覧反映に使う）。 */
export function upsertUserTemplate(templates: Template[], template: Template): Template[] {
  const i = templates.findIndex((t) => t.templateId === template.templateId);
  if (i < 0) return [...templates, template];
  const next = [...templates];
  next[i] = template;
  return next;
}

/**
 * ゼロから作成するユーザーテンプレの初期 Template（ADR-0017「ゼロから作成（フル）」の導線・複製に頼らず一から作る）。
 * 最小構成＝**背景レイヤー1枚**（schema は layers≥1 必須・id は慣習の `background` で `scene.assetRefs['background']` に束縛）。
 * 向き→canvas は `dimsForOrientation`。以後のレイヤー追加・名前変更・素材設定は LooksEditScreen で行う。
 * id 採番（`user_tmpl_NNN`）は呼び出し側（`allocateUserTemplateId`）で行い、ここには採番済み id を渡す。
 */
export function buildBlankTemplate(
  templateId: string,
  name: string,
  category: SceneCategory,
  orientation: Orientation,
): Template {
  const canvas = dimsForOrientation(orientation);
  const background: Layer = { id: 'background', type: 'background', x: 0, y: 0, w: canvas.width, h: canvas.height, zIndex: 0 };
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION, // 11 §1（値の正典は template.schema.json）
    templateId,
    name,
    category,
    aspectRatio: orientation,
    canvas,
    layers: [background],
  };
}
