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

  // 1920x1080 固定の幅高を、コンテナにフィットさせる
  const svg = layoutToSvg(layoutScene(scene, template), {
    assetSrc: (id) => (id ? assetSrcById[id] : undefined),
  }).replace('width="1920" height="1080"', 'width="100%" height="100%"');

  return (
    <div
      role="img"
      aria-label="場面の仕上がり"
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
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
