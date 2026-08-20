// タイムライン形式の**動画素材**（#512 段1＝絵）。純粋・副作用なし。
//
// 段1＝絵（実フレーム）／**段2＝元の音**（`useOriginalAudio`）。どちらも直接置いた素材が対象で、
// 差し込み口（`assetRefs`）は段3。段2 で扱わないもの（音量の変化・前後のフェード）は付けない
// ＝置ける欄を出しておいて効かない、を作らない。
//
// 絵の作り方は場面形式（#442）と同じ道具立て：素材の区間を**出力 fps・速度込み**でコマへ焼き出し
// （Rust `stage_clip_frames`）、フレームごとにその1枚を差し込む。
// ⚠️ **動画にまつわる規則はここへ集約する**（どの部品が動画か／どの区間を焼くか／どのコマを出すか／
// 実映像を出せるか）＝プレビューと書き出しが同じものを見る（別々に持つと preview≠export になる）。
import { isHiddenByGroup } from '../group/compose';
import { ORIGINAL_AUDIO_VOLUME } from '../constants';
import { ASSET_TYPE, LAYER_TYPE, SLOT_TYPE, TIMELINE_CLIP_KIND } from '../enums';
import { SPEED_DEFAULT } from '../constants';
import { clampSpeed } from '../asset/clip';
import type { Template } from '../template/types';
import type { AssetUseKind } from './export';
import { clampVolume } from '../voice/audioMix';
import { resolveSlotClip } from '../asset/clip';
import type { TimelineClip, TimelineProject } from './types';

/** その部品が**直接置いた**動画の素材 id（`null`＝直接置いた動画ではない）。 */
export function videoAssetIdOfClip(clip: TimelineClip, videoAssetIds: ReadonlySet<string>): string | null {
  if (clip.kind !== TIMELINE_CLIP_KIND.slot) return null;
  return clip.assetId != null && videoAssetIds.has(clip.assetId) ? clip.assetId : null;
}

/**
 * 動画を映す**置き場所**1つ分（#512 段3）。
 *
 * ⚠️ **1つの部品に複数の動画がありうる**＝見た目パターンのクリップは差し込み口の数だけ持てる。
 * だから「どの部品か」ではなく「**どの置き場所か**」を単位にする（コマの焼き出し先・差し替える
 * アイテム・元の音が、置き場所ごとに別々になる）。
 */
export interface VideoPlacement {
  clip: TimelineClip;
  /** 使い方（`direct`＝直接置き／`slot`＝差し込み口）。⚠️ **層 id から導き直さない**（`null` は
   *  立ち絵とも重なる＝別の使い方が同じ鍵になる）。種別は `AssetUseKind` と共有。 */
  use: Extract<AssetUseKind, 'direct' | 'slot'>;
  /** 見た目パターンの差し込み口の層 id（`null`＝クリップに直接置いた素材）。 */
  layerId: string | null;
  assetId: string;
  /** 素材のどこから使うか（秒）＝直接置きはクリップ自身、差し込み口は `slotClips` の解決値。 */
  sourceStartSec: number;
  /** 焼き出す長さ（秒）＝置いた長さ。差し込み口で「ここまで」があれば、そこで頭打ち。 */
  durationSec: number;
  /** 速さ（>0）＝同上。 */
  speed: number;
  /** 元の音を鳴らす設定か（#512 段2・段3b）＝直接置きはクリップ自身、差し込み口は `slotClips` の解決値。 */
  useOriginalAudio: boolean;
  /** 元の音の音量（0〜1.5・既定は `ORIGINAL_AUDIO_VOLUME`）。 */
  originalAudioVolume: number;
}

/**
 * その部品が持つ**動画の置き場所**（直接置き＋差し込み口）。
 *
 * ⚠️ 差し込み口の使い方（トリム・速さ）は**場面形式と同じ解決**（`resolveSlotClip`＝per-use 上書きを
 * 素材既定に重ねる・ADR-0028）＝同じ差し込み口を2つの形式で別々に読まない（§6）。
 */
export function videoPlacementsOfClip(
  doc: TimelineProject,
  clip: TimelineClip,
  opts: { ids?: ReadonlySet<string>; templateOf?: (templateId: string) => Template | undefined } = {},
): VideoPlacement[] {
  const ids = opts.ids ?? videoAssetIds(doc);
  const direct = videoAssetIdOfClip(clip, ids);
  if (direct != null) {
    return [{
      clip, use: 'direct', layerId: null, assetId: direct,
      sourceStartSec: clip.sourceStartSec ?? 0, durationSec: clip.durationSec, speed: effectiveSpeed(clip),
      useOriginalAudio: clip.useOriginalAudio === true,
      originalAudioVolume: clampVolume(clip.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME),
    }];
  }
  // ⚠️ **どの枠が動画を受けるかは見た目パターンが決める**（レビュー 🔴）＝場面形式と同じ規則
  // （`findVideoSlots`＝**差し込み口の層だけ**・写真だけの差し込み口は除く・`11 §3.4/§5`）。
  // 見ずに `assetRefs` を全部数えると、**背景の層に入れた動画**まで置き場所になり、プレビューは
  // 静止画（背景の層は差し込み口として描かれない）・書き出しは実映像、という食い違いになる（ADR-0001）。
  // 見た目が解けないときは**置き場所にしない**＝静止画の側へ倒す（そもそも描かれないので焼く意味も無い）。
  const template = clip.templateId != null ? opts.templateOf?.(clip.templateId) : undefined;
  if (!template) return [];
  const out: VideoPlacement[] = [];
  for (const layer of template.layers) {
    if (layer.type !== LAYER_TYPE.slot) continue;
    if (layer.slotType === SLOT_TYPE.image) continue;
    const assetId = clip.assetRefs?.[layer.id];
    if (typeof assetId !== 'string' || !ids.has(assetId)) continue;
    const asset = doc.assets.find((a) => a.assetId === assetId);
    const resolved = resolveSlotClip(clip.slotClips?.[layer.id], asset?.clip);
    out.push({
      clip,
      use: 'slot',
      layerId: layer.id,
      assetId,
      sourceStartSec: resolved.startSec ?? 0,
      // ⚠️ **「ここまで」も持ち込む**（レビュー 🟡）＝場面で切った終わりを黙って無視すると、
      // 焼き出した先ではその先まで流れる（ADR-0026①）。使える長さで頭打ちにする＝素材が
      // 短いときと同じく最後のコマで止まる。
      durationSec: placedDurationWithin(clip.durationSec, resolved.startSec, resolved.endSec, clampSpeed(resolved.speed ?? SPEED_DEFAULT)),
      // ⚠️ 速さも**場面形式と同じクランプ**（schema の 0.5〜2.0＝`slotClips.speed`）を通す。
      speed: clampSpeed(resolved.speed ?? SPEED_DEFAULT),
      // 元の音（#512 段3b）＝差し込み口は `slotClips` の語彙（場面形式と同じ・`resolveSlotClip` 解決済み）。
      useOriginalAudio: resolved.useOriginalAudio === true,
      originalAudioVolume: clampVolume(resolved.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME),
    });
  }
  return out;
}

/** 使える素材の長さで、置いた長さを頭打ちにする（`endSec` 未指定＝置いた長さのまま）。 */
function placedDurationWithin(
  placedSec: number,
  startSec: number | undefined,
  endSec: number | undefined,
  speed: number,
): number {
  if (endSec == null) return placedSec;
  const usableSec = Math.max(0, endSec - (startSec ?? 0)) / speed;
  return Math.min(placedSec, usableSec);
}

/** 文書が持つ動画素材の id（`assetType` で見分ける＝画面の一覧と同じ規則）。 */
export function videoAssetIds(doc: TimelineProject): Set<string> {
  return new Set(doc.assets.filter((a) => a.assetType === ASSET_TYPE.video).map((a) => a.assetId));
}

/**
 * 動画を映す部品（描く順は問わない＝呼び出し側が並べる）。
 *
 * ⚠️ **描かれないものは含めない**（レビュー 🟡）＝隠した部品・隠した列・隠したまとまりは動画に出ないので、
 * コマを焼く必要も無い。含めると**動画に出ない素材のファイルが欠けているだけで書き出し全体が失敗する**
 * （Rust の焼き出しは入力が無いと失敗する）＝出ないものを理由に断ることになる。
 */
export function videoClipsOf(doc: TimelineProject): TimelineClip[] {
  const ids = videoAssetIds(doc);
  return doc.clips.filter((c) => videoAssetIdOfClip(c, ids) != null && isDrawnClip(doc, c));
}

/**
 * 文書の中で**実際に動画として描かれる置き場所**（#512 段3）。
 * ⚠️ 描かれないもの（隠した部品・列・まとまり）は含めない＝`videoClipsOf` と同じ理由。
 */
export function videoPlacementsOf(
  doc: TimelineProject,
  templateOf?: (templateId: string) => Template | undefined,
): VideoPlacement[] {
  const ids = videoAssetIds(doc);
  const out: VideoPlacement[] = [];
  for (const clip of doc.clips) {
    if (!isDrawnClip(doc, clip)) continue;
    out.push(...videoPlacementsOfClip(doc, clip, { ids, ...(templateOf ? { templateOf } : {}) }));
  }
  return out;
}

/**
 * その部品が**描かれるか**（隠した部品・隠した列・隠したまとまりは描かれない）。
 * ⚠️ 描く側（`layoutTimelineAt`）と同じ条件＝「描かれるか」を2か所で数えない。
 */
export function isDrawnClip(doc: TimelineProject, clip: TimelineClip): boolean {
  if (clip.hidden) return false;
  if (doc.tracks.find((t) => t.id === clip.trackId)?.hidden) return false;
  return !isHiddenByGroup(clip.id, doc.groups ?? []);
}

/**
 * その**置き場所**の元の音（#512 段2・段3b）。`null`＝鳴らない。
 *
 * ⚠️ **場面形式と同じ規準**（ADR-0026②＝`findVideoSlot.toVideoSlotInfo`）：
 * - **既定は鳴らさない**（`useOriginalAudio` 未指定＝false）＝既に作った動画の音が黙って変わらない。
 * - **素材に音が入っているときだけ**（`metadata.hasAudio`）＝音の無いファイルへ音の取り出しを頼むと
 *   書き出しが失敗する（場面形式が同じ理由で同じ門を置いている）。
 * - 音量・速さ・使い始めは**置き場所が解決済みの値**（直接置き＝クリップ自身／差し込み口＝`slotClips`）。
 * - ⚠️ **描かれない置き場所は鳴らない**（`videoPlacementsOf` が既に除いている）＝隠したのに聞こえる、を
 *   作らない（音のクリップで `audioCuesAt` が置いている規則と同じ）。
 *
 * 再生（仕上がり確認）・書き出し・画面の欄が**この1つ**を通る＝聞いた音と書き出した音が一致する。
 */
export function placementOriginalAudio(
  doc: TimelineProject,
  p: VideoPlacement,
): { assetId: string; volume: number; speed: number; sourceStartSec: number } | null {
  if (!p.useOriginalAudio) return null;
  if (doc.assets.find((a) => a.assetId === p.assetId)?.metadata?.hasAudio !== true) return null;
  return { assetId: p.assetId, volume: p.originalAudioVolume, speed: p.speed, sourceStartSec: p.sourceStartSec };
}

/**
 * その部品で**元の音を選べるか**（#512 段2）＝素材に音が入っている動画の部品。
 * ⚠️ 画面（欄を出すか）・編集（値を置けるか）が**同じ述語**を通る＝
 * 「置けるのに欄が出ない」「出るのに断られる」を作らない（`isAudioClip` と同じ流儀）。
 * ⚠️ **隠しているかは見ない**＝隠した部品でも設定は変えられる（鳴るかどうかだけが `placementOriginalAudio`）。
 */
export function canUseOriginalAudio(doc: TimelineProject, clip: TimelineClip): boolean {
  return videoAudioState(doc, clip) === 'available';
}

/**
 * その**置き場所**で元の音を選べるか（#512 段3b）＝素材に音が入っている置き場所。
 * ⚠️ 画面（欄を出すか）・編集（値を置けるか）が**同じ述語**を通る。
 */
export function placementAudioState(doc: TimelineProject, p: VideoPlacement): AudioState {
  return audioStateOfAsset(doc, p.assetId);
}

/**
 * その部品の**元の音の状態**（#512 段2・レビュー 🟡）。
 * ⚠️ **「音が無い」と「判らない」を分ける**＝取り込みのとき動画を調べられなかった素材（`metadata` 無し）に
 * 「音が入っていません」と断定すると**嘘の理由**になり、次の行動も誤る（実際は取り込み直し）。
 * 場面形式も同じ2文で出し分けている（`ClipDetailControls`＝ADR-0026②）。
 */
export function videoAudioState(doc: TimelineProject, clip: TimelineClip): AudioState | 'notVideo' {
  const assetId = videoAssetIdOfClip(clip, videoAssetIds(doc));
  if (assetId == null) return 'notVideo';
  return audioStateOfAsset(doc, assetId);
}

/** 素材に音が入っているか（`unknown`＝取り込みのときに調べられなかった）。 */
export type AudioState = 'available' | 'none' | 'unknown';

function audioStateOfAsset(doc: TimelineProject, assetId: string): AudioState {
  const hasAudio = doc.assets.find((a) => a.assetId === assetId)?.metadata?.hasAudio;
  if (hasAudio === true) return 'available';
  return hasAudio === false ? 'none' : 'unknown';
}

/** 速さの既定（未指定・0以下は等速）。⚠️ **焼き出しと再生が同じ値を見る**ための単一の参照元。 */
export function effectiveSpeed(clip: TimelineClip): number {
  return clip.speed != null && clip.speed > 0 ? clip.speed : 1;
}

/**
 * 切り抜きの**回す中心**が、書き出しとプレビューで食い違うか（#512 段1 レビュー 🔴）。
 *
 * 書き出しは切り抜きの矩形を**矩形自身の中心**で回す（`sceneSvg.wrapClipRect`）が、CSS の `clip-path` は
 * 要素と一緒に**要素の中心**で回る。左右非対称に切り抜いた部品を回すと**別の窓**になる（実測で百数十 px）。
 * 直せるまでは実映像を出さない側へ倒す（`11 §7.6.4` の「跨ぐときは分割を拒否」と同じ流儀）。
 */
export function cropPivotDiffers(
  rect: { x: number; y: number; w: number; h: number },
  crop: { x: number; y: number; w: number; h: number } | undefined,
  rotation: number | undefined,
): boolean {
  if (crop == null || !rotation) return false;
  const EPS = 1e-6;
  return (
    Math.abs(crop.x + crop.w / 2 - (rect.x + rect.w / 2)) > EPS ||
    Math.abs(crop.y + crop.h / 2 - (rect.y + rect.h / 2)) > EPS
  );
}

/**
 * その部品のコマを焼き出す仕様（#512 段1）。
 *
 * ⚠️ **置いた長さぶんの素材**を焼く＝速さが掛かっているぶんだけ素材を多く使う
 * （`11 §7.6.3.2`＝置いた長さは速さで変わらない）。トリム（`sourceStartSec`）から始める。
 */
export function videoStagePlan(
  p: VideoPlacement,
): { sourceStartSec: number; durationSec: number; speed: number } {
  const speed = p.speed;
  return {
    sourceStartSec: p.sourceStartSec,
    durationSec: p.durationSec,
    speed,
  };
}

/**
 * 出力フレーム `f` で、その部品が出すコマの番号（`null`＝その時刻には映っていない）。
 *
 * ⚠️ **焼けた枚数で頭打ちにする**（`stagedCount`）＝素材が置いた長さより短いときに
 * **無い番号を読みに行かない**（場面形式の `min(f, count-1)` と同じ・#442）。最後のコマで止まる。
 */
export function videoFrameIndexAt(
  p: VideoPlacement,
  frameIndex: number,
  fps: number,
  stagedCount: number,
): number | null {
  if (stagedCount <= 0) return null;
  const local = stagedFrameIndexAt(p, frameIndex, fps);
  if (local == null) return null;
  return Math.min(stagedCount - 1, local);
}

/**
 * その出力フレームが、その部品の**何コマ目**か（`null`＝映っていない）。
 * ⚠️ **プレビューと書き出しはここだけを見る**（#512 段1 レビュー 🔴）＝別々に時刻を出すとずれる。
 */
function stagedFrameIndexAt(p: VideoPlacement, frameIndex: number, fps: number): number | null {
  const t = frameIndex / fps;
  // 生きている区間は半開（`11 §7.6.4`＝終わりの瞬間はもう映らない）＝描く側と同じ規則。
  // ⚠️ **区間は部品の尺**（隠れる・隠れないは部品の置き場所で決まる）＝素材が尽きても枠は出たまま。
  if (t < p.clip.startSec || t >= p.clip.startSec + p.clip.durationSec) return null;
  // ⚠️ **コマ数の引き算で出す**（秒へ直して掛け戻さない）＝掛け算の誤差で1つ手前へ落ちない
  // （`11 §7.6.5` の「格子点をもう一度量子化しない」と同じ理由）。
  // ⚠️ **トリムと速さはここで掛けない**＝焼いたコマ自体が織り込み済み（`stage_clip_frames` が
  // `sourceStartSec` から `setpts=PTS/speed` で並べる）。二重に掛けると倍速が二乗になる。
  const local = frameIndex - Math.round(p.clip.startSec * fps);
  if (local < 0) return null;
  // ⚠️ **使える長さで頭打ちにする**（レビュー 🔴）＝差し込み口の「ここまで」（`endSec`）で焼く長さが
  // 部品の尺より短いとき、書き出しは焼けた枚数で最後のコマに凍る。ここで同じだけ止めないと
  // **プレビューだけが素材の先へ進む**（`endSec` を越えた絵が見える＝preview≠export・ADR-0001）。
  // 上限は書き出しが焼く枚数と同じ数え方（Rust は `ceil(尺×fps)+1` 枚＝最後の番号は `ceil(尺×fps)`）。
  return Math.min(local, Math.ceil(p.durationSec * fps));
}

/**
 * その時刻に、その置き場所が**最後のコマで凍っているか**（#512 段3b レビュー 🟡）。
 *
 * 差し込み口の「ここまで」（`endSec`）で使える長さが部品の尺より短いとき、書き出しは焼けた枚数で
 * 最後のコマに凍る。プレビューは素材の秒（`videoSourceSecAt`）が一定になるだけなので、
 * **`video` 要素は自分で先へ流れ続ける**（絵も音も「ここまで」を越える）。ここが真の間は流すのをやめる。
 */
export function videoHoldsLastFrameAt(p: VideoPlacement, timeSec: number): boolean {
  return timeSec - p.clip.startSec >= p.durationSec;
}

/**
 * その時刻に映すべき**素材の中の秒**（`null`＝映っていない・#512 段1）。
 * プレビューはこれを `video.currentTime` に入れる。
 *
 * ⚠️ **書き出しと同じコマ番号から導く**＝別々の式で出すと、置いた位置が格子（1/fps）に乗っていないとき
 * プレビューと書き出しで**別のコマ**になる（実測で最大1.5コマ×速さのずれ）。ここで
 * 「何コマ目か」を先に決め、そのコマが指す素材の秒へ直す（トリム＋速さはこの1回だけ掛ける）。
 */
export function videoSourceSecAt(p: VideoPlacement, timeSec: number, fps: number): number | null {
  const local = stagedFrameIndexAt(p, Math.round(timeSec * fps), fps);
  if (local == null) return null;
  return p.sourceStartSec + (local / fps) * p.speed;
}

/**
 * その部品の**合成の単位**が、ほかの部品にも跨っているか（#512 段1・`11 §7.6.4`）。
 *
 * ⚠️ **跨っているときは実映像を出さない**＝プレビューは帯（zIndex）で層に割って `video` を挟むので、
 * 層ごとに薄さを掛けることになり、**重なった所で下が透ける**（書き出しは1枚にしてから掛ける＝決定19）。
 * 正典は「per-frame の全描画へ倒すか、**跨ぐときは分割を拒否して理由を返すこと**」としているので、
 * 断る側に倒し、画面が理由を出す。
 */
export function compositeSpansOthers(
  items: readonly { id: string; composite?: { key: string; opacity: number } }[],
  itemId: string,
): boolean {
  const key = items.find((it) => it.id === itemId)?.composite?.key;
  if (key == null) return false;
  return items.some((it) => it.id !== itemId && it.composite?.key === key);
}
