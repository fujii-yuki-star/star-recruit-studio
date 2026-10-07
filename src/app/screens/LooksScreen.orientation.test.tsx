// @vitest-environment jsdom
// 新しい見た目の**向き**の既定（#1031）。
//
// ⚠️ **いつも横型で始まっていた**＝縦型で作っている人は、作ってから**注意文を読んで直す**ことになる
//（画面は動画の向き〔`aspectRatio`〕を既に取っているのに、使っていなかった）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksScreen } from "./LooksScreen";

const openForm = (): HTMLSelectElement => {
  render(<LooksScreen onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByText("＋ ゼロから新しい見た目を作る"));
  return screen.getByLabelText("向き") as HTMLSelectElement;
};

const setAspect = (aspectRatio: "16:9" | "9:16"): void => {
  useProjectStore.setState({
    templates: sampleTemplates, assets: [], scenes: [],
    meta: { ...useProjectStore.getState().meta, videoSettings: { ...useProjectStore.getState().meta.videoSettings, aspectRatio } },
  });
};

describe("新しい見た目の向きの既定（#1031）", () => {
  beforeEach(() => setAspect("16:9"));

  it("横型の動画なら横型で始まる", () => {
    expect(openForm().value).toBe("16:9");
  });

  it("縦型の動画なら縦型で始まる（注意文を読んで直させない）", () => {
    setAspect("9:16");
    expect(openForm().value, "いつも横型で始まっている").toBe("9:16");
  });

  // ⚠️ **開くたびに取り直す**＝画面を出したまま動画の向きを変えても、次に開いたときは新しい向きで始まる
  //    （最初に描いたときの値のままにしない）。
  it("開いたときの向きを見る（描いたときの値のままにしない）", () => {
    render(<LooksScreen onNavigate={vi.fn()} />);
    // ⚠️ **描き直しを待つ**＝store を変えただけでは、押した瞬間の関数はまだ前の値を握っている
    //   （実際の操作では、変えた時点で描き直されてから押される）。
    act(() => { setAspect("9:16"); });
    fireEvent.click(screen.getByText("＋ ゼロから新しい見た目を作る"));
    expect((screen.getByLabelText("向き") as HTMLSelectElement).value, "描いたときの値のまま").toBe("9:16");
  });
});
