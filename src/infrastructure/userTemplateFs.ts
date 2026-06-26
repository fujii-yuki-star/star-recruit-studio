// ユーザー作成テンプレ（ADR-0017）の保存/読込/削除（Tauri コマンド境界・§4）。
// 保存先は appData/user_templates/<templateId>.json（全プロジェクト共通＝グローバル）。
// Tauri 非検出時（ブラウザ開発）は空・no-op＝開発フローを止めない（projectFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import type { Template } from '../domain/template/types';
import { parseTemplatePack } from './templateFs';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 削除した user_tmpl 番号を再利用しないための「払い出し済み最大連番」（ADR-0017）。
// localStorage は Tauri WebView でも永続するので、ファイルを消しても番号は単調増加を保てる。
const MAX_SEQ_KEY = 'userTemplateMaxSeq';

/** 払い出し済みの最大連番（無ければ 0）。createUserTemplateId の floor に渡す＝削除番号を再利用しない。 */
export function getUserTemplateMaxSeq(): number {
  if (typeof localStorage === 'undefined') return 0;
  const n = Number(localStorage.getItem(MAX_SEQ_KEY));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** 払い出し済みの最大連番を前進させる（採番した新しい seq を渡す。後退はしない）。 */
export function bumpUserTemplateMaxSeq(seq: number): void {
  if (typeof localStorage === 'undefined') return;
  if (seq > getUserTemplateMaxSeq()) localStorage.setItem(MAX_SEQ_KEY, String(seq));
}

/** ユーザーテンプレを全件読み、正典スキーマで検証して返す（未検証は取り込まない＝§2-2）。非 Tauri は空。 */
export async function loadUserTemplates(): Promise<Template[]> {
  if (!isTauri()) return [];
  const jsons = await invoke<string[]>('load_user_templates');
  const raw: unknown[] = [];
  for (const j of jsons) {
    try {
      raw.push(JSON.parse(j));
    } catch {
      console.warn('[userTemplateFs] 壊れたユーザーテンプレファイルを読み飛ばしました');
    }
  }
  const { templates, rejected } = parseTemplatePack(raw);
  if (rejected.length > 0) console.warn('[userTemplateFs] 検証を通らないユーザーテンプレ:', rejected);
  return templates;
}

/** ユーザーテンプレを保存する（Tauri のみ。非 Tauri は no-op）。 */
export async function saveUserTemplate(template: Template): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_user_template', { templateJson: JSON.stringify(template) });
}

/** ユーザーテンプレを削除する（Tauri のみ。非 Tauri は no-op）。番号は再利用しないため maxSeq は据え置き。 */
export async function deleteUserTemplate(templateId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_user_template', { templateId });
}
