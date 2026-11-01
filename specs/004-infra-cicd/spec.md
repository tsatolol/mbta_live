# Feature Specification: インフラと CI/CD（Infrastructure & CI/CD）

**Feature Branch**: `004-infra-cicd`
**Created**: 2026-11-01
**Status**: Draft
**Input**: Google Cloud に dev と prod の 2 環境を作り、1 つのリポジトリで管理する。dev はレビューなしでデプロイし、prod は承認後にデプロイする。全体で CI は 1 回、CD は 2 回。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - main に push すると dev に自動で出る (Priority: P1)

開発者として、main に push したら、テストとビルドが 1 回だけ行われ、承認なしで dev 環境に反映されてほしい。

**Why this priority**: 変更を実環境ですぐ確かめられ、prod に出す前の確認の場になる。

**Independent Test**: main に小さな変更を push し、CI が 1 回動いたあと dev にデプロイされ、dev で collector が 1 回成功することを確認する。

**Acceptance Scenarios**:

1. **Given** main への push, **When** パイプラインが動く, **Then** テスト・ビルド・イメージの push が 1 回だけ行われ、dev のインフラ変更の適用 → DB マイグレーション → デプロイ → 動作確認が承認なしで進む
2. **Given** テストが失敗した, **When** パイプラインが動く, **Then** dev にも prod にもデプロイされない

---

### User Story 2 - 承認すると同じものが prod に出る (Priority: P1)

リポジトリのオーナーとして、dev で確認できたものを、承認したときにだけ prod に出したい。prod に出るのは dev と同じイメージであってほしい。

**Acceptance Scenarios**:

1. **Given** dev へのデプロイが成功した, **When** オーナーが承認する, **Then** dev と同じイメージ（同じダイジェスト）が prod にデプロイされる。再ビルドはしない
2. **Given** 承認待ちの古い run がある, **When** それを承認しようとする, **Then** main の最新でないので prod へのデプロイは失敗する
3. **Given** 承認したときに見たインフラの変更内容と、適用直前の変更内容が違う, **When** prod のデプロイが動く, **Then** インフラの変更は適用されず失敗する

---

### User Story 3 - 問題が起きたら前のイメージに戻す (Priority: P2)

運用者として、prod で問題が起きたら、指定したイメージにすぐ戻したい。

**Acceptance Scenarios**:

1. **Given** 戻したいイメージのダイジェスト, **When** ロールバックを実行し、prod では承認する, **Then** Web とジョブがそのイメージに戻る。インフラ変更とマイグレーションは実行されない

---

### User Story 4 - 環境が分かれていて、許可した人だけが見られる (Priority: P2)

オーナーとして、dev での作業が prod に影響しないようにしたい。画面は許可したユーザーだけが見られるようにしたい。

**Acceptance Scenarios**:

1. **Given** dev と prod, **When** 権限を確認する, **Then** dev 用のデプロイ権限では prod を操作できない
2. **Given** 許可されていない Google アカウント, **When** 画面を開く, **Then** アクセスが拒否される

### Edge Cases

- リポジトリは public。ログや artifact は誰でも見られる
- フォークからの PR では、パイプラインも認証情報も使われない（パイプラインは main への push だけで動く）
- 同時に複数の push があっても、デプロイが途中で中断されない

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: dev と prod は別々の Google Cloud プロジェクトに作らなければならない
- **FR-002**: 両環境のインフラは 1 つのリポジトリの Terraform で管理し、共通のモジュールを使い、違いは変数だけで表さなければならない
- **FR-003**: main への push 1 回につき、CI は 1 回、CD は dev と prod の 2 回だけ実行しなければならない
- **FR-004**: イメージは CI で 1 回だけビルドし、同じダイジェストを dev → prod の順にデプロイしなければならない
- **FR-005**: dev へのデプロイは承認なしで、prod へのデプロイはオーナーの承認後に行わなければならない
- **FR-006**: prod へのデプロイは、main の最新のコミットのときだけ行わなければならない
- **FR-007**: prod のインフラ変更は、承認時に提示した変更内容と一致するときだけ適用しなければならない
- **FR-008**: CI のログと artifact に秘密の値を出してはならない
- **FR-009**: GitHub Actions から Google Cloud への認証は、サービスアカウントのキーを使わずに行わなければならない
- **FR-010**: 指定したイメージに戻すロールバック手段を提供しなければならない（prod では承認が必要）
- **FR-011**: 画面へのアクセスは IAP で許可したユーザーだけに制限しなければならない
- **FR-012**: 環境ごとに予算アラートを設定しなければならない

## Success Criteria *(mandatory)*

### Measurable Outcomes

（初期値。運用を始めてから見直す）

- **SC-001**: main への push から dev への反映まで 15 分以内
- **SC-002**: 承認から prod への反映まで 10 分以内
- **SC-003**: ロールバックの実行から完了まで 5 分以内
- **SC-004**: 月額のコストが予算アラートの金額を超えない

## Assumptions

- GitHub のリポジトリは public なので、GitHub Environments の承認機能（Required reviewers）を無料で使える
- GCP のプロジェクト ID、請求先アカウント、予算額は未定
- PR では CI を動かさない（CI は main への push で 1 回だけ）。push の前にローカルでテストを実行する
