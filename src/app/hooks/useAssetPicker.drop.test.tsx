// @vitest-environment jsdom
// アプリの中では**窓ごと**受ける（#1026 ②）＝要素の `drop` は来ないので、
// 落ちた場所がその枠の上かを座標で見る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useAssetPicker } from "./useAssetPicker";
import type { FileDropEvent } from "../../infrastructure/fileDropEvents";

let handler: ((e: FileDropEvent) => void) | null = null;
const unsubscribe = vi.fn();
vi.mock("../../infrastructure/fileDropEvents", () => ({
  onWindowFileDrop: (h: (e: FileDropEvent) => void) => {
    handler = h;
    return Promise.resolve(unsubscribe);
  },
}));

/** 枠は (10,20)-(110,70)。ここに `getBoundingClientRect` を差し込む。 */
const RECT = { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50, x: 10, y: 20, toJSON: () => ({}) };

function Zone({ onPick, onReject, disabled }: { onPick: (i: unknown) => void; onReject?: (n: string[]) => void; disabled?: boolean }) {
  const p = useAssetPicker({ onPick: onPick as never, onReject, disabled, acceptsDrop: true });
  return (
    <label {...p.labelProps} data-over={p.dropOver ? "1" : "0"}>
      枠
      <input {...p.inputProps} />
    </label>
  );
}

const setup = (props: Parameters<typeof Zone>[0]) => {
  const r = render(<Zone {...props} />);
  const el = r.container.querySelector("label") as HTMLElement;
  el.getBoundingClientRect = () => RECT as DOMRect;
  return { ...r, el };
};

const fire = async (e: FileDropEvent) => { await act(async () => { handler?.(e); }); };

describe("窓へ落としたときの受け口（#1026 ②）", () => {
  beforeEach(() => {
    handler = null;
    unsubscribe.mockClear();
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  });

  it("枠の上に落としたら取り込む", async () => {
    const onPick = vi.fn();
    setup({ onPick });
    await fire({ kind: "drop", paths: ["C:/a.png"], position: { x: 50, y: 40 } });
    expect(onPick).toHaveBeenCalledWith(["C:/a.png"]);
  });

  it("枠の外に落ちたものは受けない（別の欄に落としたのに取り込まない）", async () => {
    const onPick = vi.fn();
    setup({ onPick });
    await fire({ kind: "drop", paths: ["C:/a.png"], position: { x: 500, y: 400 } });
    expect(onPick).not.toHaveBeenCalled();
  });

  // ⚠️ **拡大率で割る**＝割らないと、高解像度の画面では枠の上に落としても外と判定される。
  it("画面の拡大率を見る", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    const onPick = vi.fn();
    setup({ onPick });
    // 物理 (100,80) ＝ CSS (50,40)＝枠の中。割らないと (100,80) で枠の外になる。
    await fire({ kind: "drop", paths: ["C:/a.png"], position: { x: 100, y: 80 } });
    expect(onPick, "拡大率を見ていない").toHaveBeenCalled();
  });

  it("上を通っている間だけ、受けられることを見た目で示す", async () => {
    const { el } = setup({ onPick: vi.fn() });
    await fire({ kind: "over", paths: [], position: { x: 50, y: 40 } });
    expect(el.dataset.over).toBe("1");
    await fire({ kind: "over", paths: [], position: { x: 500, y: 40 } });
    expect(el.dataset.over, "枠の外なのに受けられるように見せている").toBe("0");
    await fire({ kind: "over", paths: [], position: { x: 50, y: 40 } });
    await fire({ kind: "leave", paths: [], position: null });
    expect(el.dataset.over, "出ていったのに残っている").toBe("0");
  });

  it("取り込み中は受けない（押せないボタンと同じ扱い）", async () => {
    const onPick = vi.fn();
    const { el } = setup({ onPick, disabled: true });
    await fire({ kind: "over", paths: [], position: { x: 50, y: 40 } });
    expect(el.dataset.over, "受けられないのに受けられるように見せている").toBe("0");
    await fire({ kind: "drop", paths: ["C:/a.png"], position: { x: 50, y: 40 } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("取り込めない形式は知らせて、通るものだけ入れる", async () => {
    const onPick = vi.fn();
    const onReject = vi.fn();
    setup({ onPick, onReject });
    await fire({ kind: "drop", paths: ["C:/a.png", "C:/b.pdf"], position: { x: 50, y: 40 } });
    expect(onPick).toHaveBeenCalledWith(["C:/a.png"]);
    expect(onReject).toHaveBeenCalledWith(["b.pdf"]);
  });

  // ⚠️ **受ける入口だけが受ける**＝通らなかったものを知らせる場所を持たない入口（小さなボタン）で
  //    受けると、落としたものが**黙って消える**（§2-5）。既定は受けない。
  it("受けると言っていない入口は、窓へ落としても受けない", async () => {
    const onPick = vi.fn();
    function Plain() {
      const p = useAssetPicker({ onPick: onPick as never });
      return <label {...p.labelProps}>枠<input {...p.inputProps} /></label>;
    }
    const r = render(<Plain />);
    (r.container.querySelector("label") as HTMLElement).getBoundingClientRect = () => RECT as DOMRect;
    await fire({ kind: "drop", paths: ["C:/a.png"], position: { x: 50, y: 40 } });
    expect(onPick, "受けないはずの入口が受けている").not.toHaveBeenCalled();
  });

  it("受けると言っていない入口は、要素へ落としても受けない（ブラウザ側）", () => {
    const onPick = vi.fn();
    function Plain() {
      const p = useAssetPicker({ onPick: onPick as never });
      return <label {...p.labelProps}>枠<input {...p.inputProps} /></label>;
    }
    const r = render(<Plain />);
    const el = r.container.querySelector("label") as HTMLElement;
    fireEvent.drop(el, { dataTransfer: { files: [new File(["x"], "a.png")], types: ["Files"] } });
    expect(onPick, "受けないはずの入口が受けている").not.toHaveBeenCalled();
  });

  it("外れるときに購読を解く（画面を離れても受け続けない）", async () => {
    const { unmount } = setup({ onPick: vi.fn() });
    await act(async () => {});
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
