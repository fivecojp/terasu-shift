import { redirect } from 'next/navigation'
import { getSession, getSessionPayload } from '@/lib/auth'
import {
  monthRangeInclusive,
  resolveDefaultRequestMonthAndPeriod,
  ymParamToTargetFirst,
} from '@/lib/shift-request-periods'
import { ensureShiftSettingsForStore } from '@/lib/shift-settings-ensure'
import { createServiceClient } from '@/lib/supabase/service'
import type { ShiftPattern, ShiftRequest } from '@/types/database'
import { RequestShiftClient } from '@/app/(shift)/request/RequestShiftClient'

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const sessionPayload = await getSessionPayload()
  const storeCount = sessionPayload?.memberships.length ?? 0

  const ensured = await ensureShiftSettingsForStore(session.store_id)
  if (!ensured.ok) {
    return (
      <div className="p-6 text-sm text-red-700">
        シフト設定を初期化できませんでした: {ensured.error}
      </div>
    )
  }
  const settingsRow = ensured.settings

  const supabase = createServiceClient()

  const sp = await searchParams
  const ymFromQuery = ymParamToTargetFirst(sp.ym ?? null)
  if (!ymFromQuery) {
    const todayYmdJst = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
    })
      .format(new Date())
      .slice(0, 10)
    const resolved = resolveDefaultRequestMonthAndPeriod(settingsRow, todayYmdJst)
    redirect(`/request?ym=${resolved.targetMonthFirst.slice(0, 7)}`)
  }
  const targetMonthFirst = ymFromQuery

  const { startYmd: holStart, endYmd: holEnd } = monthRangeInclusive(
    targetMonthFirst
  )

  const [{ data: patternsRows }, { data: holidaysRows }, { data: reqRows }] =
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
        .gte('holiday_date', holStart)
        .lte('holiday_date', holEnd),
      supabase
        .from('shift_requests')
        .select('*')
        .eq('store_id', session.store_id)
        .eq('staff_id', session.staff_id)
        .eq('target_month', targetMonthFirst),
    ])

  const ymQuery = targetMonthFirst.slice(0, 7)

  return (
    <RequestShiftClient
      session={session}
      storeCount={storeCount}
      settings={settingsRow}
      patterns={(patternsRows ?? []) as ShiftPattern[]}
      holidays={holidaysRows ?? []}
      requests={(reqRows ?? []) as ShiftRequest[]}
      targetMonthFirst={targetMonthFirst}
      ymQuery={ymQuery}
    />
  )
}
