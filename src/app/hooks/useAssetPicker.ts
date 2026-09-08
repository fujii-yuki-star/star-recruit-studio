// 素材を選ぶ入口の**振る舞い**（#712）。見た目は画面ごとに違ってよいが、**選び方の分岐は1か所**にする。
//
// アプリの中ではネイティブの「開く」でパスだけを受け取り（素材のバイトを JS に載せない＝ADR-0004）、
// ブラウザでは中に隠した `<input type=file>` へ落ちる。この分岐＋キーボード操作は、素材の画面・
// はじめの入力・タイムライン編集の3か所で同じものが要る。部品（`AssetImportButton`）だけを共有すると、
// **見た目の違う入口（はじめの入力の大きな枠）が共有から外れて取り残される**ので、振る舞いを分けて出す。
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { isTauri } from "../../infrastructure/assetFs";
import { AUDIO_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from "../../domain/asset/assetFile";
import { showOpenAssetsDialog, showOpenLibraryAssetsDialog } from "../../infrastructure/dialog";
import { onWindowFileDrop } from "../../infrastructure/fileDropEvents";
import { cssPointOf, isPointInRect, triageDroppedFiles } from "../../domain/asset/fileDrop";

/** ファイル選択の絞り込み（`.png,.jpg,…`）。拡張子の正典から作る。 */
const ACCEPT_ATTR = [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS].map((e) => `.${e}`).join(",");
/**
 * 音も選べる絞り込み（差分再監査 3巡目 ℹ️）。**タイムライン形式だけ**で使う。
 *
 * ⚠️ **場面形式は写真・動画のまま**＝BGM は BGM の導線から入れる（`BgmPicker`）。
 * タイムライン形式は**音そのものが置ける部品**なので、取り込めないと
 * **よく使う素材に置いた音楽がタイムラインへ届かない**（ADR-0035 が棚の中身に BGM を挙げている）。
 */
const ACCEPT_ATTR_WITH_AUDIO = [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS]
  .map((e) => `.${e}`)
  .join(",");

type Options = {
  /**
   * 選んだものを**まとめて**取り込む（#858）。ブラウザは `File[]`、アプリの中は絶対パスの `string[]`。
   *
   * ⚠️ **1件ずつに割らない**＝進み具合・失敗の残し方・`asset_NNN` の採番は取り込み側（store の
   * `addAssets`）が持つ。ここで回すと、失敗の案内が**画面が既に出しているもの**と二重になる
   *（4画面とも `importError` を出している）。
   */
  onPick: (items: File[] | string[]) => void | Promise<void>;
  /** 押せないとき（取り込み中・書き出し中など）。 */
  disabled?: boolean;
  /**
   * 音も選べるようにするか（差分再監査 3巡目・**タイムライン形式だけ**）。
   * ⚠️ 場面形式は写真・動画のまま＝BGM は BGM の導線から入れる。
   */
  withAudio?: boolean;
  /**
   * **落として取り込めるようにする**か（#1026 ②）。
   *
   * ⚠️ **既定は無効**＝受けるなら `onReject` で**通らなかったものを知らせる場所**が要る
   *（黙って捨てると「落としたのに増えない」になる・§2-5）。小さなボタンの入口はその場所を
   * 持たないので、いまは大きな枠（はじめの入力）だけが受ける。
   */
  acceptsDrop?: boolean;
  /** 落としたものに取り込めない形式が混ざっていたときに渡す名前（`acceptsDrop` とセット）。 */
  onReject?: (names: string[]) => void;
};

/**
 * `<label>` に広げて使う（中に `<input type=file>` を1つ置くこと）。
 * 返す `picking` は**ネイティブの「開く」を出している最中**＝二重に開かせない。
 */
export function useAssetPicker({ onPick, disabled = false, withAudio = false, acceptsDrop = false, onReject }: Options) {
  const [picking, setPicking] = useState(false);
  // 落とし込みが枠の上に来ているか（見た目を変えて「ここで受ける」を示す）。
  const [dropOver, setDropOver] = useState(false);
  const blocked = disabled || picking;
  const zoneRef = useRef<HTMLElement | null>(null);
  // ⚠️ **購読は張り替えない**（毎レンダーで作り直すと、落とす瞬間に受け手が居ない時間ができる）＝
  // 変わるもの（取り込む手・押せるか・音を通すか）は控えを通して読む（`playRef` と同じ形）。
  const liveRef = useRef({ onPick, onReject, blocked, withAudio, acceptsDrop });
  useEffect(() => {
    liveRef.current = { onPick, onReject, blocked, withAudio, acceptsDrop };
  });

  async function pick(items: File[] | string[]) {
    setPicking(true);
    try {
      await onPick(items);
    } finally {
      setPicking(false);
    }
  }

  async function pickNative() {
    setPicking(true);
    try {
      // ⚠️ **2つのふるいを揃える**＝`accept` で音を許すなら、ネイティブの「開く」も同じにする
      // （片方だけだと、ボタンからは選べるのにアプリの中では選べない＝差分再監査 3巡目）。
      const paths = withAudio ? await showOpenLibraryAssetsDialog() : await showOpenAssetsDialog();
      if (paths.length > 0) await onPick(paths);
    } finally {
      setPicking(false);
    }
  }

  /** 落とされたものを**ふるいにかけてから**取り込む（通らなかったものは知らせる）。 */
  async function pickDropped(items: File[] | string[]) {
    const { onPick: pickNow, onReject: rejectNow, withAudio: audio } = liveRef.current;
    const triaged = Array.isArray(items) && items.length > 0 && typeof items[0] === "string"
      ? triageDroppedFiles(items as string[], (p) => p, audio)
      : triageDroppedFiles(items as File[], (f) => f.name, audio);
    if (triaged.rejectedNames.length > 0) rejectNow?.(triaged.rejectedNames);
    if (triaged.accepted.length === 0) return;
    setPicking(true);
    try {
      await pickNow(triaged.accepted as File[] | string[]);
    } finally {
      setPicking(false);
    }
  }

  // アプリの中では**窓ごと**Tauri が受ける（要素の `drop` は来ない）ので、落ちた場所が
  // この枠の上かを座標で見る。ブラウザ側は下の `dropProps`（要素の `drop`）。
  useEffect(() => {
    let un: (() => void) | null = null;
    let cancelled = false;
    void onWindowFileDrop((e) => {
      const zone = zoneRef.current;
      if (!zone || !liveRef.current.acceptsDrop) return;
      if (e.kind === "leave") { setDropOver(false); return; }
      if (!e.position) return;
      const over = isPointInRect(cssPointOf(e.position, window.devicePixelRatio || 1), zone.getBoundingClientRect());
      if (e.kind === "over") { setDropOver(over && !liveRef.current.blocked); return; }
      setDropOver(false);
      // 取り込み中・書き出し中は受けない（押せないボタンと同じ扱い＝黙って始めない）。
      if (!over || liveRef.current.blocked) return;
      void pickDropped(e.paths);
    }).then((f) => {
      if (cancelled) f();
      else un = f;
    });
    return () => { cancelled = true; un?.(); };
  }, []);

  return {
    picking,
    /** 落とし込みが枠の上にあるか（受けられることを見た目で示す）。 */
    dropOver,
    /** `<label>` に付ける（クリック・キーボード・ファイル選択・落とし込み）。 */
    labelProps: {
      ref: (el: HTMLElement | null) => { zoneRef.current = el; },
      role: "button" as const,
      tabIndex: 0,
      "aria-disabled": blocked,
      // ブラウザ側の受け口。**既定を止めないと**ブラウザがそのファイルを開いてしまう（画面が消える）。
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!acceptsDrop || blocked || e.dataTransfer.types.every((t) => t !== "Files")) return;
        e.preventDefault();
        setDropOver(true);
      },
      onDragLeave: () => setDropOver(false),
      onDrop: (e: DragEvent<HTMLElement>) => {
        setDropOver(false);
        if (!acceptsDrop || blocked) return;
        const files = [...e.dataTransfer.files];
        if (files.length === 0) return;
        e.preventDefault();
        void pickDropped(files);
      },
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
      accept: withAudio ? ACCEPT_ATTR_WITH_AUDIO : ACCEPT_ATTR,
      // ⚠️ **ブラウザ側も複数選べる**（#858）＝アプリの中（ネイティブの「開く」）だけ一括だと、
      // 同じ画面の同じボタンで挙動が割れる（ADR-0026②）。
      multiple: true,
      disabled: blocked,
      style: { display: "none" } as const,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = ""; // 同じファイルを選び直しても change が発火するようにする
        if (files.length > 0) void pick(files);
      },
    },
  };
}
