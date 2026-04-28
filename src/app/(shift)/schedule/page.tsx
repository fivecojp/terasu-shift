import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { ensureShiftSettingsForStore } from '@/lib/shift-settings-ensure'
import { createServiceClient } from '@/lib/supabase/service'
import {
  calcViewRange,
  parseScheduleViewKind,
  uniqueTargetMonthFirstsInRange,
} from '@/lib/schedule-view-range'
import {
  defaultTargetMonth,
  firstOfMonthFromYmd,
  ymParamToTargetFirst,
} from '@/lib/shift-request-periods'
import type {
  Membership,
  Shift as ShiftRow,
  ShiftPattern,
  ShiftPublishStatus,
  ShiftRequest,
  Staff,
} from '@/types/database'
import { ScheduleClient } from '@/app/(shift)/schedule/ScheduleClient'
import type { StaffRow } from '@/app/(shift)/schedule/types'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; start?: string; view?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'leader') redirect('/request')

  const sp = await searchParams
  const targetMonthFromYm =
    ymParamToTargetFirst(sp.ym ?? null) ?? defaultTargetMonth()

  const startStr =
    typeof sp.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.start)
      ? sp.start
      : targetMonthFromYm

  const scheduleViewKind = parseScheduleViewKind(sp.view) ?? 'monthly'
  const viewRange = calcViewRange(startStr, scheduleViewKind)
  const fetchStart = viewRange.dates[0] ?? startStr
  const fetchEnd =
    viewRange.dates[viewRange.dates.length - 1] ?? startStr

  const targetMonthFirst = firstOfMonthFromYmd(startStr)
  const ymQuery = startStr.slice(0, 7)
  const requestMonths = uniqueTargetMonthFirstsInRange(fetchStart, fetchEnd)

  const ensured = await ensureShiftSettingsForStore(session.store_id)
  if (!ensured.ok) {
    return (
      <div className="p-8 text-red-700">
        シフト設定を初期化できませんでした: {ensured.error}
      </div>
    )
  }
  const shiftSettings = ensured.settings

  const supabase = createServiceClient()

  const { data: storeRow } = await supabase
    .from('stores')
    .select('store_name')
    .eq('store_id', session.store_id)
    .maybeSingle()

  type MemNested = Membership & {
    staffs:
      | Pick<Staff, 'staff_id' | 'staff_name' | 'leave_date' | 'staff_number'>
      | Pick<
          Staff,
          'staff_id' | 'staff_name' | 'leave_date' | 'staff_number'
        >[]
      | null
  }

  const { data: memRows, error: memErr } = await supabase
    .from('memberships')
    .select(
      'staff_id, display_order, staffs ( staff_id, staff_name, leave_date, staff_number )'
    )
    .eq('store_id', session.store_id)
    .eq('display_status', 'visible')
    .order('display_order', { ascending: true })

  if (memErr) {
    return (
      <div className="p-8 text-red-700">
        所属スタッフの取得に失敗しました。
      </div>
    )
  }

  const staff: StaffRow[] = []
  for (const r of (memRows ?? []) as unknown as MemNested[]) {
    const raw = r.staffs
    const sf = raw
      ? Array.isArray(raw)
        ? raw[0]
        : raw
      : null
    if (!sf || sf.leave_date) continue
    staff.push({
      staff_id: sf.staff_id,
      staff_name: sf.staff_name,
      staff_number: sf.staff_number,
      display_order: r.display_order,
    })
  }

  const shiftRequestsBase = supabase
    .from('shift_requests')
    .select('*')
    .eq('store_id', session.store_id)

  const shiftRequestsQuery =
    requestMonths.length === 1
      ? shiftRequestsBase.eq('target_month', requestMonths[0]!)
      : requestMonths.length > 1
        ? shiftRequestsBase.in('target_month', requestMonths)
        : shiftRequestsBase.eq('target_month', targetMonthFirst)

  const [patternsRes, holidaysRes, shiftsRes, requestsRes, publishRes] =
    await Promise.all([
    supabase
      .from('shift_patterns')
      .select('*')
      .eq('store_id', session.store_id)
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('holidays')
      .select('holiday_date')
      .eq('store_id', session.store_id)
      .gte('holiday_date', fetchStart)
      .lte('holiday_date', fetchEnd),
    supabase
      .from('shifts')
      .select('*')
      .eq('store_id', session.store_id)
      .gte('work_date', fetchStart)
      .lte('work_date', fetchEnd),
    shiftRequestsQuery,
    supabase
      .from('shift_publish_statuses')
      .select('*')
      .eq('store_id', session.store_id)
      .lte('period_start', fetchEnd)
      .gte('period_end', fetchStart),
    ])

  return (
    <ScheduleClient
      session={session}
      storeName={storeRow?.store_name?.trim() || '店舗'}
      staff={staff}
      settings={shiftSettings}
      patterns={(patternsRes.data ?? []) as ShiftPattern[]}
      shifts={(shiftsRes.data ?? []) as ShiftRow[]}
      requests={(requestsRes.data ?? []) as ShiftRequest[]}
      publishRows={(publishRes.data ?? []) as ShiftPublishStatus[]}
      holidays={holidaysRes.data ?? []}
      targetMonthFirst={targetMonthFirst}
      ymQuery={ymQuery}
      viewStartYmd={startStr}
      scheduleViewKind={scheduleViewKind}
    />
  )
}
