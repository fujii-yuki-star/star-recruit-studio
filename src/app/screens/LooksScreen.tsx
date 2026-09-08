import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Template } from "../../domain/template/types";
import { FREE_CATEGORY, ORIENTATIONS, SCENE_CATEGORIES, type Orientation, type SceneCategory } from "../../domain/enums";
import { isUserTemplate } from "../../domain/template/userTemplate";
import { deleteImpactCounts, scenesUsingTemplate, templateDeleteImpact } from "../../domain/project/templateUsage";
import { deleteLookConfirmMessage } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { ExportLock, ExportLockBanner } from "../components/ExportLockBanner";
import { parseTemplateFiles } from "../../infrastructure/templateFs";
import { ScenePreview } from "../components/ScenePreview";
import { SceneThumb } from "../components/SceneThumb";
import { PageHead } from "../components/ui";
import { BrandKitLink } from "../components/BrandKitLink";
import { EmptyState } from "../components/states";
import { UsedScenesRow } from "../components/UsedScenesRow";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { layerLabel, buildSampleScene } from "./looksShared";
import { matchesSearchWords } from "../../domain/search";

// SceneCategory のユーザー向けラベル（全値必須＝enum 追加時に漏れをコンパイルエラーで検知。§2-3）。
const categoryLabel: Record<SceneCategory, string> = {
  opening: "オープニング",
  closing: "クロージング",
  photo_intro: "写真紹介",
  video_intro: "動画紹介",
  point_list: "ポイント紹介",
  message: "メッセージ",
  full_visual: "全画面",
  chapter: "区切り",
  no_yuko: "ゆうこなし",
  free: "自由配置",
};

// 向き（Orientation）のユーザー向けラベル（全値必須＝enum 追加時に漏れをコンパイルエラーで検知。§2-3）。
const orientationLabel: Record<Orientation, string> = {
  "16:9": "横型（16:9）",
  "9:16": "縦型（9:16）",
};

// FREE（自由配置）で「置けるもの」のラベル。FREE はテンプレ層でなく freeLayout に内容を持つため、
// レイヤー種別ではなく配置できる要素（素材/文字/図形）を示す（ADR-0008・#5）。
const FREE_PLACEABLE_LABELS = ["素材", "文字", "図形"];

// テンプレが使う要素を重複なく日本語ラベルで返す。FREE は「自由に置ける要素」を返す。
function usedElements(template: Template): string[] {
  if (template.category === FREE_CATEGORY) return FREE_PLACEABLE_LABELS;
  const out: string[] = [];
  for (const layer of template.layers) {
    const label = layerLabel[layer.type];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

// 見た目パターンの一覧/管理（#271 で編集は専用画面 LooksEditScreen へ分離）。
// ここは「見る・選ぶ・複製/編集へ進む・削除・取り込み」に専念し、編集ロジックは持たない。
export function LooksScreen({ onNavigate }: { onNavigate: (s: ScreenId) => void }) {
  const templates = useProjectStore((s) => s.templates);
  const assets = useProjectStore((s) => s.assets);
  const aspectRatio = useProjectStore((s) => s.meta.videoSettings.aspectRatio); // 削除時の当て先（標準）は動画の向きで決まる
  const scenes = useProjectStore((s) => s.scenes);
  const setEditingSceneId = useProjectStore((s) => s.setEditingSceneId);
  const addTemplatePack = useProjectStore((s) => s.addTemplatePack);
  const duplicateAsUserTemplate = useProjectStore((s) => s.duplicateAsUserTemplate);
  const createBlankUserTemplate = useProjectStore((s) => s.createBlankUserTemplate);
  const deleteUserTemplate = useProjectStore((s) => s.deleteUserTemplate);
  const setEditingTemplateId = useProjectStore((s) => s.setEditingTemplateId);
  const templateError = useProjectStore((s) => s.templateError);
  const clearTemplateError = useProjectStore((s) => s.clearTemplateError);
  const [selectedId, setSelectedId] = useState(templates[0]?.templateId ?? "");
  const [loadMsg, setLoadMsg] = useState("");
  const [loadOk, setLoadOk] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 実行中の操作（#410 sub4 レビュー）。押した操作だけラベルを「作成中…／複製中…／削除中…」にし、
  // どれか実行中は全ボタンを disabled にして連打・多重実行を防ぐ。単一 busy だとラベルが出し分けられない。
  const [busyAction, setBusyAction] = useState<"create" | "duplicate" | "delete" | null>(null);
  // ゼロから新規作成フォーム（ADR-0017「ゼロから作成」の導線＝複製に頼らず一から作る）。向き/カテゴリは編集画面で変えられないため作成時に決める。
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("新しい見た目");
  // ⚠️ **既定はこの動画の向き**（#1031）＝いつも横型で始まると、縦型で作っている人は
  //   **注意文を読んで直す**ことになる（`aspectRatio` は上で取っているのに使っていなかった）。
  // ⚠️ **開くときにも取り直す**（下の「ゼロから作る」）＝画面を出したまま動画の向きが変わっても、
  //   次に開いたときは新しい向きで始まる。ここの初期値は**最初に描いたときのぶん**。
  const [newOrientation, setNewOrientation] = useState<Orientation>(aspectRatio);
  const [newCategory, setNewCategory] = useState<SceneCategory>(SCENE_CATEGORIES[0]);
  // 読み込みの file input（label htmlFor でなく button+ref.click()＝キーボードで押せる・BgmPicker と同方式・#412）
  const packInputRef = useRef<HTMLInputElement>(null);
  const current = templates.find((t) => t.templateId === selectedId) ?? templates[0];

  /**
   * 一覧の絞り込み（#1031）。
   *
   * ⚠️ **選んでいるものは絞り込みで消さない**＝右の見本・情報は `current` のままで、
   * 一覧の見え方だけを変える（探している途中で**右の中身が入れ替わらない**）。
   */
  const [catFilter, setCatFilter] = useState<SceneCategory | "all">("all");
  const [orientFilter, setOrientFilter] = useState<Orientation | "all">("all");
  const [query, setQuery] = useState("");
  const categoryFilters: [SceneCategory | "all", string][] = [
    ["all", "すべて"],
    ...SCENE_CATEGORIES.map((c): [SceneCategory | "all", string] => [c, categoryLabel[c]]),
  ];
  const orientationFilters: [Orientation | "all", string][] = [
    ["all", "両方"],
    ...ORIENTATIONS.map((o): [Orientation | "all", string] => [o, orientationLabel[o]]),
  ];
  /**
   * 一覧の見本（PR #1086 レビュー）。
   *
   * ⚠️ **描くたびに作り直さない**＝毎回新しい場面を渡すと、**1枚選ぶだけで
   * 全枚の絵を作り直す**（見た目は20枚以上並ぶ・探す欄の1文字ごとにも走る）。
   */
  const sampleById = useMemo(
    () => new Map(templates.map((t) => [t.templateId, buildSampleScene(t, assets)])),
    [templates, assets],
  );
  const filtering = catFilter !== "all" || orientFilter !== "all" || query !== "";
  const visibleTemplates = templates.filter(
    (t) =>
      (catFilter === "all" || t.category === catFilter) &&
      (orientFilter === "all" || t.aspectRatio === orientFilter) &&
      matchesSearchWords([t.name], query),
  );

  // 選択が変わったら削除確認は閉じる（別テンプレへ確認状態を持ち越さない）。描画中リセット＝effect 内 setState を避ける React 推奨パターン。
  const [syncedId, setSyncedId] = useState<string | undefined>(undefined);
  if (current && current.templateId !== syncedId) {
    setSyncedId(current.templateId);
    setConfirmDelete(false);
  }
  // 選択を変えたら前の操作のエラーは消す（無関係なエラーを別テンプレのパネルに残さない）。
  useEffect(() => {
    clearTemplateError();
  }, [current?.templateId, clearTemplateError]);

  const isUserCurrent = current ? isUserTemplate(current.templateId) : false;

  // この見た目を複製してマイテンプレにし、そのまま編集画面へ。連打は busyAction で防ぐ（採番の余分な前進を避ける）。
  async function onDuplicate() {
    if (!current || busyAction) return;
    setBusyAction("duplicate");
    try {
      const newId = await duplicateAsUserTemplate(current.templateId);
      if (newId) {
        setSelectedId(newId);
        setEditingTemplateId(newId);
        onNavigate("looks-edit");
      }
    } finally {
      setBusyAction(null);
    }
  }
  // ゼロから新規作成し、そのまま編集画面へ。名前は空白なら既定にフォールバック。連打は busyAction で防ぐ。
  async function onCreateBlank() {
    if (busyAction) return;
    setBusyAction("create");
    try {
      const name = newName.trim() || "新しい見た目";
      const newId = await createBlankUserTemplate(name, newCategory, newOrientation);
      if (newId) {
        setCreating(false);
        setNewName("新しい見た目"); // 次回フォームに前回名を残さない（同名テンプレの量産を防ぐ）。向き/種類は保持。
        setSelectedId(newId);
        setEditingTemplateId(newId);
        onNavigate("looks-edit");
      }
    } finally {
      setBusyAction(null);
    }
  }
  // このマイテンプレを編集画面で開く。
  function onEdit() {
    if (!current || !isUserCurrent) return;
    setEditingTemplateId(current.templateId);
    onNavigate("looks-edit");
  }
  // マイテンプレを削除し、別の見た目を選択する。削除が成功したときだけ選択を移す（失敗時は対象が残るので留まる）。
  async function onDelete() {
    if (!current || !isUserCurrent || busyAction) return;
    const targetId = current.templateId;
    const fallback = templates.find((t) => t.templateId !== targetId)?.templateId ?? "";
    setBusyAction("delete");
    try {
      const ok = await deleteUserTemplate(targetId);
      setConfirmDelete(false);
      if (ok) setSelectedId(fallback);
    } finally {
      setBusyAction(null);
    }
  }

  // 用意した見た目パターンのファイルを取り込む（検証は templateFs＝§2-2）。件数のみ提示（§2-3）。
  async function onLoadPack(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    const { templates: loaded, rejected } = await parseTemplateFiles(files);
    const first = loaded[0];
    if (first) {
      addTemplatePack(loaded);
      setSelectedId(first.templateId);
    }
    setLoadOk(!!first);
    setLoadMsg(
      first
        ? `${loaded.length}件の見た目パターンを読み込みました。${rejected.length > 0 ? `（${rejected.length}件は内容が合わず取り込めませんでした）` : ""}`
        : "読み込める見た目パターンがありませんでした。ファイルの内容をご確認ください。",
    );
  }

  if (!current) {
    return (
      <div className="main-scroll">
        <PageHead title="見た目パターンを管理" desc="動画の見た目のパターンを確認できます。" />
        {/* ⚠️ **両方の枝に置く**（#984 レビュー ℹ️）＝早い `return` のある画面は、
            片方に置くと**もう片方でだけ書き出し中の知らせが出ない**（#953 と同じ型）。 */}
        <ExportLockBanner onNavigate={onNavigate} />
        <EmptyState
          title="見た目パターンがありません"
          message="標準の見た目パターンが読み込まれていません。アプリを再起動してください。改善しない場合は、お手数ですがご連絡ください。"
        />
      </div>
    );
  }

  // ⚠️ **右の見本も作り直さない**（PR #1086 レビュー）＝一覧と同じものが既にあるのに
  // 別に作り直しており、**探す欄の1文字ごと**にも走っていた（同じ目的の直しを片方だけやらない）。
  // ⚠️ **一覧に無い見た目はその場で作る**＝`templates` に無い `current` は起きないが、
  // 黙って見本が消える形にはしない。
  const sampleScene = sampleById.get(current.templateId) ?? buildSampleScene(current, assets);
  // この見た目を使っている場面（逆引き・#406）。標準/マイテンプレを問わず scene.templateId で判定する。
  const usedScenes = scenesUsingTemplate(scenes, current.templateId);
  // 削除したときにこのプロジェクトで何が起きるか（#547・削除は取り消せないので先に示す）。
  const deleteImpact = templateDeleteImpact(scenes, current.templateId, templates, aspectRatio);
  // 使用場面バッジを押したら、その場面の編集を開く（editingSceneId 機構＝#400・素材画面と同方式）。
  const jumpToScene = (sceneId: string) => { setEditingSceneId(sceneId); onNavigate("scene-edit"); };

  return (
    <div className="main-scroll">
      <PageHead
        title="見た目パターンを管理"
        desc="動画の見た目のパターンを確認できます。各場面に当てる見た目は「場面編集」で選べます。"
      />
      <ExportLock onNavigate={onNavigate}>
      {/* 説明だけで行き止まりにしない：実際に見た目を割り当てる「場面編集」への導線を添える（§2-5・#413）。 */}
      <div className="row gap-sm">
        <button className="btn btn-ghost text-sm" style={{ marginBottom: "var(--gap)" }} onClick={() => onNavigate("scene-edit")}>
          場面編集を開く
        </button>
        {/* 会社の見た目（ADR-0036）への入口（#1032）。見た目を選んでいるときにこそ思い出すのに、
            設定画面の奥だけにしか入口が無かった。 */}
        <BrandKitLink onNavigate={onNavigate} />
      </div>

      {/* ゼロから新規作成（ADR-0017）：複製だけでなく一から作れる導線。向き・種類は編集画面で変えられないため作成時に決める。 */}
      {creating ? (
        <div className="card" style={{ marginBottom: "var(--gap-lg)" }}>
          <h2 className="section-title">ゼロから新しい見た目を作る</h2>
          <div className="col gap-sm">
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>名前</label>
              {/* 作成だけ 40 字で切っていたが、編集側（LooksEditScreen の名前欄）にも template schema（name は
                  minLength:1・上限なし）にも根拠が無く、同じ「見た目パターンの名前」が入口で別挙動だった
                  （#554・ADR-0026②）。上限なしへ統一する。 */}
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}>
                {/* ⚠️ **見出しと欄を結ぶ**（#1031）＝結んでいないと、読み上げでは「何の欄か」が分からない
                    （見た目には見出しが出ているので、目で見ている限り気づけない）。 */}
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }} htmlFor="new-look-orientation">向き</label>
                <select id="new-look-orientation" className="select" value={newOrientation} onChange={(e) => setNewOrientation(e.target.value as Orientation)}>
                  {ORIENTATIONS.map((o) => (<option key={o} value={o}>{orientationLabel[o]}</option>))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }} htmlFor="new-look-category">種類</label>
                <select id="new-look-category" className="select" value={newCategory} onChange={(e) => setNewCategory(e.target.value as SceneCategory)}>
                  {SCENE_CATEGORIES.map((c) => (<option key={c} value={c}>{categoryLabel[c]}</option>))}
                </select>
              </div>
            </div>
            <div className="row gap-sm">
              <button className="btn btn-primary" disabled={busyAction !== null} onClick={() => void onCreateBlank()}>{busyAction === "create" ? "作成中…" : "作成して編集する"}</button>
              <button className="btn btn-ghost" disabled={busyAction !== null} onClick={() => setCreating(false)}>やめる</button>
            </div>
            {/* 作成失敗時はフォーム内にエラーを出す（押しても何も起きないように見えるのを防ぐ・§2-5）。 */}
            {templateError && (
              <div className="notice notice-warn" role="alert">
                <span>{templateError}</span>
              </div>
            )}
            <p className="field-hint">空のキャンバス（背景のみ）から始まります。文字・素材などは次の編集画面で足せます。向き・種類は後から変えられないため、ここで選んでください。</p>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" style={{ marginBottom: "var(--gap-lg)" }} disabled={busyAction !== null} onClick={() => { clearTemplateError(); setNewOrientation(aspectRatio); setCreating(true); }}>
          ＋ ゼロから新しい見た目を作る
        </button>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 見た目パターン一覧 */}
        <div>
          {/* ⚠️ **探し方は素材画面と揃える**（#1031）＝種類のタブ＋名前で探す＋「絞り込みをやめる」。
              ⚠️ **件数で出し分けない**＝素材画面は常に出しているので、ここだけ途中から欄が現れると
              同じ「探す」が画面で別挙動になる（ADR-0026②）。 */}
          <div className="row gap-sm row-wrap mb" style={{ alignItems: "center" }}>
            <div className="segment" role="group" aria-label="場面の種類" style={{ display: "inline-flex" }}>
              {categoryFilters.map(([id, label]) => (
                <button key={id} className={catFilter === id ? "active" : ""} onClick={() => setCatFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            {/* ⚠️ **向きも見せる**＝この画面は**向きを問わず全部**並べるので（作ったものが
                見えなくならないように）、どれがこの動画で使えるのかが分かる印が要る。 */}
            <div className="segment" role="group" aria-label="動画の向き" style={{ display: "inline-flex" }}>
              {orientationFilters.map(([id, label]) => (
                <button key={id} className={orientFilter === id ? "active" : ""} onClick={() => setOrientFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="input"
              style={{ maxWidth: 200 }}
              type="search"
              aria-label="名前で探す"
              placeholder="名前で探す"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtering && (
              <button className="btn btn-ghost text-sm" onClick={() => { setCatFilter("all"); setOrientFilter("all"); setQuery(""); }}>
                絞り込みをやめる
              </button>
            )}
          </div>
          {visibleTemplates.length === 0 ? (
            <EmptyState
              title="この絞り込みに合う見た目パターンはありません"
              message="ほかの言葉で探すか、上の「絞り込みをやめる」で全部に戻せます。"
            />
          ) : (
          <div className="card-grid cols-2">
            {visibleTemplates.map((t) => (
              <button
                key={t.templateId}
                className="action-card"
                style={{
                  borderColor: current.templateId === t.templateId ? "var(--color-primary)" : undefined,
                  background: current.templateId === t.templateId ? "var(--color-primary-soft)" : undefined,
                }}
                disabled={busyAction !== null}
                onClick={() => setSelectedId(t.templateId)}
              >
                {/* ⚠️ **見本を出す**（#1031）＝名前とカテゴリの文字だけだと、選んで右に
                    出してみるまでどんな見た目か分からない。見本は右の大きなものと**同じ作り**
                    （`buildSampleScene`）で、描画の核も共有する（ADR-0001）。 */}
                <SceneThumb scene={sampleById.get(t.templateId)!} template={t} />
                <span className="action-card-title">{t.name}</span>
                <span className="action-card-desc">
                  {categoryLabel[t.category]}・{orientationLabel[t.aspectRatio]}{isUserTemplate(t.templateId) ? "・自分の見た目" : ""}
                </span>
              </button>
            ))}
          </div>
          )}
        </div>

        {/* 右: 選択中の見た目のプレビュー＋情報 */}
        <div className="card">
          <h2 className="section-title">見本</h2>
          <ScenePreview scene={sampleScene} template={current} />
          <p className="text-sm text-muted mt">
            {current.category === FREE_CATEGORY
              ? "「自由配置」は素材・文字・図形を好きな位置に置ける見た目です。これは配置例で、場面編集で自由に動かせます。"
              : `選択中の見た目「${current.name}」の見本です（写真・文字は例として表示しています）。`}
          </p>

          <hr className="divider" />
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>{current.name}</strong>
            </div>
            <div className="row-between">
              <span className="text-muted">カテゴリ</span>
              <span className="badge badge-teal">{categoryLabel[current.category]}</span>
            </div>
            {/* ⚠️ **向きも出す**（#1031）＝この画面は向きを問わず並べるので、
                見ている見た目が**この動画で使えるのか**が分からなかった。 */}
            <div className="row-between">
              <span className="text-muted">向き</span>
              <span className={`badge ${current.aspectRatio === aspectRatio ? "badge-teal" : "badge-gray"}`}>
                {orientationLabel[current.aspectRatio]}
                {current.aspectRatio === aspectRatio ? "" : "（この動画では使えません）"}
              </span>
            </div>
          </div>

          <hr className="divider" />
          <h3 className="field-label">使用している要素</h3>
          <div className="row gap-sm row-wrap">
            {usedElements(current).map((e) => (
              <span className="badge badge-gray" key={e}>
                {e}
              </span>
            ))}
          </div>

          {/* 使用場面の逆引き（#406）：この見た目を当てている場面へ1クリックで飛べる。 */}
          <hr className="divider" />
          <h3 className="field-label">使用場面</h3>
          <UsedScenesRow scenes={usedScenes} onJump={jumpToScene} emptyText="まだどの場面でも使われていません。" disabled={busyAction !== null} />

          <hr className="divider" />
          {/* マイテンプレ（ユーザーテンプレ）の作成・編集（ADR-0017）。編集は専用画面へ遷移（#271）。 */}
          <h3 className="field-label">この見た目を編集</h3>
          <span className={`badge ${isUserCurrent ? "badge-teal" : "badge-gray"}`}>
            {isUserCurrent ? "自分の見た目" : "標準（編集するには複製します）"}
          </span>
          <div className="col gap-sm mt">
            {isUserCurrent && (
              <button className="btn btn-primary" disabled={busyAction !== null} onClick={onEdit}>この見た目を編集する</button>
            )}
            <button className="btn btn-secondary" disabled={busyAction !== null} onClick={() => void onDuplicate()}>
              {busyAction === "duplicate" ? "複製中…" : "この見た目を複製して編集する"}
            </button>

            {/* 削除（マイテンプレのみ） */}
            {isUserCurrent && (confirmDelete ? (
              <DeleteConfirm
                busy={busyAction === "delete"}
                message={deleteLookConfirmMessage(deleteImpactCounts(deleteImpact))}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => void onDelete()}
              />
            ) : (
              <button
                className="btn btn-ghost text-sm"
                style={{ color: "var(--color-danger)", alignSelf: "flex-start" }}
                disabled={busyAction !== null}
                onClick={() => setConfirmDelete(true)}
              >
                この見た目パターンを削除
              </button>
            ))}
          </div>
          {templateError && (
            <div className="notice notice-warn mt" role="alert">
              <span>{templateError}</span>
            </div>
          )}

          <hr className="divider" />
          <input
            ref={packInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => void onLoadPack(e)}
          />
          <button type="button" className="btn btn-secondary" disabled={busyAction !== null} onClick={() => packInputRef.current?.click()}>
            見た目パターンを読み込む
          </button>
          <p className="field-hint mt">用意した見た目パターンのファイルを追加できます。</p>
          {loadMsg && (
            <div className={`notice ${loadOk ? "notice-info" : "notice-warn"} mt`} role={loadOk ? "status" : "alert"}>
              <span>{loadMsg}</span>
            </div>
          )}
        </div>
      </div>
      </ExportLock>
    </div>
  );
}
