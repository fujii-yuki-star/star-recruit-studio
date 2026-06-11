import { useState } from "react";
import { lookPatterns } from "../data/mockData";
import { PageHead } from "../components/ui";
import {
  PlusIcon,
  TrashIcon,
  PlayIcon,
  LayoutIcon,
} from "../components/icons";

export function LooksScreen() {
  const [selected, setSelected] = useState(lookPatterns[0].id);
  const current = lookPatterns.find((l) => l.id === selected) ?? lookPatterns[0];

  return (
    <div className="main-scroll">
      <PageHead
        title="見た目パターンを管理"
        desc="動画の見た目のパターンを確認・追加できます。各場面に当てる見た目を選べます。"
        actions={
          <button className="btn btn-primary">
            <PlusIcon size={18} />
            新しい見た目を追加
          </button>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 見た目パターン一覧 */}
        <div className="card-grid cols-2">
          {lookPatterns.map((l) => (
            <button
              key={l.id}
              className="action-card"
              style={{
                borderColor: selected === l.id ? "var(--color-primary)" : undefined,
                background: selected === l.id ? "var(--color-primary-soft)" : undefined,
              }}
              onClick={() => setSelected(l.id)}
            >
              <div className="thumb thumb-photo" style={{ marginBottom: 4 }}>
                <LayoutIcon size={24} />
              </div>
              <span className="action-card-title">{l.name}</span>
              <span className="action-card-desc">{l.category}</span>
              <div className="row gap-sm mt">
                <span className="btn btn-ghost btn-icon text-sm">
                  <PlayIcon size={14} />
                  サンプルを見る
                </span>
                <span className="btn btn-ghost btn-icon text-sm" style={{ color: "var(--color-danger)" }}>
                  <TrashIcon size={14} />
                  削除
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* 右: 選択中の見た目の情報 */}
        <div className="card">
          <h2 className="section-title">プレビュー</h2>
          <div className="thumb thumb-photo" style={{ marginBottom: "var(--gap)" }}>
            <LayoutIcon size={32} />
          </div>
          <button className="btn btn-secondary btn-block mb">
            <PlayIcon size={16} />
            サンプルを見る
          </button>

          <hr className="divider" />

          <h3 className="section-title" style={{ fontSize: 14 }}>
            見た目の情報
          </h3>
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>{current.name}</strong>
            </div>
            <div className="row-between">
              <span className="text-muted">カテゴリ</span>
              <span className="badge badge-teal">{current.category}</span>
            </div>
            <div className="row-between">
              <span className="text-muted">作成日</span>
              <span>{current.createdAt}</span>
            </div>
            <div className="row-between">
              <span className="text-muted">更新日</span>
              <span>{current.updatedAt}</span>
            </div>
          </div>

          <p className="text-sm text-muted mt text-pretty">{current.description}</p>

          <hr className="divider" />

          <h3 className="field-label">使用している要素</h3>
          <div className="row gap-sm row-wrap">
            {current.elements.map((e) => (
              <span className="badge badge-gray" key={e}>
                {e}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
