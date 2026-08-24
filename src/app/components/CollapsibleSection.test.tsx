// @vitest-environment jsdom
// 欄の中の節（アコーディオン）。**画面ごとに開閉を覚える**ことと、既定を将来変えられることを固定する（#687）。
// 開閉は `details.open` で見る（jsdom は閉じた `<details>` の中身も DOM に残す）。`toggle` は**非同期**に
// 発火する（HTML 仕様）＝保存もその後なので、画面を消す前に待つ（場面編集の既存テストと同じ流儀）。
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CollapsibleSection } from "./CollapsibleSection";
import { SECTION_SCOPE } from "./sectionOpen";

const section = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest("details") as HTMLDetailsElement;

beforeEach(() => localStorage.clear());

describe("CollapsibleSection（#687）", () => {
  it("畳んだ状態で出せる（縦に長くしない）", () => {
    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    expect(section("動き").open).toBe(false);
  });

  it("開閉を覚える（画面を往復しても開き直さなくてよい）", async () => {
    const view = render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("動き"));
    await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
    view.unmount();

    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    expect(section("動き").open).toBe(true);
  });

  it("記憶は画面ごとに分かれる（同じ見出しでも混ざらない）", async () => {
    const view = render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="文字" defaultOpen={false}>
        <p>中身</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("文字")); // タイムライン側だけ開く
    await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
    view.unmount();

    render(
      <CollapsibleSection scope={SECTION_SCOPE.sceneEdit} title="文字" defaultOpen={false}>
        <p>中身</p>
      </CollapsibleSection>,
    );
    expect(section("文字").open).toBe(false); // 別画面の記憶を引かない
    expect(localStorage.getItem("sceneEdit.sectionOpen")).toBeNull();
  });

  it("触っていない節は覚えない（あとで既定を良くしたときに届く）", async () => {
    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="音" defaultOpen>
        <p>音量</p>
      </CollapsibleSection>,
    );
    // `<details open>` は描画しただけで（非同期に）toggle を発火する。それを素通しで保存していないこと。
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("timeline.sectionOpen")).toBeNull();
  });

  // #832＝ドリルインで畳んだ節へ入っても、そのままでは欄が見えない（当て先が DOM に無い）。
  // `forceOpen` は**保存しない**一時的な合図＝利用者の畳む設定（`defaultOpen`/記憶）を上書きしない。
  describe("forceOpen（外から一時的に開かせる・#832）", () => {
    it("マウント時から効く（畳む設定より優先して開く）", () => {
      // ⚠️ **初期値に織り込む**（マウント後の変化だけを見ない）＝呼び出し側の別の事情で、この節を
      // 含む祖先がしばしば作り直される（ドリルインの1回目のタップは選択を一度解く＝#818）ため、
      // 「マウント後に変わった」だけを見る合図だと、たまたま作り直った回に効かない（#832 で実際に踏んだ）。
      render(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} title="中身" defaultOpen={false} forceOpen>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(true);
    });

    it("マウント後に true へ変わっても開く（既にマウント済みの節にも効く）", () => {
      const view = render(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} title="中身" defaultOpen={false} forceOpen={false}>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(false);
      view.rerender(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} title="中身" defaultOpen={false} forceOpen={true}>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(true);
    });

    it("false に戻っても畳まない（黙って閉じない＝開いたままにする）", () => {
      const view = render(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} title="中身" defaultOpen={false} forceOpen={true}>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(true);
      view.rerender(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} title="中身" defaultOpen={false} forceOpen={false}>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(true); // 抜けても開いたまま
    });

    it("記憶へは保存しない（次に新しく作られたときは利用者の設定＝畳んだまま）", async () => {
      render(
        <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="templateContent" title="中身" defaultOpen={false} forceOpen>
          <p>差し込み口</p>
        </CollapsibleSection>,
      );
      expect(section("中身").open).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(localStorage.getItem("timeline.sectionOpen")).toBeNull(); // 保存されていない
    });
  });
});
