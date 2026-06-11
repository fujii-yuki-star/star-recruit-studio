import { useState } from "react";
import { materials, yukoMaterials } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { EmptyState } from "../components/states";
import {
  PhotoIcon,
  VideoIcon,
  MusicIcon,
  UploadIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from "../components/icons";

type Kind = "photo" | "video" | "audio" | "yuko";
type Filter = "all" | Kind;

interface MaterialView {
  id: string;
  name: string;
  kind: Kind;
  description: string;
  tags: string[];
  checked: boolean;
}

const initialItems: MaterialView[] = [
  ...materials.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.type as Kind,
    description: m.description ?? "",
    tags: m.tags ?? [],
    checked: m.checked ?? false,
  })),
  ...yukoMaterials.map((y) => ({
    id: y.id,
    name: y.name,
    kind: "yuko" as Kind,
    description: `ゆうこの立ち絵（表情：${y.tag}）`,
    tags: [y.tag],
    checked: true,
  })),
];

const filters: [Filter, string][] = [
  ["all", "すべて"],
  ["photo", "写真"],
  ["video", "動画"],
  ["audio", "音"],
  ["yuko", "ゆうこ"],
];

function KindThumb({ kind, size = 20 }: { kind: Kind; size?: number }) {
  const cls = kind === "video" ? "thumb-video" : kind === "audio" ? "thumb-audio" : "thumb-photo";
  return (
    <div className={`thumb ${cls}`} style={{ aspectRatio: "auto", width: "100%" }}>
      {kind === "photo" && <PhotoIcon size={size} />}
      {kind === "video" && <VideoIcon size={size} />}
      {kind === "audio" && <MusicIcon size={size} />}
      {kind === "yuko" && <span style={{ fontWeight: 700 }}>ゆ</span>}
    </div>
  );
}

export function MaterialsScreen() {
  const [items, setItems] = useState<MaterialView[]>(initialItems);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState(initialItems[0].id);
  const [newTag, setNewTag] = useState("");

  const visible = items.filter((m) => filter === "all" || m.kind === filter);
  const selected = items.find((m) => m.id === selectedId) ?? visible[0] ?? items[0];

  function update(id: string, patch: Partial<MaterialView>) {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function addTag() {
    const v = newTag.trim();
    if (!v || !selected) return;
    if (!selected.tags.includes(v)) update(selected.id, { tags: [...selected.tags, v] });
    setNewTag("");
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((m) => m.id !== id));
    if (selectedId === id) {
      const rest = items.filter((m) => m.id !== id);
      setSelectedId(rest[0]?.id ?? "");
    }
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="素材を管理"
        desc="動画に使う写真・動画・音・ゆうこの素材を管理します。説明やタグを付けると、ゆうこが使いどころを判断しやすくなります。"
        actions={
          <button className="btn btn-primary">
            <UploadIcon size={18} />
            素材を追加
          </button>
        }
      />

      <div className="segment mb" style={{ display: "inline-flex" }}>
        {filters.map(([id, label]) => (
          <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 素材グリッド */}
        {visible.length > 0 ? (
          <div className="card-grid cols-3">
            {visible.map((m) => (
              <button
                key={m.id}
                className="action-card"
                style={{
                  borderColor: selected?.id === m.id ? "var(--color-primary)" : undefined,
                  background: selected?.id === m.id ? "var(--color-primary-soft)" : undefined,
                }}
                onClick={() => setSelectedId(m.id)}
              >
                <KindThumb kind={m.kind} />
                <span className="action-card-title" style={{ marginTop: 6 }}>
                  {m.name}
                </span>
                <div className="row gap-sm row-wrap" style={{ justifyContent: "center" }}>
                  {m.checked ? (
                    <span className="badge badge-teal">
                      <CheckIcon size={12} /> 確認済み
                    </span>
                  ) : (
                    <span className="badge badge-gray">未確認</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="この種類の素材はまだありません"
            message="「素材を追加」から、写真・動画・BGM・ゆうこの素材を登録できます。"
          />
        )}

        {/* 右: 選択中の素材の情報 */}
        {selected && (
          <div className="card">
            <h2 className="section-title">素材の情報</h2>
            <div style={{ maxWidth: 160, margin: "0 auto var(--gap)" }}>
              <KindThumb kind={selected.kind} size={28} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="mat-name">
                名前
              </label>
              <input
                id="mat-name"
                className="input"
                value={selected.name}
                onChange={(e) => update(selected.id, { name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="mat-desc">
                説明
              </label>
              <textarea
                id="mat-desc"
                className="textarea"
                value={selected.description}
                placeholder="例：若手社員が作業しているオフィス写真"
                onChange={(e) => update(selected.id, { description: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label">タグ</label>
              <div className="chip-input-row">
                {selected.tags.map((t) => (
                  <span className="chip" key={t}>
                    {t}
                    <button
                      aria-label={`${t}を削除`}
                      onClick={() =>
                        update(selected.id, { tags: selected.tags.filter((x) => x !== t) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="row gap-sm">
                <input
                  className="input"
                  value={newTag}
                  placeholder="タグを追加"
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <button className="btn btn-secondary" onClick={addTag}>
                  <PlusIcon size={16} />
                  追加
                </button>
              </div>
            </div>

            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>
                公開チェック済み
              </span>
              <Switch
                on={selected.checked}
                onChange={(v) => update(selected.id, { checked: v })}
                label="公開チェック済み"
              />
            </div>

            <button
              className="btn btn-danger btn-block mt"
              onClick={() => removeItem(selected.id)}
            >
              <TrashIcon size={16} />
              この素材を削除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
