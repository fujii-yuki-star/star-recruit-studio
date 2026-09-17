// 起動のときの頼まれごとの**形**（ADR-0042・#1184）。
//
// ⚠️ **`domain` に置く**（PR レビュー 🔴）＝最初は `infrastructure/startupFs.ts` に置いていたが、
// それだと `domain` が `infrastructure` を指すことになり、**依存の向きが逆**になる（§4）。
// IPC で運ぶ形であっても、**形は約束事＝ドメインのもの**（`domain/voice/voiceProvider.ts` と同じ向き）。
// ⚠️ **`//` で書く**＝`/** */` にすると、すぐ下の型の説明文を**奪う**（門番が実際に赤くなった）。

/** 引数が読めなかった理由。 */
export type StartupArgError = {
  kind: 'missingValue' | 'unknown' | 'incompleteExport' | 'conflicting';
  flag: string | null;
};

/**
 * 起動のときに何を頼まれたか。
 *
 * ⚠️ **`forwarded` が真なら「後から渡されたもの」**＝すでに開いているアプリへ引数が届いた回。
 * **閉じる頼みは持ち越さない**（仕事の持ち主が違う＝ADR-0042 決定③）。
 */
export type StartupRequest = {
  kind: 'none' | 'import' | 'export' | 'makeVoices';
  folder: string | null;
  projectId: string | null;
  out: string | null;
  quitWhenDone: boolean;
  forwarded: boolean;
  argError: StartupArgError | null;
};
