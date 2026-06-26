// ユーザーが作成したテンプレート（ADR-0017）。同梱テンプレと同じ Template 型で、ID 接頭辞で区別する。
// グローバル（全プロジェクト再利用）に永続化し、AI 入力からは除外する（誤選択防止＝ADR-0017 不変条件）。
import { nextNumberedId } from '../project/persistence';

/** ユーザーテンプレの templateId 接頭辞。`user_tmpl_NNN`（11 §2.1 拡張）。 */
export const USER_TEMPLATE_PREFIX = 'user_tmpl';

/** templateId がユーザー作成テンプレか（同梱は記述的 id・ユーザーは user_tmpl_ 接頭辞）。 */
export function isUserTemplate(templateId: string): boolean {
  return templateId.startsWith(`${USER_TEMPLATE_PREFIX}_`);
}

/**
 * 新しいユーザーテンプレ id を採番する（既存の全テンプレ id を渡す・グローバル一意）。
 * `user_tmpl_NNN`（3桁ゼロ詰め・999超は桁上がり）。既存番号の空きを埋める（採番規則は §2.1 と同方針）。
 */
export function createUserTemplateId(existingIds: readonly string[]): string {
  return nextNumberedId(USER_TEMPLATE_PREFIX, existingIds);
}
