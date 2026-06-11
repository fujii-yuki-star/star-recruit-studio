interface YukoPanelProps {
  title?: string;
  messages: string[];
}

/** 右側に表示する「ゆうこからひとこと / アドバイス」パネル。
 *  立ち絵は後から差し替える想定のプレースホルダ。 */
export function YukoPanel({ title = "ゆうこからひとこと", messages }: YukoPanelProps) {
  return (
    <aside className="yuko-panel" aria-label={title}>
      <div className="yuko-avatar" aria-hidden="true">
        <span className="yuko-avatar-face">ゆうこ</span>
      </div>
      <div className="yuko-name">{title}</div>
      {messages.map((m, i) => (
        <p className="yuko-bubble" key={i}>
          {m}
        </p>
      ))}
    </aside>
  );
}
