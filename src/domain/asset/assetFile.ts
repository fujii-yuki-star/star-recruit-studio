// アップロードされたファイル名から素材種別・拡張子を判定する純粋ロジック（CLAUDE.md §4：domain は副作用なし）。
// 取り込み可能な形式の正典が未確定のため、ここを取り込み判定の単一の参照元とする（MVP・§2-7）。
import { ASSET_TYPE, type AssetType } from '../enums';
import { MAX_INLINE_ASSET_BYTES } from '../constants';
import { createAssetId } from '../project/persistence';
import type { Asset } from '../project/types';

/** 取り込みを「動画」として扱う拡張子（小文字・ドットなし）。 */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'] as const;

/** 取り込みを「画像」として扱う拡張子（小文字・ドットなし）。表示可能な静止画形式（ダイアログの絞り込み用）。 */
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;

/**
 * 取り込みを「音楽」として扱う拡張子（小文字・ドットなし）。
 *
 * ⚠️ **よく使う素材（ADR-0035）でだけ使う**＝動画の素材の取り込み（写真・動画）は従来どおりで、
 * BGM は BGM の導線から入れる。ADR-0035 は棚の中身に**ロゴ・写真・BGM**を挙げているので、
 * 棚の側では音も置けないと「置けるはずのものが置けない」になる（α-6 差分再監査）。
 */
export const AUDIO_FILE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'] as const;

/** ファイル名末尾の拡張子を小文字・英数字のみで返す（無ければ ''）。 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * ファイル名から素材種別を判定する（動画拡張子なら video、音の拡張子なら bgm、ほかは image）。
 *
 * ⚠️ **ロゴ（`logo`）はここでは判らない**＝拡張子は写真と同じなので、置いたあとに利用者が選ぶ
 *（よく使う素材の「名前・種類・タグ」／ADR-0036 の「いつものロゴ」はこれで選べるようになる）。
 * ⚠️ **音は「よく使う素材」でだけ通る**＝動画の素材の取り込みは写真・動画しか選ばせないので、
 * この枝はそちらでは踏まない（規則は1か所に置き、入口の側で絞る）。
 */
export function detectAssetType(name: string): Extract<AssetType, 'image' | 'video' | 'bgm'> {
  const ext = fileExtension(name);
  if ((VIDEO_FILE_EXTENSIONS as readonly string[]).includes(ext)) return ASSET_TYPE.video;
  if ((AUDIO_FILE_EXTENSIONS as readonly string[]).includes(ext)) return ASSET_TYPE.bgm;
  return ASSET_TYPE.image;
}

/**
 * 取り込み時にメモリへ展開（data URL/生バイト）してよいサイズ上限を超えるか（#48・A3）。
 * true の素材は base64/バイトを JS に載せず、ネイティブ「開く」のパス0コピー取り込みへ誘導する（OOM 保険）。
 */
export function exceedsInlineAssetLimit(bytes: number): boolean {
  return bytes > MAX_INLINE_ASSET_BYTES;
}

/**
 * 「素材」一覧に出す種類か（#347）。音（BGM・読み上げ）は素材の一覧に出さない。
 *
 * ⚠️ **絞りの規則を1か所に**（§2-7）＝素材の画面と、見つからない素材を調べる側（`refreshMissingAssets`）が
 * 別々に絞ると、**一覧に出ないものが「見つかりません」に数えられ、選んで直せない行き止まり**になる。
 */
export function isListedMaterial(assetType: AssetType): boolean {
  return assetType !== ASSET_TYPE.bgm && assetType !== ASSET_TYPE.voice;
}

/**
 * 差し替えて**種類が変わる**か（#347）。
 *
 * ⚠️ **「動画かどうか」で見る**＝`detectAssetType` は `image`/`video` しか返さないので、
 * `assetType` と直接くらべると **`logo`/`yuko`/`qr`/`decor` が素通り**する（3人のレビューが揃って指摘）。
 * それらは絵なので**動画でないこと**を確かめれば守れる。音（BGM・読み上げ）はここへ来ない。
 */
export function changesAssetKind(currentType: AssetType, newFileName: string): boolean {
  const wasVideo = currentType === ASSET_TYPE.video;
  return detectAssetType(newFileName) === ASSET_TYPE.video ? !wasVideo : wasVideo;
}

/**
 * 名前が取れなかったときに使う名前（#712・#858）。
 *
 * ⚠️ **一覧に載る名前と、取り込めなかったときに挙げる名前を同じにする**＝別々に決めると、
 * 「入らなかった」と言われた名前が一覧のどれにも当たらない。
 */
export const UNNAMED_ASSET_NAME = '新しい素材';

/**
 * パスやファイル名から**末尾の名前だけ**を取る（`/` と `\` の両方で区切りとして見る）。
 *
 * ⚠️ **区切りを書くのはここだけ**（§2-7）＝`/` だけを見る写しを作ると、Windows の絶対パスが
 * 丸ごと1語になり「取り込めませんでした（C:\…\写真.png）」のように出る（#858）。
 */
export function fileNameOf(name: string): string {
  // 区切りで終わる文字列（`C:/pics/`）は末尾が空＝**名前が取れない**。呼び出し側が
  // `|| UNNAMED_ASSET_NAME` で受ける（`newAssetFrom` の表示名と同じ扱いにする）。
  return name.split(/[/\\]/).pop() ?? name;
}

/**
 * 取り込むファイルの名前から、素材1つぶんの中身と保存先のファイル名を決める（#712）。
 *
 * **同じ導出を取り込み経路ごとに書かない**（§2-7）。以前は `projectStore` の `addAsset` と
 * `addAssetByPath` に同じ7行が2つあり、タイムライン形式の取り込みを足すと4つになるところだった。
 *
 * `name` は**ファイル名でもパスでもよい**（`/` と `\` の両方で末尾を取る）＝ネイティブの「開く」が
 * 返す絶対パスをそのまま渡せる。拡張子が無ければ種別ごとの既定を使う（保存先に拡張子が要る）。
 */
export function newAssetFrom(
  name: string,
  existingIds: readonly string[],
  /** 採番済みの番号を使う（呼び出し側が「使い回さない」規則で採ったとき＝#712 レビュー）。 */
  reservedId?: string,
): { asset: Asset; fileName: string } {
  const namePart = fileNameOf(name);
  const assetId = reservedId ?? createAssetId(existingIds);
  const assetType = detectAssetType(namePart);
  const ext = fileExtension(namePart) || (assetType === ASSET_TYPE.video ? 'mp4' : 'png');
  const parts = namePart.split('.');
  const baseName = parts.length > 1 ? parts.slice(0, -1).join('.') : namePart;
  const fileName = `${assetId}.${ext}`;
  return {
    asset: {
      assetId,
      assetType,
      // 名前が空/空白だけでも**一覧で選べる名前**にする（無名の行を作らない）。
      displayName: baseName.trim() || UNNAMED_ASSET_NAME,
      filePath: `assets/${fileName}`,
    },
    fileName,
  };
}

/**
 * 動画から切り出した静止画の**表示名**（#349）。元の動画の名前と、切り出した時間から作る。
 *
 * ⚠️ **一覧で見分けられる名前にする**＝「無題」が並ぶと、どの動画のどこを切ったのか分からない。
 * ⚠️ **秒は「分:秒」で書く**（`75` ではなく `1:15`）＝画面に出る文字なので読める形にする（§2-3）。
 */
export function frameAssetName(videoName: string, atSec: number): string {
  const t = Math.max(0, atSec);
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  return `${videoName || UNNAMED_ASSET_NAME}（${mm}:${String(ss).padStart(2, '0')}）`;
}

/**
 * 動画から切り出した静止画1つぶん（#349）。**普通の画像素材として登録する**
 *（ADR-0024＝Asset は元素材の源泉。切り出した絵はそれ自体が1つの素材）。
 *
 * ⚠️ **PNG で固定**＝切り出しは原寸のまま出す（縮めない・劣化させない）ので、
 * 非可逆にしない。⚠️ **出自（どの動画のどこか）は表示名だけに持たせる**＝
 * `Asset` へフィールドを足すと schema のバンプが要り、**使う側もいない**（#349 の「出自を残す場合のみ」）。
 */
export function newFrameAsset(
  videoName: string,
  atSec: number,
  existingIds: readonly string[],
): { asset: Asset; fileName: string } {
  const assetId = createAssetId(existingIds);
  const fileName = `${assetId}.png`;
  return {
    asset: {
      assetId,
      assetType: ASSET_TYPE.image,
      displayName: frameAssetName(videoName, atSec),
      filePath: `assets/${fileName}`,
    },
    fileName,
  };
}
