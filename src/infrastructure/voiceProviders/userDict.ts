// 読み方辞書をエンジンへ映す（ADR-0037・#350）。HTTP は Rust 側（voicevox.rs）が持つ。
//
// ⚠️ **正典はアプリ**（`appData/readingdict.json`）＝ここは「映す」だけ。計画（何を足す/直す/消すか）は
// 純粋関数 `planDictSync`（domain）が出す＝ここには規則を書かない（§4・テストは domain 側）。
// ⚠️ **反映できなかったら黙って作らない**（決定7・§2-5）＝失敗を返し、呼ぶ側が次の行動を出して止める。
import { invoke } from '@tauri-apps/api/core';
import { getVoicevoxUrl } from '../appSettings';
import { planDictSync, type EngineLinks, type EngineWord, type ReadingEntry } from '../../domain/voice/readingDict';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * `GET /user_dict` の本文（uuid → 語 の object）を、こちらの形へ。
 * ⚠️ **知らない形の語は落とす**（生のまま内部へ流さない＝§2-2）。他アプリが入れた語も読める形なら数える
 *（数えないと「同じ言葉が既にある」を見落として二重登録になる）。
 */
export function parseEngineDict(text: string): EngineWord[] {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) return [];
  const out: EngineWord[] = [];
  for (const [uuid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const w = v as Record<string, unknown>;
    const surface = w.surface;
    const yomi = w.pronunciation;
    const accent = w.accent_type;
    if (typeof surface !== 'string' || typeof yomi !== 'string') continue;
    out.push({
      uuid,
      surface,
      yomi,
      accentType: typeof accent === 'number' && Number.isInteger(accent) && accent >= 0 ? accent : 0,
    });
  }
  return out;
}

/** 同期の結果。`conflicts` は**黙って上書きしなかった**語（決定3b）＝呼ぶ側が知らせる。 */
export interface DictSyncResult {
  links: Record<string, string>;
  conflicts: ReturnType<typeof planDictSync>['conflicts'];
  /** 送った操作の数（0＝そろっていた）。 */
  applied: number;
}

/**
 * アプリの辞書をエンジンへ映す（差分だけ・決定2）。
 *
 * ⚠️ **`import_user_dict`（丸ごと入れ替え）は使わない**＝辞書は OS 上の固定パスで他の VOICEVOX と
 * 共有される（`--user_dict_path` に相当するオプションが無い）ので、他アプリの語を消してしまう（決定3）。
 * ⚠️ **失敗はそのまま投げる**（決定7・§2-5）＝呼ぶ側が「誤読のまま声を作る」を避けられるようにする。
 */
export async function syncReadingDict(
  entries: readonly ReadingEntry[],
  links: EngineLinks,
): Promise<DictSyncResult> {
  if (!isTauri()) return { links: { ...links }, conflicts: [], applied: 0 };
  const baseUrl = getVoicevoxUrl() || null;
  const engineWords = parseEngineDict(await invoke<string>('voicevox_user_dict_list', { baseUrl }));
  const plan = planDictSync(entries, engineWords, links);
  // 計画が「そろっている」と言った語の控えから始める（送るものだけを下で足す）。
  const next: Record<string, string> = { ...plan.links };
  let applied = 0;
  for (const op of plan.ops) {
    if (op.kind === 'add') {
      next[op.entry.surface] = await addWord(op.entry, baseUrl);
      applied += 1;
      continue;
    }
    if (op.kind === 'update') {
      const ok = await invoke<boolean>('voicevox_user_dict_update', {
        wordUuid: op.uuid,
        surface: op.entry.surface,
        pronunciation: op.entry.yomi,
        accentType: op.entry.accentType,
        baseUrl,
      });
      // ⚠️ **`false` は失敗ではなく「作り直しの合図」**（決定3b＝未知の uuid は `422`）。
      next[op.entry.surface] = ok ? op.uuid : await addWord(op.entry, baseUrl);
      applied += 1;
      continue;
    }
    await invoke<boolean>('voicevox_user_dict_delete', { wordUuid: op.uuid, baseUrl });
    delete next[op.surface];
    applied += 1;
  }
  return { links: next, conflicts: plan.conflicts, applied };
}

async function addWord(entry: ReadingEntry, baseUrl: string | null): Promise<string> {
  return invoke<string>('voicevox_user_dict_add', {
    surface: entry.surface,
    pronunciation: entry.yomi,
    accentType: entry.accentType,
    baseUrl,
  });
}
