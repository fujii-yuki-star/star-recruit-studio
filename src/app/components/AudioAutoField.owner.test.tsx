// @vitest-environment jsdom
// 音の自動処理の欄は**どちらの形式からも使える**（差分再監査 2巡目）。
//
// ⚠️ **値の持ち主を取り違えない**＝`value ?? 場面形式の値` にすると、まだ何も設定していない
// タイムライン動画で**別の動画（場面形式）の設定が自分のものとして表示される**。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AudioAutoField } from "./AudioAutoField";
import { useProjectStore } from "../store/projectStore";

beforeEach(() => {
  const meta = useProjectStore.getState().meta;
  // 場面形式の動画は「しない」にしてある。
  useProjectStore.setState({
    meta: { ...meta, videoSettings: { ...meta.videoSettings, audioAuto: { duckBgm: false, normalize: false } } },
  } as never);
});

describe("AudioAutoField の値の持ち主", () => {
  it("書き先を渡したら、場面形式の値は見ない（既定に戻る）", () => {
    render(<AudioAutoField value={undefined} onChange={vi.fn()} />);
    // 渡された値が未設定＝この動画の既定（する）を見せる。場面形式の「しない」を引っぱらない。
    expect(screen.getByRole("checkbox", { name: /BGMを控えめ/ })).toBeChecked();
  });

  it("書き先を渡さなければ、場面形式の値を見せる（従来どおり）", () => {
    render(<AudioAutoField />);
    expect(screen.getByRole("checkbox", { name: /BGMを控えめ/ })).not.toBeChecked();
  });

  /**
   * ⚠️ **触っていない項目を消さない**（差分再監査 3巡目 🔴・§2-5）＝欄は「変えた項目だけ」を渡すが、
   * 受け口が2つある（場面形式は中で重ねる／タイムラインは `videoSettings` を差し替える）ので、
   * 渡す側で重ねないと**片方を触っただけでもう片方が既定に化ける**。前の版の文書は
   * `{duckBgm:false, normalize:false}` を持つので、**開いて触っただけで別の音の動画**になる。
   */
  it("1項目を変えても、触っていない項目を落とさない", () => {
    const onChange = vi.fn();
    render(<AudioAutoField value={{ duckBgm: false, normalize: false }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /BGMを控えめ/ }));
    expect(onChange).toHaveBeenCalledWith({ duckBgm: true, normalize: false });
  });
});
