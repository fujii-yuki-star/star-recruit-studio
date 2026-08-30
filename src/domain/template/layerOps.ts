// テンプレ作成エディタのレイヤー操作（ADR-0017・#214 ③b）。Layer[] の追加/削除/更新の純粋関数（§7 テスト対象）。
import { LAYER_TYPE, LAYER_TYPES, TEXT_KEY, TEXT_KEYS, type LayerType, type TextKey } from '../enums';
import { SCENE_DEFAULT_DURATION_SEC } from '../constants';
import type { Layer, Template } from './types';
import { effectiveLayerZ } from './layerOrder';

/** エディタで追加できるレイヤー型（ADR-0017：decor は開放しない＝静的装飾は slot/shape で代替）。 */
export const TEMPLATE_ADDABLE_LAYER_TYPES: LayerType[] = LAYER_TYPES.filter((t) => t !== LAYER_TYPE.decor);

const LAYER_DEFAULT_W = 480;
const LAYER_DEFAULT_H = 240;

/** 既存と衝突しない layer id（layer_NNN・テンプレ内一意・空き番号を埋める）。 */
/** 複製をずらす量（px）＝真下に重なって「増えていない」ように見えるのを防ぐ。 */
const DUPLICATE_OFFSET_PX = 24;

export function createLayerId(layers: Layer[]): string {
  const used = new Set(layers.map((l) => l.id));
  let n = 1;
  while (used.has(`layer_${String(n).padStart(3, '0')}`)) n += 1;
  return `layer_${String(n).padStart(3, '0')}`;
}

/**
 * レイヤーを**中身ごと**複製する（#772 候補4）。FREE 要素・帯は複製できるのにテンプレ層だけ不可だった。
 *
 * ⚠️ **「複製は中身ごと」**（#770 で FREE 要素に入れた流儀）＝体裁・既定素材・収め方まで写す。
 * 変えるのは **id**（新しく採番）と**位置**（少しずらす＝真下に重なって「増えていない」ように見えるのを防ぐ）と
 * **重ね順**（元のすぐ手前）だけ。
 * ⚠️ **元の直後（手前）へ置く**＝一覧の見た目で元の隣に出る（最前面へ飛ばすと、どれが増えたのか探しに行くことになる）。
 */
export function duplicateLayer(layers: Layer[], id: string, canvas: { width: number; height: number }): Layer[] {
  const src = layers.find((l) => l.id === id);
  if (!src) return layers; // 居ない＝何もしない（同一参照＝空の取り消しを作らない）
  const copy: Layer = {
    ...src,
    id: createLayerId(layers),
    // 枠からはみ出さない範囲でずらす（元と同じ大きさのまま右下へ）。
    x: Math.min(Math.max(0, canvas.width - src.w), src.x + DUPLICATE_OFFSET_PX),
    y: Math.min(Math.max(0, canvas.height - src.h), src.y + DUPLICATE_OFFSET_PX),
    zIndex: effectiveLayerZ(src) + 1,
  };
  // 元より手前の層は1つ押し上げる＝コピーが割り込む隙間を作る（同じ z が並ぶと「1段」が表せない）。
  const shifted = layers.map((l) =>
    l.id !== src.id && effectiveLayerZ(l) > effectiveLayerZ(src) ? { ...l, zIndex: effectiveLayerZ(l) + 1 } : l,
  );
  const at = shifted.findIndex((l) => l.id === src.id);
  return [...shifted.slice(0, at + 1), copy, ...shifted.slice(at + 1)];
}

/** 指定 type のレイヤーを既定値で追加する（最前面）。background は全面、それ以外はキャンバス中央あたり。 */
export function addLayer(layers: Layer[], type: LayerType, canvas: { width: number; height: number }): Layer[] {
  const id = createLayerId(layers);
  // 「最前面」は**実効 z**で測る（種別ごとの既定を持つ層より後ろに入らない＝追加したのに下に出る、を防ぐ）。
  const zIndex = layers.reduce((m, l) => Math.max(m, effectiveLayerZ(l)), 0) + 1;
  // 文字系は textKey 既定を入れて追加直後から場面テキストに紐づく（text→見出し / subtitle→字幕）。未設定だと描画で空になる。
  const textKey = type === LAYER_TYPE.text ? TEXT_KEY.title : type === LAYER_TYPE.subtitle ? TEXT_KEY.subtitle : undefined;
  const layer: Layer =
    type === LAYER_TYPE.background
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
 * **直せる種別の一覧**＝見た目パターンが使う種別 ∪ **すでに値が入っている種別**（差分再監査 6巡目 🟡）。
 *
 * ⚠️ **値が入っているのに欄が出ない、を作らない**＝種別ごとのフォント（`textFontIds`）は、見た目パターンを
 * 替えても休眠のまま残り（ADR-0030 追補6）、焼き出しも丸ごと写す。書き出しの門（`usedFonts`）は
 * **休眠のぶんも数えて断る**ので、欄が「いま使う種別」だけだと**案内どおりに選び直す先が無い**
 * （持ち込みフォントが手元から消えると書き出しが止まったまま解除できない＝§2-5 の行き止まり）。
 * 数える側を狭めない（消えたフォントを使っていることに変わりはない）で、**直す側を広げる**。
 */
export function editableTextKeys(layers: Layer[], overrides: Partial<Record<TextKey, unknown>> | undefined): TextKey[] {
  const used = new Set<TextKey>(usedTextKeys(layers));
  for (const k of TEXT_KEYS) if (overrides?.[k] != null) used.add(k);
  return TEXT_KEYS.filter((k) => used.has(k));
}

/**
 * テンプレのテキスト層が使う textKey を正規順（TEXT_KEYS 順）で返す（場面編集の入力欄生成・#214 ④b）。
 * text 層は textKey を持つもののみ、subtitle 層は textKey 未指定なら 'subtitle'（layoutScene の既定束縛に一致）。
 */
export function usedTextKeys(layers: Layer[]): TextKey[] {
  const used = new Set<TextKey>();
  for (const l of layers) {
    const key = textKeyOfLayer(l);
    if (key) used.add(key);
  }
  return TEXT_KEYS.filter((k) => used.has(k));
}

/**
 * その層が使う textKey（`null`＝文字を持たない層）。**既定の解き方はここだけ**（§2-7）。
 *
 * ⚠️ **字幕層は未指定なら `subtitle`**（`layoutScene` の既定束縛と同じ）＝この既定を呼び出し側で
 * 書き直すと、**欄はあるのに「無い」と判断される**（#818 レビュー 🟡＝ドリルインが字幕の層で
 * 空振りし、「文字の層にも入れる」が崩れていた）。
 */
export function textKeyOfLayer(layer: Layer): TextKey | null {
  if (layer.type === LAYER_TYPE.text) return layer.textKey ?? null;
  if (layer.type === LAYER_TYPE.subtitle) return layer.textKey ?? TEXT_KEY.subtitle;
  return null;
}

/**
 * テンプレの層のうち「素材を差し込める先」の id 集合（背景・スロット・ロゴ）。
 * 描画（`layout.ts`）・実効使用（`sceneActiveAssetIds`）・切替で**何が出なくなるか**の事前判定
 * （`contentHiddenBySwitch`／`freeContentHiddenBySwitch`）が同じ規則を使うための単一の参照元
 * （§2-7。別々に書くと「出なくならないと言って出なくなる」表示になる）。
 */
export function templateSlotIds(layers: Layer[]): Set<string> {
  return new Set(layers.filter((l) => l.type === LAYER_TYPE.background || l.type === LAYER_TYPE.slot || l.type === LAYER_TYPE.logo).map((l) => l.id));
}

/**
 * そのテンプレで場面/クリップを作るときの既定の尺（秒）。テンプレの指定が無ければ共通の既定。
 * **場面形式（新しい場面・見本）とタイムライン形式（置く）が同じ値を使う**ための単一の参照元（§2-7）＝
 * 同じテンプレが形式や画面によって違う長さで出てこない（ADR-0026②）。
 */
export function defaultDurationForTemplate(template: Pick<Template, 'defaults'>): number {
  return template.defaults?.durationSec ?? SCENE_DEFAULT_DURATION_SEC;
}
