import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { useProjectStore } from "../store/projectStore";

// 共有レンダラ（ADR-0001）でシーンをSVG化して表示する仕上がり確認。
// 出力（書き出し）も同じSVGをラスタライズするため、見た目が一致する。
// スロットの画像は assetSrcById（data URL）で差し込む。未設定はプレースホルダ枠。
export function ScenePreview({ scene, template }: { scene?: Scene; template?: Template }) {
  const assetSrcById = useProjectStore((s) => s.assetSrcById);

  if (!scene || !template) {
    return (
      <div className="preview-stage">
        <span className="preview-stage-label">表示する場面がありません</span>
      </div>
    );
  }

  // 表示サイズはテンプレの canvas（＝向き）に追従させる（16:9→1920×1080 / 9:16→1080×1920・ADR-0012）。
  // sceneSvg は canvas 実寸を width/height に出すので、その実寸を 100% へ置換し、コンテナ比率も canvas に合わせる。
  const { width: cw, height: ch } = template.canvas;
  const svg = layoutToSvg(layoutScene(scene, template), {
    assetSrc: (id) => (id ? assetSrcById[id] : undefined),
  }).replace(`width="${cw}" height="${ch}"`, 'width="100%" height="100%"');

  return (
    <div
      role="img"
      aria-label="場面の仕上がり"
      style={{
        width: "100%",
        aspectRatio: `${cw} / ${ch}`,
        borderRadius: "var(--radius)",
        overflow: "hidden",
        background: "#fff",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-sm)",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
