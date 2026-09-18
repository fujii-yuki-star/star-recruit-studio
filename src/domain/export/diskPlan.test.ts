// 書き出しの途中で空きを見る（#1211）。
//
// ⚠️ **ここが甘いと、12分待たされてから容量が尽きる**（#1205 の調査で実際に踏んだ形）。
// 逆に厳しすぎると、**書き出せる動画を断る**＝どちらも「次の行動が無い」（§2-5）。
import { describe, expect, it } from 'vitest';
import {
  canEstimateDisk,
  DISK_FLOOR_BYTES,
  DISK_MARGIN_RATIO,
  DISK_MIN_SAMPLE_FRAMES,
  diskIsShort,
  diskShortMessage,
  diskFloorMessage,
  diskFloorShortfall,
  diskShortfall,
  remainingBakeBytes,
  shouldCheckDisk,
} from './diskPlan';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('これから焼くぶんの見積もり', () => {
  it('焼いた実績から、残りぶんを見込む（安全代を上乗せする）', () => {
    // 30コマで 30MB＝1コマ 1MB。残り 70コマ → 70MB ＋ 2割。
    const n = remainingBakeBytes({ bakedFrames: 30, bakedBytes: 30 * MB, totalFrames: 100 });
    expect(n).toBe(Math.ceil(70 * MB * (1 + DISK_MARGIN_RATIO)));
  });

  // ⚠️ **安全代を入れる**＝コマの大きさは場面で変わる（先頭が単色だと小さく出る）。
  it('安全代のぶん、素の見込みより大きい', () => {
    const n = remainingBakeBytes({ bakedFrames: 30, bakedBytes: 30 * MB, totalFrames: 100 });
    expect(n).toBeGreaterThan(70 * MB);
  });

  it('焼き終わっていれば 0（残りが無い）', () => {
    expect(remainingBakeBytes({ bakedFrames: 100, bakedBytes: 100 * MB, totalFrames: 100 })).toBe(0);
  });

  // ⚠️ **総数を超えていても負にしない**＝負を返すと「空きが増える」ことになる。
  it('焼いた数が総数を超えていても 0（負にしない）', () => {
    expect(remainingBakeBytes({ bakedFrames: 120, bakedBytes: 120 * MB, totalFrames: 100 })).toBe(0);
  });

  it('まだ1コマも焼いていなければ 0（標本が無い）', () => {
    expect(remainingBakeBytes({ bakedFrames: 0, bakedBytes: 0, totalFrames: 100 })).toBe(0);
  });
});

describe('見積もってよいか', () => {
  // ⚠️ **少なすぎる標本で断らない**＝先頭が単色の場面だと極端に小さく出る。
  it('標本が足りなければ見積もらない', () => {
    expect(canEstimateDisk(DISK_MIN_SAMPLE_FRAMES - 1)).toBe(false);
  });

  it('標本が足りれば見積もる', () => {
    expect(canEstimateDisk(DISK_MIN_SAMPLE_FRAMES)).toBe(true);
  });
});

describe('空きを見に行く回', () => {
  // ⚠️ **最初の見積もりは早く**＝待たせてから断らない（これが無いと最後に近い所まで走る）。
  it('標本が貯まった時点で1回目を見る', () => {
    expect(shouldCheckDisk(DISK_MIN_SAMPLE_FRAMES)).toBe(true);
  });

  it('それ以前は見ない', () => {
    expect(shouldCheckDisk(DISK_MIN_SAMPLE_FRAMES - 1)).toBe(false);
    expect(shouldCheckDisk(1)).toBe(false);
  });

  // ⚠️ **毎コマ聞くと遅くなる**＝間引く。
  it('毎コマは見ない', () => {
    expect(shouldCheckDisk(DISK_MIN_SAMPLE_FRAMES + 1)).toBe(false);
  });

  it('その後は決まった間隔で見る', () => {
    expect(shouldCheckDisk(300)).toBe(true);
    expect(shouldCheckDisk(600)).toBe(true);
  });
});

describe('足りるか', () => {
  it('足りていれば不足は 0', () => {
    const s = diskShortfall({
      needStageBytes: 5 * GB, needOutBytes: 1 * GB,
      stageFreeBytes: 50 * GB, outFreeBytes: 50 * GB, sameDrive: true,
    });
    expect(diskIsShort(s)).toBe(false);
  });

  // ⚠️ **同じドライブなら足して比べる**＝別々に比べると、
  // **どちらも単独では足りるのに合計では足りない**を見逃す。
  it('同じドライブなら、一時と出来上がりを足して比べる', () => {
    const s = diskShortfall({
      needStageBytes: 30 * GB, needOutBytes: 3 * GB,
      stageFreeBytes: 32 * GB, outFreeBytes: 32 * GB, sameDrive: true,
    });
    expect(s.stageShortBytes, '足して比べていない（30も3も単独では足りる）').toBe(1 * GB);
  });

  // ⚠️ **別のドライブなら別々に比べる**＝足すと「空いているのに断る」。
  it('別のドライブなら、足さずに別々に比べる', () => {
    const s = diskShortfall({
      needStageBytes: 30 * GB, needOutBytes: 3 * GB,
      stageFreeBytes: 32 * GB, outFreeBytes: 32 * GB, sameDrive: false,
    });
    expect(diskIsShort(s), '別ドライブなのに足して断った').toBe(false);
  });

  it('保存先だけ足りないときは、保存先の不足を出す', () => {
    const s = diskShortfall({
      needStageBytes: 1 * GB, needOutBytes: 5 * GB,
      stageFreeBytes: 50 * GB, outFreeBytes: 2 * GB, sameDrive: false,
    });
    expect(s.outShortBytes).toBe(3 * GB);
    expect(s.stageShortBytes).toBe(0);
  });

  // ⚠️ **保存先を選ぶ前は、保存先を判じない**＝判じると、まだ無い場所で断ることになる。
  it('保存先がまだ決まっていなければ、保存先は判じない', () => {
    const s = diskShortfall({
      needStageBytes: 1 * GB, needOutBytes: 500 * GB,
      stageFreeBytes: 50 * GB, outFreeBytes: null, sameDrive: false,
    });
    expect(s.outShortBytes).toBe(0);
    expect(diskIsShort(s)).toBe(false);
  });
});

describe('足りないときの案内', () => {
  // ⚠️ **次の行動を示す**（§2-5）＝3つとも利用者の手が届く。
  it('やれることを並べる', () => {
    const m = diskShortMessage({ stageShortBytes: 3 * GB, outShortBytes: 0 });
    expect(m).toContain('減らす');
    expect(m).toContain('短く');
    expect(m).toContain('軽い');
  });

  // ⚠️ **技術用語を出さない**（§2-3）。
  it('技術用語を出さない', () => {
    const m = diskShortMessage({ stageShortBytes: 3 * GB, outShortBytes: 2 * GB });
    for (const ng of ['ステージ', '一時ファイル', 'バイト', 'ディスク', 'フレーム', 'PNG']) {
      expect(m, `技術用語が出ている: ${ng}`).not.toContain(ng);
    }
  });

  // ⚠️ **切り上げる**＝「1.0GB 空ければ足りる」と言って足りないのを防ぐ。
  it('足りない量は切り上げて出す', () => {
    expect(diskShortMessage({ stageShortBytes: 1.01 * GB, outShortBytes: 0 })).toContain('1.1GB');
  });

  it('小さいときは MB で出す（0.0GB と言わない）', () => {
    const m = diskShortMessage({ stageShortBytes: 50 * MB, outShortBytes: 0 });
    expect(m).toContain('50MB');
  });

  it('どちらが足りないかで言い方が変わる', () => {
    expect(diskShortMessage({ stageShortBytes: 0, outShortBytes: 1 * GB })).toContain('保存先');
    expect(diskShortMessage({ stageShortBytes: 1 * GB, outShortBytes: 0 })).not.toContain('保存先');
  });
});

// ⚠️ **場面形式は焼く総コマ数を先に知らない**＝見積もれない。何もしないと**使い切る**ので底で止める。
describe('見積もれないときの底', () => {
  it('底より空いていれば止めない', () => {
    expect(diskIsShort(diskFloorShortfall(DISK_FLOOR_BYTES + 1))).toBe(false);
  });

  it('底を割ったら止める', () => {
    expect(diskIsShort(diskFloorShortfall(DISK_FLOOR_BYTES - 1))).toBe(true);
  });

  // ⚠️ **必要量は分かっていない**ので、「あと何GB空ければ足りる」とは言わない（言えば嘘）。
  it('案内は「あと何GBで足りる」と言わない', () => {
    const m = diskFloorMessage(1 * GB);
    expect(m).toContain('残りわずか');
    expect(m).not.toContain('足りません');
  });

  it('案内はやれることを並べる（§2-5）', () => {
    const m = diskFloorMessage(1 * GB);
    expect(m).toContain('減らす');
    expect(m).toContain('短く');
    expect(m).toContain('軽い');
  });

  // ⚠️ **負の残りを見せない**（使い切った後に呼ばれうる）。
  it('空きが負でも 0 として見せる', () => {
    expect(diskFloorMessage(-1)).toContain('0MB');
  });
});
