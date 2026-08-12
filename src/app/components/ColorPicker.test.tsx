// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorPicker } from "./ColorPicker";
import { isPointerDragging } from "../hooks/usePointerDrag";

// 自前カラーピッカー（#525-6）。ポップオーバーは body ポータル＋role="dialog"、面/バーは data-testid、
// パレットは aria-label で引ける。jsdom はレイアウトを持たないため面のドラッグは getBoundingClientRect をモックする。

const rect = (left: number, top: number, w = 40, h = 26): DOMRect =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => undefined }) as DOMRect;

describe("ColorPicker", () => {
  it("見本を押すと色の面・色相バー・定番パレットが出る", () => {
    render(<ColorPicker value="#3b82f6" onChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull(); // 初期は閉じている
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("cp-sv")).toBeInTheDocument();
    expect(screen.getByTestId("cp-hue")).toBeInTheDocument();
  });

  it("定番パレットを押すとその色で通知され、色コード欄も新色に同期する", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#222222" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" }));
    expect(onChange).toHaveBeenLastCalledWith("#22c55e");
    // コード欄が古い色（#222222）のまま取り残されない（実機で見つけた不具合の回帰）。
    expect(screen.getByLabelText("色コード")).toHaveValue("#22c55e");
  });

  it("色コード欄は**確定**（Enter）で正規化して通知される（#abc→#aabbcc）", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const code = screen.getByLabelText("色コード");
    fireEvent.change(code, { target: { value: "#abc" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("欄を出たときも確定する（Enter を押さずに他所を触っても打った色が入る）", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const code = screen.getByLabelText("色コード");
    fireEvent.change(code, { target: { value: "#1a2b3c" } });
    fireEvent.blur(code);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("#1a2b3c");
  });

  it("**打っている途中では通知しない**（1文字ずつ打っても取り消しは1件・#752-1）", () => {
    // ⚠️ `normalizeHex` は3桁も受ける＝随時通知だと「1a2b3c」を打つ途中の `#1a2` で1件、
    // 完成でもう1件積まれる（打ち方で戻す回数が変わる）。確定まで通知しないことを固定する。
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const code = screen.getByLabelText("色コード");
    for (const v of ["#", "#1", "#1a", "#1a2", "#1a2b", "#1a2b3", "#1a2b3c"]) {
      fireEvent.change(code, { target: { value: v } });
    }
    expect(onChange).not.toHaveBeenCalled(); // 途中の `#1a2`（＝#11aa22）で先に確定しない
    fireEvent.keyDown(code, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("#1a2b3c");
  });

  it("**外側を押して閉じても打った色は消えない**（欄が外れて `blur` が来ない・#752-1 レビュー）", () => {
    // ⚠️ 随時反映だった頃は打った時点で入っていた。確定へ寄せた副作用として
    // 「打ったのに黙って消える」を作らない（実機で `blur` が来ないことを確認済み）。
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    fireEvent.pointerDown(document.body); // 外側を押す＝閉じる（`blur` は来ない）
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("**外側を押して閉じるときは、その押下が選び直すより先に**確定する（#758 レビュー）", () => {
    // ⚠️ 閉じた後（描き直しの後）に確定すると、**その同じ押下が選び直しでもあった**とき、
    // 打った色が**新しく選ばれた相手**へ入る（色の受け口は「いま選ばれているもの」を見る）。
    // 外側の受け手は bubble、この確定は capture＝必ず先に走ることを固定する。
    const order: string[] = [];
    const onChange = vi.fn(() => { order.push("確定"); });
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    const onOutside = (): void => { order.push("選び直し"); };
    document.body.addEventListener("pointerdown", onOutside);
    try {
      fireEvent.pointerDown(document.body);
    } finally {
      document.body.removeEventListener("pointerdown", onOutside);
    }
    expect(order).toEqual(["確定", "選び直し"]);
  });

  it("`Escape` で閉じたときも打った色は入る（閉じ方で結果を変えない）", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("**自分で書き替えた色は閉じても送り直さない**（取り消しを無かったことにしない・#752 レビュー）", () => {
    // ⚠️ コード欄の文字は面を撫でてもパレットを押しても書き替わる。閉じるときに無条件で送り直すと
    // 「色を選ぶ → `Ctrl+Z` で戻す → 閉じる」で**戻したはずの色が復活**する（やり直しでも戻せない）。
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" })); // パレットで選ぶ
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(<ColorPicker value="#000000" onChange={onChange} />); // 外で取り消された＝親の色は元のまま
    fireEvent.pointerDown(document.body); // 閉じる
    expect(onChange).toHaveBeenCalledTimes(1); // 送り直さない
  });

  it("開いたまま画面から外れても、打ちかけの色は捨てない（#752 レビュー）", () => {
    const onChange = vi.fn();
    const { unmount } = render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    unmount(); // 選択が変わってパネルごと差し替わった等（この経路も `blur` は来ない）
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("押せなくなって閉じたときは確定しない（受け取れない状況で書き込まない）", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    rerender(<ColorPicker value="#000000" onChange={onChange} disabled title="いま動画を書き出しています" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("**パレットは同じ色でも送る**（「いまの色で固定する」を潰さない・#752 レビュー）", () => {
    // ⚠️ 呼び出し側の `value` は**未設定のときの解決値**（既定色）であることがある。パレットで
    // その色を押したのに送らないと、いつまでも「未設定のまま」＝固有の色として持てない。
    // 打ちかけを確定する色コード欄（下のテスト）とは、そろえずに**役目で分ける**。
    const onChange = vi.fn();
    render(<ColorPicker value="#22c55e" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" }));
    expect(onChange).toHaveBeenCalledWith("#22c55e");
  });

  it("押せなくなって閉じたあと画面から外れても送らない（#758 レビュー）", () => {
    // ⚠️ 「押せないから確定しない」で止めても、打ちかけの印が立ったままだと**そのあと外れた回に
    // 後始末が送る**＝受け取れない状況で書き込まない、を経路によって破る。
    const onChange = vi.fn();
    const { rerender, unmount } = render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    rerender(<ColorPicker value="#000000" onChange={onChange} disabled title="いま動画を書き出しています" />);
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("押せなくなって捨てた打ちかけは、押せるように戻っても復活しない（#758 レビュー）", () => {
    const onChange = vi.fn();
    const { rerender, unmount } = render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#00ff00" } });
    rerender(<ColorPicker value="#000000" onChange={onChange} disabled />); // 捨てる
    rerender(<ColorPicker value="#000000" onChange={onChange} />); // 押せるように戻る（開き直しはしない）
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("同じ色を打ち直しても通知しない（空振りの取り消しを積まない）", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#aabbcc" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const code = screen.getByLabelText("色コード");
    fireEvent.change(code, { target: { value: "#abc" } }); // 表記違いの同じ色
    fireEvent.keyDown(code, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(code).toHaveValue("#aabbcc"); // 表記は現在色へそろえる
  });

  it("無効な色コードでは通知せず、欄を出たら現在色の表記へ戻す", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const code = screen.getByLabelText("色コード");
    fireEvent.change(code, { target: { value: "#zz" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(code);
    expect(code).toHaveValue("#000000");
  });

  it("鮮やかさ×明るさの面をドラッグすると新しい色で通知される", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} />); // 赤（h=0,s=1,v=1）で開く
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    // (50,0)＝鮮やかさ0.5・明るさ1・色相0 → #ff8080。
    fireEvent.pointerDown(sv, { clientX: 50, clientY: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#ff8080");
  });

  it("**面を撫でている間は「掴んでいる」に数える**（取り消しが黙って上書きされない・#752-2）", () => {
    // ⚠️ 数に入らないと、撫でている最中の `Ctrl+Z` が通り、**戻した文書の上に続きの動きが色を書く**。
    // 帯・欄の見出しでは塞いだ穴が、色の面だけ開いたままになる（同じ画面で作法が2つ）。
    render(<ColorPicker value="#ff0000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    expect(isPointerDragging()).toBe(false);
    fireEvent.pointerDown(sv, { clientX: 50, clientY: 0, pointerId: 1 });
    expect(isPointerDragging()).toBe(true);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(isPointerDragging()).toBe(false);
  });

  it("掴んだまま Escape で閉じても「掴んでいる」から必ず外れる（#752-2）", () => {
    // 面の `pointerup` が来ない閉じ方（#720 と同じ道）。外れないと以後ずっと取り消しが効かなくなる。
    render(<ColorPicker value="#ff0000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    fireEvent.pointerDown(sv, { clientX: 50, clientY: 0, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isPointerDragging()).toBe(false);
  });

  it("色相バーをドラッグすると色相だけ変わる", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} />); // 赤（s=1,v=1）
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const hue = screen.getByTestId("cp-hue");
    hue.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 360, height: 14, right: 360, bottom: 14, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    // x=120 → 色相120°（緑）・s=1・v=1 → #00ff00。
    fireEvent.pointerDown(hue, { clientX: 120, clientY: 7, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("開いた後の内側スクロールで位置を再計算・クランプする（トリガー追従・#525-6 レビュー P2）", () => {
    // 詳細編集パネルのような内側スクロール領域に置く。capture scroll なので子孫の scroll も拾えることを確認する。
    render(
      <div data-testid="scroller" style={{ overflow: "auto" }}>
        <ColorPicker value="#000000" onChange={vi.fn()} />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "色を選ぶ" });
    trigger.getBoundingClientRect = () => rect(10, 10);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.left).toBe("10px"); // 初期＝トリガー左に沿う
    // 内側スクロールでトリガーが右端へ動いた想定 → 元位置に取り残されず再クランプ。
    trigger.getBoundingClientRect = () => rect(window.innerWidth - 20, 300);
    fireEvent.scroll(screen.getByTestId("scroller"));
    expect(dialog.style.left).not.toBe("10px"); // 追従した
    expect(parseFloat(dialog.style.left) + 236).toBeLessThanOrEqual(window.innerWidth - 8 + 0.01); // 画面内に収まる
  });

  it("開いた後のウィンドウ縮小で画面内へ収め直す（#525-6 レビュー P2）", () => {
    const origW = window.innerWidth;
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "色を選ぶ" });
    trigger.getBoundingClientRect = () => rect(800, 100);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const before = parseFloat(dialog.style.left);
    (window as unknown as { innerWidth: number }).innerWidth = 400; // 縮小して右端を内側へ
    fireEvent(window, new Event("resize"));
    expect(parseFloat(dialog.style.left)).toBeLessThan(before); // 左へ寄る
    expect(parseFloat(dialog.style.left) + 236).toBeLessThanOrEqual(400 - 8 + 0.01);
    (window as unknown as { innerWidth: number }).innerWidth = origW; // 後始末（他テストへ影響しない）
  });

  it("Escape で閉じる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("外側クリックで閉じる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("掴んだまま Escape で閉じ、開き直したら**押していない移動**では色が変わらない（#720 レビュー）", () => {
    const onChange = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} onDragStart={onDragStart} onDragEnd={onDragEnd} />);
    const svRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;

    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv1 = screen.getByTestId("cp-sv");
    sv1.getBoundingClientRect = svRect;
    fireEvent.pointerDown(sv1, { clientX: 50, clientY: 0, pointerId: 1 });
    // 掴んだまま Escape。面の `pointerup` は来ない（ポップオーバーごと消えるため）。
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onDragEnd).toHaveBeenCalledTimes(1); // 取り消しの区切りは閉じている

    onChange.mockClear();
    onDragStart.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv2 = screen.getByTestId("cp-sv");
    sv2.getBoundingClientRect = svRect;
    // 掴んでいない＝ただ指した状態。掴んだ印が残っていると、ここで色が変わり、
    // しかも区切りの外なので移動1回ごとに取り消しが積まれる（＝#720 の症状の再発）。
    fireEvent.pointerMove(sv2, { clientX: 10, clientY: 90, buttons: 0, pointerId: 2 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("読み上げラベルを渡せる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} ariaLabel="文字の色を選ぶ" />);
    expect(screen.getByRole("button", { name: "文字の色を選ぶ" })).toBeInTheDocument();
  });
});
