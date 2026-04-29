import { redirect } from 'next/navigation'
import { getSession, getSessionPayload } from '@/lib/auth'
import {
  addOneMonthFirst,
  buildRequestPathForSel,
  defaultPeriodSelForMonth,
  findFirstOpenPeriodInMonth,
  isDeadlineExpiredVsToday,
  listPeriodsWithDeadlines,
  listWeekSlicesInMonth,
  monthRangeInclusive,
  pairBiweeklySlices,
  parseYmd,
  resolveDefaultRequestMonthAndPeriod,
  resolveGridForSelection,
  type PeriodSel,
  weekStartsOnFromSettings,
  ymParamToTargetFirst,
} from '@/lib/shift-request-periods'
import { ensureShiftSettingsForStore } from '@/lib/shift-settings-ensure'
import { createServiceClient } from '@/lib/supabase/service'
import type { ShiftPattern, ShiftRequest, ShiftSetting } from '@/types/database'
import { RequestShiftClient } from '@/app/(shift)/request/RequestShiftClient'

function parsePeriodSelFromSearchParams(
  settings: ShiftSetting,
  targetMonthFirst: string,
  sp: { period?: string; weekId?: string; biweekId?: string }
): PeriodSel | null {
  const raw = sp.period
  if (!raw) return null
  const ymd = parseYmd(targetMonthFirst)
  const y = ymd.getFullYear()
  const m = ymd.getMonth()
  const wk = weekStartsOnFromSettings(settings.week_start_day)
  const weeks = listWeekSlicesInMonth(y, m, wk)
  const biweeks = pairBiweeklySlices(weeks)

  switch (settings.shift_cycle) {
    case 'monthly':
      if (raw === 'monthly') return { kind: 'monthly' }
      return null
    case 'semimonthly':
      if (raw === 'first_half') {
        return { kind: 'semimonthly', phase: 'first_half' }
      }
      if (raw === 'second_half') {
        return { kind: 'semimonthly', phase: 'second_half' }
      }
      return null
    case 'weekly':
      if (raw !== 'weekly' || !sp.weekId) return null
      return weeks.some((w) => w.id === sp.weekId)
        ? { kind: 'weekly', weekId: sp.weekId }
        : null
    case 'biweekly':
      if (raw !== 'biweekly' || !sp.biweekId) return null
      return biweeks.some((b) => b.id === sp.biweekId)
        ? { kind: 'biweekly', biweekId: sp.biweekId }
        : null
    default:
      return null
  }
}

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{
    ym?: string
    period?: string
    weekId?: string
    biweekId?: string
  }>
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

  const todayYmdJst = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })
    .format(new Date())
    .slice(0, 10)

  if (!ymFromQuery) {
    const ym0First = `${todayYmdJst.slice(0, 7)}-01`
    const ym1First = addOneMonthFirst(ym0First)

    type OpenPeriod = {
      monthFirst: string
      sel: PeriodSel
      workDates: string[]
    }
    const openPeriods: OpenPeriod[] = []

    for (const monthFirst of [ym0First, ym1First]) {
      for (const p of listPeriodsWithDeadlines(monthFirst, settingsRow)) {
        if (!isDeadlineExpiredVsToday(p.deadlineYmd, todayYmdJst)) {
          const grid = resolveGridForSelection(monthFirst, settingsRow, p.sel)
          openPeriods.push({ monthFirst, sel: p.sel, workDates: grid.workDates })
        }
      }
    }

    if (openPeriods.length > 0) {
      const allDates = [...new Set(openPeriods.flatMap((p) => p.workDates))]

      const submittedDateSet = new Set<string>()
      if (allDates.length > 0) {
        const { data: submitted } = await supabase
          .from('shift_requests')
          .select('work_date')
          .eq('store_id', session.store_id)
          .eq('staff_id', session.staff_id)
          .in('work_date', allDates)
        for (const r of submitted ?? []) {
          if (r.work_date) submittedDateSet.add(r.work_date)
        }
      }

      for (const p of openPeriods) {
        const hasUnsubmitted = p.workDates.some((d) => !submittedDateSet.has(d))
        if (hasUnsubmitted) {
          redirect(
            buildRequestPathForSel(p.monthFirst.slice(0, 7), p.sel)
          )
        }
      }

      const first = openPeriods[0]
      redirect(
        buildRequestPathForSel(first.monthFirst.slice(0, 7), first.sel)
      )
    }

    const resolved = resolveDefaultRequestMonthAndPeriod(settingsRow, todayYmdJst)
    redirect(
      buildRequestPathForSel(
        resolved.targetMonthFirst.slice(0, 7),
        resolved.periodSel
      )
    )
  }
  const targetMonthFirst = ymFromQuery

  const parsedFromUrl = parsePeriodSelFromSearchParams(settingsRow, targetMonthFirst, {
    period: sp.period,
    weekId: sp.weekId,
    biweekId: sp.biweekId,
  })
  const initialPeriodSel: PeriodSel =
    parsedFromUrl ??
    findFirstOpenPeriodInMonth(targetMonthFirst, settingsRow, todayYmdJst)?.sel ??
    defaultPeriodSelForMonth(settingsRow, targetMonthFirst)

  const settingsForClient = {
    shift_cycle: settingsRow.shift_cycle,
    week_start_day: settingsRow.week_start_day,
    deadline_type: settingsRow.deadline_type,
    deadline_value: settingsRow.deadline_value,
  }

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
      settingsForClient={settingsForClient}
      todayYmd={todayYmdJst}
      patterns={(patternsRows ?? []) as ShiftPattern[]}
      holidays={holidaysRows ?? []}
      requests={(reqRows ?? []) as ShiftRequest[]}
      targetMonthFirst={targetMonthFirst}
      ymQuery={ymQuery}
      initialPeriodSel={initialPeriodSel}
    />
  )
}
