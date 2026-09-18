// 書き出しを**区間に割る**（ADR-0032 決定22 の再検討・#1203）。**純粋関数**。
//
// ⚠️ **なぜ要るか**＝いまのタイムラインの書き出しは**全コマを1枚ずつ焼く**（決定22）。
// 実測で **10分の動画に 75.7 分・約15GB**（#1194）。同じ100カットを FFmpeg に直接やらせると **80 秒**
// ＝**57倍**。決定22 は**再検討の条件を自分で書いて**いた：
//
// > 実測で許容できない遅さになったとき。そのときは「重なりもアニメも速度変更も無いクリップだけの区間」を
// > 静止1枚へ倒す形を、**パリティの検査を足したうえで**入れる。
//
// ⚠️ **新しい書き出し経路は作らない**（ADR-0007）＝場面形式が使っている
// 「静止PNG（下）→ 実動画 → 静止PNG（上）」の道（`ExportSceneInput.video`）へ渡すだけ。
//
// ⚠️ **条件は狭く始める**＝決定22 の理由①（帯分割が合成の単位を跨ぐ）を避けるため、
// **その区間に生きている絵の部品が「動画1つだけ」**のときしか倒さない。
// 広げるときは**パリティの検査を足してから**（各条件が1つずつ検査を持つ形にしてある）。

import { TIMELINE_CLIP_KIND } from '../enums';
import { creditVisibleAt } from '../voice/creditDisplay';
import { timelineFramePlan } from './export';
import { isDrawnClip, videoPlacementsOf } from './video';
import type { Template } from '../template/types';
import type { TimelineClip, TimelineProject } from './types';

/** 区間の割り方（`video`＝実動画をそのまま流す／`frames`＝いままでどおり全コマ焼く）。 */
export type TimelineExportSegment =
  | { kind: 'frames'; startSec: number; endSec: number }
  | { kind: 'video'; startSec: number; endSec: number; clipId: string };

/** その部品を「そのまま流せる動画」と見てよいか（絵に効く細工が1つでもあれば false）。 */
export function clipIsPassThroughVideo(
  clip: TimelineClip,
  hasAnimation: (clipId: string) => boolean,
): boolean {
  if (clip.kind !== TIMELINE_CLIP_KIND.slot) return false;
  if (!clip.assetId) return false;
  // ⚠️ **動きがあると倒せない**＝重ねるのは FFmpeg なので、位置も大きさも区間の間ずっと同じでなければならない。
  if (hasAnimation(clip.id)) return false;
  if (clip.rotation != null && clip.rotation !== 0) return false;
  // ⚠️ **薄くできない**＝`overlay` は不透明で重ねる（薄さは SVG 側の話）。
  if (clip.opacity != null && clip.opacity !== 1) return false;
  if ((clip.fadeInSec ?? 0) !== 0 || (clip.fadeOutSec ?? 0) !== 0) return false;
  // ⚠️ **切り抜きは倒せない**＝`overlay` に渡せるのは矩形と収め方だけ。
  if (clip.crop && Object.values(clip.crop).some((v) => (v ?? 0) !== 0)) return false;
  if (clip.cropMode != null) return false;
  if (clip.cropAlign != null) return false;
  // ⚠️ **色の調整・描画モードは SVG で描く**（ADR-0044）＝FFmpeg が重ねる所では効かない。
  if (clip.colorAdjust != null) return false;
  if (clip.blendMode != null && clip.blendMode !== 'normal') return false;
  return true;
}

/**
 * その区間で**上に重ねても時間で変わらない**部品か（ADR-0032 決定22-2 の「次に緩めるなら」）。
 *
 * ⚠️ **区間の中では顔ぶれが変わらない**（境目は部品の出入りで割れている）ので、
 * 「時間で変わらない」＝**その区間ぶん1枚の静止画で足りる**ということ。
 * ⚠️ **動画は数えない**＝中身が毎コマ変わるので、静止画に写せない。
 * ⚠️ **混ぜ方（描画モード）が付いていたら外す**＝重ねるのは FFmpeg なので、**混ざり方が消える**
 * （色の調整は静止画へ焼き込まれるので構わない）。
 */
export function clipIsStaticOverlay(
  clip: TimelineClip,
  hasAnimation: (clipId: string) => boolean,
  isVideoClip: (clipId: string) => boolean,
): boolean {
  if (isVideoClip(clip.id)) return false;
  if (hasAnimation(clip.id)) return false;
  if ((clip.fadeInSec ?? 0) !== 0 || (clip.fadeOutSec ?? 0) !== 0) return false;
  if (clip.blendMode != null && clip.blendMode !== 'normal') return false;
  return true;
}

/** その時刻に生きているか（半開区間＝`clipIsLiveAt` と同じ規則）。 */
function liveAt(clip: TimelineClip, timeSec: number): boolean {
  return timeSec >= clip.startSec && timeSec < clip.startSec + clip.durationSec;
}

/**
 * 書き出しを区間に割る（#1203）。
 *
 * ⚠️ **境目はコマの格子に乗せる**＝乗せないと、区間をつないだ総コマ数が元と食い違う
 * （1コマ多い/少ない動画が出る）。
 * ⚠️ **クレジットが出ている間は倒さない**＝上に重ねる静止PNGは1枚なので、
 * 区間の途中でクレジットが出たり消えたりすると**別の絵**になる（ADR-0025）。
 */
export function planTimelineExportSegments(
  doc: TimelineProject,
  /** 見た目パターンの解決（中に動画の差し込み口があるかを見るのに要る）。 */
  templateOf?: (templateId: string) => Template | undefined,
): TimelineExportSegment[] {
  const plan = timelineFramePlan(doc);
  if (plan.frameCount <= 0) return [];
  const animated = new Set<string>();
  for (const a of doc.animations ?? []) if ((a.keyframes?.length ?? 0) > 0) animated.add(a.targetId);
  // ⚠️ **グループも見る**＝グループにキーフレームが付いていれば、中の部品も動く。
  for (const g of doc.groups ?? []) {
    if (!animated.has(g.id)) continue;
    for (const m of g.members ?? []) animated.add(m);
  }
  const hasAnimation = (clipId: string): boolean => animated.has(clipId);

  // **動画を映す部品**（直接置いた動画と、見た目パターンの中の差し込み口の両方）＝
  // ⚠️ **判定は共有の関数を通す**（`videoPlacementsOf`）＝ここで書き写すと、
  // 「動画なのに静止画として扱う」取りこぼしが出る。
  const videoClipIds = new Set(videoPlacementsOf(doc, templateOf).map((p) => p.clip.id));
  const isVideoClip = (clipId: string): boolean => videoClipIds.has(clipId);
  const visual = doc.clips.filter((c) => isDrawnClip(doc, c));
  // 区間の境目＝部品の出入り（コマの格子に丸める）。
  const cuts = new Set<number>([0, plan.frameCount]);
  const toFrame = (sec: number): number =>
    Math.max(0, Math.min(plan.frameCount, Math.round(sec * plan.fps)));
  for (const c of visual) {
    cuts.add(toFrame(c.startSec));
    cuts.add(toFrame(c.startSec + c.durationSec));
  }
  const bounds = [...cuts].sort((a, b) => a - b);

  const out: TimelineExportSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (to <= from) continue;
    const startSec = from / plan.fps;
    const endSec = to / plan.fps;
    // 区間の**真ん中**で見る＝端は半開区間の境目なので、出入りの判定がぶれる。
    const midSec = (startSec + endSec) / 2;
    const live = visual.filter((c) => liveAt(c, midSec));
    const creditShows =
      creditVisibleAt(doc.videoSettings.creditDisplay, plan.durationSec, startSec) ||
      creditVisibleAt(doc.videoSettings.creditDisplay, plan.durationSec, (startSec + endSec) / 2) ||
      creditVisibleAt(doc.videoSettings.creditDisplay, plan.durationSec, Math.max(startSec, endSec - 1 / plan.fps));
    // **土台になる動画**＝その区間で「そのまま流せる動画」は1つだけでなければならない。
    const bases = live.filter((c) => isVideoClip(c.id) && clipIsPassThroughVideo(c, hasAnimation));
    // ⚠️ **この「1つだけ」は、下の『残りが全部動かない上乗せ』と同じことを言っている**＝
    // 土台が2つあれば、2つ目は**動画なので上乗せにはなれない**（`clipIsStaticOverlay` が弾く）。
    // **早く落とすために残す**が、**これ単独を壊しても結果は変わらない**（変異が生き残るのはそのため）。
    const base = bases.length === 1 ? bases[0] : undefined;
    // ⚠️ **残りが全部「動かない上乗せ」なら倒せる**（決定22-2 の「次に緩めるなら」）＝
    // 上下に敷く静止画を1枚ずつ焼けば、**実況系のように字幕が出ていても**実動画を流せる。
    const restStatic = base != null
      && live.every((c) => c.id === base.id || clipIsStaticOverlay(c, hasAnimation, isVideoClip));
    if (base && restStatic && !creditShows) {
      out.push({ kind: 'video', startSec, endSec, clipId: base.id });
    } else {
      out.push({ kind: 'frames', startSec, endSec });
    }
  }
  // 続いている `frames` はまとめる（区間が細かいほど、つなぎ目が増えて無駄が出る）。
  const merged: TimelineExportSegment[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === 'frames' && s.kind === 'frames' && prev.endSec === s.startSec) {
      merged[merged.length - 1] = { kind: 'frames', startSec: prev.startSec, endSec: s.endSec };
      continue;
    }
    merged.push(s);
  }
  return merged;
}

/**
 * 倒せた割合（0〜1）＝どれだけ焼かずに済むか。**画面に出す数ではなく、記録と検査のための値**。
 */
export function passThroughRatio(segments: readonly TimelineExportSegment[]): number {
  const total = segments.reduce((a, s) => a + (s.endSec - s.startSec), 0);
  if (total <= 0) return 0;
  const passed = segments
    .filter((s) => s.kind === 'video')
    .reduce((a, s) => a + (s.endSec - s.startSec), 0);
  return passed / total;
}
