// 素材を選ぶ入口の**振る舞い**（#712）。見た目は画面ごとに違ってよいが、**選び方の分岐は1か所**にする。
//
// アプリの中ではネイティブの「開く」でパスだけを受け取り（素材のバイトを JS に載せない＝ADR-0004）、
// ブラウザでは中に隠した `<input type=file>` へ落ちる。この分岐＋キーボード操作は、素材の画面・
// はじめの入力・タイムライン編集の3か所で同じものが要る。部品（`AssetImportButton`）だけを共有すると、
// **見た目の違う入口（はじめの入力の大きな枠）が共有から外れて取り残される**ので、振る舞いを分けて出す。
import { useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { isTauri } from "../../infrastructure/assetFs";
import { IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from "../../domain/asset/assetFile";
import { showOpenAssetDialog } from "../../infrastructure/dialog";

/** ファイル選択の絞り込み（`.png,.jpg,…`）。拡張子の正典から作る。 */
const ACCEPT_ATTR = [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS].map((e) => `.${e}`).join(",");

type Options = {
  /** ブラウザで選んだファイルを取り込む。 */
  onFile: (file: File) => void | Promise<void>;
  /** ネイティブの「開く」で選んだパスを取り込む。 */
  onPath: (path: string) => void | Promise<void>;
  /** 押せないとき（取り込み中・書き出し中など）。 */
  disabled?: boolean;
};

/**
 * `<label>` に広げて使う（中に `<input type=file>` を1つ置くこと）。
 * 返す `picking` は**ネイティブの「開く」を出している最中**＝二重に開かせない。
 */
export function useAssetPicker({ onFile, onPath, disabled = false }: Options) {
  const [picking, setPicking] = useState(false);
  const blocked = disabled || picking;

  async function pickNative() {
    setPicking(true);
    try {
      const path = await showOpenAssetDialog();
      if (path) await onPath(path);
    } finally {
      setPicking(false);
    }
  }

  return {
    picking,
    /** `<label>` に付ける（クリック・キーボード・ファイル選択）。 */
    labelProps: {
      role: "button" as const,
      tabIndex: 0,
      "aria-disabled": blocked,
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (blocked) { e.preventDefault(); return; }
        // アプリの中では隠し `<input>` を開かず、ネイティブの「開く」へ回す。
        if (isTauri()) { e.preventDefault(); void pickNative(); }
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (blocked) return;
        if (isTauri()) void pickNative();
        else e.currentTarget.querySelector("input")?.click();
      },
    },
    /** 隠し `<input type=file>` に付ける。 */
    inputProps: {
      type: "file" as const,
      // 取り込める形式の正典（`assetFile.ts`）から作る＝ネイティブの「開く」の絞り込み
      // （`infrastructure/dialog.ts`）と**同じ一覧**を見る（2つのふるいが食い違わない）。
      accept: ACCEPT_ATTR,
      disabled: blocked,
      style: { display: "none" } as const,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void onFile(file);
        e.target.value = ""; // 同じファイルを選び直しても change が発火するようにする
      },
    },
  };
}
