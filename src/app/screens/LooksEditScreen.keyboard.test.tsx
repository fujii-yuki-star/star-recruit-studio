// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Layer } from "../../domain/template/types";
import { NUDGE_GROUP_IDLE_MS } from "../hooks/keyboardShortcut";

// #788-3：見た目パターン編集のキャンバスは**掴んで動かせるのにキーでは動かせなかった**
//（#769 で揃えたのは `Escape`／`Ctrl+Z` の遮断まで＝矢印と `Delete` は結線されていなかった）。
// ADR-0034 決定19＝**ドラッグ専用の操作を作らない**。場面編集の自由配置と**同じ部品**（`KeyboardNudge`）へ乗せる。
//
// オーバーレイは差し替え、画面が渡す境界だけを叩く（この画面の既存テストと同じ流儀＝jsdom のレイアウト不在に依存しない）。
const captured = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../components/TemplateLayerOverlay", () => ({
  TemplateLayerOverlay: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

const { LooksEditScreen } = await import("./LooksEditScreen");

const userTemplate = {
  ...sampleTemplates[0],
  templateId: "user_tmpl_001",
  name: "マイ見た目",
  layers: [
    { id: "layer_a", type: "text", x: 100, y: 200, w: 400, h: 120, zIndex: 2, textKey: "title" },
    { id: "layer_b", type: "shape", x: 0, y: 0, w: 200, h: 200, zIndex: 1 },
    { id: "layer_c", type: "shape", x: 10, y: 10, w: 50, h: 50, zIndex: 3 },
  ],
} as unknown as (typeof sampleTemplates)[number];

describe("見た目パターン編集：キーでも動かせる・消せる（#788-3）", () => {
  beforeEach(() => {
    captured.props = null;
    useProjectStore.setState({
      templates: [userTemplate, ...sampleTemplates], assets: [], scenes: [], editingTemplateId: "user_tmpl_001",
    } as never);
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  const overlay = () => captured.props as unknown as { layers: Layer[]; onSelect: (id: string) => void };
  const layerOf = (id: string): Layer => overlay().layers.find((l) => l.id === id)!;
  const select = (id: string): void => { act(() => overlay().onSelect(id)); };
  const selectMany = (ids: string[]): void => {
    act(() => (captured.props as unknown as { onSelectMany: (x: string[]) => void }).onSelectMany(ids));
  };

  it("矢印キーで選んだ層が 1px 動く（Shift で 10px）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 101, y: 200 });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 101, y: 210 });
    expect(layerOf("layer_b")).toMatchObject({ x: 0, y: 0 }); // 選んでいない層は動かない
  });

  // ⚠️ **畳まれた後も、続けた矢印は1つの取り消しにまとまる**（#817 レビュー・PR #826 レビュー）＝
  // 取り消しは持ち主（矢印のまとめ）の都合と無関係に畳むので、持ち主が自前の印だけを見ていると
  // **1押下＝1履歴**になり、上限（50）を数秒で流し切る。この画面の履歴は**唯一の戻り道**なので、
  // 流し切ると残るのは「破棄して戻る」だけになる。
  // ⚠️ **実際のキーで再現する**＝フックを直に叩くと持ち主の印が立たず、この穴を再現できない
  //（タイムライン形式の同じテストと同じ理由・ADR-0026②）。
  it("取り消しでまとめが畳まれた後も、続けた矢印は1つの取り消しにまとまる", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" }); // 矢印がまとめを開く
    expect(layerOf("layer_a")).toMatchObject({ x: 101 });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); // 閉じる前に取り消す（持ち主は知らない）
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
    // 畳まれた後に3回。まとめ直せていれば、1回の取り消しで押す前へ戻る（見ていないと1回で1px ぶん）。
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 103 });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ **開き直しは1回だけ**＝押すたびに開き直すと深さが増え続け、**手が止まっても閉じきらない**
  //（後始末は1回ぶんしか閉じない）＝以後の編集が延々と同じ1手に混ざる。開いた時点の世代を控えて、
  // 「もう開いている」と分かるようにする。
  it("畳まれた後に開き直したまとめは、手が止まれば閉じる（以後は別の1手）", () => {
    vi.useFakeTimers();
    try {
      render(<LooksEditScreen onNavigate={vi.fn()} />);
      select("layer_a");
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "z", ctrlKey: true }); // 畳まれる
      for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
      act(() => { vi.advanceTimersByTime(NUDGE_GROUP_IDLE_MS + 10); }); // 手が止まる＝閉じる
      fireEvent.keyDown(window, { key: "ArrowRight" }); // 別の1手
      expect(layerOf("layer_a")).toMatchObject({ x: 104 });
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      expect(layerOf("layer_a")).toMatchObject({ x: 103 }); // 直前の1手だけ戻る（混ざっていない）
    } finally {
      vi.useRealTimers();
    }
  });

  it("Delete で選んだ層を消す（一覧の削除ボタンと同じ入口）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b", "layer_c"]);
  });

  // ⚠️ #802-4＝**矢印は選択ぜんぶ動くのに Delete だけ主の1枚**という割れがあった。
  // 場面編集の自由配置は「複数なら確認してからまとめて削除」なので、同じ部品・同じキーで揃える
  // （ADR-0026②）。⚠️ **確認してから**＝押した瞬間に複数消えない。
  it("複数選んでいるときの Delete は、確認してからまとめて消す", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_c"]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_a", "layer_b", "layer_c"]); // まだ消えない
    expect(screen.getByText(/2件をまとめて削除しますか/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("削除する"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]); // 選んだ分だけ消える
  });

  // ⚠️ **全部選んだときは確認を出さず、理由を出す**（レビュー 🔴・§2-5）＝確認を出しておいて
  // 「削除する」を押しても何も起きない、が一番わるい（約束を黙って破る）。
  // 断り方は隣のグループ削除（`groupDeleteBlockedReason`）と同型に揃える。
  it("全部選んでまとめて削除しようとすると、確認を出さずに理由を出す（1枚も消えない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_b", "layer_c"]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.queryByText("削除する")).toBeNull(); // 確認は出さない
    expect(screen.getByText(/全部が消えてしまうため削除できません/)).toBeInTheDocument();
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_a", "layer_b", "layer_c"]);
  });

  // ⚠️ **断りは「その選択のもの」**＝選び直したら引っ込む（前の選択への理由が居座らない）。
  it("選び直して消せるようになったら、断りの文は引っ込む", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_b", "layer_c"]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/全部が消えてしまうため削除できません/)).toBeInTheDocument();
    selectMany(["layer_a", "layer_b"]); // 1枚残る選択へ変える
    expect(screen.queryByText(/全部が消えてしまうため削除できません/)).toBeNull();
    // ⚠️ **空の知らせも残さない**＝文だけ消して入れ物を残すと、読み上げは「何か起きた」と告げるのに中身が無い。
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.click(screen.getByText("削除する"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_c"]);
  });

  // ⚠️ **「最後に触ったのがロック層か」で結果を割らない**（ADR-0026②）。
  // 矢印は選択のうち動かせるものを動かすのに、`Delete` だけ主の1枚の固定で可否が決まっていた
  // ＝同じ見た目の選択なのに、選んだ順で消せたり消せなかったりする。
  it("固定した部品を混ぜても、選んだ順に関わらず消せる分だけ消える", () => {
    useProjectStore.setState({
      templates: [{
        ...userTemplate,
        layers: [
          { id: "layer_a", type: "shape", x: 0, y: 0, w: 10, h: 10, zIndex: 1 },
          { id: "layer_b", type: "shape", x: 0, y: 0, w: 10, h: 10, zIndex: 2 },
          { id: "layer_d", type: "shape", x: 0, y: 0, w: 10, h: 10, zIndex: 4 },
        ],
        groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, locked: true }],
      }, ...sampleTemplates],
      assets: [], scenes: [], editingTemplateId: "user_tmpl_001",
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_d", "layer_a"]); // ⚠️ **最後に選んだのが固定の層**（ここで押せなくなっていた）
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/ロック中のまとまりに入っている分は残ります/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("削除する"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_a", "layer_b"]); // 固定の a は残る・d だけ消える
  });

  // ⚠️ **確認している間に中身が変わったら、確認をやり直す**（レビュー 🟡・§2-5）＝一覧の「削除」も
  // 取り消しも確認中に効く。出したままにすると①相手のいない確認が残り②取り消しで**押していないのに
  // 確認が生き返る**。確認は「いまの中身」への問いなので、変わったら聞き直す。
  it("確認中に中身が変わったら、確認はやり直しになる", () => {
    // 行の名前が重ならない下書きにする（一覧の「削除」を名指しで押すため）。
    useProjectStore.setState({
      templates: [{
        ...userTemplate,
        layers: [
          { id: "layer_a", type: "text", x: 0, y: 0, w: 10, h: 10, zIndex: 1, textKey: "title" },
          { id: "layer_b", type: "text", x: 0, y: 0, w: 10, h: 10, zIndex: 2, textKey: "main" },
          { id: "layer_c", type: "shape", x: 0, y: 0, w: 10, h: 10, zIndex: 3 },
        ],
      }, ...sampleTemplates],
      assets: [], scenes: [], editingTemplateId: "user_tmpl_001",
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    /** 一覧のその行の「削除」を押す（行は「前面へ」の呼び名で見分ける）。 */
    const removeRow = (name: string): void => {
      const row = screen.getByLabelText(`${name}を前面へ`).closest("div")!;
      fireEvent.click(within(row).getByTitle("この要素を削除"));
    };
    selectMany(["layer_a", "layer_b"]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/2件をまとめて削除しますか/)).toBeInTheDocument();
    removeRow("文字（見出し）"); // 別経路で中身を変える
    expect(screen.queryByText(/まとめて削除しますか/)).toBeNull(); // 確認は畳む（数だけ減らして続けない）
    // ⚠️ 取り消しで中身が戻っても**確認は生き返らない**（押していない確認を出さない）。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_a", "layer_b", "layer_c"]);
    expect(screen.queryByText(/まとめて削除しますか/)).toBeNull();
    // ⚠️ **取り消しそのものも確認を畳む**（下書きを変える入口なので同じ扱い）＝
    // 確認を出したまま戻すと、聞いた中身と違うものを消すことになる。
    selectMany(["layer_a", "layer_b"]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/2件をまとめて削除しますか/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); // 直前の削除を戻す
    expect(screen.queryByText(/まとめて削除しますか/)).toBeNull();
    // 畳んだあともキーは死んでいない（門が「見えているか」を見る＝理由なく操作不能にならない）。
    selectMany(["layer_a"]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 1 });
  });

  // ⚠️ **門は「持っている状態」ではなく「見えているか」を見る**（レビュー 🟡）。
  // まとまりの削除確認は id で持ち、別のものを選ぶと**確認だけ引っ込む**（画面の既定の作り）。
  // 状態で門を作ると、その後キーが全部死ぬのに画面には理由が何も出ない（一番わかりにくい壊れ方）。
  it("引っ込んだ確認でキーが死なない（まとまりの削除確認を出したあと別のものを選ぶ）", () => {
    useProjectStore.setState({
      templates: [{
        ...userTemplate,
        groups: [{ id: "group_001", members: ["layer_b"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
      }, ...sampleTemplates],
      assets: [], scenes: [], editingTemplateId: "user_tmpl_001",
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    act(() => (captured.props as unknown as { onSelectGroup: (id: string) => void }).onSelectGroup("group_001"));
    // まとまりの欄側の「削除」（一覧の行にも同名があるので、呼び名の無いほうを選ぶ）
    fireEvent.click(screen.getAllByTitle("グループを中身ごと削除（中の要素も消えます）")
      .find((b) => !b.getAttribute("aria-label"))!);
    expect(screen.getByText(/このグループを中身ごと削除しますか/)).toBeInTheDocument();
    select("layer_a"); // まとまりの選択が外れる＝確認は引っ込む（が、id は持ったまま）
    expect(screen.queryByText(/このグループを中身ごと削除しますか/)).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 101 }); // キーは生きている
  });

  // ⚠️ **枚数で規則を割らない**（レビュー 🟡・ADR-0026②）＝1枚のときだけ「実在するか」を見ないと、
  // 取り消しで消えた層が選択に残ったまま `Delete` を奪い、何も起きないうえ**空の取り消しが1つ積まれる**。
  it("もう無い層が1枚だけ選ばれていても、Delete を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" }); // 先に**実のある編集**を1つ積む
    expect(layerOf("layer_a")).toMatchObject({ x: 101 });
    const before = overlay().layers.map((l) => l.id);
    selectMany(["layer_gone"]); // 下書きに無い1枚だけを選んだ状態
    // ⚠️ **キーを奪ったかどうか**を直接見る＝奪って何も起きないのが、この割れの症状そのもの
    //（奪ったうえで空の取り消しまで積み、この画面唯一の戻り道を1手ぶん食う）。
    const ev = new KeyboardEvent("keydown", { key: "Delete", cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(overlay().layers.map((l) => l.id)).toEqual(before); // 何も消えない
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 }); // 戻り道も食われていない
  });

  // ⚠️ **もう無い層を数えない**（レビュー ℹ️）＝取り消しで層が戻ると、選択にはその id が残る。
  // 数えてしまうと件数が嘘になり、「最低1枚」の判定も過剰に効いて**消せるはずの削除が断られる**。
  it("選択に残った古い部品は数えない（消せる分だけで判断する）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_b", "layer_gone"]); // layer_gone はもう下書きに無い
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/2件をまとめて削除しますか/)).toBeInTheDocument(); // 3件ではない・断られない
    // ⚠️ **事実と違う理由を出さない**（レビュー 🟡）＝ロックが1つも無いのに「ロック中の…」と言わない
    //（言われた利用者は、存在しないロックを探すことになる）。
    expect(screen.queryByText(/ロック中のまとまりに入っている分は残ります/)).toBeNull();
    fireEvent.click(screen.getByText("削除する"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_c"]);
  });

  // ⚠️ **消すのは「確認した集合」**（レビュー 🔴）＝確認中に選び直しても、確認していないものは消さない。
  // boolean で持つと「押した瞬間の選択」を消す＝この画面が隣のグループ削除で一度潰した事故と同じ。
  it("確認している間に選び直しても、確認した分だけを消す", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_c"]);
    fireEvent.keyDown(window, { key: "Delete" });
    selectMany(["layer_b"]); // 確認中に選び直す
    fireEvent.click(screen.getByText("削除する"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]); // b は消えない・a と c が消える
  });

  it("まとめて削除は「やめる」で何も消えない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    selectMany(["layer_a", "layer_c"]);
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.click(screen.getByText("やめる"));
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_a", "layer_b", "layer_c"]);
  });

  // ⚠️ **最後の1枚は消さない**（`template.schema` の `layers.minItems:1`＝一覧の削除ボタンと同じ制約）。
  // ⚠️ 消せないときは **`Delete` を奪わない**ところまで見る＝奪って何も起きないと「効かないキー」になる
  // （決定5＝行き止まりを作らない）。消えないことだけ見ても、内側の守りが効いているだけかもしれない。
  it("最後の1枚では Delete を奪わない（押しても何も起きないキーを作らない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    // 消せるときは奪う（`fireEvent` は既定を止めると false を返す）。
    expect(fireEvent.keyDown(window, { key: "Delete" })).toBe(false);
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b", "layer_c"]);

    select("layer_c");
    expect(fireEvent.keyDown(window, { key: "Delete" })).toBe(false);
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]);

    select("layer_b"); // 残り1枚＝消せない
    expect(fireEvent.keyDown(window, { key: "Delete" })).toBe(true); // 奪わない
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]);
  });

  // ⚠️ **打っている最中は奪わない**（共通判定＝`isTextEntryTarget`）。奪うと名前を打っている途中で層が動く。
  it("入力欄に打っている間は矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(screen.getByDisplayValue("マイ見た目"), { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ レビュー指摘＝このPRのコメントが明示した仕様（まとまりごと動く）が丸ごと無テストだった。
  it("まとまりを選んでいるときは、まとまりごと動く（中の層の座標は変えない）", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    act(() => (captured.props as unknown as { onSelectGroup: (id: string) => void }).onSelectGroup("group_001"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const groups = (captured.props as unknown as { groups: { id: string; transform: { x: number; y: number } }[] }).groups;
    expect(groups[0].transform).toMatchObject({ x: 1, y: 0 }); // まとまりが動く
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });      // 中の層の座標はそのまま
  });

  // ⚠️ **固定したまとまりは動かさない**＝掴んで動かす方は固定なら選ぶだけで止まる。
  // キーだけ通ると「掴めないのにキーでは動く」になる（同じ理由で入口ごとに結果が変わる）。
  it("固定したまとまりは矢印でも動かない", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, locked: true }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    act(() => (captured.props as unknown as { onSelectGroup: (id: string) => void }).onSelectGroup("group_001"));
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(true); // 奪わない
    const groups = (captured.props as unknown as { groups: { transform: { x: number } }[] }).groups;
    expect(groups[0].transform.x).toBe(0);
  });

  // ⚠️ **固定したまとまりの中の層も動かさない**（一覧から個別に選べてしまうため）。
  it("固定したまとまりの中の層は、個別に選んでも矢印で動かない", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, locked: true }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ 何も選んでいないときに奪うと、欄のスクロールが効かないのに何も起きない（行き止まり）。
  it("何も選んでいないときは矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(true);
  });

  // ⚠️ **変換中は奪わない**の配線（レビュー指摘＝共通判定は単体試験済みだが、繋がっているかは未検証だった）。
  it("日本語を変換している最中は矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight", isComposing: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  it("取り消しで戻せる（キーで動かした結果も履歴に載る）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 101 });
    fireEvent.click(screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement);
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ **押しっぱなしでも取り消しは1回ぶん**（`06 §12.1` 決定20＝タイムラインと同じ）。
  // 1打鍵ごとに積むと、キーリピートで履歴の上限を数秒で流し切り、**この画面唯一の戻り道**が消える。
  it("続けて押したぶんは1回の取り消しでまとめて戻る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 103 });
    fireEvent.click(screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement);
    expect(layerOf("layer_a")).toMatchObject({ x: 100 }); // 3回ぶんが1回で戻る
  });
});
