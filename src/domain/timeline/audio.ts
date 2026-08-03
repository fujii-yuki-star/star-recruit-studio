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
import type { TimelineClip, TimelineProject, VolumePoint } from './types';

/**
 * クリップの**フェードを掛ける前**の実効音量（`11 §6` の null=継承と同じ流儀）。
 * 再生（`audioCuesAt`）と書き出し（`timelineAudioRuns`）が**同じ解決**を通るように export する
 * ＝書き出し側で「フェード込みの値から割り戻す」ような当て推量をしない。
 * **読み上げ**＝`clip.volume` → 動画全体の声の音量（`voiceSettings.volume`）→ `NARRATION_VOLUME`。
 * **音（BGM・持ち込み）**＝`clip.volume` → `BGM_VOLUME`。
 *
 * 既定を 1.0 で決め打ちにすると、BGM 音量を明示していない文書（焼き出しは指定が無いと `volume` を
 * 書かない）が場面形式の **4倍**（0.25 → 1.0）で鳴る。値域のクランプも `clampVolume` を共有する。
 */
export function clipBaseVolume(clip: TimelineClip, doc: TimelineProject): number {
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

/**
 * 音のクリップか（絵は `layoutTimelineAt` が見る）＝**鳴る音を持つ部品**の唯一の判定（§6）。
 * 再生・書き出し・編集（音量の変化を置けるか）・画面（パネルを出すか）が**同じ述語**を通す＝
 * 種別が増えたときに「置けるのにパネルが出ない」「出るのに断られる」が起きない。
 */
export function isAudioClip(clip: TimelineClip): boolean {
  return clip.kind === TIMELINE_CLIP_KIND.audio || clip.kind === TIMELINE_CLIP_KIND.voice;
}

/**
 * フェードの秒数（**各端を尺の半分までに切り詰める**）＝書き出しの BGM ミックス（`planBgmMix`）と同じ規則
 * （そちらも `playSec/2` にクランプしてから afade へ渡す）。規則を2つ持つと、同じデータで
 * プレビューと書き出しの音が違う（ADR-0001）。**再生と書き出しでこの関数を共有する。**
 */
export function clipFadeSec(clip: TimelineClip): { fadeInSec: number; fadeOutSec: number } {
  const half = clip.durationSec / 2;
  return {
    fadeInSec: Math.min(Math.max(0, clip.fadeInSec ?? 0), half),
    fadeOutSec: Math.min(Math.max(0, clip.fadeOutSec ?? 0), half),
  };
}

/**
 * **音量の変化**（#512）の点列を、読む前に整える。**再生（`volumeAt`）と書き出し（`volumeExpr`）が
 * この1つを共有する**＝並び・重複・値域の扱いで両者が食い違わない（ADR-0032 追補＝案A の「同じ点列・
 * 同じ規則」を、規則の側でも1か所にする）。
 *
 * - **保存の並びに依存しない**（時刻→音量の順に並べる＝**中身だけで結果が決まる**）。
 * - **同じ時刻は1つだけ**（編集層も1つしか置かせない＝キーフレームと同じ規則・`11 §7.6.3.1`）。
 *   落とさないと、時刻ちょうどの値を再生は手前の点・式は次の点から採り、**同じデータで音が違う**。
 * - **値域は入口で収める**（`clampVolume`）。補間してから収めるか、収めてから補間するかで**中間の値が
 *   変わる**ので、両者が同じ側に立つようにする（両端が範囲内なら線形補間の途中も範囲内）。
 */
export function normalizedVolumePoints(points: readonly VolumePoint[] | undefined): VolumePoint[] {
  if (!points || points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec || a.volume - b.volume);
  const out: VolumePoint[] = [];
  for (const p of sorted) {
    if (out.length > 0 && out[out.length - 1].timeSec === p.timeSec) continue;
    out.push({ timeSec: p.timeSec, volume: clampVolume(p.volume) });
  }
  return out;
}

/**
 * **音量の変化**（#512）＝点列を線形に補間する。点の外は端の値で伸ばす（最初の点より前＝最初の値・
 * 最後の点より後＝最後の値）＝区間外で黙って 0 や 1 に化けない。点が無ければ `undefined`＝
 * 呼び出し側がクリップ一定の音量へ落ちる。**書き出しは同じ点列から `volumeExpr` で式を組む**
 * ＝規則（線形・端で伸ばす・並びに依存しない）はこの関数と式の**両方が同じ正規化**から出る
 * （ADR-0032 追補＝案A）。
 */
export function volumeAt(points: readonly VolumePoint[] | undefined, localSec: number): number | undefined {
  const pts = normalizedVolumePoints(points);
  if (pts.length === 0) return undefined;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (localSec <= first.timeSec) return first.volume;
  if (localSec >= last.timeSec) return last.volume;
  for (let i = 1; i < pts.length; i += 1) {
    const b = pts[i];
    if (localSec < b.timeSec) {
      const a = pts[i - 1];
      // 同じ時刻は正規化で落ちているので、ここの間隔は必ず正（0 で割らない）。
      return a.volume + (b.volume - a.volume) * ((localSec - a.timeSec) / (b.timeSec - a.timeSec));
    }
  }
  return last.volume;
}

function fadedVolume(clip: TimelineClip, doc: TimelineProject, localSec: number): number {
  // 基準は「音量の変化」があればそちら（#512）＝フェードはその上に掛ける（形は変えない）。
  const base = volumeAt(clip.volumePoints, localSec) ?? clipBaseVolume(clip, doc);
  const { fadeInSec, fadeOutSec } = clipFadeSec(clip);
  const inGain = fadeInSec > 0 ? Math.min(1, localSec / fadeInSec) : 1;
  const outGain = fadeOutSec > 0 ? Math.min(1, (clip.durationSec - localSec) / fadeOutSec) : 1;
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

/**
 * 音量の変化（#512）を **FFmpeg の `volume` フィルタの式**にする（ADR-0032 追補＝案A）。
 *
 * **`volumeAt` と同じ正規化・同じ規則**（点の間は線形・点の外は端の値で伸ばす）を式にしただけ＝
 * ずれうるとしたら「式の書き方」だけに閉じ込める。時刻 `t` はフィルタ入力の秒（クリップの先頭が 0）。
 * 点が無ければ `undefined`＝呼び出し側が従来どおり一定値の `volume=<数>` を使う。
 *
 * **形は「区間ごとの項の足し算」**（`if()` の入れ子ではない）。入れ子にすると点1つにつき括弧が1段深くなり、
 * **同梱 ffmpeg では点 100 個で式の解析が落ちる**（98 個は通る＝実測 2026-08-03）。落ちるとフィルタの
 * 組み立てごと失敗し、利用者には「もう一度お試しください」＝**何度やっても成功しない案内**しか出せない
 * （§2-5・ADR-0026④）。足し算は深さが増えないので、点をいくつ置いても同じ形で通る。
 *
 * 各時刻でちょうど1つの項だけが 1 倍になり、残りは 0 倍で消える（区間は**半開** `gte`〜`lt`＝
 * 境界の時刻を2つの項が取り合わない）。同じ時刻の重複は正規化で落ちているので、区間の幅は必ず正。
 *
 * ⚠️ **点の数には上限がある**（`VOLUME_POINTS_MAX`）。足し算にしても解析の上限は消えない（実測＝**点 95 個までは
 * 通り 96 個で失敗**）ので、
 * ここでは切り詰めず、**`timelineExportBlockers` が書き出しの手前で断る**（黙って一部の点を捨てた音を
 * 出さない＝ADR-0026④）。
 */
export function volumeExpr(points: readonly VolumePoint[] | undefined): string | undefined {
  const pts = normalizedVolumePoints(points);
  if (pts.length === 0) return undefined;
  const first = pts[0];
  const last = pts[pts.length - 1];
  // 先頭（最初の点より前）・末尾（最後の点より後）は端の値で伸ばす＝`volumeAt` と同じ。
  const terms: string[] = [`lt(t,${num(first.timeSec)})*${num(first.volume)}`];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    terms.push(
      `gte(t,${num(a.timeSec)})*lt(t,${num(b.timeSec)})*(${num(a.volume)}+(${num(b.volume)}-${num(a.volume)})*(t-${num(a.timeSec)})/${num(b.timeSec - a.timeSec)})`,
    );
  }
  terms.push(`gte(t,${num(last.timeSec)})*${num(last.volume)}`);
  return terms.join('+');
}

/**
 * 式へ書く数（**短い10進**）。`0.3-0.1` のような引き算で出る `0.19999999999999998` をそのまま書くと
 * 式の長さが倍近くになり、**渡せるコマンドラインの長さ**（Windows で約32000文字・音の本数ぶん積み上がる）に
 * 早く当たる。12桁で丸める＝秒にも音量にも**聞き分けられない差**（1e-12）しか動かない。
 */
function num(x: number): string {
  return String(Number(x.toPrecision(12)));
}
