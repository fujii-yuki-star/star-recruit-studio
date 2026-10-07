// 書き出しに渡す素材の絵（#716）。**両方の形式が同じ規則で解く**ための1か所。
//
// ⚠️ **表示用の URL（`asset://…`）は書き出しでは読めない**。
// 書き出しは SVG を Blob → `<img>` → canvas で焼く（`renderer/export/rasterize.ts`）ので、
// SVG の中の外部参照は**取りに行かずに黙って落ちる**（リクエストが遮断されるだけなので canvas は汚れず、
// `toDataURL` は成功する＝**素材が抜けた動画が「成功」として出る**）。プレビューで見えるのは、
// あちらが SVG を**トップ文書へ直接差し込んでいる**ため。同じ URL でも消費側の文脈が違う。
//
// この非対称を形式ごとに書くと、片方だけ直す事故が起きる（実際にタイムライン形式で起きた＝#716）。
// **解き方はここだけ**にして、場面形式・タイムライン形式の両方が通す。
import { readAssetDataUrl } from "../../infrastructure/assetFs";
import { isTemplateAsset } from "../../domain/template/templateAsset";
import { ASSET_TYPE } from "../../domain/enums";
import type { Asset } from "../../domain/project/types";

/** 素材 id → 書き出しで描ける絵（data URL）。取れないものは `undefined`（＝描かれない）。 */
export type ExportSrcResolver = (assetId: string) => Promise<string | undefined>;

/**
 * 書き出し用のリゾルバを作る。
 *
 * - **テンプレ既定素材**（`tmpl_asset_*`）は既に data URL なのでそのまま返す（ADR-0021）。
 * - **動画**は本体（大容量）を載せず**代表フレーム**を返す（ADR-0006・#442 の窓フレームもこれを使う）。
 * - **写真**は本体をディスクから data URL 化する（ADR-0004）。
 */
export function createExportSrcResolver(input: {
  projectId: string | undefined;
  assets: readonly Asset[];
  templateAssetSrcById: Record<string, string>;
}): ExportSrcResolver {
  const byId = new Map(input.assets.map((a) => [a.assetId, a] as const));
  return async (assetId) => {
    if (isTemplateAsset(assetId)) return input.templateAssetSrcById[assetId];
    const a = byId.get(assetId);
    const pid = input.projectId;
    if (!pid || !a) return undefined;
    if (a.assetType === ASSET_TYPE.video) {
      return a.thumbnailPath ? ((await readAssetDataUrl(pid, a.thumbnailPath)) ?? undefined) : undefined;
    }
    if (!a.filePath) return undefined;
    return (await readAssetDataUrl(pid, a.filePath)) ?? undefined;
  };
}

/**
 * 使う素材をまとめて解く（タイムライン形式・#716）。
 *
 * 場面形式は場面ごとに解いて捨てられるが、こちらは**全フレームを通して同じ絵を引く**ので先にまとめて持つ。
 * そのぶん記憶に載るので、**実際に使っている素材だけ**を渡すこと（`timelineImageAssetIds`）。
 */
export async function resolveExportSrcMap(
  ids: readonly string[],
  resolve: ExportSrcResolver,
): Promise<Record<string, string>> {
  const entries = await Promise.all(ids.map(async (id) => [id, await resolve(id)] as const));
  const out: Record<string, string> = {};
  for (const [id, src] of entries) if (src) out[id] = src;
  return out;
}
