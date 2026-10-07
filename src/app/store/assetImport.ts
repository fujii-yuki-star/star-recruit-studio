// 素材の取り込みで**両方の形式が使う**部分（#712）。
//
// 場面形式（`projectStore`）とタイムライン形式（`timelineStore`）は、素材の行をどこへ足すかが違うだけで、
// **ファイルの取り込みそのものは同じ**。ここへ置かないと、同じ IO の並びが2か所に増える（§2-7）。
// 素材1つぶんの導出（採番・種別・表示名・保存先）は domain の `newAssetFrom`。
import { assetDisplayUrl, extractVideoThumbnail, isTauri, probeVideo } from "../../infrastructure/assetFs";
import { ASSET_TYPE } from "../../domain/enums";
import type { Asset, AssetMetadata } from "../../domain/project/types";

/** 取り込んだ動画の付加情報。**どれも欠けうる**（取れなかったぶんは付けないだけ）。 */
export type VideoEnrichment = { metadata?: AssetMetadata; thumbnailPath?: string; thumbUrl?: string };

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

/**
 * 音の素材の**長さ**だけを測る（#1348＝効果音が仮の 10 秒の帯になり、くり返し鳴っていた）。
 * ⚠️ **同じ probe で測れる**（FFmpeg の `-i` が音のファイルにも `Duration:` を出す）。名前が `probeVideo` なのは経緯だけ。
 * ⚠️ **長さだけを返す**＝大きさ・音の有無は音の素材には意味が無い。測れなければ null（取り込みは続ける）。
 */
export async function probeAudioDuration(projectId: string, relPath: string): Promise<AssetMetadata | null> {
  try {
    const meta = await probeVideo(projectId, relPath);
    const d = meta?.durationSec;
    return d != null && Number.isFinite(d) && d > 0 ? { durationSec: d } : null;
  } catch (e) {
    console.warn("[asset] 音の長さの取得に失敗:", e);
    return null;
  }
}

/**
 * 取り込んだ動画の付加情報（メタ＝長さ/音声有無/解像度、代表フレーム＝サムネ）を取得する純IO。
 * store は更新せず結果のみ返す。各取得は独立に失敗を握り、部分結果で続行する（取り込みの成否とは独立
 * ＝メタが取れなくても素材そのものは使える）。
 */
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

/**
 * 開いた文書の素材で、**取り込み時に付けるはずの情報が欠けているもの**を補う（#352 の検証で見つけた）。
 *
 * ⚠️ **フォルダからの取り込み（起動の引数・ADR-0042）と古い文書は、画面からの取り込みと違ってこれを持たない**
 * ＝動画の長さ・音の有無・大きさ・代表フレーム、写真の大きさ。とくに**音の有無**が無いと、元の音を鳴らす設定が
 * 書き出しで**黙って無音**になる（`findVideoSlot`・`placementOriginalAudio` は「音がある」と分かっている素材しか鳴らさない
 * ＝§2-5・ADR-0026①）。両方の形式の「開く」がこの1つを通る（§2-7）。
 * ⚠️ **取れなかったぶんは付けない**（開くのは止めない）。変わらない素材は**同じ物**を返す。
 */
export async function fillMissingAssetInfo(projectId: string, assets: readonly Asset[]): Promise<Asset[]> {
  return Promise.all(
    assets.map(async (a): Promise<Asset> => {
      if (!a.filePath) return a;
      if (a.assetType === ASSET_TYPE.video) {
        const needMeta = a.metadata?.hasAudio == null || a.metadata?.durationSec == null;
        const needThumb = !a.thumbnailPath;
        let metadata: AssetMetadata | undefined;
        if (needMeta) {
          try {
            metadata = (await probeVideo(projectId, a.filePath)) ?? undefined;
          } catch (e) {
            console.warn("[asset] 開くときの動画メタ取得で例外:", e);
          }
        }
        let thumbnailPath: string | undefined;
        if (needThumb) {
          try {
            thumbnailPath = (await extractVideoThumbnail(projectId, a.filePath)) ?? undefined;
          } catch (e) {
            console.warn("[asset] 開くときの動画サムネ生成で例外:", e);
          }
        }
        if (!metadata && !thumbnailPath) return a;
        return {
          ...a,
          ...(metadata ? { metadata: { ...a.metadata, ...metadata } } : {}),
          ...(thumbnailPath ? { thumbnailPath } : {}),
        };
      }
      if (a.assetType === ASSET_TYPE.image && (a.metadata?.width == null || a.metadata?.height == null)) {
        const size = await probeImageSize(projectId, a.filePath);
        return size ? { ...a, metadata: { ...a.metadata, ...size } } : a;
      }
      return a;
    }),
  );
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

// ⚠️ **まだ番号の無い動画の予約は `""` の名前で入る**（α-7 再監査 🟡）＝新しい動画は
// **取り込みの後で** `proj_YYYYMMDD_NNN` を採るため。引き継がないと、保存して番号が付いた後の
// 2件目が `""` の予約を見ず、**1件目と同じ番号を再発行**して `assets/asset_001.png` を上書きする
//（前の写真が別の絵に化ける＝この予約が防ぎたかったこと）。
// ⚠️ **焼き出し（別の動画を作る経路）では引き継がない**＝焼き出しは先に元を保存するので、
// 元の `""` の予約は**その保存の中で既に引き継がれている**（#976 レビューで裏を取った）。
// そこで呼ぶと、無関係な下書きが残した予約まで持ち去るだけになる。
// ⚠️ **予約のときに `""` を覗きに行く形は採らない**＝別の新しい動画が残した予約まで拾い、
// 関係のない動画で番号が飛ぶ（引き継ぎの側で移すだけで足りる＝変異チェックで等価と分かった）。
const PENDING_PROJECT = "";

/**
 * まだ番号の無いうちに取った予約を、決まった番号の動画へ引き継ぐ。
 * **番号が決まった所で呼ぶ**（取り込みの中で `createProjectId` した直後）。
 */
export function adoptPendingAssetIds(projectId: string): void {
  if (!projectId) return;
  const pending = reservedByProject.get(PENDING_PROJECT);
  if (!pending || pending.size === 0) return;
  const used = reservedByProject.get(projectId) ?? new Set<string>();
  for (const id of pending) used.add(id);
  reservedByProject.set(projectId, used);
  reservedByProject.delete(PENDING_PROJECT);
}

/** テスト用：予約を捨てる（アプリでは呼ばない＝起動中は覚えたままが正しい）。 */
export function resetAssetIdReservations(): void {
  reservedByProject.clear();
}

// ── 動画そのものの番号（`proj_YYYYMMDD_NNN`）の予約（#992 ③） ─────────────────
//
// ⚠️ **同じ番号の動画が2つ作られ、片方が消える**＝焼き出し（`bakeToTimeline`）と複製は
// **ファイルを運んでから `project.json` を書く**（途中で失敗しても「素材の無い動画」を一覧に
// 残さないため）。ところが番号は一覧から採り、一覧の側は **`project.json` を読めないフォルダを
// 飛ばす**ので、**運んでいる最中は、作りかけの動画が一覧に居ない**。
// ＝その間に2回目を始めると**同じ番号が返り**、両方が同じフォルダへ運んで、
// 後から書いた `project.json` が勝つ＝**2つ頼んで1つしかできず、素材だけが混ざる**。
//
// ⚠️ **素材番号と同じ形で防ぐ**＝ディスクではなく**モジュール**に覚える（store の初期化や
// 画面の行き来をまたいで効かせる）。⚠️ **`project.json` を先に書く手もあるが採らない**＝
// 運んでいる途中で失敗したとき、**中身の無い動画が一覧に残る**（いまの順番はそれを避けている）。
const reservedProjectIds = new Set<string>();

/**
 * まだ使っていない**動画の番号**を1つ取り、使用済みとして覚える。
 *
 * @param existingIds いま一覧に出ている番号（毎回渡す＝開き直しで戻ってきたものを数えるため）。
 * @param mint 採番の規則（`createProjectId` を渡す＝規則はあちらに1つ）。
 */
export function reserveProjectId(existingIds: readonly string[], mint: (ids: readonly string[]) => string): string {
  const id = mint([...existingIds, ...reservedProjectIds]);
  reservedProjectIds.add(id);
  return id;
}

/** テスト用：予約を捨てる（アプリでは呼ばない＝起動中は覚えたままが正しい）。 */
export function resetProjectIdReservations(): void {
  reservedProjectIds.clear();
}
