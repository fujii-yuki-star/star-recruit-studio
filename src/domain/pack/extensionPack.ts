// 拡張パック（ADR-0060）。純粋関数：manifest の検証・版の比べ方・入れてよいかの判定・中身の id の名前空間。
// ⚠️ **パックはデータだけ**＝ここで扱うのは manifest と中の JSON だけ。ファイルの展開と SHA-256 の照合は Rust（`packs.rs`）。
import { validateExtensionPack, validateTemplate } from '../validation/generated/validators.js';
import type { Template } from '../template/types';
import { VOICE_CATALOG, isCompanyOkVoiceCharacter, type VoiceCharacter } from '../voice/voiceCatalog';

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
    fonts?: { fontId: string; file: string; displayName: string }[];
    bgm?: { bgmId: string; file: string; displayName: string }[];
    voices?: { voiceId: string; file: string; character: string; styles: { speaker: number; label: string }[] }[];
    features?: string[];
  };
  files: { path: string; sha256: string }[];
  licenses: { target: PackContentKind; license: string; credit?: string }[];
}

/** 中身の種類（`contents` のキー＝`licenses[].target`）。 */
export const PACK_CONTENT_KINDS = ['templates', 'templateAssets', 'fonts', 'bgm', 'voices', 'features'] as const;
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
  /** 声の番号（スタイル）が同梱の声と重なる（段階3）。 */
  voiceConflict: 'voiceConflict',
  /** 会社の動画で使うには許可が要る（または確かめきれない）キャラの声（`COMPANY_OK_VOICE_CHARACTERS` に無い）。 */
  voiceNotAllowed: 'voiceNotAllowed',
} as const;
export type PackProblem =
  | { kind: typeof PACK_PROBLEM.invalid }
  | { kind: typeof PACK_PROBLEM.unlistedContent; path: string }
  | { kind: typeof PACK_PROBLEM.missingLicense; target: PackContentKind }
  | { kind: typeof PACK_PROBLEM.appTooOld; minAppVersion: string }
  | { kind: typeof PACK_PROBLEM.olderThanInstalled; installedVersion: string }
  | { kind: typeof PACK_PROBLEM.voiceConflict }
  | { kind: typeof PACK_PROBLEM.voiceNotAllowed; character: string };

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
  // ⚠️ 文字の形の名前が重なると、動画から指したときにどちらか分からない（schema では項目の重なりを表せない）。
  const fontIds = (m.contents.fonts ?? []).map((f) => f.fontId);
  if (new Set(fontIds).size !== fontIds.length) return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  const bgmIds = (m.contents.bgm ?? []).map((b) => b.bgmId);
  if (new Set(bgmIds).size !== bgmIds.length) return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  const voices = m.contents.voices ?? [];
  const voiceIds = voices.map((v) => v.voiceId);
  if (new Set(voiceIds).size !== voiceIds.length) return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  const speakers = voices.flatMap((v) => v.styles.map((s) => s.speaker));
  if (new Set(speakers).size !== speakers.length) return { ok: false, problem: { kind: PACK_PROBLEM.invalid } };
  // ⚠️ **同梱の声と番号が重なるものは入れない**＝声を作るソフトの一覧に同じ番号が2つ並び、どちらの声で読むかが決まらない
  //   （実際に起動して確かめた＝落ちずに両方並ぶ）。クレジットの名前も取り違える。
  const bundled = new Set(VOICE_CATALOG.flatMap((c) => c.styles.map((s) => s.speaker)));
  if (speakers.some((s) => bundled.has(s))) return { ok: false, problem: { kind: PACK_PROBLEM.voiceConflict } };
  // ⚠️ **会社の動画で使えないキャラの声は入れない**（2026-10-16 利用者の判断＝確かめが要る危ない橋は渡らない・`13 §4`）。
  //   規約で「企業の利用は申請・許可」とあるキャラを入れると、利用者は知らずに規約違反の採用動画を作る。
  const notAllowed = voices.find((v) => !isCompanyOkVoiceCharacter(v.character));
  if (notAllowed) return { ok: false, problem: { kind: PACK_PROBLEM.voiceNotAllowed, character: notAllowed.character } };
  const licensed = new Set(m.licenses.map((l) => l.target));
  for (const kind of PACK_CONTENT_KINDS) {
    if (m.contents[kind] && !licensed.has(kind)) return { ok: false, problem: { kind: PACK_PROBLEM.missingLicense, target: kind } };
  }
  return { ok: true, manifest: m };
}

/** 中身として読むファイル（見た目パターン・既定素材・文字の形）。 */
export function contentFiles(m: ExtensionPackManifest): string[] {
  return [
    ...(m.contents.templates ?? []).map((t) => t.file),
    ...(m.contents.templateAssets ?? []).map((a) => a.file),
    ...(m.contents.fonts ?? []).map((f) => f.file),
    ...(m.contents.bgm ?? []).map((b) => b.file),
    ...(m.contents.voices ?? []).map((v) => v.file),
  ];
}

/** 声1つの名前（`<packId>/<voiceId>`）＝Rust の採否（`pack_voice_plan`）と突き合わせる鍵。 */
export function packVoiceRefKey(packId: string, voiceId: string): string {
  return `${packId}/${voiceId}`;
}

/**
 * 入っているパックの声を、声の一覧に足す形にする（段階3）。
 * ⚠️ **採るかどうかは Rust が決める**（`accepted`＝`pack_voice_plan` の結果）＝声の中身（キャラ名と番号）を読めるのは Rust だけで、
 *   画面と音声ソフトで別の規則を持つと、**一覧に出る声と実際に読ませる声が食い違う**（クレジットの取り違え＝ADR-0003）。
 *   `accepted` が `null`（音声ソフトが無い＝ブラウザ開発）なら、書かれた声を全部足す。
 * 足さなかった声のあるパックは `skipped` で名前を返す（黙って消えたように見せない）。
 */
export function packVoiceCharacters(
  manifests: readonly ExtensionPackManifest[],
  accepted: ReadonlySet<string> | null,
): { characters: VoiceCharacter[]; skipped: string[] } {
  const characters: VoiceCharacter[] = [];
  const skipped: string[] = [];
  for (const m of manifests) {
    let dropped = false;
    for (const v of m.contents.voices ?? []) {
      if (accepted && !accepted.has(packVoiceRefKey(m.packId, v.voiceId))) {
        dropped = true;
        continue;
      }
      characters.push({ character: v.character, styles: v.styles.map((s) => ({ ...s })) });
    }
    if (dropped) skipped.push(m.name);
  }
  return { characters, skipped };
}

/**
 * 読ませる声のファイルの組の「名前」（段階3）＝変わったら声を作るソフトを起こし直す。
 * 中身の SHA-256 まで含める＝新しい版で同じファイル名でも中身が変われば起こし直す（文字の形と同じ考え）。
 */
export function packVoiceFilesKey(manifests: readonly ExtensionPackManifest[], accepted: ReadonlySet<string> | null): string {
  return manifests
    .flatMap((m) =>
      (m.contents.voices ?? [])
        .filter((v) => !accepted || accepted.has(packVoiceRefKey(m.packId, v.voiceId)))
        .map((v) => `${packVoiceRefKey(m.packId, v.voiceId)}/${m.files.find((f) => f.path === v.file)?.sha256 ?? ''}`),
    )
    .sort()
    .join('|');
}

/** その動画が、このパックの声（番号）を使っているか（外す前に数える＝段階3）。値が数なので文字の頭では探せない。 */
export function projectUsesPackVoice(rawJson: string, manifest: ExtensionPackManifest): boolean {
  const speakers = (manifest.contents.voices ?? []).flatMap((v) => v.styles.map((s) => s.speaker));
  if (speakers.length === 0) return false;
  return new RegExp(`"speaker"\\s*:\\s*(${speakers.join('|')})(?![0-9])`).test(rawJson);
}

/** パックの音楽1つぶん（素材の棚に並べる id＝`pack_<packId>__<bgmId>`・段階2b）。 */
export interface PackBgm {
  id: string;
  packId: string;
  file: string;
  displayName: string;
}

/**
 * 入っているパックの音楽を、棚に並べる id つきで並べる。
 * ⚠️ **id は棚の中だけの名前**＝使うときは動画へコピーして新しい素材の番号を採る（ADR-0060 決定5）。動画の中にこの id は残らない。
 */
export function packBgms(manifests: readonly ExtensionPackManifest[]): PackBgm[] {
  return manifests.flatMap((m) =>
    (m.contents.bgm ?? []).map((b) => ({
      id: `${packIdPrefix(m.packId)}${b.bgmId}`,
      packId: m.packId,
      file: b.file,
      displayName: b.displayName,
    })),
  );
}

/** パックの文字の形1つぶん（動画から指す id＝`pack_<packId>__<fontId>`・ADR-0060 決定4）。 */
export interface PackFont {
  id: string;
  packId: string;
  file: string;
  /** 中身の SHA-256（`files` から）。⚠️ 新しい版でもファイル名は同じことが多い＝中身が変わったかはこれで見る。 */
  sha256: string;
  displayName: string;
}

/** 入っているパックの文字の形を、動画から指す id つきで並べる。 */
export function packFonts(manifests: readonly ExtensionPackManifest[]): PackFont[] {
  return manifests.flatMap((m) =>
    (m.contents.fonts ?? []).map((f) => ({
      id: `${packIdPrefix(m.packId)}${f.fontId}`,
      packId: m.packId,
      file: f.file,
      sha256: m.files.find((x) => x.path === f.file)?.sha256 ?? '',
      displayName: f.displayName,
    })),
  );
}

/**
 * `x.y.z` を比べる（a が大きければ正）。形が違う版は 0 として扱う（schema で形は守られている）。
 * ⚠️ 変異チェックで「`Number` を外して文字のまま比べる」は生き残る＝**等価**（下の引き算が文字を数へ直す・`"10" - "9" === 1`）。
 *   `Number` を残すのは読み手のため（数として比べていることを書いておく）。
 */
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
export type PackFeature = (typeof KNOWN_PACK_FEATURES)[number];

/** 組み込み機能の名前か（知らない名前＝新しいパックを古いアプリへ入れたとき）。 */
export function isKnownPackFeature(f: string): f is PackFeature {
  return (KNOWN_PACK_FEATURES as readonly string[]).includes(f);
}

/**
 * その動画（project.json／タイムライン形式の文書の文字）が、このパックの中身（見た目パターン・文字の形）を使っているか（外す前に数える・ADR-0060 決定3）。
 * ⚠️ 文字のまま探す＝動画を開かずに数えられる（形式を問わず、パックの中身を指す値には頭が付いている）。
 * ⚠️ **項目の名前では絞らない**＝文字の形は `fontId` のほかテキスト種別ごとの上書き（`textFontIds` の `title` など）からも指すので、
 *   名前を並べると足し忘れた所だけ数えない。**値が頭で始まる**かだけを見る。
 */
export function projectUsesPack(rawJson: string, packId: string): boolean {
  // packId は英小文字・数字・_ だけ（schema・Rust の `is_safe_pack_id`）＝正規表現の特別な文字を含まない。
  return new RegExp(`:\\s*"${packIdPrefix(packId)}`).test(rawJson);
}

/**
 * その見た目パターンが、拡張パックの名前（`pack_<packId>__…`）を名乗る・借りるか（PR レビュー 🟡）。
 * ⚠️ パックの外から入る道（見た目パターンのファイルの取り込み）で断る＝入っているパックの見た目パターンを上書きしたり、
 *   パックの既定素材を黙って借りたりさせない（パックの中身はパックからだけ入る）。
 */
export function templateClaimsPackIds(t: Pick<Template, 'templateId' | 'layers'>): boolean {
  return isPackScopedId(t.templateId) || t.layers.some((l) => l.assetId != null && isPackScopedId(l.assetId));
}

