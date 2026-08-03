// 欄の配置を描く共通部品（ADR-0033 段階2）。**並べ方の規則は domain**（`panelLayout`）にあり、
// ここは「描く」と「掴む」だけを持つ（`§4`）。
//
// 画面は左・中央・右・下の4つの領域に分かれ、**領域の中は入れ子で分割**できる（決定11）。
// 境界（分かれ目・領域の外枠）は**ドラッグで動かせる**（決定2）。欄の中身は使う側から渡す。
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ContextMenu } from "../ContextMenu";
import type { ContextMenuItem } from "../ContextMenu";
import {
  DROP_SIDE,
  MIN_PANEL_RATIO,
  PANEL_REGION,
  PANEL_REGIONS,
  SPLIT_DIR,
  addPanelToRegion,
  isSplit,
  movePanelStep,
  removePanel,
  resizeRegion,
  resizeSplit,
} from "../../../domain/layout/panelLayout";
import type { PanelId, PanelLayout, PanelNode, PanelRegion, RegionSizes } from "../../../domain/layout/panelLayout";

/** 欄1つ＝見出しと中身（中身は使う側が作る）。 */
export interface PanelSpec {
  id: PanelId;
  title: string;
  content: ReactNode;
}

/** 領域のユーザー向け名（§2-3＝「欄」「配置」の言い方に合わせる）。 */
const REGION_LABEL: Record<PanelRegion, string> = {
  left: "左",
  center: "真ん中",
  right: "右",
  bottom: "下",
};

/** 境界をつかむ帯の太さ（px）。細すぎると掴めない・太すぎると中身を食う。 */
const DIVIDER_PX = 6;

export function PanelLayoutView({
  layout,
  panels,
  onChange,
}: {
  layout: PanelLayout;
  panels: readonly PanelSpec[];
  onChange: (next: PanelLayout) => void;
}): React.ReactElement {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ panelId: PanelId; x: number; y: number } | null>(null);

  const menuItems = (panelId: PanelId): ContextMenuItem[] => [
    // 並べ替えはドラッグとメニューの両方（決定12）＝ドラッグが使えないときの逃げ道。
    { label: "上へ", onSelect: () => onChange(movePanelStep(layout, panelId, DROP_SIDE.top)) },
    { label: "下へ", onSelect: () => onChange(movePanelStep(layout, panelId, DROP_SIDE.bottom)) },
    { label: "左へ", onSelect: () => onChange(movePanelStep(layout, panelId, DROP_SIDE.left)) },
    { label: "右へ", onSelect: () => onChange(movePanelStep(layout, panelId, DROP_SIDE.right)) },
    ...PANEL_REGIONS.map((region) => ({
      label: `${REGION_LABEL[region]}へ移す`,
      onSelect: () => onChange(addPanelToRegion(layout, panelId, region)),
    })),
    { label: "この欄を閉じる", danger: true, onSelect: () => onChange(removePanel(layout, panelId)) },
  ];

  /** 分かれ目の境界をドラッグ（決定2）。掴んだ2つの間だけを動かす＝隣の欄が芋づるで動かない。 */
  const beginSplitDrag = (
    e: ReactPointerEvent,
    region: PanelRegion,
    path: number[],
    node: { dir: string; sizes: number[] },
    index: number,
    box: DOMRect,
  ): void => {
    e.preventDefault();
    const horizontal = node.dir === SPLIT_DIR.row;
    const total = horizontal ? box.width : box.height;
    if (total <= 0) return;
    const start = horizontal ? e.clientX : e.clientY;
    const a0 = node.sizes[index];
    const b0 = node.sizes[index + 1];
    const move = (ev: PointerEvent): void => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) / total;
      // 掴んだ2つの合計は変えない＝ほかの欄の大きさに触らない。
      const a = Math.min(Math.max(MIN_PANEL_RATIO, a0 + delta), a0 + b0 - MIN_PANEL_RATIO);
      const sizes = [...node.sizes];
      sizes[index] = a;
      sizes[index + 1] = a0 + b0 - a;
      onChange(resizeSplit(layout, region, path, sizes));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 領域の外枠をドラッグ（左右の幅・下の高さ）。 */
  const beginRegionDrag = (e: ReactPointerEvent, region: keyof RegionSizes): void => {
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const move = (ev: PointerEvent): void => {
      const ratio =
        region === "left"
          ? (ev.clientX - box.left) / box.width
          : region === "right"
            ? (box.right - ev.clientX) / box.width
            : (box.bottom - ev.clientY) / box.height;
      onChange(resizeRegion(layout, region, ratio));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderNode = (node: PanelNode, region: PanelRegion, path: number[]): ReactNode => {
    if (!isSplit(node)) {
      const spec = byId.get(node.panelId);
      // 知らない欄は描かない（`normalizeLayout` が落とすので通常は来ない＝念のため）。
      if (!spec) return null;
      return (
        <section className="panel-frame" key={spec.id}>
          <header
            className="panel-frame-head"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ panelId: spec.id, x: e.clientX, y: e.clientY });
            }}
          >
            <h3>{spec.title}</h3>
            <button
              className="btn btn-ghost btn-sm"
              aria-label={`${spec.title}の欄の操作`}
              title="この欄の操作（右クリックでも開けます）"
              onClick={(e) => setMenu({ panelId: spec.id, x: e.clientX, y: e.clientY })}
            >
              ⋮
            </button>
          </header>
          <div className="panel-frame-body">{spec.content}</div>
        </section>
      );
    }
    const horizontal = node.dir === SPLIT_DIR.row;
    return (
      <div className={`panel-split ${horizontal ? "panel-split--row" : "panel-split--column"}`}>
        {node.children.map((child, i) => (
          <SplitChild
            key={i}
            ratio={node.sizes[i]}
            horizontal={horizontal}
            showDivider={i < node.children.length - 1}
            onDividerDown={(e, box) => beginSplitDrag(e, region, path, node, i, box)}
          >
            {renderNode(child, region, [...path, i])}
          </SplitChild>
        ))}
      </div>
    );
  };

  const regionNode = (region: PanelRegion): ReactNode => {
    const node = layout.nodes[region];
    return node ? renderNode(node, region, []) : null;
  };

  const { left, right, bottom } = layout.regionSizes;
  const hasLeft = layout.nodes.left != null;
  const hasRight = layout.nodes.right != null;
  const hasBottom = layout.nodes.bottom != null;

  return (
    <div className="panel-layout" ref={rootRef} style={{ gridTemplateRows: hasBottom ? `1fr ${bottom * 100}%` : "1fr" }}>
      <div className="panel-layout-main">
        {hasLeft && (
          <>
            <div className="panel-layout-region" style={{ width: `${left * 100}%` }}>{regionNode(PANEL_REGION.left)}</div>
            <Divider vertical onPointerDown={(e) => beginRegionDrag(e, "left")} label="左の欄の幅" />
          </>
        )}
        <div className="panel-layout-region panel-layout-region--center">{regionNode(PANEL_REGION.center)}</div>
        {hasRight && (
          <>
            <Divider vertical onPointerDown={(e) => beginRegionDrag(e, "right")} label="右の欄の幅" />
            <div className="panel-layout-region" style={{ width: `${right * 100}%` }}>{regionNode(PANEL_REGION.right)}</div>
          </>
        )}
      </div>
      {hasBottom && (
        <>
          <Divider onPointerDown={(e) => beginRegionDrag(e, "bottom")} label="下の欄の高さ" />
          <div className="panel-layout-region">{regionNode(PANEL_REGION.bottom)}</div>
        </>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.panelId)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/** 分割の子1つ（割合ぶんの大きさと、次との境界）。境界の親の箱を測って渡す＝割合の計算を1か所に。 */
function SplitChild({
  ratio,
  horizontal,
  showDivider,
  onDividerDown,
  children,
}: {
  ratio: number;
  horizontal: boolean;
  showDivider: boolean;
  onDividerDown: (e: ReactPointerEvent, box: DOMRect) => void;
  children: ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="panel-split-child" ref={ref} style={{ flex: `${ratio} 1 0`, minWidth: 0, minHeight: 0 }}>
        {children}
      </div>
      {showDivider && (
        <Divider
          vertical={horizontal}
          label="欄の境目"
          onPointerDown={(e) => {
            const box = ref.current?.parentElement?.getBoundingClientRect();
            if (box) onDividerDown(e, box);
          }}
        />
      )}
    </>
  );
}

/** 掴める境界。**キーボードでは動かせない**ので、大きさを戻す道は「配置を既定に戻す」（§2-5・ADR-0033 未解決4）。 */
function Divider({
  vertical,
  label,
  onPointerDown,
}: {
  vertical?: boolean;
  label: string;
  onPointerDown: (e: ReactPointerEvent) => void;
}): React.ReactElement {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={`panel-divider ${vertical ? "panel-divider--vertical" : "panel-divider--horizontal"}`}
      style={vertical ? { width: DIVIDER_PX, cursor: "col-resize" } : { height: DIVIDER_PX, cursor: "row-resize" }}
      onPointerDown={onPointerDown}
    />
  );
}
