// 素材の取り込みで**両方の形式が使う**部分（#712）。
//
// 場面形式（`projectStore`）とタイムライン形式（`timelineStore`）は、素材の行をどこへ足すかが違うだけで、
// **ファイルの取り込みそのものは同じ**。ここへ置かないと、同じ IO の並びが2か所に増える（§2-7）。
// 素材1つぶんの導出（採番・種別・表示名・保存先）は domain の `newAssetFrom`。
import { assetDisplayUrl, extractVideoThumbnail, isTauri, probeVideo } from "../../infrastructure/assetFs";
import type { AssetMetadata } from "../../domain/project/types";

/** 取り込んだ動画の付加情報。**どれも欠けうる**（取れなかったぶんは付けないだけ）。 */
export type VideoEnrichment = { metadata?: AssetMetadata; thumbnailPath?: string; thumbUrl?: string };

/**
 * 取り込んだ動画の付加情報（メタ＝長さ/音声有無/解像度、代表フレーム＝サムネ）を取得する純IO。
 * store は更新せず結果のみ返す。各取得は独立に失敗を握り、部分結果で続行する（取り込みの成否とは独立
 * ＝メタが取れなくても素材そのものは使える）。
 */
/**
 * 写真の**大きさ**だけを測る（#346）。
 *
 * ⚠️ **これが無いと「ぼやける素材」の注意が写真では一度も出ない**＝`metadata` を書いていたのは
 * 動画の取り込みだけで、写真には `width`/`height` が入らなかった（判定の材料が無いので黙って素通り）。
 * ⚠️ **同じ probe で測れる**（同梱 FFmpeg で確認済み＝PNG も `Stream #0:0: Video: png, …, 256x256`
 * の形で出る）。名前が `probeVideo` なのは経緯だけで、中身は「最初の映像ストリームの情報」。
 * ⚠️ **長さ・音の有無は捨てる**＝静止画には意味が無く、持たせると「0秒の動画」に見える。
 */
export async function probeImageSize(projectId: string, relPath: string): Promise<AssetMetadata | null> {
  try {
    const meta = await probeVideo(projectId, relPath);
    if (!meta || meta.width == null || meta.height == null) return null;
    return { width: meta.width, height: meta.height };
  } catch (e) {
    // 測れなくても取り込みは続ける（注意が1つ出ないだけ＝§2-5）。
    console.warn('[asset] 写真の大きさの取得に失敗:', e);
    return null;
  }
}

export async function probeAndThumbVideo(projectId: string, relPath: string): Promise<VideoEnrichment> {
  const out: VideoEnrichment = {};
  try {
    const meta = await probeVideo(projectId, relPath);
    if (meta) out.metadata = meta;
    else if (isTauri()) console.warn("[asset] 動画メタの取得に失敗しました（既定値で続行）");
  } catch (e) {
    console.warn("[asset] 動画メタ取得で例外:", e);
  }
  try {
    // 代表フレームを生成し、表示用 src（小さなPNG）として読み戻す＝確認画面/一覧に動画フレーム表示。
    const thumbPath = await extractVideoThumbnail(projectId, relPath);
    if (thumbPath) {
      out.thumbnailPath = thumbPath;
      const url = await assetDisplayUrl(projectId, thumbPath);
      if (url) out.thumbUrl = url;
    } else if (isTauri()) {
      console.warn("[asset] 動画サムネの生成に失敗しました（アイコン表示にフォールバック）");
    }
  } catch (e) {
    console.warn("[asset] 動画サムネ生成で例外:", e);
  }
  return out;
}

// ── 素材番号の予約（#712 レビュー） ───────────────────────────────────────────
//
// タイムライン形式は**素材の追加も取り消せる**（`11 §7.6.3`）。ところが取り消しは文書を戻すだけで
// **ファイルは消さない**。素材番号（`createAssetId`）は**空き番号を埋める**採番なので、
// 〈取り込み → 取り消し → 別の写真を取り込み〉で同じ `asset_001` が再発行され、
// **同じ名前のファイルを上書きして前の写真が消える**（やり直しで戻ってきた行が別の写真を指す）。
//
// そこで **その回のアプリ起動中に一度でも使った番号は二度と使わない**。
// - 取り消し・やり直し・開き直し（`emptyState()` で store が初期化される）をまたいで効かせたいので、
//   store の状態ではなく**モジュールに持つ**（＝アプリを閉じるまで残る）。
// - 次に起動したとき使える番号は「どの行からも参照されていない残骸」だけなので、上書きしてよい。
//   残骸そのものの片づけは #348。
const reservedByProject = new Map<string, Set<string>>();

/**
 * その動画で**まだ使っていない**素材番号を1つ取り、使用済みとして覚える。
 * `existingIds` は**いまの文書**の素材（開き直しで戻ってきた番号を数えるため毎回渡す）。
 */
export function reserveAssetId(projectId: string, existingIds: readonly string[], mint: (ids: readonly string[]) => string): string {
  const used = reservedByProject.get(projectId) ?? new Set<string>();
  const id = mint([...existingIds, ...used]);
  used.add(id);
  reservedByProject.set(projectId, used);
  return id;
}

/** テスト用：予約を捨てる（アプリでは呼ばない＝起動中は覚えたままが正しい）。 */
export function resetAssetIdReservations(): void {
  reservedByProject.clear();
}
