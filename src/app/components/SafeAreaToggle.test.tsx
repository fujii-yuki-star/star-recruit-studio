// @vitest-environment jsdom
//
// 端の目安（安全領域）の出し入れ（#265）。
//
// ⚠️ **編集を助けるためだけ**＝書き出しには焼かない。仕上がり確認には出さない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SafeAreaToggle } from "./SafeAreaToggle";
import { resetSafeAreaPrefTo } from "../hooks/useSafeAreaPref";
import { ScenePreview } from "./ScenePreview";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";

const template: Template = {
  schemaVersion: "1.0", templateId: "t1", name: "写真", category: "photo_intro",
  aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#fff" },
  layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene: Scene = {
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "t1",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: "", status: "none" }, warnings: [],
} as unknown as Scene;

const guide = (c: HTMLElement) => c.querySelector(".safe-area-guide");

describe("端の目安（#265）", () => {
  beforeEach(() => { localStorage.clear(); resetSafeAreaPrefTo(false); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); resetSafeAreaPrefTo(false); });

  // ⚠️ **既定は出さない**＝これまでの見え方を変えない（入れた人にだけ出す）。
  it("既定では出さない", () => {
    const { container } = render(<ScenePreview scene={scene} template={template} />);
    expect(guide(container)).toBeNull();
  });

  it("入れると出る・外すと消える", () => {
    const { container } = render(<><SafeAreaToggle /><ScenePreview scene={scene} template={template} /></>);
    fireEvent.click(screen.getByRole("checkbox", { name: /端の目安/ }));
    expect(guide(container)).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /端の目安/ }));
    expect(guide(container)).toBeNull();
  });

  /**
   * ⚠️ **画面の好みなので覚える**（ADR-0033・ADR-0034 決定14）＝倍率（文書の見え方）と違い、
   * これは**その人の作り方**。開き直すたびに消えると毎回入れ直すことになる。
   */
  it("別の画面へ移っても覚えている", () => {
    const first = render(<SafeAreaToggle />);
    fireEvent.click(screen.getByRole("checkbox", { name: /端の目安/ }));
    first.unmount();
    const { container } = render(<ScenePreview scene={scene} template={template} />);
    expect(guide(container)).not.toBeNull();
  });

  // ⚠️ **開き直しても覚えている**＝ディスクへ書けていることを見る（この場の記憶だけではない）。
  it("開き直しても覚えている（ディスクに残る）", () => {
    render(<SafeAreaToggle />);
    fireEvent.click(screen.getByRole("checkbox", { name: /端の目安/ }));
    expect(localStorage.getItem("preview.safeArea")).toBe("1");
  });

  /**
   * ⚠️ **仕上がり確認には出さない**＝ここは「出来上がり」を見る場所で、編集の補助線が入ると
   * **動画にも入るのか**が分からなくなる。記憶が「出す」でも出さない。
   */
  it("出さないと指定した画面では、覚えていても出さない", () => {
    localStorage.setItem("preview.safeArea", "1");
    resetSafeAreaPrefTo(true);
    const { container } = render(<ScenePreview scene={scene} template={template} showSafeArea={false} />);
    expect(guide(container)).toBeNull();
  });

  // ⚠️ **操作を邪魔しない**＝掴む・置くは下のオーバーレイが受ける。
  it("枠は操作を受け取らない（読み上げにも出ない）", () => {
    localStorage.setItem("preview.safeArea", "1");
    resetSafeAreaPrefTo(true);
    const { container } = render(<ScenePreview scene={scene} template={template} />);
    const el = guide(container) as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  // ⚠️ **向きで厚みが変わる**＝縦型は上下に UI が重なるので上下を厚く空ける。
  it("縦型は上下を厚く空ける", () => {
    localStorage.setItem("preview.safeArea", "1");
    resetSafeAreaPrefTo(true);
    const portrait = { ...template, aspectRatio: "9:16", canvas: { width: 1080, height: 1920 } } as unknown as Template;
    const { container } = render(<ScenePreview scene={scene} template={portrait} />);
    const el = guide(container) as HTMLElement;
    expect(parseFloat(el.style.top)).toBeGreaterThan(parseFloat(el.style.left));
  });

  // ⚠️ **保存できなくても編集は続けられる**（プライベートモード等）。
  it("覚えられない環境でも落ちない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("no"); });
    render(<SafeAreaToggle />);
    fireEvent.click(screen.getByRole("checkbox", { name: /端の目安/ }));
    expect(screen.getByRole("checkbox", { name: /端の目安/ })).toBeChecked();
  });
});
