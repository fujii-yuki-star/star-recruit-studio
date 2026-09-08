// 場面カードの小さな見本（#1031）。
//
// ⚠️ **`layoutScene` 以外で描かない**（#1031 の但し書き・ADR-0001）＝サムネだけ別の描き方にすると、
// **カードで見えているもの**と**書き出されるもの**が食い違う。描画の核はプレビュー・書き出しと共有する。
//
// ⚠️ **`ScenePreview` は使わない**＝あちらは**実寸を測って領域いっぱいに収める**部品で、
// `ResizeObserver` を張り、スクロール領域の下端まで見て大きさを決める（大きな1枚のための作り）。
// 場面ストリップには**同じカードが何枚も並ぶ**ので、そのまま使うと
// ①観測が枚数ぶん増え ②小さな箱に対して見当違いの大きさを計算する。
// ここは**測らない**＝`viewBox` と `preserveAspectRatio` に任せる（箱の大きさは CSS が決める）。
//
// ⚠️ **見た目パターンが引けないときは描かない**＝呼ぶ側が代わりの見た目を出す
// （存在しない見た目について語らない・`06 §9`）。
import { memo } from "react";
import { useProjectStore } from "../store/projectStore";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { fontFamilyForId, resolveFontId } from "../../domain/font/fontCatalog";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";

/**
 * ⚠️ **同じものは描き直さない**（PR #1086 レビュー）＝見本は一覧に20枚以上並ぶので、
 * 包まないと**1枚選ぶだけで全枚の絵を作り直す**（探す欄の1文字ごとにも）。
 * ⚠️ **包む側で `scene` の参照を安定させる**＝毎回作り直したオブジェクトを渡すと、包んでも効かない。
 */
export const SceneThumb = memo(function SceneThumb({ scene, template }: { scene: Scene; template: Template }) {
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  // テンプレ既定素材（ADR-0021）は場面素材に無い id のフォールバック（`ScenePreview` と同じ順）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const assetSrc = (id: string | null): string | undefined =>
    id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined;
  // ⚠️ **クレジットは出さない**＝小さすぎて読めないうえ、**出す/出さないは場面の位置で決まる**
  // （`sceneCreditVisibility`）ので、カードごとに出し分けると「なぜこの場面だけ」が読めない。
  const svg = layoutToSvg(layoutScene(scene, template), {
    assetSrc,
    responsive: true,
    fontFamily: fontFamilyForId(resolveFontId(scene.fontId, fontId)),
  });
  return (
    <div
      className="scene-card-thumb thumb"
      // ⚠️ **箱の形は見た目パターンの画面に合わせる**（PR #1084 レビュー）＝
      // CSS の既定は 16:9 なので、**縦型（9:16・ADR-0012）だと左右に大きな余白**が出る。
      // 描く中身と同じもの（見た目の画面寸法）から採る＝箱と絵の形を割らない。
      style={{ aspectRatio: `${template.canvas.width} / ${template.canvas.height}` }}
      // 中身は SVG の文字列（`ScenePreview` と同じ流儀）。
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
