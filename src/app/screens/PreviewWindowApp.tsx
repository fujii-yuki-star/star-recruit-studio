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
import { PREVIEW_LOCAL_ACTIONS, isNewerPatch, mirrorUpdate, previewProxies, withoutStaleSelection } from "../store/timelineMirror";
import { closeSelf, onMainMessage, onOwnRectChange, sendToMain } from "../../infrastructure/previewWindow";
import { setPreviewWindowRect } from "../../infrastructure/appSettings";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { PREVIEW_WINDOW_NOT_CONNECTED_MESSAGE, PREVIEW_WINDOW_WAITING_TEXT } from "../uiLabels";

/** 本体へ「写しをください」を言い直す間隔（本体の受け口が張られる前に言ってしまった回のため）。 */
const READY_RETRY_MS = 1000;
/** 窓の位置を覚えるまでの待ち（動かしている間に書き続けない）。 */
const RECT_SAVE_DELAY_MS = 400;
/** これだけ待っても写しが届かなければ「つながらない」と言う（言い直しは続ける）。 */
const CONNECT_GIVE_UP_MS = 8000;

type AnyState = Record<string, unknown>;

export function PreviewWindowApp() {
  useAppearance();
  const hasDoc = useTimelineStore((s) => s.doc != null);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const [connected, setConnected] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  // 起動：操作を本体へ送る物に差し替え、写しを受け、本体に写しを頼む。
  useEffect(() => {
    const st = useTimelineStore.getState() as unknown as AnyState;
    // 命令に通し番号を付ける。選ぶ命令の番号を覚え、本体がそこまで実行した写しが来るまで、写しの選択は当てない
    // （手元で先に当てた選択を、古い写しで巻き戻さない・#1274 レビュー）。
    let callSeq = 0;
    let pendingSelectSeq = 0;
    useTimelineStore.setState(previewProxies(st, (call) => {
      callSeq += 1;
      if (PREVIEW_LOCAL_ACTIONS.has(call.name)) pendingSelectSeq = callSeq;
      void sendToMain({ type: "call", ...call, seq: callSeq });
    }) as never);
    let gotPatch = false;
    let last: { session: string | null; seq: number } = { session: null, seq: 0 };
    let un: (() => void) | null = null;
    let cancelled = false;
    void onMainMessage((msg) => {
      if (msg.type === "close") { void closeSelf(); return; }
      // 届く順が入れ替わった古い写しは捨てる。
      if (!isNewerPatch(last, msg)) return;
      // 本体が開き直した（回が変わった）なら、先に当てた選択の番号も数え直し。
      if (msg.session !== last.session) pendingSelectSeq = 0;
      last = { session: msg.session, seq: msg.seq };
      gotPatch = true;
      setConnected(true);
      const patch = withoutStaleSelection(msg, msg.ack, pendingSelectSeq);
      useTimelineStore.setState(mirrorUpdate(useTimelineStore.getState() as unknown as AnyState, patch) as never);
    }).then((f) => {
      if (cancelled) { f(); return; }
      un = f;
      void sendToMain({ type: "ready" });
    });
    const retry = window.setInterval(() => {
      if (!gotPatch) void sendToMain({ type: "ready" });
    }, READY_RETRY_MS);
    // ⚠️ **つながらないまま待たせ続けない**（§2-5・#1274 レビュー）＝次の行動を言う（言い直しは続けるので、後から届けば描く）。
    const giveUp = window.setTimeout(() => { if (!gotPatch) setGaveUp(true); }, CONNECT_GIVE_UP_MS);
    // 見え方を本体へ知らせる＝両方の窓が隠れたら本体が再生を止める（時計の合図が来なくなるため）。
    const onVisibility = (): void => void sendToMain({ type: "visibility", hidden: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    // 見た目パターンと持ち込みフォントは、この窓でも読む（読むだけ＝本体の持ち物を書き換えない）。
    const ps = useProjectStore.getState();
    void ps.loadUserTemplates().catch(() => {});
    void ps.refreshUserFonts().catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(retry);
      window.clearTimeout(giveUp);
      document.removeEventListener("visibilitychange", onVisibility);
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
    let pending: Parameters<typeof setPreviewWindowRect>[0] | null = null;
    let un: (() => void) | null = null;
    let cancelled = false;
    void onOwnRectChange((rect) => {
      pending = rect;
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => { pending = null; setPreviewWindowRect(rect); }, RECT_SAVE_DELAY_MS);
    }).then((f) => { if (cancelled) f(); else un = f; });
    return () => {
      cancelled = true;
      if (t != null) window.clearTimeout(t);
      // ⚠️ **待っている間に閉じても、最後の位置は書く**（#1274 レビュー）。
      if (pending) setPreviewWindowRect(pending);
      un?.();
    };
  }, []);

  if (!hasDoc) {
    return (
      <div className="preview-window-wait" role="status">
        {connected ? PREVIEW_WINDOW_WAITING_TEXT.noVideo : gaveUp ? PREVIEW_WINDOW_NOT_CONNECTED_MESSAGE : PREVIEW_WINDOW_WAITING_TEXT.connecting}
      </div>
    );
  }
  return <TimelineProjectScreen onNavigate={() => {}} presentation="previewWindow" />;
}
