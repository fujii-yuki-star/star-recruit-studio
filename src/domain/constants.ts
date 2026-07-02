// 定数の正典は docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md §4。
// 文字列・数値リテラルの直書きを避け、ここを単一の参照元にする（CLAUDE.md §2-7 / §6）。
import { ORIENTATION } from './enums';
import type { Orientation } from './enums';

export const SCENE_MIN_DURATION_SEC = 3;
export const SCENE_MAX_DURATION_SEC = 15;
export const SCENE_DEFAULT_DURATION_SEC = 8;
export const TRANSITION_DEFAULT_SEC = 0.5;

export const VIDEO_TARGET_MAX_SEC_MVP = 300;
export const VIDEO_HARD_MAX_SEC = 600;
export const MAX_SCENES_PER_VIDEO = 80;
export const DEFAULT_TARGET_DURATION_SEC = 60;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
// 縦型（9:16・ADR-0012）。SoT は videoSettings.aspectRatio で、寸法はここから導出する。
export const PORTRAIT_WIDTH = 1080;
export const PORTRAIT_HEIGHT = 1920;

/** 向き → フル出力寸法（aspectRatio を単一の真実とし寸法を導出する＝ADR-0012）。
 *  switch + never で網羅性を担保（将来 Orientation に値を追加したらコンパイルエラーで検知）。 */
export function dimsForOrientation(aspectRatio: Orientation): { width: number; height: number } {
  switch (aspectRatio) {
    case ORIENTATION.portrait:
      return { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT };
    case ORIENTATION.landscape:
      return { width: WIDTH, height: HEIGHT };
    default: {
      const _exhaustive: never = aspectRatio;
      return _exhaustive;
    }
  }
}

// 書き出しの軽量(HD相当)で揃える短辺(px)。短辺をこの値に等比縮小する（横16:9→1280×720 / 縦9:16→720×1280）。
// HD 短辺の単一参照元（旧 HD_WIDTH/HD_HEIGHT は exportDimsForOrientation に統合・§2-7）。
export const HD_SHORT = 720;

/** 書き出しの出力寸法（向き＋画質）。hd=true は短辺を HD_SHORT に等比縮小（向きによらず安全）。
 *  full は dimsForOrientation 経由なので Orientation の網羅性は型で保証される（1:1 追加時もそこで検知）。 */
export function exportDimsForOrientation(
  aspectRatio: Orientation,
  hd: boolean,
): { width: number; height: number } {
  const full = dimsForOrientation(aspectRatio);
  if (!hd) return full;
  const scale = HD_SHORT / Math.min(full.width, full.height);
  return { width: Math.round(full.width * scale), height: Math.round(full.height * scale) };
}

export const NARRATION_VOLUME = 1.0;
export const BGM_VOLUME = 0.25;
export const ORIGINAL_AUDIO_VOLUME = 0.2;
// 場面ごとBGMで曲が変わる境界のクロスフェード長（秒・ADR-0018 ③(7)）。前後を half ずつ重ねる。単一の参照元（§2-7）。
export const BGM_CROSSFADE_SEC = 1.0;
// 音量の値域（§4：0.0〜1.5、1.0=原音）。
export const VOLUME_MIN = 0.0;
export const VOLUME_MAX = 1.5;
// 音量スライダーの刻み（UI）。
export const VOLUME_STEP = 0.05;

// 動画クリップの再生速度（§4：atempo 1段の範囲 0.5〜2.0、1.0=等速）。尺は不変（ADR-0007 Phase 3b）。
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;
export const SPEED_DEFAULT = 1.0;
export const SPEED_STEP = 0.25;

// 取り込み時にメモリへ展開（data URL/生バイト）してよい素材サイズの上限（#48・A3）。
// これを超えるファイルは base64/バイトを JS に載せず、ネイティブ「開く」のパス0コピー取り込みへ誘導する（OOM 保険）。
// schema/データには影響しない実装上の保険のため 11§4 定数カタログには載せない（HD_SHORT 等と同じ扱い）。
export const MAX_INLINE_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

export const MAX_NARRATION_LEN_DEFAULT = 120;
export const MAX_SUBTITLE_LEN_DEFAULT = 60;
// 自由記述「その他」(トップレベル additionalNotes・両用途共通・ADR-0011) の上限。schemas/project.schema.json の maxLength と一致させる。
export const ADDITIONAL_NOTES_MAX_LEN = 1000;

// generalBrief（一般・社内発表の入力）の上限（ADR-0011 #4）。schemas/project.schema.json の maxLength/maxItems と一致させる。
export const GENERAL_TITLE_MAX_LEN = 100;        // テーマ・タイトル
export const GENERAL_TARGET_AUDIENCE_MAX_LEN = 100; // 対象視聴者
export const GENERAL_LIST_ITEM_MAX_LEN = 100;    // agenda / keyPoints の1項目
export const GENERAL_LIST_MAX_ITEMS = 20;        // agenda / keyPoints の要素数上限

// 一般動画のトーン候補（toneSettings.tone へ保存する文言・一般ウィザードの選択肢）。ADR-0011 #12。
export const TONE_PRESETS = ['親しみやすい', '丁寧・落ち着いた', 'フォーマル', '明るい・元気'] as const;
// 既定トーン（未選択時・generate のフォールバック）。単一参照元（§2-7）＝二重定義を避ける。
export const DEFAULT_TONE = TONE_PRESETS[0];

export const DEFAULT_VOICE_ID = 'voicevox_zundamon';
export const DEFAULT_CHARACTER_ID = 'yuko';

// スロットの既定フィット（テンプレ・clip 未指定時）。正典(§4)に既定の明記は無く、cover を既定とする（MVP）。
export const DEFAULT_FIT = 'cover' as const;

// 矩形（FREE 要素／テンプレ Layer）をドラッグ/リサイズで潰さないための最小サイズ（canvas px）。両者で共有する単一の参照元（§2-7）。
export const GEOM_MIN_SIZE = 20;

// グループ拡縮の最小倍率（schema: scale>0 を UI でも担保）。FREE/テンプレのグループ枠で共有（ADR-0022・§2-7）。
export const GROUP_MIN_SCALE = 0.1;

// タイムライン overlay クリップの最小長（秒）。トリミングで潰さないための下限（schema: durationSec>0 を UI でも担保・ADR-0018・§2-7）。
export const TIMELINE_MIN_CLIP_SEC = 0.5;
