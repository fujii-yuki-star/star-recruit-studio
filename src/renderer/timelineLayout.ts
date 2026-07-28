// タイムライン形式（ADR-0032）の「ある瞬間の1フレーム」を配置解決する（#629）。純粋関数（副作用なし）。
//
// **1枚のフレームを描く核は場面形式と共有する**（ADR-0032「違うのは並べ方だけ」）＝ここは
// 「その時刻に生きているクリップを、トラックの並び順に重ねる」だけを担い、1クリップの中身は
// `layoutScene` に委ねる。こうするとテンプレの層解決・FREE 要素・文字の体裁・キーフレームの重ね方が
// 両形式で1つの実装に収まり、プレビュー＝書き出しのパリティ（ADR-0001）を二重に作らずに済む。
import { dimsForOrientation } from '../domain/constants';
import { FREE_CATEGORY, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import type { FreeElementKind } from '../domain/enums';
import { composeGroupGeometry, isHiddenByGroup } from '../domain/group/compose';
import { groupElementIds } from '../domain/project/groupOps';
import type { Group } from '../domain/group/types';
import { interpolateKeyframes } from '../domain/project/keyframes';
import type { InterpolatedTransform } from '../domain/project/keyframes';
import type { FreeElement, Scene } from '../domain/project/types';
import type { Template } from '../domain/template/types';
import { clipEndSec } from '../domain/timeline/validateTimelineDoc';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { applyInterpolatedTransform, layoutScene } from './layout';
import type { LayoutItem, SceneLayout } from './layout';

/** キャンバスの下地。テンプレを置いていない場所の色＝場面形式の既定（`layoutScene`）と同じ白に揃える。 */
const CANVAS_BACKGROUND_COLOR = '#ffffff';

/** クリップが時刻 t に生きているか。区間は `[startSec, startSec+durationSec)`（V24 と同じ半開区間）。 */
export function clipIsLiveAt(clip: TimelineClip, timeSec: number): boolean {
  return timeSec >= clip.startSec && timeSec < clipEndSec(clip);
}

/** 映像として描くクリップか（音だけのものは絵を持たない）。 */
function isVisualClip(clip: TimelineClip): boolean {
  return clip.kind !== TIMELINE_CLIP_KIND.audio && clip.kind !== TIMELINE_CLIP_KIND.voice;
}

/**
 * グループのアニメの起点（秒）＝**所属クリップのうち最も早い開始秒**。
 *
 * `ClipAnimation.timeSec` は「クリップの先頭から」だが、グループを対象にしたときの先頭が要る。
 * 焼き出し（#628）は1場面のクリップをまとめてグループにするので、どのメンバーも同じ開始秒＝
 * 場面の先頭になり、クリップ対象のときと同じ起点になる（意味が揃う）。
 */
function groupStartSec(groups: Group[], groupId: string, clipById: Map<string, TimelineClip>): number {
  const starts = groupElementIds(groups, groupId)
    .map((id) => clipById.get(id)?.startSec)
    .filter((v): v is number => v != null);
  return starts.length > 0 ? Math.min(...starts) : 0;
}

/** 2つの補間結果を重ねる（位置=加算／拡縮=乗算／回転=加算／不透明度=乗算）。グループ×クリップの二重掛け用。 */
function mergeTransforms(a: InterpolatedTransform, b: InterpolatedTransform): InterpolatedTransform {
  const out: InterpolatedTransform = {};
  if (a.x != null || b.x != null) out.x = (a.x ?? 0) + (b.x ?? 0);
  if (a.y != null || b.y != null) out.y = (a.y ?? 0) + (b.y ?? 0);
  if (a.scale != null || b.scale != null) out.scale = (a.scale ?? 1) * (b.scale ?? 1);
  if (a.rotation != null || b.rotation != null) out.rotation = (a.rotation ?? 0) + (b.rotation ?? 0);
  if (a.opacity != null || b.opacity != null) out.opacity = (a.opacity ?? 1) * (b.opacity ?? 1);
  return out;
}

/** クリップが占める矩形。テンプレのクリップは画面いっぱい（枠そのもの）＝幾何を持たない。 */
function clipBox(clip: TimelineClip, canvas: { width: number; height: number }): { x: number; y: number; w: number; h: number; rotation?: number } {
  return {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    w: clip.w ?? canvas.width,
    h: clip.h ?? canvas.height,
    ...(clip.rotation != null ? { rotation: clip.rotation } : {}),
  };
}

/** テンプレを置いたクリップ（`kind:'template'`）を、場面形式の Scene へ写して `layoutScene` に渡せる形にする。 */
function sceneFromTemplateClip(clip: TimelineClip): Scene {
  return {
    // sceneId はこのフレームの中でだけ使う識別子（保存しない）。クリップ id をそのまま使う。
    sceneId: clip.id,
    partId: '',
    order: 0,
    sceneType: FREE_CATEGORY,
    templateId: clip.templateId ?? '',
    durationSec: clip.durationSec,
    assetRefs: clip.assetRefs ?? {},
    character: clip.character ?? { enabled: false, characterId: 'yuko' },
    texts: clip.texts ?? {},
    narration: { text: '', status: 'none' },
    warnings: [],
    ...(clip.textStyles ? { textStyles: clip.textStyles } : {}),
    ...(clip.slotFits ? { slotFits: clip.slotFits } : {}),
    ...(clip.textFontIds ? { textFontIds: clip.textFontIds } : {}),
    ...(clip.slotClips ? { slotClips: clip.slotClips } : {}),
    ...(clip.fontId != null ? { fontId: clip.fontId } : {}),
  };
}

/** 自由配置のクリップ（slot/text/shape/subtitle）を FREE 要素へ写す。空間の語彙は同じもの（11 §7.6）。 */
function freeElementFromClip(clip: TimelineClip, canvas: { width: number; height: number }): FreeElement {
  const { id, kind, trackId: _t, startSec: _s, durationSec: _d, templateId: _tid, assetRefs: _ar, texts: _tx,
    textStyles: _ts, slotFits: _sf, textFontIds: _tf, character: _c, slotClips: _sc, voice: _v,
    bundledBgmId: _b, volume: _vol, fadeInSec: _fi, fadeOutSec: _fo, sourceStartSec: _ss, speed: _sp,
    ...spatial } = clip;
  return { ...spatial, ...clipBox(clip, canvas), id, kind: kind as FreeElementKind };
}

/** タイムライン形式の空の器（自由配置＝層を持たない）。1クリップを FREE 要素として描くために使う。 */
function emptyFreeTemplate(canvas: { width: number; height: number }): Template {
  return {
    schemaVersion: '1.0',
    templateId: '',
    name: '',
    category: FREE_CATEGORY,
    aspectRatio: canvas.width >= canvas.height ? '16:9' : '9:16',
    canvas,
    layers: [],
  };
}

export interface TimelineLayoutOptions {
  /** 見た目パターンの解決。見つからないクリップは描かない（案内は呼び出し側＝§2-5）。 */
  templateOf: (templateId: string) => Template | undefined;
}

/**
 * 時刻 `timeSec` のフレームを配置解決する（ADR-0032・#629）。純粋関数。
 *
 * - **重ね順は `doc.tracks` の並び順だけで決まる**（配列の後ろほど手前）。同一トラック内は時間が重ならない
 *   （11 §8 V24）ので、トラック順＝重ね順が一意に決まる＝クリップに `zIndex` を持たせなくてよい。
 * - 1クリップの中身は `layoutScene` に委ねる（テンプレのクリップは Scene へ、自由配置のクリップは
 *   FREE 要素1つの Scene へ写す）＝**描画の核を場面形式と共有**する。
 * - キーフレームは**クリップ対象とグループ対象を重ねて**適用する（位置=加算／拡縮=乗算／回転=加算／
 *   不透明度=乗算）。重ね方は `applyInterpolatedTransform` を場面形式と共有。
 * - 隠したトラック・隠したグループのメンバーは描かない（音のトラックは絵を持たないので対象外）。
 */
export function layoutTimelineAt(doc: TimelineProject, timeSec: number, opts: TimelineLayoutOptions): SceneLayout {
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  const groups = doc.groups ?? [];
  const clipById = new Map(doc.clips.map((c) => [c.id, c]));

  // グループのアニメを transform へ前合成する（場面形式の layoutScene と同じ手順）。不透明度は後段で乗算。
  const groupOpacity = new Map<string, number>();
  const effectiveGroups: Group[] = groups.map((g) => {
    const anim = (doc.animations ?? []).find((a) => a.targetId === g.id);
    if (!anim) return g;
    const tr = interpolateKeyframes(anim.keyframes, timeSec - groupStartSec(groups, g.id, clipById));
    if (tr.opacity != null) groupOpacity.set(g.id, tr.opacity);
    return {
      ...g,
      transform: {
        x: g.transform.x + (tr.x ?? 0),
        y: g.transform.y + (tr.y ?? 0),
        scale: g.transform.scale * (tr.scale ?? 1),
        rotation: g.transform.rotation + (tr.rotation ?? 0),
      },
    };
  });

  // 描くクリップ（隠したトラック・隠したグループのメンバーを除く）をトラックの並び順に集める。
  const live: TimelineClip[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== TRACK_KIND.visual || track.hidden) continue;
    for (const clip of doc.clips) {
      if (clip.trackId !== track.id || clip.hidden) continue;
      if (!isVisualClip(clip) || !clipIsLiveAt(clip, timeSec)) continue;
      if (isHiddenByGroup(clip.id, effectiveGroups)) continue;
      live.push(clip);
    }
  }

  // グループ変形を実効の矩形へ合成する（通常描画と同じ関数）。差分をクリップの中身へ重ねる。
  const boxes = doc.clips.filter(isVisualClip).map((c) => ({ id: c.id, ...clipBox(c, canvas) }));
  const composed = composeGroupGeometry(boxes, effectiveGroups);

  // グループの不透明度は、メンバー（推移的）へ乗算で効く。
  const opacityForClip = new Map<string, number>();
  for (const [gid, o] of groupOpacity) {
    for (const id of groupElementIds(effectiveGroups, gid)) {
      opacityForClip.set(id, (opacityForClip.get(id) ?? 1) * o);
    }
  }

  const items: LayoutItem[] = [];
  for (const clip of live) {
    const template =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? opts.templateOf(clip.templateId ?? '')
        : emptyFreeTemplate(canvas);
    if (!template) continue; // 見た目が見つからないクリップは描かない（案内は呼び出し側）

    const scene =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? sceneFromTemplateClip(clip)
        : { ...sceneFromTemplateClip(clip), freeLayout: [freeElementFromClip(clip, canvas)] };
    const sub = layoutScene(scene, template);

    // クリップ自身のキーフレーム（クリップの先頭からの秒）＋グループのぶんを重ねる。
    const own = (doc.animations ?? []).find((a) => a.targetId === clip.id);
    let tr: InterpolatedTransform = own ? interpolateKeyframes(own.keyframes, timeSec - clip.startSec) : {};
    // グループ変形は矩形の差分として受け取る（通常描画と同じ composeGroupGeometry を通した結果）。
    const box = clipBox(clip, canvas);
    const cg = composed.get(clip.id);
    if (cg && (cg.x !== box.x || cg.y !== box.y || cg.w !== box.w || cg.rotation !== box.rotation)) {
      tr = mergeTransforms(tr, {
        x: cg.x - box.x,
        y: cg.y - box.y,
        scale: box.w > 0 ? cg.w / box.w : 1,
        rotation: (cg.rotation ?? 0) - (box.rotation ?? 0),
      });
    }
    const groupO = opacityForClip.get(clip.id);

    for (const item of sub.items) {
      if (Object.keys(tr).length > 0) applyInterpolatedTransform(item, tr);
      // グループの不透明度は**乗算**で後から重ねる（場面形式の layoutScene と同じ順序）。
      // `applyInterpolatedTransform` の opacity は絶対上書きなので、ここへ混ぜると
      // 要素自身の不透明度（例 0.5 の図形）を潰してしまう。
      if (groupO != null) item.opacity = (item.opacity ?? 1) * groupO;
      // 重ね順はトラックの並び順だけで決める＝クリップの中の順序を保ったまま、後のトラックほど手前へ。
      items.push({ ...item, id: `${clip.id}/${item.id}`, zIndex: items.length });
    }
  }

  return { width: canvas.width, height: canvas.height, backgroundColor: CANVAS_BACKGROUND_COLOR, items };
}
