// タイムライン形式の動画を、別の縦横比の版として写す（ADR-0057・#1386）。**純粋関数**＝元の文書は変えない。
//
// ⚠️ **決まった規則で写す**（AI は使わない＝同じ入力は同じ結果）。規則は部品の種類で分ける（ADR-0057 決定1〜5）：
//   見た目パターン＝同じ種類の別の向きへ／画面いっぱい＝画面いっぱい／字幕＝相対の位置と幅（文字の大きさは保つ）／
//   その他＝旧画面を新画面に収まるように縮めて中央へ（中身も同じ倍率）。
// ⚠️ **決めきれない所は数を返す**（呼ぶ側が知らせる＝黙って別の結果にしない・ADR-0026④）。
import { dimsForOrientation } from '../constants';
import { FREE_ELEMENT_KIND, ORIENTATION, TIMELINE_CLIP_KIND, type Orientation } from '../enums';
import { scaleBakedContent } from '../project/groupOps';
import { textKeyOfLayer } from '../template/layerOps';
import type { Template } from '../template/types';
import { canHaveBox, resolveClipBox } from './box';
import type { TimelineClip, TimelineProject } from './types';

/** 「画面いっぱい」とみなす誤差（px）。 */
const FULL_TOLERANCE_PX = 1;

export interface ReorientResult {
  doc: TimelineProject;
  /** 新しい向きに同じ種類の見た目パターンが無く、そのまま残した部品の数。 */
  templateUnmatched: number;
  /** 新しい見た目パターンに同じ名前の層が無く、入れていた素材・文字が出なくなった数（文書には残す）。 */
  layersUnmatched: number;
  /** 写した後に画面の外へはみ出した部品の数（確かめてもらう）。 */
  outside: number;
}

/** 部品ごとの写し方（キーフレームの x/y のずれに掛ける倍率も決まる）。 */
type Mapping = { fx: number; fy: number };

export function reorientTimelineDoc(doc: TimelineProject, target: Orientation, templates: readonly Template[]): ReorientResult {
  const from = dimsForOrientation(doc.videoSettings.aspectRatio);
  const to = dimsForOrientation(target);
  const s = Math.min(to.width / from.width, to.height / from.height);
  const mappingOf = new Map<string, Mapping>();
  let templateUnmatched = 0;
  let layersUnmatched = 0;

  const clips = doc.clips.map((clip): TimelineClip => {
    if (clip.kind === TIMELINE_CLIP_KIND.template) {
      const tpl = templates.find((t) => t.templateId === clip.templateId);
      const alt = tpl ? templates.find((t) => t.category === tpl.category && t.aspectRatio === target) : undefined;
      if (!alt) {
        templateUnmatched += 1;
        return clip;
      }
      const layerIds = new Set(alt.layers.map((l) => l.id));
      const textKeys = new Set(alt.layers.map((l) => textKeyOfLayer(l)).filter((k): k is NonNullable<typeof k> => k != null));
      layersUnmatched += Object.keys(clip.assetRefs ?? {}).filter((k) => !layerIds.has(k)).length;
      layersUnmatched += Object.entries(clip.texts ?? {}).filter(([k, v]) => v && !textKeys.has(k as never)).length;
      mappingOf.set(clip.id, { fx: s, fy: s });
      return { ...clip, templateId: alt.templateId };
    }
    if (!canHaveBox(clip.kind)) return clip; // 音・読み上げは位置を持たない
    const b = resolveClipBox(clip, from);
    const full = Math.abs(b.x) <= FULL_TOLERANCE_PX && Math.abs(b.y) <= FULL_TOLERANCE_PX
      && Math.abs(b.w - from.width) <= FULL_TOLERANCE_PX && Math.abs(b.h - from.height) <= FULL_TOLERANCE_PX;
    if (full) {
      mappingOf.set(clip.id, { fx: to.width / from.width, fy: to.height / from.height });
      // 箱を書いていない（＝画面いっぱい）部品はそのまま＝新しい画面でも画面いっぱい。
      if (clip.x == null && clip.y == null && clip.w == null && clip.h == null) return clip;
      return { ...clip, x: 0, y: 0, w: to.width, h: to.height };
    }
    if (clip.kind === FREE_ELEMENT_KIND.subtitle) {
      const fx = to.width / from.width;
      const fy = to.height / from.height;
      mappingOf.set(clip.id, { fx, fy });
      return { ...clip, x: b.x * fx, y: b.y * fy, w: b.w * fx, h: b.h };
    }
    mappingOf.set(clip.id, { fx: s, fy: s });
    const cx = (b.x + b.w / 2 - from.width / 2) * s + to.width / 2;
    const cy = (b.y + b.h / 2 - from.height / 2) * s + to.height / 2;
    const w = b.w * s;
    const h = b.h * s;
    const scaled = scaleBakedContent(clip, s, clip.kind === FREE_ELEMENT_KIND.text);
    return { ...scaled, x: cx - w / 2, y: cy - h / 2, w, h };
  });

  // 動きのずれ（x/y）＝その部品に当てた倍率／まとまり＝旧画面を縮めた倍率（中の部品が縮んで写るため）。
  const groupIds = new Set((doc.groups ?? []).map((g) => g.id));
  const animations = doc.animations?.map((a) => {
    const m = mappingOf.get(a.targetId) ?? (groupIds.has(a.targetId) ? { fx: s, fy: s } : undefined);
    if (!m) return a;
    return {
      ...a,
      keyframes: a.keyframes.map((k) => ({
        ...k,
        ...(k.x != null ? { x: k.x * m.fx } : {}),
        ...(k.y != null ? { y: k.y * m.fy } : {}),
      })),
    };
  });
  const groups = doc.groups?.map((g) => ({ ...g, transform: { ...g.transform, x: g.transform.x * s, y: g.transform.y * s } }));

  const outside = clips.filter((c) => {
    if (!canHaveBox(c.kind)) return false;
    const b = resolveClipBox(c, to);
    const eps = FULL_TOLERANCE_PX;
    return b.x < -eps || b.y < -eps || b.x + b.w > to.width + eps || b.y + b.h > to.height + eps;
  }).length;

  return {
    doc: {
      ...doc,
      videoSettings: { ...doc.videoSettings, aspectRatio: target },
      clips,
      ...(animations ? { animations } : {}),
      ...(groups ? { groups } : {}),
    },
    templateUnmatched,
    layersUnmatched,
    outside,
  };
}

/** 縦横を入れ替えた先の向き（16:9 ⇄ 9:16）。 */
export function flippedOrientation(o: Orientation): Orientation {
  return o === ORIENTATION.landscape ? ORIENTATION.portrait : ORIENTATION.landscape;
}
