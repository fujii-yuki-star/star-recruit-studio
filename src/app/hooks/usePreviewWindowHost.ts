// 本体の窓の側で、仕上がり確認の別窓（ADR-0050）を開き・写しを送り・命令を受ける。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { pulsePlayback, setPreviewWindowOpen } from "./playbackPulse";
import { mirrorPatch, runPreviewCall, transferablePatch } from "../store/timelineMirror";
import { pickPreviewWindowRect } from "../../domain/layout/previewWindowRect";
import { getPreviewWindowRect } from "../../infrastructure/appSettings";
import {
  closePreviewWindow,
  onPreviewMessage,
  onPreviewWindowClosed,
  openPreviewWindow,
  readScreens,
  sendToPreview,
} from "../../infrastructure/previewWindow";

/**
 * 写しをまとめて送る間合い＝**いまの処理が終わった直後**（同じ処理の中の変化は1通にまとめる）。
 * ⚠️ **描く合図（`requestAnimationFrame`）では待たない**＝本体の窓が隠れている（最小化・別窓の全画面に覆われた・
 *   ブラウザで裏のタブ）と合図が来ず、**別窓に何も届かなくなる**（実測で踏んだ）。
 */
const afterThisTask = (fn: () => void): void => queueMicrotask(fn);

export interface PreviewWindowHost {
  /** 別窓が開いているか。 */
  open: boolean;
  /** 開く（開いていれば手前へ）。 */
  show: () => void;
  /** 閉じる。 */
  close: () => void;
}

/**
 * 別窓の持ち主（本体）の側。`enabled` が偽（＝自分が別窓）のときは何もしない。
 *
 * ⚠️ **写しは変わった項目だけ**を、同じ処理の中の変化をまとめて送る（ADR-0050 決定3）。
 * ⚠️ **別窓が始めた取り消しのまとまりは、別窓が消えたら閉じる**（決定8）＝掴んだまま別窓を閉じると
 *   `endHistoryGroup` が来ず、以後の編集がすべて1つの取り消しに飲み込まれる。
 * ⚠️ **本体が動画を閉じる・画面を離れると別窓も閉じる**（決定8）。
 */
export function usePreviewWindowHost(enabled: boolean, title: string): PreviewWindowHost {
  const [open, setOpen] = useState(false);
  /** 別窓が始めて、まだ閉じていない取り消しのまとまりの数。 */
  const groupDepthRef = useRef(0);
  const hasDoc = useTimelineStore((s) => s.doc != null);

  // 「別窓が開いている」を本体の時計と音に知らせる（本体が隠れても再生を止めない）。
  useEffect(() => {
    setPreviewWindowOpen(enabled && open);
    return () => setPreviewWindowOpen(false);
  }, [enabled, open]);

  // 別窓が閉じたら印を戻し、始めたまとまりを閉じる。
  useEffect(() => {
    if (!enabled) return;
    return onPreviewWindowClosed(() => {
      setOpen(false);
      const st = useTimelineStore.getState();
      for (; groupDepthRef.current > 0; groupDepthRef.current--) st.endHistoryGroup();
    });
  }, [enabled]);

  // 開いている間だけ、写しを送り・命令を受ける。
  useEffect(() => {
    if (!enabled || !open) return;
    let lastSent: Record<string, unknown> | null = null;
    let scheduled = false;
    const flush = (): void => {
      scheduled = false;
      const now = useTimelineStore.getState() as unknown as Record<string, unknown>;
      const patch = mirrorPatch(lastSent, now);
      lastSent = now;
      if (patch) void sendToPreview({ type: "patch", ...transferablePatch(patch) });
    };
    const unsubStore = useTimelineStore.subscribe(() => {
      if (scheduled) return;
      scheduled = true;
      afterThisTask(flush);
    });
    let unMsg: (() => void) | null = null;
    let cancelled = false;
    void onPreviewMessage((msg) => {
      if (msg.type === "ready") {
        // 全部を送り直す（別窓が開き直した・読み込み直した）。
        lastSent = null;
        flush();
        return;
      }
      // 別窓の描く合図＝本体の時計を1歩進める（本体の窓が隠れて合図が止まっても再生が進む）。
      if (msg.type === "tick") { pulsePlayback(); return; }
      if (msg.type !== "call") return;
      if (msg.name === "beginHistoryGroup") groupDepthRef.current++;
      if (msg.name === "endHistoryGroup") groupDepthRef.current = Math.max(0, groupDepthRef.current - 1);
      runPreviewCall(useTimelineStore.getState() as unknown as Record<string, unknown>, msg);
    }).then((f) => { if (cancelled) f(); else unMsg = f; });
    return () => {
      cancelled = true;
      unsubStore();
      unMsg?.();
    };
  }, [enabled, open]);

  // 動画を閉じた・画面を離れた＝別窓も閉じる。
  useEffect(() => {
    if (enabled && open && !hasDoc) void closePreviewWindow();
  }, [enabled, open, hasDoc]);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => () => { if (openRef.current) void closePreviewWindow(); }, []);

  const show = useCallback((): void => {
    if (!enabled) return;
    void (async () => {
      const { monitors, main } = await readScreens();
      const rect = pickPreviewWindowRect(monitors, main, getPreviewWindowRect());
      if (await openPreviewWindow(title, rect)) setOpen(true);
    })();
  }, [enabled, title]);
  const close = useCallback((): void => { void closePreviewWindow(); }, []);

  return { open, show, close };
}
