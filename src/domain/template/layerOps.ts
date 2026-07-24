// テンプレ作成エディタのレイヤー操作（ADR-0017・#214 ③b）。Layer[] の追加/削除/更新の純粋関数（§7 テスト対象）。
import { LAYER_TYPES, TEXT_KEY, TEXT_KEYS, type LayerType, type TextKey } from '../enums';
import type { Layer } from './types';
import { effectiveLayerZ } from './layerOrder';

/** エディタで追加できるレイヤー型（ADR-0017：decor は開放しない＝静的装飾は slot/shape で代替）。 */
export const TEMPLATE_ADDABLE_LAYER_TYPES: LayerType[] = LAYER_TYPES.filter((t) => t !== 'decor');

const LAYER_DEFAULT_W = 480;
const LAYER_DEFAULT_H = 240;

/** 既存と衝突しない layer id（layer_NNN・テンプレ内一意・空き番号を埋める）。 */
export function createLayerId(layers: Layer[]): string {
  const used = new Set(layers.map((l) => l.id));
  let n = 1;
  while (used.has(`layer_${String(n).padStart(3, '0')}`)) n += 1;
  return `layer_${String(n).padStart(3, '0')}`;
}

/** 指定 type のレイヤーを既定値で追加する（最前面）。background は全面、それ以外はキャンバス中央あたり。 */
export function addLayer(layers: Layer[], type: LayerType, canvas: { width: number; height: number }): Layer[] {
  const id = createLayerId(layers);
  // 「最前面」は**実効 z**で測る（種別ごとの既定を持つ層より後ろに入らない＝追加したのに下に出る、を防ぐ）。
  const zIndex = layers.reduce((m, l) => Math.max(m, effectiveLayerZ(l)), 0) + 1;
  // 文字系は textKey 既定を入れて追加直後から場面テキストに紐づく（text→見出し / subtitle→字幕）。未設定だと描画で空になる。
  const textKey = type === 'text' ? TEXT_KEY.title : type === 'subtitle' ? TEXT_KEY.subtitle : undefined;
  const layer: Layer =
    type === 'background'
      ? { id, type, x: 0, y: 0, w: canvas.width, h: canvas.height, zIndex }
      : {
          id,
          type,
          zIndex,
          x: Math.round(canvas.width / 2 - LAYER_DEFAULT_W / 2),
          y: Math.round(canvas.height / 2 - LAYER_DEFAULT_H / 2),
          w: Math.min(LAYER_DEFAULT_W, canvas.width),
          h: Math.min(LAYER_DEFAULT_H, canvas.height),
          ...(textKey ? { textKey } : {}),
        };
  return [...layers, layer];
}

/** 指定 id のレイヤーを取り除く。 */
export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id);
}

/** 指定 id のレイヤーを部分更新する（id/type は変えない）。 */
export function updateLayer(layers: Layer[], id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>): Layer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/**
 * テンプレのテキスト層が使う textKey を正規順（TEXT_KEYS 順）で返す（場面編集の入力欄生成・#214 ④b）。
 * text 層は textKey を持つもののみ、subtitle 層は textKey 未指定なら 'subtitle'（layoutScene の既定束縛に一致）。
 */
export function usedTextKeys(layers: Layer[]): TextKey[] {
  const used = new Set<TextKey>();
  for (const l of layers) {
    if (l.type === 'text' && l.textKey) used.add(l.textKey);
    else if (l.type === 'subtitle') used.add(l.textKey ?? TEXT_KEY.subtitle);
  }
  return TEXT_KEYS.filter((k) => used.has(k));
}

/**
 * テンプレの層のうち「素材を差し込める先」の id 集合（背景・スロット・ロゴ）。
 * 描画（`layout.ts`）・実効使用（`sceneActiveAssetIds`）・切替で**何が出なくなるか**の事前判定
 * （`contentHiddenBySwitch`／`freeContentHiddenBySwitch`）が同じ規則を使うための単一の参照元
 * （§2-7。別々に書くと「出なくならないと言って出なくなる」表示になる）。
 */
export function templateSlotIds(layers: Layer[]): Set<string> {
  return new Set(layers.filter((l) => l.type === 'background' || l.type === 'slot' || l.type === 'logo').map((l) => l.id));
}
