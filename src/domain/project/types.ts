// project.json の内部データ型。正典は docs/yuko_recruit_docs/schemas/project.schema.json と 11_SCHEMA_REFERENCE.md §7。
import type {
  AssetType, Fit, FontWeight, Formality, FreeElementKind, FreeShapeType, NarrationStatus, Orientation, Purpose,
  SceneCategory, TextKey, TransitionDirection, TransitionType, VideoKind, WarningSeverity,
} from '../enums';
import type { FontId } from '../font/fontCatalog';
import type { BundledBgmId } from '../bgm/bgmCatalog';

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

/** FREE テンプレ場面の自由配置要素（ADR-0008）。id は scene 内一意。x/y/w/h は canvas(1920×1080) 基準。 */
export interface FreeElement {
  id: string;
  kind: FreeElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 重ね順（整数のみ有効・§2.2 / schema: integer）。 */
  zIndex?: number;
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
  /** kind='shape'。rect/ellipse/rounded_rect/triangle/star/arrow/speech_bubble（ADR-0008・#173）。 */
  shapeType?: FreeShapeType;
  fillColor?: string;
  opacity?: number;
  radius?: number;
  /** 図形の枠線（#173・任意）。strokeWidth>0 のとき描画。 */
  strokeColor?: string;
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
  assetRefs: AssetRefs;
  character: Character;
  texts: Texts;
  narration: Narration;
  audioMix?: AudioMix;
  transition?: Transition;
  warnings: Warning[];
  /** FREE テンプレ場面のみ：自由配置要素（ADR-0008）。未設定＝通常テンプレ（assetRefs/texts ベース）。 */
  freeLayout?: FreeElement[];
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
}
