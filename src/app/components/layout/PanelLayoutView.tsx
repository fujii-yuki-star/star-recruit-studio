// 欄の配置を描く共通部品（ADR-0033 段階2）。**並べ方の規則は domain**（`panelLayout`）にあり、
// ここは「描く」と「掴む」だけを持つ（`§4`）。
//
// 画面は左・中央・右・下の4つの領域に分かれ、**領域の中は入れ子で分割**できる（決定11）。
// 境界（分かれ目・領域の外枠）は**ドラッグで動かせる**（決定2）。欄の中身は使う側から渡す。
import { useEffect, useRef, useState } from "react";
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
  dropPanelBeside,
  dropSideAt,
  isSplit,
  movePanelStep,
  removePanel,
  resizeRegion,
  resizeSplit,
} from "../../../domain/layout/panelLayout";
import type { DropSide, PanelId, PanelLayout, PanelNode, PanelRegion, PanelSplit, RegionSizes } from "../../../domain/layout/panelLayout";

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
/** ここまで動かしたら「つかんだ」とみなす（px）。見出しを押しただけで動かし始めない。 */
const DRAG_START_PX = 4;

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
  // いま張っているドラッグの後始末。**画面外で離した・別の指・画面を離れた**でも必ず外す＝
  // 押していないのに掴んだままになり、動かすたびに配置が書き換わる、を作らない（§2-5）。
  const stopDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDragRef.current?.(), []);
  // 欄の箱（落とし先を当てるのに使う）。`elementFromPoint` ではなく**自分が描いた欄の箱**で当てる＝
  // 上に何か重なっていても（メニュー・知らせ）落とし先を見失わない。
  const frameRefs = useRef(new Map<PanelId, HTMLElement>());
  // つかんでいる欄と、いま指している落とし先（線で示す）。
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [dropAt, setDropAt] = useState<{ panelId: PanelId; side: DropSide } | null>(null);

  /** 指している位置から落とし先を探す（自分自身の上は落とし先にしない＝何も起きない操作を見せない）。 */
  const findDrop = (panelId: PanelId, x: number, y: number): { panelId: PanelId; side: DropSide } | null => {
    for (const [id, el] of frameRefs.current) {
      if (id === panelId) continue;
      const box = el.getBoundingClientRect();
      if (x < box.left || x > box.left + box.width || y < box.top || y > box.top + box.height) continue;
      return { panelId: id, side: dropSideAt(box, x, y) };
    }
    return null;
  };

  /**
   * 見出しをつかんで動かす（決定12＝ドラッグ）。**少し動かすまでは始めない**＝見出しを押しただけで
   * 掴んだ状態にしない。`Escape` でやめられる（掴んだまま戻れない、を作らない・§2-5）。
   */
  const beginPanelDrag = (e: ReactPointerEvent, panelId: PanelId): void => {
    // 主ボタン（左）以外では掴まない＝**右クリックでメニューを開いたまま配置が書き換わる**を作らない。
    // 指の取り違え（2本目で別の欄を掴む）は `listenDrag` が pointerId で見る＝ここでは見ない。
    if (e.button !== 0) return;
    e.preventDefault(); // 見出しの文字を選択させない（選択が走るとドラッグが途中で切れる）
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent): void => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX) return;
      if (!started) {
        started = true;
        setDragging(panelId);
      }
      setDropAt(findDrop(panelId, ev.clientX, ev.clientY));
    };
    const finish = (ev: PointerEvent): void => {
      const target = started ? findDrop(panelId, ev.clientX, ev.clientY) : null;
      setDragging(null);
      setDropAt(null);
      if (target) onChange(dropPanelBeside(layout, panelId, target.panelId, target.side));
    };
    listenDrag(e.pointerId, move, finish);
  };

  /** ドラッグの購読を1か所で張る（外し忘れ・二重購読を作らない）。 */
  const listenDrag = (
    pointerId: number,
    move: (ev: PointerEvent) => void,
    onEnd?: (ev: PointerEvent) => void,
    onCancel?: () => void,
  ): void => {
    stopDragRef.current?.();
    // **掴んだ指だけ**を見る（別の指の up でその座標へ落ちる、を作らない）。
    const mine = (ev: PointerEvent): boolean => ev.pointerId === pointerId;
    const stop = (ev?: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
      stopDragRef.current = null;
      if (ev) onEnd?.(ev);
    };
    const onMove = (ev: PointerEvent): void => {
      if (mine(ev)) move(ev);
    };
    const up = (ev: PointerEvent): void => {
      if (mine(ev)) stop(ev);
    };
    // 途中でやめたときは**元へ戻す**（`pointercancel`・`Escape`）＝置くつもりが無いのに動かさない。
    // 境界のドラッグは動かすたびに適用しているので、**始めた時点の配置へ戻す**（欄のドラッグと同じ意味にする）。
    const cancel = (): void => {
      setDragging(null);
      setDropAt(null);
      stop();
      onCancel?.();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    stopDragRef.current = cancel;
  };

  /** 並べ替え1つぶん。**動かせない向きは押せなくして理由を出す**（押しても何も起きない、を作らない・§2-5）。 */
  const stepItem = (panelId: PanelId, side: (typeof DROP_SIDE)[keyof typeof DROP_SIDE], label: string): ContextMenuItem => {
    const next = movePanelStep(layout, panelId, side);
    return {
      label,
      disabled: next === layout,
      disabledHint: `${label}動かせる欄がありません。同じ向きに並んでいる欄の中で入れ替えられます`,
      onSelect: () => onChange(next),
    };
  };

  const menuItems = (panelId: PanelId): ContextMenuItem[] => [
    // 並べ替えはドラッグとメニューの両方（決定12）＝ドラッグが使えないときの逃げ道。
    stepItem(panelId, DROP_SIDE.top, "上へ"),
    stepItem(panelId, DROP_SIDE.bottom, "下へ"),
    stepItem(panelId, DROP_SIDE.left, "左へ"),
    stepItem(panelId, DROP_SIDE.right, "右へ"),
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
    node: PanelSplit,
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
    const startLayout = layout;
    listenDrag(e.pointerId, move, undefined, () => onChange(startLayout));
  };

  /** 領域の外枠をドラッグ（左右の幅・下の高さ）。 */
  const beginRegionDrag = (e: ReactPointerEvent, region: keyof RegionSizes): void => {
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const move = (ev: PointerEvent): void => {
      const ratio =
        region === PANEL_REGION.left
          ? (ev.clientX - box.left) / box.width
          : region === PANEL_REGION.right
            ? (box.right - ev.clientX) / box.width
            : (box.bottom - ev.clientY) / box.height;
      onChange(resizeRegion(layout, region, ratio));
    };
    const startLayout = layout;
    listenDrag(e.pointerId, move, undefined, () => onChange(startLayout));
  };

  const renderNode = (node: PanelNode, region: PanelRegion, path: number[]): ReactNode => {
    if (!isSplit(node)) {
      const spec = byId.get(node.panelId);
      // 知らない欄は描かない（`normalizeLayout` が落とすので通常は来ない＝念のため）。
      if (!spec) return null;
      const drop = dropAt?.panelId === spec.id ? dropAt.side : null;
      return (
        <section
          className={`panel-frame${dragging === spec.id ? " panel-frame--dragging" : ""}`}
          key={spec.id}
          data-panel-id={spec.id}
          ref={(el) => {
            if (el) frameRefs.current.set(spec.id, el);
            else frameRefs.current.delete(spec.id);
          }}
        >
          {/* 落とし先を**線で示す**（決定12）＝どこに入るか分からないまま落とさせない。 */}
          {drop && <div className={`panel-drop-line panel-drop-line--${drop}`} aria-hidden="true" />}
          <header
            className="panel-frame-head"
            title="つかんで動かすと、ほかの欄の隣へ移せます"
            onPointerDown={(e) => {
              // 「⋮」の上から始めない（メニューを開く操作を奪わない）。
              if ((e.target as HTMLElement).closest("button")) return;
              beginPanelDrag(e, spec.id);
            }}
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

  // 下の欄があるときの子は「本体・境界・下の欄」の**3つ**。境界ぶんの行を書かないと、境界が下の欄の行を取り、
  // **下の境界をドラッグしても空の帯が伸びるだけ**になる（下の欄は中身なりの高さのまま）。
  const rows = hasBottom ? `1fr auto ${bottom * 100}%` : "1fr";
  return (
    <div className="panel-layout" ref={rootRef} style={{ gridTemplateRows: rows }}>
      <div className="panel-layout-main">
        {hasLeft && (
          <>
            <div className="panel-layout-region" style={{ width: `${left * 100}%` }}>{regionNode(PANEL_REGION.left)}</div>
            <Divider vertical onPointerDown={(e) => beginRegionDrag(e, PANEL_REGION.left)} label="左の欄の幅" />
          </>
        )}
        <div className="panel-layout-region panel-layout-region--center">{regionNode(PANEL_REGION.center)}</div>
        {hasRight && (
          <>
            <Divider vertical onPointerDown={(e) => beginRegionDrag(e, PANEL_REGION.right)} label="右の欄の幅" />
            <div className="panel-layout-region" style={{ width: `${right * 100}%` }}>{regionNode(PANEL_REGION.right)}</div>
          </>
        )}
      </div>
      {hasBottom && (
        <>
          <Divider onPointerDown={(e) => beginRegionDrag(e, PANEL_REGION.bottom)} label="下の欄の高さ" />
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
