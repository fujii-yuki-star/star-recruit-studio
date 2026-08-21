// タイムライン編集プロジェクト（ADR-0032）の型。正典は 11 §7.6 ＋ schemas/timeline-project.schema.json。
// 場面（parts/scenes）を持たない**別の文書形式**で、キャンバスは常に自由配置＝FREE（空間の自由）×
// タイムライン（時間の自由）。AI はこの形式を生成しない（AI の関与は場面形式まで）。
import type { BundledBgmId } from '../bgm/bgmCatalog';
import type { CropAlignX, CropAlignY, CropMode, Fit, NarrationStatus, ProjectFormat, TextKey, TimelineClipKind, TrackKind } from '../enums';
import type { FontId } from '../font/fontCatalog';
import type { Group } from '../group/types';
import type {
  Asset,
  AssetRefs,
  Character,
  FreeElement,
  Keyframe,
  SlotClipOverride,
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

/**
 * 読み上げクリップ（`kind='voice'`）の中身（11 §7.6）。
 * 場面形式の `NarrationLine` から**時間の語彙を除いた**もの＝`startSec`/`startWithPrevious` はクリップの
 * `startSec` とトラックが担い、`subtitleText`/`subtitleEnabled` は字幕クリップが担う。
 *
 * **入れ子にしているのは、クリップ直下の `text`（表示する文字）・`speed`（素材の再生速度）と語が衝突するため。**
 * 読み上げ文と話速は別概念なので、同じ名前で違う意味を持たせない（ADR-0026②）。
 */
export interface TimelineVoice {
  /** 読み上げる（話す）文。画面に出す字幕は別の字幕クリップが持つ。 */
  text: string;
  /** VOICEVOX speaker（#177 voiceCatalog）。null/未指定＝プロジェクト既定の声を継承（11 §6）。 */
  speaker?: number | null;
  /** 話速。null/未指定＝既定を継承。クリップ直下の `speed`（素材の再生速度）とは別物。 */
  speed?: number | null;
  pitch?: number | null;
  intonation?: number | null;
  /** 生成済み音声の保存先。 */
  voicePath?: string | null;
  status: NarrationStatus;
}

/**
 * 音量の変化（#512）の点1つ＝**クリップ先頭からの秒**と音量（0〜1.5）。絵のキーフレーム（`Keyframe`）
 * とは別に持つ＝音は変形の対象と合わず、場面形式と共有している `$defs` へ意味の無い語彙を足さない
 * （ADR-0032 追補）。
 */
export interface VolumePoint {
  timeSec: number;
  volume: number;
}

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
  /** テキスト種別ごとのフォント上書き（場面形式の `scene.textFontIds` と同義）。枠全体は `fontId`。 */
  textFontIds?: Partial<Record<TextKey, FontId>>;
  /** 立ち絵の表示と表情（場面形式の `scene.character` と同義）。テンプレに character 層があるときだけ効く。 */
  character?: Character;
  /**
   * テンプレ層 id → 動画の使う範囲・速度・元音声の上書き（場面形式の `scene.slotClips` と同義・ADR-0028）。
   * クリップ直下の `sourceStartSec`/`speed` は kind='slot'/'audio' が直接持つ素材のトリムで、
   * こちらは**枠の中の差し込み口ごと**の上書き＝別物。
   */
  slotClips?: Record<string, SlotClipOverride>;

  /**
   * **切り抜き**（#634・タイムライン形式だけの語彙）。クリップの箱の各辺を「箱の大きさに対する割合」で
   * 隠す（0〜1未満・未指定＝0）。**中身は動かない**＝隠れるだけ（残った素材を枠いっぱいに映し直すのは
   * `cropMode:'fill'`＝下のフィールド）。同じ軸の合計は 1 未満（`11 §8` V30）。
   *
   * `FreeElement` には足さない（場面形式は凍結＝ADR-0032）。描画は `layoutTimelineAt` が
   * **クリップのアイテム全部を1つの切り抜き矩形で包む**形で効かせる（`LayoutItem.clipRect`）。
   */
  crop?: { top?: number; right?: number; bottom?: number; left?: number };

  /**
   * 切り抜きの**効かせ方**（#634）。未指定＝`mask`＝箱の辺を隠す（中身は動かない）。
   * `fill`＝**残った素材を枠いっぱいに映し直す**＝`kind='slot'` のときだけ効く（1つの素材に対する操作なので）。
   * **素材の実寸が要る**（描く側が測って渡す）。分からないときは `mask` として描き、画面が理由を出す。
   */
  cropMode?: CropMode;

  /**
   * **素材の寄せ**（#634・`05 §8`「トリミング位置をユーザー調整可能にする」）。
   * `fit:'cover'` で枠に収まらない側を**どこで切るか**（既定＝中央）。`contain` では余白の寄せになる。
   * 切り抜き（`crop`）とは別物＝あちらは「箱の辺を隠す」、こちらは「素材を箱のどこへ寄せるか」。
   */
  cropAlign?: { x?: CropAlignX; y?: CropAlignY };

  /**
   * kind='subtitle' の**連動先**（読み上げクリップの id・ADR-0032 決定24・#633）。
   * 指すと**文言と時間**がその読み上げに追従する（文言は `text` が入っていればそちらが優先）。
   * 未指定＝連動しない。指した先が見つからないときは黙って消さず、検証（`11 §8` V29）が知らせる。
   */
  voiceClipId?: string;

  /** kind='voice' のとき必須（読み上げの中身・schema の if/then で強制）。 */
  voice?: TimelineVoice;

  /** kind='audio' で同梱BGMを鳴らすとき（`assetId` と排他・11 §8 V25）。 */
  bundledBgmId?: BundledBgmId | null;
  volume?: number;
  /**
   * **音量の変化**（#512・ADR-0032 追補）。クリップ先頭からの秒と音量（0〜1.5）の点列。
   * 未指定＝`volume` の一定値。**フェードはこの上に掛かる**（「基準×フェード係数」の形は変えない）。
   * 点の間は線形に変える（`volumeAt`）。**書き出しも同じ点列**から式を組む（`volumeExpr`・ADR-0032 追補＝案A）。
   * 読む前に**両者が同じ正規化**（`normalizedVolumePoints`）を通す＝並び・重複・値域で食い違わない。
   */
  volumePoints?: VolumePoint[];
  fadeInSec?: number;
  fadeOutSec?: number;

  /**
   * 動画の素材を置いたクリップで、その動画に入っている**元の音を鳴らすか**（#512 段2）。
   * 未指定＝鳴らさない。**素材に音が入っているときだけ**効く（場面形式と同じ規準＝ADR-0026②）。
   * 解決は `domain/timeline/video.ts` の1か所（再生・書き出し・画面が共有）。
   */
  useOriginalAudio?: boolean;
  /** 元の音の音量（0〜1.5）。未指定＝標準（`ORIGINAL_AUDIO_VOLUME`）。 */
  originalAudioVolume?: number;

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
export const TIMELINE_SCHEMA_VERSION = '1.8';
