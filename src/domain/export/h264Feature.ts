// H.264 動画保存機能の抽象状態・表示文言・機能フラグ。
// 主経路は Media Foundation（h264_mf・OS提供＝ADR-0013）。OpenH264 はフォールバック（ADR-0002 / research/ffmpeg-openh264-windows.md）。
// 状態型・ラベルはエンコーダ非依存（MF/OpenH264 共通の「可用性」表示）。OpenH264 の取得・検証・配置の本実装は版/URL/ハッシュ確定後（pin 後）。
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
 * OpenH264（フォールバック）関連表示の機能フラグ。主経路は Media Foundation のため通常は不要で、既定 false（OpenH264 固有 UI／Cisco クレジットを非表示）。
 * OpenH264 フォールバックを動的参照する配布ビルドが受け入れ基準（research §3）を満たし統合した時点で true にする。
 * 型を boolean にし「常に false」と静的に決めつけない（将来の切替を素直に表現）。
 */
export const OPENH264_FEATURE_ENABLED: boolean = false;

/**
 * OpenH264 フォールバックを使う場合に必須表示するクレジット文言（Cisco BINARY_LICENSE 条件・research §5）。
 * 主経路の Media Foundation（OS提供）では不要。(1) H.264 機能の設定箇所 と (2) クレジット/ライセンス画面 の両方で使う。
 */
export const OPENH264_CREDIT_TEXT = 'OpenH264 Video Codec provided by Cisco Systems, Inc.';
