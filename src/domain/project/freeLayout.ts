// FREE テンプレ場面の自由配置（scene.freeLayout）の検証（ADR-0008 §8 / 11 §8）。
// 純粋関数（副作用なし）。スキーマ適合（型/必須/enum＝V1,V2）は ajv 済み前提で、
// ここは相互参照・範囲などの意味検証（V3–V11 相当）を担い Warning[] を返す。
// エラーコード語彙は 15_ERROR_STATE_MODEL.md §6。文言は §2-5「次の行動」を示す。
import { FREE_ELEMENT_KIND } from '../enums';
import type { Asset, FreeElement, Warning } from './types';

export interface Canvas {
  width: number;
  height: number;
}

function warn(code: string, message: string, field: string, severity: Warning['severity']): Warning {
  return { code, message, field, severity, autoFixed: false };
}

/**
 * freeLayout 要素を検証して警告を返す（警告＝行動は止めない）。
 * - 共通: 幅・高さが正（w>0/h>0）か、canvas を著しく外れていないか。
 * - slot: assetId が project.assets に実在するか（null＝空スロットは可）。
 * - text: 文字が空でないか。
 * shapeType/fit などの kind 別「必須」は schema（exclusiveMinimum・enum）と描画既定で担保し、ここでは扱わない。
 */
export function validateFreeLayout(
  freeLayout: FreeElement[],
  assets: Asset[],
  canvas: Canvas,
): Warning[] {
  const warnings: Warning[] = [];
  const assetIds = new Set(assets.map((a) => a.assetId));

  for (const el of freeLayout) {
    const field = `freeLayout.${el.id}`;

    // サイズ（schema でも exclusiveMinimum:0 だが、編集中の一時値・手編集データに対する防御）。
    if (el.w <= 0 || el.h <= 0) {
      warnings.push(warn('FREE_ELEMENT_INVALID_SIZE', '配置した要素の大きさが正しくありません。幅と高さを設定し直してください', field, 'warning'));
    }

    // 画面外（矩形が canvas と全く重ならない＝著しく外れている場合のみ警告。一部のはみ出しは演出として許容）。
    const offCanvas =
      el.x >= canvas.width || el.y >= canvas.height || el.x + el.w <= 0 || el.y + el.h <= 0;
    if (offCanvas) {
      warnings.push(warn('FREE_ELEMENT_OUT_OF_BOUNDS', '画面の外にはみ出した配置があります。画面内に移動できます', field, 'warning'));
    }

    // kind 別の意味検証。
    if (el.kind === FREE_ELEMENT_KIND.slot) {
      // assetId 非 null のとき、その素材が存在するか（null/undefined＝空スロットは可）。
      if (el.assetId != null && !assetIds.has(el.assetId)) {
        warnings.push(warn('ASSET_NOT_FOUND', '使う写真・動画が見つかりません。選び直してください', field, 'warning'));
      }
    } else if (el.kind === FREE_ELEMENT_KIND.text) {
      if (el.text == null || el.text.trim().length === 0) {
        warnings.push(warn('FREE_TEXT_EMPTY', '文字が入っていない配置があります。文字を入力してください', field, 'info'));
      }
    }
  }

  return warnings;
}
