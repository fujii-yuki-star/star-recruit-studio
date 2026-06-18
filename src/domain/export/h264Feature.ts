// H.264 動画保存機能（OpenH264 ランタイム）の抽象状態・表示文言・機能フラグ（ADR-0002 / research/ffmpeg-openh264-windows.md）。
// 取得・検証・配置の本実装は OpenH264 のバージョン/URL/ハッシュ/配置先が確定してから（pin 後）。
// ここには URL・ファイル名・具体バージョン等は持たせない（UI 表示用の汎用状態のみ）。

/**
 * H.264 動画保存機能の抽象状態。具体値（URL/版/ハッシュ/配置先）は含めない。
 * - unavailable: 未準備（まだ使えない）
 * - ready: 準備済み（使える）
 * - disabled: 無効（利用者が切っている）
 * - error: 準備に失敗
 * - verificationRequired: 確認が必要（検証待ち等）
 */
export type H264FeatureStatus = 'unavailable' | 'ready' | 'disabled' | 'error' | 'verificationRequired';

/** 一般ユーザー向けの状態表示文言。 */
export const H264_STATUS_LABEL: Record<H264FeatureStatus, string> = {
  unavailable: '未準備',
  ready: '準備済み',
  disabled: '無効',
  error: '準備に失敗',
  verificationRequired: '確認が必要',
};

/**
 * OpenH264 関連表示の機能フラグ。開発中は libx264 スパイクのため false（既定で OpenH264 関連 UI を非表示）。
 * OpenH264 を動的参照する配布ビルドが受け入れ基準（research §3）を満たし統合した時点で true にする。
 * 型を boolean にし「常に false」と静的に決めつけない（将来の切替を素直に表現）。
 */
export const OPENH264_FEATURE_ENABLED: boolean = false;

/**
 * OpenH264 使用時に必須表示するクレジット文言（Cisco BINARY_LICENSE 条件・research §5）。
 * (1) H.264 機能の設定箇所 と (2) クレジット/ライセンス画面 の両方で使う。
 */
export const OPENH264_CREDIT_TEXT = 'OpenH264 Video Codec provided by Cisco Systems, Inc.';
