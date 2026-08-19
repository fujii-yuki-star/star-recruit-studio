// @vitest-environment jsdom
// タイムライン形式の実映像（#512 段1）。jsdom は `play()/pause()` を実装しないので、
// **見られるもの**（消音・掛け直す時刻・再生速度・切り抜き・寄せ）を固定する。
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TimelineSlotVideo } from "./TimelineSlotVideo";

// 置き場所は**動画の座標**（キャンバス 1920x1080 の左上 1/4）。
const rect = { x: 0, y: 0, w: 960, h: 540 };
const canvas = { width: 1920, height: 1080 };

/** メタデータが揃った合図を送る（実機ではここで初めて seek できる）。 */
function ready(v: HTMLVideoElement): void {
  Object.defineProperty(v, "readyState", { value: 1, configurable: true });
  fireEvent(v, new Event("loadedmetadata"));
}

describe("TimelineSlotVideo（#512 段1）", () => {
  it("常に消音（段1 は絵だけ＝元の音はまだ流さない）", () => {
    const { container } = render(
      <TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false} />,
    );
    expect((container.querySelector("video") as HTMLVideoElement).muted).toBe(true);
  });

  it("素材の中の秒へ合わせ、速さを反映する", () => {
    const { container } = render(
      <TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={4.25} speed={2} playing={false} />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    ready(v);
    expect(v.currentTime).toBeCloseTo(4.25, 5);
    expect(v.playbackRate).toBe(2);
  });

  // ⚠️ **再生中は小さなずれで掛け直さない**（毎フレーム seek すると映像が跳ねる）。
  // 止まっているときは必ず合わせる＝つまみを動かした先のコマが出る。
  it("止まっているときは必ず合わせ、再生中は小さなずれでは合わせ直さない", () => {
    const { container, rerender } = render(
      <TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={10} speed={1} playing />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    ready(v);
    expect(v.currentTime).toBeCloseTo(10, 5);
    // 再生中に 0.1 秒ぶんの差＝許容の内（掛け直さない）。
    rerender(<TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={10.1} speed={1} playing />);
    expect(v.currentTime).toBeCloseTo(10, 5);
    // 止めれば必ず合わせる。
    rerender(<TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={10.1} speed={1} playing={false} />);
    expect(v.currentTime).toBeCloseTo(10.1, 5);
  });

  it("大きくずれたら再生中でも合わせ直す", () => {
    const { container, rerender } = render(
      <TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={10} speed={1} playing />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    ready(v);
    rerender(<TimelineSlotVideo src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={30} speed={1} playing />);
    expect(v.currentTime).toBeCloseTo(30, 5);
  });

  // ⚠️ 書き出しは `<g clip-path>` で包む＝実映像にも同じだけ効かせる（効かないと切り抜きが preview だけ無視される）。
  // ⚠️ **割合の基準はキャンバスではなく「この要素の箱」**（レビュー 🔴）。前の版はキャンバス基準で
  // 割合を作っており、**部品が画面いっぱいのときだけ偶然一致**していた（テストもその誤りを固定していた）。
  it("切り抜きは**要素の箱**を基準に切る（画面いっぱいでなくても同じ所が切れる）", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false}
        clipRect={{ x: 480, y: 0, w: 480, h: 540 }}
      />,
    );
    // 箱は (0,0,960,540)。左半分を落として右半分だけ残す。
    expect((container.querySelector("video") as HTMLVideoElement).style.clipPath).toBe("inset(0% 0% 0% 50%)");
  });

  // ⚠️ **箱が原点に無いときも正しく引く**（`rect.x`/`rect.y` を引く項を落としても、
  // 原点の材料・丸まる材料では素通りする＝変異チェックで判明）。
  it("箱が原点に無くても、要素の箱からの割合で切る", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rect={{ x: 120, y: 80, w: 960, h: 540 }} fit="cover" canvas={canvas}
        sourceSec={0} speed={1} playing={false}
        // 箱 (120,80,960,540) の中を、左 96px・上 54px・右 192px・下 108px 残して切る。
        clipRect={{ x: 216, y: 134, w: 672, h: 378 }}
      />,
    );
    // 左 96/960=10%・上 54/540=10%・右 192/960=20%・下 108/540=20%。
    expect((container.querySelector("video") as HTMLVideoElement).style.clipPath).toBe("inset(10% 20% 20% 10%)");
  });

  it("箱の外へはみ出す切り抜きは 0 で止める（負の指定で広げない）", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rect={{ x: 100, y: 100, w: 200, h: 200 }} fit="cover" canvas={canvas}
        sourceSec={0} speed={1} playing={false}
        clipRect={{ x: 0, y: 0, w: 1920, h: 1080 }}
      />,
    );
    expect((container.querySelector("video") as HTMLVideoElement).style.clipPath).toBe("inset(0% 0% 0% 0%)");
  });

  it("寄せを `object-position` に写す（書き出しの寄せと同じ意味）", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rect={rect} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false}
        align={{ x: "right", y: "top" }}
      />,
    );
    expect((container.querySelector("video") as HTMLVideoElement).style.objectPosition).toBe("100% 0%");
  });
});
