// @vitest-environment jsdom
// 音の自動処理の設定欄（#257/#259・ADR-0032 追補4）。
//
// ⚠️ **技術用語を出さない**（§2-3）を実際の描画で固定する。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioAutoField } from "./AudioAutoField";
import { useProjectStore } from "../store/projectStore";
import type { AudioAutoSettings } from "../../domain/voice/audioAuto";

function setAudioAuto(audioAuto: AudioAutoSettings | undefined): void {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({ meta: { ...meta, videoSettings: { ...meta.videoSettings, audioAuto } } });
}
const current = (): AudioAutoSettings | undefined => useProjectStore.getState().meta.videoSettings.audioAuto;

beforeEach(() => setAudioAuto(undefined));
afterEach(() => setAudioAuto(undefined));

describe("AudioAutoField", () => {
  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「ダッキング」「ノーマライズ」「LUFS」を画面に出さない", () => {
    const { container } = render(<AudioAutoField />);
    expect(container.textContent).not.toMatch(/ダッキング|ノーマライズ|LUFS|サイドチェイン|dB/i);
  });

  it("未設定でも既定（両方する）で表示する", () => {
    render(<AudioAutoField />);
    expect(screen.getByRole("checkbox", { name: /BGMを控えめにする/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /全体の音量をそろえる/ })).toBeChecked();
  });

  /** ⚠️ 読み込んだ古い動画は「しない」＝そのまま表示される（勝手に既定へ戻さない）。 */
  it("「しない」が書かれていればその通りに表示する", () => {
    setAudioAuto({ duckBgm: false, normalize: false });
    render(<AudioAutoField />);
    expect(screen.getByRole("checkbox", { name: /BGMを控えめにする/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /全体の音量をそろえる/ })).not.toBeChecked();
  });

  it("切り替えると文書に書き込む", () => {
    render(<AudioAutoField />);
    fireEvent.click(screen.getByRole("checkbox", { name: /BGMを控えめにする/ }));
    expect(current()?.duckBgm).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /全体の音量をそろえる/ }));
    expect(current()?.normalize).toBe(false);
  });

  it("下げないときは、下げ方の欄を出さない（効かない設定を見せない）", () => {
    setAudioAuto({ duckBgm: false });
    render(<AudioAutoField />);
    expect(screen.queryByLabelText("どのくらい控えめにするか")).not.toBeInTheDocument();
  });

  it("下げ方を選ぶと書き込む（%や秒は画面に出さない）", () => {
    render(<AudioAutoField />);
    fireEvent.change(screen.getByLabelText("どのくらい控えめにするか"), { target: { value: "しっかり" } });
    expect(current()?.duckDepth).toBe(0.85);
    fireEvent.change(screen.getByLabelText("変わり方"), { target: { value: "すばやく" } });
    expect(current()?.duckAttackSec).toBe(0.08);
    expect(current()?.duckReleaseSec).toBe(0.2);
  });

  /** ⚠️ 手で書いたファイル・別の版の値でも「どれでもない」にしない（近い選択肢を選ぶ）。 */
  it("選択肢に無い値でも、近いものを選んで見せる", () => {
    setAudioAuto({ duckDepth: 0.62, duckAttackSec: 0.26 });
    render(<AudioAutoField />);
    expect((screen.getByLabelText("どのくらい控えめにするか") as HTMLSelectElement).value).toBe("ふつう");
    expect((screen.getByLabelText("変わり方") as HTMLSelectElement).value).toBe("ふつう");
  });

  it("書き出し中は触れない（設定した意味どおりのMP4にする）", () => {
    render(<AudioAutoField disabled />);
    expect(screen.getByRole("checkbox", { name: /BGMを控えめにする/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /全体の音量をそろえる/ })).toBeDisabled();
  });
});
