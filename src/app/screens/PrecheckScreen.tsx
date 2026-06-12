import { useEffect } from "react";
import type { PrecheckItem, ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { buildPrecheckItems } from "../adapters";
import { PageHead } from "../components/ui";
import { CheckIcon, ChevronRightIcon, ArrowLeftIcon } from "../components/icons";

interface PrecheckProps {
  onNavigate: (screen: ScreenId) => void;
}

const severityStyle: Record<PrecheckItem["severity"], { label: string; color: string; bg: string }> = {
  ok: { label: "問題なし", color: "var(--color-success)", bg: "var(--color-primary-soft)" },
  warning: { label: "注意", color: "#8a6d1a", bg: "var(--color-yellow)" },
  action: { label: "要対応", color: "var(--color-danger)", bg: "var(--color-danger-soft)" },
};

export function PrecheckScreen({ onNavigate }: PrecheckProps) {
  const { status, scenes, assets, templates, generate } = useProjectStore();

  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  const items = buildPrecheckItems(scenes, assets, templates);
  const count = (s: PrecheckItem["severity"]) => items.filter((i) => i.severity === s).length;

  return (
    <div className="main-scroll">
      <PageHead
        title="公開前チェック"
        desc="動画を書き出す前に内容を点検しました。気になる項目は直してから進めましょう。"
      />

      {/* サマリ */}
      <div className="card-grid cols-3 mb">
        <div className="card text-center">
          <div className="page-title" style={{ color: "var(--color-danger)" }}>{count("action")}</div>
          <div className="text-muted text-sm">要対応</div>
        </div>
        <div className="card text-center">
          <div className="page-title" style={{ color: "#8a6d1a" }}>{count("warning")}</div>
          <div className="text-muted text-sm">注意</div>
        </div>
        <div className="card text-center">
          <div className="page-title" style={{ color: "var(--color-success)" }}>{count("ok")}</div>
          <div className="text-muted text-sm">問題なし</div>
        </div>
      </div>

      {/* チェック結果一覧 */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>状態</th>
              <th style={{ width: 180 }}>項目</th>
              <th>内容</th>
              <th style={{ width: 140 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const s = severityStyle[item.severity];
              return (
                <tr key={item.id}>
                  <td>
                    <span className="badge" style={{ background: s.bg, color: s.color }}>
                      {item.severity === "ok" && <CheckIcon size={12} />}
                      {s.label}
                    </span>
                  </td>
                  <td>
                    <strong>{item.label}</strong>
                  </td>
                  <td className="text-pretty">{item.detail}</td>
                  <td>
                    {item.action ? (
                      <button className="btn btn-ghost btn-icon text-sm" onClick={() => onNavigate("scene-edit")}>
                        {item.action}
                      </button>
                    ) : (
                      <span className="text-faint text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 操作 */}
      <div className="row-between mt-lg">
        <button className="btn btn-ghost" onClick={() => onNavigate("scene-edit")}>
          <ArrowLeftIcon size={18} />
          戻って直す
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate("export")}>
          このまま書き出す
          <ChevronRightIcon size={18} />
        </button>
      </div>
    </div>
  );
}
