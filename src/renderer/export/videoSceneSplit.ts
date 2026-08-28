// 動画ありシーンの下/上レイヤー分割（ADR-0006）。動画スロットの zIndex を境に、
// 下PNG（背景等・不透明・全面）と上PNG（文字/ゆうこ等・透過）の SVG を作る。
// スロット自身はどちらにも描かない（FFmpeg が動画で埋める＝透明な穴）。
import type { LayoutItem, Rect, SceneLayout } from '../layout';
import { layoutToSvg } from '../sceneSvg';

export interface VideoSceneSplit {
  /** 動画より下のレイヤー（背景含む・不透明・全面）。 */
  belowSvg: string;
  /** 動画より上のレイヤー（透過）。 */
  aboveSvg: string;
  /** 動画スロットの矩形（FFmpeg のスケール/配置に使う）。 */
  slot: Rect;
}

/**
 * 動画スロット(slotId)を境に SceneLayout を下/上SVGへ分割する。slotId が無ければ null。
 * 下＝zIndex<slot（背景塗りあり）／上＝zIndex>=slot かつ slot 以外（透過）。
 */
export function splitVideoSceneSvg(
  layout: SceneLayout,
  slotId: string,
  assetSrc?: (assetId: string | null) => string | undefined,
  includeItem?: (item: LayoutItem) => boolean,
  fontFamily?: string,
  // ⚠️ **既定値を持たない**（PR #881 レビュー）＝ADR-0003「常時表示」時代の名残で `NARRATOR_CREDIT` を
  // 既定にしていたが、ADR-0025 で**出す/出さないは呼ぶ側が決める**ようになった。既定があると、
  // 呼ぶ側が「出さない」と判断して `undefined` を渡しても**ここで復活して焼き込まれる**
  //（動画スロットのある場面は必ずこの経路＝「非表示」を選んでもクレジットが入っていた）。
  // 未指定＝描かない（`layoutToSvg` の `credit?: string` と同じ契約）。
  credit?: string,
): VideoSceneSplit | null {
  // 動画スロット（image かつ role=slot）のみを境界に使う。誤った id（fill/text 等）では境界を取らず null。
  const slot = layout.items.find(
    (it) => it.id === slotId && it.kind === 'image' && it.role === 'slot',
  );
  if (!slot) return null;
  const slotZ = slot.zIndex;
  // 追加の絞り込み（字幕OFF等）。未指定なら全件通す。
  const pass = includeItem ?? (() => true);
  // 下＝zIndex<slot ／ 上＝slot 自身を除く残り全部（zIndex>=slot）。
  // 「== slot」のアイテムを上に含めることで取りこぼし（描画漏れ）を防ぐ＝網羅的分割（ADR-0006 もこの規則）。
  const belowSvg = layoutToSvg(layout, {
    assetSrc,
    itemFilter: (it) => pass(it) && it.id !== slotId && it.zIndex < slotZ,
    fontFamily,
  });
  const aboveSvg = layoutToSvg(layout, {
    assetSrc,
    transparent: true,
    itemFilter: (it) => pass(it) && it.id !== slotId && it.zIndex >= slotZ,
    // 常時クレジット（ADR-0003）は最前面＝上レイヤーにのみ付ける（下レイヤーには付けない＝二重化防止）。
    credit,
    fontFamily,
  });
  return { belowSvg, aboveSvg, slot: { x: slot.x, y: slot.y, w: slot.w, h: slot.h } };
}

/** 複数動画スロットの分割結果（#431）。zIndex 順に below → slot0 → mid0 → slot1 → … → above を重ねる。 */
export interface VideoSceneSplitMulti {
  /** 最下の静止層（背景含む・不透明・全面）。zIndex < 先頭スロット。 */
  belowSvg: string;
  /** 連続する動画スロットの間の静止層（透過・枚数＝slots.length−1）。zIndex 昇順。 */
  midSvgs: string[];
  /** 最上の静止層（透過・字幕/クレジット）。zIndex >= 末尾スロット。 */
  aboveSvg: string;
  /** 動画スロット（zIndex 昇順＝下→上）。矩形と層 id（回転/不透明度はプレビュー実映像の video 要素へ反映・#432）。 */
  slots: { layerId: string; rect: Rect; rotation?: number; opacity?: number }[];
}

/**
 * 複数の動画スロット(slotIds)を境に SceneLayout を「N+1 枚の静止層＋N スロット」に分割する（#431・zIndex 帯で切る）。
 * 単一スロットのときは splitVideoSceneSvg と同一（below=z<slot / above=z>=slot / mid なし）＝後方互換。
 * どれかのスロット id が layout に無ければ null。字幕/クレジットは最上層(above)にのみ付ける。
 */
export function splitVideoSceneSvgMulti(
  layout: SceneLayout,
  slotIds: string[],
  assetSrc?: (assetId: string | null) => string | undefined,
  includeItem?: (item: LayoutItem) => boolean,
  fontFamily?: string,
  // ⚠️ **既定値を持たない**（PR #881 レビュー）＝ADR-0003「常時表示」時代の名残で `NARRATOR_CREDIT` を
  // 既定にしていたが、ADR-0025 で**出す/出さないは呼ぶ側が決める**ようになった。既定があると、
  // 呼ぶ側が「出さない」と判断して `undefined` を渡しても**ここで復活して焼き込まれる**
  //（動画スロットのある場面は必ずこの経路＝「非表示」を選んでもクレジットが入っていた）。
  // 未指定＝描かない（`layoutToSvg` の `credit?: string` と同じ契約）。
  credit?: string,
  // responsive: SVG ルートを 100% にしてコンテナへフィット（プレビューの実映像3層描画用・#432）。書き出しは既定 false（固定寸法でラスタライズ）。
  responsive: boolean = false,
): VideoSceneSplitMulti | null {
  const found = slotIds.map((id) =>
    layout.items.find((it) => it.id === id && it.kind === 'image' && it.role === 'slot'),
  );
  if (found.some((s) => !s)) return null; // 誤った id（fill/text 等）や未解決は分割不可
  const slots = (found as LayoutItem[]).slice().sort((a, b) => a.zIndex - b.zIndex);
  const zs = slots.map((s) => s.zIndex);
  const slotIdSet = new Set(slotIds);
  const pass = includeItem ?? (() => true);
  const notSlot = (it: LayoutItem): boolean => pass(it) && !slotIdSet.has(it.id);
  // static_0: z < zs[0]（背景塗りあり）。
  const belowSvg = layoutToSvg(layout, {
    assetSrc,
    itemFilter: (it) => notSlot(it) && it.zIndex < zs[0],
    fontFamily,
    responsive,
  });
  // static_k（1..N-1）: zs[k-1] <= z < zs[k]（動画 k-1 と k の間・透過）。「== スロット zIndex」は上側の帯へ。
  const midSvgs: string[] = [];
  for (let k = 1; k < slots.length; k += 1) {
    midSvgs.push(
      layoutToSvg(layout, {
        assetSrc,
        transparent: true,
        itemFilter: (it) => notSlot(it) && it.zIndex >= zs[k - 1] && it.zIndex < zs[k],
        fontFamily,
        responsive,
      }),
    );
  }
  // static_N: z >= 末尾スロット（最上・字幕/クレジット）。
  const aboveSvg = layoutToSvg(layout, {
    assetSrc,
    transparent: true,
    itemFilter: (it) => notSlot(it) && it.zIndex >= zs[zs.length - 1],
    credit,
    fontFamily,
    responsive,
  });
  return {
    belowSvg,
    midSvgs,
    aboveSvg,
    slots: slots.map((s) => ({
      layerId: s.id,
      rect: { x: s.x, y: s.y, w: s.w, h: s.h },
      rotation: s.rotation,
      opacity: s.kind === 'image' ? s.opacity : undefined,
    })),
  };
}
