# 作業分担とMVPステップ（案）

## 役割
| 担当 | やること | 呼び方 |
|---|---|---|
| **Claude Code（claude-sub, Opus級）** | UX/ビジュアル、演出・SEレシピ調整、マイクロコピー、README（英日）文章、質問テンプレ文面、各PRのUXレビュー | `~/.local/bin/claude-sub -p "..." < /dev/null` |
| **Codex CLI（ChatGPT sub）** | 実装（PR単位）、テスト、wrangler設定、マイグレーション、CI | `codex exec "..." < /dev/null` |
| **親エージェント（Grok）** | 指示書作成・差分確認・聡への確認・承認が要る操作（repo作成/デプロイ/Cloudflareリソース作成）の取り次ぎ | — |
| **聡** | 未決事項の決定、実機（スマホ）での触感チェック、ドッグフード出品 | — |

> 2026-10-02 更新: 名称 mer-harness、R2/Images は使わず画像は D1、Google ログイン（OWNER_EMAIL のみ許可）、staging のみデプロイ。優先は「出品のみスライス」= 1→2→3→4→5→7→8 → staging、その後 9(発送)・11(AI強化)。

## MVP ステップ（各1PR、Codex実装 → Claude UXレビュー）
| # | 内容 | 受入条件 | 承認が要る操作 |
|---|---|---|---|
| 0 | 未決事項の決定（SPEC §14） | 名前・ドメイン・Access方式・データ置き場が確定 | — |
| 1 | リポジトリ雛形・CI・wrangler env（dev/stg/prod） | lint/型/build/test 通過、秘密なし（gitleaks）、`wrangler dev` で起動 | GitHub repo 作成（公開） |
| 2 | Access JWT 検証・APIルーティング | 未認証/期限切れ/別AUD拒否、未知APIはJSON 404 | Cloudflare Access アプリ作成 |
| 3 | D1 マイグレーション・商品CRUD | 下書きが再読込後も残る | D1 DB 作成（stg/prod） |
| 4 | 質問カード＋決定的出品文ビルダー（packages/core） | 4カテゴリ生成、40字/1000字境界テスト | — |
| 5 | ブラウザ画像編集（1:1クロップ・補正・EXIF削除） | iOS/Androidで回転・調整・出力、GPS残らない | — |
| 6 | 非公開R2写真管理（Worker経由配信） | 枚数/容量上限、未認証取得不可 | R2 バケット作成 |
| 7 | 相場メモ・価格3案・手取り・コピー出品画面 | 実際にメルカリへ貼って出品まで完走 | — |
| 8 | 在庫ボード・events・XP/レベル/ストリーク・**ピコーン演出（DESIGN準拠）** | 二重送信で重複XPなし、reduced-motion代替動作 | — |
| 9 | 発送ナビ（サイズ判定・便提案・チェックリスト） | 境界値テスト、高額品チェック自動挿入 | — |
| 10 | 白背景化（Cloudflare Images segment）※任意 | 失敗/枠超過でも出品可能 | Images 変換有効化 |
| 11 | Workers AI 補助（スクショ→価格抽出・型番推測）※任意・PWA仕上げ | AI無効でも完走、5品すべて10分以内に出品 | staging→production デプロイ |

- 先にドッグフード用に 1→4→5→7→8 を通し「出品だけ」使える状態を最短で作る案もあり（発送ナビは最初の売却までに間に合えばOK）。
- 各ステップ後に staging で聡がスマホ確認 → OK なら次へ。production はタグで。
