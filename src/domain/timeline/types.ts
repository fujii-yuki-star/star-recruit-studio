// タイムライン編集プロジェクト（ADR-0032）の型。正典は 11 §7.6 ＋ schemas/timeline-project.schema.json。
// 場面（parts/scenes）を持たない**別の文書形式**で、キャンバスは常に自由配置＝FREE（空間の自由）×
// タイムライン（時間の自由）。AI はこの形式を生成しない（AI の関与は場面形式まで）。
import type { BundledBgmId } from '../bgm/bgmCatalog';
import type { Fit, ProjectFormat, TextKey, TimelineClipKind, TrackKind } from '../enums';
import type { Group } from '../group/types';
import type {
  Asset,
  AssetRefs,
  FreeElement,
  Keyframe,
  Texts,
  TextStyleOverride,
  VideoSettings,
  VoiceSettings,
} from '../project/types';

/** トラック（列）。同一トラック内でクリップの時間は重ならない（11 §8 V24）。 */
export interface Track {
  /** `track_NNN`（11 §2.1）。 */
  id: string;
  /** 置けるクリップの種別を決める（visual＝映像・文字・図形・字幕／audio＝音声）。 */
  kind: TrackKind;
  /** 任意の表示名（未指定＝種別＋連番の自動名）。 */
  name?: string;
  /** true で描画・書き出しから除外（音声は無音）。 */
  hidden?: boolean;
  /** true でクリップの移動・トリムを禁止。 */
  locked?: boolean;
}

/**
 * クリップの空間の語彙。**FreeElement（ADR-0008）と同じもの**を使う＝描画は `layoutScene` の
 * FREE 分岐を共有でき、パリティを二重に作らない（ADR-0001）。
 * - `id`/`kind` は TimelineClip 側で別の型に置き換える。
 * - `zIndex` は**持たない**。重ね順は tracks の並び順だけで一意に決まる（V24 が時間の重なりを禁じるため）。
 * - `subtitleSource` は場面（`scene.lines`）を前提とするので持たない。タイムラインでは字幕クリップと
 *   音声クリップを紐づける（ADR-0032・#633 で導入）。
 * - `x/y/w/h` は FreeElement では必須だが、音声クリップには幾何が無いので任意にする。
 */
type ClipSpatial = Omit<FreeElement, 'id' | 'kind' | 'zIndex' | 'subtitleSource' | 'x' | 'y' | 'w' | 'h'> &
  Partial<Pick<FreeElement, 'x' | 'y' | 'w' | 'h'>>;

/** クリップ＝「FREE 要素 ＋ 時間（trackId/startSec/durationSec）」（11 §7.6）。 */
export interface TimelineClip extends ClipSpatial {
  /** `clip_NNN`（11 §2.1）。場面形式の `ovclip_NNN` とは別物。 */
  id: string;
  kind: TimelineClipKind;
  /** 置かれているトラック（`track_NNN`）。 */
  trackId: string;
  /** タイムライン先頭からの秒（≥0）。 */
  startSec: number;
  /** 尺（>0）。 */
  durationSec: number;

  /** kind='template'（テンプレを素材として置く・差し込み口が生きている）。 */
  templateId?: string;
  assetRefs?: AssetRefs;
  texts?: Texts;
  textStyles?: Partial<Record<TextKey, TextStyleOverride>>;
  /** テンプレ層 id → 収め方の上書き（場面形式の `scene.slotFits` と同義）。 */
  slotFits?: Record<string, Fit>;

  /** kind='audio' で同梱BGMを鳴らすとき（`assetId` と排他・11 §8 V25）。 */
  bundledBgmId?: BundledBgmId | null;
  volume?: number;
  fadeInSec?: number;
  fadeOutSec?: number;

  /** 素材のどこから使うか（非破壊トリム・ADR-0024）。動画・音声クリップで有効。 */
  sourceStartSec?: number;
  /** 再生速度（>0）。 */
  speed?: number;
}

/**
 * クリップ（またはグループ）のキーフレームアニメ。
 * **`Keyframe.timeSec` はクリップの先頭からの秒**＝場面形式の `ElementAnimation`（場面ローカル秒）と
 * そこだけ意味が違う（11 §7.6）。補間の規則は共通。
 */
export interface ClipAnimation {
  /** `anim_NNN`（11 §2.1）。 */
  id: string;
  /** クリップ id（`clip_NNN`）またはグループ id（`group_NNN`）。 */
  targetId: string;
  keyframes: Keyframe[];
}

/** タイムライン形式の `project.json`（11 §7.6）。 */
export interface TimelineProject {
  /** 場面形式とは**独立に進む**（別文書ゆえ・11 §1）。 */
  schemaVersion: string;
  /** 形式の判別（11 §1）。常に 'timeline'。 */
  format: Extract<ProjectFormat, 'timeline'>;
  /** `proj_YYYYMMDD_NNN`（場面形式と共通採番＝一覧に同列で並ぶ）。 */
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  /** 焼き出し元の場面形式プロジェクト（片道・記録のみで元は書き換えない）。完全新規なら未指定。 */
  sourceProjectId?: string;
  videoSettings: VideoSettings;
  /** タイムライン側でも声を作れる（ADR-0032）ため既定の声設定を持つ。 */
  voiceSettings: VoiceSettings;
  /** 焼き出し時はコピーする（自己完結・ADR-0024 (6)）。 */
  assets: Asset[];
  /** **配列の後ろほど手前**（既存の描画規則と同じ）。UI では上が手前に見せる。 */
  tracks: Track[];
  clips: TimelineClip[];
  /** 要素のグループ化（ADR-0022）。members はクリップ id／ネストでグループ id。 */
  groups?: Group[];
  animations?: ClipAnimation[];
}

/**
 * 本形式の schemaVersion（11 §1）。**場面形式（PROJECT_SCHEMA_VERSION）とは独立に進む**＝
 * 場面形式の 1.x バンプで釣られて上げない、逆も同じ。
 * 値の正典は `schemas/timeline-project.schema.json` の `properties.schemaVersion.const` で、
 * ここはその写し（ドリフトは validateTimelineDoc.test の照合テストが検知する）。
 */
export const TIMELINE_SCHEMA_VERSION = '1.0';
