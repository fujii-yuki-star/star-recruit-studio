// タイムライン形式（ADR-0032）の書き出しの並べ方（#631）。純粋関数（副作用なし・§7 テスト対象）。
//
// **タイムラインの書き出しは常に全フレーム描画**（ADR-0032 決定22＝決定10「迷ったら全フレーム描画」の適用）。
// 場面形式のような「単純な区間は FFmpeg 合成」へは倒さない。理由は `11 §7.6.5`：
//   ① 帯分割（`videoSceneSplit`）は**合成の単位を跨いで切る**ので、クリップ全体の不透明度（決定19 の
//      前提＝1枚に合成してから α）が分割時だけ崩れる。
//   ② 判定条件（重なり・アニメ・速度・クロップの有無）を増やすほど、**プレビューと書き出しで別経路**が
//      増えてパリティ（ADR-0001）の検査点が増える。
// ここは「何フレーム描くか」と「音をどこへ置くか」だけを決め、描くのは renderer・混ぜるのは FFmpeg。
import { audioCuesAt, audioLoops, audioSourceKeyOfClip, clipBaseVolume, clipFadeSec, isAudioClip, normalizedVolumePoints, volumeExpr } from './audio';
import { FPS, VOLUME_POINTS_MAX } from '../constants';
import { ASSET_TYPE, TIMELINE_CLIP_KIND } from '../enums';
import { bgmById } from '../bgm/bgmCatalog';
import { danglingSubtitleLinks } from './subtitleLink';
import { fileExtension } from '../asset/assetFile';
import { timelineDurationSec } from './persistence';
import { effectiveFps } from './playback';
import { clipEndSec } from './validateTimelineDoc';
import type { TimelineClip, TimelineProject } from './types';

/** 書き出す絵の計画（全フレーム描画）。 */
export interface TimelineFramePlan {
  fps: number;
  /** 総フレーム数（0 なら描くものが無い＝書き出せない）。 */
  frameCount: number;
  /** 出力の尺（秒）。フレーム数から導く＝映像と音の長さが一致する。 */
  durationSec: number;
}

/**
 * 何フレーム描くかを決める。**尺はフレーム数から導く**（`frameCount / fps`）＝端数の尺でも
 * 映像と音の長さが食い違わない。
 *
 * 端数は**切り上げ**（`ceil`）＝置いたものが末尾で切れない。四捨五入だと下へ丸まる尺
 * （例 5.505 秒 → 165 フレーム＝5.5 秒）で末尾が黙って落ちる（読み上げの語尾が切れる）。
 * 切り上げても最後のフレームの時刻は必ず尺の中（`ceil(x) - 1 < x`）＝空白のフレームは増えない。
 */
export function timelineFramePlan(doc: TimelineProject): TimelineFramePlan {
  const fps = effectiveFps(doc);
  const total = timelineDurationSec(doc);
  // 尺 0（何も置いていない）は 0 フレーム＝呼び出し側が「書き出せない」と止める。
  const frameCount = total > 0 ? Math.max(1, Math.ceil(total * fps)) : 0;
  return { fps, frameCount, durationSec: frameCount / fps };
}

/**
 * n 番目のフレームを描く時刻（秒）。**プレビューと同じ格子**（`quantizeToFrameSec` が返す `k/fps`）に
 * 乗る＝再生で見た絵と書き出したフレームが一致する（ADR-0001）。
 *
 * ここで `quantizeToFrameSec` を**通さない**。格子点をもう一度量子化すると、掛け算の誤差で1つ前の
 * フレームへ落ちることがある（fps=30 の 123 番＝`123/30*30 = 122.99999999999999` → 122 番の時刻）。
 * そうなると同じ絵を2枚焼き、その時刻に始まるクリップが書き出しでだけ1フレーム遅れる。
 */
export function frameTimeAt(index: number, fps: number): number {
  return index / (fps > 0 ? fps : FPS);
}

/**
 * 書き出しで置く音1本ぶん（FFmpeg の「配置＋切り出し＋音量＋フェード＋ミックス」に対応）。
 * 場面形式の BGM 区間（`BgmRunInput`）と**同じ形**＝混ぜる側を作り直さない。
 *
 * **動画クリップの元音声はここに出ない**（`kind:'slot'` は音源を持たない）。持ち込んだ動画の音は
 * まだ鳴らせない＝黙って混ぜずに落とさないよう、書き出しの手前で断る（`11 §7.6.5`・#631 後続）。
 */
export interface TimelineAudioRun {
  /** どのクリップの音か（音源の解決に使う）。 */
  clipId: string;
  /** 音源を見分けるキー（`audioSourceKey` と同じ規則）。 */
  sourceKey: string;
  /**
   * 音源ファイルの拡張子（`mp3` など・小文字）。FFmpeg が一時ファイルの形式を判定するのに要る。
   * **音源キーからは復元できない**（同梱BGMの id やクリップの保存先は拡張子を持たない）ので、
   * 誰が読んでも同じ値になるようここで解決しておく＝呼ぶ側で当て推量しない。
   */
  fileExt: string;
  /** 出力の先頭から何秒の位置に置くか。 */
  delaySec: number;
  /** どれだけ鳴らすか（秒）。 */
  playSec: number;
  /** 音源のどこから使うか（秒）。 */
  sourceStartSec: number;
  /** 再生速度（>0）。 */
  speed: number;
  /**
   * 実効音量（0〜1.5・継承解決済み）。**`volumeExpr` があるときはそちらが基準**＝この値は使われない
   * （点が無いクリップだけがここへ落ちる＝再生の `volumeAt(points) ?? clipBaseVolume` と同じ分かれ方）。
   */
  volume: number;
  /**
   * **音量の変化**（#512）を FFmpeg の `volume` フィルタの式にしたもの（`volumeExpr`）。点が無ければ
   * 未指定＝従来どおり `volume` の一定値で出る。**再生と同じ点列・同じ規則**から組む（ADR-0032 追補＝案A）。
   */
  volumeExpr?: string;
  fadeInSec: number;
  fadeOutSec: number;
  /**
   * 素材が短いとき繰り返すか。**BGM だけ true**（読み上げを繰り返すと言葉が二重に鳴る）。
   * 場面形式の BGM 混合は常にループする実装なので、**この区別を渡さないと読み上げが繰り返される**。
   */
  loop: boolean;
}

/**
 * 音の並べ方を決める（#631）。**再生（`audioCuesAt`）と同じ値を使う**＝聞いた音と書き出した音が一致する。
 *
 * **音量の変化（`volumePoints`・#512）も渡す**（段3）＝再生と**同じ点列**から `volumeExpr` で式を組み、
 * FFmpeg 側は受け取った式を `volume` フィルタへ差し込むだけ（ADR-0032 追補＝案A）。式を Rust で組み直すと
 * 規則が2か所になるので、**組むのはここ（純粋関数）だけ**にしてずれを「式の書き方」に閉じ込める。
 *
 * 音量とフェードは**再生と同じ関数**（`clipBaseVolume` / `clipFadeSec`）から採る。フェードは FFmpeg 側で
 * `afade` として掛けるので、ここでは**素の音量**と**フェードの秒数（切り詰め済み）**を渡す
 * ＝フェード込みの値から割り戻すような当て推量をしない。
 */
export function timelineAudioRuns(doc: TimelineProject): TimelineAudioRun[] {
  const runs: TimelineAudioRun[] = [];
  for (const clip of doc.clips) {
    const sourceKey = audioSourceKeyOfClip(clip);
    if (!sourceKey) continue; // 音源が無い（読み上げ未作成など）＝置くものが無い
    // 鳴るかどうかの判定（隠した列・隠したクリップ）は再生と同じ関数に委ねる＝規則を2か所に書かない。
    // クリップの真ん中の時刻で見る（区間の端は半開なので、0秒に近いクリップでも必ず入る）。
    const midSec = clip.startSec + clip.durationSec / 2;
    const cue = audioCuesAt(doc, midSec).find((c) => c.clipId === clip.id);
    if (!cue) continue;
    // 点が無ければキーごと落とす（`undefined` を持たせない）＝渡す側・受ける側とも「未指定＝一定値」で揃う。
    const expr = volumeExpr(clip.volumePoints);
    runs.push({
      clipId: clip.id,
      sourceKey,
      fileExt: audioFileExtOf(clip, doc),
      delaySec: clip.startSec,
      playSec: clipEndSec(clip) - clip.startSec,
      sourceStartSec: clip.sourceStartSec ?? 0,
      speed: cue.speed,
      volume: clipBaseVolume(clip, doc),
      ...(expr ? { volumeExpr: expr } : {}),
      ...clipFadeSec(clip),
      loop: audioLoops(clip),
    });
  }
  return runs;
}

/**
 * その音源ファイルの拡張子（小文字）。同梱BGMは目録から、持ち込みは素材の保存先から、読み上げは
 * 音声の保存先から採る＝**実際のファイルに合わせる**（決め打ちにしない）。判らないときだけ `mp3`
 * （FFmpeg は中身でも判定できるので、拡張子は手がかりに過ぎない）。
 */
function audioFileExtOf(clip: TimelineClip, doc: TimelineProject): string {
  if (clip.kind === TIMELINE_CLIP_KIND.voice) return extOf(clip.voice?.voicePath);
  if (clip.bundledBgmId) return extOf(bgmById(clip.bundledBgmId)?.fileName);
  return extOf(doc.assets.find((a) => a.assetId === clip.assetId)?.filePath);
}

function extOf(path: string | null | undefined): string {
  // 拡張子の切り出しは既に domain に1つある（`fileExtension`）＝同じ規則を書き直さない（§6）。
  return (path ? fileExtension(path) : '') || DEFAULT_AUDIO_FILE_EXT;
}

/** 拡張子が判らないときの既定。 */
const DEFAULT_AUDIO_FILE_EXT = 'mp3';

/** 書き出しを止める理由（`15 §6` の `TIMELINE_EXPORT_*` と対）。 */
export const TIMELINE_EXPORT_BLOCK = {
  /** 動画に出るものが1つも無い（尺 0）。 */
  empty: 'TIMELINE_EXPORT_EMPTY',
  /** 動画の素材を置いている＝いまは静止画になり音も鳴らないので、書き出さずに断る。 */
  videoAsset: 'TIMELINE_EXPORT_VIDEO_ASSET_UNSUPPORTED',
  /** 見た目パターンが見つからない部品がある＝そこが丸ごと絵から消えるので、書き出さずに断る。 */
  templateUnresolved: 'TIMELINE_EXPORT_TEMPLATE_UNRESOLVED',
  /** 連動先が見つからない字幕で、自分の文も無い＝**何も出ない**ので、書き出さずに断る（#633）。 */
  subtitleLinkBroken: 'TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN',
  /** 音量の変化の点が多すぎる＝FFmpeg が式を解析できない（#512）ので、書き出さずに断る。 */
  volumePointsTooMany: 'TIMELINE_EXPORT_VOLUME_POINTS_TOO_MANY',
} as const;

export type TimelineExportBlockCode = (typeof TIMELINE_EXPORT_BLOCK)[keyof typeof TIMELINE_EXPORT_BLOCK];

export interface TimelineExportCheckOptions {
  /**
   * いま読み込めている見た目パターンの id。**渡さないと見た目の未解決は見ない**（判定材料が無いのに
   * 「見つからない」と断らない＝読み込み前の一瞬で嘘の理由を出さないため）。
   */
  knownTemplateIds?: ReadonlySet<string>;
}

export interface TimelineExportBlocker {
  code: TimelineExportBlockCode;
  /** どの部品のことか（画面で示す）。理由によっては空。 */
  clipIds: string[];
}

/**
 * 書き出す前に止める理由を返す（空なら書き出せる）。**§2-5**＝画面はここから「次の行動」を出す。
 *
 * **動画の素材は、まだ動かせず音も鳴らせない**（`layoutTimelineAt` は1枚の絵として描き、
 * `timelineAudioRuns` は元音声を返さない）。黙って静止画＋無音の動画を成功として出さないため、
 * 置いてあるだけで書き出しを止める（ADR-0026④・場面形式の `videoSlotUnplaceable` と同じ流儀）。
 */
export function timelineExportBlockers(doc: TimelineProject, opts: TimelineExportCheckOptions = {}): TimelineExportBlocker[] {
  const blockers: TimelineExportBlocker[] = [];
  if (timelineFramePlan(doc).frameCount <= 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.empty, clipIds: [] });
  }
  // 見た目が解決できないクリップは描かれない（`layoutTimelineAt`）＝置いたものが丸ごと絵から消える。
  // 警告だけで通すと、作り込みが化けた動画を成功として出すことになる（ADR-0026④・場面形式と同じ扱い）。
  if (opts.knownTemplateIds) {
    const unresolved = doc.clips
      .filter((c) => c.templateId != null && !opts.knownTemplateIds?.has(c.templateId))
      .map((c) => c.id);
    if (unresolved.length > 0) {
      blockers.push({ code: TIMELINE_EXPORT_BLOCK.templateUnresolved, clipIds: unresolved });
    }
  }
  // 連動先が見つからない字幕は、自分の文があればそれで描かれる。**文も無いものは何も出ない**＝
  // 置いたはずの字幕が消えた動画を成功として出さない（`11 §8` V29 の警告より一段強い＝ADR-0026④）。
  const brokenSubtitles = danglingSubtitleLinks(doc).filter((c) => !c.text).map((c) => c.id);
  if (brokenSubtitles.length > 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.subtitleLinkBroken, clipIds: brokenSubtitles });
  }
  // 音量の変化（#512）は点の数だけ式の項が増え、**点 95 個までは通り 96 個で FFmpeg が式を解析できなくなる**（実測）。
  // そのまま渡すとフィルタの組み立てごと失敗し、出せるのは「もう一度お試しください」＝**何度やっても
  // 成功しない案内**になる。押す前にここで断る（§2-5・#631 の流儀）。数えるのは**正規化した後**＝
  // 同じ時刻の重複は式に出ないので、それで上限に当てない。
  // 見るのは**鳴る音を持つ部品だけ**（`isAudioClip`＝再生・編集と同じ述語）。絵の部品に点が入っていても
  // 式は組まれない（`timelineAudioRuns` に出ない）ので、数えると**書き出せるものを断る**ことになる。
  const tooManyPoints = doc.clips
    .filter((c) => isAudioClip(c) && normalizedVolumePoints(c.volumePoints).length > VOLUME_POINTS_MAX)
    .map((c) => c.id);
  if (tooManyPoints.length > 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.volumePointsTooMany, clipIds: tooManyPoints });
  }
  const videoAssetIds = new Set(doc.assets.filter((a) => a.assetType === ASSET_TYPE.video).map((a) => a.assetId));
  if (videoAssetIds.size > 0) {
    const clipIds = doc.clips.filter((clip) => clipUsesAsset(clip, videoAssetIds)).map((clip) => clip.id);
    if (clipIds.length > 0) blockers.push({ code: TIMELINE_EXPORT_BLOCK.videoAsset, clipIds });
  }
  return blockers;
}

/** そのクリップが対象の素材を使っているか（直接置いた素材・枠の差し込み口・立ち絵のいずれか）。 */
function clipUsesAsset(clip: TimelineClip, assetIds: ReadonlySet<string>): boolean {
  if (clip.assetId && assetIds.has(clip.assetId)) return true;
  if (clip.character?.poseAssetId && assetIds.has(clip.character.poseAssetId)) return true;
  return Object.values(clip.assetRefs ?? {}).some((id) => typeof id === 'string' && assetIds.has(id));
}

