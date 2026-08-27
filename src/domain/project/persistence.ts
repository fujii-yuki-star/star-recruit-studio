// project.json の組立・読込（純粋ロジック）。正典: schemas/project.schema.json / 11_SCHEMA_REFERENCE.md §1,§7。
// 副作用なし。ファイルI/Oは infrastructure/projectFs.ts（Tauriコマンド）へ分離する（CLAUDE.md §4）。
import {
  DEFAULT_TARGET_DURATION_SEC, DEFAULT_VOICE_ID, FPS,
  NARRATION_VOLUME, VIDEO_HARD_MAX_SEC,
} from '../constants';
import { ORIENTATION, VIDEO_KIND } from '../enums';
import type { Purpose, VideoKind } from '../enums';
import { DEFAULT_FONT_ID, isKnownFontId } from '../font/fontCatalog';
import { isKnownBundledBgmId } from '../bgm/bgmCatalog';
import { validateProject } from '../validation/generated/validators.js';
import { isTimelineProjectDoc } from '../projectFormat';
import { normalizeDialogueTiming } from './narrationLines';
import { isNewerSchemaVersion, PROJECT_NEWER_VERSION_MESSAGE } from '../schemaVersionCompare';
import type {
  Asset, BgmSettings, CompanyInfo, GeneralBrief, Part, Project, Scene,
  TimelineOverlay, ToneSettings, VideoSettings, VoiceSettings,
} from './types';

/** project.json の schemaVersion（正典 §1）。1.0→1.1：videoKind/generalBrief・additionalNotes 移送（ADR-0011）。1.1→1.2：videoSettings.width/height を撤廃し aspectRatio を単一の真実に（ADR-0012）。1.2→1.3：videoSettings.fontId（同梱フォント選択）を追加（任意・未指定は既定フォント）。1.3→1.4：bgmSettings.bundledBgmId（標準BGM選択）を追加（任意・未指定は標準BGM未選択）。1.4→1.5：scene.fontId（場面ごとのフォント）を追加（任意・null/未指定は動画全体を継承）。1.5→1.6：FREE 図形種別/枠線（#173）。1.6→1.7：テキストごとのフォント（#178）。1.7→1.8：掛け合い＝scene.lines（NarrationLine[]）＋scene.subtitleEnabledDefault を追加（任意・narration 残置・ADR-0015/#180）。1.8→1.9：FREE 要素の回転 FreeElement.rotation（度・任意・未指定=回転なし・#208）。1.9→1.10：FREE text の体裁 lineHeight（行間）/textAlign（揃え）を追加（任意・縁取りは既存 strokeColor/strokeWidth を text にも適用・#209）。1.10→1.11：FREE 要素の hidden（非表示）/locked（ロック）を追加（任意・レイヤー一覧・#210）。1.11→1.12：掛け合いの行ごとの抑揚 NarrationLine.intonation を追加（任意・null=場面/動画の既定を継承・#242）。1.12→1.13：scene.slotFits（場面ごと・スロット別の画像の収め方）を追加（任意・未指定=テンプレ層の fit を使用・④）。1.13→1.14：scene.groups（要素のグループ化・ADR-0022）を追加（任意・未指定=グループ無し）。1.14→1.15：timelineOverlay（場面横断タイムラインの上位編集・ADR-0018）を追加（任意・未指定=場面射影のみ・無変換）。1.15→1.16：scene.bgmSettings（場面ごとのBGM・ADR-0018 ③(7)）を追加（任意・未指定=プロジェクト既定を継承・無変換）。1.16→1.17：timelineOverlay.animations（要素アニメーション＝キーフレーム・ADR-0019 ④）を追加（任意・未指定=アニメ無し＝静止・無変換）。1.17→1.18：scene.slotVideoStart（動画スロット本体アニメの再生開始タイミング＝モード明示・ADR-0027・#444）を追加（任意・未指定=withAnim＝アニメと同時・無変換）。1.18→1.19：scene.slotClips（動画クリップ調整の per-use 上書き＝範囲/速度/元音声・ADR-0028・#472）を追加（任意・未上書きフィールドは asset.clip を継承・無変換）。1.19→1.20：FREE 自由配置の字幕要素（FreeElement.kind='subtitle'）＋対象 FreeElement.subtitleSource（読み上げ/全行/話者・ADR-0029）を追加（任意・未指定=後方互換〔単独→読み上げ・掛け合い→全行〕・無変換）。1.20→1.21：掛け合いの同時開始 NarrationLine.startWithPrevious（前のセリフと同時に開始＝並行音声・ADR-0031）を追加（任意・未指定=逐次・無変換）。1.21→1.22：FREE 要素の任意表示名 FreeElement.name（重ね順一覧/チップの見分け用・#525-12）を追加（任意・未指定=種類＋連番の自動名・無変換）。1.22→1.23：FREE の text/subtitle 要素の背景帯 FreeElement.background（可読性の下地・通常字幕層 layer.background と同型・#529）を追加（任意・未指定/enabled:false=背景帯なし・無変換）。1.23→1.24・1.24→1.25：文字の体裁の場面別上書き scene.textStyles（テキスト種別ごとの色/サイズ/太さ/縁取り・#555）を追加（任意・各プロパティ未指定=テンプレ層→既定を継承・配置はテンプレ駆動のまま・無変換）。1.25→1.26：文字の影 shadow・字間 letterSpacing を追加し、背景帯 background を文字にも一般化（Layer/FreeElement/TextStyle の3つに同じ語彙・ADR-0032 追補3＝両形式に効く共有の語彙・#264）。いずれも任意追加＝**無変換**（未指定＝影なし・字間0・帯なし＝従来の出力は不変）。 */
export const PROJECT_SCHEMA_VERSION = '1.26';

/** プロジェクト保存に必要な見出し情報（Asset/Part/Scene 以外）。 */
export interface ProjectHeader {
  projectId: string;
  projectName: string;
  /** 動画の種類（ADR-0011）。省略時は recruit。 */
  videoKind?: VideoKind;
  purpose: Purpose;
  createdAt: string;
  updatedAt: string;
  videoSettings: VideoSettings;
  /** 採用（videoKind=recruit）のとき必須。general では持たない（ADR-0011）。 */
  companyInfo?: CompanyInfo;
  /** 一般・社内発表（videoKind=general）の入力。 */
  generalBrief?: GeneralBrief;
  /** 利用者の自由記述（両用途共通・AIへそのまま送る補足）。 */
  additionalNotes?: string;
  toneSettings?: ToneSettings;
  voiceSettings: VoiceSettings;
  bgmSettings?: BgmSettings;
  /** 場面横断タイムラインの上位編集（ADR-0018・任意・schema 1.15）。未設定＝場面射影のみ。 */
  timelineOverlay?: TimelineOverlay;
}

/** 既定 videoSettings（横型16:9・30fps。寸法は aspectRatio から導出＝ADR-0012）。 */
export function defaultVideoSettings(): VideoSettings {
  return {
    aspectRatio: ORIENTATION.landscape,
    fps: FPS,
    targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
    maxDurationSec: VIDEO_HARD_MAX_SEC,
    fontId: DEFAULT_FONT_ID,
  };
}

/** 既定 voiceSettings（ナレーター＝ずんだもん。値域は §7.1）。 */
export function defaultVoiceSettings(): VoiceSettings {
  return {
    defaultVoiceId: DEFAULT_VOICE_ID,
    speed: 1.0,
    pitch: 0.0,
    intonation: 1.0,
    volume: NARRATION_VOLUME,
  };
}

/** proj_{YYYYMMDD}_{NNN}（§2.1）。同日の既存IDから次の連番を採る。 */
export function createProjectId(now: Date, existingIds: readonly string[]): string {
  const prefix = `proj_${formatYmd(now)}_`;
  let max = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** asset_NNN を発行する（§2.1）。既存IDと衝突しない最小の3桁連番。 */
export function createAssetId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = 1;
  let id = `asset_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `asset_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/**
 * bgm_{slug}_{NNN} を発行する（§2.1）。slug は表示名/ファイル名を `[a-z0-9_]` に正規化したもの。
 * slug が空（日本語のみ等）のときは `bgm_{NNN}`。既存IDと衝突しない最小の3桁連番。
 */
export function createBgmId(slug: string, existingIds: readonly string[]): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned ? `bgm_${cleaned}` : 'bgm';
  const used = new Set(existingIds);
  let n = 1;
  let id = `${base}_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `${base}_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/** scene_NNN / part_NNN を発行する共通ロジック（§2.1）。既存と衝突しない最小の3桁連番（空き番号を埋める）。 */
function nextNumberedId(prefix: string, existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = 1;
  let id = `${prefix}_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/** scene_NNN を発行する（§2.1）。 */
export function createSceneId(existingIds: readonly string[]): string {
  return nextNumberedId('scene', existingIds);
}

/** part_NNN を発行する（§2.1）。 */
export function createPartId(existingIds: readonly string[]): string {
  return nextNumberedId('part', existingIds);
}

/** free_NNN を発行する（§2.1・FREE 自由配置要素 id・scene 内一意）。 */
export function createFreeElementId(existingIds: readonly string[]): string {
  return nextNumberedId('free', existingIds);
}

/** line_NNN を発行する（§2.1・セリフ行 id・scene 内一意・ADR-0015）。 */
export function createLineId(existingIds: readonly string[]): string {
  return nextNumberedId('line', existingIds);
}

/** group_NNN を発行する（§2.1・グループ id・scene/template 内一意・ADR-0022）。 */
export function createGroupId(existingIds: readonly string[]): string {
  return nextNumberedId('group', existingIds);
}

/** clip_NNN を発行する（§2.1・**タイムライン形式**のクリップ id・project 内一意・ADR-0032）。場面形式の `ovclip_NNN` とは別物。 */
export function createClipId(existingIds: readonly string[]): string {
  return nextNumberedId('clip', existingIds);
}

/** track_NNN を発行する（§2.1・**タイムライン形式**のトラック id・project 内一意・ADR-0032）。 */
export function createTrackId(existingIds: readonly string[]): string {
  return nextNumberedId('track', existingIds);
}

/** anim_NNN を発行する（§2.1・要素アニメーション id・project 内一意・ADR-0019 ④）。 */
export function createAnimationId(existingIds: readonly string[]): string {
  return nextNumberedId('anim', existingIds);
}

/** ストアの作業状態を schema 準拠の Project へ組み立てる。 */
export function assembleProject(
  header: ProjectHeader,
  assets: Asset[],
  parts: Part[],
  scenes: Scene[],
): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: header.videoKind ?? VIDEO_KIND.recruit,
    projectId: header.projectId,
    projectName: header.projectName,
    purpose: header.purpose,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    videoSettings: header.videoSettings,
    ...(header.companyInfo ? { companyInfo: header.companyInfo } : {}),
    ...(header.generalBrief ? { generalBrief: header.generalBrief } : {}),
    ...(header.additionalNotes ? { additionalNotes: header.additionalNotes } : {}),
    ...(header.toneSettings ? { toneSettings: header.toneSettings } : {}),
    voiceSettings: header.voiceSettings,
    ...(header.bgmSettings ? { bgmSettings: header.bgmSettings } : {}),
    assets,
    parts,
    scenes,
    ...(header.timelineOverlay ? { timelineOverlay: header.timelineOverlay } : {}),
  };
}

/** 読込済み Project から保存用ヘッダ（ProjectHeader）を取り出す＝assembleProject の逆。
 *  Project にヘッダ系フィールドを足したら必ずここにも足す（store の loadProject が meta を手組みして取りこぼすのを防ぐ・#324）。 */
export function projectHeaderFromProject(project: Project): ProjectHeader {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    videoKind: project.videoKind,
    purpose: project.purpose,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    videoSettings: project.videoSettings,
    companyInfo: project.companyInfo,
    generalBrief: project.generalBrief,
    additionalNotes: project.additionalNotes,
    toneSettings: project.toneSettings,
    voiceSettings: project.voiceSettings,
    bgmSettings: project.bgmSettings,
    timelineOverlay: project.timelineOverlay,
  };
}

/** 1.x は対応。未対応メジャー（2.0 等）は読込拒否（§1）。 */
export function isSupportedSchemaVersion(version: string): boolean {
  return version.startsWith('1.');
}

/** 読込失敗（次の行動を示すユーザー向け文言を message に持つ）。 */
export class ProjectLoadError extends Error {}

/** 文字列(JSON) → Project。schemaVersion と最低限の構造を検証する。 */
export function parseProjectDoc(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectLoadError('プロジェクトファイルを読み取れませんでした。別のプロジェクトを選んでください。');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectLoadError('プロジェクトの内容が正しくありません。別のプロジェクトを選んでください。');
  }
  const doc = raw as Record<string, unknown>;
  // タイムライン編集の形式（ADR-0032）は**別の文書**なので、場面形式として読み込まない。
  // 版の判定より先に見る＝版は形式ごとに独立に進むので、「新しい形式のため開けません（更新してください）」
  // という**別の理由**の案内になってしまう（§2-5・15 §6 `PROJECT_FORMAT_UNSUPPORTED`）。
  if (isTimelineProjectDoc(doc)) {
    throw new ProjectLoadError('この動画はタイムラインで編集する形式です。場面の編集画面では開けません。一覧から別の動画を選んでください。');
  }
  const version = doc.schemaVersion;
  if (typeof version !== 'string' || !isSupportedSchemaVersion(version)) {
    throw new ProjectLoadError('このプロジェクトは新しい形式のため開けません。アプリを更新してください。');
  }
  // ⚠️ **アプリより新しい版は、引き上げる前に断る**（#793）＝上の関門は**メジャーしか見ない**ので、
  // **同じメジャーの新しいマイナー**（1.26 等）はここまで通ってしまう。そのまま進むと
  // `migrateProject` が版を**現行へ書き換え**（印が黙って下がる）、新しい語彙があれば ajv が落ちて
  // 「プロジェクトの内容が正しくありません。**別のプロジェクトを選んでください**」＝**嘘**になる
  //（壊れておらず、アプリを更新すれば開ける。別のを選んでも解決しない・§2-5）。
  if (isNewerSchemaVersion(version, PROJECT_SCHEMA_VERSION)) {
    throw new ProjectLoadError(PROJECT_NEWER_VERSION_MESSAGE);
  }
  for (const key of ['projectId', 'projectName', 'purpose'] as const) {
    if (typeof doc[key] !== 'string') {
      throw new ProjectLoadError('プロジェクトの必須情報が欠けています。別のプロジェクトを選んでください。');
    }
  }
  for (const key of ['assets', 'parts', 'scenes'] as const) {
    if (!Array.isArray(doc[key])) {
      throw new ProjectLoadError('プロジェクトの必須情報が欠けています。別のプロジェクトを選んでください。');
    }
  }
  let migrated: Project;
  try {
    migrated = migrateProject(doc as unknown as Project);
  } catch (e) {
    // 移行中の想定外エラー（防御しきれない型不正）も §2-5 文言で拒否する＝生 TypeError を UI へ出さない（#416 P1）。
    console.warn('[project] 移行中に想定外のエラー:', e);
    throw new ProjectLoadError('プロジェクトの内容が正しくありません。別のプロジェクトを選んでください。');
  }
  // 移行後（現行版）を正典スキーマで検証する（11 §8 V2・#416）。旧版は migrate 済みなので現行スキーマで判定できる（後方互換）。
  // 読込拒否は「型不正・必須欠落」（構造破損）に限定する（受け入れ条件）。minLength/enum/範囲などの内容制約違反は
  // 作りかけプロジェクト（新規は companyName 空・#411 の 80字超/尺0秒 等）が正常に出すため拒否しない＝弾かない。
  // どの違反もログには残す（§2-3＝UI には出さない・技術詳細はログのみ／保存側は当面すべて警告）。
  const check = validateProjectDoc(migrated);
  if (!check.valid) {
    console.warn('[project] 読込スキーマ検証に失敗:', check.errors);
    if (check.structural) {
      throw new ProjectLoadError('プロジェクトの内容が正しくありません。別のプロジェクトを選んでください。');
    }
  }
  return migrated;
}

/** 構造破損（型不正・必須欠落）とみなす ajv キーワード。これらのみ読込拒否の対象（#416・受け入れ条件）。 */
const STRUCTURAL_VALIDATION_KEYWORDS = new Set(['type', 'required']);

/** ajv の検証エラーを読みやすい1行配列へ整形（ログ・デバッグ用。UI には出さない＝§2-3/§2-5）。 */
function formatProjectErrors(): string[] {
  return (validateProject.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
}

/**
 * project を正典スキーマ（型・必須・enum・範囲）で検証する（11 §8 V2・#416）。適合で valid:true。
 * 不適合は valid:false＋技術エラー（ログ用）＋ structural（型不正/必須欠落を含むか＝読込拒否の対象か）。
 * 読込は structural のときだけ拒否、保存側は当面すべて警告ログに使う（段階的に強制）。
 */
export function validateProjectDoc(data: unknown): { valid: boolean; errors: string[]; structural: boolean } {
  if (validateProject(data)) return { valid: true, errors: [], structural: false };
  const structural = (validateProject.errors ?? []).some((e) => STRUCTURAL_VALIDATION_KEYWORDS.has(e.keyword));
  return { valid: false, errors: formatProjectErrors(), structural };
}

/** 読込時に旧バージョンを現行（`PROJECT_SCHEMA_VERSION`）へ移行する。
 *
 *  ⚠️ **版ごとの変更一覧はここに置かない**（ファイル冒頭の `PROJECT_SCHEMA_VERSION` の docstring が
 *  単一の参照元）。同じ一覧を2か所に持ったので**実際にずれた**＝冒頭は最新なのに、ここは長らく
 *  「1.0〜1.16 を 1.17 へ」のままだった（#513・**6版ぶん**開いていた）。**現行版の番号もここには書かない**
 *  （3行離れた定数に書いてある）。
 *
 *  ここに書くのは**実際に変換が要る版だけ**。書いていない版は additive な任意追加で、
 *  **版番号の付け替え以外の変換は不要**（読めなくならないので移行の手当ても要らない）。
 *
 *  1.0→1.1: companyInfo.additionalNotes をトップレベルへ移送（ADR-0011）。
 *  1.1→1.2: videoSettings.width/height を除去（寸法は aspectRatio から導出＝ADR-0012）。
 *  1.2→1.3: videoSettings.fontId を補完（未指定/不明は既定フォントへ）。
 *  1.3→1.4: 未知の bgmSettings.bundledBgmId を標準BGM未選択へ落とす。
 *  1.4→1.5: 未知の scene.fontId を継承（未指定）へ落とす。null は継承の明示なので保持。
 *
 *  ⚠️ 版に紐づかない正規化も1つある＝**同時開始**（ADR-0031）の休眠フラグ・`startWithPrevious`×`startSec`
 *  の併存を読込時に解消する（実装が無視する状態を残さない・ADR-0026④）。版で分岐しないので上の一覧には無い。 */
/** プレーンオブジェクト（配列・null 以外）か。移行を型不正な値で落とさず、壊れた値はそのまま validateProjectDoc に拾わせる（#416 P1）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function migrateProject(project: Project): Project {
  const next: Project = {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: project.videoKind ?? VIDEO_KIND.recruit,
  };
  // 旧 companyInfo.additionalNotes をトップレベル additionalNotes へ移送し、companyInfo からは除去する。
  const ci: unknown = project.companyInfo;
  if (isRecord(ci) && typeof ci.additionalNotes === 'string') {
    if (next.additionalNotes === undefined) next.additionalNotes = ci.additionalNotes;
    const rest = { ...ci };
    delete rest.additionalNotes;
    next.companyInfo = rest as unknown as CompanyInfo;
  }
  // 1.1→1.2: videoSettings から width/height を除去（寸法は aspectRatio から導出＝ADR-0012）。
  const vs: unknown = project.videoSettings;
  if (isRecord(vs) && ('width' in vs || 'height' in vs)) {
    const cleaned = { ...vs };
    delete cleaned.width;
    delete cleaned.height;
    next.videoSettings = cleaned as unknown as VideoSettings;
  }
  // 1.2→1.3: videoSettings.fontId を補完（未指定/不明は既定フォント＝同梱フォント選択の追加）。videoSettings が
  // オブジェクトのときだけ触る（壊れた値は検証で拒否＝ここで作り込まない・#416 P1）。
  const vsFont: unknown = next.videoSettings;
  if (isRecord(vsFont) && !isKnownFontId(vsFont.fontId)) {
    next.videoSettings = { ...vsFont, fontId: DEFAULT_FONT_ID } as unknown as VideoSettings;
  }
  // 1.3→1.4: 未知の bundledBgmId（旧版・破損）は標準BGM未選択へ落とす（assetId/なしへフォールバック）。
  const bgm: unknown = next.bgmSettings;
  if (isRecord(bgm) && bgm.bundledBgmId != null && !isKnownBundledBgmId(bgm.bundledBgmId)) {
    const cleaned = { ...bgm };
    delete cleaned.bundledBgmId;
    next.bgmSettings = cleaned as unknown as BgmSettings;
  }
  // 1.4→1.5: 未知の scene.fontId（旧版・破損）は継承（未指定）へ落とす。null は継承の明示なので保持。
  // 場面がオブジェクトでない（null 等の壊れた要素）ときはそのまま通し、検証で型不正として拒否させる（#416 P1）。
  if (Array.isArray(next.scenes)) {
    next.scenes = next.scenes.map((sc) => {
      if (!isRecord(sc)) return sc;
      const f = sc.fontId;
      if (f != null && !isKnownFontId(f)) {
        const cleaned = { ...sc };
        delete cleaned.fontId;
        return cleaned as unknown as Scene;
      }
      return sc;
    });
  }
  // 同時開始（ADR-0031）：先頭行の休眠フラグ・startWithPrevious×startSec の併存を読込時に正規化する
  // （実装が無視する状態を残さない・schema は併存を許すが読込で解消・ADR-0026④）。lines が配列の場面のみ触る
  // （壊れた値はそのまま検証へ＝#416 P1）。normalizeDialogueTiming は違反が無ければ同一参照を返す（無変換）。
  if (Array.isArray(next.scenes)) {
    next.scenes = next.scenes.map((sc) =>
      isRecord(sc) && Array.isArray(sc.lines) ? normalizeDialogueTiming(sc as unknown as Scene) : sc,
    );
  }
  return next;
}
