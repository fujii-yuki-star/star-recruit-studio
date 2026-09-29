// 仕上がり確認の**別窓**の入口（ADR-0050）。本体の窓の写しを受けて、同じ編集画面を「仕上がり確認だけ」の形で描く。
//
// ⚠️ **ここは状態を持たない**＝store の操作は起動時に「本体へ送る物」に差し替える（`previewProxies`）。
// 文書・選択・再生位置は本体から写しで届く（`mirrorUpdate`）。保存・書き出し・音・時計は本体だけが持つ。
import { useEffect, useRef, useState } from "react";
import "../../styles/theme.css";
import "../../styles/fonts.css";
import { useAppearance } from "../hooks/useAppearance";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { mirrorUpdate, previewProxies } from "../store/timelineMirror";
import { closeSelf, onMainMessage, onOwnRectChange, sendToMain } from "../../infrastructure/previewWindow";
import { setPreviewWindowRect } from "../../infrastructure/appSettings";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { PREVIEW_WINDOW_WAITING_TEXT } from "../uiLabels";

/** 本体へ「写しをください」を言い直す間隔（本体の受け口が張られる前に言ってしまった回のため）。 */
const READY_RETRY_MS = 1000;
/** 窓の位置を覚えるまでの待ち（動かしている間に書き続けない）。 */
const RECT_SAVE_DELAY_MS = 400;

type AnyState = Record<string, unknown>;

export function PreviewWindowApp() {
  useAppearance();
  const hasDoc = useTimelineStore((s) => s.doc != null);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const [connected, setConnected] = useState(false);

  // 起動：操作を本体へ送る物に差し替え、写しを受け、本体に写しを頼む。
  useEffect(() => {
    const st = useTimelineStore.getState() as unknown as AnyState;
    useTimelineStore.setState(previewProxies(st, (call) => void sendToMain({ type: "call", ...call })) as never);
    let gotPatch = false;
    let un: (() => void) | null = null;
    let cancelled = false;
    void onMainMessage((msg) => {
      if (msg.type === "close") { void closeSelf(); return; }
      gotPatch = true;
      setConnected(true);
      useTimelineStore.setState(mirrorUpdate(useTimelineStore.getState() as unknown as AnyState, msg) as never);
    }).then((f) => {
      if (cancelled) { f(); return; }
      un = f;
      void sendToMain({ type: "ready" });
    });
    const retry = window.setInterval(() => {
      if (!gotPatch) void sendToMain({ type: "ready" });
    }, READY_RETRY_MS);
    // 見た目パターンと持ち込みフォントは、この窓でも読む（読むだけ＝本体の持ち物を書き換えない）。
    const ps = useProjectStore.getState();
    void ps.loadUserTemplates().catch(() => {});
    void ps.refreshUserFonts().catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(retry);
      un?.();
    };
  }, []);

  // 再生中は描くたびに本体へ合図する＝本体の窓が隠れて本体の時計が止まっても、再生が進む（`playbackPulse`）。
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const loop = (): void => {
      void sendToMain({ type: "tick" });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // 本体が動画を閉じたら、この窓も閉じる（見るものが無い窓を残さない）。
  const hadDoc = useRef(false);
  useEffect(() => {
    if (hasDoc) hadDoc.current = true;
    else if (hadDoc.current) void closeSelf();
  }, [hasDoc]);

  // 次に開くときの置き場所を覚える（ADR-0050 決定7）。
  useEffect(() => {
    let t: number | null = null;
    let un: (() => void) | null = null;
    let cancelled = false;
    void onOwnRectChange((rect) => {
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => setPreviewWindowRect(rect), RECT_SAVE_DELAY_MS);
    }).then((f) => { if (cancelled) f(); else un = f; });
    return () => {
      cancelled = true;
      if (t != null) window.clearTimeout(t);
      un?.();
    };
  }, []);

  if (!hasDoc) {
    return (
      <div className="preview-window-wait" role="status">
        {connected ? PREVIEW_WINDOW_WAITING_TEXT.noVideo : PREVIEW_WINDOW_WAITING_TEXT.connecting}
      </div>
    );
  }
  return <TimelineProjectScreen onNavigate={() => {}} presentation="previewWindow" />;
}
