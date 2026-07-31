// project.json の内部データ型。正典は docs/yuko_recruit_docs/schemas/project.schema.json と 11_SCHEMA_REFERENCE.md §7。
import type {
  AssetType, EasingSpec, Fit, FontWeight, Formality, FreeElementKind, FreeShapeType, NarrationStatus, Orientation, Purpose,
  SceneCategory, TextAlign, TextKey, TransitionDirection, TransitionType, VideoKind, VideoStartMode, WarningSeverity,
} from '../enums';
import type { FontId } from '../font/fontCatalog';
import type { BundledBgmId } from '../bgm/bgmCatalog';
import type { Group } from '../group/types';
import type { LayerBackground } from '../template/types';

export interface VideoSettings {
  /** 向き（SoT）。寸法は dimsForOrientation で導出する（width/height は保存しない＝ADR-0012）。 */
  aspectRatio: Orientation;
  fps: number;
  targetDurationSec: number;
  maxDurationSec: number;
  /** 動画全体のフォント（同梱フォントの id＝domain/font/fontCatalog）。未指定は既定フォント（schema 1.3 で追加・任意）。 */
  fontId?: FontId;
}

export interface CompanyInfo {
  companyName: string;
  industry?: string;
  businessDescription?: string;
  recruitTarget?: string;
  jobType?: string;
  strengths?: string[];
  desiredPerson?: string;
  recruitUrl?: string;
}

/** 一般・社内発表動画の入力（ADR-0011・11 §7.1.3。videoKind=general のとき使う）。 */
export interface GeneralBrief {
  /** テーマ／タイトル（必須）。 */
  title: string;
  /** 構成（章立て・アジェンダ）。 */
  agenda?: string[];
  /** 伝えたい要点。 */
  keyPoints?: string[];
  /** 対象視聴者（ADR-0011 #12）。general の対象。recruit は companyInfo.recruitTarget を使う。 */
  targetAudience?: string;
}

export interface ToneSettings {
  tone?: string;
  yukoPersonality?: string;
  formality?: Formality;
}

export interface VoiceSettings {
  defaultVoiceId: string;
  speed?: number;
  pitch?: number;
  intonation?: number;
  volume?: number;
}

export interface BgmSettings {
  enabled?: boolean;
  assetId?: string | null;
  /** 標準BGM（同梱）の id（domain/bgm/bgmCatalog）。設定時は assetId より優先。null/未指定＝標準BGM未選択（schema 1.4 で追加・任意）。 */
  bundledBgmId?: BundledBgmId | null;
  volume?: number;
  loop?: boolean;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export interface Clip {
  startSec?: number;
  endSec?: number;
  useOriginalAudio?: boolean;
  originalAudioVolume?: number;
  fit?: Fit;
  /** 再生速度（0.5–2.0・既定1.0）。尺は据え置き、スロット内のクリップ再生速度のみ変える（ADR-0007 Phase 3b）。 */
  speed?: number;
}

/**
 * 動画スロット本体アニメの再生開始タイミング（ADR-0027・#444）。モードで保存＝アニメ長が変わっても意味不変。
 * delaySec は mode='delay' のときだけ有効（0〜アニメ長・描画時に [0, animEnd] へクランプ）。
 * 効くのは「スロット本体がアニメ対象」の場面のみ（slotIsAnimated）。アニメが無いスロットには持たせない。
 */
export interface VideoStartSpec {
  mode: VideoStartMode;
  delaySec?: number;
}

/**
 * 動画クリップ調整の per-use 上書き（場面×スロット・ADR-0028・#472）。`Clip` の per-use 上書き可能な部分集合。
 * 未設定フィールドは `asset.clip` の既定を継承（null=継承・11 §6）。`fit` は含めない（既に scene.slotFits で per-use）。
 * scenes に載るので ADR-0020 の履歴で自動 Undo。
 */
export interface SlotClipOverride {
  startSec?: number;
  endSec?: number;
  useOriginalAudio?: boolean;
  originalAudioVolume?: number;
  /** 再生速度（0.5–2.0・既定1.0）。 */
  speed?: number;
}

export interface AssetMetadata {
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  hasAudio?: boolean | null;
}

export interface Asset {
  assetId: string;
  assetType: AssetType;
  displayName: string;
  filePath: string;
  thumbnailPath?: string;
  mimeType?: string;
  tags?: string[];
  description?: string;
  aiDescription?: string;
  isPublicChecked?: boolean;
  /** yuko 素材のみ。poseTag 解決の既定（12 §8.3）。 */
  isDefaultYuko?: boolean;
  clip?: Clip;
  metadata?: AssetMetadata;
}

export interface Part {
  partId: string;
  title: string;
  description?: string;
  order: number;
  sceneIds: string[];
  targetDurationSec?: number;
}

/** キーはテンプレの background/slot/logo レイヤーの id。値は既存 assetId または null（11 §5）。 */
export type AssetRefs = Record<string, string | null>;

export interface Character {
  enabled: boolean;
  characterId: string;
  poseAssetId?: string | null;
}

export type Texts = Partial<Record<TextKey, string>>;

export interface Narration {
  text: string;
  /** null = project.voiceSettings を継承（11 §6）。 */
  voiceId?: string | null;
  speed?: number | null;
  pitch?: number | null;
  intonation?: number | null;
  voicePath?: string | null;
  status: NarrationStatus;
}

/**
 * 掛け合い：場面のセリフ列の1行（ADR-0015・#180）。null/未指定 = 場面/動画の既定を継承（11 §6）。
 * speed/pitch/intonation は行ごとに上書き可。null/未指定＝場面/動画の既定を継承（#242・schema 1.12）。
 */
export interface NarrationLine {
  /** line_NNN（scene 内一意・§2.1）。 */
  lineId: string;
  /** 読み上げ（話す）テキスト。 */
  text: string;
  /** VOICEVOX speaker（#177 voiceCatalog）。整数のみ有効（schema: integer）。null/未指定＝場面/動画の既定声を継承。 */
  speaker?: number | null;
  speed?: number | null;
  pitch?: number | null;
  /** 抑揚（0.0〜2.0）。null/未指定＝場面/動画の既定を継承（#242・schema 1.12）。 */
  intonation?: number | null;
  /** 画面字幕の文言。未指定＝text を字幕に流用（追加B）。 */
  subtitleText?: string | null;
  /** この行の字幕 ON/OFF。未指定＝場面（subtitleEnabledDefault）→書き出し既定を継承。 */
  subtitleEnabled?: boolean;
  /** 明示開始秒（任意・簡易手動タイミング）。未指定＝直前行の積み上げ＝自動逐次。 */
  startSec?: number;
  /**
   * 直前の行と**同時に**開始する（＝並行して重ねて流す・ADR-0031）。true の連続で N 人同時。
   * 未指定/false＝逐次（従来どおり）。startSec を保存しないので V18（重なり禁止）に触れない。
   */
  startWithPrevious?: boolean;
  /** 生成済み音声の保存先（行ごと）。 */
  voicePath?: string | null;
  status: NarrationStatus;
}

/** 全フィールド任意・null可。null = project 既定を継承（11 §6）。 */
export interface AudioMix {
  narrationVolume?: number | null;
  bgmVolume?: number | null;
  originalAudioVolume?: number | null;
}

export interface Transition {
  in?: TransitionType;
  out?: TransitionType;
  durationSec?: number;
  /** slide のときの方向（ADR-0009）。MVP では in に適用。未指定は left。 */
  direction?: TransitionDirection;
}

export interface Warning {
  code: string;
  message: string;
  field?: string;
  severity?: WarningSeverity;
  autoFixed?: boolean;
}

/** 実効話者キー（ADR-0029・P1-2）＝音声生成と同じ話者空間。number|null では既定声を表せないため判別 union。 */
export type SpeakerKey =
  | { kind: 'catalog'; speaker: number } // 明示話者（voiceCatalog の speaker 番号）
  | { kind: 'default' }; // 既定声の行（継承 voiceId・catalog 番号なし・場面の既定へ動的追従）

/** FREE 字幕要素の「対象」＝何を表示するか（ADR-0029）。未指定＝後方互換（単独→narration・掛け合い→allLines）。 */
export type SubtitleSource =
  | { kind: 'narration' } // 読み上げ（texts.subtitle・単独ナレーション）
  | { kind: 'allLines' } // 掛け合い：全行（話者で絞らない）
  | { kind: 'speaker'; speaker: SpeakerKey }; // 掛け合い：特定の実効話者の行のみ

/** FREE テンプレ場面の自由配置要素（ADR-0008／字幕＝ADR-0029）。id は scene 内一意。x/y/w/h は canvas(1920×1080) 基準。 */
export interface FreeElement {
  id: string;
  kind: FreeElementKind;
  /** 任意の表示名（重ね順一覧/選択チップの見分け用・未設定＝種類＋連番の自動名にフォールバック・#525-12）。全 kind 共通・テンプレの Layer.name に相当。 */
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 重ね順（整数のみ有効・§2.2 / schema: integer）。 */
  zIndex?: number;
  /** 回転角（度・0以上360未満・中心を軸に時計回り。未指定/0＝回転なし。360=0 は重複ゆえ schema で除外・#208）。 */
  rotation?: number;
  /** kind='slot': 素材を直接参照（null=空スロット）。fit は assetId 非 null のとき有効。 */
  assetId?: string | null;
  fit?: Fit;
  /** kind='text'。 */
  text?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: FontWeight;
  /** kind='text' の同梱フォント id。null/未指定＝場面/動画全体を継承（#178）。 */
  fontId?: FontId | null;
  /** kind='text' の行間（倍率・0.5〜3.0。未指定＝1.3。#209）。 */
  lineHeight?: number;
  /** kind='text' の揃え（left/center/right。未指定＝left。#209）。 */
  textAlign?: TextAlign;
  /** kind='shape'。rect/ellipse/rounded_rect/triangle/star/arrow/speech_bubble（ADR-0008・#173）。 */
  shapeType?: FreeShapeType;
  fillColor?: string;
  opacity?: number;
  radius?: number;
  /** 枠線/縁取り（#173・任意）。strokeWidth>0 のとき描画。kind='shape'＝図形の枠線、kind='text'＝文字の縁取り（#209）。 */
  strokeColor?: string;
  strokeWidth?: number;
  /** kind='text'/'subtitle' の背景帯（可読性の下地・#529）。enabled で描画。通常テンプレ字幕層の layer.background と同型・
   *  通常→FREE 化で移送（ADR-0030）。未指定/enabled:false＝背景帯なし。 */
  background?: LayerBackground;
  /** 非表示（レイヤー一覧で隠す・#210）。true のとき描画・操作対象から除外（未指定/false＝表示）。 */
  hidden?: boolean;
  /** ロック（レイヤー一覧で固定・#210）。true のときプレビュー上での移動/拡縮を禁止（未指定/false＝編集可）。 */
  locked?: boolean;
  /** kind='subtitle' の「対象」（ADR-0029）。未指定＝後方互換（単独→読み上げ texts.subtitle・掛け合い→全行）。 */
  subtitleSource?: SubtitleSource;
}

/**
 * 通常テンプレの文字の体裁を場面別に上書きする値（#555・schema 1.24 `$defs/TextStyle`）。
 * 各プロパティ未指定＝テンプレ層（`layer.*`）を継承＝**触ったものだけが固有値になる**（11 §6 の null=継承と同じ流儀）。
 * 制約は `Layer`/`FreeElement` の同名プロパティと同一（同じ概念は同じ制約＝§2-7）。
 */
export interface TextStyleOverride {
  /** 文字色（`#RRGGBB`）。 */
  color?: string;
  /** 文字サイズ（canvas px・>0）。 */
  fontSize?: number;
  /** 太さ。 */
  fontWeight?: FontWeight;
  /** 縁取りの色（`#RRGGBB`）。 */
  strokeColor?: string;
  /** 縁取りの太さ（canvas px・>=0）。0 で縁取りなし。 */
  strokeWidth?: number;
}

export interface Scene {
  sceneId: string;
  partId: string;
  order: number;
  sceneType: SceneCategory;
  templateId: string;
  durationSec: number;
  /** この場面のフォント（同梱フォントの id）。null/未指定＝動画全体（videoSettings.fontId）を継承（schema 1.5・null=継承）。 */
  fontId?: FontId | null;
  /** テキスト種別（textKey）ごとのフォント上書き（#178・schema 1.7）。未設定の種別は scene.fontId→動画全体→既定を継承。 */
  textFontIds?: Partial<Record<TextKey, FontId>>;
  /**
   * テキスト種別（textKey）ごとの体裁上書き（色/サイズ/太さ/縁取り・#555・schema 1.24）。
   * `textFontIds`（フォント）と同型で、**配置・座標はテンプレ駆動のまま**（§2-4 の対象は配置＝体裁は対象外）。
   * 未設定のプロパティはテンプレ層（`layer.*`）→既定を継承（null=継承・11 §6）。AI は生成しない（利用者編集専用）。
   */
  textStyles?: Partial<Record<TextKey, TextStyleOverride>>;
  /** この場面のBGM。未指定＝プロジェクト既定（bgmSettings）を継承（schema 1.16・null=継承・ADR-0018 ③(7)）。enabled:false でこの場面は無音。 */
  bgmSettings?: BgmSettings;
  assetRefs: AssetRefs;
  character: Character;
  texts: Texts;
  narration: Narration;
  /** 掛け合い：時間順のセリフ列（ADR-0015・#180）。あれば実効タイムライン＝sceneLines() がこれを返す。未設定＝単一 narration を1行とみなす。 */
  lines?: NarrationLine[];
  /** 場面の字幕既定 ON/OFF（行の subtitleEnabled 未指定時に継承・ADR-0015）。 */
  subtitleEnabledDefault?: boolean;
  audioMix?: AudioMix;
  transition?: Transition;
  warnings: Warning[];
  /** 場面ごと・スロット別の画像の収め方（④）。キー＝テンプレのスロット/背景/ロゴの layer.id。未指定＝テンプレ層の fit を使用。 */
  slotFits?: Record<string, Fit>;
  /** 場面ごと・スロット別の動画クリップ調整の per-use 上書き（ADR-0028・#472）。キー＝スロットの layer.id。未指定/未上書きフィールドは asset.clip を継承。scenes に載るので Undo 可。 */
  slotClips?: Record<string, SlotClipOverride>;
  /** 動画スロット本体アニメの再生開始タイミング（ADR-0027・#444）。キー＝スロットの layer.id。未指定＝withAnim（アニメと同時）。スロット本体がアニメ対象の場面でのみ効く。 */
  slotVideoStart?: Record<string, VideoStartSpec>;
  /** 自由配置要素（ADR-0008）。**有効なのは FREE テンプレ場面のときだけ**（描画/編集/事前確認/素材使用は category でゲート）。通常テンプレへ切り替えても休眠保持し FREE へ戻すと復元（ADR-0030）。未設定＝通常テンプレ（assetRefs/texts ベース）。 */
  freeLayout?: FreeElement[];
  /** 要素のグループ化（ADR-0022）。メンバー＝freeLayout 要素 id（ネストで group id も可）。未設定＝グループ無し。 */
  groups?: Group[];
}

/** 時間軸に足すクリップ（ADR-0018・まずはテロップ）。anchorSceneId 有＝場面相対（startSec=場面開始からの相対秒）／無＝絶対時間（startSec=グローバル秒）。 */
export interface OverlayClip {
  /** ovclip_NNN（project 内一意・§2.1）。 */
  id: string;
  /** 出すレーン（現状 telop のみ・将来 audio/bgm へ拡張）。 */
  track: 'telop';
  /** アンカー場面 id（AI 再生成時の照合キー）。未指定＝絶対時間クリップ。 */
  anchorSceneId?: string;
  startSec: number;
  durationSec: number;
  /** テロップの文言。 */
  text?: string;
}

/** 1キーフレーム（場面ローカル秒 timeSec の要素プロパティ・④・ADR-0019）。設定したプロパティのみ補間対象。値は絶対上書き。 */
export interface Keyframe {
  /** 場面開始からの相対秒。 */
  timeSec: number;
  x?: number;
  y?: number;
  /** 拡大縮小の倍率（基準 w/h に対する係数）。 */
  scale?: number;
  /** 不透明度 0.0〜1.0。 */
  opacity?: number;
  /** 回転角（度）。 */
  rotation?: number;
  /** 前KFからこのKFへ入るイージング（先頭KFでは無視）。未指定＝linear。 */
  /** 区間 [前KF, 当KF] のイージング（#262＝名前つき／自由なカーブ）。未指定＝`linear`。 */
  easing?: EasingSpec;
}

/** 要素アニメーション（④・ADR-0019）。場面内の1要素（FREE 要素／グループ id）を時間で補間する。timelineOverlay に格納＝AI/場面正準は不変。 */
export interface ElementAnimation {
  /** anim_NNN（project 内一意・§2.1）。 */
  id: string;
  /** アンカー場面 id（scene_NNN）。 */
  sceneId: string;
  /** 対象の要素 id（scene.freeLayout の要素 id、またはグループ id）。 */
  targetId: string;
  /** timeSec 昇順のキーフレーム列。 */
  keyframes: Keyframe[];
}

/**
 * 場面横断タイムラインの上位編集を場面アンカーで保持する任意の層（ADR-0018・2モデル方式）。
 *
 * **`clips` は非推奨**（#635・ADR-0032 決定11/12）＝時間軸の編集はタイムライン形式（別プロジェクト）へ移った。
 * 描画・書き出しでは**読まない**が、保存済みデータを黙って消さないために型と schema には残す（新規に書かない）。
 * **`animations`（場面の登場アニメ・ADR-0019）は現役**＝同じ入れ物にあるだけで、一緒に捨てない。
 */
export interface TimelineOverlay {
  clips?: OverlayClip[];
  /** 要素アニメーション（④・ADR-0019・任意）。未指定＝アニメ無し（静止）。 */
  animations?: ElementAnimation[];
}

export interface Project {
  schemaVersion: string;
  /** 動画の種類（ADR-0011）。省略時は recruit として扱う。 */
  videoKind?: VideoKind;
  projectId: string;
  projectName: string;
  purpose: Purpose;
  createdAt: string;
  updatedAt: string;
  videoSettings: VideoSettings;
  /** 採用（videoKind=recruit）のとき必須。general では持たない（ADR-0011・schema if/then/else）。 */
  companyInfo?: CompanyInfo;
  generalBrief?: GeneralBrief;
  /** 利用者が AI へ自由に伝える補足（両用途共通・そのまま送信。ADR-0011 で companyInfo→トップレベルへ移動）。 */
  additionalNotes?: string;
  toneSettings?: ToneSettings;
  voiceSettings: VoiceSettings;
  bgmSettings?: BgmSettings;
  assets: Asset[];
  parts: Part[];
  scenes: Scene[];
  /** 場面横断タイムラインの上位編集（ADR-0018・任意・schema 1.15）。未設定＝場面射影のみ。AI/簡易は無視。 */
  timelineOverlay?: TimelineOverlay;
}
