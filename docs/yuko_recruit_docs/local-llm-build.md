# 同梱するローカル LLM の作り方と記録（ADR-0051）

> ⚠️ **この資料は「作った記録」**＝同梱物の由来（元の重み・道具の版・手順）と、できたファイルの SHA-256 を残す。
> 版や手順を変えたら、`scripts/local-llm/build-model.sh` の固定値と**この表を一緒に**直す（再現できなくなる）。

## 手順

```bash
scripts/local-llm/build-model.sh <作業フォルダ（リポジトリの外）> Qwen/Qwen3.5-2B Qwen/Qwen3.5-0.8B
```

1. 公式の重みを Hugging Face から落とし、**配布元の SHA-256（LFS の oid）と照合**（合わなければ止める）。
2. 道具を**版を固定して**用意（llama.cpp の公式リリースの ZIP は SHA-256 を照合・ソースは同じタグのコミットを確かめる）。
3. 重み → GGUF（BF16）→ **Q4_K_M** へ量子化。

## 入力（2026-09-30）

| もの | 版・入手元 | 照合 |
|---|---|---|
| 元の重み（標準） | `Qwen/Qwen3.5-2B`（Apache-2.0）`model.safetensors-00001-of-00001.safetensors` 4,548,221,488 B | `aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1` |
| 元の重み（軽量） | `Qwen/Qwen3.5-0.8B`（Apache-2.0）同 1,746,942,600 B | `04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696` |
| 変換・量子化・実行 | llama.cpp `b11269`（MIT）＝ソース `cee37ffea0a5749bce1704f0621b9ddd185b4858`・`llama-b11269-bin-win-cpu-x64.zip` | ZIP `a15b798c282d70b169df4034e002fd2fad43437b2267503c1cffbbd8e4202a1c` |
| 変換の環境 | Python 3.13・torch 2.11.0+cpu・transformers 4.57.6・numpy 2.2.6・gguf（同じタグの `gguf-py`） | — |

## 出力

| ファイル | 大きさ | SHA-256 |
|---|---|---|
| `stario-qwen3.5-2b-q4_k_m.gguf` | 1,312,164,800 B | `5405508fd56e0bace3ec4c2484eb4d0f606cbded87760cf3756896e234068b35` |
| `stario-qwen3.5-0.8b-q4_k_m.gguf` | 541,903,808 B | `6de731ab2a3f816ba3116918b059df659d2f1e03708a690d1a7b05ea3099c31a` |

- **再現できる**＝同じ BF16 からもう一度量子化して、同じ SHA-256 になった（0.8B で確認）。
- 量子化は**重要度行列（imatrix）なし**の素の Q4_K_M。⚠️ **このソフトの入力で作った重要度行列を使う**のが「専用化」の最初の一歩になりうる（ADR-0051 決定11・Phase C の手前）。

## 最低検証機での実測（2026-09-30・Intel Core Ultra 5 125U・RAM 16GB・CPU のみ）

`llama-server`（`127.0.0.1`・文脈 8192）に 2B を載せ、`response_format: json_schema` で出力の形を縛った（考える段は切る＝`enable_thinking: false`）。

| 試し | 入力 | 出力 | かかった時間 | 形 |
|---|---|---|---|---|
| 小さな形（題名＋3場面の見出しとセリフ） | 89 トークン | 190 トークン | 約 10 秒（生成 約 20 トークン/秒） | 指定どおり |
| **正典の `ai-video-plan.schema.json` をそのまま渡す** | 54 トークン | 640 トークン | 約 35 秒（約 19 トークン/秒） | **正典の検証（ajv）に通った**（6 場面） |

- メモリ：`llama-server` の最大 約 2.3GB（2B・Q4_K_M・文脈 8192）。
- ⚠️ **正典の schema を llama.cpp がそのまま受け入れた**（提案書 §7.2 の懸念＝`$ref`・`additionalProperties` 等）＝ローカル用の簡略 schema は今のところ要らない。
- ⚠️ まだ**本物のプロンプト**（`buildVideoPlanMessages`＝見た目パターン・素材の一覧つき）では測っていない＝入力が長くなるので時間は延びる。Golden case での評価は EPIC #1277 の手順 6。
