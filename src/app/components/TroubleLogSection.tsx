import { useEffect, useState } from "react";
import { openSavedFile } from "../../infrastructure/opener";
import { troubleLogDir } from "../../infrastructure/troubleLogFs";
import { TROUBLE_LOG_DESC, TROUBLE_LOG_OPEN, TROUBLE_LOG_OPEN_FAILED, TROUBLE_LOG_TITLE } from "../uiLabels";
import { userFacingMessage } from "../userFacingError";

/**
 * うまくいかないときの記録（#396）＝**場所を開く導線だけ**を出す。
 *
 * ⚠️ **中身は画面に出さない**（§2-3）＝入っているのは実装の言葉（FFmpeg の出力など）。
 * ⚠️ **置き場が無いときは節ごと出さない**＝押せるのに何も起きない導線を作らない（§2-5）。
 *   ブラウザでの開発や、書き込めない環境では `null` が返る。
 * ⚠️ **外へ送らないことを説明に書く**（§2-6）＝「記録が残る」とだけ書くと、
 *   勝手に送られていると受け取られうる。
 */
export function TroubleLogSection() {
  const [dir, setDir] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void troubleLogDir().then((d) => { if (alive) setDir(d); });
    return () => { alive = false; };
  }, []);

  if (dir == null) return null;

  return (
    <div className="card">
      <h2 className="section-title">{TROUBLE_LOG_TITLE}</h2>
      <p className="page-desc text-pretty">{TROUBLE_LOG_DESC}</p>
      <div className="row gap-sm mt" style={{ alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setFailed(null);
            // ⚠️ **失敗を握りつぶさない**（§2-5）＝押しても何も起きない、を作らない。
            // ⚠️ **理由も捨てない**（レビュー由来 🟡・#1118）＝Rust は「覚えていない／もう無い／
            // パソコン側で開けない」を書き分けて返すのに、受け取らないと**画面では1つに潰れる**。
            void openSavedFile(dir).catch((e: unknown) =>
              setFailed(userFacingMessage(e, "trouble-log") ?? TROUBLE_LOG_OPEN_FAILED),
            );
          }}
        >
          {TROUBLE_LOG_OPEN}
        </button>
      </div>
      {failed != null && <p className="field-hint mt" role="alert">{failed}</p>}
    </div>
  );
}
