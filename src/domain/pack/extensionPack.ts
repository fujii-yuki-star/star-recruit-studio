// 拡張パック（ADR-0060）。純粋関数：manifest の検証・版の比べ方・入れてよいかの判定・中身の id の名前空間。
// ⚠️ **パックはデータだけ**＝ここで扱うのは manifest と中の JSON だけ。ファイルの展開と SHA-256 の照合は Rust（`packs.rs`）。
import { validateExtensionPack, validateTemplate } from '../validation/generated/validators.js';
import type { Template } from '../template/types';

/** manifest.json の形（`schemas/extension-pack.schema.json`）。 */
export interface ExtensionPackManifest {
  schemaVersion: '1.0';
  packId: string;
  name: string;
  version: string;
  publisher: string;
  description?: string;
  minAppVersion: string;
  contents: {
    templates?: { file: string }[];
    templateAssets?: { assetId: string; file: string }[];
    features?: string[];
  };
  files: { path: string; sha256: string }[];
  licenses: { target: PackContentKind; license: string; credit?: string }[];
}

/** 中身の種類（`contents` のキー＝`licenses[].target`）。 */
export const PACK_CONTENT_KINDS = ['templates', 'templateAssets', 'features'] as const;
export type PackContentKind = (typeof PACK_CONTENT_KINDS)[number];

/** パックを読めない・入れられない理由（文言は `uiLabels` の `packProblemMessage`・`15 §6`）。 */
export const PACK_PROBLEM = {
  /** manifest が JSON でない・schema に合わない。 */
  invalid: 'invalid',
  /** 中身に書かれたファイルが `files` に無い（照合できない）。 */
  unlistedContent: 'unlistedContent',
  /** 中身があるのに権利（`licenses`）が書かれていない。 */
  missingLicense: 'missingLicense',
  /** アプリの版が足りない。 */
  appTooOld: 'appTooOld',
  /** 入っている版より古い。 */
  olderThanInstalled: 'olderThanInstalled',
} as const;
export type PackProblem =
  | { kind: typeof PACK_PROBLEM.invalid }
  | { kind: typeof PACK_PROBLEM.unlistedContent; path: string }
  | { kind: typeof PACK_PROBLEM.missingLicense; target: PackContentKind }
  | { kind: typeof PACK_PROBLEM.appTooOld; minAppVersion: string }
  | { kind: typeof PACK_PROBLEM.olderThanInstalled; installedVersion: string };

/**
 * manifest.json の文字列を読む。schema に合い、中身のファイルが全部 `files` に載り、中身の種類ごとに権利が書かれていれば manifest。
 * ⚠️ **形だけでなく中身の約束も見る**＝schema だけでは「書いてあるファイルが照合の一覧に無い」「権利が無い」を止められない。
 */
export function parsePackManifest(raw: string): { ok: true; manifest: ExtensionPackManifest } | { ok: false; problem: PackProblem } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  }
  if (!validateExtensionPack(data)) return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  const m = data as ExtensionPackManifest;
  const listed = new Set(m.files.map((f) => f.path));
  for (const path of contentFiles(m)) {
    if (!listed.has(path)) return { ok: false, problem: { kind: PACK_PROBLEM.unlistedContent, path } };
  }
  const licensed = new Set(m.licenses.map((l) => l.target));
  for (const kind of PACK_CONTENT_KINDS) {
    if (m.contents[kind] && !licensed.has(kind)) return { ok: false, problem: { kind: PACK_PROBLEM.missingLicense, target: kind } };
  }
  return { ok: true, manifest: m };
}

/** 中身として読むファイル（見た目パターンと既定素材）。 */
export function contentFiles(m: ExtensionPackManifest): string[] {
  return [...(m.contents.templates ?? []).map((t) => t.file), ...(m.contents.templateAssets ?? []).map((a) => a.file)];
}

/** `x.y.z` を比べる（a が大きければ正）。形が違う版は 0 として扱う（schema で形は守られている）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * このパックを入れてよいか（アプリの版・入っている版）。同じ版なら入れ直し（置き換え）を許す。
 * ⚠️ **古い版は入れない**＝新しい版の見た目パターンで作った動画が、古い版で崩れて見える、を作らない（ADR-0060 決定3）。
 */
export function packInstallProblem(
  m: ExtensionPackManifest,
  appVersion: string,
  installedVersion: string | null,
): PackProblem | null {
  if (compareVersions(appVersion, m.minAppVersion) < 0) return { kind: PACK_PROBLEM.appTooOld, minAppVersion: m.minAppVersion };
  if (installedVersion != null && compareVersions(m.version, installedVersion) < 0) {
    return { kind: PACK_PROBLEM.olderThanInstalled, installedVersion };
  }
  return null;
}

/** パックの中身の id の頭（ADR-0060 決定4）。`packId` は `__` を含めない（schema）＝頭とパックの中の名前の境目が一意に決まる。 */
export function packIdPrefix(packId: string): string {
  return `pack_${packId}__`;
}

/** その id がパック由来か（見た目パターン・既定素材）。 */
export function isPackScopedId(id: string): boolean {
  return /^pack_[a-z0-9_]+?__/.test(id);
}

/** パック由来の id から、どのパックかを取り出す（パック由来でなければ null）。 */
export function packIdOfScopedId(id: string): string | null {
  const m = /^pack_([a-z0-9_]+?)__/.exec(id);
  return m ? m[1] : null;
}

/**
 * パックの中の見た目パターンを読む＝`templateId` と、層の既定素材 `assetId` にパックの頭を付け、今の template.schema で確かめる。
 * ⚠️ **既定素材はパックの中に在るものだけ**＝パックに無い `assetId` を指す層は断る（よその見た目パターンの素材を黙って借りない）。
 */
export function readPackTemplate(
  packId: string,
  raw: string,
  packAssetIds: ReadonlySet<string>,
): Template | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!validateTemplate(data)) return null;
  const t = data as Template;
  const prefix = packIdPrefix(packId);
  const layers = [];
  for (const layer of t.layers) {
    const assetId = (layer as { assetId?: string }).assetId;
    if (assetId == null) {
      layers.push(layer);
      continue;
    }
    if (!packAssetIds.has(assetId)) return null;
    layers.push({ ...layer, assetId: `${prefix}${assetId}` });
  }
  const scoped = { ...t, templateId: `${prefix}${t.templateId}`, layers } as Template;
  return validateTemplate(scoped) ? scoped : null;
}

/** 入っているパックが有効にしている組み込み機能（ADR-0060 決定1）。知らない名前は無視する（古いアプリに新しいパック）。 */
export function enabledFeatures(manifests: readonly ExtensionPackManifest[], known: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const m of manifests) for (const f of m.contents.features ?? []) if (known.includes(f)) out.add(f);
  return out;
}

/** そのパックの見た目パターンを使っている場面の数（外す前に知らせる・ADR-0060 決定3）。 */
export function countPackTemplateUses(packId: string, sceneTemplateIds: readonly string[]): number {
  const prefix = packIdPrefix(packId);
  return sceneTemplateIds.filter((id) => id.startsWith(prefix)).length;
}

/** 見た目パターンの一覧のパック由来の分を差し替える（同梱・利用者のものはそのまま）。 */
export function replacePackTemplates(templates: readonly Template[], packTemplates: readonly Template[]): Template[] {
  return [...templates.filter((t) => !isPackScopedId(t.templateId)), ...packTemplates];
}

/** アプリに組み込んである機能の名前（パックの鍵で出す・ADR-0060 決定1）。 */
export const KNOWN_PACK_FEATURES = ['personalized-briefing'] as const;

/**
 * その動画（project.json／タイムライン形式の文書の文字）が、このパックの見た目パターンを使っているか（外す前に数える・ADR-0060 決定3）。
 * ⚠️ 文字のまま探す＝動画を開かずに数えられる（形式を問わず `templateId` に頭が付いている）。
 */
export function projectUsesPack(rawJson: string, packId: string): boolean {
  // packId は英小文字・数字・_ だけ（schema・Rust の `is_safe_pack_id`）＝正規表現の特別な文字を含まない。
  return new RegExp(`"templateId"\\s*:\\s*"${packIdPrefix(packId)}`).test(rawJson);
}

