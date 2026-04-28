'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type UpsertShiftRowPayload,
  upsertShiftRequests,
} from '@/app/(shift)/request/actions'
import { computeDeadlineYmd, listHalfHourOptions, listWeekSlicesInMonth, pairBiweeklySlices, parseYmd, resolveGridForSelection, type PeriodSel, weekStartsOnFromSettings, ymParamToTargetFirst } from '@/lib/shift-request-periods'
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

function defaultPeriodSel(
  settings: ShiftSetting,
  weekSlices: ReturnType<typeof listWeekSlicesInMonth>,
  biweeks: ReturnType<typeof pairBiweeklySlices>
): PeriodSel {
  switch (settings.shift_cycle) {
    case 'semimonthly':
      return { kind: 'semimonthly', phase: 'first_half' }
    case 'monthly':
      return { kind: 'monthly' }
    case 'weekly': {
      const w0 = weekSlices[0]
      return w0
        ? { kind: 'weekly', weekId: w0.id }
        : { kind: 'monthly' }
    }
    case 'biweekly': {
      const b0 = biweeks[0]
      return b0
        ? { kind: 'biweekly', biweekId: b0.id }
        : { kind: 'monthly' }
    }
    default:
      return { kind: 'monthly' }
  }
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
  const { session, settings, patterns, holidays, requests, targetMonthFirst, ymQuery } =
    props

  const router = useRouter()
  const ym = ymParamToTargetFirst(ymQuery) ?? targetMonthFirst.slice(0, 7)

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

  const [periodSel, setPeriodSel] = useState<PeriodSel>(() =>
    defaultPeriodSel(settings, weeks, biweeks)
  )

  useEffect(() => {
    setPeriodSel(defaultPeriodSel(settings, weeks, biweeks))
  }, [biweeks, settings.shift_cycle, settings.week_start_day, weeks, ym])

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

  const ymNow = new Date()
  const ym0 = `${ymNow.getFullYear()}-${String(ymNow.getMonth() + 1).padStart(2, '0')}`
  const d1 = new Date(ymNow.getFullYear(), ymNow.getMonth() + 1, 1)
  const ym1 = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, '0')}`

  const periodControl =
    settings.shift_cycle === 'monthly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象期間</span>
        <p className="text-sm text-zinc-800">全期間（月初〜月末）</p>
      </div>
    ) : settings.shift_cycle === 'semimonthly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象期間</span>
        <select
          className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base"
          value={
            periodSel.kind === 'semimonthly' ? periodSel.phase : 'first_half'
          }
          disabled={!!isSubmitted && !editing}
          onChange={(e) =>
            setPeriodSel({
              kind: 'semimonthly',
              phase: e.target.value === 'second_half' ? 'second_half' : 'first_half',
            })
          }
        >
          <option value="first_half">前半（1〜15日）</option>
          <option value="second_half">後半（16日〜月末）</option>
        </select>
      </div>
    ) : settings.shift_cycle === 'weekly' ? (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-500">対象週</span>
        {weeks.length === 0 ? (
          <p className="text-sm text-amber-800">この月に表示できる週がありません。</p>
        ) : (
          <select
            className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base"
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
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
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
            className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base"
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
            {biweeks.map((bw) => (
              <option key={bw.id} value={bw.id}>
                {bw.label}
              </option>
            ))}
          </select>
        )}
      </div>
    ) : null

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 px-4 py-4 shadow-sm backdrop-blur">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-zinc-500">締め切り</p>
              <p className="text-base font-semibold text-red-700">
                {formatJaLong(deadlineYmd)}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {settings.deadline_type === 'days_before'
                  ? `期間開始日の ${settings.deadline_value} 日前まで`
                  : settings.deadline_type === 'weeks_before'
                    ? `期間開始日の ${settings.deadline_value} 週前まで`
                    : `期間開始日の ${settings.deadline_value} か月前まで`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 text-right sm:flex-row sm:items-center">
              <div className="text-sm">
                <p className="text-xs text-zinc-500">ログイン中</p>
                <p className="font-medium text-zinc-900">{session.staff_name}</p>
              </div>
              <button
                type="button"
                className="min-h-10 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
                onClick={() => void logoutAndRedirectToLogin()}
              >
                ログアウト
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              className={`min-h-10 flex-none rounded-full px-4 py-2 text-sm font-medium ${
                ym === ym0
                  ? 'bg-zinc-900 text-white'
                  : 'border border-zinc-300 bg-white text-zinc-800'
              }`}
              href={`/request?ym=${ym0}`}
            >
              今月
            </Link>
            <Link
              className={`min-h-10 flex-none rounded-full px-4 py-2 text-sm font-medium ${
                ym === ym1
                  ? 'bg-zinc-900 text-white'
                  : 'border border-zinc-300 bg-white text-zinc-800'
              }`}
              href={`/request?ym=${ym1}`}
            >
              来月
            </Link>
          </div>

          <div>{periodControl}</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-16 pt-4">
        <h1 className="mb-3 text-lg font-semibold text-zinc-900">希望シフト</h1>

        {isSubmitted ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">この対象期間には提出済みの希望があります。</p>
              {!editing ? (
                <button
                  type="button"
                  className="min-h-10 shrink-0 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => setEditing(true)}
                >
                  修正する
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2 border-b border-zinc-200 bg-zinc-50 px-1 py-2 text-xs font-medium text-zinc-600">
            <span>日付</span>
            <span>希望</span>
          </div>

          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto overscroll-y-contain">
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
                  disabled={!!isSubmitted && !editing}
                  row={rows[d] ?? rowDefault()}
                  onChangeMode={(nv) =>
                    setRows((prev) => ({ ...prev, [d]: nv }))
                  }
                />
              )
            })}
          </div>
        </div>

        <div className="mt-6 pb-8">
          <button
            type="button"
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-40"
            disabled={(!!isSubmitted && !editing) || workDates.length === 0}
            onClick={submit}
          >
            この内容で希望を提出する
          </button>
        </div>
      </main>
    </div>
  )
}
