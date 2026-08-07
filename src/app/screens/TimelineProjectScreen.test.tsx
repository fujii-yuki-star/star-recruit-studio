// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。開けないときの案内と、並び・選択の見せ方を固定する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pointerDownAt } from "../../test/pointer";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { VOLUME_POINTS_MAX } from "../../domain/constants";
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
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("見た目パターンが見つからない部品が1個あります"))).toBe(true);
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
    fireEvent.click(screen.getByRole("menuitem", { name: "この列を消す" }));
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
    fireEvent.click(screen.getByText("選んだ2個を消す"));
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
    useTimelineStore.setState({ generatingVoiceClipId: "clip_009" });
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
  it("書き出しの導線を出し、押すと書き出しが走る", () => {
    open();
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    const exportTimelineVideo = vi.fn().mockResolvedValue(undefined);
    useTimelineStore.setState({ exportTimelineVideo });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    expect(exportTimelineVideo).toHaveBeenCalledWith({ templates: [], templateAssetSrcById: {} });
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

  it("動画は選べない（動かず音も鳴らないので、選べるのに使えない選択肢を出さない）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("写真A");
    expect(select?.textContent).not.toContain("動画B");
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
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("この部品を置き直してください"))).toBe(true);
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

  it("入っている動画は名前を出す（「なし」と見分けが付く）", () => {
    openWithTemplateClip();
    useTimelineStore.setState({
      doc: { ...useTimelineStore.getState().doc!, clips: [{ ...useTimelineStore.getState().doc!.clips[0], assetRefs: { mainVisual: "asset_002" } }] },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("動画B");
    expect(select?.querySelector('option[value="asset_002"]')).toBeDisabled();
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
    expect(screen.getByText(/この形式ではまだ動画を使えません/)).toBeInTheDocument();
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
    expect(btn.title).toBe("書き出しが終わってから編集できます");
  });

  it("断られたときは入れた値を消さない（音量の変化と同じ規準）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("横のずれ（px）");
    fireEvent.change(input!, { target: { value: "200" } });
    // 置く直前に書き出しが始まった＝store が断る経路（ボタンの disabled をすり抜けた場合）。
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
    expect(useTimelineStore.getState().editBlocked).toBe("TIMELINE_EDIT_EXPORTING");
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
    fireEvent.contextMenu(screen.getByText("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出さない" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "この列を消す" })).toBeInTheDocument();
  });

  it("メニューから操作でき、選ぶと閉じる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("映像1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "動画に出さない" }));
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.hidden).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("いまの状態で意味が通る言い方にする（出していない列は「動画に出す」）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出す" })).toBeInTheDocument();
  });
});

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

  it("置けなかった理由は**編集の下**に出て、恒常の警告より前に来る（返事が画面外へ落ちない）", () => {
    // **恒常の警告（見た目パターンが見つからない）を出したうえで**置けない操作をする＝
    // 「返事が警告に押し流されない」を実際に確かめる（警告が無いと順序の確認が空振りする）。
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
    fireEvent.click(screen.getByText("再生位置へ")); // clip_001（0〜5秒）と重なる＝置けない
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("ずらすか、列を足して重ねて"));
    expect(notice).toBeDefined();
    const layoutArea = container.querySelector(".panel-layout")!;
    // DOM の並びで**欄の後ろ**にあること＝上に積まれていない。
    expect(layoutArea.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // **その場の返事は貼り付けて常に見える**（下へ流すと恒常の警告に押されて画面外に落ちる）。
    expect(notice!.classList.contains("timeline-flash")).toBe(true);
    // 欄の後ろに並ぶ知らせのうち**先頭**であること（恒常の警告はその後ろ）。
    // ※ 兄弟セレクタ（`~`）では見られない＝その場の返事は欄と同じ囲いの中、恒常の警告は囲いの外にある。
    // **欄の中にある知らせは数えない**（欄の中身も notice を使う）。入れ子は「後ろ」とも判定されるため。
    const afterLayout = [...container.querySelectorAll(".notice-warn")].filter(
      (el) => !layoutArea.contains(el) && layoutArea.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(afterLayout.length).toBeGreaterThan(1); // 恒常の警告も出ている＝順序の確認が空振りしない
    expect(afterLayout[0]).toBe(notice);
    // **貼り付く知らせは欄と同じ囲いの中**＝下の操作の行を覆わない（覆うと戻る導線が押せなくなる）。
    const zone = container.querySelector(".timeline-flash-zone")!;
    expect(zone.contains(notice!)).toBe(true);
    expect(zone.contains(screen.getByText("動画の一覧へ"))).toBe(false);
    expect(zone.contains(screen.getByRole("button", { name: "取り消す" }))).toBe(false);
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
    expect(useTimelineStore.getState().editBlocked).toBe("TIMELINE_EDIT_LOCKED"); // 理由を出す
  });

  it("選ぶと、前の部品で出た理由は消える（いまの部品の返事に見せない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ editBlocked: "TIMELINE_EDIT_OVERLAP", voiceError: "声を作れませんでした。" });
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
    expect(speed.title).toBe("書き出しが終わってから編集できます");
    const del = screen.getByRole("button", { name: "消す" });
    expect(del).toBeDisabled();
    expect(del.title).toBe("書き出しが終わってから編集できます");
    expect(screen.getByRole("button", { name: "同じものを足す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "映像の列を足す" })).toBeDisabled();
  });

  it("固定した列のほうを先に出す（直せる順に理由を出す）", () => {
    withBgmClip({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("速さ（倍）").title).toBe("この列は固定されています。変えるには固定を外してください");
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
    expect(within(inSelected).getByLabelText("置く列")).toBeDisabled();
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
    fireEvent.click(screen.getByRole("menuitem", { name: "この列を消す" }));
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
    const del = screen.getByRole("button", { name: "選んだ2個を消す" });
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
        // 動画は置けても書き出しの手前で断られる＝選べるのに使えない選択肢を並べない（ADR-0032 決定23）。
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
    expect(screen.queryByText("紹介ムービー")).not.toBeInTheDocument(); // 動画も出さない（使えない選択肢を並べない）
    fireEvent.click(screen.getByText("会社の外観"));
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ kind: "slot", assetId: "asset_001" });
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
    expect(screen.getByRole("button", { name: /写真・動画を取り込む/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字を置く" })).toBeInTheDocument(); // できることは残る
  });

  it("置ける列が無くても取り込める（列を足すまで素材を用意できない、を作らない・#712）", () => {
    withAsset({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /写真・動画を取り込む/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", "書き出しが終わってから編集できます");
    expect(screen.getByText("フォント").parentElement?.querySelector("button")).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", "この列は固定されています。変えるには固定を外してください");
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
    const trigger = screen.getByText("フォント").parentElement?.querySelector("button") as HTMLElement;
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
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 1, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
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
    // 「選んだ部品」の欄の「置く列」（同じ名前の欄が置く側にもあるので、欄で絞る）。
    const panel = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    const select = within(panel).getByLabelText("置く列");
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
    expect(screen.getByText("選んだ2個の部品を消しますか？")).toBeInTheDocument();
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
    expect(screen.getByText("選んだ2個の部品を消しますか？")).toBeInTheDocument();
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

  it("Delete も固定した列の部品は消せない（ボタンと同じ関門を通る）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    // **押してから断られる、にもしない**＝画面側の関門で止まるので、断り文は出ない
    //（store の二重防御まで届くと `TIMELINE_EDIT_LOCKED` が立ち、消えないうえに理由だけ出る）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    // 理由はボタンの側に、押す前から出ている（押せないことも一緒に見る）。
    expect(screen.getByRole("button", { name: "消す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "消す" }).getAttribute("title")).toContain("固定を外すか");
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
  const trigger = () => screen.getByText("フォント").closest("label")?.querySelector("button") as HTMLElement;
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
    expect(screen.getByRole("menuitem", { name: "同じものを足す" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "消す" })).toBeInTheDocument();
  });

  it("「⋮」からも同じメニューが出る（右クリックが使えない人の逃げ道）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字の操作" }));
    expect(screen.getByRole("menuitem", { name: "同じものを足す" })).toBeInTheDocument();
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

  it("まとめて選んでいるときは「同じものを足す」を押せなくする（押しても無反応、を作らない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    // 複製は「選択がちょうど1件」でないと store が何もせず、理由も持たない＝黙って効かない。
    const dup = screen.getByRole("menuitem", { name: "同じものを足す" });
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
    expect(screen.getByRole("menuitem", { name: "選んだ2個を消す" })).toBeInTheDocument();
  });

  it("固定した列の帯では、消す・複製を押せなくして理由を出す", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "文字" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    const del = screen.getByRole("menuitem", { name: "消す" });
    expect(del.hasAttribute("disabled") || del.getAttribute("aria-disabled") === "true").toBe(true);
    expect(del.getAttribute("title")).toContain("固定");
    // 固定の理由は「選んだ部品」の欄と**同じ言い方**にする（同じ状態を場所で言い分けない）。
    const dup = screen.getByRole("menuitem", { name: "同じものを足す" });
    expect(dup.getAttribute("title")).toBe("この列は固定されています。変えるには固定を外してください");
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

  it("重なる所へ落としても**寄せずに元のまま**（決定10）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4); // 4秒＝[4,7) は [5,8) と重なる
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    // ⚠️ **断り文も出さない**＝掴んでいる間に色で示しているので、離してから理由を出すのは
    // 「押してから断る」になる（store の二重防御まで届くと `editBlocked` が立つ）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });

  it("掴んでいる間は置けないことを見た目で示す（離してから知らせない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4, { drop: false });
    expect(band("あ").className).toContain("drop-target--blocked");
    expect(band("あ").className).toContain("timeline-clip--dragging");
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
