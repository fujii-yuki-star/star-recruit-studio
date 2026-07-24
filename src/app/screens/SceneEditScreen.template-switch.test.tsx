// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// ADR-0030 Option A：FREE→通常の切替で**動画に出なくなる中身がある場合**に確認を出し、確定するまで切替えない
// （#524 P1/P2。当初は「素材が復元できない場合だけ」＝1枚でも復元されれば確認が出ず無言消失した＝#547 P2-9 で改定）。
// カスタムテンプレ（16:9）でピッカーを制御。FREE 場面は pickableTemplatesForScene で全カテゴリが候補に出る。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, layers: [{ id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
} as unknown as Template;
const normalTemplate = {
  schemaVersion: "1.0", templateId: "photo_v1", name: "写真", category: "photo_intro", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, layers: [{ id: "mainVisual", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
} as unknown as Template;
const openTemplate = {
  schemaVersion: "1.0", templateId: "open_v1", name: "オープニング", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 200 }],
} as unknown as Template;

const freeScene = (partial: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "none" }, warnings: [], ...partial,
  }) as unknown as Scene;

function setup(scene: Scene) {
  useProjectStore.setState({
    templates: [freeTemplate, normalTemplate, openTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

const withSlot = () => freeScene({ freeLayout: [{ id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "a" }] } as Partial<Scene>);
const picker = () => screen.getByLabelText("見た目パターン");
const CONFIRM = /動画に出なくなります/;
/** 確認中に中身を消して0件になったときの文言（確認自体は答えるまで残る＝PR #592 レビュー）。 */
const CONFIRM_NONE = /出なくなる中身はありません/;

describe("SceneEditScreen 見た目切替の確認（ADR-0030 Option A・#524 P1/P2）", () => {
  it("ネイティブFREE→通常：確認表示・キャンセルで未変更・確定で切替", () => {
    setup(withSlot()); // 自由配置あり・通常配置（assetRefs）なし＝復元できない
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy(); // 確認が出る
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // まだ切替えない

    fireEvent.click(screen.getByText("やめる"));
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // 未変更

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    fireEvent.click(screen.getByText("通常の見た目に変える"));
    const s = useProjectStore.getState().scenes[0];
    expect(s.templateId).toBe("photo_v1"); // 確定で切替
    expect(s.sceneType).toBe("photo_intro"); // カテゴリ追従
  });

  it("往復しただけ（自由配置の中身が全部復元される）：確認なしで即切替＋通常配置が復元", () => {
    // 通常→FREE→通常。FREE 要素の素材と、復元される休眠 assetRefs の素材が**同じ**＝見た目が保たれる。
    setup(freeScene({
      freeLayout: [{ id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v" }],
      assetRefs: { mainVisual: "asset_v" },
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.queryByText(CONFIRM)).toBeNull(); // 出なくなる中身が無いので確認は出ない
    const s = useProjectStore.getState().scenes[0];
    expect(s.templateId).toBe("photo_v1"); // 即切替
    expect(s.assetRefs.mainVisual).toBe("asset_v"); // 通常配置が復元
  });

  // #547 P2-9：以前は「復元される休眠配置があるか」だけで判定していたため、**1枚でも復元されれば確認が出ず**、
  // FREE で足した分が無言で動画から消えていた（ADR-0026④）。復元の有無ではなく「超過した中身の数」で判断する。
  it("復元される素材があっても、FREE で足した分が出なくなるなら確認を出す（#547 P2-9）", () => {
    setup(freeScene({
      freeLayout: [
        { id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v" }, // 復元される
        { id: "free_002", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_extra" }, // FREE で追加
        { id: "free_003", kind: "text", x: 0, y: 0, w: 100, h: 100, text: "足した文字" },
      ],
      assetRefs: { mainVisual: "asset_v" },
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    // 何がいくつ出なくなるかを示す（「素材が消える」とだけ言って文字の消失に気づけない、を作らない）。
    const notice = screen.getByText(CONFIRM);
    expect(notice.textContent).toContain("素材1個");
    expect(notice.textContent).toContain("文字1個");
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // まだ切替えない
  });

  // 通常場面の休眠 freeLayout（往復して戻ってきた場面）は描画されない＝通常→通常の切替では確認を出さない。
  it("いま自由配置を出していない場面（通常→通常）は、休眠中の自由配置があっても確認を出さない", () => {
    setup(freeScene({
      sceneType: "photo_intro", templateId: "photo_v1", // すでに通常テンプレ＝自由配置は休眠
      freeLayout: [{ id: "free_001", kind: "shape", x: 0, y: 0, w: 100, h: 100, shapeType: "rect" }],
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("種類"), { target: { value: "opening" } });
    expect(screen.queryByText(CONFIRM)).toBeNull(); // 出ていないものは「出なくなる」と言わない
    expect(useProjectStore.getState().scenes[0].templateId).toBe("open_v1"); // 即切替
  });

  it("確認中に別の見た目（何も隠れないもの）を選ぶと、古い確認は残らない", () => {
    // FREE・自由配置は素材1つで、通常テンプレ photo_v1 の差し込み先へ復元できる（＝photo_v1 へは何も隠れない）。
    // 一方 open_v1 は差し込み先が無いので隠れる＝確認が出る。
    setup(freeScene({
      freeLayout: [{ id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v" }],
      assetRefs: { mainVisual: "asset_v" },
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "open_v1" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy();

    // 隠れる中身が無い photo_v1 を選ぶ＝即適用される。古い確認を残すと、押したときに
    // **適用済みとは別のテンプレ**（open_v1）へ切り替わってしまう。
    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(useProjectStore.getState().scenes[0].templateId).toBe("photo_v1");
    // ピッカーの表示も適用後のものになる（確認待ちが残ると、選んでいない open_v1 を指したままになる・#532）。
    expect((picker() as HTMLSelectElement).value).toBe("photo_v1");
  });

  // 件数は毎レンダ数え直して**文言**へ反映するが、確認そのものは答えるまで消さない（ADR-0030 決定3・PR #592 レビュー）。
  // 表示を件数に連動させると、中身を消したあと足し直した／取り消しで戻しただけで**触ってもいない確認が蘇り**、
  // 選択表示が選んでいない見た目へ跳ぶ（#532「選んだのに元へ戻った」と同型）。
  it("確認中に中身を消すと文言だけ変わり、足し直しても確認は蘇らない（ずっと同じ確認）", () => {
    setup(withSlot());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy();

    act(() => {
      useProjectStore.setState((st) => ({
        scenes: st.scenes.map((sc) => ({ ...sc, freeLayout: [] })),
      }));
    });
    // 失う物が無くなったら「出なくなります」とは言わない（嘘の警告を出さない・ADR-0026①）。
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(screen.getByText(CONFIRM_NONE)).toBeTruthy();
    // 確認は消えていない＝選んだ先を指したまま・切替はまだ起きない（勝手に切り替えも取り下げもしない）。
    expect((picker() as HTMLSelectElement).value).toBe("photo_v1");
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1");

    // 消した中身を足し直す（取り消しで戻したときと同じ）。ここで確認が湧き直すと、触ってもいないのに
    // 選択表示が跳ぶ。上で確認が消えていないので、ここは「同じ確認が続いている」だけになる。
    act(() => {
      useProjectStore.setState((st) => ({
        scenes: st.scenes.map((sc) => ({ ...sc, freeLayout: withSlot().freeLayout })),
      }));
    });
    expect(screen.getByText(CONFIRM)).toBeTruthy();
    expect((picker() as HTMLSelectElement).value).toBe("photo_v1");

    // 「やめる」でいつでも抜けられる＝選択表示も実際の見た目へ戻る。
    fireEvent.click(screen.getByText("やめる"));
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(screen.queryByText(CONFIRM_NONE)).toBeNull();
    expect((picker() as HTMLSelectElement).value).toBe("free_v1");
  });

  // 0件でも確認のボタンは残す＝「選んだのに切り替えられない」行き止まりを作らない（同じ値の選び直しでは
  // 変更イベントが出ないので、ボタンを引っ込めると切替える手立てが無くなる）。
  it("確認中に中身を消して0件になっても、そのまま切り替えられる", () => {
    setup(withSlot());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    act(() => {
      useProjectStore.setState((st) => ({
        scenes: st.scenes.map((sc) => ({ ...sc, freeLayout: [] })),
      }));
    });
    expect(screen.getByText(CONFIRM_NONE)).toBeTruthy();

    fireEvent.click(screen.getByText("通常の見た目に変える"));
    expect(useProjectStore.getState().scenes[0].templateId).toBe("photo_v1");
  });

  it("確認中に今の見た目を選び直すと、確認は消える（元へ戻せる）", () => {
    setup(withSlot());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy();

    // いまの見た目（free_v1）を選び直す＝切替をやめた。確認が残ると選択表示が候補へ跳ね戻り、元へ戻せない。
    fireEvent.change(picker(), { target: { value: "free_v1" } });
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect((picker() as HTMLSelectElement).value).toBe("free_v1");
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1");
  });

  it("図形（飾り）だけの自由配置でも確認を出す（通常テンプレに受け皿が無い）", () => {
    setup(freeScene({
      freeLayout: [{ id: "free_001", kind: "shape", x: 0, y: 0, w: 100, h: 100, shapeType: "rect" }],
      assetRefs: { mainVisual: "asset_v" },
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.getByText(CONFIRM).textContent).toContain("図形1個");
  });
});

describe("SceneEditScreen 種類（カテゴリ）変更（#528）", () => {
  const photoScene = (): Scene =>
    ({
      sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
      templateId: "photo_v1", durationSec: 8, assetRefs: {},
      character: { enabled: false, characterId: "yuko" }, texts: {},
      narration: { text: "こんにちは", status: "none" }, warnings: [],
    }) as unknown as Scene;

  it("種類を変えると、その種類の先頭の見た目へ直接切り替わる（オープニング固定を解く）", () => {
    setup(photoScene());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("種類"), { target: { value: "opening" } });
    const s = useProjectStore.getState().scenes[0];
    expect(s.sceneType).toBe("opening"); // カテゴリ変更
    expect(s.templateId).toBe("open_v1"); // その種類の先頭テンプレへ直接切替
    expect(screen.queryByText(CONFIRM)).toBeNull(); // 通常→通常は確認なし
  });

  it("種類で FREE→通常（自由配置あり・復元不可）は確認が出て、確定するまで切替えない＋選択表示を保持（#532）", () => {
    setup(withSlot()); // FREE 場面・自由配置あり・assetRefs なし＝復元できない
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const kind = screen.getByLabelText("種類") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "photo_intro" } }); // 種類経由で FREE→通常
    expect(screen.getByText(CONFIRM)).toBeTruthy(); // 確認が出る
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // まだ切替えない
    expect(kind.value).toBe("photo_intro"); // 確認待ちでも選んだ先を保持表示（「戻った」を防ぐ・#532 レビュー）

    fireEvent.click(screen.getByText("通常の見た目に変える"));
    const s = useProjectStore.getState().scenes[0];
    expect(s.sceneType).toBe("photo_intro"); // 確定で切替
    expect(s.templateId).toBe("photo_v1");
  });

  // 「いまのを選び直したら確認を解く」を見た目ピッカーだけに入れると、同じ概念のもう一方のセレクタに
  // 「選んだのに元へ戻った」（#532）が残る＝同概念同挙動（ADR-0026②）。
  it("確認中に今の種類を選び直すと確認は消える（見た目ピッカーと同じ挙動）", () => {
    setup(withSlot());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const kind = screen.getByLabelText("種類") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "photo_intro" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy();
    expect(kind.value).toBe("photo_intro"); // 確認待ちは選んだ先を保持表示

    fireEvent.change(kind, { target: { value: "free" } }); // いまの種類＝切替をやめた
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(kind.value).toBe("free"); // 選んだとおりに戻る（候補へ跳ね戻らない）
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1");
  });
});
