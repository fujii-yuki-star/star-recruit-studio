// @vitest-environment jsdom
// タイムライン形式の実映像（#512 段1）。jsdom は `play()/pause()` を実装しないので、
// **見られるもの**（消音・掛け直す時刻・再生速度・切り抜き・寄せ）を固定する。
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TimelineSlotVideo } from "./TimelineSlotVideo";

const rectPct = { left: "0%", top: "0%", width: "50%", height: "50%" };
const canvas = { width: 1920, height: 1080 };

/** メタデータが揃った合図を送る（実機ではここで初めて seek できる）。 */
function ready(v: HTMLVideoElement): void {
  Object.defineProperty(v, "readyState", { value: 1, configurable: true });
  fireEvent(v, new Event("loadedmetadata"));
}

describe("TimelineSlotVideo（#512 段1）", () => {
  it("常に消音（段1 は絵だけ＝元の音はまだ流さない）", () => {
    const { container } = render(
      <TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false} />,
    );
    expect((container.querySelector("video") as HTMLVideoElement).muted).toBe(true);
  });

  it("素材の中の秒へ合わせ、速さを反映する", () => {
    const { container } = render(
      <TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={4.25} speed={2} playing={false} />,
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
      <TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={10} speed={1} playing />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    ready(v);
    expect(v.currentTime).toBeCloseTo(10, 5);
    // 再生中に 0.1 秒ぶんの差＝許容の内（掛け直さない）。
    rerender(<TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={10.1} speed={1} playing />);
    expect(v.currentTime).toBeCloseTo(10, 5);
    // 止めれば必ず合わせる。
    rerender(<TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={10.1} speed={1} playing={false} />);
    expect(v.currentTime).toBeCloseTo(10.1, 5);
  });

  it("大きくずれたら再生中でも合わせ直す", () => {
    const { container, rerender } = render(
      <TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={10} speed={1} playing />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    ready(v);
    rerender(<TimelineSlotVideo src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={30} speed={1} playing />);
    expect(v.currentTime).toBeCloseTo(30, 5);
  });

  // ⚠️ 書き出しは `<g clip-path>` で包む＝実映像にも同じだけ効かせる（効かないと切り抜きが preview だけ無視される）。
  it("切り抜きを同じ矩形で切る", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false}
        clipRect={{ x: 192, y: 108, w: 960, h: 540 }}
      />,
    );
    const v = container.querySelector("video") as HTMLVideoElement;
    // 上10% 右40% 下40% 左10%（1920x1080 に対する割合）。
    expect(v.style.clipPath).toBe("inset(10% 40% 40% 10%)");
  });

  it("寄せを `object-position` に写す（書き出しの寄せと同じ意味）", () => {
    const { container } = render(
      <TimelineSlotVideo
        src="blob:v" rectPct={rectPct} fit="cover" canvas={canvas} sourceSec={0} speed={1} playing={false}
        align={{ x: "right", y: "top" }}
      />,
    );
    expect((container.querySelector("video") as HTMLVideoElement).style.objectPosition).toBe("100% 0%");
  });
});
