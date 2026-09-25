import { yukoImage } from "../data/yukoImages";

interface YukoPanelProps {
  title?: string;
  messages: string[];
  /** 出す顔（`17 §3` の poseTag）。無い tag なら既定の顔になる。 */
  pose?: string;
}

/**
 * 右側に表示する「ゆうこからひとこと / アドバイス」パネル。
 *
 * ⚠️ **立ち絵を出す**（#1228）＝ここは長らく**文字の「ゆうこ」だけ**のプレースホルダで、
 * チュートリアル映像を撮って初めて「絵が無い」ことが目に見えた（利用者の指摘）。
 * ⚠️ **絵は飾りなので `alt` は空**＝すぐ下に同じことを言う文（`title`）があり、
 * 読み上げで二度言わせない。
 */
export function YukoPanel({ title = "ゆうこからひとこと", messages, pose }: YukoPanelProps) {
  return (
    <aside className="yuko-panel" aria-label={title}>
      <div className="yuko-avatar">
        <img className="yuko-avatar-img" src={yukoImage(pose)} alt="" />
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
