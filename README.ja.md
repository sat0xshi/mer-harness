# Mer Harness(メルハーネス)

[English](README.md) | **日本語**

> メルカリの「出品」と「発送」を、ついやりたくなるゲームにしよう。

> ⚠️ **非公式アプリです。** Mer Harness は株式会社メルカリ(Mercari, Inc.)とは無関係で、同社の公認・推奨・提携を受けたものではありません。「メルカリ」「Mercari」は Mercari, Inc. の商標です。このアプリは**メルカリに自動でアクセスしません**。テキストは、公式のメルカリアプリにご自身で貼り付けて使います。

<!-- スクリーンショットは docs/shots/ に置いてここにリンクしてください -->
<!-- ![撮影](docs/shots/capture.png) ![質問カード](docs/shots/questions.png) ![ボード](docs/shots/board.png) -->

## 特長

- **写真をきれいに**:正方形トリミング、明るさ補正、お好みで白背景。すべてブラウザ内で完結します。
- **質問カード**:ブランド・状態・サイズ・付属品・傷や汚れに答えるだけで、出品文がリアルタイムに育っていきます。
- **価格サポート**:売れた類似品の価格を貼り付け(または入力)。メルカリの売り切れ検索URLはアプリが作ります。手数料を引いた手取り付きで、3つの価格案を出します。
- **コピー画面**:タイトル・説明文・価格のコピー、画像の保存、メルカリを開く、「出品した!」ボタンまでひと続きです。
- **在庫ボード**:下書き/出品中/取引中/発送待ち/完了、そして売れ残り棚。
- **ゲーム要素**:XP、レベル、連続記録、コンボ、バッジ、そして「ピコン!」の大きなお祝い。効果音は WebAudio で合成(音声ファイルなし)、紙吹雪やハプティクス付き。`prefers-reduced-motion` を尊重し、罪悪感をあおることは決してしません。
- **AIアシスト(任意)**:Cloudflare Workers AI の無料枠で、写真からブランド/型番/傷の候補、売れた商品のスクリーンショットから価格の抽出ができます。1日の上限つきで、AIなしでもすべて使えます。
- **発送ナビ(開発予定)**:サイズ判定、らくらく/ゆうゆうメルカリ便の提案、梱包チェックリスト。

## なぜ作ったか

メルカリは始めやすい反面、続けるのは意外と面倒です。特にハードルが高いのが**出品文づくり**(写真・文章・値付け)と**発送方法の選択**。どちらも手間に感じて、気づけば家に売りたいものが溜まっていきます。Mer Harness は、この2つを小さくて手早いステップに分け、すぐ手応えが返ってくる形にしました。「あとでやろう」が「2分で終わった」に変わるのが目標です。

## 免責事項

- **非公式**であり、Mercari, Inc. とは無関係で、公認・推奨・提携を受けていません。
- 「Mercari」は Mercari, Inc. の商標です。本プロジェクトのロゴは「Harness」のみを表記しています。
- **メルカリを含め、どのマーケットプレイスのサイトにもアクセスしません。** アプリは検索URLを作るだけで、開くのはあなた自身です。
- **スクレイピング、非公式API、自動投稿は一切行いません。** メルカリの利用規約では、提供されていない方法でのアクセスが禁じられているためです。テキストをコピーして、公式アプリにご自身で投稿してください。
- 価格案は、入力されたデータをもとにしたおおよその目安です。出品内容の責任と、メルカリのルールの遵守は利用者ご自身でお願いします。

## しくみ

1. 写真を撮り、端末上でトリミング・明るさ補正・白背景(任意)。
2. 質問カードに答えると、タイトルと説明文が自動で組み上がります。
3. 売れた類似品の価格を入れて、3つの価格案から選びます。
4. すべてコピーして、メルカリアプリで出品し、「出品した!」をタップ。
5. 完了まで在庫ボードで管理します。

**プライバシー:** EXIF や GPS の位置情報は、保存する前に端末上で削除します。購入者の情報は保存しません。写真は小さな JPEG として、ご自身の D1 データベースに保存されます。

**技術構成:** Cloudflare Worker 1つに Static Assets(Vite + React + TypeScript の SPA、`/api` 配下に Hono API)、正本は D1(R2 や有料機能は不使用)、Workers AI、pnpm workspaces(`apps/web`、`apps/worker`、`packages/core`)、Vitest。

**無料枠ファースト:** Cloudflare Workers Free で**月額0円**で動くよう設計しています。上限に達すると課金ではなく停止します。

## セルフホスト

### ローカル開発

必要なもの:Node.js 22+、pnpm、Cloudflare アカウント(デプロイ時のみ)。

```sh
pnpm install
cp .dev.vars.example .dev.vars   # gitignore 済み
pnpm db:migrate:local
pnpm dev
```

ローカルでは `wrangler dev` とローカル D1 を使い、認証は `.dev.vars` でバイパスします。

### ステージングの設定（手動・自動デプロイなし）

既存の D1 は `mer-harness-stg`（`7fe02d97-df73-40d0-be54-a34c6c5f0ade`）です。この構成では新しいリソースの作成は不要です。セルフホストでは自分のデータベースとホスト名に変更してください。

ステージングは `AUTH_MODE=google` が既定です。Google OAuth の「ウェブアプリケーション」クライアントを用意し、承認済み JavaScript 生成元に正確なアプリのオリジン（この設定では `https://furima-harness-stg.sat0xshi.com`）を登録します。ステージングの vars に `GOOGLE_CLIENT_ID` を設定してください。ログイン画面は Google Identity Services を使い、Worker が RS256・audience・issuer・有効期限・確認済みメール・`OWNER_EMAIL` の完全一致を検証します。その後、有効期間30日の署名付き HttpOnly / Secure / SameSite=Lax Cookie を発行します。[Google の検証ガイド](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)も参照してください。

秘密は対話形式で設定します。`wrangler.jsonc` の vars には書きません。

```sh
pnpm exec wrangler secret put OWNER_EMAIL --env staging
pnpm exec wrangler secret put SESSION_SECRET --env staging
# SESSION_SECRET は32文字以上のランダム値（例: openssl rand -hex 32）。
# リモート環境を変更する準備ができた時だけ実行:
pnpm db:migrate:staging
pnpm deploy:staging
```

`db:migrate:staging` はリモート D1 にマイグレーションを適用し、`deploy:staging` はビルド後にステージングだけをデプロイします。CI はどちらも実行しません。Google クライアントID は現在プレースホルダーなので、設定が完了するまで認証を拒否します。ローカル認証スキップは `APP_ENV=development`・`DEV_AUTH_BYPASS=1`・ループバックホストへのリクエストの3条件が必要です。

`AUTH_MODE=access` を使う場合は、ホスト名に Cloudflare Access アプリと所有者限定ポリシーを設定し、`ACCESS_AUD` と `ACCESS_TEAM_DOMAIN` を指定します。Worker は Access JWT と所有者メールを検証します。このモードでは Google 設定を使いません。`/api/auth/logout` は Google セッション Cookie を削除し、Access のログアウトは Cloudflare Access 側で管理します。全 Google セッションを無効にするには `SESSION_SECRET` を変更します。

本番のリソースIDなどはプレースホルダーのままです。本番用リソース・vars・secret の設定とデプロイ承認後の手動コマンドは `pnpm build && pnpm exec wrangler deploy --env production` です。本番用デプロイスクリプトや CI デプロイジョブはありません。

## 設定

| 変数 | 保存場所 / 説明 |
| --- | --- |
| `APP_ENV` | vars: `development` / `staging` / `production` |
| `AUTH_MODE` | vars: `google` / `access`。ローカル認証スキップ以外では必須 |
| `GOOGLE_CLIENT_ID` | vars: Google ウェブ OAuth クライアントID。Google モードで必須 |
| `OWNER_EMAIL` | **secret**: 許可する唯一のメール。両モードで必須 |
| `SESSION_SECRET` | **secret**: 32文字以上のランダムな HMAC 鍵。Google モードで必須 |
| `ACCESS_AUD` | vars: Access アプリの audience。Access モードで必須 |
| `ACCESS_TEAM_DOMAIN` | vars: `<team>.cloudflareaccess.com`。Access モードで必須 |
| `AI_ENABLED` | vars: AI を有効にする場合 `1`、無効は `0` |
| `AI_DAILY_LIMIT` | vars: 1日の AI 呼び出し上限 |
| `DEV_AUTH_BYPASS` | `.dev.vars` のみ: ローカル開発で `1`。デプロイしない |

アダプタは `packages/core/src/platforms/` にあります（`PlatformConfig`・レジストリ・Mercari のみ）。item に platform ID を保存し、`0002_platform.sql` は既存行を `mercari` にします。手数料・発送方法・文字数制限・状態ランク・コピー順と形式・検索URLとヒント・通貨とロケールをアダプタに集約しています。UI 文字列は `apps/web/src/i18n/ja.ts` に置き、en / zh は後日対応します。

### チェックとスクリーンショット

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm shots
```

ブラウザテストは Chromium（同梱ブラウザがなければシステムの Google Chrome）と独立したローカル Worker を使います。`shots` は API 経由でデモ商品と XP を用意し、生成したテスト画像を使って390×844の PNG 9枚を `/workspace/mercari-harness/shots/` に保存します。デプロイやマーケットプレイスへのアクセスは行いません。

## ロードマップ

- [x] 写真 → 出品文 → 価格 → コピーの一連の流れ
- [x] 在庫ボードとゲーム要素
- [x] 任意のAIアシスト
- [ ] 発送ナビ:サイズ判定、らくらく/ゆうゆうメルカリ便の提案、梱包チェックリスト
- [ ] 売れ残り棚と価格のヒントの改善
- [ ] 小さなプラットフォーム・アダプタ（`packages/core/src/platforms/`）で Yahoo!オークション / Yahoo!フリマ / ラクマに対応（手数料・発送方法・文字数上限・コピー形式）
- [ ] 多言語化（en / zh）と海外マーケットプレイス（通貨・ロケールはプラットフォーム設定に持つ）

## コントリビュート

Issue や Pull Request を歓迎します。無料枠で動く範囲に収めること、メルカリに自動でアクセスする機能は入れないこと、PR の前に `pnpm test` を実行することをお願いします。ゲームの雰囲気はやさしく、罪悪感をあおらない方針です。

## セキュリティ

このリポジトリにシークレットは含めません。`.dev.vars` は gitignore 済みで、サンプルファイルにはダミー値だけが入っています。脆弱性を見つけたら、公開 Issue ではなく GitHub の[セキュリティアドバイザリ](https://github.com/sat0xshi/mer-harness/security/advisories/new)から報告してください。

## ライセンス

[MIT](LICENSE) © 2026 sat0xshi
