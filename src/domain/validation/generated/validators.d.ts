// 自動生成 validators.js（scripts/compile-validators.mjs・#156）の型宣言（手書き・安定）。
// 生成 JS は allowJs:false で型検査対象外のため、この .d.ts で型を与える。これ自体は commit する
// （validators.js は gitignore＝pre フックで毎回生成）。
import type { ErrorObject } from 'ajv';

/** ajv ValidateFunction 互換の最小形。検証成功で true、失敗時は .errors に詳細（ログ用）。 */
export interface StandaloneValidate {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

/** ai-video-plan.schema.json の事前コンパイル済み検証関数。 */
export const validateAiVideoPlan: StandaloneValidate;
/** template.schema.json の事前コンパイル済み検証関数。 */
export const validateTemplate: StandaloneValidate;
