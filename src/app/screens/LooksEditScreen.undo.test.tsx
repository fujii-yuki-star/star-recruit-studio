// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksEditScreen } from "./LooksEditScreen";

// #547 P2-3：テンプレ作成エディタにも取り消す/やり直すを用意する。編集は画面ローカル下書きなので store の Undo
// （ADR-0020）は使えず、#547 P1-1 でこの画面を store Undo の対象から外した結果、復旧手段が「破棄して戻る」しか
// 無かった＝1回の誤操作で全編集の破棄を迫られる。局所履歴で場面編集・タイムライン編集と挙動を揃える（ADR-0026②）。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

describe("LooksEditScreen 下書きの取り消し/やり直し（#547 P2-3）", () => {
  let origUndo: () => void;
  let origDelete: ReturnType<typeof useProjectStore.getState>["deleteUserTemplate"];
  beforeEach(() => {
    origUndo = useProjectStore.getState().undo;
    origDelete = useProjectStore.getState().deleteUserTemplate;
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });
  afterEach(() => {
    useProjectStore.setState({ undo: origUndo, deleteUserTemplate: origDelete });
    vi.restoreAllMocks();
  });

  const undoBtn = (): HTMLButtonElement => screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement;
  const redoBtn = (): HTMLButtonElement => screen.getByLabelText("やり直す").closest("button") as HTMLButtonElement;

  it("編集前は取り消せない／編集すると取り消せる", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(undoBtn().disabled).toBe(true); // 履歴なし
    expect(redoBtn().disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    expect(undoBtn().disabled).toBe(false);
  });

  it("取り消すで直前の下書きに戻り、やり直すで再適用される", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    expect(screen.getByDisplayValue("新しい名前")).toBeTruthy();

    fireEvent.click(undoBtn());
    expect(screen.getByDisplayValue("マイ見た目")).toBeTruthy(); // 元の名前へ戻る

    fireEvent.click(redoBtn());
    expect(screen.getByDisplayValue("新しい名前")).toBeTruthy(); // やり直せる
  });

  it("Ctrl+Z でも取り消せる（場面編集と同じキー）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); // act 内で流す（state 反映を待つ）
    expect(screen.getByDisplayValue("マイ見た目")).toBeTruthy();
  });

  // #547 P1-1 の不変条件：この画面の取り消しは**下書きだけ**を戻す。store 履歴に触れると画面外の場面/メタ編集を
  // 無言で巻き戻し、自動保存がそれを永続化してしまう（データ喪失）。
  it("取り消しても store の Undo は呼ばれない（画面外の編集を巻き戻さない）", () => {
    const storeUndo = vi.fn();
    useProjectStore.setState({ undo: storeUndo });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    fireEvent.click(undoBtn());
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); // act 内で流す（state 反映を待つ）
    expect(storeUndo).not.toHaveBeenCalled(); // 局所履歴だけ＝画面外は無傷
    expect(screen.getByDisplayValue("マイ見た目")).toBeTruthy(); // 下書きは戻っている
  });

  it("Ctrl+Y でもやり直せる（キー入口の redo も局所履歴に繋がっている）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByDisplayValue("マイ見た目")).toBeTruthy();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByDisplayValue("新しい名前")).toBeTruthy(); // store ではなく下書きがやり直される
  });

  // 合成対象は「文字入力中」だけ。ボタンにフォーカスが乗ったまま押し続けても1履歴に潰さない
  // （潰すと「要素を追加」3回が取り消す1回で全部消える＝場面編集の挙動とも食い違う・ADR-0026②）。
  it("ボタン操作は1つずつ取り消せる（フォーカスに引きずられて合成されない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const addBtn = screen.getByText("要素を追加");
    fireEvent.focusIn(addBtn); // 実ブラウザのクリックと同じくボタンへフォーカスが乗った状態
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(undoBtn());
    expect(undoBtn().disabled).toBe(false); // 1つ戻してもまだ戻せる＝2操作が1履歴に潰れていない
    fireEvent.click(undoBtn());
    expect(undoBtn().disabled).toBe(true); // 2回で初期状態
  });

  // 色の面（鮮やかさ×明るさ／色相）は pointermove ごとに onChange する。境界が無いと**ひと撫でで数十件**の履歴が
  // 積まれ、履歴上限（50）を流し切って「戻したかった直前の誤操作」が履歴から消える＝この機能の価値を壊す
  // （#547 P2-3 レビュー）。1ドラッグ＝1取り消しであることを固定する。
  it("色のドラッグは1回の取り消しでまとめて戻る（履歴を洪水させない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字" })); // 文字レイヤーを選ぶ＝文字色の欄が出る（選択は履歴に積まない）
    expect(undoBtn().disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("文字の色を選ぶ")); // 色ポップオーバーを開く
    const sv = screen.getByTestId("cp-sv");
    // jsdom はレイアウトを持たないので面の実寸をモック（無いと applySvAt が早期 return して色が動かない）。
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(sv, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(sv, { clientX: 30, clientY: 30, pointerId: 1 }); // ひと撫で＝連続発火
    fireEvent.pointerMove(sv, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(sv, { clientX: 70, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(sv, { pointerId: 1 });

    expect(undoBtn().disabled).toBe(false); // 色は変わった
    fireEvent.click(undoBtn());
    expect(undoBtn().disabled).toBe(true); // 1回で撫でる前へ＝履歴は1件だけ（洪水していない）
  });

  // 保存/削除の実行中はボタンを無効化している。キーだけ効くと「押せないのに効く」不整合になるので同条件で止める。
  it("保存/削除の実行中は Ctrl+Z も効かない（ボタンの無効化と揃える）", () => {
    useProjectStore.setState({ deleteUserTemplate: vi.fn(() => new Promise<boolean>(() => {})) }); // 永久 pending＝削除中を保つ
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("マイ見た目"), { target: { value: "新しい名前" } });
    fireEvent.click(screen.getByText("この見た目パターンを削除"));
    fireEvent.click(screen.getByText("削除する"));
    expect(screen.getByText("削除中…")).toBeTruthy(); // busyAction="delete"

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByDisplayValue("新しい名前")).toBeTruthy(); // キーでも取り消されない
    expect(undoBtn().disabled).toBe(true); // ボタンも無効＝キーとボタンの挙動が一致
  });

  it("フォーカス中の連続入力は1回の取り消しでまとめて戻る（1文字ずつ戻らない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const input = screen.getByDisplayValue("マイ見た目");
    fireEvent.focusIn(input); // グループ開始（onFocus は子孫から伝播）
    fireEvent.change(input, { target: { value: "あ" } });
    fireEvent.change(input, { target: { value: "あい" } });
    fireEvent.change(input, { target: { value: "あいう" } });
    fireEvent.focusOut(input); // グループ終了
    expect(screen.getByDisplayValue("あいう")).toBeTruthy();

    fireEvent.click(undoBtn());
    expect(screen.getByDisplayValue("マイ見た目")).toBeTruthy(); // 1回で入力前へ（途中の「あ」「あい」に戻らない）
    expect(undoBtn().disabled).toBe(true);
  });
});
