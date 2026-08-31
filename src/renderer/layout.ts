// シーン＋テンプレ → 各レイヤーの配置（矩形・zIndex・内容・スタイル）を解決する純粋ロジック。
// preview / export の双方が共有する（ADR-0001：方式A2ハイブリッド。描画一致の根拠）。
// テキストの実描画（折返し・計測）は描画エンジンに委ねるが、配置はここで決定論的に決める。
import { FIT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, LAYER_TYPE } from '../domain/enums';
import type { Fit, FreeShapeType, TextAlign } from '../domain/enums';
import { DEFAULT_FIT, SHAPE_FILL_FALLBACK_COLOR, DEFAULT_BACKGROUND_COLOR } from '../domain/constants';
import type { CropAlignX, CropAlignY } from '../domain/enums';
import type { ElementAnimation, Scene } from '../domain/project/types';
import type { Template, TextShadow } from '../domain/template/types';
import { DEFAULT_LINE_HEIGHT, DEFAULT_TEMPLATE_MAX_LINES, linesForBoxHeight, resolveStrokeColor, resolveTextStyle } from '../domain/template/textStyle';
import { effectiveLayerZ } from '../domain/template/layerOrder';
import { composeGroupGeometry, isHiddenByGroup } from '../domain/group/compose';
import { interpolateKeyframes } from '../domain/project/keyframes';
import type { InterpolatedTransform } from '../domain/project/keyframes';
import { groupElementIds } from '../domain/project/groupOps';
import { groupIndices, resolveLineSubtitle } from '../domain/project/lineTimeline';
import type { SceneSegmentSpec } from '../domain/project/lineTimeline';
import { sceneLines } from '../domain/project/narrationLines';
import { resolveSubtitleForElement, type SubtitleMoment } from '../domain/project/subtitleBinding';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ItemBase extends Rect {
  id: string;
  zIndex: number;
  /** 回転角（度・中心を軸に時計回り。FREE 要素のみ設定・未指定=回転なし・#208）。 */
  rotation?: number;
  /**
   * **合成の単位**（ADR-0032 決定19・#631）。同じ `key` を持つ**連続した**アイテムは1枚に合成してから
   * `opacity` を掛ける。フェードを「層ごとに α」でなく「1枚にしてから α」にするため＝FFmpeg の
   * `xfade=fade`（線形ブレンド）と同じ絵になる（層が重なる所で下が透けない）。
   * **key と opacity を1つの объект にしてある**のは、片方だけ設定して黙って無視される状態を型で防ぐため。
   * 場面形式は設定しない（従来どおりアイテムごと）＝この仕組みは出力に影響しない。
   */
  composite?: { key: string; opacity: number };
  /**
   * **切り抜き**（ADR-0032・#634）。この矩形（キャンバス座標）の外は描かない。
   * 同じ矩形を持つ**連続した**アイテムは1つの切り抜きでまとめて包む（`composite` と同じ流儀）。
   * 場面形式は設定しない（従来どおり切り抜き無し）＝この仕組みは出力に影響しない。
   */
  clipRect?: { id: string; x: number; y: number; w: number; h: number; rotation?: number };
}

export interface FillItem extends ItemBase {
  kind: 'fill';
  color: string;
  opacity: number;
  radius: number;
  /** 図形種別（freeLayout shape）。未指定＝rect。rect/ellipse/rounded_rect/triangle/star/arrow/speech_bubble。 */
  shapeType?: FreeShapeType;
  /** 枠線（#173・任意）。strokeWidth>0 のとき描画。 */
  strokeColor?: string;
  strokeWidth?: number;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /**
   * 素材の**寄せ**（#634）。`fit:'cover'` で枠に収まらない側をどこで切るか（未指定＝中央）。
   * 場面形式は設定しない（従来どおり中央）＝出力不変。
   */
  align?: { x?: CropAlignX; y?: CropAlignY };
  assetId: string | null;
  fit: Fit;
  role: 'background' | 'slot' | 'character' | 'logo';
  label: string;
  /** 要素の不透明度（0..1・アニメの opacity 適用先・④ ADR-0019）。未指定＝1（不透明）。 */
  opacity?: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  maxLines: number;
  background?: { color: string; opacity: number; radius: number };
  /** 字間（em・#264）。未指定＝0（従来の出力は不変）。 */
  letterSpacing?: number;
  /** 文字の影（#264）。`enabled` のものだけが入る（描く側は条件を持たない）。 */
  shadow?: TextShadow;
  /** subtitle レイヤー由来か（書き出しの「字幕を入れる」ON/OFFで判定に使う）。layoutScene が常に設定する。 */
  isSubtitle: boolean;
  /**
   * 下端を基準に上へ伸ばすか（テンプレ字幕帯の複数行対策・ADR-0031）。true のとき、行が増えても最終行は元の1行位置に
   * 留まり、追加行と背景は**上方向**へ積む＝画面下端に置いた字幕帯が2行で画面外へはみ出さない。FREE 字幕（利用者が箱を
   * 置く）は未設定＝従来どおり上端起点で下へ伸ばす（箱の高さは利用者管理）。
   */
  anchorBottom?: boolean;
  /** この要素自身のフォント id（#178）。既知ならこれを使い、未指定/不明は場面既定（描画側 fontFamily）へ。 */
  fontId?: string | null;
  /** 行間（倍率・未指定=1.3）・揃え（未指定=left）・縁取り（FREE text の体裁・#209）。 */
  lineHeight?: number;
  textAlign?: TextAlign;
  strokeColor?: string;
  strokeWidth?: number;
  /** 要素の不透明度（0..1・アニメの opacity 適用先・④ ADR-0019）。未指定＝1（不透明）。 */
  opacity?: number;
}

export type LayoutItem = FillItem | ImageItem | TextItem;

/**
 * 字幕由来の描画アイテムか（テンプレ字幕層・FREE 字幕・掛け合い字幕）。「字幕を入れる」OFF で除外する対象を1か所で定義する。
 * 書き出し（buildExportScenes の itemFilter）と仕上がり確認（ScenePreview の hideSubtitles）が**同じ判定**で字幕を消す
 * ＝プレビュー＝書き出しのパリティ（ADR-0001・ADR-0026③・#547 P2-7）。
 */
export function isSubtitleItem(item: LayoutItem): boolean {
  return item.kind === 'text' && item.isSubtitle;
}

export interface SceneLayout {
  width: number;
  height: number;
  backgroundColor: string;
  /** zIndex 昇順（描画順）。 */
  items: LayoutItem[];
}

// テキストの既定色/既定サイズは domain（template/textStyle）が正典＝描画・インライン編集・体裁欄・
// 通常→FREE 変換の4か所で共有する（§2-7）。既存の import 元を保つため、ここから re-export する。
export { DEFAULT_TEXT_COLOR, DEFAULT_FONT_SIZE } from '../domain/template/textStyle';


// 背景帯の既定も domain（template/textStyle）が正典＝#264 で場面の上書きも帯を持つようになったので、
// 解決の場所（`resolveTextStyle`）の隣へ移した。ここからは再輸出だけ（既存の import 経路を保つ・
// `DEFAULT_LINE_HEIGHT` と同じ流儀）。**インライン編集（FreeLayoutOverlay）も同じ既定で敷く**（#549）。
export { bandBackground } from '../domain/template/textStyle';
// 既定行間も domain（template/textStyle）が正典＝FREE の行数導出・通常→FREE 変換・描画で共有（§2-7）。
export { DEFAULT_LINE_HEIGHT } from '../domain/template/textStyle';
import { drawnTextRect, stackedSubtitleBands } from '../domain/text/subtitleBands';
import { rotatedBounds } from '../domain/preview/safeArea';
// 字幕帯の積み方（同時字幕・ADR-0031）は **domain が正典**＝描画・はみ出し判定・焼き出し（#633）で共有する。
// ここからは再輸出だけ（既存の import 経路を保つ・`DEFAULT_LINE_HEIGHT` と同じ流儀）。
export { SUBTITLE_BAND_PAD_EM, SUBTITLE_STACK_GAP_EM, stackedSubtitleBands, drawnTextRect } from '../domain/text/subtitleBands';

/** 字幕帯アイテム1つが回転後にキャンバス外へ出るか（上下左右すべての辺）。矩形＝x/y/w＋折返し行数＋anchorBottom、rotation は中心軸で回して AABB 判定（#533 P2）。 */
function subtitleItemOutOfCanvas(item: TextItem, canvasW: number, canvasH: number): boolean {
  // ⚠️ **描かれる矩形の式も1か所**（α-6 出口監査 ℹ️）＝「端に寄った文字」の注意（`outsideSafeArea`）が
  // 置いた箱を見ていて、こちらと**別の矩形**だった（帯は上へ伸び、高さは実際の折返し行数で決まる）。
  // ⚠️ **回した後の外枠の式も1か所**（PR #878 再レビュー ℹ️）＝別々に書くと、片方だけ回転を見る／
  // 見ないが起きる（実際に起きていた）。
  const b = rotatedBounds(drawnTextRect({ ...item, isSubtitle: true }));
  return b.x < 0 || b.y < 0 || b.x + b.w > canvasW || b.y + b.h > canvasH;
}

/**
 * その場面が**実際に描く**レイアウトをすべて数え上げる（#346）。
 *
 * ⚠️ **`layoutScene(scene, template)` を opts なしで1回呼ぶだけでは足りない**＝掛け合い
 *（`scene.lines`）の場面では、**実際に描かれる行ごとの字幕**（`subtitleText`/`subtitleSegment`）が
 * 一度も出てこず、代わりに**動画に出ない静的字幕**（`texts.subtitle`）が載る。
 * つまり検査すると**掛け合いは見落とし、休眠は誤検出**する（`/canon-check` の2エージェントが
 * 独立に実測で指摘）。同じ取りこぼしは #547 P1-3・#563 でも一度潰している。
 *
 * `subtitleOverflowsCanvas` が持っていた数え上げをここへ出し、**同じものを見る検査で共有**する。
 */
export function sceneDrawnLayouts(scene: Scene, template: Template): SceneLayout[] {
  // 単独ナレーション（lines 無し）＝静的字幕（`texts.subtitle`）をそのまま描く経路。
  // opts を渡さない＝layoutScene 内の `subtitleEnabledDefault === false` で消える扱いもそのまま効く（#413）。
  if (!scene.lines || scene.lines.length === 0) return [layoutScene(scene, template)];
  const lines = sceneLines(scene);
  return groupIndices(lines).map((g) => {
    const primary = lines[g[0]];
    const primarySub = resolveLineSubtitle(primary, scene);
    const seg: SceneSegmentSpec = {
      lineId: primary.lineId,
      parallelLineIds: g.slice(1).map((i) => lines[i].lineId),
      startSec: 0,
      durationSec: scene.durationSec,
      isFirst: true,
    };
    return layoutScene(scene, template, { subtitleText: primarySub.enabled ? primarySub.text : null, subtitleSegment: seg });
  });
}

/**
 * 同時字幕（ADR-0031）が**キャンバス外へはみ出す**か（#533 レビュー P2）。**実描画（`layoutScene`）の字幕アイテム**を基に、
 * 各同時グループで生成される全テンプレ字幕層×全帯を、回転・グループ transform・非表示込みで**上下左右すべての辺**で判定する
 * （2個目の字幕層・下移動・回転・N人長文の見切れを実描画と一致して検出）。FREE 字幕は利用者配置ゆえ対象外。純粋関数。
 */
export function subtitleOverflowsCanvas(scene: Scene, template: Template): boolean {
  const { width, height } = template.canvas;
  // テンプレ字幕層の id（同時行の追加帯は `${id}__subN`）。FREE 字幕（free_NNN）と区別するのに使う。
  const subtitleLayerIds = new Set(template.layers.filter((l) => l.type === LAYER_TYPE.subtitle).map((l) => l.id));
  if (subtitleLayerIds.size === 0) return false;
  // 実描画（layoutScene）の結果からテンプレ字幕層由来の帯だけを全辺で検査する（回転・グループ transform・非表示は layout が反映済み）。
  const overflows = (layout: SceneLayout): boolean =>
    layout.items.some(
      (item) =>
        item.kind === 'text' && item.isSubtitle &&
        subtitleLayerIds.has(item.id.split('__sub')[0]) && // FREE 字幕は対象外（利用者配置）
        subtitleItemOutOfCanvas(item, width, height),
    );
  // 数え上げは共有（`sceneDrawnLayouts`）＝**実際に描かれるもの**だけを見る。
  // 同時グループ（2行以上）は帯を積む。**逐次/単独行（1行）も対象**＝1帯でも拡大・回転・長文で見切れるため（#563）。
  // 以前は `g.length < 2` で読み飛ばしており、#555（文字の体裁の場面別上書き）で字幕を大きくできるようになって
  // 到達性が上がった＝「黙って画面外に切れる」が単独/逐次だけ検出できない非対称になっていた（ADR-0026④）。
  return sceneDrawnLayouts(scene, template).some(overflows);
}

/** layoutScene のオプション（掛け合いの行字幕の上書き等・ADR-0015 追加A/B）。 */
export interface LayoutOptions {
  /**
   * subtitle レイヤーの文言を上書きする。string＝その文言を表示／null＝字幕を出さない（行で OFF）／
   * 未指定＝従来どおり scene.texts['subtitle'] を使う。
   */
  subtitleText?: string | null;
  /**
   * FREE 字幕要素（ADR-0029）の対象解決に使う「その瞬間のセグメント」。掛け合いは呼び出し側が sceneSegmentSpecs の
   * 現在セグメント（書き出し）／現在行（プレビュー）を渡す＝プレビュー=書き出しで同一。未指定は場面全体の1セグメント。
   */
  subtitleSegment?: SceneSegmentSpec | null;
  /**
   * キーフレームアニメの再生位置（場面ローカル秒・④・ADR-0019）。指定時、この場面の animations を補間して対象要素へ適用する。
   * 未指定＝静止（後方互換）。preview/export は同一の timeSec/animations で呼び、フレーム単位パリティを保つ。
   */
  timeSec?: number;
  /** この場面の要素アニメーション（timelineOverlay.animations のうち sceneId 一致分）。timeSec と併せて渡す。 */
  animations?: ElementAnimation[];
}


/** `applyInterpolatedTransform` が触る最小の形（矩形＋不透明度）。`LayoutItem` もクリップの箱もこれを満たす。 */
export interface TransformableRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
}

/**
 * 補間済みの変換を1つの矩形へ重ねる（④・ADR-0019）。**変換は「本来の状態」からの相対値**（CSS transform 相当）
 * ＝後から位置/大きさ/角度を編集しても追従する（絶対焼き込みだと編集後に古い値で固定される）。
 * `scale`（中心維持）→ `x`/`y` オフセット → `rotation` オフセットの順に重ね、`opacity` だけは絶対
 * （fill=塗り／image・text=要素全体＝`sceneSvg` の `<g opacity>`）。
 *
 * **場面形式（`layoutScene` の要素アニメ）とタイムライン形式（`layoutTimelineAt` のクリップの箱）が
 * この関数を呼ぶ**＝同じ「キーフレームの重ね方」を2か所に書かない（片方だけ直って絵が割れるのを防ぐ・§6）。
 * 引数を `LayoutItem` でなく矩形にしてあるのは、タイムライン側が**クリップの箱**に対して同じ規則を使うため。
 */
export function applyInterpolatedTransform(item: TransformableRect, tr: InterpolatedTransform): void {
  if (tr.scale != null) {
    const ow = item.w;
    const oh = item.h;
    item.w *= tr.scale;
    item.h *= tr.scale;
    item.x -= (item.w - ow) / 2;
    item.y -= (item.h - oh) / 2;
  }
  if (tr.x != null) item.x += tr.x;
  if (tr.y != null) item.y += tr.y;
  if (tr.rotation != null) item.rotation = (item.rotation ?? 0) + tr.rotation;
  if (tr.opacity != null) item.opacity = tr.opacity;
}

/** シーンをテンプレに沿って配置解決する。 */
export function layoutScene(scene: Scene, template: Template, opts?: LayoutOptions): SceneLayout {
  const backgroundColor = template.defaults?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const items: LayoutItem[] = [];

  // グループ transform を前合成（ADR-0022）。グループ無しは passthrough＝出力差分なし。
  const layerGeom = composeGroupGeometry(template.layers, template.groups ?? []);
  const templateGroups = template.groups ?? [];

  for (const layer of template.layers) {
    if (isHiddenByGroup(layer.id, templateGroups)) continue; // hidden グループのメンバーは描画しない
    const cg = layerGeom.get(layer.id) ?? { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    const base: ItemBase = { id: layer.id, x: cg.x, y: cg.y, w: cg.w, h: cg.h, zIndex: effectiveLayerZ(layer) };
    if (cg.rotation) base.rotation = cg.rotation; // 0/未指定は付けない＝グループ未所属は従来どおり

    switch (layer.type) {
      case LAYER_TYPE.background: {
        const assetId = scene.assetRefs[layer.id] ?? layer.assetId ?? null; // 場面素材を優先・無ければテンプレ既定素材（ADR-0021）
        if (assetId) {
          items.push({ ...base, kind: 'image', assetId, fit: scene.slotFits?.[layer.id] ?? layer.fit ?? DEFAULT_FIT, role: 'background', label: '背景' });
        } else {
          items.push({ ...base, kind: 'fill', color: layer.fillColor ?? backgroundColor, opacity: layer.opacity ?? 1, radius: layer.radius ?? 0 });
        }
        break;
      }
      case LAYER_TYPE.slot: {
        const assetId = scene.assetRefs[layer.id] ?? layer.assetId ?? null; // 場面素材を優先・無ければテンプレ既定素材（ADR-0021）
        // ラベルは未解決時のプレースホルダ表示に使う。生の layer.id は技術用語漏れ（§2-3）なので日本語に。
        items.push({ ...base, kind: 'image', assetId, fit: scene.slotFits?.[layer.id] ?? layer.fit ?? DEFAULT_FIT, role: 'slot', label: '素材' });
        break;
      }
      case LAYER_TYPE.logo: {
        const assetId = scene.assetRefs[layer.id] ?? layer.assetId ?? null; // 場面素材を優先・無ければテンプレ既定素材（ADR-0021）
        if (assetId) {
          items.push({ ...base, kind: 'image', assetId, fit: scene.slotFits?.[layer.id] ?? layer.fit ?? FIT.contain, role: 'logo', label: 'ロゴ' });
        }
        break;
      }
      case LAYER_TYPE.character: {
        // ゆうこ表示はテンプレ依存（この case=character レイヤー有）。poseAssetId があれば表示する。
        // character.enabled（旧・場面ごと表示トグル）は廃止＝描画では参照しない（互換のため値は残す。req5・01§7.3）。
        if (scene.character.poseAssetId) {
          items.push({ ...base, kind: 'image', assetId: scene.character.poseAssetId, fit: layer.fit ?? FIT.contain, role: 'character', label: 'ゆうこ' });
        }
        break;
      }
      case LAYER_TYPE.shape:
      case LAYER_TYPE.decor: {
        // layer.shapeType は rect/ellipse/line。FillItem(=FreeShapeType: rect/ellipse)へ転送し、ellipse のみ楕円・他は rect。
        const shapeType: FreeShapeType =
          layer.shapeType === FREE_SHAPE_TYPE.ellipse ? FREE_SHAPE_TYPE.ellipse : FREE_SHAPE_TYPE.rect;
        items.push({ ...base, kind: 'fill', color: layer.fillColor ?? SHAPE_FILL_FALLBACK_COLOR, opacity: layer.opacity ?? 1, radius: layer.radius ?? 0, shapeType });
        break;
      }
      case LAYER_TYPE.text:
      case LAYER_TYPE.subtitle: {
        // 掛け合い：subtitle レイヤーのみ行の字幕で上書き（追加A/B）。null＝非表示・未指定＝従来。
        const overrideSub = layer.type === LAYER_TYPE.subtitle && opts != null && 'subtitleText' in opts;
        // 単一ナレーション等の静的字幕（override 無し）は場面の字幕トグル subtitleEnabledDefault=false で出さない（#413）。
        // preview/export とも layoutScene 経由なのでここが単一の参照元。掛け合いは opts.subtitleText 側で primary 行を
        // 解決済み（resolveLineSubtitle が subtitleEnabledDefault を継承）。同時行は下の parallelLineIds から解決する。
        const isSub = layer.type === LAYER_TYPE.subtitle;
        const staticSubtitleOff = isSub && !overrideSub && scene.subtitleEnabledDefault === false;
        const text = overrideSub
          ? opts.subtitleText ?? ''
          : staticSubtitleOff
            ? ''
            : layer.textKey ? scene.texts[layer.textKey] ?? '' : '';
        // ⚠️ **帯は字幕だけのものではなくなった**（#264）＝文字層にも出す。
        // 以前は `isSub` で切っていたので、テンプレ作者が文字層に帯を設定しても**描かれなかった**。
        // ⚠️ **場面の上書きも効かせる**（`style.background`）＝場面ごとに帯を出し入れできる。
        // 文字の体裁は場面別に上書きできる（#555・schema 1.24）。未指定はテンプレ層→既定を継承＝
        // 触ったものだけが固有値（フォント＝textFontIds と同型・§2-4 の対象は配置なので体裁は自由化してよい）。
        // 解決は共有 resolveTextStyle（場面編集の体裁欄と同じ関数＝欄の「テンプレに合わせる」表示と描画が一致）。
        const style = resolveTextStyle(layer, layer.textKey ? scene.textStyles?.[layer.textKey] : undefined);
        // fontSize は下の stackedSubtitleBands（同時字幕の段組み）にも渡るため、**上書き後の値**を使う
        // ＝上書きで文字が大きくなっても帯が重ならない（#533 P1 の実折返し行数計算と同じ値）。
        const fontSize = style.fontSize;
        // 字幕帯を1つ積む（y を差し替え・id を一意化）。primary はテンプレ位置、同時行はその上へ（ADR-0031）。
        const pushBand = (bandText: string, y: number, idSuffix: string): void => {
          items.push({
            ...base,
            id: base.id + idSuffix,
            y,
            kind: 'text',
            text: bandText,
            fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            maxLines: layer.maxLines ?? DEFAULT_TEMPLATE_MAX_LINES,
            background: style.background,
            isSubtitle: isSub,
            // テンプレ字幕は下端基準で上へ伸ばす（1帯が2行でも画面下端からはみ出さない・ADR-0031）。text 層は従来どおり。
            anchorBottom: isSub,
            fontId: layer.textKey ? scene.textFontIds?.[layer.textKey] : undefined,
            // 縁取り（#275）。太さ>0 で色未指定なら既定色（resolveTextStyle が担保）。
            strokeColor: style.strokeColor,
            strokeWidth: style.strokeWidth,
            // 字間・影（#264）。`enabled` の判定は `resolveTextStyle` で済んでいる。
            letterSpacing: style.letterSpacing,
            shadow: style.shadow,
          });
        };
        // 表示する帯（下→上の順）＝primary（あれば）＋同時行（enabled・ADR-0031）。primary は layer.id 据え置き（後方互換）。
        const bands: { text: string; idSuffix: string }[] = [];
        if (text.length > 0) bands.push({ text, idSuffix: '' });
        if (isSub) {
          let k = 1;
          for (const lineId of opts?.subtitleSegment?.parallelLineIds ?? []) {
            const line = sceneLines(scene).find((l) => l.lineId === lineId);
            if (line == null) continue;
            const sub = resolveLineSubtitle(line, scene);
            if (!sub.enabled || sub.text.length === 0) continue; // OFF/空は帯を作らない（段も詰めない）
            bands.push({ text: sub.text, idSuffix: `__sub${k}` });
            k += 1;
          }
        }
        // 帯を配置：字幕は下→上に積む（実折返し行数で詰める＝重ならない・共有 stackedSubtitleBands・#533 P1）。text 層は単一で base.y。
        if (isSub) {
          // ⚠️ **字間も渡す**（#928）＝渡さないと折返し行数が実際より少なく出て、**帯が重なる**
          // （段を詰める計算が実折返し行数を前提にしているため）。
          const placed = stackedSubtitleBands(bands.map((b) => b.text), base.y, base.w, fontSize, layer.maxLines ?? DEFAULT_TEMPLATE_MAX_LINES, style.letterSpacing ?? 0);
          bands.forEach((b, i) => pushBand(b.text, placed[i].y, b.idSuffix));
        } else if (bands.length > 0) {
          pushBand(bands[0].text, base.y, bands[0].idSuffix);
        }
        break;
      }
    }
  }

  // グループアニメ（④(3)・ADR-0019）：グループ(group_NNN)を対象にした animation を、合成前に静的 transform へ重ねる
  // （位置=加算／拡縮=乗算／回転=加算・グループ中心は不変）。opacity はメンバー要素へ乗算で後段適用。FREE 場面のみ。
  const sceneGroups = template.category === FREE_CATEGORY ? scene.groups ?? [] : [];
  const groupAnim = new Map<string, InterpolatedTransform>();
  if (opts?.timeSec != null && opts.animations && sceneGroups.length > 0) {
    const groupIds = new Set(sceneGroups.map((g) => g.id));
    for (const a of opts.animations) {
      if (a.sceneId === scene.sceneId && groupIds.has(a.targetId)) {
        groupAnim.set(a.targetId, interpolateKeyframes(a.keyframes, opts.timeSec));
      }
    }
  }
  const effectiveGroups = groupAnim.size === 0
    ? sceneGroups
    : sceneGroups.map((g) => {
        const tr = groupAnim.get(g.id);
        return tr
          ? { ...g, transform: {
              x: g.transform.x + (tr.x ?? 0),
              y: g.transform.y + (tr.y ?? 0),
              scale: g.transform.scale * (tr.scale ?? 1),
              rotation: g.transform.rotation + (tr.rotation ?? 0),
            } }
          : g;
      });

  // FREE テンプレ場面のみ：scene.freeLayout の要素を LayoutItem として重ねる（ADR-0008）。テンプレ層の上に zIndex 順。
  // 通常テンプレに誤って freeLayout が付いても描画しない（防御。category で判定）。
  if (template.category === FREE_CATEGORY) {
    const elGeom = composeGroupGeometry(scene.freeLayout ?? [], effectiveGroups);
    // FREE 字幕要素の対象解決に使う「その瞬間のセグメント」（ADR-0029）。掛け合いは呼び出し側が opts.subtitleSegment を渡す
    // （書き出し=sceneSegmentSpecs の現在セグメント／プレビュー=現在行）。未指定は場面全体の1セグメント＝単独 narration が texts.subtitle を読む。
    const subMoment: SubtitleMoment = {
      segment: opts?.subtitleSegment ?? { startSec: 0, durationSec: scene.durationSec, isFirst: true },
    };
    for (const el of scene.freeLayout ?? []) {
      if (el.hidden) continue; // 非表示の要素は描画しない（レイヤー一覧で隠す・#210）。
      if (isHiddenByGroup(el.id, effectiveGroups)) continue; // hidden グループのメンバーも描画しない（ADR-0022）。
      // zIndex 未指定は 1（背景=0 より前面に置く）。rotation はグループ合成後の値（未所属＝el.rotation）。
      const cg = elGeom.get(el.id) ?? { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
      const base: ItemBase = { id: el.id, x: cg.x, y: cg.y, w: cg.w, h: cg.h, zIndex: el.zIndex ?? 1, rotation: cg.rotation };
      switch (el.kind) {
        case 'slot':
          items.push({ ...base, kind: 'image', assetId: el.assetId ?? null, fit: el.fit ?? DEFAULT_FIT, role: 'slot', label: '素材' });
          break;
        case 'text': {
          const text = el.text ?? '';
          if (text.length === 0) break;
          // ⚠️ **体裁の解決は通常テンプレ層と同じ関数を通す**（`resolveTextStyle`・PR #879 レビュー 🔴）＝
          // 手組みで並べていたので、**新しい項目（影・字間）を足したときに FREE 側だけ漏れた**。
          // 通せば、以後この種の追加で同じ漏れが起きない（縁取りの解決も中に入っている・#565）。
          // ⚠️ **`fontSize`/`color` も同じ関数から採る**（α-6 出口監査 ℹ️）＝この2つだけ外で解いていたので、
          // 上書き層が入ったときに**この2項目だけ拾わない**形になっていた（いまは同値）。
          const st = resolveTextStyle(el);
          const fontSize = st.fontSize;
          const lineHeight = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
          const maxLines = linesForBoxHeight(el.h, fontSize, lineHeight);
          const color = st.color;
          items.push({ ...base, kind: 'text', text, fontSize, fontWeight: st.fontWeight, color, maxLines, isSubtitle: false, fontId: el.fontId, lineHeight: el.lineHeight, textAlign: el.textAlign, strokeColor: st.strokeColor, strokeWidth: st.strokeWidth, background: st.background, letterSpacing: st.letterSpacing, shadow: st.shadow });
          break;
        }
        case 'shape': {
          // 図形の枠線も同じ規則（下地＝塗りの色）。塗りと同じ色になって枠線が消えない（#565）。
          const fillColor = el.fillColor ?? SHAPE_FILL_FALLBACK_COLOR;
          items.push({ ...base, kind: 'fill', color: fillColor, opacity: el.opacity ?? 1, radius: el.radius ?? 0, shapeType: el.shapeType ?? FREE_SHAPE_TYPE.rect, strokeColor: resolveStrokeColor(el.strokeWidth, el.strokeColor, fillColor), strokeWidth: el.strokeWidth });
          break;
        }
        case FREE_ELEMENT_KIND.subtitle: {
          // 表示文言は対象（subtitleSource）から解決＝el.text は持たない（ADR-0029）。対象に一致しない/間/OFF は非表示。
          // isSubtitle:true＝「字幕を出さない」書き出し（withSubtitle=false）でテンプレ字幕と同じく除外される（buildExportScenes）。
          const subText = resolveSubtitleForElement(el, scene, subMoment);
          if (subText == null || subText.length === 0) break;
          // 体裁の解決は上の `text` と同じ関数（`resolveTextStyle`）を通す（漏れを構造で防ぐ）。
          // ⚠️ **`fontSize`/`color` もここから採る**（α-6 出口監査 ℹ️・上の `text` と同じ理由）。
          const subSt = resolveTextStyle(el);
          const fontSize = subSt.fontSize;
          const lineHeight = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
          const maxLines = linesForBoxHeight(el.h, fontSize, lineHeight);
          const color = subSt.color;
          items.push({ ...base, kind: 'text', text: subText, fontSize, fontWeight: subSt.fontWeight, color, maxLines, isSubtitle: true, fontId: el.fontId, lineHeight: el.lineHeight, textAlign: el.textAlign, strokeColor: subSt.strokeColor, strokeWidth: subSt.strokeWidth, background: subSt.background, letterSpacing: subSt.letterSpacing, shadow: subSt.shadow });
          break;
        }
      }
    }
  }

  // キーフレームアニメ（④・ADR-0019）：timeSec 指定時、この場面の対象要素へ補間した transform を適用する。
  // 変換は要素の「本来の状態」を基準とする相対値（CSS transform 相当）＝**後から位置/大きさ/角度を編集しても追従**する
  //  （絶対焼き込みだと編集後に古い値へ固定される・レビュー対応）。x/y=本来位置からのオフセット／scale=係数（中心維持）／
  //  rotation=本来角度からのオフセット。opacity は絶対（0..1・fill=塗り／image・text=要素全体＝sceneSvg の <g opacity>）。
  // static（timeSec 未指定/アニメ無し）は素通し＝後方互換。グループ対象は下（geometry は effectiveGroups で合成済・opacity のみ後段）。
  if (opts?.timeSec != null && opts.animations && opts.animations.length > 0) {
    const byTarget = new Map<string, ElementAnimation>();
    for (const a of opts.animations) {
      if (a.sceneId === scene.sceneId) byTarget.set(a.targetId, a);
    }
    for (const item of items) {
      const anim = byTarget.get(item.id); // グループ対象（group_NNN）はここでは一致しない＝要素だけ処理
      if (!anim) continue;
      applyInterpolatedTransform(item, interpolateKeyframes(anim.keyframes, opts.timeSec));
    }
  }
  // グループの opacity（④(3)）：メンバー要素（推移的）へ乗算で適用（geometry は effectiveGroups で合成済）。
  // 要素自身のアニメ opacity とも乗算で重なる（グループのフェード×要素のフェード）。
  for (const [gid, tr] of groupAnim) {
    if (tr.opacity == null) continue;
    const members = new Set(groupElementIds(sceneGroups, gid));
    for (const item of items) {
      if (members.has(item.id)) item.opacity = (item.opacity ?? 1) * tr.opacity;
    }
  }


  items.sort((a, b) => a.zIndex - b.zIndex);
  return { width: template.canvas.width, height: template.canvas.height, backgroundColor, items };
}
