// enum値の正典は docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md §3。
// ここは対応するTypeScript定義（文字列リテラル直書きを避けるため、コードはここを参照する）。

export const SCENE_CATEGORIES = [
  'opening', 'closing', 'photo_intro', 'video_intro',
  'point_list', 'message', 'full_visual', 'chapter', 'no_yuko', 'free',
] as const;
export type SceneCategory = (typeof SCENE_CATEGORIES)[number];

/** FREE テンプレのカテゴリ値（§6・ロジック比較用。自由配置 freeLayout を持つ場面）。 */
export const FREE_CATEGORY = 'free' satisfies SceneCategory;

/** FREE テンプレの自由配置要素の種別（ADR-0008／字幕＝ADR-0029）。layer.type 語彙に合わせる（image は使わず素材は slot）。 */
export const FREE_ELEMENT_KINDS = ['slot', 'text', 'shape', 'subtitle'] as const;
export type FreeElementKind = (typeof FREE_ELEMENT_KINDS)[number];

/** FreeElementKind の値を参照するための定数（§6：ロジックでの文字列直書きを避ける）。 */
export const FREE_ELEMENT_KIND = {
  slot: 'slot',
  text: 'text',
  shape: 'shape',
  subtitle: 'subtitle',
} as const satisfies Record<string, FreeElementKind>;

/** FREE 字幕要素の「対象」種別（ADR-0029）。narration=読み上げ(texts.subtitle)／allLines=掛け合い全行／speaker=特定の実効話者。 */
export const SUBTITLE_SOURCE_KINDS = ['narration', 'allLines', 'speaker'] as const;
export type SubtitleSourceKind = (typeof SUBTITLE_SOURCE_KINDS)[number];

/** SubtitleSourceKind の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const SUBTITLE_SOURCE_KIND = {
  narration: 'narration',
  allLines: 'allLines',
  speaker: 'speaker',
} as const satisfies Record<string, SubtitleSourceKind>;

/** 実効話者キーの種別（ADR-0029・P1-2）。catalog=明示話者(voiceCatalog の speaker 番号)／default=既定声(継承 voiceId・番号なし)。 */
export const SPEAKER_KEY_KINDS = ['catalog', 'default'] as const;
export type SpeakerKeyKind = (typeof SPEAKER_KEY_KINDS)[number];

/** SpeakerKeyKind の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const SPEAKER_KEY_KIND = {
  catalog: 'catalog',
  default: 'default',
} as const satisfies Record<string, SpeakerKeyKind>;

/** FREE テキスト要素のフォント太さ（ADR-0008）。 */
export const FONT_WEIGHTS = ['normal', 'bold'] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/** FontWeight の値を参照するための定数（§6：ロジック・既定値での文字列直書きを避ける）。 */
export const FONT_WEIGHT = {
  normal: 'normal',
  bold: 'bold',
} as const satisfies Record<string, FontWeight>;

/** テキストの揃え（FREE text の体裁・#209）。未指定＝left。 */
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** TextAlign の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const TEXT_ALIGN = {
  left: 'left',
  center: 'center',
  right: 'right',
} as const satisfies Record<string, TextAlign>;

/** キーフレームのイージング（④・ADR-0019）。 */
export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type Easing = (typeof EASINGS)[number];

/** Easing の値を参照するための定数（§6：文字列直書きを避ける）。 */
/**
 * **自由なカーブ**（#262）。CSS の `cubic-bezier(x1,y1,x2,y2)` と同じ形＝始点(0,0)・終点(1,1) を結ぶ
 * 3次ベジェの制御点。`x` は 0〜1（時間が戻らない）・`y` は範囲外も許す（行き過ぎて戻る動きを作れる）。
 */
export interface BezierEasing {
  bezier: [number, number, number, number];
}

/**
 * イージングの指定＝**名前つき**か**自由なカーブ**（#262・判別できる形＝どちらの意味かが型で決まる）。
 * 名前つきは `EASINGS`、自由なカーブは制御点4つ。未指定＝`linear`。
 */
export type EasingSpec = Easing | BezierEasing;

export const EASING = {
  linear: 'linear',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
} as const satisfies Record<string, Easing>;

/** FREE 図形要素の種別（ADR-0008・line は矩形モデルと相性が悪く MVP 対象外）。 */
export const FREE_SHAPE_TYPES = [
  'rect', 'ellipse', 'rounded_rect', 'triangle', 'star', 'arrow', 'speech_bubble',
] as const;
export type FreeShapeType = (typeof FREE_SHAPE_TYPES)[number];

/** FreeShapeType の値を参照するための定数（§6：ロジックでの文字列直書きを避ける）。 */
export const FREE_SHAPE_TYPE = {
  rect: 'rect',
  ellipse: 'ellipse',
  rounded_rect: 'rounded_rect',
  triangle: 'triangle',
  star: 'star',
  arrow: 'arrow',
  speech_bubble: 'speech_bubble',
} as const satisfies Record<string, FreeShapeType>;

/** テンプレ Layer（type='shape'）の図形種別。FREE 図形（FREE_SHAPE_TYPES）とは別系統＝line を含み rounded_rect 等は持たない。template.schema.json 準拠。 */
export const LAYER_SHAPE_TYPES = ['rect', 'ellipse', 'line'] as const;
export type LayerShapeType = (typeof LAYER_SHAPE_TYPES)[number];

/** LayerShapeType の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const LAYER_SHAPE_TYPE = {
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
} as const satisfies Record<string, LayerShapeType>;

export const ASSET_TYPES = [
  'image', 'video', 'bgm', 'voice', 'yuko', 'decor', 'logo', 'qr',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** AssetType の値を参照するための定数（§2-7：ロジックでの文字列直書きを避ける）。 */
export const ASSET_TYPE = {
  image: 'image',
  video: 'video',
  bgm: 'bgm',
  voice: 'voice',
  yuko: 'yuko',
  decor: 'decor',
  logo: 'logo',
  qr: 'qr',
} as const satisfies Record<string, AssetType>;

/**
 * FREE スロット（自由配置の素材枠）に置ける素材種別＝映像として描ける非音声（image/video/yuko/logo/qr/decor）。§2-7。
 * 通常テンプレのスロット層と FREE スロットで「置ける素材」の判定を一本化する（FREE 化で立ち絵/ロゴを移送しても
 * 編集画面の選択肢に現れる＝選び直せる・#524 P1）。bgm/voice（音声）は対象外。
 */
export const FREE_SLOT_ASSET_TYPES = [
  ASSET_TYPE.image, ASSET_TYPE.video, ASSET_TYPE.yuko, ASSET_TYPE.logo, ASSET_TYPE.qr, ASSET_TYPE.decor,
] as const satisfies readonly AssetType[];

/** 素材が FREE スロットに置けるか（映像として描ける非音声か・#524 P1）。 */
export function isFreeSlotAssetType(type: AssetType): boolean {
  return (FREE_SLOT_ASSET_TYPES as readonly AssetType[]).includes(type);
}

// 動画の種類（ADR-0011）。recruit=採用・会社紹介／general=一般・社内発表。省略時は recruit。
export const VIDEO_KINDS = ['recruit', 'general'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];
export const VIDEO_KIND = { recruit: 'recruit', general: 'general' } as const satisfies Record<string, VideoKind>;

// 画面比率（向き・ADR-0012）。16:9=横型／9:16=縦型。1:1 は将来拡張。
export const ORIENTATIONS = ['16:9', '9:16'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const ORIENTATION = { landscape: '16:9', portrait: '9:16' } as const satisfies Record<string, Orientation>;

// 採用（recruit）の目的。
export const PURPOSES = [
  'company_intro', 'new_graduate', 'mid_career',
  'inexperienced_welcome', 'engineer', 'info_session', 'sns_short',
] as const;
// 一般・社内発表（general）の目的（ADR-0011・11 §3.1）。
export const GENERAL_PURPOSES = ['general_announcement', 'report', 'product_intro', 'general_other'] as const;
// purpose は videoKind で許可値が変わる（recruit→PURPOSES／general→GENERAL_PURPOSES）。
// 型は両者の和（どちらの集合かは project.schema の if/then/else と検証で強制する）。
export type Purpose = (typeof PURPOSES)[number] | (typeof GENERAL_PURPOSES)[number];

export const LAYER_TYPES = [
  'background', 'slot', 'text', 'subtitle', 'character', 'decor', 'shape', 'logo',
] as const;

/** 層の種別の名前つき参照（`LAYER_TYPES` と同じ値・直書きを避けるための単一の参照元＝§2-7）。 */
export const LAYER_TYPE = {
  background: 'background',
  slot: 'slot',
  text: 'text',
  subtitle: 'subtitle',
  character: 'character',
  decor: 'decor',
  shape: 'shape',
  logo: 'logo',
} as const;

export type LayerType = (typeof LAYER_TYPES)[number];

/**
 * 素材の**寄せ**（#634・`05 §8`「トリミング位置をユーザー調整可能にする」）。
 * `fit:'cover'` で枠に収まらない側をどこで切るかを決める（既定＝中央）。`contain` では余白の寄せになる。
 */
export const CROP_ALIGN_XS = ['left', 'center', 'right'] as const;
export const CROP_ALIGN_YS = ['top', 'middle', 'bottom'] as const;
export type CropAlignX = (typeof CROP_ALIGN_XS)[number];
export type CropAlignY = (typeof CROP_ALIGN_YS)[number];

/**
 * 切り抜きの効かせ方（#634）。`mask`＝**箱の辺を隠す**（既定・中身は動かない）／
 * `fill`＝**残った素材を枠いっぱいに映し直す**（`kind='slot'` のみ・素材の実寸が要る）。
 */
export const CROP_MODES = ['mask', 'fill'] as const;
export type CropMode = (typeof CROP_MODES)[number];
export const CROP_MODE = {
  mask: 'mask',
  fill: 'fill',
} as const satisfies Record<CropMode, CropMode>;

/** 切り抜きの効かせ方の既定（箱の辺を隠す）。**判定・描画・画面がここだけを見る**。 */
export const CROP_MODE_DEFAULT = CROP_MODE.mask;

/** 値の名前つき参照（§6/§2-7：文字列直書きを避ける）。 */
export const CROP_ALIGN_X = {
  left: 'left',
  center: 'center',
  right: 'right',
} as const satisfies Record<CropAlignX, CropAlignX>;

export const CROP_ALIGN_Y = {
  top: 'top',
  middle: 'middle',
  bottom: 'bottom',
} as const satisfies Record<CropAlignY, CropAlignY>;

/** 寄せの既定（中央）。**判定・描画・画面がここだけを見る**（既定が3か所に散らない）。 */
export const CROP_ALIGN_DEFAULT_X = CROP_ALIGN_X.center;
export const CROP_ALIGN_DEFAULT_Y = CROP_ALIGN_Y.middle;

export const SLOT_TYPES = ['image_or_video', 'image', 'video'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** SlotType の値を参照するための定数（§6/§2-7：ロジックでの文字列直書きを避ける）。 */
export const SLOT_TYPE = {
  image_or_video: 'image_or_video',
  image: 'image',
  video: 'video',
} as const satisfies Record<string, SlotType>;

export const FITS = ['cover', 'contain', 'stretch'] as const;
export type Fit = (typeof FITS)[number];

/** Fit の値を参照するための定数（§6：ロジックでの文字列直書きを避ける）。 */
export const FIT = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'stretch',
} as const satisfies Record<string, Fit>;

/**
 * 動画スロット本体アニメの再生開始タイミング（ADR-0027・#444）。
 * withAnim=アニメと同時・先頭から（既定）／afterAnim=アニメの後（アニメ中は代表フレームで待つ）／
 * delay=途中から（delaySec 秒だけ遅らせて再生）。絶対秒でなくモードで保存＝アニメ長が変わっても意味が化けない。
 */
export const VIDEO_START_MODES = ['withAnim', 'afterAnim', 'delay'] as const;
export type VideoStartMode = (typeof VIDEO_START_MODES)[number];

/** VideoStartMode の値を参照するための定数（§6/§2-7：文字列直書きを避ける）。 */
export const VIDEO_START_MODE = {
  withAnim: 'withAnim',
  afterAnim: 'afterAnim',
  delay: 'delay',
} as const satisfies Record<string, VideoStartMode>;

export const TEXT_KEYS = ['title', 'main', 'subtitle', 'caption', 'url'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

/** TextKey の値を参照するための定数（§6）。Record<TextKey,TextKey> で全 textKey 網羅を型で強制（追加漏れ検知）。 */
export const TEXT_KEY = {
  title: 'title',
  main: 'main',
  subtitle: 'subtitle',
  caption: 'caption',
  url: 'url',
} as const satisfies Record<TextKey, TextKey>;

export const TRANSITION_TYPES = ['none', 'fade', 'slide', 'wipe', 'zoom'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/** TransitionType の値を参照するための定数（§6/§2-7：ロジック・既定値での文字列直書きを避ける）。 */
export const TRANSITION_TYPE = {
  none: 'none',
  fade: 'fade',
  slide: 'slide',
  wipe: 'wipe',
  zoom: 'zoom',
} as const satisfies Record<string, TransitionType>;

/** スライドの方向（ADR-0009・slide のときのみ有効）。 */
export const TRANSITION_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** TransitionDirection の値を参照するための定数（§6）。 */
export const TRANSITION_DIRECTION = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
} as const satisfies Record<string, TransitionDirection>;

export const NARRATION_STATUSES = ['none', 'pending', 'generated', 'failed'] as const;
export type NarrationStatus = (typeof NARRATION_STATUSES)[number];

/** NarrationStatus の値を参照するための定数（§6/§2-7：ロジックでの文字列直書きを避ける）。 */
export const NARRATION_STATUS = {
  none: 'none',
  pending: 'pending',
  generated: 'generated',
  failed: 'failed',
} as const satisfies Record<string, NarrationStatus>;

export const RENDER_STATUSES = ['idle', 'running', 'completed', 'failed'] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const FORMALITIES = ['casual', 'standard', 'formal'] as const;
export type Formality = (typeof FORMALITIES)[number];

/**
 * プロジェクトの文書形式（ADR-0032・11 §1）。project.json のトップレベル `format` で判別する。
 * **ファイルに書かれるのは `'timeline'` だけ**で、場面形式は `format` を持たない（不在＝場面形式）。
 * `'scene'` は `resolveProjectFormat` が返す**解決値**であって永続化しない
 * （`project.schema` は `additionalProperties:false` ゆえ書くと検証を通らない・CI の must-reject で固定）。
 */
export const PROJECT_FORMATS = ['scene', 'timeline'] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

/** ProjectFormat の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const PROJECT_FORMAT = {
  scene: 'scene',
  timeline: 'timeline',
} as const satisfies Record<string, ProjectFormat>;

/** `format` が無い／`'timeline'` でない project.json は場面形式＝後方互換の既定（11 §1）。 */
export const DEFAULT_PROJECT_FORMAT = PROJECT_FORMAT.scene;

/** タイムラインのトラック種別（ADR-0032）。置けるクリップの種別を決める。 */
export const TRACK_KINDS = ['visual', 'audio'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** TrackKind の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const TRACK_KIND = {
  visual: 'visual',
  audio: 'audio',
} as const satisfies Record<string, TrackKind>;

/** タイムラインのクリップ種別（ADR-0032）。slot/text/shape/subtitle は FreeElementKind と同義、
 *  template＝テンプレを素材として置く、audio＝音（素材/同梱BGM）、voice＝読み上げ（#628）。
 *  audio と voice を分けるのは必須フィールドが別物だから＝voice は読み上げ文と話者を持ち、
 *  音の素材（assetId/bundledBgmId）を持たない。 */
export const TIMELINE_CLIP_KINDS = [...FREE_ELEMENT_KINDS, 'template', 'audio', 'voice'] as const;
export type TimelineClipKind = (typeof TIMELINE_CLIP_KINDS)[number];

/** TimelineClipKind の値を参照するための定数（§6：文字列直書きを避ける）。 */
export const TIMELINE_CLIP_KIND = {
  ...FREE_ELEMENT_KIND,
  template: 'template',
  audio: 'audio',
  voice: 'voice',
} as const satisfies Record<string, TimelineClipKind>;

// schema の Warning.severity に対応
export const WARNING_SEVERITIES = ['info', 'warning', 'error'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

/** 文字列が有効な sceneCategory か判定する型ガード（AI出力の検証で使う）。 */
export function isSceneCategory(value: string): value is SceneCategory {
  return (SCENE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * 素材の**使い方**（#819-3）。値は1か所（§2-7）＝作る側（`videoPlacementsOfClip`）と
 * 数える側（`clipImageAssetUses`）と画面が同じものを見る。
 *
 * ⚠️ **中立な置き場に置く**（PR #827 レビュー 🟡）＝`export.ts` に置くと、値を作っている
 * `video.ts` から実行時に読めない（`export.ts` → `video.ts` の実行時 import があるので**循環**する）。
 * 比較側だけ定数にして**作る側が直書きのまま**では、綴りが別々に生きる状態が消えない。
 */
export const ASSET_USE_KIND = { direct: 'direct', slot: 'slot', character: 'character' } as const;

export type AssetUseKind = (typeof ASSET_USE_KIND)[keyof typeof ASSET_USE_KIND];
