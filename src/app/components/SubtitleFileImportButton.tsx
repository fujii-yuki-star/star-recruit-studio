// 字幕ファイル（.srt／.vtt）を読み込むボタン（ADR-0055・#1351）。
//
// ⚠️ **ファイルの選び方は WebView の「ファイルを選ぶ」**＝中身（文字）を読むだけなので、素材のようにプロジェクトへコピーしない
//   （パスを Rust へ渡す道は要らない）。読んだバイト列を store へ渡し、文字コードの見分けと解析は domain が行う。
// ⚠️ **同じファイルを続けて選べるように**、選んだあとは欄を空に戻す（同じ値だと change が来ない）。
import { useRef } from "react";
import { SUBTITLE_FILE_IMPORT_LABEL } from "../uiLabels";

export function SubtitleFileImportButton({ onBytes, disabledReason }: {
  onBytes: (bytes: Uint8Array) => void;
  /** 押せない理由（押せるなら null）。 */
  disabledReason: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabledReason != null}
        title={disabledReason ?? "字幕ファイル（.srt／.vtt）の字幕を、新しい列に時刻どおり並べます"}
        onClick={() => inputRef.current?.click()}
      >
        {SUBTITLE_FILE_IMPORT_LABEL}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".srt,.vtt"
        hidden
        data-testid="subtitle-file-input"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          onBytes(new Uint8Array(await file.arrayBuffer()));
        }}
      />
    </>
  );
}
