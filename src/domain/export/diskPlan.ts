// 書き出しの途中で「空きが足りるか」を判じる（#1211）。**純粋関数**。
//
// ⚠️ **なぜ途中で見るか**＝必要量は**推測できない**。1コマの大きさは中身で**7倍**変わる
// （実測＝写真と文字の場面 0.12MB／細かい模様の実写 0.83MB・#1205 の調査）。
// 固定の値を置くと、大きめなら**書き出せる動画を断り**、小さめなら**断れずに容量が尽きる**
// ＝どちらも「次の行動が無い」（§2-5）。
//
// ⚠️ **だから、その動画自身の焼き上がりを測って見積もる**＝最初の数十コマの実績から残りを見込む。
// 足りなければ**数秒で止まる**（いまは12分以上待たされてから尽きて、しかも数十GBが残る）。

/** 見積もりに上乗せする安全代（コマの大きさは場面で変わるため）。 */
export const DISK_MARGIN_RATIO = 0.2;

/**
 * 見積もれるだけの実績が貯まったか（**少なすぎる標本で断らない**）。
 *
 * ⚠️ **1コマで決めない**＝先頭が単色の場面だと極端に小さく、**足りないのに通す**。
 */
export const DISK_MIN_SAMPLE_FRAMES = 30;

/** 空きを見に行く間隔（コマ数）。⚠️ **毎コマ聞くと遅くなる**ので間引く。 */
export const DISK_CHECK_EVERY_FRAMES = 300;

/**
 * これから焼くぶんに要る大きさ（バイト）。**重ねた結果のPNGのぶんだけ**。
 *
 * ⚠️ **素材から取り出す「生のコマ」は、ここでは見込みません**（PR #1216 レビュー 🔴 への答え）。
 * 見込まないのは手抜きではなく、**見込むと二重に数えるから**です：
 * 取り出しは**区間の頭でまとめて**起きるので、**取り出し済みのぶんは既に空きが減っています**
 *（空きは実測で読む）。そこへ「1コマあたりの取り出し量 × 残りコマ数」を足すと、
 * **もう書かれているものを、もう一度これから書くものとして数える**ことになります。
 * 実測（#1216・回した動画20本）では、**取り出しは全部が1コマ目より前に終わって**いました
 *（生 240KB/枚 × 3,620枚＝約840MB）。ここで見込んでいたら、**書き出せる動画を断って**いたはずです。
 * ⚠️ **代わりに、取り出した直後に空きを見ます**（`ffmpegExport.ts` の `accountStagedVideo`）＝
 * **予想せず、起きたことに反応する**。取り出しは一気に起きるので、その直後に見れば取りこぼしません。
 *
 * ⚠️ **「残り」ではなく「全部」を返す**＝すでに焼いたぶんも空きを食っているので、
 * **いまの空き**と比べるなら残りぶんだけでよいが、**呼ぶ側が取り違えやすい**ので名前で示す。
 */
export function remainingBakeBytes(input: {
  /** ここまでに焼いたコマ数（`DISK_MIN_SAMPLE_FRAMES` 以上で呼ぶこと）。 */
  bakedFrames: number;
  /** ここまでに焼いたコマの合計バイト（**重ねた結果のPNG**）。 */
  bakedBytes: number;
  /** 焼く総コマ数（⚠️ **倒せた区間は含めない**＝1コマも焼かないので）。 */
  totalFrames: number;
}): number {
  const { bakedFrames, bakedBytes, totalFrames } = input;
  if (bakedFrames <= 0 || bakedBytes <= 0) return 0;
  const left = Math.max(0, totalFrames - bakedFrames);
  if (left === 0) return 0;
  const perFrame = bakedBytes / bakedFrames;
  return Math.ceil(perFrame * left * (1 + DISK_MARGIN_RATIO));
}

/** 空きが足りないときの不足ぶん（バイト）。`0`＝足りる。 */
export interface DiskShortfall {
  /** 一時ファイルの置き場で足りないぶん。 */
  stageShortBytes: number;
  /** 保存先で足りないぶん。 */
  outShortBytes: number;
}

/**
 * 足りるか（`stageShortBytes`・`outShortBytes` がどちらも 0 なら足りる）。
 *
 * ⚠️ **同じドライブなら足して比べる**＝一時ファイルと出来上がりが**同じ空きを取り合う**。
 * 別々に比べると、**どちらも単独では足りるのに合計では足りない**を見逃す。
 * ⚠️ **別のドライブなら別々に比べる**＝足すと、**空いているのに断る**。
 */
export function diskShortfall(input: {
  /** これから焼くぶん（`remainingBakeBytes`）。 */
  needStageBytes: number;
  /** 出来上がりのMP4の見込み（分からなければ 0）。 */
  needOutBytes: number;
  stageFreeBytes: number;
  /** 保存先の空き（まだ選んでいなければ `null`＝**保存先は判じない**）。 */
  outFreeBytes: number | null;
  /** 一時ファイルと保存先が同じドライブか。 */
  sameDrive: boolean;
}): DiskShortfall {
  const { needStageBytes, needOutBytes, stageFreeBytes, outFreeBytes, sameDrive } = input;
  if (outFreeBytes != null && sameDrive) {
    const short = Math.max(0, needStageBytes + needOutBytes - stageFreeBytes);
    return { stageShortBytes: short, outShortBytes: 0 };
  }
  return {
    stageShortBytes: Math.max(0, needStageBytes - stageFreeBytes),
    outShortBytes: outFreeBytes == null ? 0 : Math.max(0, needOutBytes - outFreeBytes),
  };
}

/** 足りないか（どちらか一方でも足りなければ真）。 */
export function diskIsShort(s: DiskShortfall): boolean {
  return s.stageShortBytes > 0 || s.outShortBytes > 0;
}

/** そのコマ数で見積もってよいか。 */
export function canEstimateDisk(bakedFrames: number): boolean {
  return bakedFrames >= DISK_MIN_SAMPLE_FRAMES;
}

/** 空きを見に行く回か（⚠️ **最初の見積もりは早く**＝待たせてから断らない）。 */
export function shouldCheckDisk(bakedFrames: number): boolean {
  if (bakedFrames === DISK_MIN_SAMPLE_FRAMES) return true;
  return bakedFrames > DISK_MIN_SAMPLE_FRAMES && bakedFrames % DISK_CHECK_EVERY_FRAMES === 0;
}

/**
 * **これ以上は使わせない**空き（バイト）。⚠️ **見積もれないときの底**（#1211）。
 *
 * ⚠️ **場面形式は焼く総コマ数を先に知らない**（場面ごとに数える作りで、全体の合計を持っていない）。
 * 見積もれないときに**何もしない**と、**ディスクを使い切る**（パソコン全体が不安定になり、
 * 後片づけにすら空きが要る）。せめて**この底で止める**＝止まった後に消す余地が残る。
 *
 * ⚠️ **見積もれるなら、そちらが優先**（底は「最後の砦」であって、断りの主ではない）。
 */
export const DISK_FLOOR_BYTES = 2 * 1024 * 1024 * 1024;

/** 底を割っているか（`freeBytes` が `DISK_FLOOR_BYTES` を下回った量）。 */
export function diskFloorShortfall(freeBytes: number): DiskShortfall {
  return { stageShortBytes: Math.max(0, DISK_FLOOR_BYTES - freeBytes), outShortBytes: 0 };
}

/**
 * 底を割ったときの案内（§2-5）。⚠️ **「あと何GB空ければ足りる」とは言わない**＝
 * **必要量が分かっていないから底で止めている**ので、言えば嘘になる。
 */
export function diskFloorMessage(freeBytes: number): string {
  return `空き容量が残りわずかです（残り約${gbText(Math.max(0, freeBytes))}）。いらないファイルを減らすか、動画を短くするか、動画サイズを「軽い」にしてから、もう一度お試しください。`;
}

/** GB の文字（⚠️ **切り上げ**＝「1GB 空ければ足りる」と言って足りないのを防ぐ）。 */
function gbText(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  return gb < 0.1 ? `${Math.ceil(bytes / 1024 / 1024)}MB` : `${(Math.ceil(gb * 10) / 10).toFixed(1)}GB`;
}

/**
 * 足りないときの案内（§2-5＝原因＋**次の行動**）。
 *
 * ⚠️ **技術用語を出さない**（§2-3）＝「ステージ」「一時ファイル」ではなく「動画を作るための場所」。
 * ⚠️ **やれることを並べる**＝消す／短くする／軽くする。**どれも利用者の手が届く**。
 */
export function diskShortMessage(s: DiskShortfall): string {
  const where = s.stageShortBytes > 0 && s.outShortBytes > 0
    ? '動画を作るための場所と保存先'
    : s.outShortBytes > 0
      ? '保存先'
      : '動画を作るための場所';
  const short = Math.max(s.stageShortBytes, s.outShortBytes);
  return `${where}の空き容量が約${gbText(short)}足りません。いらないファイルを減らすか、動画を短くするか、動画サイズを「軽い」にしてから、もう一度お試しください。`;
}
