// タイムライン形式（ADR-0032）の「ある瞬間の1フレーム」を配置解決する（#629）。純粋関数（副作用なし）。
//
// **1枚のフレームを描く核は場面形式と共有する**（ADR-0032「違うのは並べ方だけ」）＝ここは
// 「その時刻に生きているクリップを、トラックの並び順に重ねる」だけを担い、1クリップの中身は
// `layoutScene` に委ねる。こうするとテンプレの層解決・FREE 要素・文字の体裁・キーフレームの重ね方が
// 両形式で1つの実装に収まり、プレビュー＝書き出しのパリティ（ADR-0001）を二重に作らずに済む。
import { DEFAULT_CHARACTER_ID, dimsForOrientation } from '../domain/constants';
import { FREE_CATEGORY, NARRATION_STATUS, TEXT_KEY, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import type { FreeElementKind, TimelineClipKind } from '../domain/enums';
import { composeGroupGeometry, isHiddenByGroup } from '../domain/group/compose';
import { groupElementIds } from '../domain/project/groupOps';
import type { Group } from '../domain/group/types';
import { interpolateKeyframes } from '../domain/project/keyframes';
import type { InterpolatedTransform } from '../domain/project/keyframes';
import type { FreeElement, Scene } from '../domain/project/types';
import { TEMPLATE_SCHEMA_VERSION } from '../domain/template/types';
import type { Template } from '../domain/template/types';
import { clipEndSec } from '../domain/timeline/validateTimelineDoc';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { applyInterpolatedTransform, DEFAULT_BACKGROUND_COLOR, layoutScene } from './layout';
import type { LayoutItem, SceneLayout } from './layout';
import type { Orientation } from '../domain/enums';

/** クリップが時刻 t に生きているか。区間は `[startSec, startSec+durationSec)`（V24 と同じ半開区間）。 */
export function clipIsLiveAt(clip: TimelineClip, timeSec: number): boolean {
  return timeSec >= clip.startSec && timeSec < clipEndSec(clip);
}

/**
 * 映像として描くクリップか（音だけのものは絵を持たない）。
 * **網羅 switch**（`never` チェック）で書くのは、`TimelineClipKind` に種別が増えたとき「映像扱いのまま
 * 描き方が無く黙って何も出ない」を型で止めるため（ADR-0032 決定19 の取りこぼし防止と同じ流儀）。
 */
function isVisualClip(clip: TimelineClip): boolean {
  const kind: TimelineClipKind = clip.kind;
  switch (kind) {
    case TIMELINE_CLIP_KIND.slot:
    case TIMELINE_CLIP_KIND.text:
    case TIMELINE_CLIP_KIND.shape:
    case TIMELINE_CLIP_KIND.subtitle:
    case TIMELINE_CLIP_KIND.template:
      return true;
    case TIMELINE_CLIP_KIND.audio:
    case TIMELINE_CLIP_KIND.voice:
      return false;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
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

/**
 * クリップを、場面形式の Scene へ写して `layoutScene` に渡せる形にする（**保存しない・このフレームの中だけ**）。
 *
 * `sceneType` は**実際に使う見た目の `category`** を入れる＝`11 §3.2`「`scene.sceneType` と `template.category` は
 * 同じ値集合を共有する」に合わせる（描画は `template.category` で分岐するので絵は変わらないが、
 * `sceneType` を読む規則〔例 `isFreeScene`〕と同じ形の後続コードが誤読しないようにする）。
 */
function sceneFromClip(clip: TimelineClip, template: Template): Scene {
  return {
    // sceneId はこのフレームの中でだけ使う識別子。partId/warnings も器を満たすためのダミー（保存も検証もしない）。
    sceneId: clip.id,
    partId: '',
    order: 0,
    sceneType: template.category,
    templateId: clip.templateId ?? '',
    durationSec: clip.durationSec,
    assetRefs: clip.assetRefs ?? {},
    character: clip.character ?? { enabled: false, characterId: DEFAULT_CHARACTER_ID },
    texts: subtitleAwareTexts(clip),
    narration: { text: '', status: NARRATION_STATUS.none },
    warnings: [],
    ...(clip.textStyles ? { textStyles: clip.textStyles } : {}),
    ...(clip.slotFits ? { slotFits: clip.slotFits } : {}),
    ...(clip.textFontIds ? { textFontIds: clip.textFontIds } : {}),
    ...(clip.slotClips ? { slotClips: clip.slotClips } : {}),
    ...(clip.fontId != null ? { fontId: clip.fontId } : {}),
  };
}

/**
 * 字幕のクリップ（`kind:'subtitle'`）が持つ**焼き付けた文言**を、`texts.subtitle` として渡す。
 *
 * FREE 字幕要素は表示文を「対象（`subtitleSource`）」から解決する（ADR-0029）が、タイムライン形式に対象の語彙は
 * 無い（連動は #633）。焼き出し（#628 `staticSubtitleText`）は**時間で変わらない字幕を `clip.text` へ焼き付ける**ので、
 * ここで `texts.subtitle` に載せて既定の対象（＝読み上げ）から解決させる。これが無いと、
 * **「黙って消さない」ために焼き付けた字幕が受け側で1つも描かれない**（§2-5・#642 レビュー 🔴）。
 */
function subtitleAwareTexts(clip: TimelineClip): NonNullable<Scene['texts']> {
  const texts = clip.texts ?? {};
  if (clip.kind !== TIMELINE_CLIP_KIND.subtitle || !clip.text) return texts;
  return { ...texts, [TEXT_KEY.subtitle]: clip.text };
}

/** 自由配置のクリップ（slot/text/shape/subtitle）を FREE 要素へ写す。空間の語彙は同じもの（11 §7.6）。 */
function freeElementFromClip(clip: TimelineClip, canvas: { width: number; height: number }): FreeElement {
  // **持っていくものを名指しする**（要らないものを除外する形にしない）＝`TimelineClip` に時間や音の
  // フィールドが増えたとき、rest 経由で FreeElement へ黙って流れ込まない。空間の語彙は 11 §7.6。
  const el: FreeElement = { ...clipBox(clip, canvas), id: clip.id, kind: clip.kind as FreeElementKind };
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
        : emptyFreeTemplate(canvas, doc.videoSettings.aspectRatio);
    if (!template) continue; // 見た目が見つからないクリップは描かない（案内は呼び出し側）

    const scene =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? sceneFromClip(clip, template)
        : { ...sceneFromClip(clip, template), freeLayout: [freeElementFromClip(clip, canvas)] };
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

    // 見た目パターンの下地（`template.defaults.backgroundColor`）は、場面形式ではフレーム全体を塗る。
    // タイムラインでは「そのクリップの下地」なので、クリップの箱ぶんの塗りとして最背面へ足す
    // ＝背景の層を持たない見た目でも下地が黙って白にならない。
    const clipItems: LayoutItem[] =
      clip.kind === TIMELINE_CLIP_KIND.template
        ? [{ id: `${clip.id}__bg`, kind: 'fill', ...box, zIndex: -1, color: sub.backgroundColor, opacity: 1, radius: 0 }, ...sub.items]
        : sub.items;

    for (const item of clipItems) {
      applySimilarity(item, sim);
      // 文字のフォント：クリップ全体の指定（`fontId`）は、種別ごとの指定が無いときの受け皿。
      // 場面形式は「フレーム単位の fontFamily」で効かせるが、1フレームに複数クリップが混ざる本形式では
      // それができないので、アイテムへ落とす（テンプレのクリップだけ黙って既定へ戻るのを防ぐ・ADR-0026②）。
      if (item.kind === 'text' && item.fontId == null && clip.fontId != null) item.fontId = clip.fontId;
      // 不透明度は幾何と違い**クリップ全体に等しく効く**（相似変換では運べない）ので別に重ねる。
      // **自身のキーフレームもグループも乗算**にする＝アイテムごとの絶対上書きだと、区間外クランプで
      // 層自身の不透明度（例 0.4 の層）がフェード終了後に 1 へ化ける（黙って別物になる・ADR-0026④）。
      if (ownTr.opacity != null) item.opacity = (item.opacity ?? 1) * ownTr.opacity;
      if (groupO != null) item.opacity = (item.opacity ?? 1) * groupO;
      // 重ね順はトラックの並び順だけで決める＝クリップの中の順序を保ったまま、後のトラックほど手前へ。
      items.push({ ...item, id: `${clip.id}/${item.id}`, zIndex: items.length });
    }
  }

  return { width: canvas.width, height: canvas.height, backgroundColor: DEFAULT_BACKGROUND_COLOR, items };
}
