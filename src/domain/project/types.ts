// project.json の内部データ型。正典は docs/yuko_recruit_docs/schemas/project.schema.json と 11_SCHEMA_REFERENCE.md §7。
import type {
  AssetType, Fit, Formality, FreeElementKind, NarrationStatus, Purpose,
  SceneCategory, TextKey, TransitionType, WarningSeverity,
} from '../enums';

export interface VideoSettings {
  aspectRatio: '16:9';
  width: number;
  height: number;
  fps: number;
  targetDurationSec: number;
  maxDurationSec: number;
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
  zIndex?: number;
  /** kind='slot': 素材を直接参照（null=空スロット）。fit は assetId 非 null のとき有効。 */
  assetId?: string | null;
  fit?: Fit;
  /** kind='text'。 */
  text?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  /** kind='shape'（rect/ellipse のみ・ADR-0008）。 */
  shapeType?: 'rect' | 'ellipse';
  fillColor?: string;
  opacity?: number;
  radius?: number;
}

export interface Scene {
  sceneId: string;
  partId: string;
  order: number;
  sceneType: SceneCategory;
  templateId: string;
  durationSec: number;
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
  projectId: string;
  projectName: string;
  purpose: Purpose;
  createdAt: string;
  updatedAt: string;
  videoSettings: VideoSettings;
  companyInfo: CompanyInfo;
  toneSettings?: ToneSettings;
  voiceSettings: VoiceSettings;
  bgmSettings?: BgmSettings;
  assets: Asset[];
  parts: Part[];
  scenes: Scene[];
}
