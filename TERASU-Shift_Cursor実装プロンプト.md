# TERASU-Shift 実装プロンプト（Cursor用）

## ⚠️ 最重要制約：既存DBを絶対に壊さない

このプロジェクトは **既存の Supabase データベース** に新機能を追加する作業です。
以下のルールを実装の全工程で守ること。

### 絶対にやってはいけないこと
- 既存テーブルへの `ALTER TABLE`（カラム追加・削除・型変更）
- 既存テーブルへの `DROP`・`TRUNCATE`
- 既存 RLS ポリシーの `DROP` または `CREATE`（shifts / memberships / staffs / stores 等）
- 既存テーブルのカラム名・型を前提としたコードの書き換え
- `supabase db push` や `supabase migration` の実行（マイグレーションは手動適用済み）

### 新規追加済みのテーブル（触っていい）
```
shift_patterns          シフトパターンマスタ
shift_settings          シフト設定
shift_requests          希望シフト
shift_publish_statuses  シフト公開管理
```

### 既存テーブルへの追加カラム（追加済み・参照のみ）
```
shifts.shift_pattern_id        uuid  NULL  FK → shift_patterns
holidays.is_auto_imported      boolean
holidays.imported_at           timestamptz
```

---

## プロジェクト概要

**アプリ名**: TERASU-Shift  
**目的**: バー・ナイトクラブ複数店舗のスタッフ希望シフト収集 + シフト作成・公開  
**スタック**: Next.js (App Router) / TypeScript / Tailwind CSS / Supabase  
**デバイス**: シフト入力=スマホ、シフト作成=タブレット/PC

---

## 既存 DB スキーマ（参照専用・変更禁止）

### companies（企業マスタ）
```
company_id          uuid        PK
status              enum        public / private
company_name        text
phone_number        text        NULL
admin_name          text
admin_email         text        UNIQUE
admin_password_hash text
plan                text
contract_start_date date
contract_end_date   date
```

### stores（店舗マスタ）
```
store_id            uuid        PK
company_id          uuid        FK → companies
store_name          text
store_password_hash text
```

### staffs（スタッフマスタ）
```
staff_id            uuid        PK
company_id          uuid        FK → companies
staff_name          text
staff_email         text        NULL（leaderのみ）
staff_password_hash text
join_date           date
leave_date          date        NULL（退社済みで設定）
birth_date          date
staff_note          text        NULL
staff_number        integer     CSV出力の従業員コード
```

### memberships（所属マスタ）
```
store_id        uuid    PK（複合）FK → stores
staff_id        uuid    PK（複合）FK → staffs
display_status  enum    visible / hidden
role            enum    general / leader
display_order   integer
```

### shifts（確定シフト）※RLS適用済み・変更禁止
```
shift_id            uuid        PK
store_id            uuid        FK → stores
staff_id            uuid        FK → staffs
work_date           date
shift_pattern_name  text        NULL（後方互換カラム）
scheduled_start_at  timestamptz
scheduled_end_at    timestamptz
attendance_mark     enum        NULL（late / left_early / absent）
shift_change_mark   boolean
shift_pattern_id    uuid        NULL FK → shift_patterns  ← 追加済み
```

### holidays（祝日マスタ）
```
holiday_id          uuid    PK
store_id            uuid    FK → stores
holiday_date        date    UNIQUE per store
holiday_name        text
is_auto_imported    boolean DEFAULT false  ← 追加済み
imported_at         timestamptz NULL       ← 追加済み
```

### store_settings（店舗設定）
```
store_id            uuid    PK FK → stores
date_change_time    time    DEFAULT 05:00
updated_at          timestamp
gchat_webhook_url   text    NULL
```

---

## 新規テーブル スキーマ（実装対象）

### shift_patterns（シフトパターンマスタ）
```
shift_pattern_id  uuid     PK
store_id          uuid     FK → stores
pattern_name      text     UNIQUE per store
start_minutes     integer  0=00:00 / 600=10:00 / 1320=22:00 / 1500=25:00
end_minutes       integer  end > start
display_order     integer  DEFAULT 0
is_active         boolean  DEFAULT true
```

### shift_settings（シフト設定）
```
store_id              uuid     PK FK → stores（1対1）
gantt_start_minutes   integer  DEFAULT 1080（18:00）
gantt_end_minutes     integer  DEFAULT 1740（29:00=翌5:00）
shift_cycle           text     weekly / biweekly / semimonthly / monthly
week_start_day        text     mon / sun
deadline_type         text     days_before / weeks_before / months_before
deadline_value        integer  DEFAULT 7
csv_format_type       text     NULL=デフォルト
updated_at            timestamptz
```

### shift_requests（希望シフト）
```
shift_request_id      uuid        PK
store_id              uuid        FK → stores
staff_id              uuid        FK → staffs
work_date             date
target_month          date        月初日（例: 2026-05-01）
period_type           text        first_half / second_half / full
request_type          text        pattern / free / off / custom
shift_pattern_id      uuid        NULL FK → shift_patterns（request_type=patternの場合）
custom_start_minutes  integer     NULL（request_type=customの場合）
custom_end_minutes    integer     NULL（request_type=customの場合）
submitted_at          timestamptz DEFAULT now()
UNIQUE(store_id, staff_id, work_date) → upsertで上書き運用
```

### shift_publish_statuses（シフト公開管理）
```
publish_status_id       uuid        PK
store_id                uuid        FK → stores
period_start            date
period_end              date
status                  text        draft / published
published_at            timestamptz NULL（draft中はNULL）
published_by_staff_id   uuid        NULL FK → staffs
created_at              timestamptz DEFAULT now()
UNIQUE(store_id, period_start, period_end)
```

---

## 時刻の扱い（重要）

シフト時刻はすべて **integer（分数）** で管理する。
`timestamptz` や `time` 型は使わない（UTC変換バグ・深夜時間問題のため）。

```typescript
// 変換ユーティリティ（lib/time.ts に作成）
export function minutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function displayToMinutes(display: string): number {
  const [h, m] = display.split(':').map(Number)
  return h * 60 + m
}

export function minutesToPosition(
  minutes: number,
  ganttStart: number,
  ganttEnd: number
): number {
  return ((minutes - ganttStart) / (ganttEnd - ganttStart)) * 100
}
```

---

## ロール・認証

- `staffs.staff_email` + `staffs.staff_password_hash` でログイン
- `memberships.role` で権限判定
  - `general`：自分の希望シフト提出・確定シフト閲覧（published分のみ）
  - `leader`：シフト作成・編集・公開・CSV出力
- `leave_date` が設定されているスタッフはシフト画面に表示しない
- `memberships.display_status = 'hidden'` のスタッフも非表示

---

## 実装する画面一覧

### 1. ログイン画面（全デバイス）
- メールアドレス + パスワード
- ログイン後、role に応じてリダイレクト
  - general → 希望シフト提出画面
  - leader → シフト作成画面

---

### 2. 希望シフト提出画面（スマホ最適化）

**表示要件**
- 上部に締め切り日を表示（`shift_settings.deadline_type` + `deadline_value` から計算）
- ログインスタッフ名表示
- 対象月セレクタ（今月・来月）
- 期間セレクタ（`shift_cycle` に応じて前半/後半/全期間）
- 日付ごとにドロップダウンでシフト希望を選択

**ドロップダウンの選択肢**
1. 各 `shift_patterns`（`is_active=true`、`display_order` 順）
2. `F`（free=終日勤務可能）
3. `×`（off=休み希望）
4. `その他`（custom=時間直接入力）

**その他（custom）選択時**
- 開始・終了時刻をセレクタで入力
- 選択可能範囲は `shift_settings.gantt_start_minutes` ～ `gantt_end_minutes`
- 30分刻みで表示（例: 18:00, 18:30, 19:00...）

**日付セルの色分け**
- 土曜：青系背景
- 日曜：赤系背景
- 祝日：赤系背景（`holidays` テーブルから取得）
- 平日：デフォルト

**提出済みの場合**
- 「提出済み」バナーを表示
- 「修正する」ボタンで編集モードに切り替え
- 修正後に再提出（upsert）

**データ保存**
```typescript
// upsert（上書き）
await supabase
  .from('shift_requests')
  .upsert(rows, { onConflict: 'store_id,staff_id,work_date' })
```

---

### 3. シフト作成画面（タブレット/PC）※leaderのみ

**上部コントロール**
- `＜ ＞` で月移動
- 表示期間セレクタ（1週間 / 2週間 / 半月 / 1か月 / 指定範囲）
- 「希望｜シフト」トグル（希望シフト表示 ↔ 確定シフト表示）
- 公開ステータス表示 + 「公開する」ボタン
- CSVエクスポートボタン
- 未提出スタッフ警告バナー（`shift_requests` にレコードがないスタッフ一覧）
- 店舗名表示

**メイングリッド（カレンダー表）**

列：名前 | 日付1 | 日付2 | ... | 日付N

行：スタッフごと（`memberships.display_order` 順、`display_status=visible`、`leave_date` 未設定）

セルの表示
- パターン名がある場合：`pattern_name`
- custom時間の場合：`HH-HH` 形式（0省略、例: 18-255 = 18:00〜25:30）
- free：`F`
- off：`×`（背景グレー）

希望シフト表示時の色分け
- off（×）：背景グレー
- free（F）：背景薄ピンク
- セル hover / クリックで希望内容をポップアップ表示（Excelのメモ的な表示）

**ガントチャート（日付クリックで表示）**
- クリックした日のタイムライン
- 横軸：`shift_settings.gantt_start_minutes` ～ `gantt_end_minutes`
- 確定シフトバー：ドラッグ&ドロップで時間変更可
- 希望シフトバーも薄く表示（参考用・編集不可）

**公開フロー**
- `shift_publish_statuses.status = 'draft'` の間はスタッフ画面に非表示
- 「公開する」ボタン → `status` を `published` に UPDATE（`published_at`, `published_by_staff_id` も同時セット）
- 公開後は「公開済み」表示に切り替え

**未提出スタッフの検出クエリ**
```typescript
// その期間の memberships 全員 LEFT JOIN shift_requests
// shift_request_id IS NULL のスタッフを警告表示
const { data: unsubmitted } = await supabase
  .from('memberships')
  .select('staff_id, staffs(staff_name)')
  .eq('store_id', storeId)
  .eq('display_status', 'visible')
  .not('staff_id', 'in', `(
    SELECT staff_id FROM shift_requests
    WHERE store_id = '${storeId}'
    AND target_month = '${targetMonth}'
    AND period_type = '${periodType}'
  )`)
```

---

### 4. シフト設定画面（leaderのみ）

- シフトパターン一覧（CRUD）
  - `pattern_name` / `start_minutes` / `end_minutes` / `display_order` / `is_active`
  - 時刻入力は `HH:MM` 形式でUIに表示し、保存時に分数変換
- ガントチャート表示時間設定（`gantt_start_minutes` / `gantt_end_minutes`）
- シフトサイクル設定
- 週始まり設定
- 希望シフト締切設定

---

### 5. CSVエクスポート

出力フォーマット：
```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
最終行は改行で終了
```

- `#従業員コード` = `staffs.staff_number`
- `パターンコード` = `shifts.shift_pattern_name`（既存カラムを使用）
- `出勤予定` / `退勤予定` = `shifts.scheduled_start_at` / `scheduled_end_at`（JST表示）
- `出勤所属コード` = `store_id`（または店舗コード）

---

## ディレクトリ構成（推奨）

```
app/
  (auth)/
    login/
      page.tsx
  (shift)/
    request/
      page.tsx          希望シフト提出（general）
    schedule/
      page.tsx          シフト作成（leader）
    settings/
      page.tsx          シフト設定（leader）
lib/
  supabase/
    client.ts           ブラウザ用クライアント
    server.ts           Server Component用クライアント
  time.ts               分数変換ユーティリティ
  shift.ts              締切日計算・期間計算ロジック
types/
  database.ts           Supabase生成型 または 手書き型定義
components/
  shift/
    RequestGrid.tsx      希望シフト入力グリッド
    ScheduleGrid.tsx     シフト作成グリッド
    GanttChart.tsx       ガントチャート
    PublishButton.tsx    公開ボタン
    CsvExport.tsx        CSVエクスポート
```

---

## TypeScript 型定義（主要なもの）

```typescript
// types/database.ts

export type ShiftPattern = {
  shift_pattern_id: string
  store_id: string
  pattern_name: string
  start_minutes: number
  end_minutes: number
  display_order: number
  is_active: boolean
}

export type ShiftRequest = {
  shift_request_id: string
  store_id: string
  staff_id: string
  work_date: string           // 'YYYY-MM-DD'
  target_month: string        // 'YYYY-MM-01'
  period_type: 'first_half' | 'second_half' | 'full'
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null
  custom_start_minutes: number | null
  custom_end_minutes: number | null
  submitted_at: string
}

export type ShiftPublishStatus = {
  publish_status_id: string
  store_id: string
  period_start: string        // 'YYYY-MM-DD'
  period_end: string          // 'YYYY-MM-DD'
  status: 'draft' | 'published'
  published_at: string | null
  published_by_staff_id: string | null
  created_at: string
}

export type ShiftSetting = {
  store_id: string
  gantt_start_minutes: number
  gantt_end_minutes: number
  shift_cycle: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  week_start_day: 'mon' | 'sun'
  deadline_type: 'days_before' | 'weeks_before' | 'months_before'
  deadline_value: number
  csv_format_type: string | null
  updated_at: string
}

// 既存テーブル（参照のみ・変更禁止）
export type Staff = {
  staff_id: string
  company_id: string
  staff_name: string
  staff_email: string | null
  staff_password_hash: string
  join_date: string
  leave_date: string | null
  birth_date: string
  staff_note: string | null
  staff_number: number
}

export type Membership = {
  store_id: string
  staff_id: string
  display_status: 'visible' | 'hidden'
  role: 'general' | 'leader'
  display_order: number
}

export type Shift = {
  shift_id: string
  store_id: string
  staff_id: string
  work_date: string
  shift_pattern_name: string | null  // 既存カラム・後方互換
  scheduled_start_at: string         // timestamptz
  scheduled_end_at: string           // timestamptz
  attendance_mark: 'late' | 'left_early' | 'absent' | null
  shift_change_mark: boolean
  shift_pattern_id: string | null    // 追加カラム
}
```

---

## 実装時の注意事項

### Supabase クエリ
- `shift_requests` の保存は必ず upsert を使う
  ```typescript
  .upsert(data, { onConflict: 'store_id,staff_id,work_date' })
  ```
- `shifts` の SELECT は RLS で自動制御される（published 期間のみ general に表示）
- `leave_date` チェックはクエリ側で行う
  ```typescript
  .or('leave_date.is.null,leave_date.gt.' + today)
  ```

### 既存テーブルへのアクセス
- `shifts` テーブルへの INSERT/UPDATE は leader のみ（RLS 設定済み）
- `shifts.shift_pattern_name` は後方互換で残っているが、新規作成時は `shift_pattern_id` も同時にセットする
- `scheduled_start_at` / `scheduled_end_at` は `timestamptz` のまま（既存カラムのため変更不可）

### 時刻変換
- `shift_patterns.start_minutes` / `end_minutes` → `minutesToDisplay()` で表示
- UI入力 → `displayToMinutes()` で分数に変換してから保存
- `shifts.scheduled_start_at` は timestamptz（JST として扱う）

### スマホ対応
- 希望シフト提出画面は縦スクロール前提
- ドロップダウンはネイティブ `<select>` を使うとスマホで扱いやすい
- ガントチャートはスマホ非対応（シフト作成画面はPC/タブレットのみ）

---

## 実装開始の推奨順序

1. `lib/time.ts` — 分数変換ユーティリティ
2. `lib/supabase/client.ts` / `server.ts` — Supabase クライアント
3. `types/database.ts` — 型定義
4. ログイン画面
5. 希望シフト提出画面（スマホ）
6. シフト設定画面（leader）
7. シフト作成画面（ガントチャート）
8. CSVエクスポート
