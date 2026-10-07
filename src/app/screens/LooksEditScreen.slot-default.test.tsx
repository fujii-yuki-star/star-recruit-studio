// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { DEFAULT_SLOT_TYPE } from "../../domain/template/layerOps";
import { Z_ORDER_LABEL } from "../uiLabels";
import type { Template } from "../../domain/template/types";
import { LooksEditScreen } from "./LooksEditScreen";

// #959/#960：差し込み口の「入れるもの」欄は、**保存される既定と同じ値**を見せる。
// ⚠️ 以前は欄が `?? 写真・動画` と**表示だけ**の既定を持ち、触らない限り何も書かれなかった
// ＝画面に出ている値と保存される値が食い違い、保存はできるのに読み込みで却下されていた。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

describe("差し込み口の「入れるもの」欄（#959）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });

  it("足した直後の欄が既定を指し、**保存される層にも同じ値が入っている**", async () => {
    // ⚠️ **表示だけを見ると空振りする**＝欄は `?? 既定` で描くので、層に値が無くても既定が出る。
    // 食い違いを捕まえるには**保存に渡る中身**まで見る必要がある（これが #959 の本体）。
    const save = vi.fn(async (_t: Template) => {});
    useProjectStore.setState({ saveUserTemplate: save });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const addSelect = screen
      .getAllByRole("combobox")
      .find((el) => [...(el as HTMLSelectElement).options].some((o) => o.value === "slot")) as HTMLSelectElement;
    fireEvent.change(addSelect, { target: { value: "slot" } });
    fireEvent.click(screen.getByText("要素を追加"));
    // 欄の表示値＝共有の既定（別のリテラルを書くと、また表示と保存が割れる）。
    expect(
      screen.getAllByRole("combobox").some((el) => (el as HTMLSelectElement).value === DEFAULT_SLOT_TYPE),
      "「入れるもの」欄が既定を指していない",
    ).toBe(true);
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls[0][0];
    const slot = saved.layers.find((l) => l.type === "slot");
    expect(slot?.slotType, "保存される層に「入れるもの」が入っていない").toBe(DEFAULT_SLOT_TYPE);
  });

  // #960 レビュー：門ができたことで、これまで「保存できて次回消える」だった小数の重ね順が
  // 「保存できない」に変わる。門は**どの欄かを示せない**ので入口で丸める。
  it("重ね順に小数を入れても整数で保存される（門で全体が止まらない）", async () => {
    const save = vi.fn(async (_t: Template) => {});
    useProjectStore.setState({ saveUserTemplate: save });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    // 数値の欄は選択中の層にだけ出る。層を足すとその層が選ばれる。
    const addSelect = screen
      .getAllByRole("combobox")
      .find((el) => [...(el as HTMLSelectElement).options].some((o) => o.value === "shape")) as HTMLSelectElement;
    fireEvent.change(addSelect, { target: { value: "shape" } });
    fireEvent.click(screen.getByText("要素を追加"));
    const zField = screen.getByLabelText(Z_ORDER_LABEL) as HTMLInputElement;
    fireEvent.change(zField, { target: { value: "2.5" } });
    fireEvent.blur(zField);
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls[0][0];
    const zs = saved.layers.map((l) => l.zIndex).filter((z): z is number => z != null);
    expect(zs.every((z) => Number.isInteger(z)), `重ね順が整数でない: ${JSON.stringify(zs)}`).toBe(true);
  });
});
