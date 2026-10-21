// 入っている拡張パック（ADR-0060）を読み、見た目パターンと既定素材にする。
// ⚠️ **読めないパックは飛ばして、ほかは読む**＝1つ壊れていても、入っているほかのパックの見た目パターンは使える。
//   飛ばしたパックは `skipped` で返す（設定の「拡張パック」で知らせる＝黙って消えたように見せない）。
import type { Template } from '../../domain/template/types';
import {
  packFonts,
  packIdPrefix,
  parsePackManifest,
  readPackTemplate,
  type ExtensionPackManifest,
} from '../../domain/pack/extensionPack';
import { PACK_UNNAMED_LABEL } from '../uiLabels';
import { listPackManifests, readPackDataUrl, readPackText } from '../../infrastructure/packFs';
import type { UserFont } from '../../infrastructure/userFontFs';
import { isUserFontId } from '../../domain/font/fontCatalog';

/**
 * 文字の形を選ぶ一覧＝持ち込み（実体があるもの）＋入っているパックの文字の形（ADR-0060 段階2）。
 * ⚠️ **一覧を1つにする**＝選ぶ部品・公開前チェック・書き出しの門は `userFonts`／`userFontIds` だけを見る。
 *   パックの分を別に持つと、配り忘れた所だけ「見つからない」と言う（ADR-0038 で踏んだ「片方だけ漏れる」）。
 * `current` はいまの一覧（パックの分が混ざっていてよい＝持ち込みの分だけ取り出す）。
 */
export function mergeFontList(current: readonly UserFont[], manifests: readonly ExtensionPackManifest[]): UserFont[] {
  return [
    ...current.filter((f) => isUserFontId(f.id)),
    ...packFonts(manifests).map((f) => ({ id: f.id, fileName: f.file, displayName: f.displayName })),
  ];
}

export interface InstalledPacks {
  manifests: ExtensionPackManifest[];
  templates: Template[];
  /** 既定素材の data URL（`pack_<packId>__<assetId>` → URL）。 */
  assetUrls: Record<string, string>;
  /** 読めなかったパック（フォルダは在るが manifest か中身が読めない）。 */
  skipped: string[];
}

/** 入っているパックを全部読む。 */
export async function readInstalledPacks(): Promise<InstalledPacks> {
  const out: InstalledPacks = { manifests: [], templates: [], assetUrls: {}, skipped: [] };
  let raws: string[];
  try {
    raws = await listPackManifests();
  } catch {
    return out;
  }
  for (const raw of raws) {
    const parsed = parsePackManifest(raw);
    if (!parsed.ok) {
      out.skipped.push(packIdGuess(raw));
      continue;
    }
    const m = parsed.manifest;
    try {
      const prefix = packIdPrefix(m.packId);
      const assetIds = new Set<string>();
      const urls: Record<string, string> = {};
      for (const a of m.contents.templateAssets ?? []) {
        urls[`${prefix}${a.assetId}`] = await readPackDataUrl(m.packId, a.file);
        assetIds.add(a.assetId);
      }
      const templates: Template[] = [];
      for (const t of m.contents.templates ?? []) {
        const tmpl = readPackTemplate(m.packId, await readPackText(m.packId, t.file), assetIds);
        if (!tmpl) throw new Error('template');
        templates.push(tmpl);
      }
      out.manifests.push(m);
      out.templates.push(...templates);
      Object.assign(out.assetUrls, urls);
    } catch {
      // 中身の1つでも読めなければ、そのパックは丸ごと使わない（半端に混ぜない）。
      out.skipped.push(m.name);
    }
  }
  return out;
}

/** 読めなかった manifest から、知らせに出す名前を拾えるだけ拾う。 */
function packIdGuess(raw: string): string {
  try {
    const v = JSON.parse(raw) as { name?: unknown; packId?: unknown };
    if (typeof v.name === 'string') return v.name;
    if (typeof v.packId === 'string') return v.packId;
  } catch {
    // 拾えない
  }
  return PACK_UNNAMED_LABEL;
}
