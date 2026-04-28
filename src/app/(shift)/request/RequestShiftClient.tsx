'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type UpsertShiftRowPayload,
  upsertShiftRequests,
} from '@/app/(shift)/request/actions'
import {
  computeDeadlineYmd,
  defaultPeriodSelForMonth,
  findFirstOpenPeriodInMonth,
  isDeadlineExpiredVsToday,
  listHalfHourOptions,
  listPeriodsWithDeadlines,
  listWeekSlicesInMonth,
  monthHasAnyOpenPeriod,
  pairBiweeklySlices,
  parseYmd,
  periodSelEquals,
  resolveDefaultRequestMonthAndPeriod,
  resolveGridForSelection,
  type PeriodDeadlineInfo,
  type PeriodSel,
  weekStartsOnFromSettings,
  ymParamToTargetFirst,
} from '@/lib/shift-request-periods'
import type { SessionUser } from '@/lib/auth'
import type { ShiftPattern, ShiftRequest, ShiftSetting } from '@/types/database'
import { RequestDateRow, type RowVals, type Tone } from '@/app/(shift)/request/RequestDateRow'
import { logoutAndRedirectToLogin } from '@/lib/logout-client'

const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

function formatShortDateLabel(ymd: string): string {
  const d = parseYmd(ymd)
  return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`
}

function formatJaLong(ymd: string): string {
  const d = parseYmd(ymd)
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d)
}

function requestToRow(r: ShiftRequest, half: number[]): RowVals {
  if (r.request_type === 'pattern') {
    return {
      mode: 'pattern',
      patternId: r.shift_pattern_id,
      customStart: null,
      customEnd: null,
    }
  }
  if (r.request_type === 'free') {
    return {
      mode: 'free',
      patternId: null,
      customStart: null,
      customEnd: null,
    }
  }
  if (r.request_type === 'off') {
    return {
      mode: 'off',
      patternId: null,
      customStart: null,
      customEnd: null,
    }
  }
  const s = r.custom_start_minutes ?? half[0] ?? 0
  const e = r.custom_end_minutes ?? half[Math.min(1, half.length - 1)] ?? s + 30
  return {
    mode: 'custom',
    patternId: null,
    customStart: s,
    customEnd: e,
  }
}

function deadlinePassedForSel(
  infos: PeriodDeadlineInfo[],
  sel: PeriodSel,
  todayStr: string
): boolean {
  const meta = infos.find((p) => periodSelEquals(p.sel, sel))
  if (!meta) return false
  return isDeadlineExpiredVsToday(meta.deadlineYmd, todayStr)
}

function rowToPayload(rv: RowVals): UpsertShiftRowPayload {
  if (rv.mode === 'pattern') {
    if (!rv.patternId) {
      return { request_type: 'free' }
    }
    return { request_type: 'pattern', shift_pattern_id: rv.patternId }
  }
  if (rv.mode === 'free') return { request_type: 'free' }
  if (rv.mode === 'off') return { request_type: 'off' }
  if (
    rv.customStart === null ||
    rv.customEnd === null
  ) {
    return { request_type: 'off' }
  }
  return {
    request_type: 'custom',
    custom_start_minutes: rv.customStart,
    custom_end_minutes: rv.customEnd,
  }
}

export type Props = {
  session: SessionUser
  storeCount: number
  settings: ShiftSetting
  patterns: ShiftPattern[]
  holidays: { holiday_date: string }[]
  requests: ShiftRequest[]
  /** YYYY-MM-01 */
  targetMonthFirst: string
  /** YYYY-MM for query link */
  ymQuery: string
}

export function RequestShiftClient(props: Props) {
  const {
    session,
    storeCount,
    settings,
    patterns,
    holidays,
    requests,
    targetMonthFirst,
    ymQuery,
  } = props

  const router = useRouter()
  const ym = ymParamToTargetFirst(ymQuery) ?? targetMonthFirst.slice(0, 7)

  const todayStr = new Date().toLocaleDateString('sv-SE')

  const ymNow = new Date()
  const ym0 = `${ymNow.getFullYear()}-${String(ymNow.getMonth() + 1).padStart(2, '0')}`
  const d1 = new Date(ymNow.getFullYear(), ymNow.getMonth() + 1, 1)
  const ym1 = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, '0')}`

  const targetMonthFirstYm0 = `${ym0}-01`
  const targetMonthFirstYm1 = `${ym1}-01`

  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    if (q.get('ym')) return
    const preferred = resolveDefaultRequestMonthAndPeriod(settings, todayStr)
    if (preferred.targetMonthFirst !== targetMonthFirst) {
      router.replace(`/request?ym=${preferred.targetMonthFirst.slice(0, 7)}`)
    }
  }, [router, settings, targetMonthFirst, todayStr])

  const month0HasOpen = monthHasAnyOpenPeriod(
    targetMonthFirstYm0,
    settings,
    todayStr
  )
  const month1HasOpen = monthHasAnyOpenPeriod(
    targetMonthFirstYm1,
    settings,
    todayStr
  )

  const noSubmitPeriodAvailable = !month0HasOpen && !month1HasOpen

  const holidaySet = useMemo(
    () => new Set(holidays.map((h) => h.holiday_date)),
    [holidays]
  )

  const ymd = parseYmd(targetMonthFirst)
  const y = ymd.getFullYear()
  const m = ymd.getMonth()

  const wkStarts = weekStartsOnFromSettings(settings.week_start_day)
  const weeks = useMemo(
    () => listWeekSlicesInMonth(y, m, wkStarts),
    [y, m, wkStarts]
  )
  const biweeks = useMemo(() => pairBiweeklySlices(weeks), [weeks])

  const halfOpts = useMemo(
    () =>
      listHalfHourOptions(settings.gantt_start_minutes, settings.gantt_end_minutes),
    [settings.gantt_end_minutes, settings.gantt_start_minutes]
  )

  const [periodSel, setPeriodSel] = useState<PeriodSel>(() => {
    const open = findFirstOpenPeriodInMonth(targetMonthFirst, settings, todayStr)
    return open?.sel ?? defaultPeriodSelForMonth(settings, targetMonthFirst)
  })

  useEffect(() => {
    const periods = listPeriodsWithDeadlines(targetMonthFirst, settings)
    const open = periods.filter(
      (p) => !isDeadlineExpiredVsToday(p.deadlineYmd, todayStr)
    )
    const def = defaultPeriodSelForMonth(settings, targetMonthFirst)
    const defMeta = periods.find((p) => periodSelEquals(p.sel, def))
    const defOk =
      !!defMeta && !isDeadlineExpiredVsToday(defMeta.deadlineYmd, todayStr)

    setPeriodSel((prev) => {
      const prevOk = open.find((p) => periodSelEquals(p.sel, prev))
      if (prevOk) return prev
      if (defOk) return def
      if (open[0]) return open[0].sel
      return def
    })
  }, [settings, targetMonthFirst, todayStr])

  const grid = useMemo(
    () => resolveGridForSelection(targetMonthFirst, settings, periodSel),
    [periodSel, settings, targetMonthFirst]
  )

  const workDates = grid.workDates
  const periodFirst = workDates[0] ?? targetMonthFirst.slice(0, 10)

  const deadlineYmd = useMemo(
    () => computeDeadlineYmd(settings, periodFirst),
    [periodFirst, settings]
  )

  const periodDeadlineInfos = useMemo(
    () => listPeriodsWithDeadlines(targetMonthFirst, settings),
    [settings, targetMonthFirst]
  )

  const currentPeriodDeadlinePassed = deadlinePassedForSel(
    periodDeadlineInfos,
    periodSel,
    todayStr
  )

  const allPeriodsExpiredThisMonth = useMemo(
    () =>
      periodDeadlineInfos.length > 0 &&
      periodDeadlineInfos.every((p) =>
        isDeadlineExpiredVsToday(p.deadlineYmd, todayStr)
      ),
    [periodDeadlineInfos, todayStr]
  )

  const formLocked =
    currentPeriodDeadlinePassed || allPeriodsExpiredThisMonth

  const savedForPeriod = useMemo(() => {
    return requests.filter(
      (r) =>
        r.target_month === targetMonthFirst &&
        r.period_type === grid.period_type &&
        workDates.includes(r.work_date)
    )
  }, [grid.period_type, requests, targetMonthFirst, workDates])

  const isSubmitted = savedForPeriod.length > 0
  const [editing, setEditing] = useState(() => !isSubmitted)

  useEffect(() => {
    setEditing(!isSubmitted)
  }, [isSubmitted, ym, grid.period_type])

  const rowDefault = useCallback((): RowVals => {
    const p0 = patterns[0]
    if (p0) {
      return {
        mode: 'pattern',
        patternId: p0.shift_pattern_id,
        customStart: halfOpts[0] ?? null,
        customEnd: halfOpts[1] ?? halfOpts[0] ?? null,
      }
    }
    return {
      mode: 'free',
      patternId: null,
      customStart: halfOpts[0] ?? null,
      customEnd: halfOpts[1] ?? halfOpts[0] ?? null,
    }
  }, [halfOpts, patterns])

  const [rows, setRows] = useState<Record<string, RowVals>>({})

  useEffect(() => {
    const next: Record<string, RowVals> = {}
    const byDate = new Map(savedForPeriod.map((r) => [r.work_date, r]))
    for (const d of workDates) {
      const s = byDate.get(d)
      next[d] = s ? requestToRow(s, halfOpts) : rowDefault()
    }
    setRows(next)
  }, [halfOpts, rowDefault, savedForPeriod, workDates])

  async function submit() {
    const payloadRows: Record<string, UpsertShiftRowPayload> = {}
    for (const d of workDates) {
      const rv = rows[d]
      if (!rv) {
        alert('画面の初期化が完了してから再度お試しください')
        return
      }
      payloadRows[d] = rowToPayload(rv)
    }

    const res = await upsertShiftRequests({
      target_month: targetMonthFirst,
      periodSel,
      rows: payloadRows,
    })
    if (!res.ok) {
      alert(res.error)
      return
    }
    setEditing(false)
    router.refresh()
  }

  const monthSummaryLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: 'long',
      }).format(parseYmd(targetMonthFirst)),
    [targetMonthFirst]
  )

  const periodSummaryLabel = useMemo(() => {
    switch (settings.shift_cycle) {
      case 'monthly':
        return '全期間（月初〜月末）'
      case 'semimonthly':
        return periodSel.kind === 'semimonthly' && periodSel.phase === 'second_half'
          ? '後半（16日〜月末）'
          : '前半（1〜15日）'
      case 'weekly': {
        const id =
          periodSel.kind === 'weekly' ? periodSel.weekId : weeks[0]?.id
        const w = weeks.find((x) => x.id === id)
        return w?.label ?? weeks[0]?.label ?? '対象週'
      }
      case 'biweekly': {
        const id =
          periodSel.kind === 'biweekly' ? periodSel.biweekId : biweeks[0]?.id
        const b = biweeks.find((x) => x.id === id)
        return b?.label ?? biweeks[0]?.label ?? '対象期間（2週）'
      }
      default:
        return ''
    }
  }, [biweeks, periodSel, settings.shift_cycle, weeks])

  const [headerExpanded, setHeaderExpanded] = useState(false)

  const halfBtnActive =
    'rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors'
  const halfBtnInactive =
    'rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
  const halfBtnExpired =
    'rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-400 cursor-not-allowed opacity-40'

  const periodControl =
    settings.shift_cycle === 'monthly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象期間</span>
        <p className="text-sm font-medium text-zinc-800">全期間（月初〜月末）</p>
      </div>
    ) : settings.shift_cycle === 'semimonthly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象期間</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={
              (!!isSubmitted && !editing) ||
              deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'semimonthly', phase: 'first_half' },
                todayStr
              )
            }
            className={
              deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'semimonthly', phase: 'first_half' },
                todayStr
              )
                ? halfBtnExpired
                : periodSel.kind === 'semimonthly' &&
                    periodSel.phase === 'first_half'
                  ? halfBtnActive
                  : halfBtnInactive
            }
            onClick={() =>
              setPeriodSel({ kind: 'semimonthly', phase: 'first_half' })
            }
          >
            前半（1〜15日）
          </button>
          <button
            type="button"
            disabled={
              (!!isSubmitted && !editing) ||
              deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'semimonthly', phase: 'second_half' },
                todayStr
              )
            }
            className={
              deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'semimonthly', phase: 'second_half' },
                todayStr
              )
                ? halfBtnExpired
                : periodSel.kind === 'semimonthly' &&
                    periodSel.phase === 'second_half'
                  ? halfBtnActive
                  : halfBtnInactive
            }
            onClick={() =>
              setPeriodSel({ kind: 'semimonthly', phase: 'second_half' })
            }
          >
            後半（16日〜月末）
          </button>
        </div>
      </div>
    ) : settings.shift_cycle === 'weekly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象週</span>
        {weeks.length === 0 ? (
          <p className="text-sm text-amber-800">この月に表示できる週がありません。</p>
        ) : (
          <select
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            value={
              periodSel.kind === 'weekly'
                ? periodSel.weekId
                : weeks[0]?.id ?? ''
            }
            disabled={!!isSubmitted && !editing}
            onChange={(e) =>
              setPeriodSel({ kind: 'weekly', weekId: e.target.value })
            }
          >
            {weeks.map((w) => {
              const passed = deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'weekly', weekId: w.id },
                todayStr
              )
              return (
                <option key={w.id} value={w.id} disabled={passed}>
                  {w.label}
                  {passed ? '（締切済）' : ''}
                </option>
              )
            })}
          </select>
        )}
      </div>
    ) : settings.shift_cycle === 'biweekly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象期間（2週）</span>
        {biweeks.length === 0 ? (
          <p className="text-sm text-amber-800">この月に表示できる2週ブロックがありません。</p>
        ) : (
          <select
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            value={
              periodSel.kind === 'biweekly'
                ? periodSel.biweekId
                : biweeks[0]?.id ?? ''
            }
            disabled={!!isSubmitted && !editing}
            onChange={(e) =>
              setPeriodSel({ kind: 'biweekly', biweekId: e.target.value })
            }
          >
            {biweeks.map((bw) => {
              const passed = deadlinePassedForSel(
                periodDeadlineInfos,
                { kind: 'biweekly', biweekId: bw.id },
                todayStr
              )
              return (
                <option key={bw.id} value={bw.id} disabled={passed}>
                  {bw.label}
                  {passed ? '（締切済）' : ''}
                </option>
              )
            })}
          </select>
        )}
      </div>
    ) : null

  const MONTH_NAV_ACTIVE =
    'rounded-md bg-slate-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors'
  const MONTH_NAV_INACTIVE =
    'rounded-md border border-zinc-200 px-4 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
  const MONTH_NAV_EXPIRED =
    'rounded-md border border-zinc-200 px-4 py-1.5 text-sm text-zinc-400 cursor-not-allowed opacity-40'

  function monthNavClass(active: boolean, expired: boolean): string {
    if (expired) return MONTH_NAV_EXPIRED
    if (active) return MONTH_NAV_ACTIVE
    return MONTH_NAV_INACTIVE
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 pb-24">
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/95 backdrop-blur-sm shadow-sm">
        {!headerExpanded ? (
          <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-2 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-800">
                {monthSummaryLabel} · {periodSummaryLabel}
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                締切 {formatJaLong(deadlineYmd)}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-600"
              onClick={() => setHeaderExpanded(true)}
            >
              ▼ 設定を表示
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-4 py-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-500">
                  締め切り
                </p>
                <p className="text-sm font-bold text-rose-600">
                  {formatJaLong(deadlineYmd)}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {settings.deadline_type === 'days_before'
                    ? `期間開始日の ${settings.deadline_value} 日前まで`
                    : settings.deadline_type === 'weeks_before'
                      ? `期間開始日の ${settings.deadline_value} 週前まで`
                      : `期間開始日の ${settings.deadline_value} か月前まで`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-right">
                <div className="text-sm">
                  <p className="text-xs text-zinc-500">ログイン中</p>
                  <p className="font-medium text-zinc-900">{session.staff_name}</p>
                </div>
                {storeCount >= 2 ? (
                  <Link
                    href="/login/select-store"
                    className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    店舗切り替え
                  </Link>
                ) : null}
                <Link
                  href="/schedule"
                  className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                >
                  シフト表へ
                </Link>
                <button
                  type="button"
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-600"
                  onClick={() => void logoutAndRedirectToLogin()}
                >
                  ログアウト
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!month0HasOpen}
                onClick={() => {
                  if (month0HasOpen) router.push(`/request?ym=${ym0}`)
                }}
                className={monthNavClass(ym === ym0, !month0HasOpen)}
              >
                今月
              </button>
              <button
                type="button"
                disabled={!month1HasOpen}
                onClick={() => {
                  if (month1HasOpen) router.push(`/request?ym=${ym1}`)
                }}
                className={monthNavClass(ym === ym1, !month1HasOpen)}
              >
                来月
              </button>
            </div>

            {periodControl}

            <button
              type="button"
              className="w-full rounded-md border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
              onClick={() => setHeaderExpanded(false)}
            >
              ▲ 設定を閉じる
            </button>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-lg px-3 py-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">希望シフト</h2>

        {noSubmitPeriodAvailable ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-center">
            <p className="text-sm text-zinc-500">現在提出できる期間がありません</p>
          </div>
        ) : null}

        {!noSubmitPeriodAvailable && allPeriodsExpiredThisMonth ? (
          <div className="mx-0 my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-medium text-amber-900">
              この月では提出できる期間がありません
            </p>
            <p className="mt-1 text-xs text-amber-700">
              今月・来月を切り替えてください
            </p>
          </div>
        ) : null}

        {isSubmitted ? (
          <div className="my-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-700">提出済み</p>
            <p className="mt-1 text-xs text-emerald-600">
              修正する場合は下のボタンを押してください
            </p>
            {!editing ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
                onClick={() => setEditing(true)}
              >
                修正する
              </button>
            ) : null}
          </div>
        ) : null}

        {!noSubmitPeriodAvailable && !allPeriodsExpiredThisMonth ? (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <span className="w-14 shrink-0">日付</span>
              <span className="min-w-0 flex-1">希望</span>
            </div>

            <div className="pb-2">
              {workDates.map((d) => {
                const dow = parseYmd(d).getDay()
                const holiday = holidaySet.has(d)
                const saturday = dow === 6
                const sunOrHol = dow === 0 || holiday

                let tone: Tone = 'plain'
                if (saturday) tone = 'sat'
                else if (sunOrHol) tone = 'sunh'

                return (
                  <RequestDateRow
                    key={`${grid.period_type}-${periodFirst}-${d}`}
                    dateYmd={d}
                    labelText={formatShortDateLabel(d)}
                    tone={tone}
                    patterns={patterns}
                    halfOpts={halfOpts}
                    disabled={
                      formLocked || (!!isSubmitted && !editing)
                    }
                    row={rows[d] ?? rowDefault()}
                    onChangeMode={(nv) =>
                      setRows((prev) => ({ ...prev, [d]: nv }))
                    }
                  />
                )
              })}
            </div>
          </div>
        ) : null}

        {!noSubmitPeriodAvailable && !allPeriodsExpiredThisMonth ? (
          <div className="mt-6 pb-4">
            <button
              type="button"
              className="w-full rounded-lg bg-slate-700 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={
                (!!isSubmitted && !editing) ||
                workDates.length === 0 ||
                formLocked
              }
              onClick={submit}
            >
              この内容で希望を提出する
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
