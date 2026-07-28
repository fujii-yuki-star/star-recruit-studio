// タイムライン形式（ADR-0032）の「その瞬間に鳴っている音」（#630 後半）。純粋関数（副作用なし・§7）。
//
// 絵と同じ考え方＝**並べ方だけをここで決め**、実際に鳴らすのは app（HTMLAudioElement）。
// **時刻から一意に決まる**ようにしてあるので、途中から再生してもシークしても同じ結果になる
// （「再生を始めた実時刻から測る」＝`playbackTick` と組み合わせて、絵と音がずれない）。
import { BGM_VOLUME, NARRATION_VOLUME } from '../constants';
import { TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { clampVolume } from '../voice/audioMix';
import { clipTimeAtSceneTime } from '../project/videoStartTiming';
import { clipEndSec } from './validateTimelineDoc';
import type { TimelineClip, TimelineProject } from './types';

/**
 * クリップの実効音量（`11 §6` の null=継承と同じ流儀）。
 * **読み上げ**＝`clip.volume` → 動画全体の声の音量（`voiceSettings.volume`）→ `NARRATION_VOLUME`。
 * **音（BGM・持ち込み）**＝`clip.volume` → `BGM_VOLUME`。
 *
 * 既定を 1.0 で決め打ちにすると、BGM 音量を明示していない文書（焼き出しは指定が無いと `volume` を
 * 書かない）が場面形式の **4倍**（0.25 → 1.0）で鳴る。値域のクランプも `clampVolume` を共有する。
 */
function baseVolume(clip: TimelineClip, doc: TimelineProject): number {
  if (clip.kind === TIMELINE_CLIP_KIND.voice) {
    return clampVolume(clip.volume ?? doc.voiceSettings.volume ?? NARRATION_VOLUME);
  }
  return clampVolume(clip.volume ?? BGM_VOLUME);
}

/** その瞬間に鳴らすべき音1つ分。`offsetSec` は**音源の先頭からの秒**（途中から鳴らすときの頭出し）。 */
export interface AudioCue {
  /** 鳴らす対象のクリップ id（app 側が音源の対応付けに使う）。 */
  clipId: string;
  /** 音源のどこから鳴らすか（秒）。 */
  offsetSec: number;
  /** 実効音量（0〜1.5）。フェードを織り込んだ値。 */
  volume: number;
  /** 再生速度（>0・既定 1）。頭出しだけでなく**鳴らす側の速度**にも効かせないとずれ続ける。 */
  speed: number;
}

/** 音のクリップか（絵は `layoutTimelineAt` が見る）。 */
function isAudioClip(clip: TimelineClip): boolean {
  return clip.kind === TIMELINE_CLIP_KIND.audio || clip.kind === TIMELINE_CLIP_KIND.voice;
}

/**
 * フェードを織り込んだ音量。
 *
 * **各フェードを尺の半分までに切り詰めてから掛ける**＝書き出しの BGM ミックス（`planBgmMix`）と同じ規則
 * （そちらも `playSec/2` にクランプしてから afade へ渡す）。規則を2つ持つと、同じデータで
 * プレビューと書き出しの音が違う（ADR-0001）。切り詰めるので両端が重ならず、二重に絞られない。
 */
function fadedVolume(clip: TimelineClip, doc: TimelineProject, localSec: number): number {
  const base = baseVolume(clip, doc);
  const dur = clip.durationSec;
  const half = dur / 2;
  const fadeIn = Math.min(Math.max(0, clip.fadeInSec ?? 0), half);
  const fadeOut = Math.min(Math.max(0, clip.fadeOutSec ?? 0), half);
  const inGain = fadeIn > 0 ? Math.min(1, localSec / fadeIn) : 1;
  const outGain = fadeOut > 0 ? Math.min(1, (dur - localSec) / fadeOut) : 1;
  return Math.max(0, base * inGain * outGain);
}

/**
 * 時刻 `timeSec` に鳴っている音の一覧（ADR-0032・#630）。純粋関数。
 *
 * - 区間は **`[startSec, startSec+durationSec)`**（絵の `clipIsLiveAt` と同じ半開＝V24 と揃える）。
 * - **隠した列の音は鳴らさない**（`track.hidden` は「描画・書き出しから除外＝音声は無音」・11 §7.6）。
 *   絵と同じ規則を音にも効かせる（見えないのに聞こえる、を作らない）。
 * - **頭出しは `clipTimeAtSceneTime` を共有**（`素材の開始 + 経過×速度`）＝場面形式の動画スロットと同じ式。
 *   速度は `speed` として返し、鳴らす側が `playbackRate` に入れる（入れないと頭出しだけ合ってずれ続ける）。
 * - **クリップを隠すと音も止まる**（絵と同じ扱い＝見えないのに聞こえる、を作らない）。
 * - 並びは `doc.clips` の順（決定的＝同じ時刻なら毎回同じ結果）。
 */
export function audioCuesAt(doc: TimelineProject, timeSec: number): AudioCue[] {
  const audible = new Set(
    doc.tracks.filter((t) => t.kind === TRACK_KIND.audio && !t.hidden).map((t) => t.id),
  );
  const cues: AudioCue[] = [];
  for (const clip of doc.clips) {
    if (!isAudioClip(clip) || clip.hidden || !audible.has(clip.trackId)) continue;
    if (timeSec < clip.startSec || timeSec >= clipEndSec(clip)) continue;
    const localSec = timeSec - clip.startSec;
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    cues.push({
      clipId: clip.id,
      // 場面形式の動画スロットと同じ式（開始遅延は無いので 0）。速度を掛けないと絵から線形にずれる。
      offsetSec: Math.max(0, clipTimeAtSceneTime(localSec, { startDelaySec: 0, clipStartSec: clip.sourceStartSec ?? 0, speed })),
      volume: fadedVolume(clip, doc, localSec),
      speed,
    });
  }
  return cues;
}

/**
 * 音源として読むべきものの一覧（クリップ id → 読み方）。**再生の前にまとめて用意する**ために使う
 * （鳴らす瞬間に読みに行くと頭が欠ける）。
 * - `voicePath`＝作成済みの読み上げ音声（プロジェクト相対）
 * - `bundledBgmId`＝同梱BGM
 * - `assetId`＝持ち込みの音（素材）
 */
export interface AudioSource {
  clipId: string;
  voicePath?: string;
  bundledBgmId?: string;
  assetId?: string;
}

export function audioSourcesOf(doc: TimelineProject): AudioSource[] {
  const out: AudioSource[] = [];
  for (const clip of doc.clips) {
    // **種別で分ける**（優先順で吸収しない）＝「音の出どころは高々1つ」（§8 V25）の語彙と一致させる。
    // 重ねて指定されたデータは V25 が警告するので、ここで黙って一方を選ばない。
    if (clip.kind === TIMELINE_CLIP_KIND.voice) {
      if (clip.voice?.voicePath) out.push({ clipId: clip.id, voicePath: clip.voice.voicePath });
    } else if (clip.kind === TIMELINE_CLIP_KIND.audio) {
      if (clip.bundledBgmId) out.push({ clipId: clip.id, bundledBgmId: clip.bundledBgmId });
      else if (clip.assetId) out.push({ clipId: clip.id, assetId: clip.assetId });
    }
  }
  return out;
}

/**
 * 音源を**中身で見分けるキー**（クリップ id ではない）。同じ曲を使う複数のクリップで音源を使い回し、
 * **セッション中に増えたクリップ**（複製など）でも読み直さずに鳴らせる＝黙って無音にならない。
 */
export function audioSourceKey(src: AudioSource): string {
  if (src.voicePath) return `voice:${src.voicePath}`;
  if (src.bundledBgmId) return `bgm:${src.bundledBgmId}`;
  return `asset:${src.assetId ?? ''}`;
}

/** クリップから音源キーを引く（鳴らす側が `audioSrcByKey` を引くのに使う）。 */
export function audioSourceKeyOfClip(clip: TimelineClip): string | null {
  if (clip.kind === TIMELINE_CLIP_KIND.voice) return clip.voice?.voicePath ? `voice:${clip.voice.voicePath}` : null;
  if (clip.kind !== TIMELINE_CLIP_KIND.audio) return null;
  if (clip.bundledBgmId) return `bgm:${clip.bundledBgmId}`;
  return clip.assetId ? `asset:${clip.assetId}` : null;
}

/** この音はループさせるか（BGM は素材が短くても鳴り続ける＝場面形式のプレビュー・書き出しと同じ）。 */
export function audioLoops(clip: TimelineClip): boolean {
  return clip.kind === TIMELINE_CLIP_KIND.audio;
}
