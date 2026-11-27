import { describe, expect, it } from "vitest";
import { editKey } from "./editKeys";

const k = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  editKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });

describe("元に戻す・やり直すのキー（MV-0009 決定6）", () => {
  it("Ctrl+Z は戻す・Ctrl+Shift+Z と Ctrl+Y はやり直す（Alt を伴えば何もしない）", () => {
    expect(k("z", { ctrlKey: true })).toBe("undo");
    expect(k("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(k("y", { ctrlKey: true })).toBe("redo");
    expect(k("z", { metaKey: true })).toBe("undo");
    expect(k("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(k("y", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k("z")).toBeNull();
  });
});

describe("プリコンポーズのキー（MV-0011 決定5）", () => {
  it("Ctrl+Shift+C（Alt を伴えば何もしない・Ctrl+C は編集のキーでない）", () => {
    expect(k("C", { ctrlKey: true, shiftKey: true })).toBe("precompose");
    expect(k("c", { ctrlKey: true, shiftKey: true })).toBe("precompose");
    expect(k("c", { ctrlKey: true, shiftKey: true, altKey: true })).toBeNull();
    expect(k("c", { ctrlKey: true })).toBeNull();
  });
});

describe("編集のキー（MV-0008 決定4・AE の型）", () => {
  it("[ ] は動かす・Alt+[ ] は切る・Ctrl+] [ は重なりの順", () => {
    expect(k("[")).toBe("moveIn");
    expect(k("]")).toBe("moveOut");
    expect(k("[", { altKey: true })).toBe("trimIn");
    expect(k("]", { altKey: true })).toBe("trimOut");
    expect(k("]", { ctrlKey: true })).toBe("forward");
    expect(k("[", { ctrlKey: true })).toBe("backward");
    expect(k("]", { metaKey: true })).toBe("forward");
  });

  it("Ctrl+Shift+D は分割・Ctrl+A は全部選ぶ（Ctrl+Shift+A は何もしない）", () => {
    expect(k("D", { ctrlKey: true, shiftKey: true })).toBe("split");
    expect(k("d", { ctrlKey: true, shiftKey: true })).toBe("split");
    expect(k("d", { ctrlKey: true })).toBeNull();
    expect(k("a", { ctrlKey: true })).toBe("selectAll");
    expect(k("A", { ctrlKey: true, shiftKey: true })).toBeNull();
  });

  it("Delete は消す・Shift+Delete は消して詰める・S は吸着（ほかの組み合わせは編集でない）", () => {
    expect(k("Delete")).toBe("remove");
    expect(k("Delete", { shiftKey: true })).toBe("rippleRemove");
    expect(k("s")).toBe("snap");
    expect(k("S", { shiftKey: true })).toBeNull();
    expect(k("s", { altKey: true })).toBeNull();
    expect(k("s", { ctrlKey: true })).toBeNull();
    expect(k(" ")).toBeNull();
    expect(k("ArrowRight")).toBeNull();
  });
});
