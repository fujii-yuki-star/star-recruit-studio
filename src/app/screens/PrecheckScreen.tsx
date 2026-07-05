import { useEffect, useState } from "react";
import type { PrecheckItem, ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { buildPrecheckItems } from "../adapters";
import { PageHead } from "../components/ui";
import { CheckIcon, ChevronRightIcon, ArrowLeftIcon } from "../components/icons";
import { canExport, detectH264Capability } from "../../infrastructure/ffmpegExport";
import { EXPORT_CAPABILITY_NOTICE, blocksExport, type ExportCapability } from "../../domain/export/exportCapability";

interface PrecheckProps {
  onNavigate: (screen: ScreenId) => void;
}

const severityStyle: Record<PrecheckItem["severity"], { label: string; color: string; bg: string }> = {
  ok: { label: "問題なし", color: "var(--color-success)", bg: "var(--color-primary-soft)" },
  warning: { label: "注意", color: "#8a6d1a", bg: "var(--color-yellow)" },
  action: { label: "要対応", color: "var(--color-danger)", bg: "var(--color-danger-soft)" },
};

export function PrecheckScreen({ onNavigate }: PrecheckProps) {
  const { status, scenes, assets, templates, autoGenerateIfSafe } = useProjectStore();
  // 書き出し能力（標準方式 h264_mf の可用性）の事前検知（#120）。Tauri 環境でのみ取得。
  const [capability, setCapability] = useState<ExportCapability | null>(null);

  // 自動生成は Mock（外部送信なし）のときだけ（#384・§2-6）。実プロバイダは空状態のまま。
  useEffect(() => {
    void autoGenerateIfSafe();
  }, [status, autoGenerateIfSafe]);

  useEffect(() => {
    if (!canExport()) return;
    let alive = true;
    detectH264Capability()
      .then((c) => {
        if (alive) setCapability(c);
      })
      .catch(() => {
        if (alive) setCapability(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const baseItems = buildPrecheckItems(scenes, assets, templates);
  // 書き出し能力チェックを先頭に差し込む（取得できた場合のみ・#120）。
  const capNotice = capability ? EXPORT_CAPABILITY_NOTICE[capability] : null;
  const items: PrecheckItem[] = capNotice
    ? [
        { id: "export-capability", label: capNotice.label, detail: capNotice.detail, severity: capNotice.severity },
        ...baseItems,
      ]
    : baseItems;
  const count = (s: PrecheckItem["severity"]) => items.filter((i) => i.severity === s).length;
  // 書き出し不可（unavailable/toolMissing）のときだけ事前にブロック。fallback は予備方式で書き出せるので進める。
  const exportBlocked = capability != null && blocksExport(capability);

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
        <div className="col gap-xs" style={{ alignItems: "flex-end" }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => onNavigate("export")}
            disabled={exportBlocked}
          >
            このまま書き出す
            <ChevronRightIcon size={18} />
          </button>
          {exportBlocked && (
            <span className="text-sm" style={{ color: "var(--color-danger)" }}>
              この端末では動画を保存できません。上の確認結果で問題の項目を解消してから、もう一度お試しください。
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
