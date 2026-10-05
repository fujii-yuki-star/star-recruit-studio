// 取り込んだ写真を裏で1枚ずつ読んで説明を当てる（ADR-0052 決定4・12 §4b）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../../domain/project/types";
import { createAssetDescribeQueue } from "./assetDescribeQueue";
import type { AssetDescribeDeps } from "./assetDescribeQueue";

const OK = JSON.stringify({ description: "明るいオフィス", tags: ["オフィス"] });

function photo(id: string, over: Partial<Asset> = {}): Asset {
  return { assetId: id, assetType: "image", displayName: `${id}.jpg`, filePath: `assets/${id}.jpg`, ...over } as Asset;
}

function setup(assets: Asset[], over: Partial<AssetDescribeDeps> = {}) {
  const state = { projectId: "p1", assets: [...assets] };
  const deps: AssetDescribeDeps = {
    available: vi.fn(async () => true),
    describe: vi.fn(async () => OK),
    current: (id) => {
      const asset = state.assets.find((a) => a.assetId === id);
      return asset ? { projectId: state.projectId, asset } : undefined;
    },
    apply: (id, update) => {
      state.assets = state.assets.map((a) => (a.assetId === id ? update(a) ?? a : a));
    },
    blocked: () => false,
    sleep: async () => undefined,
    ...over,
  };
  return { state, deps, queue: createAssetDescribeQueue(deps) };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("createAssetDescribeQueue", () => {
  it("積んだ写真を読んで説明とタグを当てる（プロジェクトの中の相対パスで頼む）", async () => {
    const { state, deps, queue } = setup([photo("a1")]);
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("a1.jpg"), expect.any(String), "p1", "assets/a1.jpg");
    expect(state.assets[0]).toMatchObject({ aiDescription: "明るいオフィス", tags: ["オフィス"] });
  });

  it("1枚ずつ順に読む（同時に何枚も頼まない）", async () => {
    let inFlight = 0;
    let max = 0;
    const { queue } = setup([photo("a1"), photo("a2"), photo("a3")], {
      describe: vi.fn(async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return OK;
      }),
    });
    for (const id of ["a1", "a2", "a3"]) queue.enqueue(id, () => true);
    await queue.idle();
    expect(max).toBe(1);
  });

  it("同じ写真は読み直さない（読めなかったときも）", async () => {
    const describeFn = vi.fn(async () => { throw new Error("x"); });
    const { queue } = setup([photo("a1")], { describe: describeFn });
    queue.enqueue("a1", () => true);
    await queue.idle();
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(describeFn).toHaveBeenCalledTimes(1);
  });

  it("別の動画の同じ番号の素材は、別の写真として読む", async () => {
    const { state, deps, queue } = setup([photo("a1")]);
    queue.enqueue("a1", () => true);
    await queue.idle();
    state.projectId = "p2";
    state.assets = [photo("a1")];
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(2);
  });

  it("同梱されていなければ何も読まない（問い合わせは1回だけ・失敗も使えない扱い）", async () => {
    const available = vi.fn(async () => false);
    const { deps, queue } = setup([photo("a1"), photo("a2")], { available });
    queue.enqueue("a1", () => true);
    await queue.idle();
    queue.enqueue("a2", () => true);
    await queue.idle();
    expect(available).toHaveBeenCalledTimes(1);
    expect(deps.describe).not.toHaveBeenCalled();
    const broken = setup([photo("a1")], { available: () => { throw new Error("no"); } });
    broken.queue.enqueue("a1", () => true);
    await broken.queue.idle();
    expect(broken.deps.describe).not.toHaveBeenCalled();
  });

  it("別の動画を開いたら読まない・読み終わっても当てない", async () => {
    const { state, deps, queue } = setup([photo("a1"), photo("a2")]);
    queue.enqueue("a1", () => false);
    await queue.idle();
    expect(deps.describe).not.toHaveBeenCalled();
    let open = true;
    deps.describe = vi.fn(async () => { open = false; return OK; });
    queue.enqueue("a2", () => open);
    await queue.idle();
    expect(state.assets[1].aiDescription).toBeUndefined();
  });

  it("もう説明がある写真・消された写真は読まない", async () => {
    const { deps, queue } = setup([photo("a1", { aiDescription: "自分で書いた" })]);
    queue.enqueue("a1", () => true);
    queue.enqueue("gone", () => true);
    await queue.idle();
    expect(deps.describe).not.toHaveBeenCalled();
  });

  it("読んでいる間に利用者が説明を書いたら上書きしない", async () => {
    const { state, queue } = setup([photo("a1")], {
      describe: vi.fn(async () => {
        state.assets = [photo("a1", { aiDescription: "利用者の説明" })];
        return OK;
      }),
    });
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(state.assets[0].aiDescription).toBe("利用者の説明");
  });

  it("書き出し中は当てるのを待ち、終わってから当てる", async () => {
    let busy = 3;
    const sleep = vi.fn(async () => { busy--; });
    const { state, queue } = setup([photo("a1")], { blocked: () => busy > 0, sleep });
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(state.assets[0].aiDescription).toBe("明るいオフィス");
  });

  it("書き出しを待っている間に別の動画を開いたら当てない（待ち続けない）", async () => {
    let open = true;
    const sleep = vi.fn(async () => { open = false; });
    const { state, queue } = setup([photo("a1")], { blocked: () => true, sleep });
    queue.enqueue("a1", () => open);
    await queue.idle();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(state.assets[0].aiDescription).toBeUndefined();
  });

  it("形の違う応答は当てない", async () => {
    const { state, queue } = setup([photo("a1")], { describe: vi.fn(async () => "説明です") });
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(state.assets[0].aiDescription).toBeUndefined();
  });

  it("途中の失敗（当てる側の例外）でも残りを読む", async () => {
    const { state, deps, queue } = setup([photo("a1"), photo("a2")]);
    const apply = deps.apply;
    deps.apply = vi.fn((id, update) => { if (id === "a1") throw new Error("boom"); apply(id, update); });
    queue.enqueue("a1", () => true);
    queue.enqueue("a2", () => true);
    await queue.idle();
    expect(state.assets[1].aiDescription).toBe("明るいオフィス");
  });

  it("読み終わり際に積んだものも取り残さない（1件目が終わってから数手あとに積む＝終わりの隙に当てる）", async () => {
    for (let depth = 0; depth < 8; depth++) {
      const { state, deps, queue } = setup([photo("a1"), photo("a2")]);
      const apply = deps.apply;
      deps.apply = (id, update) => {
        apply(id, update);
        if (id !== "a1") return;
        let p = Promise.resolve();
        for (let i = 0; i < depth; i++) p = p.then(() => undefined);
        void p.then(() => queue.enqueue("a2", () => true));
      };
      queue.enqueue("a1", () => true);
      await queue.idle();
      await new Promise((r) => setTimeout(r, 0));
      await queue.idle();
      expect(state.assets[1].aiDescription, `depth=${depth}`).toBe("明るいオフィス");
    }
  });

  // #1317 レビュー 🟡：同じ動画を開き直したとき、前の版の仕事は捨てられる＝「試した」を消して新しい版で読み直す。
  it("読んでいる間に開き直されて捨てた写真は、次に積んだとき読み直す", async () => {
    let open = true;
    const { state, deps, queue } = setup([photo("a1")], {
      describe: vi.fn(async () => { open = false; return OK; }), // 読んでいる間に閉じられた（開き直し）
    });
    queue.enqueue("a1", () => open);
    await queue.idle();
    expect(state.assets[0].aiDescription).toBeUndefined();
    (deps.describe as ReturnType<typeof vi.fn>).mockImplementation(async () => OK);
    queue.enqueue("a1", () => true); // 新しい版で積み直す
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(2);
    expect(state.assets[0].aiDescription).toBe("明るいオフィス");
  });

  it("書き出し中に積まれたら読み始めない（書き出しが終わってから読む）", async () => {
    let busy = true;
    const order: string[] = [];
    const { deps, queue } = setup([photo("a1")], {
      blocked: () => busy,
      sleep: async () => { order.push("待つ"); busy = false; },
      describe: vi.fn(async () => { order.push(busy ? "書き出し中に読んだ" : "読んだ"); return OK; }),
    });
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["待つ", "読んだ"]);
  });

  it("書き出しを待つ間に閉じられたら読まず、次に積めば読む", async () => {
    let open = true;
    const { deps, queue } = setup([photo("a1")], {
      blocked: () => open, // 閉じるまでずっと書き出し中
      sleep: async () => { open = false; },
    });
    queue.enqueue("a1", () => open);
    await queue.idle();
    expect(deps.describe).not.toHaveBeenCalled();
    // 同じ列で積み直す（閉じた後は書き出しも終わっている）。
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(1);
  });

  // #1317：写真を差し替えたら、この画面で一度読んだ素材でも読み直す（`retry`）。ふつうに積むと「試した」で飛ばす。
  it("一度読んだ素材は、ふつうに積んでも読み直さず、retry なら読み直す", async () => {
    const { state, deps, queue } = setup([photo("a1")]);
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(1);
    state.assets = [photo("a1")]; // 差し替えで説明を外した状態
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(1);
    queue.enqueue("a1", () => true, { retry: true });
    await queue.idle();
    expect(deps.describe).toHaveBeenCalledTimes(2);
    expect(state.assets[0].aiDescription).toBe("明るいオフィス");
  });

  // #1317 レビュー 🟡：読んでいる最中に写真を差し替えたら、その結果（前の写真の説明）は当てない。差し替えた側が積み直す。
  it("読んでいる最中に差し替わった（invalidate）ら当てず、積み直せば新しい写真で当てる", async () => {
    let release!: (v: string) => void;
    const { state, deps, queue } = setup([photo("a1")], {
      describe: vi.fn(() => new Promise<string>((r) => { release = r; })),
    });
    queue.enqueue("a1", () => true);
    await vi.waitFor(() => expect(deps.describe).toHaveBeenCalledTimes(1));
    queue.invalidate("a1"); // ここで写真が差し替わった
    release(JSON.stringify({ description: "前の写真の説明", tags: [] }));
    await queue.idle();
    expect(state.assets[0].aiDescription).toBeUndefined();
    (deps.describe as ReturnType<typeof vi.fn>).mockImplementation(async () => JSON.stringify({ description: "新しい写真の説明", tags: [] }));
    queue.enqueue("a1", () => true, { retry: true });
    await queue.idle();
    expect(state.assets[0].aiDescription).toBe("新しい写真の説明");
  });
});

// UI/UX 監査 2026-10-02：裏で読んでいることを画面に出す（「読み取り中…」・動画案を作る前の「あと N 件」）。
describe("読む予定の素材を知らせる（onPending）", () => {
  it("積んだら知らせ、読み終わったら外す（1枚ずつなので、読み終えた分から減る）", async () => {
    const seen: string[][] = [];
    const { queue } = setup([photo("a1"), photo("a2")], { onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("a1", () => true);
    queue.enqueue("a2", () => true);
    expect(seen[1]).toEqual(["a1", "a2"]);
    await queue.idle();
    expect(seen.at(-2)).toEqual(["a2"]); // a1 を読み終えた時点
    expect(seen.at(-1)).toEqual([]);
  });

  it("読まないもの（説明がある・利用者が書いた・音・もう試した）は数えない", async () => {
    const seen: string[][] = [];
    const { queue } = setup([
      photo("done", { aiDescription: "もうある" }),
      photo("mine", { aiDescriptionAuthor: "user" } as Partial<Asset>),
      { assetId: "bgm", assetType: "bgm", displayName: "bgm.mp3", filePath: "assets/bgm.mp3" } as Asset,
    ], { onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("done", () => true);
    queue.enqueue("mine", () => true);
    queue.enqueue("bgm", () => true);
    await queue.idle();
    expect(seen.flat()).toEqual([]);
  });

  it("もう試した写真を積み直しても数えない（読まないのに「読み取り中」と言わない）・読み直しなら数える", async () => {
    const seen: string[][] = [];
    const { state, queue } = setup([photo("a1")], { describe: vi.fn(async () => "形が違う"), onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("a1", () => true);
    await queue.idle();
    seen.length = 0;
    queue.enqueue("a1", () => true);
    expect(seen).toEqual([]);
    await queue.idle();
    state.assets = [photo("a1")];
    queue.enqueue("a1", () => true, { retry: true });
    expect(seen[0]).toEqual(["a1"]);
    await queue.idle();
  });

  it("閉じた動画の素材は数えない", () => {
    const seen: string[][] = [];
    const { queue } = setup([photo("a1")], { onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("a1", () => false);
    expect(seen).toEqual([]);
  });

  it("同梱の AI が無ければ、積んだ分を全部外す（「読み取り中」を残さない）", async () => {
    const seen: string[][] = [];
    const { queue, deps } = setup([photo("a1"), photo("a2")], { available: vi.fn(async () => false), onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("a1", () => true);
    queue.enqueue("a2", () => true);
    await queue.idle();
    expect(deps.describe).not.toHaveBeenCalled();
    expect(seen.at(-1)).toEqual([]);
  });

  it("読むのに失敗しても外す", async () => {
    const seen: string[][] = [];
    const { queue } = setup([photo("a1")], { describe: vi.fn(async () => { throw new Error("x"); }), onPending: (ids) => seen.push([...ids]) });
    queue.enqueue("a1", () => true);
    await queue.idle();
    expect(seen.at(-1)).toEqual([]);
  });

  it("同じ写真を2回積んだら、2回とも終わるまで外さない", async () => {
    let release!: (v: string) => void;
    const seen: string[][] = [];
    const { state, queue } = setup([photo("a1")], {
      describe: vi.fn(() => new Promise<string>((r) => { release = r; })),
      onPending: (ids) => seen.push([...ids]),
    });
    queue.enqueue("a1", () => true);
    queue.enqueue("a1", () => true, { retry: true }); // 差し替え
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(OK);
    await queue.idle();
    expect(state.assets[0].aiDescription).toBe("明るいオフィス");
    // 1回目が終わった時点では、まだ外さない（空になるのは2回目が終わったときの1度だけ）。
    expect(seen.filter((ids) => ids.length === 0)).toHaveLength(1);
    expect(seen.at(-2)).toEqual(["a1"]);
    expect(seen.at(-1)).toEqual([]);
  });
});
