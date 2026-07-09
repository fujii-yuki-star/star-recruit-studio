import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Template } from "../../domain/template/types";
import { FREE_CATEGORY, ORIENTATION, ORIENTATIONS, SCENE_CATEGORIES, type Orientation, type SceneCategory } from "../../domain/enums";
import { isUserTemplate } from "../../domain/template/userTemplate";
import { scenesUsingTemplate } from "../../domain/project/templateUsage";
import { useProjectStore } from "../store/projectStore";
import { parseTemplateFiles } from "../../infrastructure/templateFs";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import { EmptyState } from "../components/states";
import { UsedScenesRow } from "../components/UsedScenesRow";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { layerLabel, buildSampleScene } from "./looksShared";

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
  const [busy, setBusy] = useState(false);
  // ゼロから新規作成フォーム（ADR-0017「ゼロから作成」の導線＝複製に頼らず一から作る）。向き/カテゴリは編集画面で変えられないため作成時に決める。
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("新しい見た目");
  const [newOrientation, setNewOrientation] = useState<Orientation>(ORIENTATION.landscape);
  const [newCategory, setNewCategory] = useState<SceneCategory>(SCENE_CATEGORIES[0]);
  // 読み込みの file input（label htmlFor でなく button+ref.click()＝キーボードで押せる・BgmPicker と同方式・#412）
  const packInputRef = useRef<HTMLInputElement>(null);
  const current = templates.find((t) => t.templateId === selectedId) ?? templates[0];

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

  // この見た目を複製してマイテンプレにし、そのまま編集画面へ。連打は busy で防ぐ（採番の余分な前進を避ける）。
  async function onDuplicate() {
    if (!current || busy) return;
    setBusy(true);
    try {
      const newId = await duplicateAsUserTemplate(current.templateId);
      if (newId) {
        setSelectedId(newId);
        setEditingTemplateId(newId);
        onNavigate("looks-edit");
      }
    } finally {
      setBusy(false);
    }
  }
  // ゼロから新規作成し、そのまま編集画面へ。名前は空白なら既定にフォールバック。連打は busy で防ぐ。
  async function onCreateBlank() {
    if (busy) return;
    setBusy(true);
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
      setBusy(false);
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
    if (!current || !isUserCurrent) return;
    const targetId = current.templateId;
    const fallback = templates.find((t) => t.templateId !== targetId)?.templateId ?? "";
    const ok = await deleteUserTemplate(targetId);
    setConfirmDelete(false);
    if (ok) setSelectedId(fallback);
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
        <EmptyState
          title="見た目パターンがありません"
          message="標準の見た目パターンが読み込まれていません。アプリを再起動してください。改善しない場合は、お手数ですがご連絡ください。"
        />
      </div>
    );
  }

  const sampleScene = buildSampleScene(current, assets);
  // この見た目を使っている場面（逆引き・#406）。標準/マイテンプレを問わず scene.templateId で判定する。
  const usedScenes = scenesUsingTemplate(scenes, current.templateId);
  // 使用場面バッジを押したら、その場面の編集を開く（editingSceneId 機構＝#400・素材画面と同方式）。
  const jumpToScene = (sceneId: string) => { setEditingSceneId(sceneId); onNavigate("scene-edit"); };

  return (
    <div className="main-scroll">
      <PageHead
        title="見た目パターンを管理"
        desc="動画の見た目のパターンを確認できます。各場面に当てる見た目は「場面編集」で選べます。"
      />

      {/* ゼロから新規作成（ADR-0017）：複製だけでなく一から作れる導線。向き・種類は編集画面で変えられないため作成時に決める。 */}
      {creating ? (
        <div className="card" style={{ marginBottom: "var(--gap-lg)" }}>
          <h2 className="section-title">ゼロから新しい見た目を作る</h2>
          <div className="col gap-sm">
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>名前</label>
              <input className="input" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>向き</label>
                <select className="select" value={newOrientation} onChange={(e) => setNewOrientation(e.target.value as Orientation)}>
                  {ORIENTATIONS.map((o) => (<option key={o} value={o}>{orientationLabel[o]}</option>))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>種類</label>
                <select className="select" value={newCategory} onChange={(e) => setNewCategory(e.target.value as SceneCategory)}>
                  {SCENE_CATEGORIES.map((c) => (<option key={c} value={c}>{categoryLabel[c]}</option>))}
                </select>
              </div>
            </div>
            <div className="row gap-sm">
              <button className="btn btn-primary" disabled={busy} onClick={() => void onCreateBlank()}>作成して編集する</button>
              <button className="btn btn-ghost" onClick={() => setCreating(false)}>やめる</button>
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
        <button className="btn btn-primary" style={{ marginBottom: "var(--gap-lg)" }} onClick={() => { clearTemplateError(); setCreating(true); }}>
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
        <div className="card-grid cols-2">
          {templates.map((t) => (
            <button
              key={t.templateId}
              className="action-card"
              style={{
                borderColor: current.templateId === t.templateId ? "var(--color-primary)" : undefined,
                background: current.templateId === t.templateId ? "var(--color-primary-soft)" : undefined,
              }}
              onClick={() => setSelectedId(t.templateId)}
            >
              <span className="action-card-title">{t.name}</span>
              <span className="action-card-desc">{categoryLabel[t.category]}{isUserTemplate(t.templateId) ? "・自分の見た目" : ""}</span>
            </button>
          ))}
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
          <UsedScenesRow scenes={usedScenes} onJump={jumpToScene} emptyText="まだどの場面でも使われていません。" />

          <hr className="divider" />
          {/* マイテンプレ（ユーザーテンプレ）の作成・編集（ADR-0017）。編集は専用画面へ遷移（#271）。 */}
          <h3 className="field-label">この見た目を編集</h3>
          <span className={`badge ${isUserCurrent ? "badge-teal" : "badge-gray"}`}>
            {isUserCurrent ? "自分の見た目" : "標準（編集するには複製します）"}
          </span>
          <div className="col gap-sm mt">
            {isUserCurrent && (
              <button className="btn btn-primary" onClick={onEdit}>この見た目を編集する</button>
            )}
            <button className="btn btn-secondary" disabled={busy} onClick={() => void onDuplicate()}>
              この見た目を複製して編集する
            </button>

            {/* 削除（マイテンプレのみ） */}
            {isUserCurrent && (confirmDelete ? (
              <DeleteConfirm
                message="この見た目パターンを削除しますか？元に戻せません。"
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => void onDelete()}
              />
            ) : (
              <button
                className="btn btn-ghost text-sm"
                style={{ color: "var(--color-danger)", alignSelf: "flex-start" }}
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
          <button type="button" className="btn btn-secondary" onClick={() => packInputRef.current?.click()}>
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
    </div>
  );
}
