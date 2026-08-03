// 欄の配置の出し入れ（ADR-0033）。**画面ごとに書き写さない**ための共通のフック（§6・判断軸5）。
//
// 画面が決めるのは「どの欄があるか（`panelIds`）」と「既定の配置」だけ。読み込み・整え・保存・
// 既定へ戻す、は全部ここが持つ＝**画面ごとに別の操作感を作らない**。
import { useEffect, useRef, useState } from "react";
import { clearPanelLayout, getPanelLayout, setPanelLayout } from "../../../infrastructure/appSettings";
import { closedPanelIds, normalizeLayout } from "../../../domain/layout/panelLayout";
import type { PanelId, PanelLayout, PanelScreenId } from "../../../domain/layout/panelLayout";

/** 配置を覚えるまでの待ち（ms）。境界のドラッグ中に書き続けない。 */
const LAYOUT_SAVE_DELAY_MS = 300;

export interface PanelLayoutHandle {
  layout: PanelLayout;
  /** 配置を変える（整えてから入れる）。 */
  change: (next: PanelLayout) => void;
  /** 配置を既定に戻す（保存も消す＝次に開いても既定）。 */
  reset: () => void;
  /** いま閉じている欄（「〈欄〉を表示する」を出すのに使う）。 */
  closed: PanelId[];
}

export function usePanelLayout(
  screenId: PanelScreenId,
  defaultLayout: PanelLayout,
  panelIds: readonly PanelId[],
): PanelLayoutHandle {
  const [layout, setLayout] = useState<PanelLayout>(() =>
    normalizeLayout(getPanelLayout(screenId) ?? defaultLayout, panelIds),
  );
  // **利用者が変えたときだけ書く**＝触っていない画面で既定を焼き付けない（焼き付けると、あとで
  // こちらが既定を良くしても**既存の利用者には届かない**・#550 の教訓）。
  const changedRef = useRef(false);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (!changedRef.current) return;
    const t = setTimeout(() => setPanelLayout(screenId, layout), LAYOUT_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [layout, screenId]);

  // **画面を離れるときは待たずに書く**＝待っている間に離れると、組み替えたことが覚えられない。
  useEffect(
    () => () => {
      if (changedRef.current) setPanelLayout(screenId, layoutRef.current);
    },
    [screenId],
  );

  return {
    layout,
    change: (next) => {
      changedRef.current = true;
      setLayout(normalizeLayout(next, panelIds));
    },
    reset: () => {
      changedRef.current = false; // 既定へ戻したら、また「触っていない」に戻す
      clearPanelLayout(screenId);
      setLayout(normalizeLayout(defaultLayout, panelIds));
    },
    closed: closedPanelIds(layout, panelIds),
  };
}
