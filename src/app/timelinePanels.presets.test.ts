// 配置の型（ADR-0048 決定4・#1256 c3）。純粋な値なので、中身と「既定＝型の1つ」を固定する。
import { describe, expect, it } from "vitest";
import { PANEL_ID, PANEL_IDS, timelineDefaultLayout, timelineLayoutPresets } from "./timelinePanels";
import { normalizeLayout, placedPanelIds } from "../domain/layout/panelLayout";

describe("タイムライン編集の配置の型（#1256 c3）", () => {
  const presets = timelineLayoutPresets();
  const byId = (id: string) => presets.find((p) => p.id === id)!.layout;

  // ⚠️ **既定と「並びを広く」は同じもの**＝2か所で書くと、片方だけ直して食い違う。
  it("既定の配置は「並びを広く」の型と同じ", () => {
    expect(byId("arrange")).toEqual(timelineDefaultLayout());
  });

  it("3つの型があり、名前が違う", () => {
    expect(presets.map((p) => p.label)).toEqual(["並びを広く（既定）", "仕上がりを大きく", "並びと仕上がりだけ"]);
  });

  it("「仕上がりを大きく」は並びを狭め、左右も細くする（仕上がり確認の面積を稼ぐ）", () => {
    const d = timelineDefaultLayout().regionSizes;
    const p = byId("preview").regionSizes;
    expect(p.bottom).toBeLessThan(d.bottom);
    expect(p.left).toBeLessThan(d.left);
    expect(p.right).toBeLessThan(d.right);
    expect(placedPanelIds(byId("preview")).sort(), "欄を閉じてしまった").toEqual([...PANEL_IDS].sort());
  });

  it("「並びと仕上がりだけ」は置く・選んだ部品を閉じる", () => {
    expect(placedPanelIds(byId("focus")).sort()).toEqual([PANEL_ID.arrange, PANEL_ID.preview].sort());
  });

  // ⚠️ **描ける値に収まっている**＝整えたら別の配置になる型は、選んだのと違う画面を出す。
  it("どの型も、整えても変わらない（上限・下限の中にある）", () => {
    for (const p of presets) expect(normalizeLayout(p.layout, PANEL_IDS), p.label).toEqual(p.layout);
  });
});
