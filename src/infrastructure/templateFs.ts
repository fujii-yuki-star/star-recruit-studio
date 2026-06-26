// 見た目パターン（テンプレ）の読込と検証（infrastructure 境界・B2/ADR-0012）。
// 正典スキーマ template.schema.json に ajv(draft 2020-12) で適合検証してから Template[] にする
// （§2-2「検証してから内部データへ」）。検証を通らないものは取り込まない（rejected に分離・ログ用）。
// 読込元: 同梱標準パック（既定）＋ ユーザーが選んだパックファイル。設定は validateVideoPlan と揃える。
// 検証関数は scripts/compile-validators.mjs が template.schema.json から事前コンパイル（#156・実行時 eval なし）。
// 生成時の設定（draft 2020-12・strict:false・allErrors）は compile-validators.mjs / validate-schemas.mjs と一致。
import { validateTemplate as validate } from '../domain/validation/generated/validators.js';
import type { Template } from '../domain/template/types';
import type { Orientation } from '../domain/enums';
import { sampleTemplates } from './sampleData';

// 取り込むテンプレファイルの上限サイズ。テンプレ JSON は小さいので、誤って巨大ファイルを選んでも
// メモリを使い過ぎないよう早期に弾く（大容量素材のメモリ問題＝#48 と同方針）。
const MAX_TEMPLATE_FILE_BYTES = 1_000_000;

/** 検証を通らなかったテンプレ（取り込まない）。errors は技術詳細＝ログ用で UI には出さない（§2-3）。 */
export interface RejectedTemplate {
  templateId: string | null;
  errors: string[];
}

export interface ParsedTemplatePack {
  templates: Template[];
  rejected: RejectedTemplate[];
}

/** ajv の検証エラーを読みやすい1行へ整形（ログ用・validateVideoPlan と同方針）。 */
function formatErrors(errors: typeof validate.errors): string[] {
  if (!errors || errors.length === 0) return ['形式が正しくありません'];
  return errors.map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
}

/** 生データから templateId を安全に取り出す（取れなければ null）。 */
function readTemplateId(item: unknown): string | null {
  if (item && typeof item === 'object' && 'templateId' in item) {
    const id = (item as Record<string, unknown>).templateId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

/**
 * 生データ（テンプレ単体 or 配列）を正典スキーマで検証し、採用(Template[])と不採用(rejected)へ振り分ける（純粋）。
 * 検証を通った要素だけを Template として返す＝未検証データを内部に流さない（§2-2）。
 */
export function parseTemplatePack(raw: unknown): ParsedTemplatePack {
  const items = Array.isArray(raw) ? raw : [raw];
  const templates: Template[] = [];
  const rejected: RejectedTemplate[] = [];
  for (const item of items) {
    if (validate(item)) {
      templates.push(item as Template);
    } else {
      rejected.push({ templateId: readTemplateId(item), errors: formatErrors(validate.errors) });
    }
  }
  return { templates, rejected };
}

/** プロジェクトの向き（16:9/9:16）に一致する見た目パターンだけ返す（純粋・B4/B5 で利用）。 */
export function templatesForOrientation(templates: Template[], orientation: Orientation): Template[] {
  return templates.filter((t) => t.aspectRatio === orientation);
}

/**
 * 同梱の標準見た目パターンを検証して返す（アプリ既定）。
 * 同梱パックが検証を通らないのは開発時の不具合なのでログのみ（UI 非表示）。
 */
export function loadBundledTemplates(): Template[] {
  const { templates, rejected } = parseTemplatePack(sampleTemplates);
  if (rejected.length > 0) {
    console.error('[templateFs] 同梱の見た目パターンの検証に失敗しました:', rejected);
  }
  return templates;
}

/**
 * ユーザーが選んだファイル群（各ファイルはテンプレ単体 or 配列の JSON）を読み、検証して振り分ける。
 * 読込/形式エラーも rejected に集約する（UI は件数のみ提示・§2-3）。File I/O はここに隔離（§4）。
 */
export async function parseTemplateFiles(files: File[]): Promise<ParsedTemplatePack> {
  const raw: unknown[] = [];
  const rejected: RejectedTemplate[] = [];
  for (const file of files) {
    if (file.size > MAX_TEMPLATE_FILE_BYTES) {
      rejected.push({ templateId: null, errors: [`${file.name}: ファイルが大きすぎます`] });
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      rejected.push({ templateId: null, errors: [`${file.name}: 読み込めない、または形式が正しくありません`] });
      continue;
    }
    if (Array.isArray(data)) raw.push(...data);
    else raw.push(data);
  }
  const parsed = parseTemplatePack(raw);
  return { templates: parsed.templates, rejected: [...rejected, ...parsed.rejected] };
}
