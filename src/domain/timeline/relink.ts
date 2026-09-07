// タイムライン形式の**素材の差し替え**（#1019 ⑤）。純粋・副作用なし。
//
// ⚠️ **場面形式には前からある**（`domain/asset/relink.ts`）のに、こちらには**同等の操作が無かった**。
// 案内は「素材を取り込み直すか、その部品を置き直してください」＝**新しい番号になる**ので、
// **切り抜き・動き・連動する字幕まで作り直し**になっていた（`15 §6` `ASSET_FILE_MISSING` は
// 「置いた場所・切り出す範囲・キーフレーム・字幕の紐づけは**構造的に**残る」と、形式を限定せずに
// 書いている）。
//
// ⚠️ **`assetId` を付け替えない**のが肝（ADR-0024＝Asset は元素材の源泉）＝同じ番号のまま
// ファイルだけ差し替えるので、**参照を書き換える必要がない**（書き換え漏れが起きない）。
//
// ⚠️ **収め方は場面形式と同じ関数**（`clampClip`）＝写すと、同じ素材が形式によって違う範囲になる。
import { clampClip } from '../asset/relink';
import { ASSET_USE_KIND } from '../enums';
import { clipImageAssetUses } from './export';
import type { Asset, AssetMetadata } from '../project/types';
import type { Template } from '../template/types';
import type { TimelineClip } from './types';

/** 差し替えの結果。何が変わったかを呼び出し側が案内に使う。 */
export interface TimelineRelinkResult {
  asset: Asset;
  clips: TimelineClip[];
  /** 切り出す範囲を新しい長さに収め直した使い方の数（0＝そのまま入った）。 */
  clampedUses: number;
}

/**
 * 素材のファイルを差し替える（`assetId` は変えない）。
 *
 * ⚠️ **収め直すのは「素材そのもの」と「その素材の使い方ぜんぶ」**＝①`asset.clip`（既定）と、
 * ②**部品での使い方**（直接置き＝`clip.sourceStartSec`／差し込み口・立ち絵＝`clip.slotClips[層 id]`）。
 *
 * ⚠️ **使い方の列挙は `clipImageAssetUses` に任せる**（PR レビュー 🔴）＝自前で層を絞ると
 * **立ち絵が漏れる**（#809 で立ち絵も「置き場所」になり、per-use の値は差し込み口と**同じ入れ物**に入る）。
 * あちらの JSDoc がまさに「列挙はここ1つ＝1つ漏らすとその絵だけ消える（実際に立ち絵を落としていた）」と
 * 書いており、同じ轍を踏まないための単一の参照元（§2-7・ADR-0026②）。
 */
export function relinkTimelineAsset(
  asset: Asset,
  clips: readonly TimelineClip[],
  templateOf: (templateId: string) => Template | undefined,
  newFilePath: string,
  metadata: AssetMetadata | null,
  thumbnailPath?: string | null,
): TimelineRelinkResult {
  const next: Asset = { ...asset, filePath: newFilePath };
  if (metadata) next.metadata = metadata;
  else delete next.metadata;
  if (thumbnailPath) next.thumbnailPath = thumbnailPath;
  else delete next.thumbnailPath;

  const duration = metadata?.durationSec;
  let clampedUses = 0;

  // ① 素材そのものに付いている既定の使い方。
  const own = clampClip(next.clip, duration);
  if (own.changed) clampedUses += 1;
  if (own.clip) next.clip = own.clip;
  else delete next.clip;

  const outClips = clips.map((clip) => {
    // **この部品でこの素材をどう使っているか**（直接置き／差し込み口／立ち絵）。
    const uses = clipImageAssetUses(clip, templateOf).filter((u) => u.assetId === asset.assetId);
    if (uses.length === 0) return clip;

    let patched = clip;
    let slots: Record<string, NonNullable<TimelineClip['slotClips']>[string]> | undefined;

    for (const use of uses) {
      if (use.kind === ASSET_USE_KIND.direct) {
        // 直接置いた部品の使い始め（`sourceStartSec`）。
        // ⚠️ **`Clip` の形へ寄せて同じ関数を通す**＝ここだけ自前で比べると、収め方が2つになる。
        const asClip = clampClip({ startSec: clip.sourceStartSec }, duration);
        if (!asClip.changed) continue;
        clampedUses += 1;
        patched = { ...patched };
        if (asClip.clip?.startSec == null) delete patched.sourceStartSec;
        else patched.sourceStartSec = asClip.clip.startSec;
        continue;
      }
      // 差し込み口・立ち絵ごとの使い方（`slotClips[層 id]`）。
      // ⚠️ **見た目が引けないと立ち絵の層 id が決まらない**（`layerId` が `null`）＝どの入れ物の話か
      //   分からないまま書き換えると、関係ない使い方まで変わる（黙って別の結果・§2-5）。
      if (use.layerId == null) continue;
      const override = (slots ?? clip.slotClips)?.[use.layerId];
      const r = clampClip(override, duration);
      if (!r.changed) continue;
      clampedUses += 1;
      slots ??= { ...clip.slotClips };
      if (r.clip) slots[use.layerId] = r.clip;
      else delete slots[use.layerId];
    }

    if (slots) {
      patched = { ...patched };
      if (Object.keys(slots).length > 0) patched.slotClips = slots;
      else delete patched.slotClips;
    }
    return patched;
  });

  return { asset: next, clips: outClips, clampedUses };
}
