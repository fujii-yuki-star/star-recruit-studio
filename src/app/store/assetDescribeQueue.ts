// 取り込んだ写真を、裏で1枚ずつ同梱の AI に読ませて説明とタグを当てる（ADR-0052 決定4・12 §4b）。
//
// ⚠️ **取り込みや編集を止めない**＝取り込みの `await` には入れず、待たずに積むだけ（`enqueue`）。
// ⚠️ **1枚ずつ順に**＝同じ llama-server に同時に何枚も投げない（最低検証機で1枚 6〜8 秒・メモリを食う）。
// ⚠️ **同じ写真を読み直し続けない**＝読めなかった・捨てた写真も「試した」として覚える（この画面を開いている間）。
// ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（`sameDocGuard`・#762）＝読んでいる間に別の動画を開いたら当てない。
// ⚠️ **同梱されていなければ何もしない**（ブラウザでの開発・部品が無い）＝画面に何も出さない（説明が付かないだけ）。
import {
  applyAssetDescription,
  buildDescribeAssetMessages,
  describeTarget,
  parseAssetDescription,
} from "../../domain/ai/describeAssetRequest";
import type { Asset } from "../../domain/project/types";

export interface AssetDescribeDeps {
  /** 同梱の AI が使えるか（1回だけ問い合わせる）。 */
  available(): Promise<boolean>;
  /** 写真を1枚読む（Rust の `local_ai_describe_image`）。応答の本文を返す。 */
  describe(system: string, user: string, schema: string, projectId: string, relPath: string): Promise<string>;
  /** いまの動画の番号と、その素材（無ければ undefined）。 */
  current(assetId: string): { projectId: string; asset: Asset } | undefined;
  /** 素材に当てる（`update` が null を返したら当てない）。 */
  apply(assetId: string, update: (asset: Asset) => Asset | null): void;
  /**
   * いま当ててはいけないか（書き出し中）。true の間は当てるのを待つ＝書き出し中に未保存へ戻して自動保存を走らせない
   * （書き出し中は素材の編集を止めている＝`updateAsset` と同じ扱い）。
   */
  blocked(): boolean;
  /** 待つ（検査で差し替える）。 */
  sleep(ms: number): Promise<void>;
  /**
   * **読む予定の素材**が変わった（UI/UX 監査 2026-10-02＝裏で読んでいることが画面のどこにも見えず、
   * 読み終わる前に動画案を作ると、説明の無いまま作られることに気づけなかった）。
   * ⚠️ 数えるのは**実際に読むもの**だけ（積んだ時点で説明が要る写真・動画）＝説明があるもの・音は数えない
   * （1枚ずつ順に読むので、20枚の後ろに積んだ音が「読み取り中」に見え続けてしまう）。
   */
  onPending?(keys: readonly string[]): void;
}

/**
 * 「読み取り中」の見分け（`onPending` が渡すもの）＝**動画の番号と素材の番号の組**。
 * ⚠️ **素材の番号だけで見分けない**（PR #1342 レビュー 🟡）＝素材の番号は動画ごとに `asset_001` から振り直すので、
 * 前の動画で読んでいる最中の `asset_001` が、新しく開いた動画の `asset_001` を「読み取り中」に見せていた。
 */
export function describingKey(projectId: string, assetId: string): string {
  return `${projectId}/${assetId}`;
}

/** いま開いている動画の「読み取り中」の素材の番号（画面はこれで見る＝ほかの動画の分を混ぜない）。 */
export function describingIn(keys: readonly string[], projectId: string | undefined): Set<string> {
  if (!projectId) return new Set();
  const prefix = describingKey(projectId, "");
  return new Set(keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

/** 書き出しが終わるのを待つ間隔。 */
const BLOCKED_POLL_MS = 1000;

export interface AssetDescribeQueue {
  /** 読む素材を積む（待たない）。`stillOpen` は積んだ時点の動画を見る合図。 */
  enqueue(assetId: string, stillOpen: () => boolean, opts?: { retry?: boolean }): void;
  /**
   * その素材のファイルが差し替わった（#1317 レビュー 🟡）＝読んでいる最中の結果は**前の写真**のものなので当てない。
   * 拡張子が同じなら保存名も同じ（上書き）＝パスでは見分けられないので、差し替えの世代で見分ける。
   */
  invalidate(assetId: string): void;
  /** 積んだものが全部終わるまで待つ（検査用）。 */
  idle(): Promise<void>;
}

export function createAssetDescribeQueue(deps: AssetDescribeDeps): AssetDescribeQueue {
  const jobs: { assetId: string; stillOpen: () => boolean; counted: string | null }[] = [];
  /** 読む予定の素材ごとの、積んである数（同じ素材を2回積むことがある＝差し替え）。見分けは `describingKey`。 */
  const pending = new Map<string, number>();
  const emit = (): void => deps.onPending?.([...pending.keys()]);
  /** 数えた見分け（`describingKey`）で外す＝数えたときと同じ動画の分を外す。 */
  const settle = (job: { counted: string | null }): void => {
    if (!job.counted) return;
    const n = (pending.get(job.counted) ?? 0) - 1;
    if (n > 0) pending.set(job.counted, n);
    else pending.delete(job.counted);
    emit();
  };
  const tried = new Set<string>();
  /** 素材ごとの差し替えの世代（`invalidate` で進む）。 */
  const generation = new Map<string, number>();
  let availability: Promise<boolean> | null = null;
  let running: Promise<void> | null = null;

  async function runOne(assetId: string, stillOpen: () => boolean): Promise<void> {
    if (!stillOpen()) return;
    const cur = deps.current(assetId);
    if (!cur) return;
    const key = `${cur.projectId}/${assetId}`;
    if (tried.has(key)) return;
    const relPath = describeTarget(cur.asset);
    if (!relPath) return;
    tried.add(key);
    const gen = generation.get(assetId) ?? 0;
    // ⚠️ **書き出し中は読み始めない**（#1317 レビュー 🟡）＝読むのは重い（1枚 6〜8 秒・CPU を使い切る）ので、
    //   書き出しと取り合うと書き出しが遅れる。以前は「当てる」段だけを待たせていた。
    while (deps.blocked() && stillOpen()) await deps.sleep(BLOCKED_POLL_MS);
    // ⚠️ **捨てたら「試した」も消す**（#1317 レビュー 🟡）＝同じ動画を開き直すと、前の版の仕事は捨てられるのに
    //   新しい版の仕事は「試した」に当たって飛ばされ、その写真がずっと読まれなかった（キーは版を含まない）。
    if (!stillOpen()) { tried.delete(key); return; }
    const m = buildDescribeAssetMessages(cur.asset);
    let raw: string;
    try {
      raw = await deps.describe(m.system, m.user, JSON.stringify(m.schema), cur.projectId, relPath);
    } catch (e) {
      console.warn("[ai] 写真を読めませんでした（説明は付けません）:", assetId, e);
      return;
    }
    const parsed = parseAssetDescription(raw);
    if (!parsed) {
      console.warn("[ai] 写真の説明の形が違ったので付けません:", assetId, raw.slice(0, 200));
      return;
    }
    while (deps.blocked() && stillOpen()) await deps.sleep(BLOCKED_POLL_MS);
    if (!stillOpen()) { tried.delete(key); return; }
    // 読んでいる間に写真が差し替わったら、前の写真の説明なので当てない（差し替えた側が読み直しを積む）。
    if ((generation.get(assetId) ?? 0) !== gen) { tried.delete(key); return; }
    deps.apply(assetId, (a) => applyAssetDescription(a, parsed));
  }

  async function drain(): Promise<void> {
    // 問い合わせの失敗（同期の例外も）は「使えない」＝裏の仕事で取り込みや画面を落とさない。
    availability ??= Promise.resolve().then(() => deps.available()).catch(() => false);
    if (!(await availability)) {
      // 同梱の AI が無い＝どれも読まない。「読み取り中」を残さない。
      for (const job of jobs.splice(0)) settle(job);
      return;
    }
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      try {
        await runOne(job.assetId, job.stillOpen);
      } catch (e) {
        console.warn("[ai] 写真の説明の途中で失敗しました（説明は付けません）:", job.assetId, e);
      } finally {
        settle(job);
      }
    }
  }

  // ⚠️ 終わり際に積まれたものを取り残さない＝`drain` が空を見て抜けてから `finally` までの間に積まれたら、もう一度回す。
  function start(): void {
    if (running) return;
    running = drain().finally(() => {
      running = null;
      if (jobs.length > 0) start();
    });
  }

  return {
    enqueue(assetId, stillOpen, opts) {
      // `retry`＝この画面を開いている間に一度読んだ素材でも読み直す（写真を差し替えた＝#1317）。
      const cur = deps.current(assetId);
      if (opts?.retry && cur) tried.delete(`${cur.projectId}/${assetId}`);
      // 実際に読むものだけ数える（`runOne` が飛ばすものは数えない＝読まないのに「読み取り中」と言わない）。
      const counted = cur && stillOpen() && !tried.has(`${cur.projectId}/${assetId}`) && describeTarget(cur.asset) !== null
        ? describingKey(cur.projectId, assetId)
        : null;
      jobs.push({ assetId, stillOpen, counted });
      if (counted) {
        pending.set(counted, (pending.get(counted) ?? 0) + 1);
        emit();
      }
      start();
    },
    invalidate(assetId) {
      generation.set(assetId, (generation.get(assetId) ?? 0) + 1);
    },
    async idle() {
      while (running) await running;
    },
  };
}
