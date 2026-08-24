// タイムライン形式（ADR-0032）の「ある瞬間の1フレーム」を配置解決する（#629）。純粋関数（副作用なし）。
//
// **1枚のフレームを描く核は場面形式と共有する**（ADR-0032「違うのは並べ方だけ」）＝ここは
// 「その時刻に生きているクリップを、トラックの並び順に重ねる」だけを担い、1クリップの中身は
// `layoutScene` に委ねる。こうするとテンプレの層解決・FREE 要素・文字の体裁・キーフレームの重ね方が
// 両形式で1つの実装に収まり、プレビュー＝書き出しのパリティ（ADR-0001）を二重に作らずに済む。
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_FIT, dimsForOrientation } from '../domain/constants';
import { fillPlacement } from '../domain/timeline/cropFill';
import type { FillPlacement, SourceSize } from '../domain/timeline/cropFill';
import { sceneFromClip } from '../domain/timeline/sceneFromClip';
import { subtitleTextOf } from '../domain/timeline/subtitleLink';
import { CROP_MODE, FIT, FREE_CATEGORY, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import type { FreeElementKind } from '../domain/enums';
import { composeGroupGeometry, isHiddenByGroup } from '../domain/group/compose';
import { groupElementIds } from '../domain/project/groupOps';
import type { Group } from '../domain/group/types';
import { interpolateKeyframes } from '../domain/project/keyframes';
import type { InterpolatedTransform } from '../domain/project/keyframes';
import type { FreeElement } from '../domain/project/types';
import { TEMPLATE_SCHEMA_VERSION } from '../domain/template/types';
import type { Template } from '../domain/template/types';
import { clipEndSec } from '../domain/timeline/validateTimelineDoc';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { applyInterpolatedTransform, layoutScene } from './layout';
import type { LayoutItem, SceneLayout } from './layout';
import type { Orientation } from '../domain/enums';
import { resolveClipBox } from '../domain/timeline/box';
import { isVisualClip } from '../domain/timeline/clipKind';

/** クリップが時刻 t に生きているか。区間は `[startSec, startSec+durationSec)`（V24 と同じ半開区間）。 */
export function clipIsLiveAt(clip: TimelineClip, timeSec: number): boolean {
  return timeSec >= clip.startSec && timeSec < clipEndSec(clip);
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
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/**
 * 箱へ補間済みの変換を重ねる。**規則そのものは `applyInterpolatedTransform`（場面形式と同じ1関数）に委ねる**
 * ＝「scale は中心維持 → x/y → rotation」を2か所に書かない（片方だけ直って絵が割れるのを防ぐ・§6）。
 */
function boxWithTransform(box: Box, tr: InterpolatedTransform): Box {
  const next: Box = { ...box, rotation: box.rotation ?? 0 };
  applyInterpolatedTransform(next, tr); // 規則そのものは場面形式と同じ1関数（§6）
  return next;
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


/** 自由配置のクリップ（slot/text/shape/subtitle）を FREE 要素へ写す。空間の語彙は同じもの（11 §7.6）。 */
/**
 * クリップを**自由配置の要素**として見る（描画とキャンバスの操作レイヤが同じ変換を通る・#746-2）。
 * 手で作り直すと、文字・書体・帯が抜けて**編集中だけ見た目が変わる**（インライン編集が実描画と割れる）。
 */
export function freeElementFromClip(clip: TimelineClip, canvas: { width: number; height: number }): FreeElement {
  // **持っていくものを名指しする**（要らないものを除外する形にしない）＝`TimelineClip` に時間や音の
  // フィールドが増えたとき、rest 経由で FreeElement へ黙って流れ込まない。空間の語彙は 11 §7.6。
  const el: FreeElement = { ...resolveClipBox(clip, canvas), id: clip.id, kind: clip.kind as FreeElementKind };
  const spatial = [
    'name', 'assetId', 'fit', 'text', 'fontSize', 'color', 'fontWeight', 'fontId', 'lineHeight',
    'textAlign', 'shapeType', 'fillColor', 'opacity', 'radius', 'strokeColor', 'strokeWidth',
    'background', 'hidden', 'locked',
  ] as const satisfies readonly (keyof FreeElement & keyof TimelineClip)[];
  for (const key of spatial) {
    const v = clip[key];
    if (v !== undefined) Object.assign(el, { [key]: v });
  }
  return el;
}

/**
 * タイムライン形式の空の器（自由配置＝層を持たない）。1クリップを FREE 要素として描くために使う。
 * **向きは文書の値をそのまま渡す**（寸法から逆算しない）＝将来 `1:1` が入っても黙って `16:9` と名乗らない。
 */
function emptyFreeTemplate(canvas: { width: number; height: number }, aspectRatio: Orientation): Template {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    templateId: '',
    name: '',
    category: FREE_CATEGORY,
    aspectRatio,
    canvas,
    layers: [],
  };
}

export interface TimelineLayoutOptions {
  /**
   * 素材の**実寸**（#634）。`cropMode:'fill'`（残った素材を枠いっぱいに映す）だけが使う。
   * 絵を測らないと分からないので**描く側から渡す**（プレビューも書き出しも同じ値を使う＝パリティ）。
   * 分からない素材は `undefined` を返してよい＝そのクリップは `mask` として描く。
   */
  assetSizeOf?: (assetId: string) => SourceSize | undefined;
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
 * - 不透明度だけは幾何と違い**クリップ全体に等しく効く**ので、アイテムへ掛けずに**合成の単位**
 *   （`composite`）として渡す＝`sceneSvg` が `<g opacity>` で1枚にしてから掛ける（ADR-0032 決定19）。
 *   α の出どころがグループなら**グループ全体**が1枚＝FREE 場面のフェードで要素どうしが透けない。
 * - 隠したトラック・隠したグループのメンバーは描かない（音のトラックは絵を持たないので対象外）。
 */
/** その時刻に**描かれる部品**（描く順＝背面から前面へ）と、その**実効の箱**。 */
export interface TimelineCanvasClip {
  clip: TimelineClip;
  /** 部品そのものの箱（動きを当てる前）。書き戻す先はこちら。 */
  box: Box;
  /** まとまりの変形まで当てた箱（自身の動きはまだ）。 */
  groupedBox: Box;
  /** まとまりの変形 → 自身の動き まで当てた箱＝**いま描かれている場所**。 */
  finalBox: Box;
  /** その部品自身の動き（不透明度は箱に乗らないので、描画側がそのまま使う）。 */
  ownTr: InterpolatedTransform;
}

/**
 * その時刻の**実効のまとまり**（まとまりに付いた動きを transform へ前合成したもの）。
 * 不透明度は別途返す（描画だけが使う）。
 */
export interface EffectiveGroups {
  groups: Group[];
  opacity: Map<string, number>;
}

function effectiveGroupsAt(doc: TimelineProject, timeSec: number): EffectiveGroups {
  const groups = doc.groups ?? [];
  const clipById = new Map(doc.clips.map((c) => [c.id, c]));
  const opacity = new Map<string, number>();
  const out: Group[] = groups.map((g) => {
    const anim = (doc.animations ?? []).find((a) => a.targetId === g.id);
    if (!anim) return g;
    const tr = interpolateKeyframes(anim.keyframes, timeSec - groupStartSec(groups, g.id, clipById));
    if (tr.opacity != null) opacity.set(g.id, tr.opacity);
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
  return { groups: out, opacity };
}

/**
 * その時刻に**キャンバスへ描かれる部品**を、**描く順**（列の並び → 列の中の並び）で返す（#746-4/5）。
 *
 * ⚠️ **描画と操作レイヤが同じものを見るための入口**＝並び順も、隠す条件も、動きを当てた後の箱も、
 * ここ1か所で決める。操作レイヤが自前で並べると、重なった所で**奥の部品が掴まれる**（列の順と
 * 配列の順が違う）／動いている間は**掴もうとした所に無い**（箱が素のまま）。
 */
export function timelineCanvasClipsAt(
  doc: TimelineProject,
  timeSec: number,
  // ⚠️ 受けるのは**実効のまとまり**（動きを前合成したもの）だけ＝素の `doc.groups` を渡せる形にすると、
  // 渡した回だけ箱が描画とずれる（型で防ぐ）。同じ時刻で2度解かないための持ち回し。
  precomputed?: EffectiveGroups,
): TimelineCanvasClip[] {
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  const groups = (precomputed ?? effectiveGroupsAt(doc, timeSec)).groups;
  const boxes = doc.clips.filter(isVisualClip).map((c) => ({ id: c.id, ...resolveClipBox(c, canvas) }));
  const composed = composeGroupGeometry(boxes, groups);
  const out: TimelineCanvasClip[] = [];
  // 重ね順は**列の並び順だけ**（ADR-0032）＝後の列ほど手前。列の中は文書の並び。
  for (const track of doc.tracks) {
    if (track.kind !== TRACK_KIND.visual || track.hidden) continue;
    for (const clip of doc.clips) {
      if (clip.trackId !== track.id || clip.hidden) continue;
      if (!isVisualClip(clip) || !clipIsLiveAt(clip, timeSec)) continue;
      if (isHiddenByGroup(clip.id, groups)) continue;
      const box = resolveClipBox(clip, canvas);
      const own = (doc.animations ?? []).find((a) => a.targetId === clip.id);
      const ownTr: InterpolatedTransform = own ? interpolateKeyframes(own.keyframes, timeSec - clip.startSec) : {};
      const groupedBox = composed.get(clip.id) ?? box;
      out.push({ clip, box, groupedBox, finalBox: boxWithTransform(groupedBox, ownTr), ownTr });
    }
  }
  return out;
}

/**
 * 描いたアイテムの id から**どの部品のものか**を見分ける（#746-2）。
 * ⚠️ **前置きの作り方はこの file の中で1つ**（下でアイテムに付けている前置きと対）＝
 * 呼び出し側で組み立て直すと、付け方を変えたときに黙って外れる（伏せたい絵が伏せられない）。
 */
export function isItemOfClip(itemId: string, clipId: string): boolean {
  return itemId === `${clipId}__bg` || itemId.startsWith(`${clipId}/`);
}

/**
 * その点にある**見た目パターンの中の部分**（差し込み口・文字の層）。`null`＝そこには無い（#818）。
 *
 * **ドリルイン**（ADR-0034 決定8＝二度押しで中へ入る）の当て先を出す。見た目パターンのクリップは
 * 枠そのもの（箱を持たない）なので、キャンバスには**中の層しか描かれていない**＝どの層を指したかは
 * 描いた結果から引くのが確実（テンプレの座標を画面で組み直すと、動き・まとまりの変形とずれる）。
 *
 * - **手前から探す**（`items` は背面→前面の順）＝重なっていたら上のものを指す（見えているものが当たる）。
 * - **回した層は回転を戻して当てる**＝軸に沿った矩形で当てると、回した枠の外側を指しても当たる。
 * - 見分けるのは id の作り（`<部品 id>/<層 id>`）＝**この file の中で1つ**（`isItemOfClip` と同じ理由）。
 */
export function templatePartAt(
  layout: SceneLayout,
  point: { x: number; y: number },
  /**
   * その部品の、その層に**入れるか**（呼び出し側だけが知っている）。
   * ⚠️ **「入れる層」を渡してもらう**（レビュー 🟡）＝ここで「下地でなければ入れる」と決めると、
   * クリップの塗り（id は `<部品 id>/<部品 id>__bg`）や、手を移す先の無い層まで当たってしまい、
   * **二度押しが黙って飲み込まれる**（入ったのに何も起きない）。
   */
  canDrillInto: (clipId: string, layerId: string) => boolean,
): { clipId: string; layerId: string } | null {
  for (let i = layout.items.length - 1; i >= 0; i--) {
    const item = layout.items[i];
    const slash = item.id.indexOf('/');
    if (slash <= 0) continue; // 自由配置の部品（前置きが無い）は対象外
    const clipId = item.id.slice(0, slash);
    const layerId = item.id.slice(slash + 1);
    if (!canDrillInto(clipId, layerId)) continue;
    if (hitsItem(item, point)) return { clipId, layerId };
  }
  return null;
}

/** 入った層の**描かれている枠**（印を出す先）。`null`＝いま描かれていない。 */
export function templatePartRect(
  layout: SceneLayout,
  part: { clipId: string; layerId: string },
): { x: number; y: number; w: number; h: number; rotation?: number } | null {
  const item = layout.items.find((it) => it.id === `${part.clipId}/${part.layerId}`);
  return item ? { x: item.x, y: item.y, w: item.w, h: item.h, ...(item.rotation != null ? { rotation: item.rotation } : {}) } : null;
}

/** その点がアイテムの中か（回っていれば回転を戻してから見る）。 */
function hitsItem(item: { x: number; y: number; w: number; h: number; rotation?: number }, point: { x: number; y: number }): boolean {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const rad = ((item.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const px = cx + dx * Math.cos(-rad) - dy * Math.sin(-rad);
  const py = cy + dx * Math.sin(-rad) + dy * Math.cos(-rad);
  return px >= item.x && px <= item.x + item.w && py >= item.y && py <= item.y + item.h;
}

/**
 * そのアイテムが、その**動画の置き場所**のものか（#512 段3）。
 * ⚠️ 差し込み口は**部品の中の1つ**なので、部品 id だけでは足りない（同じ部品の別の枠まで
 * 動画のコマで塗ってしまう）。層 id まで見る。直接置きは部品に1つだけなので従来どおり。
 * ⚠️ 前置きの作り方は**この file の中で1つ**（`isItemOfClip` と同じ理由）。
 */
export function isItemOfPlacement(
  itemId: string,
  placement: { clip: { id: string }; layerId: string | null },
): boolean {
  return placement.layerId == null
    ? isItemOfClip(itemId, placement.clip.id)
    : itemId === `${placement.clip.id}/${placement.layerId}`;
}

export function layoutTimelineAt(doc: TimelineProject, timeSec: number, opts: TimelineLayoutOptions): SceneLayout {
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  // グループのアニメを transform へ前合成する（場面形式の layoutScene と同じ手順）。不透明度は後段で乗算。
  const effective = effectiveGroupsAt(doc, timeSec);
  const { groups: effectiveGroups, opacity: groupOpacity } = effective;

  // 描くクリップ（隠したトラック・隠したグループのメンバーを除く）を**トラックの並び順**に集め、
  // まとまりの変形と自身の動きを当てた箱まで出す。⚠️ **操作レイヤと同じ関数**（#746-4/5）＝
  // 並び順・隠す条件・動きを当てた箱を2か所に書かない。
  const live = timelineCanvasClipsAt(doc, timeSec, effective);

  // グループの不透明度は、メンバー（推移的）へ効く。**どのグループ由来か**も覚える＝
  // 合成の単位をそのグループにできる（FREE 場面のフェードが場面まるごと1枚になる・ADR-0026②）。
  const opacityForClip = new Map<string, number>();
  const opacityGroupOfClip = new Map<string, string>();
  for (const [gid, o] of groupOpacity) {
    for (const id of groupElementIds(effectiveGroups, gid)) {
      opacityForClip.set(id, (opacityForClip.get(id) ?? 1) * o);
      opacityGroupOfClip.set(id, gid);
    }
  }

  const items: LayoutItem[] = [];
  for (const { clip, box, finalBox, ownTr } of live) {
    const template =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? opts.templateOf(clip.templateId ?? '')
        : emptyFreeTemplate(canvas, doc.videoSettings.aspectRatio);
    if (!template) continue; // 見た目が見つからないクリップは描かない（案内は呼び出し側）

    // 字幕は**連動先の読み上げ文**まで解いてから渡す（文書を見ないと解けない・ADR-0032 決定24）。
    const subtitleOpts = { subtitleText: subtitleTextOf(doc, clip) };
    const scene =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? sceneFromClip(clip, template, subtitleOpts)
        : { ...sceneFromClip(clip, template, subtitleOpts), freeLayout: [freeElementFromClip(clip, canvas)] };
    const sub = layoutScene(scene, template);

    // クリップは**中身の座標系**として扱う＝クリップに掛かる変形（グループ → 自身のキーフレーム）は、
    // まず「クリップの箱」に効かせ、その **箱の動き（相似変換）を中身へそのまま持ち込む**。
    // 中身ごとに `applyInterpolatedTransform` を掛けると、拡大・回転が**各アイテム自身の中心**まわりに
    // なってしまい、テンプレのクリップ（層が複数）でグループ中心まわりの剛体変形とずれる（#642 レビュー 🔴）。
    // 箱は上でまとめて出してある（順序は場面形式＝グループを先に合成し、その上へ自身の動きを重ねる）。
    const sim = similarityBetween(box, finalBox);
    const groupO = opacityForClip.get(clip.id);

    // 見た目パターンの下地（`template.defaults.backgroundColor`）は、場面形式ではフレーム全体を塗る。
    // タイムラインでは「そのクリップの下地」なので、クリップの箱ぶんの塗りとして最背面へ足す
    // ＝背景の層を持たない見た目でも下地が黙って白にならない。
    const clipItems: LayoutItem[] =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? [{ id: `${clip.id}__bg`, kind: 'fill', ...box, zIndex: -1, color: sub.backgroundColor, opacity: 1, radius: 0 }, ...sub.items]
        : sub.items;

    // クリップ全体に掛かる不透明度＝**1枚に合成してから**掛ける（`compositeKey` で `<g opacity>` へ）。
    // アイテムごとに掛けると、層が重なる所で下が透けて `xfade=fade` と別の絵になる（決定19 の前提）。
    // クリップ自身のキーフレームは絶対、グループは乗算＝場面形式の `layoutScene` と同じ順序。
    const clipOpacity = (ownTr.opacity ?? 1) * (groupO ?? 1);
    // 合成の単位は**α の出どころ**で決める。グループのフェード（FREE 場面の切り替え）はグループ全体で
    // 1枚に合成する＝場面の要素どうしがフェード中だけ互いに透ける、を防ぐ。グループのメンバーは
    // 連続した列に並ぶ（`TrackAllocator` が1場面ぶんを連続で取る）ので、並びも1かたまりになる。
    const compositeKey = groupO != null ? opacityGroupOfClip.get(clip.id) ?? clip.id : clip.id;
    // 切り抜きは「クリップの箱の各辺を割合で隠す」（`11 §7.6.4`）。**変形後の箱**（`finalBox`）から矩形を出す
    // ＝動かした・拡大した先で切れる（箱の中身と同じ扱い）。何も隠さないときは矩形を持たない。
    const cropRect = cropRectOf(clip, finalBox);
    // 残った素材を枠いっぱいに映す（#634）＝**素材の差し込み口だけ**（1つの素材に対する操作なので、
    // 複数の絵が入るテンプレのクリップには効かせない）。実寸が分からないときは `undefined`＝`mask` のまま。
    const fill = fillOf(clip, finalBox, opts.assetSizeOf);

    for (const item of clipItems) {
      applySimilarity(item, sim);
      // 文字のフォント：クリップ全体の指定（`fontId`）は、種別ごとの指定が無いときの受け皿。
      // 場面形式は「フレーム単位の fontFamily」で効かせるが、1フレームに複数クリップが混ざる本形式では
      // それができないので、アイテムへ落とす（テンプレのクリップだけ黙って既定へ戻るのを防ぐ・ADR-0026②）。
      if (item.kind === 'text' && item.fontId == null && clip.fontId != null) item.fontId = clip.fontId;
      // 素材の寄せ（#634）＝クリップの指定を絵のアイテムへ落とす。**枠の中の差し込み口すべてに効く**
      // （テンプレのクリップも同じ寄せになる）＝クリップ単位の設定なので、そこは意図どおり。
      if (item.kind === 'image' && clip.cropAlign != null) item.align = clip.cropAlign;
      // 枠いっぱいに映す場合は、素材を置く矩形をこちらで決める＝SVG の当てはめは切る（二重に効かせない）。
      if (fill && item.kind === 'image') {
        // 回転は各アイテムの**自分の中心**まわりに掛かる（`sceneSvg`）。素材の矩形は箱より大きく中心も
        // ずれるので、そのままだと切り抜き矩形（＝箱の中心で回る）とピボットが割れる。**箱の中心まわりに
        // 回した位置**へ寄せておく＝回っていても「箱を基準に切り、残りが枠を満たす」が両立する。
        const p = pivotShift(fill, finalBox);
        item.x = finalBox.x + fill.x + p.dx;
        item.y = finalBox.y + fill.y + p.dy;
        item.w = fill.w;
        item.h = fill.h;
        item.fit = FIT.stretch;
        delete item.align;
      }
      // 重ね順はトラックの並び順だけで決める＝クリップの中の順序を保ったまま、後のトラックほど手前へ。
      // アイテム自身の不透明度（FREE 要素の `opacity`）はそのまま＝クリップ全体の α とは別物。
      items.push({
        ...item,
        id: `${clip.id}/${item.id}`,
        zIndex: items.length,
        ...(clipOpacity < 1 ? { composite: { key: compositeKey, opacity: clipOpacity } } : {}),
        // 切り抜き（#634）＝**変形のあとの箱**を基準に切る（動かした先で切れる＝設定した意味どおり）。
        // 枠いっぱいに映す場合、切るのは**箱そのもの**（辺を隠すのではなく、はみ出しを収める）。
        ...(fill ? { clipRect: boxRect(clip.id, finalBox) } : cropRect ? { clipRect: cropRect } : {}),
      });
    }
  }

  return { width: canvas.width, height: canvas.height, backgroundColor: DEFAULT_BACKGROUND_COLOR, items };
}

/**
 * 切り抜きの矩形（キャンバス座標）。各辺を「箱の大きさに対する割合」で内側へ寄せる（#634）。
 * 何も隠さない（すべて 0／未指定）ときは `undefined`＝切り抜きの `<g>` を出さない。
 * 同じ軸の合計が 1 以上の壊れたデータは**残り 1px を残す**（絵が丸ごと消えるより、切れていると分かる方を採る）。
 */
function cropRectOf(clip: TimelineClip, box: Box): NonNullable<LayoutItem['clipRect']> | undefined {
  const c = clip.crop;
  if (!c) return undefined;
  const top = Math.max(0, c.top ?? 0);
  const right = Math.max(0, c.right ?? 0);
  const bottom = Math.max(0, c.bottom ?? 0);
  const left = Math.max(0, c.left ?? 0);
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
  const x = box.x + box.w * left;
  const y = box.y + box.h * top;
  const w = Math.max(1, box.w * (1 - left - right));
  const h = Math.max(1, box.h * (1 - top - bottom));
  // 箱の回転も渡す（矩形を同じだけ回して、箱の辺に沿って切る）。
  return { id: clip.id, x, y, w, h, ...(box.rotation ? { rotation: box.rotation } : {}) };
}

/**
 * 「残った素材を枠いっぱいに映す」ときの素材の矩形（#634）。効かないとき（種別が違う／指定が無い／
 * 切り抜きが無い／実寸が分からない）は `undefined`＝呼び出し側は従来どおり `mask` として描く。
 */
function fillOf(
  clip: TimelineClip,
  box: Box,
  assetSizeOf: TimelineLayoutOptions['assetSizeOf'],
): FillPlacement | undefined {
  if (clip.kind !== TIMELINE_CLIP_KIND.slot || clip.cropMode !== CROP_MODE.fill) return undefined;
  if (!clip.assetId || !hasCrop(clip.crop)) return undefined;
  const size = assetSizeOf?.(clip.assetId);
  if (!size || size.w <= 0 || size.h <= 0) return undefined;
  return fillPlacement(size, box, clip.crop, clip.fit ?? DEFAULT_FIT, clip.cropAlign);
}

/** 箱そのものを切り抜き矩形にする（回転も箱に合わせる）。 */
function boxRect(id: string, box: Box): NonNullable<LayoutItem['clipRect']> {
  return { id, x: box.x, y: box.y, w: box.w, h: box.h, ...(box.rotation ? { rotation: box.rotation } : {}) };
}

/** 1辺でも隠していれば true（`cropRectOf` と同じ判定＝どちらの効かせ方でも入口を揃える）。 */
function hasCrop(c: TimelineClip['crop']): boolean {
  return !!c && (Math.max(0, c.top ?? 0) > 0 || Math.max(0, c.right ?? 0) > 0 || Math.max(0, c.bottom ?? 0) > 0 || Math.max(0, c.left ?? 0) > 0);
}

/**
 * 素材の矩形を、**箱の中心まわりに回した**位置へ寄せるずれ量（#634）。
 * 自分の中心で回るアイテムに、箱の中心で回った結果と同じ絵を出させるための平行移動。
 */
function pivotShift(fill: FillPlacement, box: Box): { dx: number; dy: number } {
  if (!box.rotation) return { dx: 0, dy: 0 };
  const rad = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 箱の中心から見た素材の中心（回す前）。
  const dx = fill.x + fill.w / 2 - box.w / 2;
  const dy = fill.y + fill.h / 2 - box.h / 2;
  return { dx: dx * cos - dy * sin - dx, dy: dx * sin + dy * cos - dy };
}
