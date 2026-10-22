// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝骨格・編集・再生・書き出し・見た目パターン・字幕と読み上げ・動き・音の部品・切り抜き・音量の変化。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SNAP_OFF_HINT, SNAP_ON_HINT, SNAP_ON_SHORT, TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { missingTemplateMessage } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { VOLUME_POINTS_MAX } from "../../domain/constants";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";
import * as ffmpegMod from "../../infrastructure/ffmpegExport";
import { BACK_TO_HOME_LABEL, CLIP_PIVOT_HINT, KEYFRAME_HELP, MOTION_PRESET_HINT } from "../uiLabels";
import { doc, open, openPlaceTab, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();

describe("TimelineProjectScreen", () => {
  it("開いていないときは理由と、一覧へ戻る導線を出す（§2-5）", () => {
    useTimelineStore.setState({ loadError: "この動画を開けませんでした。一覧から選び直してください。" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("一覧から選び直してください");
    expect(screen.getByText(BACK_TO_HOME_LABEL)).toBeInTheDocument();
  });

  it("開いている動画の名前と、置いてあるものを見せる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("焼いた動画")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "こんにちは" })).toBeInTheDocument(); // 文字クリップは中身を見せる
    expect(screen.getByRole("button", { name: "よろしく" })).toBeInTheDocument(); // 読み上げは読み上げ文
  });

  it("列は手前が上（配列の後ろほど手前）＝重なりの見え方と一致させる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **列の見出しだけ**を見る（`置く列` の選択肢にも同じ名前が並ぶので、画面全体から拾うと混ざる）。
    const names = screen
      .getAllByText(/^(映像|音)\d$/)
      .filter((el) => el.tagName !== "OPTION")
      .map((el) => el.textContent);
    // 連番は**種別ごと**（並び全体の通し番号にすると「音1」が存在しない動画ができる）。
    expect(names).toEqual(["音1", "映像1"]);
  });

  it("クリップを選べる（Shift で追加選択）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
  });

  it("再生位置を動かすと、その時刻が表示に反映される", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2.5" } });
    expect(useTimelineStore.getState().playheadSec).toBe(2.5);
    // 時刻はコマまで（分:秒:コマ・UI/UX 監査 2026-10-02）＝2.5 秒＠30fps は 2秒15コマ。
    expect((screen.getByLabelText("再生位置の時刻") as HTMLInputElement).value).toBe("0:02:15");
    expect(screen.getByText("/ 全体 0:05:00")).toBeInTheDocument();
  });

  it("Home／End は画面のどこでも先頭へ／最後へ（スライダーに焦点があるときはそちらに譲る）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.getState().setPlayhead(2));
    fireEvent.keyDown(window, { key: "End" });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(5, 5);
    fireEvent.keyDown(window, { key: "Home" });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    act(() => useTimelineStore.getState().setPlayhead(2));
    const slider = screen.getByLabelText("再生位置");
    fireEvent.keyDown(slider, { key: "End" });
    expect(useTimelineStore.getState().playheadSec, "スライダーの Home/End を奪った").toBe(2);
  });

  it("表示倍率の −／＋ は、マウスでも説明が出る（Ctrl＋ホイールの案内つき）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "表示を広げる" }).getAttribute("title")).toContain("Ctrl＋ホイール");
    expect(screen.getByRole("button", { name: "表示を縮める" }).getAttribute("title")).toContain("Ctrl＋ホイール");
  });

  it("「吸着」の見出しの文字を押しても切り替わる", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: "吸着" });
    const before = sw.getAttribute("aria-checked");
    fireEvent.click(container.querySelector('label[for="timeline-snap-switch"]') as HTMLElement);
    expect(sw.getAttribute("aria-checked")).not.toBe(before);
  });

  // ⚠️ **吸着の説明は画面に短く出し、札にも付ける**（#1481）＝札だけにすると読めない人がいる（`06 §2` 規約20）。
  it("吸着の説明は画面に出し、見出しとスイッチの札にも同じ文を付ける（切り替えると変わる）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: "吸着" });
    const label = container.querySelector('label[for="timeline-snap-switch"]') as HTMLElement;
    const toolbar = sw.closest(".timeline-toolbar") as HTMLElement;
    const on = sw.getAttribute("aria-checked") === "true";
    const hint = (now: boolean) => (now ? SNAP_ON_HINT : SNAP_OFF_HINT);
    expect(sw.getAttribute("title")).toBe(hint(on));
    expect(label.getAttribute("title")).toBe(hint(on));
    // 画面に出すのは**短い一文**（ADR-0048 追補 2026-10-21＝道具を1行に収める）。札は長いまま。
    expect(toolbar.textContent).toContain(on ? SNAP_ON_SHORT : SNAP_OFF_HINT);
    fireEvent.click(sw);
    expect(sw.getAttribute("title")).toBe(hint(!on));
  });

  it("再生位置の時刻を打つと、その位置へ移る（読めなければ動かない・範囲の外は端へ）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const field = screen.getByLabelText("再生位置の時刻") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "0:03:15" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3.5, 9);
    fireEvent.change(field, { target: { value: "なに" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().playheadSec, "読めない値で動いた").toBeCloseTo(3.5, 9);
    expect(field.value, "読めない値が残っている").toBe("0:03:15");
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().playheadSec, "範囲の外へ出た").toBeLessThanOrEqual(5);
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value, "Escape で打つ前に戻らない").not.toBe("1");
  });

  it("何も置いていない動画でも壊れず、その旨を出す", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/まだ何も置かれていません/)).toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: レビュー指摘の修正（/canon-check）", () => {
  it("見た目パターンが見つからない部品があることを知らせる（黙って絵だけ消さない）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **文は共有関数から採る**（#834-2）＝画面で手書きすると禁止語の検査の外に落ちるので
    // `missingTemplateMessage` へ寄せた。ここを文字列で書くと、文言を直したときに**画面側だけ
    // 古いまま**でも気づけない＝共有関数を呼んで比べることで、片方だけ変わっていれば割れる。
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(missingTemplateMessage(1)))).toBe(true);
    // 描かれないものが混ざったまま書き出させない（ADR-0026④）。
    expect(screen.getByRole("button", { name: "動画を書き出す" })).toBeDisabled();
  });

  it("置き場所の取り違え（11 §8）も知らせる＝描画から外れるものを黙らせない", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_999", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("どの列に置くか決まっていない"))).toBe(true);
  });

  it("見た目パターンが持つ既定素材も表示できる（場面形式と同じ絵になる・ADR-0021）", () => {
    const withTemplateAsset: Template = {
      schemaVersion: "1.0", templateId: "tmpl_with_asset", name: "既定素材つき", category: "photo_intro",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, assetId: "tmpl_asset_001" }],
    };
    useProjectStore.setState({ templates: [withTemplateAsset], templateAssetSrcById: { tmpl_asset_001: "asset://tmpl.png" } });
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_with_asset" }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(document.querySelector(".preview-stage")?.innerHTML ?? "").toContain("asset://tmpl.png");
  });

  it("再生位置を末尾へ送っても絵が消えない（半開区間の端を1フレーム手前へ寄せる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "5" } });
    // 末尾ちょうどでも、その瞬間のクリップが描かれている（下地だけの空フレームにならない）。
    // 文言そのものは枠幅で折返し/省略されるので、文字が1つでも描かれていることを見る。
    expect(document.querySelector(".preview-stage svg text")).not.toBeNull();
  });
});

describe("TimelineProjectScreen: 編集操作（#629 後半）", () => {
  const twoClips = () =>
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "まえ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });

  it("選ぶまでは、何をすればよいか案内する", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/下の並びから部品を選ぶと/)).toBeInTheDocument();
  });

  it("選んだ部品を動かせて、取り消せる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.click(screen.getByText("後ろへ"));
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0.5);
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
  });

  it("置けないときは「次にどうすれば置けるか」を出す（§2-5）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("再生位置へ")); // clip_002（6秒〜）と重なる
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toBe(true);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 文書は変わらない
  });

  it("列を消すときは、一緒に消える部品の数を伝える（黙って消さない）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 操作は右クリックのメニューへ畳んだ（ADR-0033）＝行のボタンではなくメニューから消す。
    fireEvent.click(screen.getByLabelText("映像1の操作")); // 映像1（クリップ2個）
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(screen.getByRole("alert").textContent).toContain("2個の部品も一緒に消えます");
    fireEvent.click(screen.getByText("削除する"));
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_002"]);
  });

  it("複数選んだときは、まとめて消せるが位置は変えられない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.click(screen.getByRole("button", { name: "あと" }), { shiftKey: true });
    expect(screen.queryByText("後ろへ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("選んだ2個を削除"));
    // まとめて消すのは**確認を挟む**（`06 §2` 規約1・ADR-0034 決定20・#721）。
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 押しただけでは消えない
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
  });

  it("列を足せる。⚠️ **音は映像より下へ入る**（#1249）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("音の列を足す"));
    // ⚠️ **配列の後ろほど手前**（`11 §7.6`）で、画面は**手前を上**に出す＝画面の順は配列の逆。
    //   以前は種類に関わらず末尾へ足していたので、音が**映像より上**に乗っていた（#1249）。
    //   読む人が毎回逆さにしなくてよいように、**画面で見える順**で確かめる。
    const 画面の順 = [...useTimelineStore.getState().doc!.tracks].reverse().map((t) => t.kind);
    expect(画面の順).toEqual(["visual", "visual", "audio"]);
  });
});

describe("TimelineProjectScreen: 再生（#630）", () => {
  it("再生と停止を切り替えられる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    fireEvent.click(screen.getByText("停止"));
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("何も置いていない動画では再生を押せない", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("再生")).toBeDisabled();
  });

  it("先頭へ戻せる（先頭にいるときは押せない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("先頭へ")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("先頭へ"));
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("編集すると再生が止まる（動いている的を狙わせない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    fireEvent.click(screen.getByText("音の列を足す"));
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    expect(screen.getByText("再生")).toBeInTheDocument(); // ラベルも戻る
  });
});

describe("TimelineProjectScreen: 再生まわりのレビュー指摘（/canon-check）", () => {
  it("再生中に位置を動かしても戻らない（時計を測り直す）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    const before = useTimelineStore.getState().seekNonce;
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    // 世代番号が**このシークで**上がる＝時計が測り直す（上がらないと次のフレームで元の位置へ戻る）。
    expect(useTimelineStore.getState().playheadSec).toBe(3);
    expect(useTimelineStore.getState().seekNonce).toBe(before + 1);
  });

  // ⚠️ **掴んだら止める**（#844-6・ADR-0032 決定21 追補2）＝境界は「目盛りかどうか」ではなく
  // **「掴んでいるか」**。止めないと握っている間つまみが**指と再生位置の間で往復**する
  //（毎フレームの書き戻しが刻みの丸めに収まらない分だけ跳ねる）＝「掴めるのに言うことを聞かない」。
  it("「再生位置」の欄を掴むと再生が止まる（目盛りと同じ扱い）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    fireEvent.pointerDown(screen.getByLabelText("再生位置"), { button: 0, pointerId: 1 });
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  // ⚠️ **掴むのは左ボタンだけ**（差分再監査 ℹ️）＝掴む作法の単一の参照元（`usePointerDrag`）に揃える。
  // この画面は帯・列で「右クリックでも開けます」と案内しているので、右クリックしたときに
  // **メニューは出ず再生だけ止まる**は到達する（掴んでいないのに止まる＝線引きから外れる）。
  it("右クリックでは止まらない（掴んだことにしない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    fireEvent.pointerDown(screen.getByLabelText("再生位置"), { button: 2, pointerId: 1 });
    expect(useTimelineStore.getState().isPlaying).toBe(true); // 走ったまま
  });

  // ⚠️ **キーで動かすぶんは止めない**＝`11 §7.6.2.1` の「再生中に位置を動かしたら時計を測り直す」
  // （再生を続けたままのシーク）はそのまま。上の「位置を動かしても戻らない」と対で、
  // **掴む／掴まないで分かれている**ことを固定する。
  it("「再生位置」の欄を掴まずに値だけ動かしても、再生は止まらない", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    expect(useTimelineStore.getState().isPlaying).toBe(true); // 走ったまま
    expect(useTimelineStore.getState().playheadSec).toBe(3);
  });

  it("再生中は「再生位置を使う操作」を押せない（走っている位置を掴ませない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.getByText("再生位置へ")).not.toBeDisabled();
    fireEvent.click(screen.getByText("再生"));
    expect(screen.getByText("再生位置へ")).toBeDisabled();
    expect(screen.getByText("再生位置へ").getAttribute("title")).toBe("再生を止めてから使えます");
  });

  it("何も置いていないときは、再生を押せない理由を出す（無言にしない）", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 理由だけでなく**次の行動**まで言う（§2-5・#723）。
    expect(screen.getByText("再生").getAttribute("title")).toContain("部品を置くと再生できます");
  });
});

describe("TimelineProjectScreen: 書き出しを始められない理由（#718）", () => {
  const ready = () => open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
  const exportBtn = () => screen.getByRole("button", { name: "動画を書き出す" });

  it("声を作っている最中は押せない（押してから断ると、作った声が捨てられる）", () => {
    ready();
    useTimelineStore.setState({ generatingVoiceClipId: "clip_009", _voiceRun: 1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn().getAttribute("title")).toContain("声を作成中です");
  });

  it("開き直して印が消えても、「声を作る」は押せない（無言の空振りを作らない・#757 レビュー）", () => {
    // ⚠️ 関門は**走っている回**を見て即 return するので、印だけを見た見た目のままだと
    // **押せるのに何も起きず理由も出ない**（§2-5）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], generatingVoiceClipId: null, _voiceRun: 1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "声を作る" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("いま声を作っています");
    useTimelineStore.setState({ _voiceRun: null });
  });

  it("開き直して印が消えても、**走っている回**があれば押せない（#755）", () => {
    // ⚠️ 印（`generatingVoiceClipId`）は開き直しで消える。それだけを見ていると
    // **合成が走ったまま書き出しを始められ**、着地は断られて作った声が wav だけ残って消える。
    ready();
    useTimelineStore.setState({ generatingVoiceClipId: null, _voiceRun: 1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn().getAttribute("title")).toContain("声を作成中です");
  });

  it("中身が理由のときは、同じ文を二重に出さない（#729 レビュー）", () => {
    // 一覧（全件）と一段の知らせ（1件目）が両方出ると、**まったく同じ文が2つの知らせとして続く**
    //（読み上げも2回になる）。理由の出どころで出し分ける。
    open({ clips: [] }); // 「まだ何も置かれていない」＝文書の中身の理由
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const hits = screen.getAllByRole("alert").filter((el) => el.textContent?.includes("まだ何も置かれていない"));
    expect(hits).toHaveLength(1);
    // 押す前に断ることは変わらない（理由はボタンにも出す）。
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn().getAttribute("title")).toContain("まだ何も置かれていない");
  });

  it("いまの事情が理由のときは、知らせの段にも出す（無効なボタンの説明はホバーで出ないことがある）", () => {
    ready();
    useTimelineStore.setState({ isImporting: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").filter((el) => el.textContent?.includes("取り込み中"))).toHaveLength(1);
  });

  it("いまの事情と中身の理由が重なったら、両方出す（片方だけ直して堂々巡りにしない）", () => {
    open({ clips: [] });
    useTimelineStore.setState({ isImporting: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("取り込み中"))).toBe(true);
    expect(alerts.some((el) => el.textContent?.includes("まだ何も置かれていない"))).toBe(true);
  });

  it("素材を取り込んでいる最中は押せない", () => {
    ready();
    useTimelineStore.setState({ isImporting: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn().getAttribute("title")).toContain("取り込み中");
  });

  it("別の形式の書き出しが走っている間は押せない", () => {
    ready();
    useExportLockStore.setState({ owner: "scene" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).toBeDisabled();
  });

  it("この端末で書き出せないときも押せない（押してから断らない）", () => {
    vi.spyOn(ffmpegMod, "canExport").mockReturnValue(false);
    ready();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn().getAttribute("title")).toContain("この環境では");
  });

  it("どれも当てはまらなければ押せる", () => {
    ready();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(exportBtn()).not.toBeDisabled();
  });
});

describe("TimelineProjectScreen: 絵が出せない素材（#726 レビュー）", () => {
  const withPhoto = (srcById: Record<string, string>) => {
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真", filePath: "assets/asset_001.png" }],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, assetId: "asset_001" }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: srcById,
    });
  };

  it("表示先を用意できなかった素材があることを知らせる（音と同じ形・黙って絵を欠かさない）", () => {
    withPhoto({}); // 開いたときに表示先を作れなかった
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材を使っている部品が1個"))).toBe(true);
  });

  it("表示先がある素材では知らせない", () => {
    withPhoto({ asset_001: "asset://a.png" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材"))).toBe(false);
  });

  // ⚠️ **表示先があっても、ファイルが無ければ知らせる**（#1019 ⑤）＝`assetDisplayUrl` は URL を
  //    組むだけでディスクを見ないので、実在で調べないと**実機では一度も知らせが出ない**。
  it("表示先があっても、ファイルが見つからない素材は知らせて選び直せる", () => {
    withPhoto({ asset_001: "asset://a.png" });
    useTimelineStore.setState({ missingAssetIds: ["asset_001"] } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材を使っている部品が1個"))).toBe(true);
    expect(screen.getByRole("button", { name: "ファイルを選び直す" })).toBeInTheDocument();
  });

  // ⚠️ **選び直せる素材が1つも無くても知らせは出す**（母集合が違う）＝未解決が見た目パターンの
  //    持ち物（ADR-0021）だけのとき、知らせごと消すと**絵が出ないことすら伝わらない**。
  it("見た目パターンの持ち物だけが出せないときは、知らせだけ出して別の手を示す", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "テンプレ", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "mainVisual", type: "slot", x: 0, y: 0, w: 100, h: 100 }],
      } as Template],
      templateAssetSrcById: {},
    });
    useTimelineStore.setState({
      doc: doc({
        assets: [],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
                  templateId: "tmpl_001", assetRefs: { mainVisual: "tmpl_asset_001" } }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, missingAssetIds: [],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材を使っている部品が1個"))).toBe(true);
    expect(screen.queryByRole("button", { name: "ファイルを選び直す" }), "選び直せない素材に入口を出した").not.toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("見た目パターンが持っている素材"))).toBe(true);
  });

  // ⚠️ **差し込み口の動画は実フレームで描く**（#512 段3）＝代表フレームが無くても絵は出るので、
  // 「絵が出せない」と数えない。数えると**誤った理由**で警告が出る（見た目パターンを渡し忘れると起きる）。
  it("差し込み口の動画は、代表フレームが無くても「絵が出せない」と数えない", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "テンプレ", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
      } as unknown as Template],
      templateAssetSrcById: {},
    });
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" }],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材"))).toBe(false);
  });

  // ⚠️ **ファイルが無いときは、実フレームで描く動画も知らせる**（#1101）＝代表フレームを要らない
  //    ぶん上の集合に出てこないので、実写動画だけ**「ファイルを選び直す」に辿り着けず**
  //    作り直しを迫っていた（#1019 ⑤ の判断から漏れていた）。
  it("差し込み口の動画でも、ファイルが見つからなければ選び直せる", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "テンプレ", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
      } as unknown as Template],
      templateAssetSrcById: {},
    });
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" }],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
      missingAssetIds: ["asset_v"],
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材を使っている部品が1個"))).toBe(true);
    expect(screen.getByRole("button", { name: "ファイルを選び直す" })).toBeInTheDocument();
  });

  // ⚠️ **直接置いた動画も同じ**（3種の置き方＝直接置き・差し込み口・立ち絵。PR #1102 レビュー 🟡）＝
  //    1つでも漏らすと、その置き方だけ作り直しを迫る側に取り残される。
  it("直接置いた動画でも、ファイルが見つからなければ選び直せる", () => {
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" }],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, assetId: "asset_v" }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [],
      assetSrcById: { asset_v: "asset://v.mp4" }, missingAssetIds: ["asset_v"],
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("絵が出せない素材を使っている部品が1個"))).toBe(true);
    expect(screen.getByRole("button", { name: "ファイルを選び直す" })).toBeInTheDocument();
  });

  // ⚠️ **立ち絵に入れた動画も同じ**（#809＝置き場所として数えている）。
  it("立ち絵に入れた動画でも、ファイルが見つからなければ選び直せる", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "テンプレ", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "chara", type: "character", x: 0, y: 0, w: 400, h: 800 }],
      } as unknown as Template],
      templateAssetSrcById: {},
    });
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" }],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001",
          character: { enabled: true, characterId: "yuko", poseAssetId: "asset_v" },
        }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
      missingAssetIds: ["asset_v"],
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ファイルを選び直す" })).toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 音（#630 後半）", () => {
  it("音が見つからない部品があることを知らせる（黙って無音にしない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("音が見つからない部品が1個"))).toBe(true);
  });

  it("音源が用意できている部品では知らせない", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "generated", voicePath: "voices/a.wav" } },
      ],
    });
    useTimelineStore.setState({ audioSrcByKey: { "voice:voices/a.wav": "data:audio/wav;base64,QQ==" } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/音が見つからない部品/)).not.toBeInTheDocument();
  });

  // ⚠️ **置いた直後に「もう一度作ってください」と言わない**（2026-09-28 の実機レビュー）＝
  //   読み上げを置いた瞬間は文も声も無いので、**一度も作っていないのに**そう言われた。
  //   しかも「読み上げる文が入っていません。文を入力してください」と並び、
  //   **同じ1つの部品に別々の次の行動が2つ**出ていた（§2-5・ADR-0026②）。
  it("文がまだ無い読み上げでは、音が見つからないとは言わない（文を入れるのが先）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "", status: "none" } },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/音が見つからない部品/)).not.toBeInTheDocument();
  });

  // ⚠️ **空白だけも「文が無い」**＝声を作っても無音になる（`TIMELINE_VOICE_TEXT_EMPTY` と同じ物差し）。
  it("空白だけの読み上げでも同じ", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "   ", status: "none" } },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/音が見つからない部品/)).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 書き出し（#631）", () => {
  it("書き出しの導線を出し、押すと書き出しが走る", async () => {
    open();
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    const exportTimelineVideo = vi.fn().mockResolvedValue(undefined);
    useTimelineStore.setState({ exportTimelineVideo });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    await waitFor(() => expect(exportTimelineVideo).toHaveBeenCalledWith({ templates: [], templateAssetSrcById: {} }));
  });

  /**
   * ⚠️ **始める直前に持ち込みフォントを取り直す**（差分再監査 5巡目 ℹ️）＝この画面は書き出す欄が
   * 同じ画面にあるので、開いたまま長く編集すると**古い一覧のまま門を通り**、アプリの外で字体を
   * 消しても**黙って別の字体の動画が成功として出る**（場面形式は書き出し直前の画面で取り直す）。
   */
  it("書き出しを始める前に、持ち込みフォントの一覧を取り直す", async () => {
    open();
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    const order: string[] = [];
    const refreshUserFonts = vi.fn(async () => { order.push("refresh"); });
    const exportTimelineVideo = vi.fn(async () => { order.push("export"); });
    useProjectStore.setState({ refreshUserFonts } as never);
    useTimelineStore.setState({ exportTimelineVideo });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    refreshUserFonts.mockClear();
    order.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    await waitFor(() => expect(exportTimelineVideo).toHaveBeenCalled());
    expect(order).toEqual(["refresh", "export"]); // 取り直してから走らせる
  });

  it("フォントの一覧を取り直せなくても書き出しは始める（「調べられなかった」は門が見る）", async () => {
    open();
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    const exportTimelineVideo = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ refreshUserFonts: vi.fn(async () => { throw new Error("boom"); }) } as never);
    useTimelineStore.setState({ exportTimelineVideo });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    await waitFor(() => expect(exportTimelineVideo).toHaveBeenCalled());
  });

  it("書き出せない理由があるときは、押す前に理由を見せて押せなくする（§2-5）", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "動画を書き出す" });
    expect(btn).toBeDisabled();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("まだ何も置かれていない"))).toBe(true);
  });

  it("書き出し中は進み具合と中止を出す（書き出すボタンは出さない）", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を書き出しています（42%）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "書き出しを中止" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "動画を書き出す" })).not.toBeInTheDocument();
  });

  it("保存先を選んでいる間は進み具合を出さない（まだ何も描いていない）", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "preparing", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/動画を書き出しています/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "動画を書き出す" })).not.toBeInTheDocument();
  });

  it("終わったら結果を出し、閉じられる", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "done", percent: 100, message: "動画を保存しました。", cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を保存しました/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(useTimelineStore.getState().exportRun.phase).toBe("idle");
  });

  it("クレジットをプレビューにも出す（書き出しでは焼き込まれる＝見えていたものと同じ）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".preview-stage")?.innerHTML).toContain("VOICEVOX:");
  });
});

describe("TimelineProjectScreen: 見た目パターンの中身（#632）", () => {
  const template: Template = {
    schemaVersion: "1.0",
    templateId: "tmpl_001",
    name: "シンプル",
    category: "opening",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "mainVisual", type: "slot", x: 100, y: 100, w: 800, h: 600 },
      { id: "titleText", type: "text", textKey: "title", x: 100, y: 800, w: 800, h: 100 },
    ],
  };

  const openWithTemplateClip = () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "assets/a.png" },
        { assetId: "asset_002", assetType: "video", displayName: "動画B", filePath: "assets/b.mp4" },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("差し込み口と文字の欄を出す（置いたあとも中身を差し替えられる）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("背景")).toBeInTheDocument();
    expect(screen.getByText("メイン素材")).toBeInTheDocument();
    expect(screen.getByText("見出し")).toBeInTheDocument();
  });

  it("差し込み口に素材を入れられる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "asset_001" } });
    expect(useTimelineStore.getState().doc?.clips[0].assetRefs).toEqual({ mainVisual: "asset_001" });
  });

  // ⚠️ **動画も選べる**（#512 段3）＝差し込み口でも映るようになったので、外す理由が消えた。
  // 規則は場面編集と同じ関数（`assignableAssetsFor`）＝同じ枠を画面によって別扱いしない。
  it("差し込み口には動画も選べる（段3 で映るようになった）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("写真A");
    expect(select?.textContent).toContain("動画B");
    fireEvent.change(select!, { target: { value: "asset_002" } });
    expect(useTimelineStore.getState().doc?.clips[0].assetRefs).toEqual({ mainVisual: "asset_002" });
  });

  // ⚠️ **その枠にだけ実映像を出す**（#512 段3）＝部品 id で差し替えると、隣の枠まで同じコマで塗る。
  // 差し込み口が2つある見た目パターンで、動画の枠だけに `video` が出ることを見る。
  it("差し込み口が複数あっても、動画の枠だけに実映像が出る", () => {
    const twoSlots: Template = {
      ...template,
      layers: [
        { id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 },
        { id: "right", type: "slot", x: 960, y: 0, w: 960, h: 1080 },
      ],
    };
    useProjectStore.setState({ templates: [twoSlots], templateAssetSrcById: {} });
    open({
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" },
        { assetId: "asset_002", assetType: "video", displayName: "動画B", filePath: "b.mp4" },
      ],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: "tmpl_001",
        assetRefs: { left: "asset_001", right: "asset_002" },
      }],
    });
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { asset_001: "blob:photo", asset_002: "blob:thumb_v" },
        videoSrcById: { asset_002: "blob:body_v" },
      });
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const videos = [...container.querySelectorAll(".preview-stage video")] as HTMLVideoElement[];
    expect(videos).toHaveLength(1); // ⚠️ 隣の枠にも窓を開けない
    expect(videos[0].getAttribute("src")).toBe("blob:body_v");
    // ⚠️ **右の枠**に出る（部品 id だけで当てると、先に見つかる左＝写真の枠へ出てしまう）。
    expect(videos[0].style.left).toBe("50%");
    // 写真の枠はそのまま（静止画の層が担当＝コマで塗り潰さない）。
    expect(container.innerHTML).toContain("blob:photo");
  });

  // ⚠️ **この画面で読めない動画は代表フレームへ戻す**＝差し込み口でも同じ（部品に素材 id が無いので、
  // 部品側で覚えると差し込み口では効かず、穴だけ開いた窓が残る）。
  it("差し込み口の動画が読めなかったら、窓を閉じて静止のまま見せる", () => {
    const oneSlot: Template = {
      ...template,
      layers: [{ id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_002", assetType: "video", displayName: "動画B", filePath: "b.mp4" }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_002" },
      }],
    });
    act(() => {
      useTimelineStore.setState({ assetSrcById: { asset_002: "blob:thumb_v" }, videoSrcById: { asset_002: "blob:body_v" } });
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const v = container.querySelector(".preview-stage video") as HTMLVideoElement;
    expect(v).not.toBeNull();
    act(() => { fireEvent(v, new Event("error")); });
    expect(container.querySelector(".preview-stage video")).toBeNull();
  });

  // ⚠️ **黙って静止＋無音にしない**（#816-1）＝`.avi`/`.mkv` は取り込めるがこの画面では復号できず、
  // 必ずこの状態になる（例外ではなく主要ケース）。書き出しは実映像＋元の音を出すので、理由を出さないと
  // **見えていたものと違う動画**が成功として出る（ADR-0001・ADR-0026④）。
  it("この画面で再生できない動画は、静止する理由をその場で出す", () => {
    const oneSlot: Template = {
      ...template,
      layers: [{ id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_002", assetType: "video", displayName: "動画B", filePath: "b.avi", metadata: { hasAudio: true } }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_002" },
        slotClips: { left: { useOriginalAudio: true } },
      }],
    });
    act(() => {
      useTimelineStore.setState({ assetSrcById: { asset_002: "blob:thumb_v" }, videoSrcById: { asset_002: "blob:body_v" } });
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const v = container.querySelector(".preview-stage video") as HTMLVideoElement;
    act(() => { fireEvent(v, new Event("error")); });
    expect(container.querySelector(".preview-stage video")).toBeNull(); // 窓は閉じる（従来どおり）
    // ⚠️ **音だけの要素も出さない**（レビュー ℹ️）＝同じ復号器を通るので鳴らせない。
    // 音だけの要素は舞台の**外**（`.preview-stage-wrap` 直下）に置かれるので、そこを見る。
    expect(container.querySelector(".preview-stage-wrap > video")).toBeNull();
    expect(screen.getByText(/ここでは映像も音も出せません/)).toBeInTheDocument(); // 黙らない
  });

  // ⚠️ **差し込み口ごとに元の音の欄を出す**（#512 段3b）＝直接置きと同じ形・同じ言い方（ADR-0026②）。
  // 音が入っているか判らない素材には断定せず、直接置きと同じ2文で理由を出す。
  it("差し込み口に入れた動画には、その枠の「この動画の音」が出る", () => {
    openWithTemplateClip();
    const cur = useTimelineStore.getState().doc!;
    useTimelineStore.setState({
      doc: {
        ...cur,
        assets: cur.assets.map((a) => (a.assetId === "asset_002" ? { ...a, metadata: { hasAudio: true } } : a)),
        clips: [{ ...cur.clips[0], assetRefs: { mainVisual: "asset_002" } }],
      } as typeof cur,
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const toggle = screen.getByText("この動画に入っている音を流す");
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle.previousElementSibling as HTMLInputElement);
    expect(useTimelineStore.getState().doc?.clips[0].slotClips).toEqual({ mainVisual: { useOriginalAudio: true } });
  });

  it("音が入っているか判らない差し込み口には、欄を出さずに理由を出す", () => {
    openWithTemplateClip();
    const cur = useTimelineStore.getState().doc!;
    useTimelineStore.setState({
      doc: { ...cur, clips: [{ ...cur.clips[0], assetRefs: { mainVisual: "asset_002" } }] } as typeof cur,
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/確かめられませんでした/)).toBeInTheDocument();
    expect(screen.queryByText("この動画に入っている音を流す")).toBeNull();
  });

  it("文字を書き換えられる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("見出し");
    fireEvent.change(input!, { target: { value: "会社紹介" } });
    expect(useTimelineStore.getState().doc?.clips[0].texts).toEqual({ title: "会社紹介" });
  });

  it("見た目パターンが見つからない部品では、中身の欄でなく次の行動を出す", () => {
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_missing" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(missingTemplateMessage()))).toBe(true); // 文は共有関数から（#834-2）
    // ⚠️ **できない行動を名指ししない**（#812）＝見た目パターンを読み直す操作は画面に無く、
    // 自作のものを消した場合は読み直しても戻らない（§2-5）。
    expect(screen.queryByText(/読み込み直/)).toBeNull();
  });

  it("固定した列の部品は中身も変えられない（押せない理由を出す）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "assets/a.png" }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select).toBeDisabled();
    expect(select?.getAttribute("title")).toContain("固定を外してください");
  });

  // ⚠️ **種別の合わない素材が入っていたら、名前だけ出す**（「なし」と見分けが付く・選び直せない）。
  // 動画は段3 で普通の選択肢になったので、ここは写真だけの差し込み口へ動画が入っている場合。
  it("その枠に入れられない素材が入っていたら、名前だけ出す（「なし」と見分けが付く）", () => {
    openWithTemplateClip();
    const cur = useTimelineStore.getState().doc!;
    useTimelineStore.setState({
      doc: {
        ...cur,
        assets: [...cur.assets, { assetId: "asset_003", assetType: "bgm", displayName: "曲C", filePath: "c.mp3" }],
        clips: [{ ...cur.clips[0], assetRefs: { mainVisual: "asset_003" } }],
      } as typeof cur,
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("曲C");
    expect(select?.querySelector('option[value="asset_003"]')).toBeDisabled();
  });

  // ⚠️ **数えるのは「空だと灰色の枠が出る」層だけ**（#1040）＝この見た目は背景＋差し込み口1つなので
  //    1個（背景は空でも**塗り**が描かれるので枠は出ない）。
  it("素材が入っていない差し込み口を知らせる（灰色の枠が動画に出る）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("素材が入っていない差し込み口が1個"))).toBe(true);
  });

  // ⚠️ **出ないものを「出る」と言わない**（§2-5）＝背景に色を使う見た目・ロゴを置かない場面で
  //    知らせが出ると、**消す手が「要らない素材を入れる」しかない**（正しい使い方なのに直せない）。
  it("背景とロゴだけの見た目では知らせない（灰色の枠は出ない）", () => {
    const noSlot: Template = {
      ...template,
      layers: [
        { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, fillColor: "#123456" },
        { id: "logo", type: "logo", x: 0, y: 0, w: 200, h: 100 },
      ],
    } as Template;
    useProjectStore.setState({ templates: [noSlot], templateAssetSrcById: {} });
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_001" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("alert").some((el) => el.textContent?.includes("素材が入っていない差し込み口"))).toBe(false);
  });

  it("向きが違う見た目パターンは一覧に出さない（押せるのに置けないものを並べない）", () => {
    const portrait: Template = { ...template, templateId: "tmpl_p", name: "たて型", aspectRatio: "9:16" };
    useProjectStore.setState({ templates: [template, portrait], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("見た目パターン");
    expect(screen.getByRole("button", { name: "シンプル" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "たて型" })).not.toBeInTheDocument();
  });

  // ⚠️ **案内は「いま何をすれば埋まるか」**（#512 段3 で更新）＝動画は使えるようになったので、
  // 動画専用の枠が埋まらない理由は「動画を1つも取り込んでいない」だけ。
  it("動画しか入れられない差し込み口には、どうすればよいかを出す（永久に埋まらない枠を黙らせない）", () => {
    const videoOnly: Template = {
      ...template,
      layers: [{ id: "mainVisual", type: "slot", slotType: "video", x: 0, y: 0, w: 100, h: 100 }],
    };
    useProjectStore.setState({ templates: [videoOnly], templateAssetSrcById: {} });
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/入れられる動画がありません/)).toBeInTheDocument();
  });

  it("バラす前に断る（戻せないことを知らせる）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    expect(screen.getByText(/写真や文字を入れる場所は無くなります/)).toBeInTheDocument();
    // 確認しただけでは何も起きない。
    expect(useTimelineStore.getState().doc?.clips).toHaveLength(1);
  });

  it("バラすと中身ぶんの部品になり、まとめて選ばれる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    const s = useTimelineStore.getState();
    expect(s.doc?.clips.length).toBeGreaterThan(1);
    expect(s.doc?.clips.some((c) => c.kind === TIMELINE_CLIP_KIND.template)).toBe(false);
    expect(s.selectedClipIds).toEqual(s.doc?.clips.map((c) => c.id));
  });

  it("バラしたあとは取り消しで戻せる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc?.clips).toHaveLength(1);
    expect(useTimelineStore.getState().doc?.clips[0].kind).toBe(TIMELINE_CLIP_KIND.template);
  });

  it("見た目パターンを再生位置から置ける", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({ clips: [] });
    useTimelineStore.setState({ playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("見た目パターン");
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip).toMatchObject({ kind: TIMELINE_CLIP_KIND.template, templateId: "tmpl_001", startSec: 2 });
  });

  it("置いた部品はそのまま選ばれる（続けて中身を入れられる）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("見た目パターン");
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual([useTimelineStore.getState().doc?.clips[0].id]);
  });

  it("置けないときは理由を出す（黙って別の場所に置かない）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open();
    useTimelineStore.setState({ playheadSec: 1 }); // 既にある部品と重なる位置
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("見た目パターン");
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("先に置いてある部品があります"))).toBe(true);
  });
});

describe("TimelineProjectScreen: 字幕と読み上げの連動（#633）", () => {
  const withVoiceAndSubtitle = () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_sub", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 1, x: 0, y: 900, w: 1920, h: 120 },
        { id: "clip_voice", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 2, durationSec: 3, voice: { text: "よろしく", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_sub"] });
  };

  it("連動先を選べる（選ぶと時間も合う）", () => {
    withVoiceAndSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("連動先").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "clip_voice" } });
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.id === "clip_sub");
    expect(sub).toMatchObject({ voiceClipId: "clip_voice", startSec: 2, durationSec: 3 });
  });

  it("連動をやめられる（部品はその場に残る）", () => {
    withVoiceAndSubtitle();
    useTimelineStore.setState({
      doc: {
        ...useTimelineStore.getState().doc!,
        clips: useTimelineStore.getState().doc!.clips.map((c) =>
          c.id === "clip_sub" ? { ...c, voiceClipId: "clip_voice", startSec: 2, durationSec: 3 } : c,
        ),
      },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("連動先").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "" } });
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.id === "clip_sub");
    expect(sub?.voiceClipId).toBeUndefined();
    expect(sub).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it("いま出る文を見せる（連動先の読み上げ文）", () => {
    withVoiceAndSubtitle();
    useTimelineStore.setState({
      doc: {
        ...useTimelineStore.getState().doc!,
        clips: useTimelineStore.getState().doc!.clips.map((c) =>
          c.id === "clip_sub" ? { ...c, voiceClipId: "clip_voice", startSec: 2, durationSec: 3 } : c,
        ),
      },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/いま出る文：「よろしく」/)).toBeInTheDocument();
  });

  it("連動先が見つからない字幕を知らせる（黙って連動が切れない）", () => {
    open({
      clips: [
        { id: "clip_sub", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 1, x: 0, y: 900, w: 1920, h: 120, voiceClipId: "clip_999" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("連動する読み上げが見つからない字幕が1個"))).toBe(true);
  });
});

describe("TimelineProjectScreen: 読み上げを置く・声を作る（#633）", () => {
  const withVoice = (voiceOver: Record<string, unknown> = {}) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_voice", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 2, durationSec: 3, voice: { text: "ひとこと", status: "none", ...voiceOver } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_voice"] });
  };

  it("再生位置から読み上げを置ける（置いた部品が選ばれる）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [],
    });
    useTimelineStore.setState({ playheadSec: 4 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("読み上げ");
    fireEvent.click(screen.getByRole("button", { name: "読み上げを置く" }));
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip).toMatchObject({ kind: TIMELINE_CLIP_KIND.voice, startSec: 4, trackId: "track_002" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([clip?.id]);
  });

  it("文を書き換えられる", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.change(input!, { target: { value: "べつの文" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("べつの文");
  });

  it("声（話者）を選べる／動画全体に合わせるへ戻せる", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("声").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "2" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.speaker).toBe(2);
    fireEvent.change(select!, { target: { value: "" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.speaker).toBeUndefined();
  });

  it("文が空のときは声を作れない（押せない理由を出す）", () => {
    withVoice({ text: "" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "声を作る" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("読み上げる文を入れてください");
  });

  it("この読み上げの字幕を置ける（連動つき・同じ時間）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "この読み上げの字幕を置く" }));
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(sub).toMatchObject({ voiceClipId: "clip_voice", startSec: 2, durationSec: 3 });
  });
});

describe("TimelineProjectScreen: 動き（キーフレーム・#634）", () => {
  const withClip = (over: Record<string, unknown> = {}) => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4, x: 100, y: 50, w: 300, h: 80, text: "うごく" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 3 });
  };

  // 数値欄は**確定（欄から離れる／Enter）で1回だけ**反映する（#706）。実ブラウザではボタンを押した時点で
  // 欄からフォーカスが外れて確定するが、jsdom は勝手にフォーカスを動かさないので、その1歩を書く。
  const typeAndPlace = (label: string, value: string) => {
    const input = screen.getByLabelText(label);
    fireEvent.change(input!, { target: { value } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
  };

  it("入れた「ずれ」を再生位置に置く（時刻は部品の先頭からの秒・値は絶対値でない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    // 再生位置 3 秒 − 部品の開始 2 秒＝1 秒。値は入れた 200（部品の x=100 を足したりしない）。
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, x: 200 }]);
  });

  it("空欄の項目は動かさない", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("濃さ（0〜1）", "0.5");
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, opacity: 0.5 }]);
  });

  it("端数の出る位置でも置き直しは増えない（時刻を丸めて渡す・#702）", () => {
    // 0.3 − 0.1 は 0.19999999999999998 になる＝丸めずに渡すと、画面の照合が外れて置き直しが1つ増える。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0.1, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "うごく" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0.3 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 0.2, x: 200 }]);
    // 置いた値を読み込める＝画面の照合と、保存した時刻が一致している。
    expect(screen.getByRole("button", { name: "この位置の値を読み込む" })).toBeInTheDocument();
    typeAndPlace("横のずれ（px）", "300");
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 0.2, x: 300 }]); // 増えない
  });

  it("置けたときは入れた値を空にする（次の1点をそのまま入れられる）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    expect((screen.getByLabelText("横のずれ（px）") as HTMLInputElement).value).toBe("");
  });

  it("書き出し中は置けない（押してから断らない・理由を出す）", () => {
    withClip();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "この位置に置く" });
    expect(btn).toBeDisabled();
    expect(btn.title).toBe("いま動画を書き出しています。終わってから編集してください");
  });

  it("断られたときは入れた値を消さない（音量の変化と同じ規準）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("横のずれ（px）");
    fireEvent.change(input!, { target: { value: "200" } });
    // 置く直前に書き出しが始まった＝store が断る経路（ボタンの disabled をすり抜けた場合）。
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_EXPORTING");
    expect((screen.getByLabelText("横のずれ（px）") as HTMLInputElement).value).toBe("200");
  });

  // ⚠️ **詳しい説明は「？」の中だけ**（使い勝手の点検 2026-10-22）＝節を開くと入力欄より前に約290字が3段並んでいた。
  // 文言ごとに書き並べず、**画面まるごとで**「？」の外に出ていないかを見る（CLAUDE.md §7＝直し漏れた1か所を見つけられる形）。
  it("動きの節の詳しい説明は、「？」の中にだけある（常に出る段落にしない）", () => {
    withClip({ tracks: [{ id: "track_001", kind: "visual" }, { id: "track_002", kind: "audio" }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const text of [KEYFRAME_HELP, MOTION_PRESET_HINT, CLIP_PIVOT_HINT]) {
      const outside = [...container.querySelectorAll("p, span, div")].filter((el) =>
        el.children.length === 0 && (el.textContent ?? "").includes(text.slice(0, 12)) && !el.closest(".help-tip-body"));
      expect(outside.map((el) => el.className), `「${text.slice(0, 12)}…」が「？」の外に出ている`).toEqual([]);
      expect(container.querySelector(`.help-tip > summary[title="${text}"]`), "札にも同じ文が無い").not.toBeNull();
    }
  });

  it("説明文に記号がそのまま出ない（Markdown は効かない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/本来の見た目からのずれ/).textContent).not.toContain("**");
  });

  it("置いた動きを一覧に出し、外せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("濃さ（0〜1）", "0.5");
    expect(screen.getByText("0:03:00：濃さ（0〜1） 0.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });

  it("置いた値を読み込んで直せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    fireEvent.click(screen.getByRole("button", { name: "この位置の値を読み込む" }));
    const input = screen.getByLabelText("横のずれ（px）");
    expect((input as HTMLInputElement).value).toBe("200");
    fireEvent.change(input!, { target: { value: "300" } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, x: 300 }]);
  });

  it("まとめて外せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("大きさ（倍）", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "動きをすべて外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });

  it("再生位置が部品の外なら置かせない（黙って端へ寄せない）", () => {
    withClip();
    useTimelineStore.setState({ playheadSec: 10 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "この位置に置く" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("再生位置がこの部品の外にあります"))).toBe(true);
  });

  it("固定した列の部品には置けない（欄を押せなくする）", () => {
    withClip({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("横のずれ（px）")).toBeDisabled();
  });

  it("音の部品には動きの欄を出さない（絵が無いので効かない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 4, bundledBgmId: "found-new-hope" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("横のずれ（px）")).not.toBeInTheDocument();
  });

  it("まとまりに付いた動きも知らせる（画面では動いているのに「無い」と言わない）", () => {
    withClip({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/「グループ」にも動きが付いています（2か所）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "グループの動きを外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });
});

describe("TimelineProjectScreen: 音の部品（速さ・使い始め・音量・フェード／音を置く・#634）", () => {
  const withBgm = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  // 数値欄は**確定（欄から離れる／Enter）で1回だけ**反映する（#706）＝1文字ごとに履歴を積まない。
  const setField = (label: string, value: string) => {
    const input = screen.getByLabelText(label);
    fireEvent.change(input!, { target: { value } });
    fireEvent.blur(input!);
  };

  it("速さを変えられる（部品の長さは変わらない）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("速さ（倍）", "2");
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({ speed: 2, durationSec: 10 });
  });

  it("素材の使い始めを変えられる", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("素材の使い始め（秒）", "12");
    expect(useTimelineStore.getState().doc?.clips[0].sourceStartSec).toBe(12);
  });

  it("音量を変えられ、空にすると動画全体に合わせる（継承へ戻る）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("音量", "0.8");
    expect(useTimelineStore.getState().doc?.clips[0].volume).toBe(0.8);
    setField("音量", "");
    expect(useTimelineStore.getState().doc?.clips[0].volume).toBeUndefined();
  });

  it("前後のフェードを付けられる", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("だんだん大きく（秒）", "2");
    setField("だんだん小さく（秒）", "3");
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 3 });
  });

  it("固定した列では変えられない（欄を押せなくする）", () => {
    withBgm({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("速さ（倍）")).toBeDisabled();
  });

  it("同梱BGMを再生位置から置ける", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [],
    });
    useTimelineStore.setState({ playheadSec: 5 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("音");
    fireEvent.click(screen.getByRole("button", { name: "前向きなポップ" }));
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: "found-new-hope", startSec: 5,
    });
  });

  it("持っている音の素材も置ける", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "自前の曲", filePath: "assets/a.mp3" }],
      clips: [],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("音");
    fireEvent.click(screen.getByRole("button", { name: "自前の曲" }));
    expect(useTimelineStore.getState().doc?.clips[0].assetId).toBe("asset_001");
  });

  it("絵の部品には音の欄を出さない", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("速さ（倍）")).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 切り抜き（#634）", () => {
  const withShape = (over: Record<string, unknown> = {}) => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 400, h: 300, fillColor: "#ff0000" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("%で隠せる（保存は割合）", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("下を隠す（%）");
    fireEvent.change(input!, { target: { value: "25" } });
    fireEvent.blur(input!); // 確定で1回だけ反映（#706）

    expect(useTimelineStore.getState().doc?.clips[0].crop).toEqual({ bottom: 0.25 });
  });

  it("固定した列では変えられない", () => {
    withShape({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("上を隠す（%）")).toBeDisabled();
  });

  it("音の部品には出さない（絵が無いので効かない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 4, bundledBgmId: "found-new-hope" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("上を隠す（%）")).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 音量の変化（#512 段4）", () => {
  const withAudio = (over: Partial<TimelineProject> = {}) => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 8, bundledBgmId: "found-new-hope" }],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("再生位置に点を置ける（保存するのは部品の先頭からの秒＝動画の時刻ではない）", () => {
    withAudio({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 1, durationSec: 8, bundledBgmId: "found-new-hope" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 動画の 3 秒＝部品（1 秒から）の 2 秒目。
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    const input = screen.getByLabelText("この位置の音量");
    fireEvent.change(input!, { target: { value: "0.4" } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toEqual([{ timeSec: 2, volume: 0.4 }]);
  });

  it("置いた点は一覧に出て、外せる", () => {
    withAudio({
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 1, durationSec: 8,
        bundledBgmId: "found-new-hope", volumePoints: [{ timeSec: 2, volume: 0.4 }],
      }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 表示は動画の時刻（部品の開始 1 秒 ＋ 点の 2 秒）＝画面の目盛りと同じ物差し。
    expect(screen.getByText("0:03:00：音量 0.4")).toBeInTheDocument();
    fireEvent.click(screen.getByText("外す"));
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toBeUndefined();
  });

  // ⚠️ **跳んだ先が見えるところまで送る**（#833-3 レビュー 🟡）＝「この位置へ」は枠の外へ跳ぶ確率が
  // いちばん高い（長い部品の後ろのほうに置いた点）。送らないと**跳んだのに何も見えない**＝#819-1 の症状そのもの。
  it("「この位置へ」で枠の外の点へ跳んだら、見えるところまで送る", () => {
    withAudio({
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 60,
        bundledBgmId: "found-new-hope", volumePoints: [{ timeSec: 40, volume: 0.4 }],
      }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "この位置へ" }));
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(40, 6);
    expect(scroll.scrollLeft).toBe(40 * 36); // 跳んだ先が左端に来るよう送る
  });

  it("上限に達したら置かずに「次の行動」を出す（§2-5）", () => {
    const full = Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));
    withAudio({
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 8,
        bundledBgmId: "found-new-hope", volumePoints: full,
      }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } });
    const input = screen.getByLabelText("この位置の音量");
    fireEvent.change(input!, { target: { value: "0.9" } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("ほかの点を外してから置いてください"))).toBe(true);
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toHaveLength(VOLUME_POINTS_MAX);
  });

  it("再生位置が部品の外なら、置く前に動かし方を案内する（§2-5）", () => {
    withAudio({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 5, durationSec: 3, bundledBgmId: "found-new-hope" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("部品が鳴っている時間"))).toBe(true);
    expect(screen.queryByText("この位置に置く")).not.toBeInTheDocument();
  });

  it("絵の部品には出さない（鳴る音が無いので効かない）", () => {
    open();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 文字クリップ
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("音量の変化")).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 音量の変化のレビュー指摘（/canon-check）", () => {
  const withPoints = (points: { timeSec: number; volume: number }[]) => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 8,
        bundledBgmId: "found-new-hope", volume: 0.25, volumePoints: points,
      }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("点があるときは「音量」欄を押せなくして理由を出す（設定したのに音が変わらない、を作らない）", () => {
    withPoints([{ timeSec: 1, volume: 0.8 }]);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("音量")).toBeDisabled();
    expect(screen.getByText(/その点が音量を決めます/)).toBeInTheDocument();
  });

  it("点が無ければ「音量」欄は使える（従来どおり一定の音量を決められる）", () => {
    withPoints([]);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("音量")).not.toBeDisabled();
  });

  it("置けなかったときは入力した値を消さない（打ち直しにさせない）", () => {
    withPoints(Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 })));
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } });
    const input = screen.getByLabelText("この位置の音量");
    fireEvent.change(input!, { target: { value: "0.9" } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByText("この位置に置く"));
    expect((screen.getByLabelText("この位置の音量") as HTMLInputElement).value).toBe("0.9");
  });
});

describe("TimelineProjectScreen: 音量の変化を部品の終わりに置く（#512 実機確認）", () => {
  it("終わりちょうど（部品の最後）にも置ける＝「だんだん大きく」の到達点を置ける", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "10" } });
    // 「部品の外です」ではなく、置く欄が出ている。
    expect(screen.getByText("この位置に置く")).toBeInTheDocument();
    const input = screen.getByLabelText("この位置の音量");
    fireEvent.change(input!, { target: { value: "1" } });
    fireEvent.blur(input!);
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toEqual([{ timeSec: 10, volume: 1 }]);
  });
});

// ⚠️ **音量の変化（上）と対の作り**（#814・ADR-0026②＝同じ概念は同じ挙動）。動きの側だけ境界ちょうどを
// 突いておらず、閉区間（`keyframeTimeAt` の `>`）を `>=` に変えても全テストが緑だった。変異が通ると
// 終端で「この位置に置く」が消えて「部品の外にあります」が出る＝**「ここまでに動き終わる」動きが作れない**。
// 再生位置は 0.1 刻みなので端にちょうど乗せられる（到達可能）。
describe("TimelineProjectScreen: 動きを部品の終わりに置く（#814）", () => {
  // ⚠️ 文言は要素で分かれている（秒の表示が挟まる）＝`getByText` では拾えない。
  // **拾えないまま `queryByText(...).toBeNull()` を書くと、常に通る空振りの守り**になる。
  const outsideNoticeShown = (): boolean =>
    screen.queryAllByRole("alert").some((el) => el.textContent?.includes("再生位置がこの部品の外にあります") ?? false);
  const openTextClip = (): void => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4,
          x: 0, y: 0, w: 400, h: 90, text: "あ" },
        // ⚠️ **尺を伸ばす相方**＝再生位置は動画の尺で頭打ちになるので、これが無いと「部品の外」へ行けず
        // 「外に出たら置けない」を確かめられない（置ける側だけ見て通ったつもりになる）。
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 8, durationSec: 2,
          x: 0, y: 0, w: 400, h: 90, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("終わりちょうど（部品の最後）にも置ける＝「ここまでに動き終わる」到達点を置ける", () => {
    openTextClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "6" } }); // 2.0〜6.0 の右端
    expect(outsideNoticeShown()).toBe(false);
    fireEvent.change(screen.getByLabelText("横のずれ（px）"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 4, x: 100 }]);
  });

  it("始まりちょうども置ける", () => {
    openTextClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("横のずれ（px）"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 0, x: 50 }]);
  });

  it("部品の外では置く欄を出さず、行ける時間を示す", () => {
    openTextClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "6.1" } });
    expect(outsideNoticeShown()).toBe(true);
    expect(screen.queryByLabelText("横のずれ（px）")).toBeNull();
  });
});
