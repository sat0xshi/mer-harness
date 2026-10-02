[SPEC.md](/workspace/mercari-harness/SPEC.md)を確認しました。**単一Worker＋D1＋非公開R2は妥当です。優先修正は「課金ゼロの保証」「画像配信経路」「開発用認証バイパス」です。** ファイル変更はしていません。

**(1) リスク・修正点**

- **R2の無料枠は課金停止上限ではありません。** Standardは月10 GB-month、Class A 100万回、B 1,000万回まで無料、超過は従量課金。原画像・加工画像・staging分を含めた容量制限、操作数制限、古い画像の削除が必要。「従量課金ゼロ」は構成だけでは保証できません。[料金](https://developers.cloudflare.com/r2/pricing/)
- **Images Freeの前提は概ね正しいです。** 月5,000ユニーク変換、超過した新規変換は9422エラー、超過課金なし。Imagesへの画像保管はPaid限定なので、R2保管を維持します。[料金](https://developers.cloudflare.com/images/pricing/)
- **画像配信は同一オリジンの認証済みWorker経由に統一。** 推測困難なキーは認証になりません。R2カスタムドメイン＋Access＋変換URLの連鎖より、JWT検証→R2 binding→Images binding→加工結果をR2保存が単純です。R2の公開ドメイン・`r2.dev`は無効にします。[非公開バイト入力](https://developers.cloudflare.com/images/optimization/binding/)
- **`segment=foreground`は実在しBiRefNetを使用。** 白背景化は別工程です。透過化→白合成→JPEGの順序・輪郭品質をstagingで検証し、失敗時は端末加工画像へ戻します。ローカルImagesモックだけでは背景削除の品質検証になりません。[segment](https://developers.cloudflare.com/images/optimization/features/#segment)・[開発環境](https://developers.cloudflare.com/images/optimization/binding/#interact-with-your-images-binding-locally)
- **センタークロップと被写体中央検出は別機能。** MVPは中央初期位置＋手動調整に限定。再編集用には「EXIF除去済み・未クロップ画像」とクロップ座標を保持し、補正は取消可能にします。HEIC入力、EXIF回転、大画像のメモリ消費、JPEG保存をiOS実機で確認します。
- **Accessは署名・`iss`・環境別`aud`・有効期限＋本人メールを検証。** staging JWTをprodで拒否し、設定欠落時も拒否。更新APIにはOrigin検証を追加します。[JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- **迂回経路を閉じる。** `workers_dev:false`と`preview_urls:false`を設定し、公開ホスト全体をAccessで保護。`DEV_AUTH_BYPASS`はローカル専用ファイルに置き、development＋loopback時だけ許可します。
- **PWAは認証済みデータのキャッシュが落とし穴。** 初期版のService Workerは静的シェルのみ保存し、API・写真・Accessログイン応答を除外。セッション切れをJSON解析エラーにせず、再ログインへ誘導します。
- **環境分離≠無料枠分離。** D1/R2は別リソースにしても、同一アカウントの利用量を合算して監視。Workers Freeは10万要求/日・CPU 10ms、D1 Freeは読取500万行/日・書込10万行/日。全件走査や毎キー入力の保存を避けます。[Workers](https://developers.cloudflare.com/workers/platform/limits/)・[D1](https://developers.cloudflare.com/d1/platform/pricing/)
- **指定GemmaのVision対応は確認済み。** AIはFreeで1万Neurons/日、Paidでは超過課金。呼出回数だけでなく画像数・入力長・出力トークン・再試行を制限し、端末開発では既定OFFにします。[モデル](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)・[料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **データ整合性を先に定義。** 状態変更＋イベント追加はD1内で原子的に処理し、冪等キーで二重XPを防止。質問回答・クロップのイベント種別とルール版が不足しています。D1/R2間には共通トランザクションがないため、画像のpending/ready状態と孤児削除も必要です。
- **「発送済み」と「取引完了」を分離。** `shipped`・`completed_at`を追加し、売上確定時点を明示。送料表には更新日・出典・専用資材費・適用条件を持たせ、AI抽出価格や商品状態は本人確認後に採用します。

**(2) `wrangler.jsonc`の具体的な配置案**

設定案は次のとおりです。`vars`と各サービスbindingは環境間で継承されないため、各envに明記します。[環境設定](https://developers.cloudflare.com/workers/wrangler/environments/)

| 配置 | 設定 |
|---|---|
| トップレベル | `name:"mer-harness"`、`main:"apps/worker/src/index.ts"`、`compatibility_date:"2026-10-02"` |
| トップレベル | `workers_dev:false`、`preview_urls:false`、`routes:[]`。認証バイパス・本番リソースは置かない |
| `assets` | `directory:"./apps/web/dist"`、`binding:"ASSETS"`、`not_found_handling:"single-page-application"`、`run_worker_first:["/api/*"]` |
| `env.development` | `name:"mer-harness-dev"`、`routes:[]`、`vars:{APP_ENV:"development",AI_ENABLED:"0",BG_ENABLED:"0"}` |
| development bindings | `d1_databases:[{binding:"DB",database_name:"mer-harness-dev",database_id:"<dev用ID>",migrations_dir:"migrations"}]`、`r2_buckets:[{binding:"PHOTOS",bucket_name:"mer-harness-dev-images"}]`。ローカルエミュレーションのみ |
| `env.staging` | `name:"mer-harness-stg"`、`routes:[{pattern:"mer-harness-stg.sat0xshi.com",custom_domain:true}]` |
| staging bindings/vars | DB=`mer-harness-stg`＋専用ID、PHOTOS=`mer-harness-stg-images`。`APP_ENV:"staging"`、`ACCESS_ISSUER`、`ACCESS_AUD:"<stg AUD>"`、AI/BGフラグ |
| `env.production` | `name:"mer-harness-prod"`、`routes:[{pattern:"mer-harness.sat0xshi.com",custom_domain:true}]` |
| production bindings/vars | DB=`mer-harness-prod`＋専用ID、PHOTOS=`mer-harness-prod-images`。`APP_ENV:"production"`、同issuer・別AUD、AI/BGフラグ |
| AI/Images導入時 | staging/prodそれぞれに`ai:{binding:"AI"}`と`images:{binding:"IMAGES"}`を追加 |
| リポジトリ外 | 本人メールは環境別secret。`.dev.vars.development`だけに`DEV_AUTH_BYPASS=1`。Accessアプリ／ポリシーは別途設定 |

- `/api/photos/*`を含むAPIはWorkerを先に実行し、未知のAPIはJSON 404にします。SPAフォールバックに飲ませません。[ルーティング](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- 開発は`wrangler dev --env development`、移行は`--env development --local`／公開環境は`--env staging --remote`等を明示。CIはenv省略・developmentへのdeployを拒否します。
- 上記は通常のViteビルド＋Wrangler前提。Cloudflare Vite pluginを採用する場合は、ビルド時の`CLOUDFLARE_ENV`も揃えます。

**(3) MVPのPR順序と受入条件（11本）**

| PR | 小さな実装単位 | 受入条件 |
|---|---|---|
| 1 | workspace・CI・環境設定 | lint／型検査／buildが通り、staging/prodのID重複とdev認証設定混入を検出 |
| 2 | Access・APIルーティング | 未認証、期限切れ、別AUDを拒否。本人のみ利用でき、未知APIはJSON 404 |
| 3 | D1移行・商品CRUD | 下書きが再読込後も残る。必須制約・更新競合・削除を確認 |
| 4 | 質問カード・決定的出品文 | 4カテゴリで生成でき、40字／1,000字境界と未回答項目を検証 |
| 5 | ブラウザ画像編集 | iOS／Androidで回転・クロップ・取消・JPEG出力ができ、GPS情報が残らない |
| 6 | 非公開R2写真管理 | 容量／形式／枚数制限、並替え、再試行、削除が動き、未認証取得不可 |
| 7 | 手入力相場・手取り・コピー | 資材費込み計算が正しく、画像保存→実際のメルカリ貼付まで完走 |
| 8 | 在庫状態・イベント・基本XP | 二重送信で状態／XPが重複せず、発送済みと取引完了を区別 |
| 9 | 発送ナビ | 寸法・重量の境界値と対象外ケースを検証し、根拠付き候補を表示 |
| 10 | 任意の白背景化 | Free環境で輪郭品質を確認。失敗／枠超過時も出品でき、加工結果を再利用 |
| 11 | 任意AI・PWA・リリース検証 | AI無効／枠超過でも完走。認証切れ・再起動・復元を確認し、対象5点すべて10分以内 |

デプロイ実行はSPEC記載の承認後とし、各PRで設定・検証手順までレビュー可能にします。
