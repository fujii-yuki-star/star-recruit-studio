// 定数の正典は docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md §4。
// 文字列・数値リテラルの直書きを避け、ここを単一の参照元にする（CLAUDE.md §2-7 / §6）。

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
// 書き出し時の縮小オプション（16:9 を維持。videoSettings の正典値ではなく出力時の選択肢）。
export const HD_WIDTH = 1280;
export const HD_HEIGHT = 720;

export const NARRATION_VOLUME = 1.0;
export const BGM_VOLUME = 0.25;
export const ORIGINAL_AUDIO_VOLUME = 0.2;
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

export const MAX_NARRATION_LEN_DEFAULT = 120;
export const MAX_SUBTITLE_LEN_DEFAULT = 60;
// 自由記述「その他」(companyInfo.additionalNotes) の上限。schemas/project.schema.json の maxLength と一致させる。
export const ADDITIONAL_NOTES_MAX_LEN = 1000;

export const DEFAULT_VOICE_ID = 'voicevox_zundamon';
export const DEFAULT_CHARACTER_ID = 'yuko';

// スロットの既定フィット（テンプレ・clip 未指定時）。正典(§4)に既定の明記は無く、cover を既定とする（MVP）。
export const DEFAULT_FIT = 'cover' as const;
