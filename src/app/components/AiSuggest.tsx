// 編集の途中の AI 補助（ADR-0053）＝ボタンで同梱の AI に小さな作業を頼み、候補を2〜3個出して、利用者が選ぶ。
// ⚠️ **勝手に書き換えない**＝「使う」を押すまで場面は変わらない（`onPick` が呼ばれて初めて書き換わる）。
// ⚠️ **同梱されていなければ出さない**（ブラウザでの開発・部品が無い）＝押しても何も起きないボタンを作らない（§2-5）。
import { useEffect, useRef, useState } from "react";
import { generateRecovery } from "../../domain/ai/generateRecovery";
import { userFacingMessage } from "../userFacingError";
import { assistMaxLength, buildAssistMessages, parseAssistCandidates } from "../../domain/ai/assist";
import type { AssistKind, AssistLimits } from "../../domain/ai/assist";
import { localAiAssist, localAiAvailable } from "../../infrastructure/aiClient";
import { AI_ASSIST_CANCEL_LABEL, AI_ASSIST_FAILED_MESSAGE, AI_ASSIST_NEED_SOURCE_HINT, AI_ASSIST_NOT_NEEDED_MESSAGE, AI_ASSIST_STALE_MESSAGE, AI_ASSIST_THINKING, AI_ASSIST_UNAVAILABLE_MESSAGE, AI_ASSIST_USE_LABEL, AI_ASSIST_CLOSE_LABEL, AI_ASSIST_HEADING } from "../uiLabels";

/** 同梱されているかは1回だけ問い合わせる（画面を開くたびに Rust へ聞かない）。 */
let availability: Promise<boolean> | null = null;
export function useLocalAiAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    availability ??= localAiAvailable().catch(() => false);
    void availability.then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, []);
  return ok;
}

/** 検査用：問い合わせの覚えを消す。 */
export function resetAiSuggestAvailabilityForTest(): void {
  availability = null;
}

export interface AiSuggestProps {
  /** 押せる作業（ボタン1つ＝1種類）。 */
  kinds: readonly { kind: AssistKind; label: string }[];
  /** 作業の元の文（言い直し＝今のセリフ／字幕・見出し＝今の語り）。 */
  source: string;
  /** 比べる元（候補が元と同じなら出さない）。省略時は source。 */
  current?: string;
  limits: AssistLimits;
  companyName?: string;
  /** 候補を選んだとき（ここで初めて書き換える）。 */
  onPick: (text: string) => void;
  /** 開いたらすぐ頼む作業（公開前チェックから来たとき・ADR-0053 決定2）。同梱の AI があるときだけ頼む。 */
  autoKind?: AssistKind;
  /** `autoKind` を頼んだとき（呼び出し側が一度きりの印を消す＝もう一度頼まない）。 */
  onAutoAsked?: () => void;
}

export function AiSuggest({ kinds, source, current, limits, companyName, onPick, autoKind, onAutoAsked }: AiSuggestProps) {
  const available = useLocalAiAvailable();
  const [busy, setBusy] = useState(false);
  // 候補は**頼んだ時点の文**から作ったもの＝その後に文が変わったら出さない（古い文の候補で手直しを上書きしない）。
  const [asked, setAsked] = useState<{ list: string[]; source: string; current: string; limitsKey: string } | null>(null);
  const limitsKey = JSON.stringify(limits);
  const candidates = asked && asked.source === source && asked.current === (current ?? source) && asked.limitsKey === limitsKey ? asked.list : null;
  const setCandidates = (list: string[] | null) => setAsked(list ? { list, source, current: current ?? source, limitsKey } : null);
  const [note, setNote] = useState<string | null>(null);
  // 部品が無い・壊れていると分かったら、押せなくして理由を出す（もう一度押しても直らない）。
  const [broken, setBroken] = useState(false);
  // いまの頼み（`やめる`・文の変化で古い返事を捨てる）。返事が来た時点の文と比べるために最新の文も持つ。
  const request = useRef(0);
  const latest = useRef({ source, current: current ?? source, limitsKey });
  useEffect(() => { latest.current = { source, current: current ?? source, limitsKey }; });

  async function ask(kind: AssistKind) {
    setNote(null);
    setCandidates(null);
    const max = assistMaxLength(kind, source, limits);
    if (max === null) {
      setNote(AI_ASSIST_NOT_NEEDED_MESSAGE);
      return;
    }
    const m = buildAssistMessages(kind, source, max, { companyName, sceneDurationSec: limits.sceneDurationSec });
    const id = ++request.current;
    const asked = { source, current: current ?? source, limitsKey };
    setBusy(true);
    try {
      const raw = await localAiAssist(m.system, m.user, JSON.stringify(m.schema));
      if (id !== request.current) return; // やめた（返事は捨てる）
      // ⚠️ **黙って捨てない**（UI/UX 監査 2026-10-02）＝考えている間に文を直すと、以前は何も出ずに終わっていた。
      const now = latest.current;
      if (now.source !== asked.source || now.current !== asked.current || now.limitsKey !== asked.limitsKey) {
        setNote(AI_ASSIST_STALE_MESSAGE);
        return;
      }
      const list = parseAssistCandidates(raw, asked.current, max, companyName);
      if (list.length === 0) setNote(AI_ASSIST_FAILED_MESSAGE);
      else setAsked({ list, ...asked });
    } catch (e) {
      if (id !== request.current) return;
      console.warn("[ai] 手伝いに失敗しました:", e);
      // 部品が無い・壊れている（文が設定や入れ直しを名指しする）＝もう一度押しても直らない。
      if (generateRecovery(userFacingMessage(e, "AiSuggest")) === "settings") {
        setBroken(true);
        setNote(AI_ASSIST_UNAVAILABLE_MESSAGE);
      } else {
        setNote(AI_ASSIST_FAILED_MESSAGE);
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  function cancel() {
    request.current += 1;
    setBusy(false);
  }

  // 公開前チェックから来たときは、同梱の AI があると分かった時点で1回だけ頼む（呼び出し側が印を消す）。
  useEffect(() => {
    if (!available || !autoKind) return;
    onAutoAsked?.();
    // 描画の外で頼む（効果の中で同期に状態を変えない）。
    const kind = autoKind;
    queueMicrotask(() => void ask(kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 頼むのは「使える」と「頼む種類」が揃った時点だけ（`ask` は毎回作り直される）
  }, [available, autoKind]);

  if (!available) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="row gap-sm" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <span className="text-sm text-muted">{AI_ASSIST_HEADING}</span>
        {kinds.map((k) => (
          <button
            key={k.kind}
            className="btn btn-ghost btn-sm text-sm"
            disabled={busy || broken || source.trim().length === 0}
            // 押せない理由を添える（空の文・使えない AI）＝黙って押せないボタンにしない（§2-5）。
            title={broken ? AI_ASSIST_UNAVAILABLE_MESSAGE : source.trim().length === 0 ? AI_ASSIST_NEED_SOURCE_HINT : undefined}
            onClick={() => void ask(k.kind)}
          >
            {k.label}
          </button>
        ))}
        {busy && (
          <>
            <span className="text-sm text-muted">{AI_ASSIST_THINKING}</span>
            <button className="btn btn-ghost btn-sm text-sm" onClick={cancel}>{AI_ASSIST_CANCEL_LABEL}</button>
          </>
        )}
      </div>
      {/* 読み上げに届くよう、知らせの置き場は常に置いて中身だけ入れ替える（中身と同時に作ると拾われないことがある）。 */}
      <p className="text-sm text-muted" role="status" aria-live="polite" style={{ margin: note ? "4px 0 0" : 0 }}>
        {busy ? "" : note ?? (candidates ? `候補が${candidates.length}つ出ました` : "")}
      </p>
      {candidates && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
          {candidates.map((c) => (
            <li key={c} className="row gap-sm" style={{ alignItems: "flex-start", marginBottom: 4 }}>
              <span className="text-sm" style={{ flex: 1, whiteSpace: "pre-wrap" }}>{c}</span>
              <button className="btn btn-secondary btn-sm text-sm" aria-label={`「${c.slice(0, 20)}」を${AI_ASSIST_USE_LABEL}`} onClick={() => { onPick(c); setCandidates(null); }}>{AI_ASSIST_USE_LABEL}</button>
            </li>
          ))}
          <li><button className="btn btn-ghost btn-sm text-sm" onClick={() => setCandidates(null)}>{AI_ASSIST_CLOSE_LABEL}</button></li>
        </ul>
      )}
    </div>
  );
}
