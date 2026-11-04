// @vitest-environment jsdom
// 声を使う画面を開いたら、声のエンジンを裏で起こしておく（ADR-0071 決定1）。
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenId } from "../data/mockData";

const warm = vi.fn(async () => {});
vi.mock("../../infrastructure/voiceFs", () => ({ warmVoiceEngine: () => warm() }));

const { useVoiceEngineWarmup, VOICE_WARM_SCREENS } = await import("./useVoiceEngineWarmup");
const { useStartupJobStore } = await import("../store/startupJobStore");

describe("useVoiceEngineWarmup", () => {
  beforeEach(() => {
    warm.mockClear();
    useStartupJobStore.getState().takePendingExport();
  });

  it("声を作る操作がある画面だけ（起動時のホームでは起こさない）", () => {
    expect([...VOICE_WARM_SCREENS].sort()).toEqual(["draft", "precheck", "scene-edit", "timeline-project"]);
  });

  it("ホーム・書き出し・設定では起こさず、声を使う画面に入ったら起こす", () => {
    const { rerender } = renderHook(({ s }: { s: ScreenId }) => useVoiceEngineWarmup(s), {
      initialProps: { s: "home" as ScreenId },
    });
    rerender({ s: "export" });
    rerender({ s: "settings" });
    expect(warm).not.toHaveBeenCalled();
    rerender({ s: "timeline-project" });
    expect(warm).toHaveBeenCalledTimes(1);
    // 声を使う画面どうしを移っても、入るたびに頼む（動いていれば Rust 側が何もしない）。
    rerender({ s: "precheck" });
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("起動の引数で書き出しだけを頼まれた回は、編集画面に入っても起こさない（取り出した後も起こさない）", () => {
    useStartupJobStore.getState().setPendingExport("C:/out.mp4", false);
    const { rerender } = renderHook(({ s }: { s: ScreenId }) => useVoiceEngineWarmup(s), {
      initialProps: { s: "timeline-project" as ScreenId },
    });
    expect(warm).not.toHaveBeenCalled();
    // 書き出しが頼まれた保存先を取り出しても（同じ画面のまま）起こさない。
    useStartupJobStore.getState().takePendingExport();
    rerender({ s: "timeline-project" });
    expect(warm).not.toHaveBeenCalled();
  });
});
