// 場面の表示時間（秒）の範囲クランプ（§7「durationのclamp」＝必ずテストする純粋ロジック・#411）。副作用なし。
import { SCENE_DEFAULT_DURATION_SEC, VIDEO_HARD_MAX_SEC } from '../constants';

/**
 * 場面の表示時間（秒）を有効な範囲へクランプする。UI の確定（blur）で有効値だけを store に入れるために使う。
 * **これは domain の自動補正**（11 §9・手編集の確定時）であって schema 制約ではない。
 *
 * **場面ごとの上限/下限は持たない**（#553）＝1場面に効く硬い天井は **VIDEO_HARD_MAX_SEC**（絶対天井）だけ。
 * 旧実装は [3, 15] にハード適用していたが、その 3〜15 は **AI 生成のペース配分の“目安”**が出所で、技術要件でも
 * schema 制約でもなかった。AI 生成側の目安は AI_SCENE_*_DURATION_SEC で存続。
 * ※ 総尺の上限（`videoSettings.maxDurationSec`）は V9 の**警告**が担う領域で、ここでは縛らない。
 *
 * 0・負・NaN・Infinity は「壊れた入力」として既定尺へ落とす（0秒の場面を作らない＝11 §9 の自動補正）。
 */
export function clampSceneDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return SCENE_DEFAULT_DURATION_SEC; // NaN/0/負＝壊れた入力→既定へ
  return Math.min(value, VIDEO_HARD_MAX_SEC);
}
