// 素材の**再リンク・差し替え**（#347）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **`assetId` を付け替えない**のが肝（ADR-0024 決定＝**Asset は元素材の源泉**）。
// 同じ `assetId` のままファイルだけ差し替えるので、**配置・尺・キーフレーム・字幕の紐づけは
// 構造的に全部そのまま**残る（参照を書き換える必要がない＝書き換え漏れが起きない）。
//
// ⚠️ **短い動画へ差し替えると、切り出す範囲が新しい長さを超える**ことがある。黙って直さず
// **直した件数を返して知らせる**（§2-5＝どこが変わったか分かる）。
import { LAYER_TYPE } from '../enums';
import type { Asset, AssetMetadata, Clip, Scene } from '../project/types';
import type { Template } from '../template/types';

/** 差し替えの結果。何が変わったかを呼び出し側が案内に使う。 */
export type RelinkResult = {
  asset: Asset;
  scenes: Scene[];
  /** 切り出す範囲を新しい長さに収め直した使い方の数（0＝そのまま入った）。 */
  clampedUses: number;
};

/**
 * 切り出す範囲を新しい長さへ収める。
 *
 * ⚠️ **範囲が丸ごと外に出たら、範囲そのものを外す**（先頭から全部にする）＝
 * 開始＝終了の**長さ0**を作らない（鳴らない・映らないクリップになる）。
 */
function clampClip(clip: Clip | undefined, durationSec: number | null | undefined): { clip?: Clip; changed: boolean } {
  if (!clip) return { clip, changed: false };
  if (typeof durationSec !== 'number' || !(durationSec > 0)) return { clip, changed: false };
  const start = clip.startSec;
  const end = clip.endSec;
  const startOver = typeof start === 'number' && start >= durationSec;
  const endOver = typeof end === 'number' && end > durationSec;
  if (!startOver && !endOver) return { clip, changed: false };
  const next: Clip = { ...clip };
  // 開始が新しい長さの外＝**先頭から**へ戻す（そこから始めても何も無いため）。
  if (startOver) delete next.startSec;
  if (typeof next.endSec === 'number' && next.endSec > durationSec) {
    // 終わりだけが外なら、新しい終わりへ寄せる。開始も外れていたなら丸ごと外す。
    if (startOver) delete next.endSec;
    else next.endSec = durationSec;
  }
  return { clip: next, changed: true };
}

/**
 * 素材のファイルを差し替える（`assetId` は変えない）。
 *
 * `newFilePath` は取り込み先の相対パス（`assets/asset_001.mp4` など）。
 * `metadata` は差し替えたファイルから測り直したもの（測れなければ `null`＝前のものを捨てる。
 * ⚠️ **前の長さを残さない**＝別のファイルの長さで範囲を判断すると、実際には無い所を切り出す）。
 */
export function relinkAsset(
  asset: Asset,
  scenes: readonly Scene[],
  /** 見た目パターン一覧（立ち絵の層 id を引くのに要る＝描画と同じ解決を通すため）。 */
  templates: readonly Template[],
  newFilePath: string,
  metadata: AssetMetadata | null,
  /** 代表フレーム（動画のみ・取れなければ前のものを捨てる＝前のファイルの絵を出さない）。 */
  thumbnailPath?: string | null,
): RelinkResult {
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

  // ② 場面ごとの使い方（per-use＝ADR-0028 `scene.slotClips`）。
  //
  // ⚠️ **キーが指している素材を、描画と同じ規則で引く**（ADR-0028 D6＝キーは「FREE 要素 id」か
  // 「テンプレの layer.id」）。3通りある:
  //   ・通常テンプレの差し込み口 → `assetRefs[key]`
  //   ・自由配置の要素          → `freeLayout` の同じ id の `assetId`
  //   ・立ち絵                  → `character.poseAssetId`（**その層のときだけ**）
  // ⚠️ **立ち絵を層で絞る**（レビュー 🟡）＝絞らずに `poseAssetId` だけで見ると、立ち絵がこの素材の
  // 場面では**その場面の全キー**が対象になり、**別の素材の範囲まで黙って変わる**（件数も過大になる）。
  // ⚠️ **自由配置を落とさない**（レビュー 🔴）＝場面編集が書くのは `slotClips[要素id]` なので、
  // `assetRefs` だけを見ると**常用の経路がまるごと抜ける**（収め直しも通知も起きない）。
  //
  // ⚠️ **見た目が分からない場面では、立ち絵だけ収め直しから漏れる**（層 id を引けないため・
  // PR #874 レビュー 🟢）。`sceneActiveAssetIds` が同じ状況で「絞りきらず多めに数える」のと
  // **逆向き**だが、意図的にこのままにしている＝あちらは「消させない」ために多めに倒すもので、
  // こちらは**範囲を勝手に書き換えない**ために少なめに倒す（見た目が解決できない場面はそもそも
  // 描画・書き出しの対象外＝§2-5 なので、収め直さなくても実害のあるものは出ない）。
  const nextScenes = scenes.map((s) => {
    const slotClips = s.slotClips;
    if (!slotClips) return s;
    const template = templates.find((t) => t.templateId === s.templateId);
    const characterLayerId = template?.layers.find((l) => l.type === LAYER_TYPE.character)?.id;
    const assetIdAt = (key: string): string | undefined =>
      s.assetRefs?.[key]
      // `null`＝「なし」も未指定と同じ扱い（`??` で次へ落とす）＝解決は描画と同じ。
      ?? s.freeLayout?.find((el) => el.id === key)?.assetId
      ?? (key === characterLayerId ? s.character?.poseAssetId : undefined)
      ?? undefined;

    let touched = false;
    const out: Record<string, Clip> = {};
    for (const [layerId, c] of Object.entries(slotClips)) {
      if (assetIdAt(layerId) !== asset.assetId) { out[layerId] = c; continue; }
      const r = clampClip(c, duration);
      if (r.changed) { touched = true; clampedUses += 1; }
      if (r.clip) out[layerId] = r.clip;
    }
    return touched ? { ...s, slotClips: out } : s;
  });

  return { asset: next, scenes: nextScenes, clampedUses };
}
