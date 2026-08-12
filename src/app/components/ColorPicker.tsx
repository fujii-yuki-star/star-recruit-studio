import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { claimEscape } from "../hooks/escapeOwners";
import { registerExternalDrag } from "../hooks/usePointerDrag";
import { createPortal } from "react-dom";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../../domain/format/color";

// 自前カラーピッカー（#525-6）。ブラウザ標準の <input type="color"> はポップアップ位置を制御できず、
// 詳細編集サイドバー（overflow:auto）や画面右端で見切れるため、画面内に必ず収まる自前ポップオーバーへ置換する。
// 目で選べる面（鮮やかさ×明るさ）＋色相バー＋定番パレット＋色コード欄。値は #rrggbb で親へ返す（既存 onChange 互換）。

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// 定番色（白黒＋よく使う12色）。目で早く選ぶための下段パレット。
const PRESET_COLORS = [
  "#ffffff", "#d1d5db", "#9ca3af", "#4b5563", "#1f2937", "#000000",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#a3623b", "#14b8a6",
];

// ポップオーバーの見積りサイズ（画面端クランプ用の初期値。実測できれば実測を優先）。
const POPOVER_W = 236;
const POPOVER_H = 300;

interface Props {
  /** 現在の色（#rrggbb）。 */
  value: string;
  /**
   * 色が変わるたびに #rrggbb で通知（面・色相バーは撫でている間じゅう随時発火）。
   * ⚠️ **色コード欄だけは確定（`Enter`／欄を出たとき）で1回**（#752-1）＝打っている途中の
   * 3桁でも有効な色になるので、随時だと**打ち方で取り消しの件数が変わる**。
   */
  onChange: (hex: string) => void;
  /** トリガー（見本）の追加クラス。 */
  className?: string;
  /** 読み上げ用ラベル。 */
  ariaLabel?: string;
  /**
   * 面のドラッグ（鮮やかさ×明るさ／色相バー）の開始・終了＝取り消しの「1操作＝1ステップ」境界（#547 P2-3 レビュー）。
   * これらの面は pointermove ごとに {@link Props.onChange} を発火するため、境界が無いと**ひと撫でで数十〜百件**の
   * 履歴が積まれ、履歴上限（`HISTORY_LIMIT`）を流し切って「戻したかった直前の誤操作」を追い出してしまう。
   * パレットのクリックと色コード欄は単発確定なので対象外（渡さなくてよい）。
   */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /**
   * 押せないとき（書き出し中・固定した列など・#720）。**受け口が無いと、渡された `disabled` は
   * 黙って捨てられる**＝触れてしまい、あとから断られる（打った値が消えて理由だけ出る）。
   */
  disabled?: boolean;
  /** 押せない理由（指したときに出す）。 */
  title?: string;
}

export function ColorPicker({ value, onChange, className, ariaLabel = "色を選ぶ", onDragStart, onDragEnd, disabled, title }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 開いている間の作業用 HSV（value からの往復で色相が飛ばないよう保持）。開くたびに現在値へ同期する。
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [codeText, setCodeText] = useState(value);
  /** 色コード欄に**打たれて、まだ確定していない**か（閉じるときに確定するかの判断・#752 レビュー）。 */
  const codeDirtyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingSv = useRef(false);
  const draggingHue = useRef(false);
  // 取り消しの合成境界（#547 P2-3 レビュー）。SV面・色相バーで共有し、開始したものだけを閉じる（冪等）。
  const boundaryRef = useRef(false);
  // 掴んでいる数から外す関数（`registerExternalDrag` の戻り）。掴んでいない間は `null`。
  const releaseExternal = useRef<(() => void) | null>(null);
  const endDragBoundary = useCallback(() => {
    // **掴んだ印も一緒に降ろす**（#720 レビュー）。境界を閉じる経路は「掴むのをやめる」経路でもある。
    // ここで戻さないと、掴んだまま Escape で閉じたとき（面の `pointerup` は来ない）真のまま残り、
    // 開き直したあと**押していないただの移動**で色が変わる。しかも境界の外なので移動1回ごとに
    // 取り消しが積まれる＝#720 で塞いだ症状がそのまま再発する。冪等の判定より前に置く
    //（境界が既に閉じていても掴んだ印は必ず戻す）。
    draggingSv.current = false;
    draggingHue.current = false;
    // **掴んでいる数からも外す**（#752-2）。掴んだ印と同じく、閉じ方に依らず必ず戻す
    //（外し忘れると以後ずっと「掴んでいる」ことになり、取り消しが全画面で無言で効かなくなる）。
    releaseExternal.current?.();
    releaseExternal.current = null;
    if (!boundaryRef.current) return;
    boundaryRef.current = false;
    onDragEnd?.();
  }, [onDragEnd]);
  const startDragBoundary = useCallback(() => {
    if (boundaryRef.current) return;
    boundaryRef.current = true;
    // ⚠️ **掴んでいる数に入れる**（#752-2）＝この面は `pointermove` ごとに色を書く。入れないと
    // 撫でている最中の `Ctrl+Z` が通り、**取り消しで戻した文書の上に続きの動きが色を書く**
    //（＝取り消しが黙って上書きされる）。画面ぜんぶで共通の作法（`usePointerDrag`）へ寄せる。
    releaseExternal.current = registerExternalDrag();
    onDragStart?.();
    // pointer capture は best-effort（try/catch）。面の外で離しても必ず閉じるよう **window でも**拾う（one-shot）。
    // 閉じ漏れると以後の編集が全て同じ履歴に合成され、取り消しが効かなくなる（オーバーレイと同機構）。
    const finish = (): void => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      endDragBoundary();
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [onDragStart, endDragBoundary]);
  // ポップオーバーが閉じた（Escape・外側クリック）／アンマウントしたときも取り残さない。
  useEffect(() => { if (!open) endDragBoundary(); }, [open, endDragBoundary]);
  // **開いている最中に押せなくなったら閉じる**（#730 レビュー）。`disabled` は見本のボタンにしか効かない＝
  // 開いたままだと面・色相バー・パレット・色コード欄は触れてしまい、撫でると**ここの見た目だけ追従して
  // 中身は変わらず、あとから断り文が出る**（この部品が消したかった「押してから断る」そのもの）。
  // 外側クリックで閉じる仕掛けは `pointerdown` を見るので、**キーボードで開いて別のボタンを押した**ときは
  // 働かない（`Enter` は `pointerdown` を起こさない）＝到達する。
  // ⚠️ effect ではなく**レンダー中の調整**（React が prop の変化への追従に認めている書き方）。effect だと
  // 開いた姿を一度描いてから閉じる＝ちらつくうえ、その1フレームは触れてしまう。`open` を見ているので
  // 繰り返さず、`disabled` が戻っても**勝手に開き直さない**（`open` は false のまま）。
  if (disabled && open) setOpen(false);
  // ⚠️ **後始末は画面を離れるときだけ**（#752 レビュー）。`endDragBoundary` を依存に書くと、
  // 渡された `onDragEnd` の中身が変わるたびに走る＝**撫でている最中に合成境界が閉じ**、
  // 一緒に掴んだ名乗りまで外れる（取り消しが1色ごとに積まれる #547 P2-3 の再発）。
  // いまの呼び出し元は安定した関数を渡しているが、**それは呼ぶ側の都合**なので依存で意図を書く。
  const endBoundaryRef = useRef(endDragBoundary);
  // 画面から外れた後に読む写し（そのときには state も props も取れない）。
  const codeTextRef = useRef(value);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    endBoundaryRef.current = endDragBoundary;
    codeTextRef.current = codeText;
    valueRef.current = value;
    onChangeRef.current = onChange;
  });
  useEffect(() => () => {
    endBoundaryRef.current();
    // 開いたまま外れた回も `blur` は来ない（DOM ごと消える）＝打ちかけを黙って捨てない。
    // ここでは画面の状態は触らず（もう無い）、親へ渡すだけ。
    if (!codeDirtyRef.current) return;
    const n = normalizeHex(codeTextRef.current);
    if (n && n !== normalizeHex(valueRef.current)) onChangeRef.current(n);
  }, []);

  const openPicker = () => {
    codeDirtyRef.current = false;
    setHsv(hexToHsv(value) ?? { h: 0, s: 0, v: 0 }); // 開いた瞬間の値を取り込む
    setCodeText(value);
    setPos(null); // 位置は開いた後に実測して確定（下の layout effect）
    setOpen(true);
  };

  // 位置決め：トリガーの実座標→ビューポート内へクランプ。右端では左寄せ・下がはみ出れば上に開く。
  // fixed＋body ポータルなので祖先の overflow に切られない（サイドバーでも画面内に必ず収まる）。
  const reposition = useCallback(() => {
    const tr = triggerRef.current?.getBoundingClientRect();
    if (!tr) return;
    const pw = popRef.current?.offsetWidth || POPOVER_W;
    const ph = popRef.current?.offsetHeight || POPOVER_H;
    const pad = 8;
    let left = tr.left;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
    left = Math.max(pad, left);
    let top = tr.bottom + 4;
    if (top + ph > window.innerHeight - pad) top = tr.top - ph - 4; // 下に入らなければ上へ
    top = Math.max(pad, top);
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top })); // 変化時のみ再描画
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  // 開いている間はスクロール・リサイズに追従して再クランプする（トリガーだけ動いて枠が取り残される/画面外に出るのを防ぐ・
  // #525-6 レビュー P2）。scroll は capture＝内側スクロール領域（詳細編集パネル等）も拾う。
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  // 外側クリック / Escape で閉じる（capture でトリガー自身の再クリックと二重発火しない）。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const release = claimEscape(); // 開いている間は `Escape` を受け持つ（外側の後始末を同時に走らせない・#701）
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      release();
    };
  }, [open]);

  const applyHsv = (next: Hsv) => {
    codeDirtyRef.current = false; // 面・バーで書き替えた＝打ちかけではない
    setHsv(next);
    const hex = hsvToHex(next);
    setCodeText(hex);
    onChange(hex);
  };
  /** 作業色とコード欄を `hex` にそろえる（**親へは通知しない**）。 */
  const syncTo = (n: string) => {
    codeDirtyRef.current = false; // 自分で書き替えた＝打ちかけではない
    setHsv(hexToHsv(n) ?? { h: 0, s: 0, v: 0 });
    setCodeText(n);
  };
  // パレット等・外部からの確定：作業値・コード欄・親をすべてそろえる（コード欄も新色に同期する）。
  const commitHex = (hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    syncTo(n);
    onChange(n);
  };
  // 鮮やかさ×明るさの面：横=鮮やかさ(0..1)、縦=明るさ(1..0)。
  const applySvAt = (clientX: number, clientY: number) => {
    const r = svRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    const s = clamp((clientX - r.left) / r.width, 0, 1);
    const v = clamp(1 - (clientY - r.top) / r.height, 0, 1);
    applyHsv({ h: hsv.h, s, v });
  };
  // 色相バー：横=色相(0..360)。
  const applyHueAt = (clientX: number) => {
    const r = hueRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    applyHsv({ h: clamp((clientX - r.left) / r.width, 0, 1) * 360, s: hsv.s, v: hsv.v });
  };

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;
  const currentHex = hsvToHex(hsv);
  /**
   * 色コード欄の**確定**（`Enter`／欄を出たとき・#752-1）。
   *
   * ⚠️ **打っている途中では確定しない**＝`normalizeHex` は3桁も受けるので、「1a2b3c」を1文字ずつ
   * 打つと途中の3桁（`#1a2`）で1件・完成でもう1件と**取り消しが二重に積まれる**（打ち方で件数が
   * 変わる＝戻す回数が読めない）。数値欄（`NumberField`）と同じ作法へそろえる
   * ＝**打ちかけは自由・確定で1件**。
   *
   * 打ちかけ／無効／**同じ色**のときは通知せず、現在色の表記へそろえるだけ
   *（`NumberField` の「変わらないなら `onChange` を呼ばない」と同じ＝空振りの履歴を出さない）。
   */
  const commitCode = () => {
    codeDirtyRef.current = false;
    const n = normalizeHex(codeText);
    if (!n) { setCodeText(currentHex); return; } // 打ちかけ／無効＝いまの色の表記へそろえる
    // ⚠️ **変わらないなら通知しない**（`NumberField` と同じ）＝空振りの取り消しを積まない。
    // 比べる相手は**親が持っている色**（`value`）＝ここの作業色は開いている間に外から色が変わっても
    // 追わないので、それと比べると「親と同じ色を打ったのに通知する」が起きる。
    // ⚠️ この判定は**この欄だけ**（パレットは押した色をそのまま送る）＝「いまと同じ色で固定する」
    // という指定を潰さない（`value` が既定値の解決結果である呼び出しがある）。
    if (n === normalizeHex(value)) { syncTo(n); return; }
    commitHex(n);
  };
  /**
   * **閉じ方に依らず、打った色を捨てない**（#752-1 レビュー）。
   *
   * ⚠️ 外側を押して閉じたときは**欄が DOM ごと外れるので `blur` が来ない**（実機で確認）。
   * 随時反映だった頃は打った時点で入っていたので消えなかった＝確定へ寄せた副作用として
   * **打った値が黙って消える**を作らないよう、閉じるときにも確定する。
   * **押せなくなって閉じたとき**（`disabled`）は確定しない＝受け取れない状況で書き込まない。
   *
   * ⚠️ 送るのは**この欄で打たれて、まだ確定していないとき**だけ（#752 レビュー）。
   * コード欄の文字は面を撫でてもパレットを押しても書き替わるので、無条件に送り直すと
   * 「色を選ぶ → `Ctrl+Z` で戻す → 閉じる」で**戻したはずの色を送り直す**
   *（取り消しが無かったことになり、`future` も捨てられる＝ADR-0026④）。
   */
  const commitCodeRef = useRef(commitCode);
  useEffect(() => { commitCodeRef.current = commitCode; });
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) { wasOpenRef.current = true; return; }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (!disabled && codeDirtyRef.current) commitCodeRef.current();
  }, [open, disabled]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openPicker())}
        style={{
          width: 40, height: 26, padding: 0, borderRadius: 6, cursor: "pointer",
          border: "1px solid var(--color-border-strong)", background: value,
          boxShadow: "inset 0 0 0 2px var(--color-surface)", // 明るい色でも枠が見えるよう内側に地色線
        }}
      />
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={ariaLabel}
          style={{
            position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999,
            visibility: pos ? "visible" : "hidden", zIndex: 1000,
            width: POPOVER_W, boxSizing: "border-box", padding: 10,
            background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
            borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          {/* 鮮やかさ×明るさの面 */}
          <div
            ref={svRef}
            data-testid="cp-sv"
            onPointerDown={(e) => {
              e.preventDefault();
              draggingSv.current = true;
              startDragBoundary(); // 1ドラッグ＝1取り消し（#547 P2-3 レビュー）
              try { svRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
              applySvAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => { if (draggingSv.current) applySvAt(e.clientX, e.clientY); }}
            onPointerUp={(e) => {
              draggingSv.current = false;
              try { svRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
              endDragBoundary();
            }}
            style={{
              position: "relative", width: "100%", height: 130, borderRadius: 6, cursor: "crosshair",
              touchAction: "none",
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
            }}
          >
            <div
              style={{
                position: "absolute", left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
                width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
                border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)", pointerEvents: "none",
                background: currentHex,
              }}
            />
          </div>

          {/* 色相バー */}
          <div
            ref={hueRef}
            data-testid="cp-hue"
            onPointerDown={(e) => {
              e.preventDefault();
              draggingHue.current = true;
              startDragBoundary(); // 同上
              try { hueRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
              applyHueAt(e.clientX);
            }}
            onPointerMove={(e) => { if (draggingHue.current) applyHueAt(e.clientX); }}
            onPointerUp={(e) => {
              draggingHue.current = false;
              try { hueRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
              endDragBoundary();
            }}
            style={{
              position: "relative", width: "100%", height: 14, borderRadius: 7, cursor: "ew-resize",
              touchAction: "none",
              background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <div
              style={{
                position: "absolute", left: `${(hsv.h / 360) * 100}%`, top: "50%",
                width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
                border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)", pointerEvents: "none",
                background: hueColor,
              }}
            />
          </div>

          {/* 定番パレット */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`色 ${c}`}
                onClick={() => commitHex(c)}
                style={{
                  width: "100%", aspectRatio: "1 / 1", padding: 0, borderRadius: 4, cursor: "pointer",
                  background: c,
                  border: normalizeHex(c) === normalizeHex(currentHex)
                    ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                }}
              />
            ))}
          </div>

          {/* 色コード欄（技術用語 HEX は出さず「色コード」表記） */}
          <label className="col" style={{ gap: 2 }}>
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>色コード</span>
            <input
              className="input"
              value={codeText}
              aria-label="色コード"
              spellCheck={false}
              onChange={(e) => { codeDirtyRef.current = true; setCodeText(e.target.value); }} // 入力中は生の文字を保持（3桁など打ちかけを壊さない）
              // 確定は `Enter` と**欄を出たとき**だけ（#752-1・`NumberField` と同じ作法）。
              // **変換中は奪わない**（`06 §12.1`）＝変換の確定に使った `Enter` で色まで確定しない。
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) commitCode(); }}
              onBlur={commitCode} // 打ちかけ/無効のまま抜けたら現在色の表記へそろえる
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace" }}
            />
          </label>
        </div>,
        document.body,
      )}
    </>
  );
}
