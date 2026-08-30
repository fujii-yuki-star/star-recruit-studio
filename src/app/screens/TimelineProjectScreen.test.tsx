// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。開けないときの案内と、並び・選択の見せ方を固定する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NUDGE_GROUP_IDLE_MS } from "../hooks/keyboardShortcut";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pointerDownAt } from "../../test/pointer";
import { CLIP_HANDLE_HIT_W_PX, CLIP_HANDLE_W_PX, CLIP_MENU_W_PX, TimelineProjectScreen } from "./TimelineProjectScreen";
import { PANEL_BODY_CLASS } from "../components/layout/PanelLayoutView";
import { useTimelineStore } from "../store/timelineStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { DELETE_LABEL, DUPLICATE_LABEL, DUCK_MERGED_MESSAGE, editBlockedMessage, lockedTrackMessage, missingTemplateMessage, clockLabel } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_MIN_CLIP_SEC } from "../../domain/constants";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { TIMELINE_LABEL_W_PX, VOLUME_POINTS_MAX } from "../../domain/constants";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";
import * as ffmpegMod from "../../infrastructure/ffmpegExport";

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260728_001",
    projectName: "焼いた動画",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },
    ],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "よろしく", status: "none" } },
    ],
    ...over,
  };
}

const open = (over: Partial<TimelineProject> = {}) =>
  useTimelineStore.setState({ doc: doc(over), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });

beforeEach(() => {
  vi.restoreAllMocks();
  // 書き出せる端末として振る舞わせる（ブラウザでは `canExport()` が false ＝ボタンが正しく無効になる）。
  // ⚠️ `restoreAllMocks` の**後**に張る（前に張ると、その場で外される）。
  vi.spyOn(ffmpegMod, "canExport").mockReturnValue(true);
  // 書き出しの締めはテスト間で持ち越さない（漏れると次のテストが別の理由で落ちて切り分けにくい）。
  useExportLockStore.setState({ owner: null });
  // **書き出しの状態を先に戻す**＝`closeTimelineProject` は書き出し中だと何もしない（走行中に文書を
  // 差し替えないため）。戻さないと、書き出し中にしたテストの状態が以降のテスト全部に残る。
  useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
  // ⚠️ **走っている「声を作る」回もテスト間で持ち越さない**（#755）。この印は文書を閉じても
  // 消えない（合成はアプリの中で走り続けるため）＝戻さないと、以降のテスト全部で書き出しが塞がる。
  useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null });
  useTimelineStore.getState().closeTimelineProject();
  useProjectStore.setState({ templates: [] });
  // 欄の配置は**アプリの設定に残る**（ADR-0033）＝テスト間で持ち越さない（前のテストの配置で描かない）。
  localStorage.clear();
});

describe("TimelineProjectScreen", () => {
  it("開いていないときは理由と、一覧へ戻る導線を出す（§2-5）", () => {
    useTimelineStore.setState({ loadError: "この動画を開けませんでした。一覧から選び直してください。" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("一覧から選び直してください");
    expect(screen.getByText("動画の一覧へ")).toBeInTheDocument();
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
    expect(screen.getByText(/2\.5 秒 \/ 全体 5\.0 秒/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("menuitem", { name: "この列を削除" }));
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
    // まとめて消すのは**確認を挟む**（`06 §2` 統一規約1・ADR-0034 決定20・#721）。
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 押しただけでは消えない
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
  });

  it("列を足せる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("音の列を足す"));
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.kind)).toEqual(["visual", "visual", "audio"]);
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

  it("素材が入っていない差し込み口を知らせる（灰色の枠が動画に出る）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("素材が入っていない差し込み口が2個"))).toBe(true);
  });

  it("向きが違う見た目パターンは一覧に出さない（押せるのに置けないものを並べない）", () => {
    const portrait: Template = { ...template, templateId: "tmpl_p", name: "たて型", aspectRatio: "9:16" };
    useProjectStore.setState({ templates: [template, portrait], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
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
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip).toMatchObject({ kind: TIMELINE_CLIP_KIND.template, templateId: "tmpl_001", startSec: 2 });
  });

  it("置いた部品はそのまま選ばれる（続けて中身を入れられる）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual([useTimelineStore.getState().doc?.clips[0].id]);
  });

  it("置けないときは理由を出す（黙って別の場所に置かない）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open();
    useTimelineStore.setState({ playheadSec: 1 }); // 既にある部品と重なる位置
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
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

  it("説明文に記号がそのまま出ない（Markdown は効かない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/本来の見た目からのずれ/).textContent).not.toContain("**");
  });

  it("置いた動きを一覧に出し、外せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("濃さ（0〜1）", "0.5");
    expect(screen.getByText(/3.00秒：濃さ（0〜1） 0.5/)).toBeInTheDocument();
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
    expect(screen.getByText(/「まとまり」にも動きが付いています（2か所）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "まとまりの動きを外す" }));
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
    expect(screen.getByText(/3\.00秒：音量 0\.4/)).toBeInTheDocument();
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

describe("TimelineProjectScreen: 並びの操作を右クリックへ畳む（ADR-0033）", () => {
  it("行に操作の文字を常時出さない（帯が読めなくならない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const label of ["隠す", "固定", "消す", "手前へ", "奥へ"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("行を右クリックすると、その列の操作が出る", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出さない" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "この列を削除" })).toBeInTheDocument();
  });

  it("メニューから操作でき、選ぶと閉じる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "動画に出さない" }));
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.hidden).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("いまの状態で意味が通る言い方にする（出していない列は「動画に出す」）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出す" })).toBeInTheDocument();
  });
});

/** 最後に置いた部品（`.at(-1)` は lib の対象外なので添字で取る）。 */
const lastClip = () => {
  const cs = useTimelineStore.getState().doc!.clips;
  return cs[cs.length - 1];
};

/**
 * 列の行の見出しを引く。⚠️ **名前だけでは引けない**＝「置く列」の選択肢にも同じ名前が出る（#771(b)）。
 * 行の見出しは並べ替えのために掴める要素（`timeline-row-label`）の中にある。
 */
const trackRowLabel = (name: string): HTMLElement => {
  const found = screen.getAllByText(name).find((el) => el.closest(".timeline-row-label"));
  return found!;
};

describe("TimelineProjectScreen: 欄の配置（ADR-0033 段階2）", () => {
  it("既定で「再生位置」と「選んだ部品」が同時に出ている（1点置くごとに上下スクロール、を起こさない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("再生位置")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "並び" })).toBeInTheDocument();
  });

  it("欄を閉じられて、閉じたら戻す導線が出る（戻せない欄を作らない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("音を置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    expect(screen.queryByRole("heading", { name: "音を置く" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "「音を置く」を表示する" }));
    expect(screen.getByRole("heading", { name: "音を置く" })).toBeInTheDocument();
  });

  it("配置は覚えていて、開き直しても同じ（動画ごとには変わらない）", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("音を置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    first.unmount();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "音を置く" })).not.toBeInTheDocument();
  });

  it("「配置を既定に戻す」で戻る（組み替えたあとの逃げ道）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("音を置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "配置を既定に戻す" }));
    expect(screen.getByRole("heading", { name: "音を置く" })).toBeInTheDocument();
  });

  it("欄はメニューで別の領域へ移せる（ドラッグが使えなくても組み替えられる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "左へ移す" }));
    // 移しても中身は残る（消えない）。
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
  });

  it("境界は掴める（欄の大きさを変えられる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("左の欄の幅")).toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 欄をつかんで動かす（ADR-0033 段階3）", () => {
  it("見出しをつかんでほかの欄へ落とすと移り、覚えている", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // jsdom は大きさを持たないので、欄の箱を置く（当たり判定はこの箱で決まる）。
    const box = (id: string, left: number) => {
      const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ left, top: 0, width: 100, height: 100, right: left + 100, bottom: 100, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    };
    box("selected", 0);
    box("preview", 200);
    pointerDownAt(screen.getByRole("heading", { name: "選んだ部品" }).parentElement!, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 250, clientY: 95, pointerId: 1 }); // 「仕上がり確認」の下寄り
    fireEvent.pointerUp(window, { clientX: 250, clientY: 95, pointerId: 1 });
    // 移しても中身は消えない。
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    first.unmount();
    // 覚えている（開き直しても同じ）。
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("app.panelLayout.timeline")!).nodes.right).toBeNull();
  });
});

describe("TimelineProjectScreen: 編集の場所を上から圧迫しない（利用者指摘 2026-08-04）", () => {
  it("説明文は出さない（名前だけ＝どの動画かは分かる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("焼いた動画")).toBeInTheDocument();
    expect(screen.queryByText("時間の流れを自由に組み替えて動画を作ります。")).not.toBeInTheDocument();
  });

  /**
   * 断りは**操作した欄の中**に出す（ADR-0034 決定10・#869）。
   * ⚠️ 以前は欄グリッドの直下の帯に出しており、**欄がいくつも並ぶ画面でどの操作が断られたのか
   * 読めなかった**（恒常の警告とも同じ見た目で並んでいた）。
   */
  it("置けなかった理由は**操作した欄の中**に出る（帯ではない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あと" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    // 「再生位置へ」は**選んだ部品**の欄のボタン＝返事もその欄の中に出る。
    fireEvent.click(screen.getByText("再生位置へ")); // clip_001（0〜5秒）と重なる＝置けない
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("ずらすか、列を足して重ねて"));
    expect(notice).toBeDefined();
    // **欄の中**にある（欄グリッドの外＝帯ではない）。
    const layoutArea = container.querySelector(".panel-layout")!;
    expect(layoutArea.contains(notice!)).toBe(true);
    // **その場の返事**と分かる見た目（恒常の警告と同じ顔で並べない）。
    expect(notice!.classList.contains("timeline-flash")).toBe(true);
    // 恒常の警告（見た目パターンが見つからない）は今までどおり欄の外に残る＝2つが混ざらない。
    const outside = [...container.querySelectorAll(".notice-warn")].filter((el) => !layoutArea.contains(el));
    expect(outside.some((el) => el.textContent?.includes("見た目パターンが見つからない部品が"))).toBe(true);
    // ⚠️ **帯には重ねて出さない**＝同じ文が2か所に出ると、どちらが今の返事か読めない。
    expect(outside.some((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toBe(false);
    expect(screen.getAllByRole("alert").filter((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toHaveLength(1);
  });

  /**
   * ⚠️ **行き先の欄を閉じていたら帯へ倒す**（#869）＝欄の中に出しても見えないので、
   * 押した結果が**黙って消える**（§2-5）。
   */
  it("返す先の欄を閉じているときは帯に出す（黙って消えない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あと" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("再生位置へ"));
    // 「選んだ部品」の欄を閉じる（欄の中に出しても見えなくなる）。
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("ずらすか、列を足して重ねて"));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false); // 帯（欄の外）に出ている
  });

  /**
   * ⚠️ **消す入口は4つある**（#869 レビュー 🟡）＝「選んだ部品」欄のボタン2つ・仕上がり確認の
   * 右クリック・並びの右クリック。渡し忘れると**押していない欄に返事が出る**。
   */
  it("「選んだ部品」欄から消せないときは、その欄の中に理由が出る", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().removeClipsByIds(["clip_001"], "selected");
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.lockedSelection]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(true);
  });

  /**
   * ⚠️ **画面全体の話になる理由は、欄を渡されても帯へ倒す**（#869 レビュー 🟡）。
   * 入口ごとに「書き出し中だけは帯」と書くと、入口が増えたとき片方だけ欄へ押し込まれ、
   * **同じ状況なのに出る場所が違う**（ADR-0026②）。規則は `blockTargetFor` に1つだけ置いている。
   */
  it.each([
    ["書き出し中", EDIT_BLOCKED.exporting],
    ["再生中", EDIT_BLOCKED.playing],
    ["対象が無い", EDIT_BLOCKED.notFound],
  ])("%s は欄を渡しても帯に出る", (_name, reason) => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().setEditBlocked(reason, "selected"); // 欄を渡す
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[reason]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  /** ⚠️ 逆に、**欄の話である理由は欄へ**（規則が何でも帯へ倒していないことを確かめる）。 */
  it("欄の話である理由は、渡した欄の中に出る", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.overlap, "selected");
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.overlap]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(true);
  });

  /** ⚠️ **渡し忘れは帯へ倒す**＝押していない欄に返事を出さない（安全側＝必ず見える所）。 */
  it("どこから消したか渡されなければ帯に出る", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().removeClipsByIds(["clip_001"]);
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.lockedSelection]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  /** ⚠️ 画面全体に効く断り（書き出し中）は今までどおり帯＝欄を閉じていても見える。 */
  it("画面全体に効く断りは帯に出る", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.setState({ editBlocked: { reason: EDIT_BLOCKED.exporting, at: "global" } });
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.exporting]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  it("見た目パターンが見つからない知らせも編集の下に出る", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("見た目パターンが見つからない部品が"));
    expect(notice).toBeDefined();
    const layoutArea = container.querySelector(".panel-layout")!;
    expect(layoutArea.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// 「選んだ部品」の欄は縦に長く、横にも切れていた（実機の指摘 2026-08-04）＝節を畳めるようにし、
// たまにしか触らない節は最初から畳んで出す（#687）。
describe("TimelineProjectScreen: 選んだ部品の欄を整える（#687）", () => {
  // 見出しは列の名前（「音1」など）と字が重なるので、**節の見出し**に限って探す。
  const section = (title: string): HTMLDetailsElement =>
    screen.getAllByText(title).find((el) => el.tagName === "SUMMARY")!.closest("details") as HTMLDetailsElement;

  it("節を畳める＝よく触る節は開き、細かい節は畳んで出す", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false); // 細かい調整＝畳む
    expect(section("切り抜き").open).toBe(false);
  });

  it("設定が入っている節は開いて出す（入れた設定を見失わせない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 1, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(true); // 動きが付いている＝畳んで隠さない
  });

  // ⚠️ **キーフレーム側の「この位置へ」も送る**（PR #839 レビュー ℹ️）＝音量点側と同じ形だが、
  // 片方だけ `followPlayhead()` を外す変異が**素通りしていた**（実測）。跳んだ先が枠の外だと
  // **跳んだのに何も見えない**＝#819-1 の症状そのものなので、両方を固定する。
  it("動きの「この位置へ」で枠の外へ跳んだら、見えるところまで送る", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 60, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 40, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "この位置へ" }));
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(40, 6);
    expect(scroll.scrollLeft).toBe(40 * 36); // 跳んだ先が左端に来るよう送る
  });

  it("まとまりに付いた動きの知らせも、畳んだ中に隠さない", () => {
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「画面では動いているのに『動きは付いていません』と言わない」ための知らせ＝見えていないと意味がない。
    expect(section("動き").open).toBe(true);
    expect(screen.getByText(/「まとまり」にも動きが付いています/)).toBeInTheDocument();
  });

  it("部品を切り替えたら節の既定を見直す（最初に選んだ部品のままにしない）", () => {
    // 同じ種類の部品を行き来する間は React が作り直さないので、`key` を付けないと開閉が固まる。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_002", keyframes: [{ timeSec: 1, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 動きの付いていない部品
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false);
    act(() => useTimelineStore.getState().selectClip("clip_002")); // 動きの付いた部品へ
    expect(section("動き").open).toBe(true);
  });

  it("まとまりの動きの知らせは、節を畳んでいても見える（畳める場所に置かない）", () => {
    // 一度畳んだ記憶は既定より優先されるので、知らせを節の中に置くと二度と見えなくなる。
    localStorage.setItem("timeline.sectionOpen", JSON.stringify({ anim: false }));
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false); // 畳んだ記憶どおり
    const notice = screen.getByText(/「まとまり」にも動きが付いています/);
    expect(notice.closest("details")).toBeNull(); // どの節の中にも入っていない
    expect(container.contains(notice)).toBe(true);
  });

  it("音の部品では、よく触る節を開いて出す", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, bundledBgmId: "found-new-hope" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("音").open).toBe(true);
    expect(section("音量の変化").open).toBe(false);
  });
});

// 選択は1つのモデルに統一する（ADR-0034 決定15・#701）。#685/#686 が繋ぐ先を先に固める。
describe("TimelineProjectScreen: 選択の作法（#701）", () => {
  // **どちらも再生位置（0秒）に掛かる**ようにする＝切り替えても「動き」の欄が出たままになり、
  // 下書きが残るかどうかを見られる（同じ列には重ねられないので列を分ける＝`11 §8` V24）。
  const twoClips = () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
  };

  it("何もない所を押すと選択が解ける", () => {
    twoClips();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.click(container.querySelector(".timeline-lane")!);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });

  it("帯を押したときは解けない（上がってきた分で解かない）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("Escape で解ける・Ctrl+A で全部選べる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });

  it("文字を打っている間と、日本語の変換中は奪わない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" }); // 入力欄の中
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.keyDown(window, { key: "Escape", isComposing: true }); // 変換中＝「変換をやめる」
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    input.remove();
  });

  it("帯には名前と時間帯を添える（短い帯でも何か分かる）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "あ" }).title).toBe("あ（0:00〜0:05）"); // 場面形式と同じ書き方
  });

  it("選ぶ部品を切り替えたら、前の部品への入力は残さない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    const field = () => screen.getByLabelText("横のずれ（px）") as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "200" } });
    expect(field().value).toBe("200");
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    expect(field().value).toBe(""); // 打った覚えのない値が別の部品に入らない
  });
});

// レビューで見つかった経路（#701 /canon-check）。取り返しのつかない操作と、打ちかけの値を守る。
describe("TimelineProjectScreen: 選択の作法（レビュー指摘）", () => {
  const withTemplateClips = (templates: Template[]) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_a" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.template, trackId: "track_003", startSec: 0, durationSec: 5, templateId: "tmpl_a" },
      ],
    });
    useProjectStore.setState({ templates });
  };

  it("「バラす」の確認は、聞いた時点の部品を相手にする（選び直しで別の部品が犠牲にならない）", () => {
    const tmpl = { templateId: "tmpl_a", name: "型A", category: "opening", orientation: "16:9", canvas: { w: 1920, h: 1080 }, layers: [] } as unknown as Template;
    withTemplateClips([tmpl]);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    // 選び直しても確認は残り、相手は変わらない（消えたように見えて状態だけ残る、を作らない）。
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    expect(screen.getByText(/中身を1つ1つの部品に分けますか/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    // バラされたのは**聞いた時点の** clip_001（選び直した clip_002 は見た目パターンのまま）。
    const kinds = useTimelineStore.getState().doc!.clips.filter((c) => c.id === "clip_002");
    expect(kinds[0].kind).toBe(TIMELINE_CLIP_KIND.template);
    expect(useTimelineStore.getState().doc!.clips.some((c) => c.id === "clip_001")).toBe(false);
  });

  it("確認が開いている間は Escape で選択を解かない（打ちかけの値を消さない）", () => {
    const tmpl = { templateId: "tmpl_a", name: "型A", category: "opening", orientation: "16:9", canvas: { w: 1920, h: 1080 }, layers: [] } as unknown as Template;
    withTemplateClips([tmpl]);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("固定した列の部品は消せない（全部選んでから消す、で固定が意味を失わない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    act(() => useTimelineStore.getState().removeSelectedClips());
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 消えない
    // ⚠️ 断る語彙は**画面と同じ**（#752 レビュー）＝「選んだ中に固定列のものが混ざる」という同じ
    // 述語に2つの言い方を持たない（次の行動も「選び直す」で進める）。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
  });

  it("選ぶと、前の部品で出た理由は消える（いまの部品の返事に見せない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ editBlocked: { reason: "TIMELINE_EDIT_OVERLAP", at: "arrange" }, voiceError: "声を作れませんでした。" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    expect(useTimelineStore.getState().voiceError).toBeNull();
  });

  it("列のメニューが開いている間は Escape で選択を解かない（閉じただけで選択まで消さない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    fireEvent.click(screen.getByLabelText("映像1の操作")); // 列のメニューを開く
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("欄の境界を掴んでいる間は Escape で選択を解かない（中止しただけで消さない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    // 欄の境界を掴む（ADR-0033）。掴んでいる間は欄の側が Escape を受け持つ。
    // jsdom は大きさを持たないので、割合を決める親の箱を置く（置かないと掴み始めない）。
    const divider = screen.getAllByLabelText("欄の境目")[0];
    (divider.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDownAt(divider, 1000, { clientX: 0, clientY: 50 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("欄のメニューが開いている間も Escape で選択を解かない", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作")); // 欄（ADR-0033）のメニュー
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("Mac の Cmd+A でも全部選べる", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("部品が無くても Ctrl+A は画面の文字を選ばせない", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const e = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

// 数値欄の確定タイミングと、押せない理由の出し方（#706・#703）。
describe("TimelineProjectScreen: 数値欄と押せない理由（#706・#703）", () => {
  const withBgmClip = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("打っている途中は履歴を積まない（確定して初めて1回）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const input = screen.getByLabelText("速さ（倍）");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "1." } });
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before); // 打っている間は積まない
    fireEvent.blur(input);
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 確定で1回だけ
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(1.5);
  });

  it("Enter でも確定する（欄から離れずに決められる）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("速さ（倍）");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(2);
  });

  it("範囲の外は範囲へ収める（打っている途中では直さない）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("速さ（倍）") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    expect(input.value).toBe("99"); // 打っている間は触らない（桁を打ち切る前に直さない）
    fireEvent.blur(input);
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(4); // CLIP_SPEED_MAX
  });

  it("書き出し中は編集の入口を押せなくして理由を出す（押してから断らない）", () => {
    withBgmClip();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const speed = screen.getByLabelText("速さ（倍）");
    expect(speed).toBeDisabled();
    expect(speed.title).toBe("いま動画を書き出しています。終わってから編集してください");
    const del = screen.getByRole("button", { name: "削除" });
    expect(del).toBeDisabled();
    expect(del.title).toBe("いま動画を書き出しています。終わってから編集してください");
    expect(screen.getByRole("button", { name: "複製" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "映像の列を足す" })).toBeDisabled();
  });

  it("固定した列のほうを先に出す（直せる順に理由を出す）", () => {
    withBgmClip({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("速さ（倍）").title).toBe(lockedTrackMessage("content"));
  });
});

// レビューで見つかった「押してから断る」の残り（#703）と、下書き欄の扱い（#706）。
describe("TimelineProjectScreen: 押す前に断る・下書きは即時（レビュー指摘）", () => {
  const withBgm = () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
  };
  const exporting = () =>
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });

  it("音量の点は、打った値でそのまま置ける（確定を待たせない）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("この位置の音量"), { target: { value: "0.4" } });
    // 打った直後に押せる＝下書きの欄は確定を待たない（待たせると1回目が必ず落ちる）。
    const place = screen.getAllByRole("button", { name: "この位置に置く" })[0];
    expect(place).not.toBeDisabled();
    fireEvent.click(place);
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toEqual([{ timeSec: 2, volume: 0.4 }]);
  });

  // #771(b)：素材・文字・図形の欄だけ「置く列」が無く、**暗黙にどこかの列**へ入っていた
  //（なぜそこに入ったのか読めない）。他の欄（見た目パターン・音・読み上げ）には元から在った。
  it("素材・文字・図形の欄でも「置く列」を選べる（暗黙にどこかへ入れない・#771(b)）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const place = document.querySelector('[data-panel-id="place"]') as HTMLElement;
    const select = within(place).getByLabelText("置く列") as HTMLSelectElement;

    // 既定は**いちばん手前の置ける列**＝欄に出ている列が実際に置く列（表示と結果を割らない）。
    fireEvent.click(within(place).getByRole("button", { name: "文字を置く" }));
    expect(lastClip().trackId).toBe(select.value);

    // 選び直すと、その列へ入る。
    const other = [...select.options].map((o) => o.value).find((v) => v !== select.value)!;
    fireEvent.change(select, { target: { value: other } });
    fireEvent.click(within(place).getByRole("button", { name: "図形を置く" }));
    expect(lastClip().trackId).toBe(other);
  });

  it("書き出し中は「置く列」も列の操作も押せない（押してから断らない）", () => {
    withBgm();
    exporting();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「置く列」は欄ごとにあるので**どの欄のものか**で絞る（#724 で音・読み上げにも増えた）。
    // ⚠️ 塞ぐのは**文書を変える**方だけ＝「選んだ部品」の置く列は `moveSelectedClip` を撃つので押せなくする。
    // 置く側（見た目パターン／音／読み上げ）の置く列は**次にどこへ置くかの下書き**で、変えても文書は
    // 動かない＝押せなくすると「触っても何も起きないのに押せない」になる（§2-5 は押してから断るのを禁じる
    // のであって、断られようのない操作まで塞げとは言っていない）。
    const inSelected = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    expect(within(inSelected).getByLabelText("載っている列")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("音1の操作"));
    const items = screen.getAllByRole("menuitem");
    expect(items.every((el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true")).toBe(true);
  });

  it("書き出し中は取り消す／やり直すも押せない（場面形式と同じ）", () => {
    withBgm();
    useTimelineStore.getState().moveSelectedClip({ startSec: 1 }); // 履歴を作る
    exporting();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取り消す" })).toBeDisabled();
  });

  it("確認を出したあとに書き出しが始まったら、確認を閉じる（答えさせてから断らない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("映像2の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この列を削除" }));
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();
    // 確認を出したまま「動画を書き出す」を押す＝答えを求める確認は閉じてから始める。
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    expect(screen.queryByRole("button", { name: "削除する" })).not.toBeInTheDocument(); // 答えさせない
    expect(useTimelineStore.getState().doc!.tracks).toHaveLength(2);
  });
});

// レビューで見つかった「押してから断る」の取りこぼし（#709）。選択に依る／依らないの取り違え。
describe("TimelineProjectScreen: 固定の見方（#709 レビュー）", () => {
  it("まとめて消すも、固定した列の部品が混ざっていたら押せない", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual, locked: true },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true }); // 全部選ぶ＝固定列のものが混ざる
    const del = screen.getByRole("button", { name: "選んだ2個を削除" });
    expect(del).toBeDisabled(); // 1つだけ選んだときだけ見る、では取りこぼす
    expect(del.title).toBe("固定された列の部品が選ばれています。固定を外すか、選び直してください");
  });

  it("字幕を置くのは、選んだ読み上げの列が固定でも押せる（別の列へ置くので関係ない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio, locked: true },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "よろしく", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "この読み上げの字幕を置く" })).not.toBeDisabled();
  });

  it("まとまりの動きは、別のメンバーの列が固定でも押せない（domain と同じ見方をする）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual, locked: true },
      ],
      groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    // 選んでいるのは**固定していない列**の部品（選んだ部品だけを見ると押せてしまう）。
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "まとまりの動きを外す" })).toBeDisabled();
  });
});

// 文字を打つ欄は「1文字＝1履歴」になっていた（#708）。上限（50）を文字入力で食い潰すと、
// それ以前の編集（バラすなど＝取り消しでしか戻らない）が戻せなくなる。
describe("TimelineProjectScreen: 文字を打つ間は1つの取り消しにまとめる（#708）", () => {
  const withVoice = () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("打っている間は1つ、離れたら次は別の1つ", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "こ" } });
    fireEvent.change(input, { target: { value: "こん" } });
    fireEvent.change(input, { target: { value: "こんにちは" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 5文字でも1つ
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("こんにちは"); // 文書は毎回追いつく
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "こんにちは。" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 2); // 入り直したら別の1つ
  });

  it("取り消すと、打つ前まで一度に戻る（1文字ずつ戻らない）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "あ" } });
    fireEvent.change(input, { target: { value: "あい" } });
    fireEvent.blur(input);
    act(() => useTimelineStore.getState().undo());
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("");
  });

  it("欄に入っただけでは取り消しを消費しない（触っただけで履歴が減らない）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });

  it("欄がフォーカス中に消えても、まとめは開きっぱなしにならない（以後の取り消しが積まれる）", () => {
    open({
      tracks: [
        { id: "track_002", kind: TRACK_KIND.audio },
        { id: "track_004", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_004", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "あ" } }); // ここで「編集前」を1回記録＝まとめは記録済みになる
    // 別の部品を選ぶ＝欄が入れ替わる。`blur` は来ないので、ここで畳まないと**開きっぱなし**になり、
    // 記録済みのまま以後の編集が1つも積まれなくなる。
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    const before = useTimelineStore.getState().history.past.length;
    act(() => useTimelineStore.getState().moveSelectedClip({ startSec: 2 }));
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 以後の取り消しが積まれる
  });

  it("打っている間もプレビューは追いつく（見えているものがそのまま出る）", () => {
    // 連動する字幕は、自分の文が無ければ読み上げの文をそのまま描く（ADR-0032 決定24）。
    // 下書きに溜める形にすると、打っている間プレビューが古いままになる。
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "とちゅう" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("とちゅう"); // 確定を待たない
  });
});

// 写真1枚すら置けなかった（#684・ADR-0034 段階1）。置く手段と、置いた直後に直せることを固定する。
describe("TimelineProjectScreen: 素材・文字・図形を置く（#684）", () => {
  const withAsset = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [],
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "会社の外観", filePath: "a.png" },
        { assetId: "asset_002", assetType: "bgm", displayName: "曲", filePath: "b.mp3" },
        // 動画も一覧に出す＝直接置けば映り、元の音も鳴る（#512 段1・段2）。下の「動画も置ける」で見る。
        { assetId: "asset_003", assetType: "video", displayName: "紹介ムービー", filePath: "c.mp4" },
      ],
      ...over,
    });
  };

  it("文字を置ける（置いたら選ばれていて、すぐ直せる）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const doc = useTimelineStore.getState().doc!;
    expect(doc.clips).toHaveLength(1);
    expect(doc.clips[0].kind).toBe(TIMELINE_CLIP_KIND.text);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([doc.clips[0].id]); // 置いたら選ぶ
    // 選ばれているので、そのまま中身（文字）を直せる＝「置けるのに直せない」を作らない。
    expect(screen.getByLabelText("文字")).toBeInTheDocument();
  });

  it("図形も置ける", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "図形を置く" }));
    expect(useTimelineStore.getState().doc!.clips[0].kind).toBe(TIMELINE_CLIP_KIND.shape);
  });

  it("写真を置ける（音の素材は絵として出さない）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("曲")).not.toBeInTheDocument(); // 音は絵の一覧に出さない
    fireEvent.click(screen.getByText("会社の外観"));
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ kind: "slot", assetId: "asset_001" });
  });

  // ⚠️ **動画も置ける**（#512 段1・利用者判断 2026-08-19）＝以前は「置けても書き出しの手前で断られる」
  // ので一覧から外していたが、直接置いた動画は映るようになった＝外す理由が消えた。
  it("動画も置ける（映るようになったので一覧に出す）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("紹介ムービー"));
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ kind: "slot", assetId: "asset_003" });
  });

  it("置ける列が無いときは、何をすれば置けるか出す", () => {
    withAsset({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文字を置く" })).not.toBeInTheDocument();
  });

  it("写真がまだ無いときは、この画面で取り込める道を出す（行き止まりにしない）", () => {
    // 場面形式の素材画面はこの形式を見ないので、そこを指すと**行き止まりの案内**（ADR-0034 決定5）。
    // #712 でこの画面に取り込みが付いたので、案内はここの導線を指す。
    withAsset({ assets: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/この動画にはまだ写真がありません/)).toBeInTheDocument();
    expect(screen.queryByText(/素材の画面で取り込む/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /写真・動画・音楽を取り込む/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字を置く" })).toBeInTheDocument(); // できることは残る
  });

  it("置ける列が無くても取り込める（列を足すまで素材を用意できない、を作らない・#712）", () => {
    withAsset({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /写真・動画・音楽を取り込む/ })).toBeInTheDocument();
  });

  it("続けて置くと、次に空いている時刻へ置く（押しても置けない、を続けない）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // 同じ再生位置＝塞がっている
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips).toHaveLength(2);
    // 1つ目の終わりから続けて置く（重ねない・黙って何もしない、もしない）。
    expect(clips[1].startSec).toBe(clips[0].startSec + clips[0].durationSec);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });

  // ── つかんで置く（#684・ADR-0034 決定2） ────────────────────────────────
  // jsdom は要素の大きさを持たないので、落とし先の箱だけ与える（当て方＝`pointInRect` は純粋関数で別途固定）。
  const stubRect = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
  };
  const grab = (el: Element) => fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  const moveTo = (x: number, y: number) => fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: x, clientY: y });
  const dropAt = (x: number, y: number) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

  it("つかんで列へ落とすと、その列のその時刻へ置く（探さない・寄せない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 先に1つ置いて並びを出す（列は部品が無いと描かれない）。
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 手前＝track_003
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 奥＝track_001
    // ⚠️ 倍率は**段の既定**（36 px/秒・#686）＝以前の「尺から自動」は表示倍率の導入で無くなった。
    // 幅を測れない環境（jsdom）では全体表示に合わせられないので、ここに落ち着く。
    // 左端 200 から 5秒＝200 + 5×36 = 380px。
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 460); // 奥の列の 5秒
    dropAt(380, 460);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.shape)!;
    expect(placed).toMatchObject({ trackId: "track_001", startSec: 5 });
  });

  it("つかんで仕上がり確認へ落とすと、落とした場所へ置く", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByText("会社の外観"));
    moveTo(160, 90); // 枠の左上寄り＝動画の (480, 270)
    dropAt(160, 90);
    const c = useTimelineStore.getState().doc!.clips[0];
    // 箱の**中心**が落とした場所（1920x1080 の 1/4 の位置）。箱は画面いっぱいなので端で収められる。
    expect(c.kind).toBe(TIMELINE_CLIP_KIND.slot);
    expect(c.assetId).toBe("asset_001");
  });

  // #512 段1＝**直接置いた動画は絵が映る**（書き出しと同じ分割で `video` 要素を挟む）。
  // ⚠️ 音が入っていない動画には元の音の欄を出さず、その場で理由を出す（#512 段2・§2-5）。
  describe("動画の素材（#512 段1）", () => {
    /** @param opts.hasAudio 素材に音が入っているか（#512 段2 の門＝場面形式と同じ規準）。 */
    const withVideo = (opts: { hasAudio?: boolean; useOriginalAudio?: boolean; originalAudioVolume?: number } = {}) => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{
          assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4",
          ...(opts.hasAudio == null ? {} : { metadata: { hasAudio: opts.hasAudio } }),
        }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_v",
          ...(opts.useOriginalAudio ? { useOriginalAudio: true } : {}),
          ...(opts.originalAudioVolume == null ? {} : { originalAudioVolume: opts.originalAudioVolume }),
        }],
      });
      // ⚠️ **動画は本体の URL（`videoSrcById`）を見る**（`assetSrcById` は代表フレーム＝静止画）。
      // ここを取り違えると「穴だけ開いて何も映らない」＝レビューで見つかった 🔴 そのもの。
      act(() => {
        useTimelineStore.setState({
          assetSrcById: { asset_v: "blob:thumb_v" },
          videoSrcById: { asset_v: "blob:body_v" },
        });
      });
    };

    it("仕上がり確認に実映像（video 要素）が出る＝**本体**を指す（代表フレームではない）", () => {
      withVideo();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const v = container.querySelector(".preview-stage video") as HTMLVideoElement | null;
      expect(v).not.toBeNull();
      expect(v?.getAttribute("src")).toBe("blob:body_v"); // 静止画を指していたら穴が空くだけ
      expect(v?.muted).toBe(true); // 鳴らす設定にしていない動画は消音（#512 段2）
    });

    // ⚠️ **本体の URL が無ければ穴を開けない**（何も映らない窓を作るより、代表フレームのまま見せる）。
    it("本体の URL が無いときは実映像にしない（静止のまま）", () => {
      withVideo();
      act(() => { useTimelineStore.setState({ videoSrcById: {} }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull();
    });

    // ⚠️ **音の入っていない動画には、その場で理由を出す**（#512 段2・§2-5）＝欄だけ出して押せない、
    // でも黙って無反応でもなく、「音を付けるなら音の列へ」という次の行動を出す。
    it("音の入っていない動画では、元の音の欄を出さずに理由を出す", () => {
      withVideo({ hasAudio: false });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText(/この動画には音が入っていません/)).toBeInTheDocument();
      expect(screen.queryByText("この動画に入っている音を流す")).toBeNull();
    });

    // ⚠️ **既定は鳴らさない**（場面形式と同じ規準＝ADR-0026②）＝既に作った動画の音が黙って変わらない。
    it("音の入っている動画は欄が出るが、既定では鳴らさない", () => {
      withVideo({ hasAudio: true });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText("この動画に入っている音を流す")).toBeInTheDocument();
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
      expect((container.querySelector(".preview-stage video") as HTMLVideoElement | null)?.muted).toBe(true);
    });

    // ⚠️ **音が入っているか判らない素材には、断定しない**（レビュー 🟡・§2-5）＝取り込みで調べられて
    // いないだけかもしれないので、次の行動は「取り込み直す」（音の列に音を置く、ではない）。
    it("音が入っているか判らない動画には、断定せず取り込み直しを案内する", () => {
      withVideo(); // metadata 無し＝調べられていない
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText(/確かめられませんでした/)).toBeInTheDocument();
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
    });

    // ⚠️ **絵を出せないときも音は鳴らす**（レビュー 🟡・ADR-0001）＝絵を止める理由（合成の仕方が
    // 書き出しと違う）は音には当てはまらない。消すと「聞こえないのに書き出しには入る」になる。
    it("まとまり全体を薄くしている間も、元の音は鳴る（書き出しと一致）", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介", filePath: "v.mp4", metadata: { hasAudio: true } }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v", useOriginalAudio: true, originalAudioVolume: 0.6 },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 960, y: 0, w: 960, h: 540 },
        ],
        groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0.2 }, { timeSec: 5, opacity: 1 }] }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" } }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      // 絵の窓（枠の中の video）は出さない＝静止のまま。
      expect(container.querySelector(".preview-stage video")).toBeNull();
      // 音だけの要素が枠の外に居て、指定した音量で鳴る。
      const audible = container.querySelector(".preview-stage-wrap > video") as HTMLVideoElement | null;
      expect(audible).not.toBeNull();
      expect(audible!.muted).toBe(false);
      expect(audible!.volume).toBeCloseTo(0.6, 5);
    });

    // ⚠️ **鳴らす設定にしたら消音が外れ、音量も効く**＝聞こえたものが書き出しにも出る（ADR-0001）。
    it("鳴らす設定にすると消音が外れ、指定した音量が効く", () => {
      withVideo({ hasAudio: true, useOriginalAudio: true, originalAudioVolume: 0.8 });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const v = container.querySelector(".preview-stage video") as HTMLVideoElement | null;
      expect(v?.muted).toBe(false);
      expect(v?.volume).toBeCloseTo(0.8, 5);
    });

    // ⚠️ **合成の単位が跨るときは実映像を出さない**（`11 §7.6.4`）＝層ごとに薄さを掛けると
    // 重なった所で下が透け、書き出し（1枚にしてから掛ける）と別の絵になる。理由もその場に出す。
    it("まとまり全体を薄くしている間は実映像にせず、理由を出す", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4" }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v" },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 960, y: 0, w: 960, h: 540 },
        ],
        groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        // まとまり全体を薄くする動き（焼き出した自由配置の場面が持つ形）。
        animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0.2 }, { timeSec: 5, opacity: 1 }] }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" }, selectedClipIds: ["clip_001"] }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull(); // 実映像にしない
      expect(screen.getByText(/まとまり全体を薄くしている間/)).toBeInTheDocument(); // 理由を出す
    });

    // ⚠️ **回した部品を左右非対称に切り抜いているときも実映像を出さない**（`11 §7.6.4.1`）＝
    // 書き出しは矩形自身の中心、画面は部品の中心で回るので**別の窓**になる。理由もその場に出す。
    it("回した部品を切り抜いている間は実映像にせず、理由を出す", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v",
          rotation: 30, crop: { left: 0.5 }, // 左半分を落とす＝切り抜きの中心が箱の中心とずれる
        }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" }, selectedClipIds: ["clip_001"] }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull();
      expect(screen.getByText(/回した部品を切り抜いている間/)).toBeInTheDocument();
    });

    // ⚠️ 写真では出さない（動画のときだけ＝いつも出ていると読まれなくなる）。
    it("写真の部品では知らせない", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_p", assetType: "image", displayName: "写真", filePath: "p.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_p",
        }],
      });
      // ⚠️ **写真にも src を与える**＝与えないと「src が無いから出ない」で通ってしまい、
      // 種類の判定（動画かどうか）が壊れても落ちない（レビュー指摘）。
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_p: "blob:p" }, videoSrcById: { asset_p: "blob:p" } }); });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
      expect(document.querySelector(".preview-stage video")).toBeNull();
    });
  });

  // #714 項目2＝**見た目パターン・音・読み上げも掴んで運べる**（以前はボタンだけで、同じ画面の中で
  // 置き方の流儀が割れていた＝ADR-0026②）。落とし先・断り方は絵の部品と同じ道を通る。
  it("読み上げをつかんで音の列へ落とすと、その列のその時刻へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // 列を描かせる
    const lanes = container.querySelectorAll(".timeline-lane");
    // ⚠️ 列は**手前が上**＝`lanes[0]` は並びの後ろ（track_002＝音の列）。
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    grab(screen.getByRole("button", { name: "読み上げを置く" }));
    moveTo(380, 420); // 200 + 5×36 ＝ 5秒
    dropAt(380, 420);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.voice)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 5 });
  });

  // ⚠️ **この PR の本題**＝見た目パターンも掴んで運べる。掴む系のテストが音・読み上げだけだと、
  // 見出しの機能そのものが未検証のまま残る（レビュー指摘）。
  it("見た目パターンをつかんで落とすと、その時刻へ置く（置いた所へ再生位置も動く）", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "よこ型テンプレ", category: "photo_intro",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
      } as Template],
    });
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列（手前が上）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    grab(screen.getByText("よこ型テンプレ"));
    moveTo(560, 460); // 200 + 10×36 ＝ 10秒
    dropAt(560, 460);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.template)!;
    expect(placed).toMatchObject({ trackId: "track_001", startSec: 10 });
    // **置いた瞬間に見える**（`06 §12.1`）＝運んだ先へ再生位置も動く（絵の部品と同じ）。
    expect(useTimelineStore.getState().playheadSec).toBe(10);
  });

  it("音（曲）をつかんで落とすと、その時刻へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列（手前が上）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    grab(screen.getByText("曲")); // 素材の音（一覧の名前で掴む）
    moveTo(272, 420); // 200 + 2×36 ＝ 2秒
    dropAt(272, 420);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.audio)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 2, assetId: "asset_002" });
  });

  // ⚠️ **列の種別違いは断る**＝音を絵の列へ落としても置かない（理由を出す）。
  it("音を絵の列へ落としたら置かない（理由を出す）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByText("曲"));
    moveTo(380, 460); // 絵の列の上
    dropAt(380, 460);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
    // ⚠️ **理由まで見る**（レビュー指摘）＝件数だけだと「落とし先の外だった（何も起きない）」と
    // 見分けが付かず、断りを出さなくなる変異も素通りする。
    expect(screen.getByText(/音の部品は音の列に/)).toBeInTheDocument();
  });

  // ⚠️ **仕上がり確認へ落とせるのは絵の部品だけ**＝音・読み上げは動画の中の場所を持たない。
  // 落とし先の外と同じ扱い＝**何も置かない**（勝手に再生位置へ置かない）。
  it("音を仕上がり確認へ落としても置かない（場所を持たない部品）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByText("曲"));
    moveTo(160, 90);
    dropAt(160, 90);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
  });

  // ⚠️ **動かさずに離したら、ボタンと同じ結果**（掴めるようにしても押すだけの道を壊さない・決定19）。
  it("読み上げを押しただけ（動かさず離す）なら、欄の列と再生位置へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    grab(screen.getByRole("button", { name: "読み上げを置く" }));
    dropAt(0, 0); // 動かしていない
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.voice)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 0 });
  });

  it("置けない所で離したら置かない（寄せない）＋理由を出す", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_003", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // track_003 へ1つ
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // track_003
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // track_001（固定）
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 460);
    dropAt(840, 460);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before); // 置かない
    expect(screen.getByText(/この列は固定されています/)).toBeInTheDocument(); // 離したときに理由
  });

  it("落とし先の外で離したら何もしない（黙って再生位置へ置かない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(2000, 2000);
    dropAt(2000, 2000);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });

  it("「出さない」列へは落とせない（置いても動画に出ない部品を黙って作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual, hidden: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // 見えている列へ1つ
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 手前＝track_003（出さない）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 奥＝track_001
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 420);
    dropAt(840, 420);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
    expect(screen.getByText(/「出さない」設定なので/)).toBeInTheDocument();
  });

  it("スクロールで欄の外へ出ている列へは落とせない（見えていない所へ入らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    const lane = container.querySelectorAll(".timeline-lane")[0];
    stubRect(lane, { left: 200, top: 400, width: 800, height: 40 });
    // 列を囲う箱が中身を切っていて、列はその外（＝画面では見えていない）。
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    scroll.style.overflow = "auto";
    stubRect(scroll, { left: 200, top: 1000, width: 800, height: 40 });
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 420);
    expect(container.querySelector(".timeline-drop-preview")).toBeNull(); // 落とし先として出さない
    dropAt(840, 420);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before); // 置かない
  });

  it("列の上では「どこに・何秒ぶん」入るかを実寸で出す（落とす前に結果が分かる）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 420); // 5秒（段の既定 36 px/秒）
    const preview = container.querySelector(".timeline-drop-preview") as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.style.left).toBe(`${36 * 5}px`);
    expect(preview.style.width).toBe(`${36 * 5}px`); // 置かれる長さ（5秒ぶん）
    dropAt(380, 420);
    expect(container.querySelector(".timeline-drop-preview")).toBeNull(); // 離したら消える
  });

  it("置いた所へ再生位置が動く（置いたのに何も見えない、を作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 420); // 5秒（段の既定 36 px/秒）
    dropAt(380, 420);
    expect(useTimelineStore.getState().playheadSec).toBe(5);
  });

  it("読み込み中から開けた後も、つかんで置ける（フックの数が回ごとに変わらない）", () => {
    // 早期 return（読み込み中）を通る回と通らない回でフックの数が変われば、React が状態を取り違える。
    // 同じ画面を張ったまま状態を切り替えて、続けて操作できることを見る。
    useTimelineStore.setState({ doc: null, loadError: null, isLoading: true });
    const { container, rerender } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を開いています/)).toBeInTheDocument();
    withAsset(); // 開けた
    rerender(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(300, 180);
    expect(container.querySelector(".drag-ghost")).not.toBeNull();
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("掴めるものは、手を出す前に分かる（欄の見出し・帯と同じ見た目）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字を置く" })).toHaveClass("grabbable");
    expect(screen.getByText("会社の外観")).toHaveClass("grabbable");
  });

  it("落とし先の外では、置けない色にしない（赤の意味を薄めない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(2000, 2000); // 落とし先の外
    expect(container.querySelector(".drag-ghost")?.className).not.toContain("blocked");
  });

  it("Escape で運ぶのをやめられる（掴んだまま戻れない、を作らない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(300, 180);
    expect(container.querySelector(".drag-ghost")).not.toBeNull(); // 運んでいる影が出ている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".drag-ghost")).toBeNull();
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0); // 置かれない
  });

  it("押しただけ（動かさずに離す）でも置ける＝運べない人の逃げ道", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    dropAt(0, 0); // 動かしていないので、離した場所は関係ない
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("キーボードでも置ける（ドラッグ専用の操作を作らない・決定19）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // キーボードで起こした `click` は押した回数が 0（マウスは 1 以上）。
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("運んで置いたあと、マウスの click が来ても二重に置かない", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    moveTo(300, 180);
    dropAt(300, 180);
    fireEvent.click(btn, { detail: 1 }); // 掴んだ指がボタンの上へ戻って離れた場合に来る
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("Escape で中止した直後に click が来ても置かない", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    moveTo(300, 180);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(btn, { detail: 1 }); // 中止しても、指を離せば click は来る
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
  });

  it("運んで置いた次も、押す・キーボードのどちらでも置ける（1回効かない、を作らない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const btn = screen.getByRole("button", { name: "文字を置く" });
    // 運んで仕上がり確認へ落とす＝ボタンの上では離していないので `click` は来ない。
    grab(btn);
    moveTo(300, 180);
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    grab(btn); dropAt(0, 0); // 押しただけ
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    fireEvent.click(btn, { detail: 0 }); // キーボード
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(3);
  });

  it("間の空きを飛び越さない（いちばん後ろの部品の終わりへ飛ばさない・#684 レビュー）", () => {
    // [0,3) と [10,15)。5秒ぶんは [3,10) の空きに収まるので、そこへ置く（15 ではない）。
    withAsset({
      clips: [
        { id: "clip_001", trackId: "track_001", kind: TIMELINE_CLIP_KIND.text, startSec: 0, durationSec: 3, text: "あ" },
        { id: "clip_002", trackId: "track_001", kind: TIMELINE_CLIP_KIND.text, startSec: 10, durationSec: 5, text: "い" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips).toHaveLength(3);
    expect(clips[2]).toMatchObject({ startSec: 3, durationSec: 5 });
  });

  it("置ける列が固定・非表示だけなら置かない（動画に出ない部品を黙って作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
  });

  it("隠した列は置き先に選ばない（見えている列へ置く）", () => {
    withAsset({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },          // 奥・見えている
        { id: "track_003", kind: TRACK_KIND.visual, hidden: true }, // 手前だが隠してある
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 手前から探すが、隠した列は飛ばす（置いても動画に出ないため）。
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_001");
  });
});

// 中身を直す欄の関門と履歴（#720）。共有部品は props を受け取れなければ**黙って捨てる**ので、
// 「渡している」ことではなく「効いている」ことを画面ごしに固定する。
describe("TimelineProjectScreen: 中身を直す欄（#720）", () => {
  const withText = () => {
    open();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const withShape = () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 400, h: 300, fillColor: "#ff0000" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("書き出しの最中は色を触れない（押してから断らない）", () => {
    withText();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字の色" })).toBeDisabled();
    // 理由も一緒に届いていること（押せないのに理由が無い＝なぜ触れないか分からない）。
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", "いま動画を書き出しています。終わってから編集してください");
    expect(screen.getByText("この部品の文字の形").parentElement?.querySelector("button")).toBeDisabled();
  });

  it("枠への収め方も、書き出しの最中は触れない", () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50 }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const fit = [...document.querySelectorAll("select")].find((el) => el.querySelector('option[value="cover"]'));
    expect(fit).toBeDisabled();
  });

  it("固定した列の部品は色を触れない（動かせないのに中身は変えられる、を作らない）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字の色" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", lockedTrackMessage("content"));
  });

  // 図形の色は**別の JSX 箇所**に同じ3行を書いている（共有関数の中身ではない）ので、
  // 文字の色のテストでは「図形側だけ落ちた」退行を拾えない＝同じ観点をこちらにも置く。
  it("図形の色も、書き出しの最中は触れない", () => {
    withShape();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "図形の色" })).toBeDisabled();
  });

  it("図形の色も、ひと撫での取り消しは1回ぶん", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "図形の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    for (const x of [20, 30, 40, 50, 60]) fireEvent.pointerMove(sv, { pointerId: 1, buttons: 1, clientX: x, clientY: 90 });
    fireEvent.pointerUp(sv, { pointerId: 1, clientX: 60, clientY: 90 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("**色の面を撫でている間も倍率を変えられない**（合図が1つで配線が切れていない・#752-2）", () => {
    // ⚠️ 部品どうしの配線を見る＝`ColorPicker` が「掴んでいる」に入れる側と、`changeZoom` が
    // それを読む側は別々に固めてあるが、この画面でつながっているかは**ここでしか分からない**。
    withShape();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 幅で測る（この部品は0秒に置かれるので `left` は倍率で変わらない）。
    const bandWidth = () => (container.querySelectorAll(".timeline-clip")[0] as HTMLElement).style.width;
    const before = bandWidth();
    fireEvent.click(screen.getByRole("button", { name: "図形の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(bandWidth()).toBe(before); // 撫でている間は効かない
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 90 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(bandWidth()).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("開いている最中に書き出しが始まったら、色の面ごと閉じる（#730 レビュー）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // キーボードで開く（`Enter`＝`detail:0` の click）。**外側の pointerdown が起きない**ので、
    // 外側クリックで閉じる仕掛けは働かない。
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    expect(screen.getByTestId("cp-sv")).toBeInTheDocument();
    // 同じくキーボードで「動画を書き出す」を押した、に相当する状態変化。
    act(() => {
      useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    });
    // 開いたままだと、面・色相バー・パレット・色コード欄は触れてしまい（`disabled` は見本のボタンにしか
    // 効かない）、撫でるとピッカーの見た目だけ追従して部品は変わらず、あとから断り文が出る。
    expect(screen.queryByTestId("cp-sv")).not.toBeInTheDocument();
  });

  it("フォントの一覧も、開いている最中に書き出しが始まったら閉じる（同概念同挙動）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const trigger = screen.getByText("この部品の文字の形").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(trigger);
    expect(screen.getByText("怪盗予告ゴシック")).toBeInTheDocument(); // 一覧が開いている
    act(() => {
      useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    });
    expect(screen.queryByText("怪盗予告ゴシック")).not.toBeInTheDocument();
  });

  it("色の面をひと撫でしても取り消しは1回ぶん（履歴を流し切らない）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    // 面のドラッグは `pointermove` ごとに値が返る。区切りが無いと1回ごとに履歴が積まれる。
    for (const x of [20, 30, 40, 50, 60]) fireEvent.pointerMove(sv, { pointerId: 1, buttons: 1, clientX: x, clientY: 90 });
    fireEvent.pointerUp(sv, { pointerId: 1, clientX: 60, clientY: 90 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect((useTimelineStore.getState().doc?.clips[0].color ?? "").toLowerCase()).not.toBe("");
  });
});

// キーボードと、開始秒・長さの数値欄（#721・ADR-0034 決定18/決定6）。
// **どの入口からでも同じ結果**になることを画面ごしに固定する（キーだけ関門を素通りする、を作らない）。
describe("TimelineProjectScreen: キーと数値で触れる（#721）", () => {
  const one = () =>
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
  const key = (k: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key: k, ...init });
  // ⚠️ `parentElement` で辿ると**行**に当たり、隣の欄の input を掴む（開始と長さは同じ行に並ぶ）。
  // ラベル要素そのものを基準にする（`NumberField` は `<label>` が input を包む）。
  const field = (name: string) =>
    (screen.getByText(name).closest("label") as HTMLElement).querySelector("input") as HTMLInputElement;

  it("Space で再生・停止する（押した要素が Space で反応するときは譲る）", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key(" ");
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    key(" ");
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    // ボタンにフォーカスがあるときは奪わない（消えたうえに再生が始まる、を作らない）。
    fireEvent.keyDown(screen.getByRole("button", { name: "先頭へ" }), { key: " " });
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("←→ で1フレームずつ、Shift で1秒ずつ動く", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5);
    key("ArrowRight", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 + 1 / 30, 5);
    key("ArrowLeft", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5);
    // 先頭より前へは行かない（尺の外に位置を作らない）。
    key("ArrowLeft", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("セレクトに手がかかっているときは矢印を奪わない（その欄の値が変わらず位置だけ動く、を作らない）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「選んだ部品」の欄の「載っている列」（#819-3 で置く側の「置く列」と名前を分けた）。
    const panel = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    const select = within(panel).getByLabelText("載っている列");
    fireEvent.keyDown(select, { key: "ArrowRight" });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("Delete で消す（1つなら即時・取り消しで戻る）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
    act(() => { useTimelineStore.getState().undo(); });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 取り消しで戻る
  });

  it("Delete でまとめて消すときも確認を通す（キーだけ確認なし、を作らない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
  });

  it("確認を出している間は、キーで背後を触らせない（答えたのに何も起きない、を作らない）", () => {
    // ⚠️ 3つ置く＝2つだと `Ctrl+A` が通っても選択数が変わらず、**関門の位置を確かめられない**。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "う" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(screen.getByText("選んだ2個の部品を削除しますか？")).toBeInTheDocument();
    // 確認は答えるまで残る。ここで背後の選択が解けると、「削除する」を押しても**何も消えない**。
    key("Escape");
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(2);
    // 再生位置も動かさない（答えを求めている最中に別の操作を通さない）。
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    // **全選択も通さない**＝通ると「2個」と聞いて全部消える（関門は `Ctrl+A` より前に無いといけない）。
    key("a", { ctrlKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_003"]);
  });

  it("色の面など、開いているものがある間もキーで背後を触らせない", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 色の面は自分で `Escape` を受け持つ（名乗る）だけで、画面の `overlayOpen` には出ない。
    // 材料を `Escape` と揃えていないと、開いたまま `Delete` で背後の部品が消える。
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("確認は**聞いた相手**を消す（出したまま選び直しても、聞いた数と消える数がずれない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "う" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(screen.getByText("選んだ2個の部品を削除しますか？")).toBeInTheDocument();
    // この確認は覆いではなく知らせの段なので、背後の選択は**プログラム上は**変えられる
    //（帯を押す・別の入口から選び直す）。数だけ持っていると「2個」と聞いて1個/3個が消える。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_003"] }); });
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_003"]);
  });

  it("長さを入れ直しても、欄に17桁が出ない（引き算の残差を残さない）", () => {
    // 開始秒が端数のクリップ（つかんで置く・「再生位置へ」で普通に起きる）。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0.32, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const len = field("長さ（秒）");
    fireEvent.change(len, { target: { value: "2" } });
    fireEvent.blur(len);
    // `(0.32 + 2) - 0.32 = 1.9999999999999998` がそのまま欄に出ていた（#561 が消したはずの症状）。
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(2);
  });

  it("**箱を持つ部品を1つ選んでいる間は、矢印で少しだけ動かす**（決定18・#752-9）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().playheadSec;
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(1); // 1px 動く
    key("ArrowDown", { shiftKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].y).toBe(10); // Shift は 10px
    expect(useTimelineStore.getState().playheadSec).toBe(before); // 再生位置は動かさない
    // ⚠️ **逆向きも見る**（#752 レビュー）＝正の向きだけ固定すると、左と上の符号を取り違えても
    // 誰も気づかない（4方向のうち2方向が「テストの外」になる）。
    key("ArrowLeft");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0);
    key("ArrowUp", { shiftKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].y).toBe(0);
  });

  it("**まとめて選んでいるときも一緒に動かす**（個数で意味を変えない・#752 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 40, y: 20, w: 100, h: 50, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight", { shiftKey: true });
    const cs = useTimelineStore.getState().doc!.clips;
    expect(cs[0].x).toBe(10);
    expect(cs[1].x).toBe(50); // 相対の位置は崩れない
  });

  it("箱を持たない相手が混ざっていても、箱を持つものだけ動かす（#752 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "い", status: NARRATION_STATUS.none } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(1);
    // ⚠️ **混ざっていた相手に箱を生やさない**（読み上げに位置は無い＝保存も通らない）。
    expect(useTimelineStore.getState().doc!.clips[1]).not.toHaveProperty("x");
  });

  it("**選んでいても見えていなければ奪わない**（画面が変わらないのに文書だけ動く、を作らない・#752 レビュー）", () => {
    // ⚠️ 再生位置の外にある部品はキャンバスに出ていない＝動かしても**どこも変わらない**。
    // そのまま自動保存されるので、あとから見ると理由の分からないずれになる。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0 }); // 部品は 5秒から＝いま出ていない
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 動かさない
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は送る
  });

  it("**押し続けても取り消しは1回ぶん**（履歴の上限を数秒で流し切らない・#752 レビュー）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    for (let i = 0; i < 8; i++) key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(8); // 8px 動く
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 取り消しは1つ
  });

  it("選んでいないときは矢印で再生位置を送る（文脈で分かれる・#752-9）", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 部品は動かない
  });

  it("**動かせない部品では矢印を奪わない**（行き止まりを作らない・#752-9）", () => {
    // ⚠️ 固定した列の部品を選んだまま奪うと、部品も動かず再生位置も送れない。
    // ⚠️ **部品はキャンバスに出ている状態にする**（`startSec: 0`・#759 レビュー）＝出ていないと
    // その時点で対象から外れ、**固定の判定まで届かない**（テストの名前と、実際に通る道が食い違う）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0);
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は動く
  });

  it("箱を持たない部品（読み上げ・音）では矢印を奪わない（#752-9）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 1, durationSec: 5, voice: { text: "あ", status: NARRATION_STATUS.none } }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
  });

  it("断る理由は**画面の内側だけ**で使う（描画結果に出さない・#752-3 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const del = screen.getByRole("button", { name: "削除" });
    // ⚠️ 押せない理由の**組**をそのままボタンへ流すと、内部の合図が属性として描かれる
    //（React は知らない小文字の属性を素通しする＝§2-3 の「技術用語を出さない」に触れる）。
    expect(del.getAttribute("reason")).toBeNull();
  });

  it("Delete も固定した列の部品は消せない（ボタンと同じ関門を通る）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    // ⚠️ **キーには理由を出す**（#752-3）。以前はここで「断り文は出ない」を固定していたが、
    // それはボタンの説明が見えている前提の書き方だった＝**キーを押した人はボタンを指していない**。
    // 分ける `Ctrl+K` は理由を立てるのに消すだけ黙る、という非対称も消える（ADR-0026②）。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
    expect(screen.getByText(/固定を外すか、選び直してください/)).toBeInTheDocument();
    // 理由はボタンの側にも、押す前から出ている（押せないことも一緒に見る）。
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" }).getAttribute("title")).toContain("固定を外すか");
  });

  it("開始・長さを数値で揃えられる（ボタンだけでは「3.0秒から」に合わせられない）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const start = field("開始（秒）");
    fireEvent.change(start, { target: { value: "3" } });
    fireEvent.blur(start);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(3);
    const len = field("長さ（秒）");
    fireEvent.change(len, { target: { value: "2" } });
    fireEvent.blur(len);
    // 長さは**終わりの端**を動かす＝始まりは動かない。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ startSec: 3, durationSec: 2 });
  });

  it("数値欄も固定した列では触れない", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(field("開始（秒）")).toBeDisabled();
    expect(field("長さ（秒）")).toBeDisabled();
  });
});

// 案内の指す先が実在するか（#723・ADR-0034 決定5）。**文言の中で名指ししたものが、この画面にある**ことを固定する。
// 文言だけ直しても、指す先が消えれば元の行き止まりへ戻る＝両方を1つのテストで見る。
describe("TimelineProjectScreen: 案内が行き止まりでない（#723）", () => {
  it("音が見つからないときの案内が指す「鳴らす音」の欄が実在する", () => {
    open({
      assets: [],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("「鳴らす音」で選び直す"))).toBe(true);
    expect(screen.getByText("鳴らす音")).toBeInTheDocument(); // 指した先が同じ画面にある
  });

  it("鳴らす音を選び直せる（同梱BGM と、この動画が持っている音）", () => {
    open({
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing", volume: 0.5 }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("鳴らす音").closest("label")?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "asset:asset_001" } });
    // 消して置き直すのと違い、**音量などの設定は残る**（この欄がある理由）。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ assetId: "asset_001", volume: 0.5 });
    // ⚠️ **曲の名前は画面で使う言い方**（#802-2）＝目録は「`label`/`note` は選択UI・`title`/`artist` は
    // クレジット専用」と定めており、置く欄・帯の名前も `label`。ここだけ原題に戻ると**同じ物が
    // 画面内で別の名**になる（ADR-0026②）ので、先祖返りを止める。
    expect(select.textContent).toContain(BGM_CATALOG[0].label);
    expect(select.textContent).not.toContain(BGM_CATALOG[0].title);
  });

  it("音が見つからない部品では、別の曲が選ばれているように見せない（#734 レビュー）", () => {
    open({
      assets: [],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("鳴らす音").closest("label")?.querySelector("select") as HTMLSelectElement;
    // ⚠️ `value` に合う `option` が無いと、ブラウザは**先頭の候補を選択済みに見せる**＝
    // 「見つかりません」と警告しているのに、欄では別の曲が入っているように読める（§2-5）。
    expect(select.selectedOptions[0]?.textContent).toContain("見つかりません");
    expect(select.value).toBe("asset:asset_missing"); // いまの値が保たれている（別の音に化けない）
  });

  it("何も置いていないときの案内が指すボタンが実在する", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/「文字を置く」を押すと再生位置へ置けます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字を置く" })).toBeInTheDocument();
  });

  it("置ける列が無いときの案内は、固定だけでなく非表示も言う（絞り込みが両方を除いている）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio, hidden: true }],
      clips: [],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「固定を外してください」だけだと、言われたとおりにしても直らない。
    for (const el of screen.getAllByText(/置ける.*列がありません/)) {
      expect(el.textContent).toContain("固定・非表示");
    }
  });
});

// 置く先の見せ方（#724）。**欄に出ている列＝実際に置く列**で、既定はどの種別も「いちばん手前」。
describe("TimelineProjectScreen: どこへ置くかを見せる（#724）", () => {
  // 見た目パターンの欄は「置ける見た目パターンが1つもない」と列の欄ごと出ないので、1つ用意する。
  const aTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_001", name: "見本", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
    defaults: { durationSec: 5 },
  } as unknown as Template;
  const twoEach = () => {
    useProjectStore.setState({ templates: [aTemplate] });
    return open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual }, // 奥
        { id: "track_002", kind: TRACK_KIND.visual }, // 手前
        { id: "track_003", kind: TRACK_KIND.audio },  // 奥
        { id: "track_004", kind: TRACK_KIND.audio },  // 手前
      ],
      clips: [],
    });
  };
  const placeSelect = (panelId: string) =>
    (document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement)
      .querySelector("select") as HTMLSelectElement;

  it("音・読み上げにも「置く列」が出る（無言で1本に固定しない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(placeSelect("audio")).not.toBeNull();
    expect(placeSelect("voice")).not.toBeNull();
  });

  it("既定はどの種別も**いちばん手前**の置ける列（種別で割らない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 手前＝配列の末尾（`11 §7.6` の重ね順）。奥を既定にすると、手前の部品の裏に隠れる（#722 と同じ理由）。
    expect(placeSelect("audio").value).toBe("track_004");
    expect(placeSelect("templates").value).toBe("track_002");
  });

  it("見た目パターンの「置く列」が空欄で固まらない（どこへ入るか読めない、を作らない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(placeSelect("templates").value).not.toBe("");
  });

  it("読み上げは選んだ列へ置く（欄に出ている列＝実際の置き先）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(placeSelect("voice"), { target: { value: "track_003" } });
    fireEvent.click(screen.getByRole("button", { name: "読み上げを置く" }));
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_003");
  });

  it("音量とフェードは読み上げにも出る（点は置けるのに基準は直せない、を作らない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「音量」は節の見出しと入力欄の両方にあるので、**入力欄がある**ことで見る。
    expect(screen.getAllByText("音量").some((el) => el.closest("label")?.querySelector("input"))).toBe(true);
    expect(screen.getByText("だんだん大きく（秒）")).toBeInTheDocument();
    // 素材の話（速さ・使い始め）は出さない＝声の長さは実尺で合わせてあるので、変えると区間とずれる。
    expect(screen.queryByText("速さ（倍）")).not.toBeInTheDocument();
    expect(screen.queryByText("素材の使い始め（秒）")).not.toBeInTheDocument();
  });
});

// フォントの継承（#731）。`null` = 動画全体に合わせる、を**画面が表せる**ことを固定する。
describe("TimelineProjectScreen: フォントは動画全体に合わせられる（#731）", () => {
  const textClip = (over: Record<string, unknown> = {}) => {
    open({
      videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: "kaitou-yokoku-gothic" },
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ", ...over }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const trigger = () => screen.getByText("この部品の文字の形").closest("label")?.querySelector("button") as HTMLElement;
  // ⚠️ 引き金のボタンも継承中は同じ文字を出すので、**一覧の中の項目**に絞る（`li` の中にある方）。
  const inheritOption = () =>
    screen.getAllByText("動画全体に合わせる").find((el) => el.closest("li"))?.closest("button") as HTMLElement;

  it("指定が無いときは「動画全体に合わせる」と出す（既定の字体名を現在値に見せない）", () => {
    textClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 動画全体は「怪盗予告ゴシック」なので、既定の字体名を出すと**表示と実際が食い違う**。
    expect(trigger().textContent).toContain("動画全体に合わせる");
  });

  it("選んだあと「動画全体に合わせる」へ戻せる（戻したらキーごと落ちる）", () => {
    textClip({ fontId: "gen-interface-jp-display" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(trigger());
    fireEvent.click(inheritOption());
    expect("fontId" in useTimelineStore.getState().doc!.clips[0]).toBe(false);
  });

  it("すでに「動画全体に合わせる」のときに選び直しても、取り消しは増えない（空振りしない）", () => {
    textClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(trigger());
    fireEvent.click(inheritOption());
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });
});

// 素材の実寸を測る回数（#724）。効果が**自分の出力**（`assetSizes`）を依存に持つと、1件測れるたびに
// 未計測の全素材を作り直す＝素材 N 件で最悪 O(N²)。「一度始めたものは二度始めない」を固定する。
describe("TimelineProjectScreen: 実寸は素材1つにつき一度だけ測る（#724）", () => {
  const originalImage = window.Image;
  afterEach(() => { window.Image = originalImage; });

  /** 生成された偽 `Image` を集める（`onload` は手で発火させる）。 */
  function stubImage(): { made: { src: string; fire: () => void }[] } {
    const made: { src: string; fire: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 100, naturalHeight: 50, onload: null, onerror: null };
      const rec = { src: "", fire: () => el.onload?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    return { made };
  }

  const withAssets = (n: number) => {
    const assets = Array.from({ length: n }, (_, i) => ({
      assetId: `asset_${String(i + 1).padStart(3, "0")}`,
      assetType: "image" as const,
      displayName: `写真${i + 1}`,
      filePath: `assets/a${i}.png`,
    }));
    open({ assets, clips: [] });
    useTimelineStore.setState({
      assetSrcById: Object.fromEntries(assets.map((a) => [a.assetId, `blob:${a.assetId}`])),
      assetSizes: {},
    });
    return assets;
  };

  it("素材の数だけ測る（1件測れるたびに全部作り直さない）", () => {
    const { made } = stubImage();
    withAssets(4);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(made).toHaveLength(4);
    // 1件ずつ着地させる。印を持たず「済みかどうか」だけで判定していると、依存に自分の出力が入っている
    // 版では**未計測ぶんが毎回作り直される**（4件なら 4→3→2→1 で合計10個）。
    act(() => { made[0].fire(); });
    act(() => { made[1].fire(); });
    act(() => { made[2].fire(); });
    act(() => { made[3].fire(); });
    expect(made).toHaveLength(4);
    expect(Object.keys(useTimelineStore.getState().assetSizes)).toHaveLength(4);
  });

  it("**測り終わっていない素材があるまま**別の素材が増えても、測り直さない（#724 レビュー）", () => {
    // ⚠️ ここが「印」の本当の役目。済みの判定（`assetSizes`）だけでは**まだ着地していない素材**を
    // 弾けないので、効果が別の理由（素材の追加）で走り直すと、その素材ぶんを作り直してしまう。
    const { made } = stubImage();
    withAssets(2);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); }); // asset_001 だけ着地。asset_002 は測っている最中。
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_003: "blob:asset_003" },
      });
    });
    // 増えたぶんの1つだけ（asset_002 を作り直さない）。
    expect(made).toHaveLength(3);
    expect(made[2].src).toBe("blob:asset_003");
    // 着地していなかったぶんも、後から着地すれば入る（途中で無効化しない）。
    act(() => { made[1].fire(); });
    expect(Object.keys(useTimelineStore.getState().assetSizes).sort()).toEqual(["asset_001", "asset_002"]);
  });

  it("素材が増えたら、その1つだけ測る（既に測ったものを測り直さない）", () => {
    const { made } = stubImage();
    withAssets(2);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); made[1].fire(); });
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_003: "blob:asset_003" },
      });
    });
    expect(made).toHaveLength(3);
    expect(made[2].src).toBe("blob:asset_003");
  });

  it("読めたのに大きさが取れなかったものも、印を残さない（失敗と同じ扱い）", () => {
    const made: { src: string; fire: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null }; // 0×0＝測れていない
      const rec = { src: "", fire: () => el.onload?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); }); // `onload` は来たが 0×0＝入れられない
    expect(useTimelineStore.getState().assetSizes).toEqual({});
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_002: "blob:asset_002" },
      });
    });
    // 印が残っていると asset_001 は二度と測られない（＝「枠いっぱいに映す」が黙って効かなくなる）。
    expect(made.map((m) => m.src)).toEqual(["blob:asset_001", "blob:asset_001", "blob:asset_002"]);
  });

  it("**同じ動画を開き直しても**測り直す（印を残して二度と測らない、を作らない）", () => {
    const { made } = stubImage();
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); });
    // 開き直すと `assetSizes` は空へ戻る。「始めた」を覚える作りだと**同じ動画では印が残り**、
    // 二度と測らない＝「枠いっぱいに映す」が黙って効かなくなる（素材の実寸が要るため）。
    act(() => {
      useTimelineStore.setState({ assetSizes: {}, assetSrcById: { asset_001: "blob:asset_001_reopened" } });
    });
    expect(made).toHaveLength(2);
    expect(made[1].src).toBe("blob:asset_001_reopened");
  });

  it("測れなかった素材は、次に効果が走ったときもう一度試す（一度の失敗を永久に固定しない）", () => {
    const made: { src: string; fireError: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
      const rec = { src: "", fireError: () => el.onerror?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fireError(); });
    // ⚠️ 取り込み直しでは救えない（取り込みは毎回**新しい素材番号**を出すので別のキーになる）。
    // 救えるのは「別の素材が増えた／画面へ戻った」で効果が走り直したとき。
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_002: "blob:asset_002" },
      });
    });
    // 増えたぶん（asset_002）＋失敗した asset_001 の測り直しで2つ増える。
    expect(made.map((m) => m.src)).toEqual(["blob:asset_001", "blob:asset_001", "blob:asset_002"]);
  });
});

// 帯の作法（#701）＝右クリックのメニューと、種類ごとの色。列の行と**同じ作法**に揃える（ADR-0026②）。
describe("TimelineProjectScreen: 帯の作法（#701）", () => {
  const mixed = () =>
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "文字" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, shapeType: "rect" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "こえ", status: "none" } },
      ],
    });
  const clipEl = (name: string) => screen.getByRole("button", { name }).className;

  it("帯の色は**部品の種類ごと**（列の種類だけで決めない）", () => {
    mixed();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 文字と図形は同じ列（映像）だが、種類が違うので色も違う＝並びを見て何が置いてあるか読める。
    expect(clipEl("文字")).toContain("timeline-clip--telop");
    expect(clipEl("図形")).toContain("timeline-clip--shape");
    expect(clipEl("こえ")).toContain("timeline-clip--audio");
  });

  it("帯を右クリックすると操作のメニューが出る（列の行と同じ）", () => {
    mixed();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    expect(screen.getByRole("menuitem", { name: "複製" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();
  });

  it("「⋮」からも同じメニューが出る（右クリックが使えない人の逃げ道）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字の操作" }));
    expect(screen.getByRole("menuitem", { name: "複製" })).toBeInTheDocument();
  });

  it("「⋮」は**選んだ帯にだけ**出す（隣の帯の当たり判定を常時食わない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 全部の帯に出すと、複製した帯（前の終わりから置かれる＝必ず隣接）の左端を覆い、
    // **狙っていない帯が選ばれて消える**。最後の帯では列の枠の外にも出る。
    expect(screen.getByRole("button", { name: "文字の操作" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "図形の操作" })).not.toBeInTheDocument();
  });

  it("「⋮」は帯の**内側**に置く（外に出すと隣を覆う・枠の外へ出る）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const left = (screen.getByRole("button", { name: "文字の操作" }) as HTMLElement).style.left;
    expect(left).toContain("- var(--clip-menu-w)"); // 帯の終わりから幅ぶん内側へ
  });

  it("列の名前の欄の幅は**両方のタイムライン画面が同じ値**を流し込む（#742 レビュー）", () => {
    // ⚠️ 片方だけ CSS の既定に頼ると、値を変えたときに**見た目だけ黙ってずれる**
    //（全体表示と錨点の計算はこの値を引くので、計算と描画が食い違う）。
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const timeline = container.querySelector(".timeline") as HTMLElement;
    expect(timeline.style.getPropertyValue("--timeline-label-w")).toBe(`${TIMELINE_LABEL_W_PX}px`);
  });

  it("`--clip-menu-w` は**「⋮」から見える所**で宣言する（帯で宣言すると届かない）", () => {
    // ⚠️ カスタムプロパティは**子孫にしか継承しない**。「⋮」は帯の兄弟なので、帯（`.timeline-clip`）で
    // 宣言すると `var()` が解決できず `left`/`width` の宣言ごと無効になり、**帯の左端に出る**
    // （実機で確認＝computed left が 0px・幅が内容幅の 3.86px になっていた）。
    // jsdom は CSS ファイルを読まないので、**宣言している側の階級**をここで固定する。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const laneBlock = css.slice(css.indexOf(".timeline-lane {"), css.indexOf("}", css.indexOf(".timeline-lane {")));
    expect(laneBlock).toContain("--clip-menu-w");
    // 帯そのもので宣言し直すと、また届かなくなる。
    const clipStart = css.indexOf(["", ".timeline-clip {"].join(String.fromCharCode(10)));
    const clipBlock = css.slice(clipStart, css.indexOf("}", clipStart));
    expect(clipBlock).not.toContain("--clip-menu-w");
  });

  it("**列を足すのは「並び」の欄の中**（欄の外を探しに行かせない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const arrange = [...container.querySelectorAll("section,div")].find(
      (el) => el.querySelector(".timeline") != null && (el.textContent || "").includes("映像の列を足す"),
    );
    expect(arrange).toBeTruthy(); // 並びの一覧と同じ入れ物の中にある
    // ⚠️ **同じ操作を2か所に置かない**（`06 §2`）＝画面下部の同じボタンは残さない。
    expect(screen.getAllByRole("button", { name: "映像の列を足す" })).toHaveLength(1);
  });

  it("**列を中身ごと複製できる**（空の列だけ増やすなら「足す」と同じ・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 目盛りの行にも**名前の空欄**があるので、名前の付いた行だけを採る（空欄を掴んでも何も起きない）。
    const labels = [...container.querySelectorAll(".timeline-row-label")].filter((el) => (el.textContent || "").trim() !== "") as HTMLElement[];
    const label = labels[labels.length - 1];
    fireEvent.contextMenu(label);
    fireEvent.click(screen.getByText("この列を中身ごと複製"));
    const st = useTimelineStore.getState().doc!;
    expect(st.tracks).toHaveLength(3); // 1本増える
    expect(st.clips).toHaveLength(4); // 中身も増える（元の2つ＋複製の2つ）
  });

  it("**掴んで並べ替えられる**（帯は掴めるのに列だけメニューだけ、を作らない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 目盛りの行を数に入れない（名前の付いた行だけが列）。表示は**手前が上**＝上から track_002・track_001。
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[1].querySelector(".timeline-row-label") as HTMLElement; // 奥（track_001）を掴む
    pointerDownAt(label, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 }); // いちばん上へ
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    // 上＝手前＝配列の後ろ。track_001 が手前へ来る。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_002", "track_001"]);
  });

  it("**下向きに運んでも、線を引いた所へ入る**（1つずれない・#767 レビュー 🔴）", () => {
    // ⚠️ 落とし先を「行」で持つと、線は「その行の上」を指すのに確定は**抜いた後の位置**として効くので、
    // **下向きだけ1つ余計に下がる**（重ね順＝絵そのものなので、見せた線と違う絵が黙って確定する）。
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 表示は上から track_003・track_002・track_001（後ろほど手前）。
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // いちばん上（track_003）を掴んで、**2行目（track_002）の上半分**で離す＝線は「track_002 の上」。
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 55 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 55 });
    // 線の位置＝track_002 の上＝いまと同じ並び（track_003 は既に track_002 の上）。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002", "track_003"]);
  });

  it("下向きに**いちばん下まで**運ぶと最背面へ入る（#767）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement; // track_003
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 115 }); // 最下行の下半分
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 115 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  // #771(c)：**すき間 → 入れる位置**の計算は場面カード・台本表の行と同じ1か所（`insertIndexForGap`）。
  // ⚠️ 列の並べ替えは「落ちない／固定は動かない」しか見ておらず、**実際にどこへ入るか**が
  // 無検査だった＝共有だけしても、こちら側が壊れても気づけない。
  // ⚠️ #802-3＝**列の並べ替えにも端送りと可視域丸めを入れた**（置く・運ぶ・並べ替えと同じ部品）。
  // 丸めが無いと、欄からはみ出した位置で**見えていない列のすき間**に線が決まり、そこで確定してしまう。
  it("欄の外へ指がはみ出しても、見えている範囲で並べ替え先を決める", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // 列を並べている器（欄）は 0〜100 しか見えていない＝3行目（80〜120）は下半分が隠れている。
    const body = rows[0].closest(`.${PANEL_BODY_CLASS}`) as HTMLElement | null;
    if (body) {
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 70, width: 900, height: 70, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
    const grip = rows[0].querySelector('[aria-label*="順番"], .grabbable') ?? rows[0];
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 0, clientY: 500 }); // 欄のずっと下
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0, clientY: 500 });
    // 見えているのは 0〜70＝3行目（80〜120）は隠れている。丸めれば「見えている最後のすき間」で決まり、
    // 丸めなければ**画面外のすき間**（最背面）まで飛ぶ＝結果が別物になる。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(['track_001', 'track_003', 'track_002']);
  });

  // ⚠️ #802-3＝**列の並べ替えの端送りが実際に走り、離したら止まる**（配線の検査）。
  // 速さの規則（domain）と時計まわり（フック）は別に見ているが、**この画面が繋いだか**は無検査だった
  // ＝`track`/`stop` の呼び忘れや欄の取り違えがあっても、どのテストも赤くならない。
  it("欄の下端まで運ぶと送りが走り、離すと止まる", () => {
    const rafQueue: Array<(t: number) => void> = [];
    const realRaf = globalThis.requestAnimationFrame;
    const realCancel = globalThis.cancelAnimationFrame;
    const realPerf = globalThis.performance;
    let nowMs = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { rafQueue.length = 0; });
    vi.stubGlobal("performance", { now: () => nowMs });
    const tick = (ms: number) => {
      nowMs += ms;
      const run = [...rafQueue];
      rafQueue.length = 0;
      run.forEach((cb) => cb(nowMs));
    };
    try {
      open({
        tracks: [
          { id: "track_001", kind: TRACK_KIND.visual },
          { id: "track_002", kind: TRACK_KIND.visual },
          { id: "track_003", kind: TRACK_KIND.visual },
        ],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
        .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
      rows.forEach((row, i) => {
        row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
      });
      const body = rows[0].closest(`.${PANEL_BODY_CLASS}`) as HTMLElement;
      expect(body).not.toBeNull(); // 欄が見つからなければ送り先が無い＝この検査自体が空振りする
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 200, width: 900, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(body, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(body, "scrollHeight", { value: 1000, configurable: true });
      let top = 0; // jsdom は実寸を持たない＝送り先を自前で持たせる
      Object.defineProperty(body, "scrollTop", { get: () => top, set: (v: number) => { top = v; }, configurable: true });

      const grip = rows[0].querySelector('[aria-label*="順番"], .grabbable') ?? rows[0];
      fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 100, clientY: 195 }); // 下端の帯
      tick(100);
      expect(body.scrollTop).toBeGreaterThan(0); // 走っている

      fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 195 });
      const stopped = body.scrollTop;
      tick(100);
      expect(body.scrollTop).toBe(stopped); // 離したら止まる（掴んでいないのに送り続けない）
    } finally {
      vi.stubGlobal("requestAnimationFrame", realRaf);
      vi.stubGlobal("cancelAnimationFrame", realCancel);
      vi.stubGlobal("performance", realPerf);
    }
  });

  it("掴んで並べ替えると、線を出したすき間へ入る（列は手前が上＝並びは裏返る）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // 行は**手前が上**＝上から track_003 / track_002 / track_001。いちばん上（track_003）を掴んで
    // いちばん下のすき間（3行目の下半分＝表示上のすき間3）へ落とす＝並びのいちばん奥へ。
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 115 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 115 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  // #771(c) の本題：**同じすき間なら、どちらから来ても同じ結果**（列でも）。
  it("反対の向きから同じすき間へ運んでも、同じ並びになる（1つズレを作らない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rowsOf = () => {
      const rs = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
        .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
      rs.forEach((row, i) => {
        row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
      });
      return rs;
    };
    // 行は**手前が上**＝上から 003 / 002 / 001。
    // ① いちばん上（003）を「2行目の下半分」＝002 と 001 の間へ運ぶ。
    let rows = rowsOf();
    pointerDownAt(rows[0].querySelector(".timeline-row-label") as HTMLElement, 1000, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 75 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 75 });
    // 表示は 002 / 003 / 001 ＝並びは裏返して [001, 003, 002]。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_003", "track_002"]);

    // ② いちばん下（001）を「1行目の下半分」＝002 と 003 の間へ運ぶ＝**反対の向き**から同じ考え方。
    rows = rowsOf();
    pointerDownAt(rows[2].querySelector(".timeline-row-label") as HTMLElement, 9000, { clientX: 10, clientY: 90 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 35 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 35 });
    // 表示は 002 / 001 / 003 ＝並びは [003, 001, 002]。指した2つの間に入っている。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  it("**固定した列は掴んで並べ替えられない**（消せないのと揃える・#767 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[1].querySelector(".timeline-row-label") as HTMLElement; // 固定した track_001
    pointerDownAt(label, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]); // 動かない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED"); // 理由を出す
  });

  it("「⋮」を押して動かしても列は並べ替わらない（入れ子の掴み口・#767 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const dots = rows[1].querySelector(".timeline-row-label button") as HTMLElement;
    pointerDownAt(dots, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]);
  });

  it("並べ替えは**少し動かすまで起きない**（押しただけで順番が変わらない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const label = [...container.querySelectorAll(".timeline-row-label")].find((el) => (el.textContent || "").trim() !== "") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 }); // 動かさず離す
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]);
  });

  it("「⋮」は**右の取っ手を避けて**置く（覆うと右端だけ掴めない）", () => {
    // ⚠️ 実機で確認＝「⋮」は帯の兄弟で `z-index` が上なので、帯の右端に置くと取っ手を丸ごと覆い、
    // 右端の中心で最前面に来るのが `timeline-clip-menu` になっていた（左端は掴めるので**左右非対称**）。
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const left = (screen.getByRole("button", { name: "文字の操作" }) as HTMLElement).style.left;
    // ⚠️ **避ける幅は、取っ手が実際に取っている幅と同じもの**を見る（#752-7）。
    // 見た目の幅を書き写すと、当たり判定を広げたときに**「⋮」が取っ手を覆う**（#742/#743 の裏返し）。
    // どちらを見ているかは CSS から引く＝書き写しをテスト側でも作らない。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const handleStart = css.indexOf(".timeline-clip-handle {");
    const handleBlock = css.slice(handleStart, css.indexOf("}", handleStart));
    const widthVar = /width:\s*var\((--[\w-]+)\)/.exec(handleBlock)?.[1];
    expect(widthVar).toBeTruthy();
    expect(left).toContain(`- var(--clip-menu-w) - var(${widthVar})`);
  });

  it("CSS の既定は**TS の値と一致する**（片方だけ変えて黙ってずれない・#752 レビュー）", () => {
    // ⚠️ 流し込みは必ず行われるので既定は普通は使われないが、**書き写しである以上ずれ得る**。
    // ずれると、この file を単独で読んだときの見え方と計算が食い違う（`--timeline-label-w` と同じ流儀）。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const decl = (name: string): string | undefined => new RegExp(`${name}:([^;]+);`).exec(css)?.[1].trim();
    expect(decl("--timeline-label-w")).toBe(`${TIMELINE_LABEL_W_PX}px`);
    expect(decl("--clip-menu-w")).toBe(`${CLIP_MENU_W_PX}px`);
    expect(decl("--clip-handle-w")).toBe(`${CLIP_HANDLE_W_PX}px`);
    expect(decl("--clip-handle-hit-w")).toBe(`${CLIP_HANDLE_HIT_W_PX}px`);
  });

  it("取っ手の**当たり判定は見た目より広い**（指が乗る前に本体を掴まない・#752-7）", () => {
    // 型＝「見た目の2倍以上」。見た目は擬似要素で外側の端に出すので、**太く見せずに**掴みやすくする。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const laneBlock = css.slice(css.indexOf(".timeline-lane {"), css.indexOf("}", css.indexOf(".timeline-lane {")));
    const px = (name: string): number => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(laneBlock)?.[1]);
    expect(px("--clip-handle-hit-w")).toBeGreaterThanOrEqual(px("--clip-handle-w") * 2);
    // 見た目の帯は擬似要素で描く＝本体（当たり判定）そのものを塗ると太く見える。
    expect(css).toContain(".timeline-clip--selected .timeline-clip-handle::after");
  });

  it("置けないときの赤は**選択の青に勝つ**（同じ強さだと後に載る青が残る）", () => {
    // ⚠️ 実機で確認＝`.drop-target--blocked`（theme.css）と `.timeline-clip--selected`（timeline.css）は
    // どちらも1クラスで、timeline.css が後に載るので**青のまま**だった。掴んだ帯は必ず選ばれているので、
    // 「置けない」の赤は**一度も出ていなかった**（決定10 のゴーストの色が丸ごと効いていない）。
    // class 名しか見ないテストは緑で通るので、ここでは**重なり順を実際に解く**。
    const cssOf = (f: string) => readFileSync(resolve(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // 載る順（`App.tsx` の import 順）。後に載るほど強い＝同じ強さなら後勝ち。
    const sheets = [cssOf("../../styles/theme.css"), cssOf("../components/timeline.css")];
    const cls = new Set(["timeline-clip", "timeline-clip--selected", "drop-target--blocked"]);
    /** その選択子が「選ばれていて置けない帯」に当たるか＋強さ（クラスの数）。 */
    const match = (sel: string): number | null => {
      const t = sel.trim();
      const parts = t.split(".").filter(Boolean);
      if (!t.startsWith(".") || parts.some((c) => !cls.has(c))) return null;
      return parts.length;
    };
    let best: { rank: number; color: string } | null = null;
    sheets.forEach((css, sheet) => {
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const spec = match(m[1]);
        const decl = /outline(?:-color)?:[^;]*var\(--color-([a-z]+)\)/.exec(m[2]);
        if (spec == null || !decl) continue;
        const rank = spec * 1000 + sheet; // 強さ → 同じなら後に載った方
        if (!best || rank >= best.rank) best = { rank, color: decl[1] };
      }
    });
    expect(best).not.toBeNull();
    expect(best!.color).toBe("danger");
  });

  it("細い帯では端の取っ手を出さない（本体を掴む所が無くなる）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 0.5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 0.5秒 × 36 px/秒 = 18px。取っ手2つ（14px）と「⋮」（14px）で本体が消える。
    expect(container.querySelectorAll(".timeline-clip-handle").length).toBe(0);
  });

  it("まとめて選んでいるときは「複製」を押せなくする（押しても無反応、を作らない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    // 複製は「選択がちょうど1件」でないと store が何もせず、理由も持たない＝黙って効かない。
    const dup = screen.getByRole("menuitem", { name: "複製" });
    expect(dup.hasAttribute("disabled") || dup.getAttribute("aria-disabled") === "true").toBe(true);
    expect(dup.getAttribute("title")).toContain("1つだけ選ぶと");
  });

  it("右クリックした帯が選ばれる（別の部品に効かせない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_003"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    // 選ばずに開くと、メニューの項目が**別の部品**（読み上げ）に効いてしまう。
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("まとめて選んでいる中の1つを右クリックしても、選択は保つ（まとめて消せる）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
    expect(screen.getByRole("menuitem", { name: "選んだ2個を削除" })).toBeInTheDocument();
  });

  it("固定した列の帯では、消す・複製を押せなくして理由を出す", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "文字" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    const del = screen.getByRole("menuitem", { name: "削除" });
    expect(del.hasAttribute("disabled") || del.getAttribute("aria-disabled") === "true").toBe(true);
    expect(del.getAttribute("title")).toContain("固定");
    // 固定の理由は「選んだ部品」の欄と**同じ言い方**にする（同じ状態を場所で言い分けない）。
    const dup = screen.getByRole("menuitem", { name: "複製" });
    expect(dup.getAttribute("title")).toBe(lockedTrackMessage("content"));
  });
});

// 表示倍率・目盛りのシーク・再生位置の線（#686 段階2・ADR-0034 決定13）。
describe("TimelineProjectScreen: 拡大縮小と時間の目盛り（#686）", () => {
  const withClip = (durationSec = 5) =>
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec, x: 0, y: 0, w: 10, h: 10, text: "あ" }] });
  const lane = (c: HTMLElement) => c.querySelector(".timeline-lane") as HTMLElement;

  it("広げる・縮める・全体を表示 が出ている", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "表示を広げる" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示を縮める" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全体を表示" })).toBeInTheDocument();
  });

  it("広げると帯も目盛りも同じだけ伸びる（段は場面形式と同じ型）", () => {
    withClip();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (screen.getByRole("button", { name: "あ" }) as HTMLElement).style.width;
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    const after = (screen.getByRole("button", { name: "あ" }) as HTMLElement).style.width;
    // 36 → 54（段の次）＝5秒の帯は 180px → 270px。
    expect(before).toBe("180px");
    expect(after).toBe("270px");
    expect(lane(container).style.width).toBe("640px"); // 列は下限（640px）まで縮まない
  });

  it("端では押せなくする（押せるのに何も起きない、を作らない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    expect(screen.getByRole("button", { name: "表示を広げる" })).toBeDisabled();
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を縮める" }));
    expect(screen.getByRole("button", { name: "表示を縮める" })).toBeDisabled();
  });

  it("目盛りを押すとその時刻へ再生位置が動く（列で受けると帯の選択と取り合う）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    ruler.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 24, right: 900, bottom: 24, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(ruler, { clientX: 100 + 36 * 4 }); // 4秒の所（段の既定 36 px/秒）
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(4, 5);
  });

  it("目盛りにフォーカスがあるとき ←→ が効く（両方が手を引いて無反応、を作らない）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    // ⚠️ 画面のキー操作は「矢印を使う要素」（`role="slider"` を含む）に譲るので、目盛り側が
    // 受けないと**どちらも動かず**、既定の横スクロールだけが起きる。
    fireEvent.keyDown(ruler, { key: "ArrowRight" });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5); // 画面と同じフレーム送り
    fireEvent.keyDown(ruler, { key: "ArrowRight", shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 + 1 / 30, 5); // Shift で1秒
  });

  it("目盛りの間隔は**倍率**で決める（縮めても文字が重ならない）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const gapAt = () => {
      const ticks = [...container.querySelectorAll(".timeline-tick")] as HTMLElement[];
      return parseFloat(ticks[1].style.left) - parseFloat(ticks[0].style.left);
    };
    // 尺で決めていると、縮めたときに間隔が px で潰れる（16px 間隔に「0秒/1秒/…」が並ぶ）。
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を縮める" }));
    expect(gapAt()).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    expect(gapAt()).toBeLessThanOrEqual(600);
  });

  it("自分で倍率を変えたあとは、部品を置いても勝手に戻さない", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 幅を差し込む＝jsdom は `clientWidth` が 0 なので、そのままだと**自動の合わせ自体が走らず**
    // このテストが何も見ないことになる（実際に変異が生き残った）。
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    const clip = () => (screen.queryByRole("button", { name: "テキスト" }) as HTMLElement | null)?.style.width;
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 36 → 54 → 80。5秒の帯は 400px。全体表示へ飛ぶと 5秒×120（幅に収まる最大段）＝600px になる。
    expect(clip()).toBe("400px");
  });

  it("まだ触っていなければ、幅が測れた時点で全体表示に合わせる", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 5秒・幅 900-84=816 → 全部入る最大段は 120。5×120＝600px。
    expect((screen.getByRole("button", { name: "テキスト" }) as HTMLElement).style.width).toBe("600px");
  });

  it("目盛りは位置を持つ操作として読み上げに伝わる（Home/End で端へ）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    expect(ruler.getAttribute("role")).toBe("slider");
    expect(ruler.getAttribute("aria-valuemax")).toBe("20");
    fireEvent.keyDown(ruler, { key: "End" });
    expect(useTimelineStore.getState().playheadSec).toBe(20);
    fireEvent.keyDown(ruler, { key: "Home" });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  // ⚠️ **掴んだまま動かせる**（#819-1・ADR-0034 決定1）＝再生ヘッドには掴み手の三角を描いておきながら、
  // 押した所へ跳ぶだけで**追従しなかった**（掴める合図を出して掴めない）。作法は帯・欄と同じもの。
  describe("目盛りを掴んで動かす（#819-1）", () => {
    const rulerOf = (container: HTMLElement): HTMLElement => {
      const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
      // jsdom は実レイアウトを持たないので、目盛りの左端を 0 として測れるようにする。
      ruler.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 24, right: 1000, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      return ruler;
    };

    it("押したまま動かすと、再生位置が指に追いてくる", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      // ⚠️ **押した瞬間から追いてくる**（遊びを作らない）＝つまみを掴む操作なので、
      // 帯を運ぶときのような「少し動かすまで掴まない」余白があると**動かないように見える**。
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 2, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 36, clientY: 0 }); // 36px＝1秒
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1, 6);
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 180, clientY: 0 }); // 5秒
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(5, 6);
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    it("Escape でやめると、掴む前の位置へ戻る（帯の移動と同じ）", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.getState().setPlayhead(3); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 108, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(10, 6);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6); // 掴む前へ
    });

    // ⚠️ **やめた後に離しても上書きされない**（PR #827 レビュー 🟡）＝`pointerdown` の
    // `preventDefault` は `click` を止めないので、印を見ないと**離した位置で書き戻される**
    //（`Escape` が効かなかったことになる）。帯のドラッグと同じ印を見る。
    it("Escape でやめた後、時間が経ってから指を離しても戻した位置のまま", async () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.getState().setPlayhead(3); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 108, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      fireEvent.keyDown(window, { key: "Escape" });
      // ⚠️ **実機の順序を再現する**（#833-1）＝`Escape` は**指を離す前**に走るので、やめてから離すまでには
      // 必ず時間が経つ。ここを飛ばして `Escape` の直後に同期で `click` を撃つと、**印を `setTimeout(0)`
      // で自分から落とす実装でも緑になる**＝実機でだけ壊れているのを見逃す（それが #833-1 で起きたこと。
      // PR #827 で直したはずの壊れ方が、テストに守られないまま残っていた）。
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      // ここで実際にボタンを離す＝ブラウザは同じ要素に `click` を出す。
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 360, clientY: 0 });
      fireEvent.click(ruler, { clientX: 360, clientY: 0, detail: 1 }); // 指の経路
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6);
    });

    // ⚠️ **掴んでいる間に横スクロールされてもずれない**（レビュー ℹ️）＝枠は掴んだ時点で1度だけ
    // 測るので、送られたぶんを足さないと指と線が離れる（帯のドラッグと同じ補正）。
    it("掴んでいる間に横スクロールされても、指の下の時刻を指す", () => {
      withClip(60);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      scroll.scrollLeft = 360; // 掴んだまま 10秒ぶん送られる
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 36, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(11, 6); // 送りぶん＋1秒
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    // ⚠️ **再生中は「掴ませない」ではなく「掴んだら止まる」**（#833-2・ADR-0032 決定21）＝
    // 決定21 が再生中に押させないと定めるのは**位置を使う**操作（「ここで分ける」等＝走っていると
    // 同じ操作の結果が毎回変わる）。目盛りは位置を**決める**側で結果は一意なので、決定21 の
    // 「押せるが、押した時点で再生は止まる」に当たる。以前は掴む処理だけを止めており、
    // **掴める合図（`ew-resize`）は出たまま線は追いてこず、離した瞬間に `onClick` がそこへ跳ばす**
    // ＝#819 が直したはずの「掴める合図を出して掴めない」が再生中だけ残っていた。
    it("再生中に掴むと再生が止まり、そのまま線が追いてくる", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true }); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      expect(useTimelineStore.getState().isPlaying).toBe(false); // 掴んだ時点で止まる
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(10, 6); // 追いてくる（掴めない、を作らない）
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    // ⚠️ **掴むのは左ボタンだけ**（差分再監査② ℹ️3・PR #854 レビュー ℹ️）＝同じ関門を「再生位置」の
    // 欄と目盛りの2か所に置いたが、留めていたのは欄だけだった。**同じ一行でも、片方だけ落ちれば
    // 機械には見えない**。
    // ⚠️ **2つの `expect` は別の関門を留めている**（変異チェックで確認）＝**止まらないこと**は
    // この画面の関門（`e.button !== 0`）、**動かないこと**は掴む作法の単一の参照元
    //（`usePointerDrag` の左ボタン限定）。線を動かす側は元から共有側で弾かれているので、
    // この画面の関門が実際に足しているのは**止めないこと**だけ。両方見るのは、
    // 「右クリックでは何も起きない」を画面の側から通しで留めるため。
    it("右クリックでは止まらず、線も動かない（掴んだことにしない）", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true, playheadSec: 3 }); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 2, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().isPlaying).toBe(true); // 走ったまま
      fireEvent.pointerMove(window, { buttons: 2, pointerId: 1, clientX: 720, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6); // 追いてこない
    });

    // ⚠️ **戻す先は store のいまの値**（レビュー 🟡）＝再生中は描画時の `playheadSec` が1コマぶん古いので、
    // クロージャの値で覚えると `Escape` が「掴む前」ではなく**1コマ前**へ戻す。ここでは再帰描画を挟まずに
    // store だけを進めて（＝描画時の値と store の値をわざとずらして）、戻り先が store 側であることを見る。
    it("再生中に掴んだときの戻し先は、描画時の値ではなくそのときの位置", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true }); });
      const ruler = rulerOf(container);
      // 描き直しを挟まずに位置だけ進める＝この時点で「描画時の値」と store の値がずれる。
      useTimelineStore.setState({ playheadSec: 7 });
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 252, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 540, clientY: 0 });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(7, 6); // ずれた側ではなく、掴んだ時点の位置
    });

    // ⚠️ **掴んで枠の外へ運んだら送る**（#833-3）＝帯のドラッグは `autoScroll` を通すのに目盛りだけ
    // 通しておらず、**枠の外まで運んでも送りが無い**＝見えない所へ置いて離すことになっていた
    //（同じ画面の掴む操作で流儀が割れていた＝ADR-0026②）。入口は帯と同じ `useEdgeAutoScroll`。
    it("掴んだまま端まで運ぶと送りが走り、離すと止まる", () => {
      const frames: Array<(t: number) => void> = [];
      vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
      vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
      try {
        withClip(60);
        const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
        const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
        // jsdom は実寸を持たないので、**送れる枠**として必要な値だけ差し込む。
        Object.defineProperty(scroll, "clientWidth", { value: 600, configurable: true });
        Object.defineProperty(scroll, "scrollWidth", { value: 3000, configurable: true });
        // ⚠️ jsdom は**貼り付いた要素の `scrollLeft` を動かさない**（常に 0 を返す）ので、
        // そのままだと「送っても値が変わらない」＝配線し忘れても症状が出ず**通るだけのテスト**になる。
        let sl = 0;
        Object.defineProperty(scroll, "scrollLeft", { get: () => sl, set: (v: number) => { sl = v; }, configurable: true });
        scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const ruler = rulerOf(container);
        fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 10 });
        fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 590, clientY: 10 }); // 右端の送る帯へ
        expect(frames.length).toBeGreaterThan(0); // 送りが走っている
        act(() => { frames.splice(0).forEach((cb) => cb(1000)); });
        act(() => { frames.splice(0).forEach((cb) => cb(2000)); }); // （1フレーム目は dt=0 になりうる）
        expect(scroll.scrollLeft).toBeGreaterThan(0); // 実際に送られた＝見えない所へ置かせない
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 590, clientY: 10 });
        const after = scroll.scrollLeft;
        act(() => { frames.splice(0).forEach((cb) => cb(3000)); });
        expect(scroll.scrollLeft).toBe(after); // 離したら止まる（rAF が回り続けない）
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // ⚠️ **再生に合わせて見える範囲を送る**（#819-1）＝送らないと、ヘッドが枠の外へ出た時点で
  // **いま何が出ているのかが画面から消える**（倍率を上げるほど早く外れる）。
  it("再生中にヘッドが枠の外へ出たら、見える範囲を送る", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    act(() => { useTimelineStore.getState().setPlayhead(5); }); // 5秒＝180px（まだ見えている）
    expect(scroll.scrollLeft).toBe(0);
    act(() => { useTimelineStore.getState().setPlayhead(20); }); // 720px＝枠の外
    expect(scroll.scrollLeft).toBe(720); // ヘッドが左端に来るよう送る
    act(() => { useTimelineStore.setState({ isPlaying: false }); });
  });

  // ⚠️ **境界は「誰が動かしたか」**（#833-3）＝位置が変わっただけ（外から・取り消しなど）では送らない。
  // 送るのは**利用者がその操作で位置を動かしたとき**だけ（下の2件）＝「勝手に画面が動かない」は保つ。
  it("止まっている間、位置が変わっただけでは送らない（勝手に画面が動かない）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.getState().setPlayhead(20) ; });
    expect(scroll.scrollLeft).toBe(0);
  });

  // ⚠️ **止まっていても、利用者が位置を動かしたら追う**（#833-3）＝以前は送りが**再生中だけ**だったので、
  // 止まっている間に `End`・`Shift+→` で枠の外へ出すと**線を見失ったまま**だった。「勝手に動かない」は
  // 利用者が**枠**を動かしたときの話であって、利用者が**位置**を動かしたときは追うのが正しい。
  it("止まっていても、`End` で枠の外へ動かしたら送る", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    fireEvent.keyDown(container.querySelector(".timeline-ruler") as HTMLElement, { key: "End" });
    expect(useTimelineStore.getState().playheadSec).toBe(60);
    // 60秒＝2160px。見えている幅は 500−84（列の名前の欄）＝416px なので、行き止まりまで送る。
    expect(scroll.scrollLeft).toBe(2160 - (500 - 84));
  });

  // ⚠️ **`End` と対称に固定する**（レビュー 🟡）＝同じ形（`setPlayhead` の直後に追う）なのに
  // `Home` だけテストが無いと、片方を外しても緑のまま通る（実際に変異が素通りした）。
  it("止まっていても、`Home` で先頭へ戻したら見えるところまで送り返す", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    fireEvent.keyDown(ruler, { key: "End" });    // まず末尾側へ送る
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    fireEvent.keyDown(ruler, { key: "Home" });   // 先頭へ戻す
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    expect(scroll.scrollLeft).toBe(0); // 先頭が見えるところまで戻る（線を見失わない）
  });

  // ⚠️ **同じ動作は入口で割れない**（#833-3 レビュー 🟡・ADR-0026②）＝「先頭へ」ボタンは `Home` キーと
  // 同じ動作なのに、追う／追わないが入口で分かれていた（キーは追い、ボタンは追わない）。
  // 「この位置へ」（キーフレーム／音量点）も同じ＝跳んだ先が枠の外だと**跳んだのに何も見えない**。
  it("「先頭へ」ボタンでも送り返す（`Home` キーと同じ動作で割れない）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    fireEvent.keyDown(container.querySelector(".timeline-ruler") as HTMLElement, { key: "End" });
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "先頭へ" }));
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    expect(scroll.scrollLeft).toBe(0);
  });

  it("止まっていても、`Shift`+矢印で枠の外へ出たら送る（画面のキー操作も同じ入口）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.getState().setPlayhead(11); }); // 396px＝まだ見えている（416px まで）
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); // 1秒進む＝432px＝枠の外
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(12, 6);
    expect(scroll.scrollLeft).toBe(12 * 36); // ヘッドが左端に来るよう送る
  });

  // ⚠️ **時刻の書き方は1つにそろえる**（#819-3・§6）＝同じ画面の帯のツールチップと見わたす画面が
  // `m:ss` なのに、目盛りだけ「N秒」だった（同じ時刻が2通りに読める）。
  // ⚠️ **動く量が画面から分かる**（#819-3）＝名前だけでは 0.5秒 刻みだと分からず、押してみるまで
  // 結果が読めない（数値の欄と併用する前提の操作なので、量が要る）。
  it("「前へ／後ろへ」は動く量を添える", () => {
    withClip(20);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "前へ" }).getAttribute("title")).toContain("0.5秒");
    expect(screen.getByRole("button", { name: "後ろへ" }).getAttribute("title")).toContain("0.5秒");
  });

  it("目盛りの時刻は、帯のツールチップと同じ書き方（m:ss）", () => {
    withClip(120);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ticks = [...container.querySelectorAll(".timeline-tick")].map((e) => e.textContent);
    expect(ticks[0]).toBe("0:00");
    expect(ticks).toContain(clockLabel(60)); // 1:00
    expect(ticks.some((t) => t?.endsWith("秒"))).toBe(false);
  });

  it("目盛りの名前は「再生位置」の欄と分ける（同じ名前の操作を2つ作らない）", () => {
    withClip();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((container.querySelector(".timeline-ruler") as HTMLElement).getAttribute("aria-label")).toBe("時間の目盛り");
    expect(screen.getByLabelText("再生位置")).toBeInTheDocument(); // 既存の欄は1つのまま
  });

  it("再生位置の線が並びの上に出る（いま何が出ているか分かる）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().setPlayhead(5); });
    const head = container.querySelector(".timeline-playhead") as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.style.left).toBe("calc(var(--timeline-label-w) + 180px)"); // 5秒 × 36
  });

  it("何も置いていないときは線を出さない（指す先が無い）", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".timeline-playhead")).toBeNull();
  });
});

// 帯を掴んで動かす・端を縮める（#686 段階2・ADR-0034 決定9/10）。
describe("TimelineProjectScreen: 帯を掴む（#686）", () => {
  const two = (over: Record<string, unknown> = {}) =>
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      ...over,
    });
  const band = (name: string) => screen.getByRole("button", { name });
  /** 掴んで動かす（px）。しきい値を越えるように十分動かす。 */
  const drag = (el: HTMLElement, dx: number, opts: { drop?: boolean; escape?: boolean } = {}) => {
    pointerDownAt(el, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    if (opts.escape) { fireEvent.keyDown(window, { key: "Escape" }); return; }
    if (opts.drop !== false) fireEvent.pointerUp(window, { pointerId: 1, clientX: dx, clientY: 0 });
  };

  it("本体を掴んで動かすと、その時刻へ移る", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8); // 段の既定 36 px/秒 → 8秒ぶん右へ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(8, 5);
  });

  it("何度動かしても**取り消しは1回ぶん**（動かした回数だけ積まない・#752-12）", () => {
    // ⚠️ 影は毎回の動きで描き替わるが、文書を書き換えるのは離したときの1回だけ。
    // ここが崩れると、ひと運びで履歴上限を流し切って「戻したかった直前の誤操作」が追い出される。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    for (const dx of [36, 108, 216, 288, 360]) fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before); // 動かしている間は積まない
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 360, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 5回動かしても1つ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(10, 5);
  });

  it("端を縮めるときも**取り消しは1回ぶん**（#752-12）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 端の取っ手は選んだ帯にだけ出る
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    pointerDownAt(handle, 1, { clientX: 0, clientY: 0 });
    for (const dx of [-18, -36, -54]) fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -54, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(1.5, 5);
  });

  it("重なる所へ落としても**寄せずに元のまま**＋離したときに理由を出す（決定10）", async () => {
    // ⚠️ 黙って戻すと「勝手に戻った」としか見えない。同じ画面の「つかんで置く」（#684）と作法を揃える。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4); // 2つ目（5秒〜）に重なる所まで運ぶ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 寄せない＝元のまま
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap); // 理由は出す
    expect(screen.getByRole("alert").textContent).toContain("列を足して"); // 次の行動が読める
  });

  it("掴んでいる間は置けないことを見た目で示す（離すまで待たせない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4, { drop: false });
    expect(band("あ").className).toContain("drop-target--blocked");
    expect(band("あ").className).toContain("timeline-clip--dragging");
  });

  it("書き出し中は**掴めない**（離してから断らない）", () => {
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **離した後に見ても分からない**（掴めていても離せば印は消えるし、`commit` が断るので
    // どちらでも動かない）。**掴んでいる最中**を見る＝掴む処理そのものが始まらないこと。
    drag(band("あ"), 36 * 8, { drop: false });
    expect(band("あ").className).not.toContain("timeline-clip--dragging");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
  });

  it("**まとめて選んでいると一緒に動く**（#686 段階4・決定15）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    drag(band("あ"), 36 * 10); // 10秒ぶん右へ
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    // 掴んでいない相手にも**同じだけ**効く（群の形を崩さない）。
    expect(after[0] - before[0]).toBeCloseTo(10, 5);
    expect(after[1] - before[1]).toBeCloseTo(10, 5);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]); // 選択は保つ
  });

  it("まとめて動かす間、**一緒に動く相手とは重ならない**（赤いのに置ける、を作らない）", () => {
    // ⚠️ 掴んだ相手だけで見ると、**一緒に動く隣**と重なる判定になって赤くなるのに、
    // 離すと（正しく）置ける＝見えている色と結果が割れる（実機で踏んだ）。
    two(); // clip_001=[0,3) / clip_002=[5,8)
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // +4秒＝clip_001 は 4〜7秒（元の clip_002 と重なる位置）だが、clip_002 も 9〜12秒へ動く。
    drag(band("あ"), 36 * 4, { drop: false });
    expect(band("あ").className).not.toContain("drop-target--blocked");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 4, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.startSec)).toEqual([4, 9]);
  });

  it("0秒の壁で**群ごと止まる**（先頭だけ張り付いて間隔が消えない）", () => {
    // ⚠️ 帯ごとに 0 で切ると、先頭側だけ 0 に張り付いて**間隔が消える**（別の列どうしなら
    // 成功として確定してしまう）。群のいちばん早い帯が 0 に着いたら、そこで群ごと止まる。
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }], clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_005", startSec: 10, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **後ろの帯を掴む**（先頭を掴むと `at()` の 0 クランプだけで同じ結果になり、群で丸めているか
    // 区別できない＝実際にそれで変異が生き残った）。
    drag(band("い"), -36 * 15); // 15秒ぶん左へ（群の先頭は 2秒しかない）
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    expect(after[0]).toBe(0);
    expect(after[1]).toBe(8); // 8秒の間隔が保たれる（10 - 2）
  });

  it("連動している字幕は**掴んでいる間から読み上げに付いてくる**（離した瞬間に飛ばない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_003"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const subLeft = () => (([...container.querySelectorAll(".timeline-clip")]
      .find((el) => el.textContent?.includes("字幕")) as HTMLElement | undefined)?.style.left);
    const before = subLeft();
    drag(band("あ"), 36 * 5, { drop: false }); // 読み上げを掴んで5秒ぶん右へ
    // ⚠️ 据え置いて見せると、離した瞬間に字幕だけ飛ぶ（確定は `withBoundSubtitles` が動かす）。
    expect(subLeft()).not.toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 5, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.startSec).toBeCloseTo(5, 5);
  });

  it("**動かない字幕**は 0秒の壁の計算に数えない（群が左へ動けなくならない）", () => {
    // ⚠️ 連動している字幕は**連動先の読み上げが群に居るときだけ**動く。居ない字幕の位置を
    // 床に数えると、それが 0秒に居るだけで**群ぜんぶが左へ動けなくなる**（断り文も出ない）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "こえ", status: "none" } },
        // 連動先（clip_001）は**選ばない**＝この字幕は動かない。
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002", "clip_003"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), -36 * 15); // 15秒ぶん左へ（20秒に居るので動ける）
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips.find((c) => c.id === "clip_003")!.startSec).toBeCloseTo(5, 5);
    expect(clips.find((c) => c.id === "clip_002")!.startSec).toBe(0); // 字幕は据え置き
  });

  it("まとめて動かして1つでも置けなければ**全体を動かさない**（全か無か）", () => {
    two({ clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "う" },
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // +15秒＝clip_002 が clip_003（20〜23秒）と重なる。clip_001 は空いているが**動かさない**。
    drag(band("あ"), 36 * 15);
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    expect(after).toEqual([0, 5, 20]);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it("掴んだ直後の `click` で選び直さない（理由が消える・Shift で選択が外れる）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4); // 重なる所＝理由が出る
    // ⚠️ **指の経路として撃つ**（`detail: 1`）＝`fireEvent.click` の既定は `detail: 0`＝**キーボード起動**
    // なので、そのままだと「捨てる印はキーの `click` には効かせない」（#833-1 レビュー 🟡）に当たって
    // **この経路を通らなくなる**（テストが空振りする）。実機で離した後に来るのは指の `click`。
    fireEvent.click(band("あ"), { shiftKey: true, detail: 1 }); // 離した後に来る click
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap); // 消えない
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 外れない
  });

  it("掴んでいる間に別の所から文書が変わったら**確定しない**（掴み直してもらう）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = band("あ");
    pointerDownAt(el, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: 0 });
    // 声の完成などで当人の区間が変わった（自分では押していない変化）。
    act(() => { useTimelineStore.getState().trimClipById("clip_001", "end", 2); });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    // 掴んだときの起点で上書きしない＝変わった後の値がそのまま残る。
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(2, 5);
  });

  it("左の端を掴むと**始まりだけ**動く（終わりは動かさない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    drag(handle, 36 * 1); // 1秒ぶん右へ
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.startSec).toBeCloseTo(1, 5);
    expect(c.startSec + c.durationSec).toBeCloseTo(3, 5); // 終わりは元のまま
  });

  it("左の端は最小の長さで止まる（見えている長さと確定した長さが同じ）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    drag(handle, 36 * 5, { drop: false }); // 終わり（3秒）を越えて縮めようとする
    const ghost = (container.querySelector(".timeline-clip") as HTMLElement).style;
    expect(parseFloat(ghost.width)).toBeCloseTo(36 * TIMELINE_MIN_CLIP_SEC, 3); // 見た目も下限で止まる
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 5, clientY: 0 });
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.durationSec).toBeCloseTo(TIMELINE_MIN_CLIP_SEC, 5); // 確定も同じ
  });

  it("掴んでいる間に**列**が変わっても確定しない（変わり方で漏らさない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: 0 });
    act(() => { useTimelineStore.getState().moveClipById("clip_001", { trackId: "track_003" }); });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 起点で上書きしない
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_003"); // 変わった側が残る
  });

  it("`Escape` でやめた後の `click` も捨てる（選び直しで理由が消えない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4, { escape: true }); // 掴んでからやめる＝`onCancel` の道
    // `Shift` 付きの `click` は選択の付け外し＝捨てないと**やめた帯の選択が外れる**（取っ手も消える）。
    fireEvent.click(band("あ"), { shiftKey: true, detail: 1 }); // 指の経路（既定の `detail: 0` はキー起動）
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("断った後に**帯の外で離しても**選択は消えない（当たり外れを作らない）", () => {
    // ⚠️ 帯の上で離したときだけ守られる形だと、少し外れただけで選択が丸ごと消える。
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const clip = container.querySelectorAll(".timeline-clip")[0] as HTMLElement;
    drag(clip, 36 * 10); // まとめて動かして、指が帯の外で離れた
    const lane = container.querySelector(".timeline-lane") as HTMLElement;
    fireEvent.click(lane, { detail: 1 }); // 列の余白で離した＝「何もない所を押した」経路（指）
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
  });

  // ⚠️ **キーボードで起こした `click` は捨てない**（#833-1 レビュー 🟡）＝帯は `<button>` なので
  // `Tab`→`Enter` でも `click` が来るが、そこに `pointerdown` は**無い**。印は「次に指で押し始めたとき」に
  // 落とす形にしたので、印が消費されずに残った回（列をまたいで離して DOM が作り直された回）のあと
  // 次の操作がキーだけだと落とす合図が永久に来ず、**`Enter` の1回目が無言で飲み込まれる**
  //（キーで到達できなくなる＝ADR-0034 決定19）。指の経路かどうかは `detail` で見分ける。
  it("印が残っていても、キーボードで選ぶ1回目は飲み込まない（キーで到達できる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 列をまたいで離す＝帯の DOM が作り直され、`click` を消費する相手が居ないまま印が残る回。
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    useTimelineStore.getState().clearSelection();
    // ここで指を使わず**キーボードだけ**で別の帯を選ぶ（`detail: 0`＝キー起動の `click`）。
    const other = [...container.querySelectorAll(".timeline-clip")].find((el) => (el.textContent ?? "").includes("い")) as HTMLElement;
    fireEvent.click(other);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_002"]); // 1回目から効く
  });

  it("**書き出し中は再生を始めない**（押しても何も起きない、を作らない・#752-6）", () => {
    // ⚠️ 成果物は壊れないが、音が鳴り出す入口だけ開いていた（編集も声の作成も塞いであるのに）。
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const play = screen.getByRole("button", { name: "再生" });
    expect(play).toBeDisabled();
    expect(play.getAttribute("title")).toContain("終わってから再生できます"); // 押せない理由を出す
    fireEvent.keyDown(window, { key: " " }); // キーからも始まらない（見た目を持たない入口）
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    // ⚠️ **キーで断るなら理由を出す**（#752 レビュー）＝`Delete`・`Ctrl+K` は喋るのに `Space` だけ
    // 黙ると、押せない見た目を持たない入口で挙動が割れる。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_PLAY_EXPORTING");
    expect(screen.getByText(/終わってから再生できます/)).toBeInTheDocument();
  });

  it("走っている最中の「停止」は塞がない（止められないまま音が流れる、を作らない・#752 レビュー）", () => {
    two();
    useTimelineStore.setState({
      isPlaying: true,
      exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const stop = screen.getByRole("button", { name: "停止" });
    expect(stop).not.toBeDisabled();
    fireEvent.click(stop);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("「⋮」の位置は**幅の条件だけ**で決める（再生の開始・停止で跳ばない・#752 レビュー）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { rerender } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const menuLeft = () => (screen.getByRole("button", { name: "あの操作" }) as HTMLElement).style.left;
    const before = menuLeft();
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    rerender(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("", { selector: ".timeline-clip-handle" })).toBeNull(); // 取っ手は消える（意図どおり）
    expect(menuLeft()).toBe(before); // 位置は動かない
  });

  it("押せるときはキーの割り当てを添える（あることを知らせる・#752-10）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 1 }); // 描く前に選んでおく
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "再生" }).getAttribute("title")).toContain("（Space）");
    expect(screen.getByRole("button", { name: "ここで分ける" }).getAttribute("title")).toContain("（Ctrl+K）");
  });

  it("**再生中は帯を掴めない**（吸着の寄り先が掴んだ時点で止まる・#752-4）", () => {
    // ⚠️ 置く操作は既に塞いであるのに掴む方だけ通っていた（同じ理由なら同じ挙動・ADR-0026②）。
    two();
    useTimelineStore.setState({ isPlaying: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable"); // 見た目も掴めない
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 動かない
  });

  it("掴んでいる間は**ボタンでも**倍率を変えられない（帯が指から離れる）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (band("い") as HTMLElement).style.left;
    drag(band("あ"), 36 * 1, { drop: false }); // 掴んだまま
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).toBe(before); // 掴んでいない帯＝倍率が変われば動く
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("**部品を運んでいる最中も**倍率を変えられない（#752-5）", () => {
    // ⚠️ 帯を掴んでいるときだけ塞いでいたので、部品を運んでいる最中（`grabToPlace`）は素通りした。
    // 落とし先の時刻は**掴んだ時点の倍率**で秒に直しているので（受け口は掴んだ時の写し）、
    // 途中で倍率が変わると**指の下と違う所へ置かれる**。掴む場所が増えるたびに関門を足さない
    // ＝合図は「いま何かを掴んでいる」1つ。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (band("い") as HTMLElement).style.left; // 5秒の帯＝倍率が変われば動く
    fireEvent.pointerDown(screen.getByRole("button", { name: "図形を置く" }), { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 40, clientY: 0 }); // 運んでいる
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 0 }); // 列の外＝何も置かない
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("倍率を断ったときは**錨点を控えない**（次の1回が古い錨点で流れる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    drag(band("あ"), 36 * 1, { drop: false }); // 掴んだまま＝倍率は断られる
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -1, clientX: 500 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0 });
    // 断られたのに錨点を控えていると、**錨点を持たないボタン**の1回がその古い値で位置合わせされる。
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(scroll.scrollLeft).toBe(0);
  });

  it("掴む前の関門は**見た目と同じもの**を見る（書き写さない）", () => {
    // `cursor: grab` を出す条件と、掴む処理を始める条件が割れると「掴めそうなのに掴めない」が戻る。
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable"); // 見た目も掴めない
    drag(band("あ"), 36 * 8, { drop: false });
    expect(band("あ").className).not.toContain("timeline-clip--dragging"); // 処理も始まらない
  });

  it("端送りで枠が動いた分も**落ちる時刻に足す**（#714）", () => {
    // ⚠️ 足さないと「送られてはいるが、離すと送る前の時刻に落ちる」＝見えているものと結果が食い違う。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 1, clientY: 0 });
    scroll.scrollLeft = 36 * 1; // 端送りが枠を1秒ぶん動かした（指は止まっている）
    // ⚠️ 端送りは**送った各フレームで見せ直す**（`useEdgeAutoScroll` の `replay`）。ここでも再現する
    // ＝確定は「最後に見せた値」なので、見せ直しを省くと実装より弱い筋書きになる。
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 1, clientY: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 1, clientY: 0 });
    // 指の 1秒 ＋ 枠の 1秒 ＝ 2秒。枠の分を落とすと 1秒になる（どちらも置ける場所＝差だけを見る）。
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2, 5);
  });

  it("「置く列」は**移せる列だけ**出す（選べたのに事後に断らない・#714 レビュー）", () => {
    two({ tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },          // 種別違い
      { id: "track_003", kind: TRACK_KIND.visual, hidden: true }, // 隠している
      { id: "track_004", kind: TRACK_KIND.visual },          // これだけ移せる
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **名前で1つに決まる**（#819-3）＝以前は置く欄にも同じ「置く列」があり、値で当てるしかなかった。
    const sel = screen.getByLabelText("載っている列") as HTMLSelectElement;
    const ids = [...sel.options].map((o) => o.value);
    expect(ids).toContain("track_001"); // いま載っている列は必ず残す
    expect(ids).toContain("track_004");
    expect(ids).not.toContain("track_002");
    expect(ids).not.toContain("track_003");
  });

  it("掴み直してもらうときは**送りも止める**（消したゴーストが復活しない・#714 レビュー）", () => {
    // ⚠️ 止めないと rAF が回り続け、毎フレーム「送った分でやり直す」が走って**ゴーストが戻る**＋枠も流れる。
    const frames: Array<(t: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
    try {
      two();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
      // jsdom は実寸を持たないので、**送れる枠**として必要な値だけ差し込む。
      Object.defineProperty(scroll, "clientWidth", { value: 600, configurable: true });
      Object.defineProperty(scroll, "scrollWidth", { value: 3000, configurable: true });
      // ⚠️ jsdom は**貼り付いた要素の `scrollLeft` を動かさない**（常に 0 を返す）ので、
      // そのままだと「送っても値が変わらない」＝止め忘れても症状が出ず**通るだけのテスト**になる。
      let sl = 0;
      Object.defineProperty(scroll, "scrollLeft", { get: () => sl, set: (v: number) => { sl = v; }, configurable: true });
      scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, x: 0, y: 0, toJSON: () => ({}) });
      pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 590, clientY: 10 }); // 右端の送る帯へ
      expect(frames.length).toBeGreaterThan(0); // 送りが走っている
      act(() => { useTimelineStore.getState().trimClipById("clip_001", "end", 1); }); // 外から文書が変わった
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 591, clientY: 10 });
      expect(band("あ").className).not.toContain("timeline-clip--dragging"); // ゴーストを消した
      const before = scroll.scrollLeft;
      act(() => { frames.splice(0).forEach((cb) => cb(1000)); }); // 次のフレームが来ても…
      act(() => { frames.splice(0).forEach((cb) => cb(2000)); }); // （1フレーム目は dt=0 になりうる）
      expect(scroll.scrollLeft).toBe(before); // 流れない
      expect(band("あ").className).not.toContain("timeline-clip--dragging"); // 復活しない
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("隠した列では「複製」を**押す前に**塞ぐ（動かす・縮めるは通す）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "複製" })).toBeDisabled();
    // ⚠️ まとめて塞ぐと**その列の中身が二度と動かせない**（行き止まり）。動かす側は通ること。
    expect(screen.getByRole("button", { name: "後ろへ" })).not.toBeDisabled();
  });

  it("置いた部品の位置・大きさ・向きを数値で触れる（#685）", () => {
    // ⚠️ **箱を持っていない**部品で見る＝値は**解決した箱**（画面いっぱい）。持っている値だけ出すと
    // 空欄になり「動かせない」に見える。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("横位置") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("1920");
    // `NumberField` は**離れたとき**に確定する（打っている途中で確定しない＝他の数値欄と同じ）。
    fireEvent.change(screen.getByLabelText("横位置"), { target: { value: "300" } });
    fireEvent.blur(screen.getByLabelText("横位置"));
    // 触った時点で箱ぜんぶを書き込む＝以後の見た目と数値が食い違わない。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ x: 300, y: 0, w: 1920, h: 1080 });
  });

  it("重ね順の欄は出さない（この形式の重ね順は列の並びだけ・決定17）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 「前へ／後ろへ」はこの画面では**時間**を動かすボタン（重ね順ではない）＝名前で判定しない。
    expect(screen.queryByLabelText("重ね順")).toBeNull();
    expect(screen.queryByLabelText("奥行き")).toBeNull();
  });

  const hintTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_001", name: "シンプル", category: "opening",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
  };
  const openTemplateClip = (): void => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 3, templateId: "tmpl_001" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  // ⚠️ **見た目パターンの中へ入れる**（#818・ADR-0034 決定8＝二度押しで中へ入り、差し込み口の中身は
  // そのまま直せる）。決定8 は「(c) ドリルイン＋明示的にバラす」なのに、**バラす側しか実装されて
  // いなかった**（#685 のクローズ時に無記録で読み替えられていた）。幾何は従来どおり「バラす」。
  describe("見た目パターンの中へ入る（#818）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ふたつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [
        { id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 },
        { id: "right", type: "slot", x: 960, y: 0, w: 960, h: 1080 },
      ],
    };
    const openTemplateClip = (): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_001" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      // jsdom は実レイアウトを持たないので、キャンバスの実寸を与える（1920×1080 と等倍）。
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      return container.querySelector(".free-layout-overlay") as HTMLElement;
    };
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    it("二度押しで中へ入り、その差し込み口の欄に手が移る", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000); // 右の枠を1回目
      tapAt(root, 1400, 500, 1100); // 二度押し
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // その部品が選ばれる
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
    });

    // ⚠️ **入った所に印が出る**（レビュー 🔴）＝印が無いと、入ったかどうかも、どの層に入ったかも読めない。
    it("入った所に印が出て、抜けると消える", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      const mark = document.querySelector(".timeline-drilled-part") as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.style.left).toBe("50%"); // 右の枠（960/1920）
      act(() => { useTimelineStore.getState().clearSelection(); }); // 空白を押して抜ける
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    // ⚠️ **文字の層にも入れる**（決定8＝「差し込み口の中身（素材・**文字**）はそのまま直せる」）。
    it("文字の層に入ると、その文字の欄へ手が移る", () => {
      const withText: Template = {
        ...drillTemplate,
        layers: [
          ...drillTemplate.layers,
          { id: "title", type: "text", textKey: "title", x: 0, y: 900, w: 1920, h: 120, fontSize: 60 },
        ],
      };
      useProjectStore.setState({ templates: [withText], templateAssetSrcById: {} });
      open({
        assets: [],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 950, 1000);
      tapAt(root, 900, 950, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
    });

    // ⚠️ **入れない層では飲み込まない**（レビュー 🟡）＝欄の無い所で `true` を返すと、二度押しが
    // 何も起きずに消え、**単押しの解除まで止まる**（画面が1ピクセルも変わらない）。
    // ⚠️ 背景の層は**差し込み口に数える**（写真を入れられる）ので、入れて正しい。入れないのは
    // 「欄を持たない所」＝ここでは**差し込み口の外**（クリップ自身の塗りしか無い所）。
    it("欄の無い所では入らず、従来どおり選択が解ける", () => {
      const smallSlot: Template = {
        schemaVersion: "1.0", templateId: "tmpl_001", name: "小さい枠", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 400, h: 300 }],
      };
      useProjectStore.setState({ templates: [smallSlot], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_001" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      tapAt(root, 1400, 900, 1000); // 差し込み口の外（クリップの塗りだけの所）
      tapAt(root, 1400, 900, 1100);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 飲み込まず、解除が効く
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    // ⚠️ **別の部品を選んだら手は飛ばない**（レビュー 🔴）＝層 id は見た目パターンをまたいで重なるので、
    // 印を落とさないと**帯を選ぶだけで前に入った層の欄へ手が飛び**、矢印が素材を変えてしまう。
    it("別の部品を選んでも、前に入った欄へ手が戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      (document.activeElement as HTMLElement).blur();
      // ⚠️ **画面の道を通す**＝store を直に叩くと、選び直しの入口（印を落とす所）を通らず再現できない。
      tapAt(root, 1400, 900, 3000); // 空白を単押し＝抜ける
      const band = document.querySelector(".timeline-clip") as HTMLElement;
      fireEvent.click(band); // 帯から選び直しただけ
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull();
      expect(document.querySelector(".timeline-drilled-part")).toBeNull(); // 印も戻らない
    });

    // ⚠️ **別の帯を挟んで戻っても、印は生き返らない**（レビュー 🔴）＝空白を押さずに帯だけで
    // 行き来したときが本番（選び直しの入口が印を落としていないと、ここで生き返る）。
    it("別の帯へ移ってから戻っても、前に入った所は生き返らない", () => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
            templateId: "tmpl_001", assetRefs: { left: "asset_001" } },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 5,
            x: 0, y: 0, w: 100, h: 50, text: "ほか" },
        ],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect(document.querySelector(".timeline-drilled-part")).not.toBeNull();
      (document.activeElement as HTMLElement).blur();
      // 帯は**中身で見分ける**（並び順は列の順に依るので、位置で取ると取り違える）。
      const bandOf = (text: string): HTMLElement =>
        [...container.querySelectorAll(".timeline-clip")].find((b) => (b.textContent ?? "").includes(text)) as HTMLElement;
      fireEvent.click(bandOf("ほか")); // 別の帯へ
      fireEvent.click(bandOf("見た目パターン")); // 戻る（空白は押さない）
      // ⚠️ **戻れていることを確かめる**＝戻れていないと「印が出ない」が当たり前になり、空振りする。
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull();
    });

    // ⚠️ **当てるのは一度だけ**＝描き直しのたびに当てると、別の欄を触っている最中に手を奪われる。
    it("入った後に別の欄を触っていても、描き直しで手を奪わない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      const other = document.querySelector('[data-slot-field="left"]') as HTMLElement;
      other.focus(); // 利用者が別の欄へ移る
      // ⚠️ **文書が変わる操作**で描き直す＝再生位置だけでは効果の材料が変わらず、この穴を突けない。
      act(() => { useTimelineStore.getState().moveSelectedClip({ startSec: 1 }); });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("left");
    });

    // ⚠️ **どの経路で選び直しても生き返らない**（PR #828 レビュー 🔴）＝以前は「選ぶ入口で印を落とす」
    // 形にしていたので、`Escape`・`Ctrl+A`・範囲選択・取り消しなど**入口を通らない選択更新**で
    // 「触れていないのに入っている表示」が戻った。選択の**同一性**で見る形にして1か所で担保する。
    it("Escape で外して Ctrl+A で選び直しても、入った印は戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect(document.querySelector(".timeline-drilled-part")).not.toBeNull();
      // ⚠️ **`act` で包む**＝ドリルインの欄は入った直後に自動でフォーカスされる（#832）ので、ここで
      // 外す `blur()` は「名乗り」（`useEscapeOwner(drilledFieldFocused)`）を降ろす副作用を持つ。
      // 素の DOM 呼び出しのままだと、その後始末（`owners -= 1`）が**まだ効いていない状態**で直後の
      // `Escape` が飛び、名乗りが残ったまま扱われて`clearSelection` が動かない（実測＝変異チェックで発覚）。
      act(() => { (document.activeElement as HTMLElement).blur(); });
      fireEvent.keyDown(window, { key: "Escape" });      // 選択を外す
      fireEvent.keyDown(window, { key: "a", ctrlKey: true }); // 全選択＝同じ部品が選ばれ直す
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 選び直せている
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();       // それでも戻らない
    });

    // ⚠️ **欄がフォーカスされたまま消えても、名乗りは残らない**（#842・差分再監査の🔴）＝
    // `drilledFieldFocused` は欄の `onBlur` でしか戻らないが、**フォーカス中の欄が消えると `blur` は
    // 来ない**（React 19/jsdom で実測＝unmount 時の `onBlur` は 0回）。降ろし損ねると
    // `hasEscapeOwner()` が真のまま固着し、画面のキー操作が**丸ごと素通り**する。
    // ⚠️ **ここで `blur()` を呼ばない**のが要点＝上のテスト群は Escape の前に必ず明示的に `blur()` して
    // いたので、この経路だけ**素通りしていた**（監査で発覚）。実機の道（取り消しで欄ごと消える）を再現する。
    it("フォーカス中の欄が消えても、以後のキー操作が死なない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      // 差し込み口の欄へ手が移っている（＝名乗っている状態）。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      // **`blur()` を呼ばずに**欄を消す＝選択が外れてパネルごと消える（取り消しで踏む道と同じ）。
      act(() => { useTimelineStore.getState().clearSelection(); });
      expect(document.querySelector("[data-slot-field]")).toBeNull(); // 欄は消えた
      // 名乗りが残っていると、ここから先のキーが画面のハンドラで素通りする。
      act(() => { useTimelineStore.getState().selectClip("clip_001"); });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **選択が変わらないまま欄だけ消えても、名乗りは残らない**（#842 レビュー 🟡）＝
    // 実機で踏む道は**欄の配置の組み替え**（ADR-0033＝「選んだ部品」欄の見出しを掴んで別の場所へ
    // 落とす）。掴む処理が `pointerdown` を `preventDefault` するので**手は欄に残ったまま**、欄は
    // 別の親の下へ移る＝unmount する。`selectedKey` は変わらないので選択の後始末は走らない。
    // ここでは同じ状態（フォーカス中の欄が、選択そのままで消える）を欄を閉じることで作る。
    it("選択そのままで欄が消えても、以後のキー操作が死なない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      const before = useTimelineStore.getState().selectedClipIds;
      // **`blur()` を呼ばず・選択も変えずに**欄を消す（「選んだ部品」欄を閉じる）。
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(document.querySelector("[data-slot-field]")).toBeNull();       // 欄は消えた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(before);  // 選択は変わっていない
      // 名乗りが残っていると、ここから先のキーが画面のハンドラで素通りする。
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **文字の欄でも名乗りは降りる**（#847 レビュー 🔴）＝React は**後始末を返した ref を `null` で
    // 呼ばない**（`safelyDetachRef`）。文字の欄は #847 で `textGroup.ref`（後始末を返す）と合成したので、
    // 降ろす処理を後始末の中に入れないと**`null` が来ず名乗りが固着する**。
    // ⚠️ **差し込み口の無い見た目パターンで試す**のが要点＝差し込み口があると、同時に消える `<select>`
    // （素の ref＝`null` で呼ばれる）が代わりに降ろしてしまい、この不具合が**隠れる**（実際に隠れていた）。
    it("文字だけの見た目パターンでも、欄が消えれば名乗りは降りる", () => {
      useProjectStore.setState({
        templates: [{
          schemaVersion: "1.0", templateId: "tmpl_text", name: "文字だけ", category: "opening",
          aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
          layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 1080, fontSize: 80 }],
        } as Template],
        templateAssetSrcById: {},
      });
      open({
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_text", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // 文字の欄へ手が移っている（差し込み口は1つも無い）。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      expect(document.querySelector("[data-slot-field]")).toBeNull();
      // **`blur()` を呼ばずに**欄を消す。
      act(() => { useTimelineStore.getState().clearSelection(); });
      expect(document.querySelector("[data-text-field]")).toBeNull();
      act(() => { useTimelineStore.getState().selectClip("clip_001"); });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **履歴のまとめも欄の寿命で閉じる**（#847）＝閉じ損ねると**自動保存が止まり、以後の編集が
    // 履歴に積まれない**。画面の配線（合成 ref）まで通して見る＝フックの単体テストでは、
    // `ref` を渡し忘れても赤くならない。
    it("欄が消えたら履歴のまとめも閉じる（自動保存が止まらない）", () => {
      useProjectStore.setState({
        templates: [{
          schemaVersion: "1.0", templateId: "tmpl_text", name: "文字だけ", category: "opening",
          aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
          layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 1080, fontSize: 80 }],
        } as Template],
        templateAssetSrcById: {},
      });
      open({
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_text", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // 入った時点で文字の欄へ手が移る＝まとめが開く。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      expect(useTimelineStore.getState()._historyGroupDepth).toBeGreaterThan(0);
      // ⚠️ **選択を変えて消してはいけない**＝選択が変わる道は `resetHistoryGroup()` が畳むので、
      // 配線（`ref`）を外しても緑のまま通る（実測で空振りを確認）。**選択そのままで欄だけ消す**
      // ＝欄を閉じる（実機の道は ADR-0033 の配置の組み替え）＝ここだけが ref の後始末に懸かる。
      const before = useTimelineStore.getState().selectedClipIds;
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(document.querySelector("[data-text-field]")).toBeNull();
      expect(useTimelineStore.getState().selectedClipIds).toEqual(before); // 選択は変えていない
      expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 閉じている＝自動保存が止まらない
    });

    // ⚠️ **取り消しなど store 側の選択更新でも戻らない**（入口を数え上げない形の要）。
    it("取り消しで選択が入れ替わっても、入った印は戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      (document.activeElement as HTMLElement).blur();
      act(() => { useTimelineStore.getState().selectClips(["clip_001"]); }); // store 側の選択更新
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    it("単押しでは入らない（従来どおり選択が解ける）", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      tapAt(root, 1400, 500, 1000);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
    });

    // ⚠️ **同じ所へ入り直すと手が移らなかった**（#832 レビュー 🟡）＝「当てるのは一度だけ」を
    // 当て先の**文字列キー**（`clipId/layerId`）で覚えていたので、抜けて同じ所へ入り直すとキーが
    // 前回と同じになり、手が移らなかった（同じ操作の結果が2通り）。`drilled` **そのもの（同一性）**を
    // 覚える形に直したので、入り直しは必ず手が移る。
    it("同じ差し込み口へ入り直すと、もう一度手が移る", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      (document.activeElement as HTMLElement).blur();
      tapAt(root, 1400, 900, 3000); // 空白を単押し＝抜ける
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
      // 同じ帯・同じ差し込み口へもう一度入り直す。
      tapAt(root, 1400, 500, 5000);
      tapAt(root, 1400, 500, 5100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right"); // 手が移る
    });
  });

  // ⚠️ **Escape の抜け方が層で割れていた**（#832・06_UI_SPEC.md「抜け方はどれでも抜ける」）＝
  // 文字の層（`<input>`）は入力欄扱いで共有の window ハンドラに素通りされ、何も起きなかった。
  // 差し込み口（`<select>`）は素通りされない代わりに、1段目（欄を抜ける）を持たず即座に選択解除まで
  // 進んでいた。両方とも「1回目＝欄を抜ける・2回目＝選択解除」に揃える。
  describe("ドリルインした欄の Escape（#832）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ふたつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [
        { id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 },
        { id: "right", type: "slot", x: 960, y: 0, w: 960, h: 1080 },
        { id: "title", type: "text", textKey: "title", x: 0, y: 900, w: 1920, h: 120, fontSize: 60 },
      ],
    };
    const openDrillable = (): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_001" }, texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      return root;
    };
    // ⚠️ **離しも送る**＝1回目のタップは（まだ二度押しと分からないので）空白クリックとして扱われ、
    // 範囲選択（マーキー）を始めた状態のまま止まる（`pointerDown` だけだと「掴んでいる最中」を抜けない）。
    // 実機のクリックには必ず離しが来る＝離しが来ないと**掴んでいる最中の Escape の受け持ち**
    // （`FreeLayoutOverlay` 側・#752）が居座り、この節が試したい「欄の Escape」より先に消費してしまう。
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    it("文字の欄：1回目の Escape は欄を抜けるだけ・2回目で選択が解ける", () => {
      const root = openDrillable();
      tapAt(root, 900, 950, 1000);
      tapAt(root, 900, 950, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field") ?? null).toBeNull(); // 抜けた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // まだ選択は残る
      fireEvent.keyDown(window, { key: "Escape" }); // 2回目
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 選択が解ける
    });

    it("差し込み口の欄：1回目の Escape は欄を抜けるだけ・2回目で選択が解ける", () => {
      const root = openDrillable();
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull(); // 抜けた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // まだ選択は残る（以前は即座に解けていた）
      fireEvent.keyDown(window, { key: "Escape" }); // 2回目
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
    });
  });

  // ⚠️ **入れないときに飲み込んでいた**（#832）＝当て先が押せない／DOM に無いとき、`onDrillInAt` は
  // `true` を返したまま印だけ出て手は移らず、単押しの解除も止まっていた。押せないときは理由を出して
  // 従来の解除へ戻す／開けるものは開いて実際に入れる、のどちらかにする。
  describe("入れないときは飲み込まない（#832）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ひとつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    const openDrillable = (over: Partial<TimelineProject> = {}): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_001" },
        }],
        ...over,
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      return root;
    };
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    // ⚠️ **理由は store の `editBlocked` では持てない**（#832 レビューで発覚）＝`onDrillInAt` が
    // `false` を返すと `FreeLayoutOverlay` は続けて `onSelect(null)`（`clearSelection`）を呼び、
    // それが `CLEARED_NOTICES` で `editBlocked` ごと**同じ押下の中で**消してしまう。画面ローカルの
    // 知らせ（`drillBlockedNotice`）が実際に**描画されて残っている**ことまで見る。
    it("固定した列の部品では入らず、理由を出して従来どおり選択が解ける", () => {
      const root = openDrillable({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
      useTimelineStore.setState({ selectedClipIds: [] });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 選ばれない＝従来の解除
      expect(screen.getByText(lockedTrackMessage("content"))).toBeInTheDocument(); // 理由を出す
      expect(document.querySelector(".timeline-drilled-part")).toBeNull(); // 印も出ない（入っていない）
    });

    // ⚠️ **書き出し中は試さない**＝`FreeLayoutOverlay`（ドリルインの入口そのもの）は `!exporting` でしか
    // 描かれない（すぐ上の画面の描画条件）ので、書き出し中に二度押しでここへ来ること自体が無い。
    // `onDrillInAt` 側にも `exporting` の関門は持たせていない（無い状況を確かめない＝実行できない
    // 経路のテストを書かない）。

    // ⚠️ **知らせは次の本当の選択変化まで残る**（#832）＝立てた回の「従来の解除」（selectedKey は
    // 変わらず空のまま）では消えない。あとで別の部品を選ぶ、という**新しい**変化でだけ消える。
    it("理由の知らせは、別の部品を選ぶまで残る", () => {
      const root = openDrillable({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
      useTimelineStore.setState({ selectedClipIds: [] });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      const msg = lockedTrackMessage("content");
      expect(screen.getByText(msg)).toBeInTheDocument();
      act(() => { useTimelineStore.getState().selectClips(["clip_001"]); }); // 別の（新しい）選択
      expect(screen.queryByText(msg)).toBeNull(); // 消える
    });

    it("「選んだ部品」欄を閉じていても、二度押しで開いて入れる（節を開いても無理なときだけ戻す）", () => {
      const root = openDrillable();
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(screen.queryByRole("heading", { name: "選んだ部品" })).not.toBeInTheDocument(); // 前提＝閉じている
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument(); // 開けるものは開く
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 飲み込まず、実際に入れた
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("main");
    });

    it("「この見た目パターンの中身」の節を畳んでいても、二度押しで開いて入れる", async () => {
      const root = openDrillable();
      // ⚠️ **先に選んで節を出してから畳む**＝節は「選んだ部品」の中にあるので、何も選んでいない
      // 状態では存在しない（畳む操作そのものができない）。**`act` で包む**＝描画後の store 直更新を
      // 次のクエリの前に必ず反映させる（他の直書きは `render` より前に置いて避けている・ここは
      // 先に節を畳む必要があるので描画後にせざるを得ない）。
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      // 節を畳む（画面ローカルの記憶＝#687）。
      fireEvent.click(screen.getByText("この見た目パターンの中身"));
      expect(screen.getByText("この見た目パターンの中身").closest("details")).toHaveProperty("open", false); // 前提＝畳んでいる
      // ⚠️ **記憶への保存を待つ**＝`<details>` の `toggle` は非同期に発火する（`CollapsibleSection.test.tsx`
      // と同じ流儀）。待たずに進むと「畳んだ」がまだ記憶に書かれておらず、末尾の
      // 「ドリルインしても記憶は書き換わらない（畳んだまま）」の確認が**そもそも畳んだ記憶が
      // 無かったから変わらなかっただけ**という空振りになる。ここで実際に書かれたことを確かめてから進む。
      await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
      expect(JSON.parse(localStorage.getItem("timeline.sectionOpen")!)).toMatchObject({ templateContent: false });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // ⚠️ **要素を取り直す**＝ドリルインの1回目のタップは「選択を一度解く」ぶんも兼ねる（#818）ので、
      // 「選んだ部品」の中身（この節を含む）は一度アンマウントされ、選び直しで作り直される。
      // 畳む前に控えた DOM 参照は**別の要素**になっている＝取り直さないと古い参照の状態を見てしまう。
      expect(screen.getByText("この見た目パターンの中身").closest("details")).toHaveProperty("open", true); // 開けるものは開く
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("main");
      // ⚠️ **記憶は上書きしない**＝`forceOpen` は一時的に開くだけ（`CollapsibleSection.tsx` の JSDoc）。
      // 畳んだという利用者の設定はそのまま残る＝次にこの節が新しく作られる回（別の動画を開く等）は
      // 畳んだまま出る。ドリルインのたびに「開いている」が既定へ書き換わってしまうことがない。
      expect(JSON.parse(localStorage.getItem("timeline.sectionOpen")!)).toMatchObject({ templateContent: false });
    });
  });

  it("見た目パターンの部品では**次の行動を出す**（欄が消えるだけにしない）", () => {
    // ⚠️ **見た目パターンを登録してから見る**（#812）＝以前はここが空のまま `/中身をバラす/` を
    // 見ており、**未解決なのに案内だけ出る**壊れた挙動をテストが固定していた。
    useProjectStore.setState({ templates: [hintTemplate] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByLabelText("横位置")).toBeNull();
    expect(screen.getByText(/中の位置や大きさを変えるには「中身をバラす」を使ってください/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中身をバラす" })).toBeInTheDocument(); // 名指し先が実在する
  });

  // ⚠️ **二度押しできること自体の発見手段が無かった**（#832・06_UI_SPEC.md ①）＝印は入った**後**にしか
  // 出ないので、印だけでは「二度押しできること」自体は見つからない。常時見える一文に足す。
  it("差し込み口・文字がある見た目パターンでは、二度押しで直せる旨を先に知らせる", () => {
    const drillable: Template = { ...hintTemplate, layers: [...hintTemplate.layers, { id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }] };
    useProjectStore.setState({ templates: [drillable] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/中の写真や文字は、その場所を二度押しでも直せます/)).toBeInTheDocument();
  });

  // ⚠️ **実行できない行動を名指ししない**（§2-5）＝入れる差し込み口・文字が1つも無い見た目パターンで
  // 「二度押しで直せる」と言うと、押しても何も起きない（`drillTargets` が空＝そもそも入れる層が無い）。
  // ⚠️ **`background` 層は差し込み口に数える**（`templateSlotIds`＝写真を選び直せる）ので、
  // 「入れる中身が無い」を作るには**それも持たない**層（立ち絵）だけの見た目パターンを使う。
  it("差し込み口も文字も無い見た目パターンでは、二度押しの案内を出さない", () => {
    const noDrillable: Template = {
      ...hintTemplate,
      layers: [{ id: "yuko", type: "character", x: 0, y: 0, w: 400, h: 800 }],
    };
    useProjectStore.setState({ templates: [noDrillable] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/中の位置や大きさを変えるには「中身をバラす」を使ってください/)).toBeInTheDocument(); // 前提＝一文自体は出る
    expect(screen.queryByText(/二度押しでも直せます/)).toBeNull();
  });

  // ⚠️ **無いボタンを名指ししない**（#812・§2-5）＝見た目パターンが見つからないと「中身をバラす」は
  // 描かれないので、案内だけ残ると**どこにも無いボタンを探させる**うえ、「見つかりません」と食い違う
  // 2つの案内が並ぶ。自作の見た目パターンを消すと踏む（タイムライン文書の参照は修復されない）。
  it("見た目パターンが見つからないときは、無いボタンを名指ししない", () => {
    openTemplateClip(); // 見た目パターンは登録しない＝未解決
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "中身をバラす" })).toBeNull(); // 前提＝ボタンは無い
    expect(screen.queryByText(/中身をバラす/)).toBeNull();                     // その名前を出さない
    expect(screen.getByText(/この部品の見た目パターンが見つかりません/)).toBeInTheDocument();
  });

  it("箱を持てない部品には出さない（音・読み上げ・見た目パターン）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_009", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 3, assetId: "asset_001" }],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_009"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByLabelText("横位置")).toBeNull();
  });

  /** その帯が居る列の名前（列の並びは「手前が上」なので添字で決め打ちしない）。 */
  const lanesLabel = (el: Element): string | undefined =>
    el.closest(".timeline-track")?.parentElement?.querySelector(".timeline-row-label span")?.textContent ?? undefined;

  // キャンバスで掴んで動かす（#685 後半・ADR-0034 決定6/7/15/17）。
  // ⚠️ **場面編集と同じ部品**（`FreeLayoutOverlay`）を流用する＝2つの画面で操作感を割らない。
  const canvasEls = (container: HTMLElement) => {
    const wrap = container.querySelector(".preview-stage-wrap") as HTMLElement;
    const stage = wrap?.querySelector(".preview-stage");
    const ov = wrap && wrap.lastElementChild !== stage ? (wrap.lastElementChild as HTMLElement) : null;
    return { wrap, ov };
  };

  it("キャンバスに操作レイヤを重ねる（箱を持てる部品だけ）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        // 見た目パターンは**枠そのもの**なので渡さない（渡すと全面を覆って下を掴めない・決定8）。
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 5, durationSec: 3, templateId: "tmpl_001" },
        // 音は画面に出ない。
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 3, assetId: "asset_001" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const { ov } = canvasEls(container);
    expect(ov).not.toBeNull();
    expect(ov!.children.length).toBe(1); // 文字だけ
  });

  it("**いま出ていない部品**は触れない（時間の外のものを掴ませない）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 10, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 再生位置は 0＝この部品は出ていない。
    expect(canvasEls(container).ov).toBeNull();
  });

  it("再生中は操作レイヤを出さない（動く絵と設計位置のハンドルがずれる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov).not.toBeNull();
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    expect(canvasEls(container).ov).toBeNull();
  });

  it("書き出し中も出さない（入らない編集を受け付けない）", () => {
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov).toBeNull();
  });

  it("固定した列の部品は**掴めない**（帯と同じ＝場所で挙動を変えない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    // ロックされた要素は `cursor: default`（掴めそうに見せない）。
    expect(el.style.cursor).toBe("default");
  });

  it("**重なりは描く順で拾う**（奥の部品が掴まれない・#746-5）", () => {
    // ⚠️ 描く重ね順は**列の並び**だが、操作レイヤが文書の並びで積むと、後ろに書かれた奥の部品が
    // 手前に来る＝重なった所で**奥が掴まれる**（右クリックの「削除」も奥に当たる）。
    open({
      // 列の並び＝奥（track_001）→ 手前（track_002）。文書の並びは**わざと逆**にする。
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_front", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "手前" },
        { id: "clip_back", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "奥" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const boxes = [...canvasEls(container).ov!.children] as HTMLElement[];
    // 当たりは**配列の後ろが勝つ**（DOM の後ろほど手前）＝最後が手前の列の部品であること。
    fireEvent.pointerDown(boxes[boxes.length - 1], { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_front"]);
  });

  it("**動きが効いている間は、枠を描かれている場所に出す**（#746-4）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const box = canvasEls(container).ov!.children[0] as HTMLElement;
    // 素の箱は x=0。動きで +400 されているので、枠もそこへ（1920 幅の 20.83%）。
    expect(box.style.left).toBe(`${(400 / 1920) * 100}%`);
  });

  it("動きが効いている間は**掴ませない**＋理由と触れる先を出す（#746-4）", () => {
    // ⚠️ 掴んだ量は**素の箱**へ書き戻るので、動きのぶんだけ絵が飛ぶ。行き止まりにしないため、
    // 数値で変えられることを添える（決定5）。
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((canvasEls(container).ov!.children[0] as HTMLElement).style.cursor).toBe("default");
    expect(screen.getByText(/仕上がり確認の上では動かせません/)).toBeInTheDocument();
    // ⚠️ **次の行動まで見る**（§2-5）＝理由だけ出して行き止まりにしない。ここを見ていなかったので、
    // 案内から「動き」で調整する道が消えても誰も気づけなかった（#788-1 の変異チェックで判明）。
    expect(screen.getByText(/「動き」で調整してください/)).toBeInTheDocument();
    expect(screen.getByLabelText("横位置")).toBeInTheDocument(); // 触れる先は残る
  });

  it("**固定を除外して動かしたら一言知らせる（ただし一度だけ）**（#773・決定 (a)）", () => {
    // ⚠️ 黙って一部だけ動かさない（ADR-0026④）。ただし**見れば分かる**ので、動かすたびには出さない
    //（利用者決定）。選んだ組み合わせが変わったら出し直す。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // 固定は動かず、残りは動く（＝空間の移動は「除外」・全か無かにしない）。
    const clips = () => useTimelineStore.getState().doc!.clips;
    expect(clips().find((c) => c.id === "clip_locked")!.x).toBe(0);
    expect(clips().find((c) => c.id === "clip_free")!.x).toBe(1);
    expect(screen.getByText(/固定された列の部品1個は動かしていません/)).toBeInTheDocument();
  });

  // ⚠️ #788-1：キャンバスで掴めない理由は**固定した列だけではない**（動きが効いている／まとまりの変形）。
  // 以前は除外の一言が常に「固定を外してください」で、**動き起因では従っても直らない**案内だった。
  it("動きが理由で外したときは、固定ではなく**動きの直し方**を案内する（#788-1）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_anim", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "動く" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_anim", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_anim", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 動かせる方を掴む＝動きの効いている方は一緒に動かさない（その理由を出す）。
    const els = canvasEls(container).ov!.children;
    fireEvent.pointerDown(els[1] as HTMLElement, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    expect(screen.getByText(/動きが効いている部品1個は動かしていません/)).toBeInTheDocument();
    expect(screen.queryByText(/固定を外してください/)).toBeNull(); // 従っても直らない案内は出さない
  });

  // ⚠️ **まとまりの変形が理由のときも知らせる**（レビュー指摘＝一括経路で `group` を通すテストが無かった）。
  // 理由の並びからこの値が落ちると `join` が空文字になり、**知らせ自体が描かれない**まま一部だけ動く。
  it("まとまりの変形が理由のときも、その言い方で知らせる（#788-1）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      groups: [{ id: "group_001", members: ["clip_grp"], transform: { x: 300, y: 0, scale: 1, rotation: 0 } }],
      clips: [
        { id: "clip_grp", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "まとまり" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_grp", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const els = canvasEls(container).ov!.children;
    fireEvent.pointerDown(els[1] as HTMLElement, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    expect(screen.getByText(/まとまりの変形が効いている部品1個は動かしていません/)).toBeInTheDocument();
  });

  // ⚠️ **固定した列は「動き」より先**（レビュー指摘）＝両方が理由になりうるとき、動きを先に言うと
  // 「下の数値／矢印キーで」と案内するが、その部品は数値の欄も矢印も列の固定で塞がっている。
  it("固定した列の上に動きがあるときは、固定の方を知らせる（塞がった行き先を示さない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_anim", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "動く" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_anim", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_anim", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const els = canvasEls(container).ov!.children;
    fireEvent.pointerDown(els[1] as HTMLElement, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    expect(screen.getByText(/固定された列の部品1個は動かしていません/)).toBeInTheDocument();
    expect(screen.queryByText(/動きが効いている部品/)).toBeNull();
  });

  it("**同じ組み合わせでは二度と出さない**（見れば分かることを繰り返さない・#773・利用者決定）", () => {
    // ⚠️ 「一度だけ」が効いているかは、**知らせが消えたあとに同じ組み合わせで動かす**と分かる
    //（1本の知らせを出し直すだけでは、毎回出す形と見た目が変わらない＝そこを見ても確かめられない）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/動かしていません/)).toBeInTheDocument();
    // 選び直すと知らせは消える（前の選択の返事に見せない）。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_free"] }); });
    expect(screen.queryByText(/動かしていません/)).toBeNull();
    // **同じ組み合わせへ戻して動かしても、もう出さない**。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] }); });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.queryByText(/動かしていません/)).toBeNull();
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_free")!.x).toBe(2); // 動きは続く
  });

  it("帯の一括移動は**全か無かで断る**＋語彙は「選んだ中に固定がある」（#773-3）", () => {
    // ⚠️ 時間の移動は一部だけ動くと間隔・並びが壊れる＝断るのが親切（決定 (a)）。
    // 断り文が `locked`（「**この**列は…」）だと、まとめて動かしている場面で指す先が外れる。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().moveClipsBy([{ id: "clip_free", startSec: 5 }, { id: "clip_locked", startSec: 5 }]); });
    expect(useTimelineStore.getState().doc!.clips.every((c) => c.startSec === 0)).toBe(true); // 全か無か
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
  });

  it("**動いている部品はまとめて動かすときも混ざらない**（絵が飛ばない・#746 レビュー 🔴）", () => {
    // ⚠️ 掴み始めるのを塞いでも、**まとめて選んで別の1つを動かす**と混ざって動いていた。
    // 枠は「描かれている場所」に出しているので、混ざるとその場所が**素の箱として保存**され、
    // 動きのぶんだけ絵が飛ぶ（`Escape` の戻しも同じ値を書く）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_still", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "とまる" },
        { id: "clip_moving", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "うごく" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_moving", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_still", "clip_moving"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ov = canvasEls(container).ov!;
    // ⚠️ 枠の実寸を与える（jsdom は幅を持たない＝縮尺 0 で**そもそも動かない**＝空振りのテストになる）。
    Object.defineProperty(ov, "clientWidth", { value: 960, configurable: true });
    ov.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const still = ov.children[0] as HTMLElement;
    fireEvent.pointerDown(still, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(ov, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(ov, { pointerId: 1, clientX: 40, clientY: 0 });
    const clips = useTimelineStore.getState().doc!.clips;
    // 掴んだ方は動いている（＝ドラッグが実際に走った・空振りでない）。
    expect(clips.find((c) => c.id === "clip_still")!.x).toBeGreaterThan(0);
    // 動いている方は混ざらない（描かれている 400 を素の箱として書き戻さない）。
    expect(clips.find((c) => c.id === "clip_moving")!.x).toBe(0);
  });

  it("まとまりの変形で動いているときは、**動きとは別の言い方**で断る（#746 レビュー）", () => {
    // ⚠️ 「動き」の欄では外せないものを「動きで調整して」と案内すると、言われたとおりにしても直らない。
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 300, y: 0, scale: 1, rotation: 0 } }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/まとまりの変形が効いている部品は/)).toBeInTheDocument();
    expect(screen.queryByText(/「動き」で調整してください/)).toBeNull();
  });

  it("動きが無ければ従来どおり掴める（#746-4）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((canvasEls(container).ov!.children[0] as HTMLElement).style.cursor).toBe("move");
  });

  it("**右クリックで黙らない**（帯と同じ「複製／削除」を出す・#746-1／語は #763-6 で統一）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    // ⚠️ **メニューの項目として**引く＝語を統一した（#763-6）ので、欄のボタンとも同じ文字になる。
    // ⚠️ **共有の語（`uiLabels`）で引く**＝キャンバスと帯が同じ出どころを見ていることをテストでも辿る
    //（リテラルを書き写すと、片方が独自の語へ戻っても気づけない）。
    expect(screen.getByRole("menuitem", { name: DUPLICATE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: DELETE_LABEL })).toBeInTheDocument();
  });

  it("キャンバスのメニューから消せる（帯と同じ入口を通る・#746-1）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el); // 右クリックでその部品を選ぶ
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_002"]);
  });

  it("押せない項目は**消さずに理由を出す**（場所によって在ったり無かったり、を作らない・#746-1）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    const del = screen.getByRole("menuitem", { name: "削除" }) as HTMLButtonElement;
    expect(del).toBeDisabled();
    expect(del.getAttribute("title")).toContain("固定");
  });

  it("**文字は二度押しで直せる**（他社の型・#746-2）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.doubleClick(el);
    const ta = within(canvasEls(container).ov!).getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("あ"); // いまの文言が入っている（描画と同じ変換を通っている）
    fireEvent.change(ta, { target: { value: "あい" } });
    expect(useTimelineStore.getState().doc!.clips[0].text).toBe("あい");
  });

  it("**打っている間の取り消しは1回ぶん**（履歴を文字入力で食い潰さない・#746 レビュー）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.doubleClick(el);
    const ta = within(canvasEls(container).ov!).getByRole("textbox") as HTMLTextAreaElement;
    for (const v of ["あい", "あいう", "あいうえ"]) fireEvent.change(ta, { target: { value: v } });
    fireEvent.blur(ta);
    expect(useTimelineStore.getState().doc!.clips[0].text).toBe("あいうえ");
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("固定した列の文字は**編集欄に入らない**（打てない欄を開かない・#746 レビュー）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(canvasEls(container).ov!.children[0] as HTMLElement);
    expect(within(canvasEls(container).ov!).queryByRole("textbox")).toBeNull();
  });

  it("**まとめて選んでいるとキャンバスの「複製」も押せない**（押しても無反応を作らない・#746 レビュー）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(canvasEls(container).ov!.children[0] as HTMLElement);
    const dup = screen.getByText("複製").closest("button") as HTMLButtonElement;
    expect(dup).toBeDisabled();
    expect(dup.getAttribute("title")).toContain("1つだけ選ぶと使えます");
  });

  it("**音の列に載った映像部品は触れない**（描かれないのに掴める、を作らない・#746 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 60, w: 100, h: 50, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov!.children.length).toBe(1); // 映像の列のものだけ
  });

  it("直している間は**下の絵を伏せる**（二重に見えない・#746-2）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const stage = () => container.querySelector(".preview-stage") as HTMLElement;
    expect(stage().innerHTML).toContain("あ");
    fireEvent.doubleClick(canvasEls(container).ov!.children[0] as HTMLElement);
    expect(stage().innerHTML).not.toContain(">あ<");
  });

  it("**隠したまとまりの部品は触れない**（描かれていないものの枠を出さない・#746-6）", () => {
    // ⚠️ 部品そのものの `hidden` は共通部品の側でも伏せられるが、**隠したまとまり**は
    // こちら（`isOnCanvas`）でしか見ていない＝ここが抜けると枠だけ出て掴める。
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 60, w: 100, h: 50, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov!.children.length).toBe(1); // 隠したまとまりのものは出さない
  });

  it("隠した部品は**矢印でも動かない**（出ていないものは操作の対象にしない・#746-6）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ", hidden: true }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 動かさない
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は送る
  });

  it("重ね順の項目はキャンバスのメニューに出さない（列の並びだけ・決定17）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    expect(screen.queryByText("前面")).toBeNull();
    expect(screen.queryByText("背面")).toBeNull();
  });

  it("縦型では**比を動画に合わせる**（枠と絵がずれない）", () => {
    // ⚠️ CSS の既定は 16:9 固定。縦型で letterbox が入ると、上に重ねる操作レイヤと実際に描かれている
    // 矩形がずれ、**掴む位置も動かす量も約3倍ずれる**（縦型は新規作成から到達できる）。
    open({ videoSettings: { aspectRatio: "9:16", fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((container.querySelector(".preview-stage") as HTMLElement).style.aspectRatio).toBe("1080 / 1920");
  });

  it("**別の列へ運べる**（#686 段階4）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lanes = [...container.querySelectorAll(".timeline-lane")] as HTMLElement[];
    // 「置く」と同じ規則（`laneAt`）で列を採るので、列の矩形を持たせる。
    lanes.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    // 表示は**手前が上**＝配列を逆順に描くので、下の行が `track_001`（掴む相手が居る列）。
    const from = lanes.findIndex((el) => el.querySelector(".timeline-clip"));
    const to = from === 0 ? 1 : 0;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: from * 40 + 20 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: to * 40 + 20 });
    // ⚠️ **運んでいる間から運び先の列に描く**＝指と一緒に列をまたぐ（元の列に置いたまま
    // 行き先だけ光らせる、にしない）。ここを見ないと「離すまで動かない」実装でも通る。
    // ⚠️ 列には他の帯も居るので、**掴んだ帯そのもの**がどちらに居るかで見る。
    expect(lanes[to].contains(band("あ"))).toBe(true);
    expect(lanes[from].contains(band("あ"))).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: to * 40 + 20 });
    const moved = useTimelineStore.getState().doc!.clips[0];
    expect(moved.trackId).not.toBe("track_001"); // 列が変わった
    expect(moved.startSec).toBeCloseTo(8, 5); // 時刻も同時に動く
  });

  it("列の外で離したら**掴んだ列のまま**（勝手に別の列へ飛ばさない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 列の矩形を与えない＝どの列にも当たらない（欄の余白の上で離した状態）。
    void container;
    drag(band("あ"), 36 * 8);
    const moved = useTimelineStore.getState().doc!.clips[0];
    expect(moved.trackId).toBe("track_001");
    expect(moved.startSec).toBeCloseTo(8, 5); // 時刻だけ動く
  });

  it("連動している字幕は**横に動かず列だけ運べる**（指のぶれで通ったり断られたりしない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_005", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lanes = [...container.querySelectorAll(".timeline-lane")] as HTMLElement[];
    lanes.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    const sub = [...container.querySelectorAll(".timeline-clip")].find((el) => lanesLabel(el) !== "音1") as HTMLElement;
    const from = lanes.findIndex((el) => el.contains(sub));
    // ⚠️ 「字幕を置ける列」を選ぶ＝音の列を選ぶと種別違いで断られ、見たいことが見えない。
    const to = lanes.findIndex((el) => el.parentElement?.textContent?.includes("映像2"));
    // **横にもぶらして**運ぶ（実際の指はまっすぐ縦には動かない）。
    pointerDownAt(sub, 1, { clientX: 0, clientY: from * 40 + 20 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 3, clientY: to * 40 + 20 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 3, clientY: to * 40 + 20 });
    const moved = useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!;
    expect(moved.startSec).toBe(0); // 時間は読み上げが決める＝動かない
    expect(useTimelineStore.getState().editBlocked).toBeNull(); // 断られない
  });

  it("捨てる印は**次に押し始めたときに落とす**（次の解除を食わない）", () => {
    // ⚠️ 列をまたいで離すと帯の DOM は親ごと作り直され、**その帯の `onClick` は走らない**＝
    // 印を消費する相手が居ない。残ると次の「何もない所を押して選択を解く」1回を飲み込む。
    // ⚠️ **時間では落とさない**（#833-1）＝`Escape` は指を**離す前**に走るので、時間で落とすと
    // 実機では「やめたのに離した位置で上書きされる」（下の中止のテスト）。代わりに**次の
    // `pointerdown`** で落とす＝実際の解除は必ず押し始めから始まるので、持ち越さないのは同じだけ守れる。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    const lane = container.querySelector(".timeline-lane") as HTMLElement;
    // 実機の解除は `pointerdown`→`click` の順に来る（`click` だけは来ない）＝押し始めで印が落ちる。
    fireEvent.pointerDown(lane, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.click(lane);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 解除が効く
  });

  /** 吸着を見るための枠（jsdom は実寸を持たないので、見えている時間帯が出るようにする）。 */
  const withVisibleWidth = (container: HTMLElement) => {
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 900, configurable: true });
    return scroll;
  };

  it("**他の帯の端へ吸着する**（#686 段階4・決定12）", () => {
    two(); // clip_001=[0,3) / clip_002=[5,8)
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // clip_001（長さ3）の**終わり**が clip_002 の始まり（5秒）へ寄る＝開始は 2秒ちょうどになる。
    drag(band("あ"), 36 * 2 - 3);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2, 5);
  });

  it("`Ctrl` を押している間は吸着しない（あと少しだけずらせる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // ⚠️ **吸着してもしなくても置ける所**で見る（重なる所だと「断られて動かない」と区別できない）。
    // clip_001 は長さ3。終わりが clip_002 の始まり（5秒）へ寄る手前＝開始 2秒のわずか手前。
    const px = 36 * 2 - 3;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 0, ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(px / 36, 5); // 吸わない
  });

  it("`Ctrl` を先に離しても**見えていた位置**に落ちる（離す順で結果を変えない）", () => {
    // ⚠️ 離した瞬間に計算し直すと、点線が出ていなかったのに落ちた瞬間に寄る（逆順なら寄らない）。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    const px = 36 * 2 - 3;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 0, ctrlKey: true }); // 吸着なし
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 0 }); // ここで Ctrl を離している
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(px / 36, 5); // 見えていた位置のまま
  });

  // #771(a)：**新しく置くときも同じ吸着**。帯を運ぶときだけ吸着があって、置くときは生値のままだと、
  // 同じ「時間を決める操作」で作法が割れる（置いた直後に必ず微妙にずれる）。
  const dropOnLane = (container: HTMLElement, px: number, opts?: { ctrl?: boolean }) => {
    // ⚠️ **列を名指しで選ぶ**＝行は「手前が上」で並ぶので、先頭の `.timeline-lane` は音の列のことがある
    //（種別が合わずに断られて、置かれない＝何を見ているか分からないテストになる）。
    const row = trackRowLabel("映像1").closest(".timeline-row") ?? container;
    const lane = row.querySelector(".timeline-lane") as HTMLElement;
    lane.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 2000, height: 40, right: 2000, bottom: 40, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    Object.defineProperty(lane, "clientWidth", { value: 2000, configurable: true });
    const place = document.querySelector('[data-panel-id="place"]') as HTMLElement;
    const btn = within(place).getByRole("button", { name: "文字を置く" });
    const ctrl = opts?.ctrl ?? false;
    pointerDownAt(btn, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 20, ctrlKey: ctrl });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 20, ctrlKey: ctrl });
  };

  it("**置くときも他の帯の端へ吸着する**（帯を運ぶときと同じ作法・#771(a)）", () => {
    two(); // clip_001=[0,3) / clip_002=[5,8)
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // ⚠️ **吸着してもしなくても置ける所**で見る（重なる所だと「断られて置かれない」と区別できない）
    // ＝clip_002 の終わり（8秒）の**わずか後ろ**（手前だと重なって断られる）。8秒ちょうどへ寄る。
    dropOnLane(container, 36 * 8 + 3);
    const placed = lastClip();
    expect(placed.startSec).toBeCloseTo(8, 5);
  });

  it("置くときも `Ctrl` で吸着を切れる（帯を運ぶときと同じ）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    const px = 36 * 8 + 3;
    dropOnLane(container, px, { ctrl: true });
    const placed = lastClip();
    expect(placed.startSec).toBeCloseTo(px / 36, 5); // 吸わない
  });

  it("吸着した先に**縦の点線**を出す（なぜ止まったかを見せる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    expect(container.querySelector(".timeline-snapline")).toBeNull(); // 掴む前は出さない
    drag(band("あ"), 36 * 2 - 3, { drop: false });
    const line = container.querySelector(".timeline-snapline") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.style.left).toBe(`calc(var(--timeline-label-w) + ${36 * 5}px)`); // 寄せ先＝clip_002 の始まり
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 2 - 3, clientY: 0 });
    expect(container.querySelector(".timeline-snapline")).toBeNull(); // 離したら消す
  });

  it("**再生位置で分ける**（ボタン・`Ctrl+K`・メニューが同じ入口）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "ここで分ける" }));
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips[0]).toMatchObject({ id: "clip_001", startSec: 0, durationSec: 2 }); // 前半は同じ id
    expect(clips[1]).toMatchObject({ startSec: 2, durationSec: 1 });
    // 分けたら**後半を選び直す**（続きを触りたい手が自然に繋がる）。
    expect(useTimelineStore.getState().selectedClipIds).toEqual([clips[1].id]);
  });

  it("`Ctrl+K` でも分けられる（キーだけ・ボタンだけの操作を作らない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(3);
  });

  it("分けられないときは**押す前に**塞ぎ、キーでは理由を出す", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0 }); // 端＝片方が潰れる
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 増えない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitOutside); // 理由は出す
  });

  // ⚠️ **差し込み口の動画でも「押す前に」塞ぐ**（PR #825 レビュー 🟡）＝事前の判定に見た目パターンを
  // 渡さないと、差し込み口の置き場所が1件も解けず「素材を使い切った先」の判定が**必ず偽**になる。
  // 押せてしまい、押した先だけで断られる＝この節の趣旨（押せるのに何も起きない、を作らない）と逆。
  it("差し込み口の動画を使い切った先でも、押す前に塞ぐ", () => {
    const oneSlot: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "ひとつ枠", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "v.mp4" }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 10, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        slotClips: { main: { startSec: 0, endSec: 3 } },
      }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 5 }); // 使い切った先
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 増えない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitPastSource);
  });

  it("差し込み口の動画でも、素材が残っている位置なら分けられる（過剰に塞がない）", () => {
    const oneSlot: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "ひとつ枠", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "v.mp4" }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 10, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        slotClips: { main: { startSec: 0, endSec: 3 } },
      }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeEnabled();
  });

  it("再生中は分けられない（位置を使う操作＝結果が毎回変わる・決定21）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2, isPlaying: true });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.playing);
    // ⚠️ **右クリックの道も塞ぐ**（#750 レビュー）＝ここだけ素通しだと、走っている再生位置で
    // 分割が確定する。3つの入口が同じ材料を見ていることを、実際にメニューを開いて確かめる。
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    const item = screen.getByRole("menuitem", { name: "ここで分ける" });
    expect(item).toBeDisabled();
  });

  it("書き出し中は `Ctrl+K` でも分けない（存在しない部品を選んだ状態にしない）", () => {
    two();
    useTimelineStore.setState({
      selectedClipIds: ["clip_001"], playheadSec: 2,
      exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 増えない
    // ⚠️ 断られたのに選択だけ差し替わると、**存在しない id** が残って以後の操作が
    // 「見つかりません」（嘘の理由）で空振りする。
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.exporting);
  });

  it("Escape でやめたら元のまま（掴んだ位置に置かない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8, { escape: true });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    expect(band("あ").className).not.toContain("timeline-clip--dragging");
  });

  it("掴んだ帯が選ばれる（「選んだ部品」の欄と一致する）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("い"), 36 * 2);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_002"]);
  });

  it("右の端を掴むと長さが変わる（始まりは動かない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    drag(handle, -36); // 1秒ぶん縮める（3秒 → 2秒）
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ startSec: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(2, 5);
  });

  it("端の取っ手は**選んだ帯にだけ**出す（隣の当たり判定を常時食わない）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelectorAll(".timeline-clip-handle")).toHaveLength(0);
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
    expect(container.querySelectorAll(".timeline-clip-handle")).toHaveLength(2);
  });

  it("固定した列の帯は掴めない（掴めそうに見せない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable");
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    // 掴ませないので、断り文も出ない（掴めそうに見せて後から断る、を作らない）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    // ⚠️ **掴む処理そのものが始まらない**＝掴めば選ばれて見た目も動く（掴めそうに見せてしまう）。
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });
});

// キャンバスで掴む × 履歴（#813・ADR-0020「1操作1履歴」）。
// ⚠️ **未選択の部品を掴む経路が抜けていた**＝同じ pointerdown が「選ぶ」→「まとめを開く」の順に走り、
// 選択が変わった後始末が**開いた直後のまとめを畳んで**いた。以後は動かすたびに1件ずつ積まれ、
// 60回で上限50に達して**そのドラッグより前の編集が取り消せなくなる**（「バラす」のように取り消しで
// しか戻せない操作が押し出される）。帯のドラッグしか見ていなかったので、ここで固定する。
describe("TimelineProjectScreen: キャンバスで掴む × 履歴（#813）", () => {
  const CANVAS_W = 1920;
  const twoTexts = (): void => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 100, y: 100, w: 400, h: 90, text: "ひとつめ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 5,
          x: 100, y: 300, w: 400, h: 90, text: "ふたつめ" },
      ],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
    });
  };
  /** キャンバス上のその部品の枠（`FreeLayoutOverlay` が `data-free-id` を付ける）。 */
  const boxOf = (container: HTMLElement, id: string): HTMLElement => {
    const el = container.querySelector(`[data-free-id="${id}"]`);
    if (!el) throw new Error(`キャンバスに ${id} が無い`);
    // jsdom は実レイアウトを持たず clientWidth=0（→ 縮尺 0）。canvas と等倍にして動かす。
    const root = el.parentElement as HTMLElement;
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    return el as HTMLElement;
  };
  /** 掴んで3回動かして離す（1ジェスチャ）。 */
  const dragBox = (el: HTMLElement): void => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    for (const d of [10, 20, 30]) fireEvent.pointerMove(el, { buttons: 1, pointerId: 1, clientX: d, clientY: d });
    fireEvent.pointerUp(window, { pointerId: 1 });
  };

  it("まだ選んでいない部品を掴んで動かしても、履歴は1つ", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001")); // 選ばずにいきなり掴む
    expect(useTimelineStore.getState().doc?.clips[0].x).toBe(130); // 動いている（前提の確認）
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 開きっぱなしにしない
  });

  it("選んである部品を掴んだときも1つ（経路で挙動を割らない）", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    expect(useTimelineStore.getState().doc?.clips[0].x).toBe(130);
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **畳んでから開き直す**（素通りではない）＝文字欄はフォーカス中に欄が消えると `blur` が来ず、
  // まとめが開いたまま残る（#708）。掴んだときに素通りすると、その古いまとめが閉じられないまま残り、
  // 以後の編集がひとつながりになる（取り消しが効かない範囲が広がる）。
  it("開きっぱなしの古いまとめが残っていても、掴んだぶんは1つで、古いほうも片づく", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().beginHistoryGroup(); }); // 閉じられなかったまとめ
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 古いまとめごと閉じている
  });

  // ⚠️ **開き直すのは掴んでいるときだけ**＝掴んでいない選び直しで開くと、そこから先の編集が
  // ひとつながりになり、閉じる相手（ドラッグの終わり）も来ない。
  // ⚠️ **畳まれた後は、矢印がまとめ直す**（#817 レビュー 🔴）＝持ち主が自前の印だけを見ていると、
  // 畳まれた後も「開いている」つもりで開き直さず**1押下＝1履歴**になり、上限（50）を数秒で
  // 流し切って**取り消しでしか戻せない編集（バラすなど）を押し出す**。
  it("取り消しでまとめが畳まれた後も、続けた矢印は1つの取り消しにまとまる", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **まとめは実際の矢印で開く**＝store を直に叩くと持ち主の印が立たず、この穴を再現できない。
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // 持ち主がまとめを開いた
    act(() => { useTimelineStore.getState().undo(); }); // 取り消しで畳まれる（持ち主は知らない）
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
    // 畳まれた後に矢印を3回。まとめ直せていれば履歴は1つ（見ていないと3つ積まれる）。
    const before = useTimelineStore.getState().history.past.length;
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // まとめが開き直っている
  });

  // ⚠️ **取り残されたタイマが、別人のまとめを閉じない**（#817 レビュー 🔴 の後半）＝畳まれた後も
  // 矢印の後始末（600ms）は走るので、世代を見ないと**掴んでいる最中のまとめ**を閉じてしまい、
  // 以後の動かすたびに履歴が1件ずつ積まれる（#813 で塞いだ穴が別経路から開く）。
  it("畳まれた後に走る矢印の後始末は、別のまとめを閉じない", () => {
    vi.useFakeTimers();
    try {
      twoTexts();
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      fireEvent.keyDown(window, { key: "ArrowRight" });      // 矢印がまとめを開く（後始末が予約される）
      act(() => { useTimelineStore.getState().undo(); });    // 取り消しで畳まれる（持ち主は知らない）
      act(() => { useTimelineStore.getState().beginHistoryGroup(); }); // 別人（掴んでいる最中）が開く
      act(() => { vi.advanceTimersByTime(NUDGE_GROUP_IDLE_MS + 10); }); // 取り残された後始末が走る
      expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // 別人のまとめは開いたまま
    } finally {
      vi.useRealTimers();
    }
  });

  it("掴んでいないときの選び直しでは、まとめを開かない", () => {
    twoTexts();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().selectClip("clip_002"); });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **開いた側が閉じる**（#813 レビュー 🔴）＝閉じる合図を出すのは要素のドラッグだけで、
  // 空白クリック・範囲選択・帯のドラッグは「掴んでいる」数だけ上げて終わりに何も出さない。
  // 閉じ損ねると以後の編集が履歴に積まれず、**自動保存も止まる**（`historyDepth > 0` の間は保留）
  // ＝そのままアプリを閉じると編集が消える。しかも `endHistoryGroup` は 0 で止めるので無言。
  it("キャンバスの空白を押して離しても、まとめが残らない（選択解除は閉じる合図を出さない）", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 }); // 空白＝選択解除＋範囲選択
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("帯を掴んで動かして離しても、まとめが残らない（帯も閉じる合図を出さない）", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = container.querySelectorAll(".timeline-clip")[0];
    fireEvent.pointerDown(band, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 }); // しきい値を越える＝選び直し
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(1); // 前提＝選び直しが起きている
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **中止でも閉じる**＝枠外へ出た・別の指が割り込んだ等では `pointerup` が来ず
  // `pointercancel` になる。片方しか拾わないと、その回だけ静かに開きっぱなしになる。
  it("掴んだまま中止になっても、まとめが残らない", () => {
    // ⚠️ 見るのは**掴み手が閉じてくれない経路**（範囲選択）＝要素のドラッグは中止でも自前で閉じるので、
    // ここが効いているかを判別できない。
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.pointerCancel(root, { pointerId: 1 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **`Escape` での中止は合図（イベント）を出さない**（#813 再レビュー 🔴）＝帯もマーキーも
  // 直接 `onCancel()` を呼ぶので、`pointerup`/`pointercancel` を待ち受ける形だと取り残される。
  it("範囲選択を Escape でやめても、まとめが残らない", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("帯のドラッグを Escape でやめても、まとめが残らない", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = container.querySelectorAll(".timeline-clip")[0];
    fireEvent.pointerDown(band, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 });
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(1); // 前提＝選び直しが起きている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("続けてもう1つ掴むと、それは別の1つになる（ひとつながりにしない）", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    dragBox(boxOf(container, "clip_002")); // 選択が変わる＝ここでも畳んで開き直す
    expect(useTimelineStore.getState().history.past.length).toBe(before + 2);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });
});

// 字幕クリップの「見た目」（差分再監査 5巡目 🔴＋レビュー）。
//
// ⚠️ **効くのに選べない、の裏返し**＝描画も書き込みも通っているのに入口が影と帯しか無く、
// 大きさ・色・太さ・揃え・フォント・縁取りが直せなかった（場面形式の自由配置の字幕は直せる）。
describe("字幕クリップの見た目", () => {
  const openSubtitle = (): void => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 40, voiceClipId: "clip_001" },
      ] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
  };
  const openStyle = (): void => { fireEvent.click(screen.getByText("字幕の見た目")); };

  it("文字の大きさを直せる（文字クリップと同じ顔ぶれ）", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    const size = screen.getByLabelText("文字の大きさ") as HTMLInputElement;
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "48" } });
    fireEvent.blur(size);
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.fontSize).toBe(48);
  });

  it("縁取りの太さを直せる（バラした文字に残る縁取りを外せる）", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    const w = screen.getByLabelText("縁取りの太さ") as HTMLInputElement;
    fireEvent.focus(w);
    fireEvent.change(w, { target: { value: "3" } });
    fireEvent.blur(w);
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.strokeWidth).toBe(3);
  });

  // ⚠️ **面を撫でる色選びは1つのまとまりにする**（差分再監査 5巡目 🔴）＝渡さないと `pointermove`
  // ごとに取り消しが積まれ、**取り消しでしか戻せない操作（「バラす」）が押し出される**。
  it("影の色・背景色をドラッグで選んでも、取り消しは1回で戻る", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    fireEvent.click(screen.getByRole("switch", { name: "影を付ける" }));
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "影の色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sv, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(sv, { pointerId: 1, clientX: 70, clientY: 30 });
    fireEvent.pointerUp(sv, { pointerId: 1 });
    // 撫でた回数ぶん積まれていない＝1ドラッグ＝1回（渡していないと `pointermove` ごとに積まれる）。
    expect(useTimelineStore.getState().history.past.length - before).toBeLessThanOrEqual(1);
  });
});

// 「バラす」は押す前に断る（差分再監査 5巡目 🟡）。
//
// ⚠️ **同意させてから断らない**＝理由は押す前に分かる（純粋関数を空撃ちできる）のに、取り返しの
// つかない操作の顔をした確認に答えさせてから no-op にしていた（同じ画面の「分ける」は押す前に断る）。
describe("バラせないときは押す前に理由を出す", () => {
  const tpl: Template = {
    schemaVersion: "1.0", templateId: "tmpl_explode", name: "バラす用", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
  };
  const openCropped = (crop?: object, cropAlign?: string): void => {
    useProjectStore.setState({ templates: [tpl] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_explode",
        ...(crop ? { crop } : {}), ...(cropAlign ? { cropAlign } : {}),
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const explodeButton = (): HTMLButtonElement => {
    fireEvent.click(screen.getByText("見た目パターン"));
    return screen.getByRole("button", { name: "中身をバラす" }) as HTMLButtonElement;
  };

  it("切り抜いてある部品では押せず、理由が出る", () => {
    openCropped({ left: 0.1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = explodeButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("切り抜き");
  });

  it("寄せだけ設定してある部品でも押せない（案内どおり解除できる文言）", () => {
    openCropped(undefined, "top");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = explodeButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("寄せ");
  });

  it("何も設定していない部品は押せる", () => {
    openCropped();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(explodeButton()).not.toBeDisabled();
  });

  // ⚠️ **右クリックのメニューも同じ判定を通す**（差分再監査 6巡目 🟡）＝欄のボタンだけ塞ぐと、
  // メニューから押せて**確認に同意させてから断る**（同じ操作の断り方が2通り＝ADR-0026②）。
  it("右クリックのメニューでも押せず、理由が出る", () => {
    openCropped({ left: 0.1 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    const item = screen.getByRole("menuitem", { name: "中身をバラす" });
    expect(item).toBeDisabled();
    expect(item.title).toContain("切り抜き");
  });

  it("何も設定していなければ、右クリックのメニューからは押せる", () => {
    openCropped();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    expect(screen.getByRole("menuitem", { name: "中身をバラす" })).not.toBeDisabled();
  });
});

// 種別ごとの文字の形（差分再監査 6巡目 🟡）。
//
// ⚠️ **1つ選ぶと他が消える、を作らない**（まるごと差し替えで解かれるので、残りを引き継ぐ）。
// ⚠️ **休眠の種別も直せる**＝書き出しの門は休眠のぶんも数えて断るので、欄が「いま使う種別」だけだと
// 持ち込みフォントが消えたとき**案内どおりに選び直す先が無い**（§2-5 の行き止まり）。
describe("見た目パターンの部品の種別ごとの文字の形", () => {
  const tpl2: Template = {
    schemaVersion: "1.0", templateId: "tmpl_two_texts", name: "文字2つ", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 100, h: 50 },
      { id: "main", type: "text", textKey: "main", x: 0, y: 60, w: 100, h: 50 },
    ],
  } as unknown as Template;
  const openWith = (textFontIds?: object): void => {
    useProjectStore.setState({ templates: [tpl2] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_two_texts", ...(textFontIds ? { textFontIds } : {}),
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const clip = () => useTimelineStore.getState().doc!.clips[0];
  /** 種別の欄を開いて選ぶ。開く側（`button.select`）と選ぶ側（一覧の項目）を取り違えない。 */
  const pickFont = (fieldLabel: string, optionText: string): void => {
    const field = screen.getByText(fieldLabel).closest("label") as HTMLElement;
    fireEvent.click(field.querySelector("button.select") as HTMLElement);
    const option = [...field.querySelectorAll("button")].find(
      (b) => !b.classList.contains("select") && (b.textContent ?? "").startsWith(optionText),
    ) as HTMLElement;
    fireEvent.click(option);
  };

  it("1つ選び直しても、他の種別の指定は残る", () => {
    openWith({ title: "gen-interface-jp", main: "kaitou-yokoku-gothic" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("見た目パターン"));
    pickFont("本文の文字の形", "Gen Interface JP Display");
    expect(clip().textFontIds?.title).toBe("gen-interface-jp"); // 触っていない方は残る
    expect(clip().textFontIds?.main).toBe("gen-interface-jp-display");
  });

  it("最後の1つを「動画全体に合わせる」へ戻すと、指定ごと消える（空の入れ物を残さない）", () => {
    openWith({ title: "gen-interface-jp" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("見た目パターン"));
    pickFont("見出しの文字の形", "動画全体に合わせる");
    expect(clip().textFontIds).toBeUndefined();
  });

  it("いまの見た目パターンで使っていない種別でも、指定が残っていれば直せる", () => {
    openWith({ subtitle: "gen-interface-jp" }); // この見た目パターンに字幕の層は無い
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("見た目パターン"));
    expect(screen.getByText("字幕の文字の形")).toBeInTheDocument();
    // ⚠️ **断りも添える**（8巡目）＝理由なしに混ざると「触ったのに何も起きない」に見える。
    expect(screen.getByText(/いまの見た目パターンでは使っていない文字/)).toBeInTheDocument();
  });

  it("指定が無い種別の欄は出さない（使っていないものを並べない）", () => {
    openWith();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("見た目パターン"));
    expect(screen.queryByText("字幕の文字の形")).toBeNull();
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });

  // ⚠️ **見た目が未解決でも文字の形は直せる**（差分再監査 8巡目 🟡）＝門は見た目の解決に関係なく
  // 数えるので、欄ごと消すと「別の文字の形を選び直してください」がこの部品では実行できない。
  it("見た目パターンが見つからない部品でも、指定が残っていれば文字の形を直せる", () => {
    useProjectStore.setState({ templates: [] }); // 見た目が解決できない
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", fontId: "gen-interface-jp", textFontIds: { title: "kaitou-yokoku-gothic" },
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.getByText("見出しの文字の形")).toBeInTheDocument();
  });

  // ⚠️ **双子で見る**（差分再監査 9巡目 🟡）＝2つのフィールドをいつも一緒に有無させると、
  // 「部品ぜんぶの指定」と「種別ごとの指定」を取り違える回帰を検知できない。
  it("見た目が未解決でも、種別ごとの指定だけがあれば種別の欄は出る", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", textFontIds: { title: "kaitou-yokoku-gothic" }, // 部品ぜんぶの指定は無い
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しの文字の形")).toBeInTheDocument();
  });

  it("見た目が未解決で、部品ぜんぶの指定だけなら種別の欄は出さない", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", fontId: "gen-interface-jp", // 種別ごとの指定は無い
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.queryByText("見出しの文字の形")).toBeNull();
  });

  it("見た目が未解決でも、指定が無ければ欄は出さない", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_gone" }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 部品ぜんぶの欄は**無条件に出す**（解決できているときと同じ）＝状態で現れたり消えたりしない。
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.queryByText("見出しの文字の形")).toBeNull();
  });
});

// ⚠️ **何も変わらない操作は積まない**（α-6 出口監査 🟡・ADR-0032 決定）＝`commit` は同一参照で
// 弾く設計なのに、動画全体の設定は毎回作り直していたので**必ず別参照**になり、同じものを選び直す
// だけで取り消しが1つ埋まり、再生も止まっていた。
describe("動画全体の設定の空振り", () => {
  const openWithFont = (): void => {
    open({ videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: "gen-interface-jp" } } as never);
  };

  it("同じ値を書いても履歴が増えない・再生も止まらない", () => {
    openWithFont();
    useTimelineStore.setState({ isPlaying: true });
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ fontId: "gen-interface-jp" }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("違う値なら積む（変えたことは取り消せる）", () => {
    openWithFont();
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ fontId: "kaitou-yokoku-gothic" }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("入れ物の中身が同じなら積まない（音の自動処理のような組の設定）", () => {
    open({ videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, audioAuto: { duckBgm: true } } } as never);
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ audioAuto: { duckBgm: true } }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });
});

// 立ち絵に入れた動画（#809・α-6 出口監査 🔴1）。
//
// ⚠️ **プレビューが当てるアイテムを役割で絞ると、立ち絵は必ず外れる**（立ち絵のアイテムは
// `role:'character'`）＝プレビューは静止・元の音も無音なのに、書き出しは実映像＋元の音になる
// （ADR-0001 の破れ）。domain 側の鍵の一致だけでなく、**画面の経路**も固定する。
describe("立ち絵に入れた動画のプレビュー", () => {
  const charTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_char", name: "立ち絵つき", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "yuko", type: "character", x: 960, y: 0, w: 960, h: 1080 },
    ],
  } as unknown as Template;

  const openWithPose = (): void => {
    useProjectStore.setState({ templates: [charTemplate] });
    open({
      assets: [{ assetId: "asset_pose", assetType: "video", displayName: "立ち絵動画", filePath: "p.mp4", metadata: { hasAudio: true } }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: "tmpl_char",
        character: { enabled: true, characterId: "yuko", poseAssetId: "asset_pose" },
      }],
    } as never);
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { asset_pose: "blob:thumb_pose" },
        videoSrcById: { asset_pose: "blob:body_pose" },
      });
    });
  };

  it("実映像の窓が開く（代表フレームで静止させない）", () => {
    openWithPose();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const videos = [...container.querySelectorAll(".preview-stage video")] as HTMLVideoElement[];
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute("src")).toBe("blob:body_pose");
  });

  // ⚠️ **元の音の欄も出す**＝差し込み口だけに絞ると、書き出しにだけ効く設定になる。
  it("元の音の欄が出る（書き出しにだけ効く設定を作らない）", () => {
    openWithPose();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("ゆうこ（立ち絵）の動画の音")).toBeInTheDocument();
    expect(screen.getByText("この動画に入っている音を流す")).toBeInTheDocument();
  });

  // ⚠️ **押した結果まで固定する**（`/canon-check` 🔴）＝欄が出ることだけを見ていたので、
  // **書き込みが毎回断られている**（素材を `assetRefs` からしか探しておらず、立ち絵の素材は
  // `character.poseAssetId` にある）のを緑のまま通していた。描けることと**設定できる**ことは別。
  it("押すと設定が載る（欄は出るのに毎回断られる、を作らない）", () => {
    openWithPose();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const cb = screen.getByLabelText("この動画に入っている音を流す");
    act(() => { fireEvent.click(cb); });
    expect(useTimelineStore.getState().doc?.clips[0].slotClips).toEqual({ yuko: { useOriginalAudio: true } });
    // 断られていないこと＝理由が出ていない（出ていたら「音が入っていない」＝事実と違う理由）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });
});

// BGM を下げる区間を**つないだ**ことは、場面形式と同じように**タイムライン形式でも言う**
//（ADR-0026②・§2-5＝黙ってやると設定した意味と違う音になる）。ドメイン側の `duckMerged` の
// 算出は `export.test.ts` で固定済みなので、ここで見るのは**画面まで配線されているか**だけ
//（PR #922 範囲4 レビュー ℹ️＝配線のカバレッジが薄い）。
describe("TimelineProjectScreen: BGM を下げる区間をつないだ知らせ", () => {
  const done = (duckMerged: boolean) => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ exportRun: { phase: "done", percent: 100, message: "書き出しました。", cancelling: false, duckMerged } as never });
  };

  it("つないだときは出る（文言は場面形式と同じもの）", () => {
    done(true);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(DUCK_MERGED_MESSAGE)).toBeInTheDocument();
  });

  it("つないでいないときは出さない（毎回出すと意味が薄れる）", () => {
    done(false);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(DUCK_MERGED_MESSAGE)).toBeNull();
  });

  it("書き出しの途中では出さない（まだ結果が出ていない）", () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ exportRun: { phase: "running", percent: 50, message: null, cancelling: false, duckMerged: true } as never });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(DUCK_MERGED_MESSAGE)).toBeNull();
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
  });
});
