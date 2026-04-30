# TERASU-Shift 仕様・実装メモ

最終更新: 2026-04-30
バージョン: v3.3（確定シフト削除・希望シフト表示設定・leaderによる希望シフト編集・general過去月制限）

---

## プロジェクト概要

| 項目 | 内容 |
|---|---|
| アプリ名 | TERASU-Shift |
| 目的 | バー・ナイトクラブ複数店舗のスタッフ希望シフト収集・シフト作成・公開 |
| スタック | Next.js 16 (App Router) / TypeScript / Tailwind CSS / Supabase (PostgreSQL) |
| 認証 | 独自実装（Supabase Auth不使用）。staffs.staff_email + bcryptjs |
| セッション | jose (JWT HS256) / httpOnly cookie（terasu.session） |
| デプロイ | Vercel + Supabase |
| デバイス | シフト入力=スマホ / シフト作成・設定=PC/タブレット/スマホ（レスポンシブ対応済み） |
| PWA | manifest.json・アイコン設定済み（ホーム追加対応） |

---

## 環境変数

| 変数名 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon キー | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSバイパス用 | サーバーサイド専用・絶対に公開しない |
| `AUTH_SECRET` | JWT署名用 | 32文字以上・サーバーサイド専用 |

---

## ロール定義（v3.3更新）

| role | できること | できないこと |
|---|---|---|
| `general` | 希望シフト提出・確定シフト閲覧（published分のみ・閲覧専用） | シフト作成・設定・CSV出力・ガント編集・希望シフト編集 |
| `leader` | 全機能（シフト作成・編集・削除・公開・設定・CSV出力・希望シフト提出・他スタッフ希望シフト編集） | - |

### 重要な仕様

- **全ロールが `/schedule` にアクセス可能**
  - `general` は閲覧専用モード（ガント・公開ボタン・CSV・セルクリック・希望↔シフトトグル非表示）
  - `general` は常に「シフト」表示固定
  - `general` は現在の表示範囲が当月より前に移動不可（v3.3追加）
- **全ロールが `/request` にアクセス可能**
  - leader もシフト提出できる
- `/settings` は `leader` のみ（middleware で general を `/request` にリダイレクト）
- `display_status='hidden'` のスタッフも **ログインは可能**
  - シフトグリッドへの表示は `display_status='visible'` のみ
- `leave_date` が設定済みのスタッフはログイン不可・シフト非表示

---

## DB構成

### ⚠️ 絶対変更禁止の既存テーブル

```
companies / stores / staffs / memberships / shifts
attendances / clock_in_reports / clock_out_reports
clock_in_check_items / clock_out_check_items
clock_in_check_answers / clock_out_check_answers
tasks / task_routines / task_instances / task_assignees
trigger_task_templates / announcements / thanks_points
budgets / sales / actual_business_hours
store_settings / store_business_hours / business_time_categories / holidays
```

### 既存テーブルへの追加済みカラム（参照のみ）

```sql
shifts.shift_pattern_id     uuid  NULL  FK → shift_patterns
holidays.is_auto_imported   boolean  DEFAULT false
holidays.imported_at        timestamptz  NULL
```

### 新規追加テーブル（RLS適用済み）

#### shift_patterns（シフトパターンマスタ）
```
shift_pattern_id  uuid     PK
store_id          uuid     FK → stores
pattern_name      text     UNIQUE per store
start_minutes     integer  0=00:00 / 600=10:00 / 1320=22:00 / 1500=25:00
end_minutes       integer  end > start（最大2880=48:00）
display_order     integer  DEFAULT 0
is_active         boolean  DEFAULT true（削除は論理削除のみ）
```

#### shift_settings（シフト設定）1店舗1レコード
```
store_id                    uuid     PK FK → stores
gantt_start_minutes         integer  DEFAULT 1080（18:00）
gantt_end_minutes           integer  DEFAULT 1740（29:00=翌5:00）
shift_cycle                 text     weekly / biweekly / semimonthly / monthly
week_start_day              text     mon / sun
deadline_type               text     days_before / weeks_before / months_before
deadline_value              integer  DEFAULT 7
csv_format_type             text     NULL=デフォルト
show_requests_to_general    boolean  DEFAULT true（v3.3追加）
updated_at                  timestamptz
```

デフォルト値（未登録店舗は自動INSERT）:
```typescript
{
  gantt_start_minutes: 1080,
  gantt_end_minutes: 1740,
  shift_cycle: 'semimonthly',
  week_start_day: 'mon',
  deadline_type: 'days_before',
  deadline_value: 7,
  csv_format_type: null,
  show_requests_to_general: true,  // v3.3追加
}
```

#### shift_requests（希望シフト）
```
shift_request_id      uuid        PK
store_id              uuid        FK → stores
staff_id              uuid        FK → staffs
work_date             date
target_month          date        月初日（例: 2026-05-01）
period_type           text        first_half / second_half / full
request_type          text        pattern / free / off / custom
shift_pattern_id      uuid        NULL（request_type=patternの場合）
custom_start_minutes  integer     NULL（request_type=customの場合）
custom_end_minutes    integer     NULL（request_type=customの場合）
submitted_at          timestamptz DEFAULT now()
UNIQUE(store_id, staff_id, work_date) → upsertで上書き運用
```

週次・隔週の `period_type` は `full` で保存し、日付範囲で期間を区別する。
`/schedule` からleaderが編集した場合も `period_type: 'full'` で保存（v3.3）。

#### shift_publish_statuses（シフト公開管理）
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
CHECK: published時はpublished_at・published_by必須
```

---

## 時刻の扱い（重要）

### なぜ integer（分数）を採用したか
- `time` 型: 23:59:59 までしか扱えず、バーの深夜営業（25:00, 26:30等）を格納不可
- `timestamptz`: UTC保存のため JST 変換でバグリスクあり
- **integer（分数）**: タイムゾーン変換が一切発生しない

### 変換ルール
```
00:00 = 0 / 10:00 = 600 / 18:00 = 1080
22:00 = 1320 / 25:00 = 1500 / 26:30 = 1590
29:00（翌5:00）= 1740 / 最大 2880（48:00）
```

### 変換ユーティリティ（src/lib/time.ts）
```typescript
export function minutesToDisplay(minutes: number): string
export function displayToMinutes(display: string): number
export function minutesToPosition(minutes: number, ganttStart: number, ganttEnd: number): number

// v3.2追加（希望「その他」の短縮表示専用・保存・計算には使わない）
export function minutesToShort(minutes: number): string
// 例: 1080 → '18' / 1110 → '18.5' / 1500 → '25' / 1530 → '25.5'
// 30分刻み以外は minutesToDisplay にフォールバック
```

### 既存カラムの例外
`shifts.scheduled_start_at` / `scheduled_end_at` は既存の `timestamptz` のまま。
保存時は Asia/Tokyo で変換して格納する。
読み取り時は `isoToMinutesFromWorkDateMidnight(iso, workDate)`（`@/lib/jst-shift-time`）を使う。

---

## Supabaseクライアントの使い分け

| クライアント | ファイル | 用途 | RLS |
|---|---|---|---|
| `createBrowserClient` | `src/lib/supabase/client.ts` | ブラウザ用 | 適用される |
| `createServerClient` | `src/lib/supabase/server.ts` | Server Component用 | 適用される |
| `createServiceClient` | `src/lib/supabase/service.ts` | サーバーサイド専用 | **バイパス** |

### ⚠️ 重要：全 Server Actions・全 Server Component は `createServiceClient()` を使う

既存テーブルは RLS ポリシーなし・anon から読めない。新規テーブル（shift_patterns 等）も
RLS が有効なため、Server Actions で `createServerClient` や `createBrowserClient` を使うと
データが取得できない・INSERT が拒否される。

**`createServiceClient()` を使う箇所（確定）:**
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/select-store/route.ts`
- `src/app/(auth)/login/select-store/page.tsx`
- `src/app/(shift)/schedule/page.tsx`
- `src/app/(shift)/request/page.tsx`
- `src/app/(shift)/settings/page.tsx`
- 全 Server Actions（`actions.ts`）

---

## セッション構造

```typescript
// terasu.session cookie（JWT HS256）
{
  staff_id: string
  staff_name: string
  memberships: Array<{
    store_id: string
    role: 'general' | 'leader'
  }>
  active_store_id: string | null
  iat: number
  exp: number  // 7日間
}
```

### セッション取得関数（v2追加）

```typescript
// src/lib/auth.ts
getSession()        // → { staff_id, staff_name, role, store_id }（店舗確定済みのみ）
getSessionPayload() // → JWTペイロード全体（memberships.length取得に使用）
```

---

## ファイル構成

```
src/
  app/
    (auth)/
      login/
        page.tsx              ログイン画面（Client Component）
        select-store/
          page.tsx            複数店舗選択画面（Server Component）
          SelectStoreForm.tsx  店舗選択フォーム（Client Component）
          SelectStoreStaffFooter.tsx  スタッフ名・ログアウト
        layout.tsx            useSearchParams用Suspense
    (shift)/
      request/
        page.tsx              希望シフト提出画面（Server Component）
        RequestShiftClient.tsx クライアント部分
        RequestDateRow.tsx    日付行コンポーネント
        actions.ts            upsertShiftRequests
      schedule/
        page.tsx              シフト作成画面（Server Component）
        ScheduleClient.tsx    クライアント部分（レスポンシブヘッダー・RequestEditModal内包）
        ScheduleGrid.tsx      カレンダーグリッド
        ScheduleGantt.tsx     ガントチャート（TapEditForm内包）
        actions.ts            upsertShiftTimes / publishSchedulePeriod / buildScheduleCsv
                              deleteShiftAction（v3.3追加）
                              upsertShiftRequestAction / deleteShiftRequestAction（v3.3追加）
        types.ts              StaffRow / SchedulePageData / RequestEditTarget（v3.3追加）
      settings/
        page.tsx              シフト設定画面（Server Component）
        SettingsPageClient.tsx クライアント部分
        actions.ts            createShiftPatternAction / updateShiftPatternAction等
                              updateShowRequestsToGeneralAction（v3.3追加）
    api/
      auth/
        login/route.ts        POST: ログイン
        logout/route.ts       POST: ログアウト
        select-store/route.ts POST: 店舗選択（cookie更新）
  lib/
    time.ts                   分数変換ユーティリティ（minutesToShort追加済み）
    auth.ts                   getSession() / getSessionPayload()
    session-token.ts          encodeSessionToken / decodeSessionToken
    logout-client.ts          logoutAndRedirectToLogin()
    shift-settings-ensure.ts  ensureShiftSettingsForStore()（show_requests_to_general対応済み）
    shift-request-periods.ts  期間・締切・週スライスロジック
    schedule-view-range.ts    表示幅（1週/2週/半月/1か月）
    jst-shift-time.ts         JST変換（CSV・セル表示・ガント用）
    supabase/
      client.ts / server.ts / service.ts
  middleware.ts               認証・ルーティング制御
  types/
    database.ts               型定義（ShiftSetting.show_requests_to_general追加済み）
public/
  manifest.json               PWAマニフェスト
  icons/
    icon.svg / icon-192x192.png / icon-512x512.png
```

---

## 主要ライブラリ・関数

### src/lib/time.ts

```typescript
minutesToDisplay(minutes): string          // 1500 → '25:00'
displayToMinutes(display): number          // '25:00' → 1500
minutesToPosition(minutes, start, end): number  // ガント位置(%)
minutesToShort(minutes): string            // 1500 → '25' / 1530 → '25.5'（表示専用）
```

### src/lib/shift-request-periods.ts（v3.1〜v3.2）

```typescript
type PeriodSettingsForRequest = Pick<ShiftSetting,
  'shift_cycle' | 'week_start_day' | 'deadline_type' | 'deadline_value'>

type PeriodDeadlineInfo = {
  sel: PeriodSel
  periodFirstYmd: string  // 期間先頭の YYYY-MM-DD（月初とは限らない）
  deadlineYmd: string
}

listPeriodsWithDeadlines(targetMonthFirst, settings): PeriodDeadlineInfo[]
monthHasAnyOpenPeriod(targetMonthFirst, settings, todayYmd): boolean
isDeadlineExpiredVsToday(deadlineYmd, todayYmd): boolean
periodSelEquals(a, b): boolean
resolveGridForSelection(targetMonthFirst, settings, sel): { period_type, workDates }
findFirstOpenPeriodInMonth(targetMonthFirst, settings, todayYmd): PeriodDeadlineInfo | null
addOneMonthFirst(targetMonthFirst): string
defaultPeriodSelForMonth(settings, targetMonthFirst): PeriodSel
resolveDefaultRequestMonthAndPeriod(settings, todayYmd): { targetMonthFirst, periodSel }
buildRequestPathForSel(ym7, sel): string
resolveNextPeriodPath(targetMonthFirst, currentSel, settings, todayYmd): string | null
```

### src/lib/schedule-view-range.ts（v2大幅更新）

```typescript
calcViewRange(startStr, view): ViewRange
buildSchedulePath(startYmd, view): string
parseScheduleViewKind(val): ScheduleViewKind
uniqueTargetMonthFirstsInRange(start, end): string[]
```

---

## 画面仕様（v3.3）

### ログイン画面（/login）
- `staff_email` + `password` で認証
- `leave_date` 設定済みはログイン不可
- `display_status='hidden'` でもログイン可
- 1店舗 → role別ホームへ / 複数店舗 → `/login/select-store`

### 希望シフト提出画面（/request）スマホ最適化

- **全ロール（general・leader）アクセス可能**
- 締切日・スタッフ名・対象月・期間セレクタ
- 日付ごとにパターンボタン列（shift_patterns / F / × / その他）
- その他: ガント範囲を30分刻みで選択
  - **表示は短縮形式**（`minutesToShort`）: 例 `18-25`、`18.5-26`
- 土曜=青・日曜/祝日=赤
- 提出済みバナー + 「修正する」ボタン + **「次の期間へ →」ボタン**
  - `nextPeriodPath` がある場合のみ「次の期間へ →」を表示
- 保存: `upsert(onConflict: 'store_id,staff_id,work_date')`

#### デフォルト表示期間

`?ym` なしアクセス時、`page.tsx` サーバー側で以下の優先順で期間を決定:

```
優先① 今月の締切前 & 未提出の最初の期間
優先② 来月の締切前 & 未提出の最初の期間
優先③ 今月の締切前の最初の期間（提出済みでも）
優先④ 来月の締切前の最初の期間（提出済みでも）
優先⑤ resolveDefaultRequestMonthAndPeriod フォールバック
```

#### 提出フロー

```
1. 提出ボタン押下 → 「送信中...」スピナー（submitting）
2. 成功 → 「✓ 提出しました」+ 「次の期間に移動します...」（done）
3. 1秒後 → nextPeriodPath があれば router.push / なければ router.refresh
4. 次期間なし → 提出済みバナー（修正する + 次の期間へ→）
```

#### 提出済み後のロック仕様

- `isSubmitted` によるボタン・日付行のロックは**撤廃**
- `formLocked`（締切判定）のみで無効化
- 提出済みでも期間・月は自由に移動可能

### シフト作成画面（/schedule）レスポンシブ対応済み

- **全ロール（general・leader）アクセス可能**
- ヘッダー構成:
  - **PC（lg以上）**: 1段全展開
  - **スマホ・タブレット（lg未満）**: ☰メニュー + 月移動（スピナー付き）
  - ☰ドロワー内にも月移動ボタンあり
- **公開ボタンの配置**:
  - PC（lg以上）: ヘッダー内
  - スマホ（lg未満）: ☰ドロワー内・leader向けブロック先頭
- **閲覧専用モード（general）**:
  - 希望↔シフトトグル非表示（シフト表示固定）
  - 公開ボタン・CSV・設定リンク非表示
  - セルクリック無効・ガントチャート非表示
  - 月移動・表示幅・店舗切り替え・ログアウト・希望シフト提出ボタンは表示
  - **「前の月へ」ボタンは現在表示範囲が当月以前なら disabled（v3.3追加）**
- **leader 専用**:
  - 希望↔シフトトグル / 公開ステータス・公開ボタン / CSV / ガントチャート
  - 希望モードでのセルクリック → 希望編集モーダル（v3.3追加）

#### コーナーリボン + 希望ポップアップ

- `show_requests_to_general` が true のときのみ general に表示（v3.3変更）
- leader は設定に関係なく常に表示
- 希望シフト（`shift_requests`）が登録されているセルの右上に **緑の三角リボン**
- PC: リボンホバーで希望内容をツールチップ表示
- スマホ・タブレット: リボンタップでポップアップ表示（`openRibbonKey` で管理）
- シフトモード・希望モード両方でリボン表示
- `requestMap`（`Map<staff_id_work_date, RequestSummary>`）で高速参照
- `formatRequestLabel()` で希望内容を文字列化

#### 日付ヘッダータップでガント表示（leader のみ）

- 日付 `th` を leader がクリック → `onPickCell(date)` でガント表示
- シフトモード時のみ有効・hover で `bg-slate-100`（今日列は `bg-slate-600`）

#### シフトセルタップで希望確認モーダル（leader のみ・シフトモード）

- 希望ありのセルをクリック → 希望内容確認モーダル
  - 「閉じる」または「シフトを編集」（ガントへ）
- 希望なしのセルをクリック → 従来どおりガントを直接開く

#### 希望モードでのセルクリック → 希望編集モーダル（v3.3追加・leader のみ）

- 希望モード（`effectiveViewMode === 'request'`）・未公開期間のセルをクリック
- 希望あり・なし問わず `RequestEditModal` を開く
- 対象: クリックしたスタッフ × 日付の1件
- `RequestEditTarget`（`types.ts`）: `{ staffId, staffName, workDate, storeId }`
- `ScheduleGrid` の props: `onRequestCellClick?: (target: RequestEditTarget) => void`
  - leader かつ希望モードかつ未公開のときのみ渡す・それ以外は undefined
- 公開済み期間のセルはクリック不可

##### RequestEditModal の仕様

- `ScheduleClient.tsx` 内コンポーネントとして定義
- z-index: `z-[100]`
- ヘッダー: スタッフ名 + 日付（M月D日（曜日）形式）
- 既存希望表示: `allRequests` から `staff_id + work_date` で検索・なければ「未登録」
- 編集フォーム:
  - パターン選択（`is_active: true` のみ）/ 終日（free）/ ×（off）/ その他（custom）
  - カスタム時: `ganttStart`〜`ganttEnd` の30分刻み select（`minutesToDisplay` で表示）
  - 終了 ≤ 開始のとき保存 disabled
- フッター:
  - 左: 「削除」ボタン（既存希望ありのときのみ）
  - 右: 「キャンセル」「保存」
- 保存: `upsertShiftRequestAction`（`period_type: 'full'`・`target_month` は月初日）
- 削除: `deleteShiftRequestAction`（確認なし・希望シフトは重要度低）
- 成功後: モーダルを閉じて `router.refresh()`
- `revalidatePath('/request')` も同時に実行（actions.ts側で対応済み）

#### ガントチャート（v3.3更新）

- バーが **開始〜終了の幅** で描画（`isoToMinutesFromWorkDateMidnight` を使用）
- バー内ラベル: `shift_pattern_name` があればパターン名・なければ `開始–終了`
- 幅 < 5% のときラベルに `invisible`
- 終了時刻未設定: 幅 2%・`bg-zinc-400`
- **iPad タップ → モーダル編集（TapEditForm）**
  - `isTouchDevice`（`useEffect` で判定）が true のときのみモーダル表示
  - PC はドラッグ操作のまま
  - `TapEditForm`（`ScheduleGantt.tsx` 内に定義）:
    - パターン選択（`patternsById` から `is_active` のみ表示）
    - 時間指定（30分刻み `<select>`）
    - `onSave(staffId, startMin, endMin)` を呼び出す
    - **「削除」ボタン（v3.3追加）**: `shiftId` がある場合のみ表示
    - 削除確認モーダル内（z-[210]）で確認後 `onDelete(shiftId)` を呼び出す
- **PC バークリック → 削除確認モーダル（v3.3追加）**
  - ドラッグと区別: `pcBarPointerMovedRef` で mousemove 発生有無を判定
  - バークリック（movedRef=false）かつ `shift_id` あり → `pcDeleteTarget` state をセット
  - 確認モーダル（z-[210]）で「削除する」→ `onDelete(shiftId)`

#### ScheduleGantt の props シグネチャ（v3.3更新）

```typescript
onSave: (staffId: string, startMin: number, endMin: number) => Promise<void>
onDelete: (shiftId: string) => Promise<void>  // v3.3追加
// workDate・patternId は渡せない（コンポーネントが workDate を props で保持）
```

#### 確定シフト削除の仕様（v3.3追加）

- `deleteShiftAction(shiftId)`: leader 権限 + 同一 store_id チェック後 DELETE
- 成功時 `revalidatePath('/schedule')`
- iPad: TapEditForm の削除ボタン → 確認モーダル → `onDelete`
- PC: ガントバークリック → 確認モーダル → `onDelete`
- `handleDelete`（ScheduleClient.tsx）: 成功時 `setGanttWorkDate(null)` でガントを閉じる

### シフト設定画面（/settings）leaderのみ

- シフトパターンCRUD（論理削除・is_active=false）
- ガントチャート表示時間設定
- シフトサイクル・週始まり・締切設定
- **一般スタッフへの希望シフト表示設定（v3.3追加）**
  - トグルスイッチ（即時保存・保存ボタンなし）
  - ON: 「表示する」/ OFF: 「表示しない」
  - `updateShowRequestsToGeneralAction` で `shift_settings.show_requests_to_general` を更新

---

## ボタン操作フィードバック

### 月移動ボタン（ScheduleClient.tsx）
- `isNavigating` state で管理
- 押下 → `setIsNavigating(true)` + `router.push(path)`
- 遷移中: `opacity-50 pointer-events-none` + スピナー表示
- PC・スマホヘッダー・☰ドロワー内すべて同じ `isNavigating` を共有
- **general の「前の月へ」制限（v3.3追加）**:
  - `isPrevDisabled = role === 'general' && currentViewMonthFirst <= currentMonthFirst`
  - `prevNavDisabled = isNavigating || isPrevDisabled`
  - `currentViewMonthFirst`: `monthsInView`（`uniqueTargetMonthFirstsInRange` の結果）の先頭
  - 3箇所すべてに同じ `prevNavDisabled` を適用

### 提出ボタン（RequestShiftClient.tsx）
- `submitUi: 'idle' | 'submitting' | 'done'` で管理
- `submitting`: 「送信中...」+ スピナー + disabled
- `done`: 「✓ 提出しました」+ `bg-emerald-600`

---

## middleware.ts の制御ロジック（v2）

```
未ログイン → /login
ログイン済み:
  active_store_id なし → /login/select-store
  /settings → general は /request にリダイレクト
  /schedule → 全ロール通過
  /request  → 全ロール通過
```

---

## PWA設定

```json
{
  "name": "TERASU-Shift",
  "short_name": "TERASU",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#334155"
}
```

---

## デザインシステム

### カラーパレット
```
ベース:     white / zinc-50 / zinc-100
ボーダー:   zinc-200 / zinc-300
テキスト:   zinc-900（メイン）/ zinc-500（サブ）/ zinc-400（キャプション）
アクセント: slate-600 / slate-700（プライマリ）
成功:       emerald-600（公開済み・保存成功・提出完了）
警告:       amber-50 / amber-800（未提出スタッフ）
エラー:     rose-600（締切日・エラー・削除ボタン）
今日:       slate-700（グリッドハイライト）
土曜:       sky-50 / sky-700
日祝:       rose-50 / rose-600
希望リボン: emerald-400（コーナーリボン三角）
```

### 共通コンポーネントスタイル
```
プライマリボタン:  bg-slate-700 text-white hover:bg-slate-800 rounded-md transition-colors
セカンダリボタン:  border border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded-md transition-colors
削除ボタン:       border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-md transition-colors
削除確定ボタン:   bg-rose-600 text-white hover:bg-rose-700 rounded-md transition-colors
input/select:    border border-zinc-200 rounded-md focus:ring-1 focus:ring-slate-400
カード:          bg-white rounded-lg border border-zinc-200 shadow-sm
ヘッダー:        bg-white/95 backdrop-blur-sm border-b border-zinc-100 shadow-sm sticky top-0
```

### z-index 整理
```
スマホ header:        z-50
ドロワーオーバーレイ:   z-40 / ドロワー本体: z-50
thead スタッフ列 th:   z-30
thead 日付列 th:      z-20
tbody スタッフ列 td:   z-10
リボンポップアップ:    z-50
希望確認モーダル:      z-[100]
希望編集モーダル:      z-[100]（v3.3追加）
iPad タップモーダル:   z-[200]
削除確認モーダル:      z-[210]（TapEditForm内・PC削除確認共通）
```

### ダークモード
- **ライトモード固定**（`darkMode: 'class'`・OS設定は無視）

---

## シフト公開フロー

```
1. leader がガントを編集 → shifts にINSERT/UPDATE（generalには非表示）
2. 「公開する」ボタン → shift_publish_statuses を upsert
   status='published' / published_at=now() / published_by_staff_id=staff_id
3. その瞬間から general のRLS が通る → スタッフのシフト画面に表示
```

---

## 既知の問題・今後の課題

| 項目 | 状態 | 備考 |
|---|---|---|
| 祝日自動取得バッチ | ⬜ 未実装 | 内閣府API → holidaysテーブル自動インポート |
| display_status='hidden'ログイン | ✅ 修正済み | |
| shift_settings未登録時の自動INSERT | ✅ 修正済み | |
| 店舗切り替えボタン動作しない | ✅ 修正済み | |
| general の /schedule アクセス | ✅ 修正済み | 閲覧専用モードで対応 |
| 表示幅切替時の移動バグ | ✅ 修正済み | |
| OS ダークモードで背景が真っ黒になる | ✅ 修正済み | |
| ガント: 保存前にバーがチラつく | ✅ 修正済み | |
| ガント: 30分刻みのグリッド線なし | ✅ 修正済み | |
| /schedule グリッド幅レスポンシブ | ✅ 修正済み | |
| /schedule 今日列自動スクロール | ✅ 修正済み | |
| スマホドロワーがグリッドに隠れる | ✅ 修正済み | |
| shift_requests RLSエラー | ✅ 修正済み(v3.1) | createServiceClient() に変更 |
| shift_patterns が /request に表示されない | ✅ 修正済み(v3.1) | createServiceClient() に変更 |
| /request デフォルト期間が締切済みになる | ✅ 修正済み(v3.1) | resolveDefaultRequestMonthAndPeriod → redirect |
| 公開ボタンがスマホではみ出る | ✅ 修正済み(v3.1) | ☰ドロワー内に移動 |
| PWAアイコン・名前が未設定 | ✅ 修正済み(v3.1) | manifest.json・アイコン・layout.tsx 追加 |
| 月移動・提出ボタンに反応がない | ✅ 修正済み(v3.2) | ローディングスピナー追加 |
| 希望「その他」が「他」で意味不明 | ✅ 修正済み(v3.2) | minutesToShort で `18-25` 形式に変更 |
| 希望シフトがシフト画面で見えない | ✅ 修正済み(v3.2) | コーナーリボン＋ポップアップ追加（全ロール） |
| 日付タップでガント表示されない | ✅ 修正済み(v3.2) | 日付 th クリックでガント表示（leader のみ） |
| シフトタップで希望確認できない | ✅ 修正済み(v3.2) | セルタップで希望確認モーダル表示 |
| ガントに開始時刻しか表示されない | ✅ 修正済み(v3.2) | 開始〜終了バー＋パターン名/時刻ラベル表示 |
| iPadでガントが操作できない | ✅ 修正済み(v3.2) | タップ→モーダル編集（TapEditForm） |
| 提出後に画面がロックされる | ✅ 修正済み(v3.2) | isSubmitted によるロック撤廃 |
| 提出後に次期間へ自動遷移しない | ✅ 修正済み(v3.2) | resolveNextPeriodPath + router.push |
| 再アクセス時に提出済み期間が表示される | ✅ 修正済み(v3.2) | DBで未提出期間を優先するリダイレクト |
| 確定シフトを削除できない | ✅ 修正済み(v3.3) | iPad: TapEditForm削除ボタン / PC: バークリック削除 |
| generalに他スタッフの希望を見せるか制御できない | ✅ 修正済み(v3.3) | shift_settings.show_requests_to_general追加 |
| leaderが他スタッフの希望シフトを編集できない | ✅ 修正済み(v3.3) | /scheduleの希望モードからRequestEditModal |
| generalが過去月を表示できてしまう | ✅ 修正済み(v3.3) | 「前の月へ」ボタンを当月以前でdisabled |

---

## CSVエクスポート

```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
```
- `#従業員コード` = `staffs.staff_number`
- `パターンコード` = `shifts.shift_pattern_name`
- `出勤予定/退勤予定` = JST HH:mm形式
- 最終行は改行で終了

---

## よく使うSQL

```sql
-- 店舗一覧
SELECT store_id, store_name FROM stores;

-- スタッフの所属確認
SELECT m.store_id, s.store_name, m.role, m.display_status
FROM memberships m
JOIN stores s ON s.store_id = m.store_id
WHERE m.staff_id = 'スタッフID';

-- shift_settings確認
SELECT * FROM shift_settings;

-- 希望シフト確認
SELECT * FROM shift_requests
WHERE store_id = '店舗ID'
ORDER BY work_date;

-- 公開状態確認
SELECT * FROM shift_publish_statuses
WHERE store_id = '店舗ID'
ORDER BY period_start;
```
