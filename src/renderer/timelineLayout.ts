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
import { layoutScene } from './layout';
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

/** 矩形（クリップの箱）。回転は中心まわりの度数。 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/**
 * 箱へ補間済みの変換を重ねる（`applyInterpolatedTransform` と同じ規則を矩形に対して行う）。
 * `scale` は**自身の中心を保ったまま**拡縮 → `x`/`y` オフセット → `rotation` オフセット。
 */
function boxWithTransform(box: Box, tr: InterpolatedTransform): Box {
  const w = box.w * (tr.scale ?? 1);
  const h = box.h * (tr.scale ?? 1);
  return {
    x: box.x - (w - box.w) / 2 + (tr.x ?? 0),
    y: box.y - (h - box.h) / 2 + (tr.y ?? 0),
    w,
    h,
    rotation: (box.rotation ?? 0) + (tr.rotation ?? 0),
  };
}

/**
 * 「箱がこう動いた」を**相似変換**（拡縮＋回転＋平行移動）として取り出す。純粋関数。
 *
 * クリップに掛かる変形（グループ・自身のキーフレーム）は**クリップの箱**に対して決まるので、
 * 中身（`layoutScene` が返したアイテム）はこの1つの変換に**まとめて**乗せる＝**クリップが座標系**になる。
 * 中身ごとに拡縮を掛けると各アイテム自身の中心まわりになり、テンプレのクリップ（層が複数）で
 * グループ中心まわりの剛体変形とずれる（#642 レビュー 🔴）。相似変換は
 * 「拡大率・回転角・1点の移り先」で一意に決まるので、**アンカーの位置は箱の中心の移り先に畳み込まれる**
 * （`composeGroupGeometry` が使ったグループ中心をここで再計算しなくてよい）。
 */
interface Similarity {
  scale: number;
  rotationDeg: number;
  /** 変換前の基準点（箱の中心）。 */
  fromCenter: { x: number; y: number };
  /** 変換後の基準点（箱の中心の移り先）。 */
  toCenter: { x: number; y: number };
}

function similarityBetween(from: Box, to: Box): Similarity {
  return {
    scale: from.w > 0 ? to.w / from.w : 1,
    rotationDeg: (to.rotation ?? 0) - (from.rotation ?? 0),
    fromCenter: { x: from.x + from.w / 2, y: from.y + from.h / 2 },
    toCenter: { x: to.x + to.w / 2, y: to.y + to.h / 2 },
  };
}

/** 何も動かさない変換か（アイテムを触らずに済ませる＝浮動小数の誤差を持ち込まない）。 */
function isIdentity(sim: Similarity): boolean {
  return (
    sim.scale === 1 &&
    sim.rotationDeg === 0 &&
    sim.fromCenter.x === sim.toCenter.x &&
    sim.fromCenter.y === sim.toCenter.y
  );
}

/** 相似変換を1アイテムへ適用する（中心を移し、大きさを掛け、角度を足す）。 */
function applySimilarity(item: LayoutItem, sim: Similarity): void {
  if (isIdentity(sim)) return;
  const rad = (sim.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (item.x + item.w / 2 - sim.fromCenter.x) * sim.scale;
  const dy = (item.y + item.h / 2 - sim.fromCenter.y) * sim.scale;
  const cx = sim.toCenter.x + dx * cos - dy * sin;
  const cy = sim.toCenter.y + dx * sin + dy * cos;
  item.w *= sim.scale;
  item.h *= sim.scale;
  item.x = cx - item.w / 2;
  item.y = cy - item.h / 2;
  if (sim.rotationDeg !== 0) item.rotation = (item.rotation ?? 0) + sim.rotationDeg;
}

/** クリップが占める矩形。テンプレのクリップは画面いっぱい（枠そのもの）＝幾何を持たない。 */
function clipBox(clip: TimelineClip, canvas: { width: number; height: number }): Box {
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
 * - **クリップは中身の座標系**。クリップに掛かる変形（グループ → 自身のキーフレーム）はまず「クリップの箱」に
 *   効かせ、その**箱の動きを相似変換として中身へまとめて持ち込む**＝テンプレのクリップ（層が複数）でも
 *   グループ中心まわりの剛体変形と一致する（中身ごとに拡縮すると各アイテム自身の中心まわりになりずれる）。
 * - 不透明度だけは幾何と違い**クリップ全体に等しく効く**ので別に重ねる（自身＝絶対上書き／グループ＝乗算
 *   ＝場面形式の `layoutScene` と同じ順序）。
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

    // クリップは**中身の座標系**として扱う＝クリップに掛かる変形（グループ → 自身のキーフレーム）は、
    // まず「クリップの箱」に効かせ、その **箱の動き（相似変換）を中身へそのまま持ち込む**。
    // 中身ごとに `applyInterpolatedTransform` を掛けると、拡大・回転が**各アイテム自身の中心**まわりに
    // なってしまい、テンプレのクリップ（層が複数）でグループ中心まわりの剛体変形とずれる（#642 レビュー 🔴）。
    const box = clipBox(clip, canvas);
    // 順序は場面形式（`layoutScene`）と同じ＝グループを先に合成し、その上へ自身のキーフレームを重ねる。
    const grouped = composed.get(clip.id) ?? box;
    const own = (doc.animations ?? []).find((a) => a.targetId === clip.id);
    const ownTr: InterpolatedTransform = own ? interpolateKeyframes(own.keyframes, timeSec - clip.startSec) : {};
    const finalBox = boxWithTransform(grouped, ownTr);
    const sim = similarityBetween(box, finalBox);
    const groupO = opacityForClip.get(clip.id);

    for (const item of sub.items) {
      applySimilarity(item, sim);
      // 不透明度は幾何と違い**クリップ全体に等しく効く**（相似変換では運べない）ので別に重ねる。
      // 自身のキーフレームは絶対上書き、グループは乗算＝場面形式の `layoutScene` と同じ順序。
      // 混ぜるとクリップ自身の不透明度（例 0.5 の図形）を潰す。
      if (ownTr.opacity != null) item.opacity = ownTr.opacity;
      if (groupO != null) item.opacity = (item.opacity ?? 1) * groupO;
      // 重ね順はトラックの並び順だけで決める＝クリップの中の順序を保ったまま、後のトラックほど手前へ。
      items.push({ ...item, id: `${clip.id}/${item.id}`, zIndex: items.length });
    }
  }

  return { width: canvas.width, height: canvas.height, backgroundColor: CANVAS_BACKGROUND_COLOR, items };
}
