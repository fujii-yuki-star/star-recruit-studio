// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。開けないときの案内と、並び・選択の見せ方を固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { pointerDownAt } from "../../test/pointer";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { VOLUME_POINTS_MAX } from "../../domain/constants";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";

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
    const names = screen.getAllByText(/^(映像|音)\d$/).map((el) => el.textContent);
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
    expect(screen.getByText("まだ何も置かれていません。")).toBeInTheDocument();
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
    expect(screen.getByText("再生").getAttribute("title")).toContain("まだ部品を置いていない");
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
    fireEvent.pointerMove(window, { clientX: 250, clientY: 95, pointerId: 1 }); // 「仕上がり確認」の下寄り
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
    expect(screen.getByLabelText("置く列")).toBeDisabled();
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
