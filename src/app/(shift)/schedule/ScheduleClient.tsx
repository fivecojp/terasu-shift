'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import {
  columnDatesForView,
  viewSpanLabel,
  type ViewSpan,
} from '@/lib/schedule-view-range'
import type { ShiftPattern } from '@/types/database'
import {
  buildKeyedRequests,
  buildKeyedShifts,
  type SchedulePageData,
  type StaffRow,
} from '@/app/(shift)/schedule/types'
import {
  buildScheduleCsv,
  publishSchedulePeriod,
  saveShiftFromMinutes,
} from '@/app/(shift)/schedule/actions'
import { ScheduleGrid } from '@/app/(shift)/schedule/ScheduleGrid'
import { ScheduleGantt } from '@/app/(shift)/schedule/ScheduleGantt'
import { logoutAndRedirectToLogin } from '@/lib/logout-client'
export type { StaffRow }

function addMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Props = SchedulePageData & {
  session: SessionUser
}

export function ScheduleClient(init: Props) {
  const router = useRouter()
  const {
    session,
    storeName,
    staff,
    settings,
    patterns,
    shifts,
    requests,
    publishRows,
    holidays,
    targetMonthFirst,
    ymQuery,
  } = init

  const [span, setSpan] = useState<ViewSpan>('1m')
  const [mode, setMode] = useState<'request' | 'shift'>('request')
  const [ganttWorkDate, setGanttWorkDate] = useState<string | null>(null)

  const holidaysSet = useMemo(
    () => new Set(holidays.map((h) => h.holiday_date)),
    [holidays]
  )

  const patternsById = useMemo(() => {
    const m = new Map<string, ShiftPattern>()
    for (const p of patterns) m.set(p.shift_pattern_id, p)
    return m
  }, [patterns])

  const shiftsKey = useMemo(() => buildKeyedShifts(shifts), [shifts])
  const requestsKey = useMemo(() => buildKeyedRequests(requests), [requests])

  const columnDates = useMemo(
    () => columnDatesForView(targetMonthFirst, span),
    [span, targetMonthFirst]
  )

  const periodStart = columnDates[0]
  const periodEnd = columnDates[columnDates.length - 1]

  const publishForRange = useMemo(() => {
    return publishRows.find(
      (p) =>
        p.period_start === periodStart && p.period_end === periodEnd
    )
  }, [periodEnd, periodStart, publishRows])

  const staffWithRequest = useMemo(() => {
    const s = new Set<string>()
    for (const r of requests) {
      if (r.target_month === targetMonthFirst) s.add(r.staff_id)
    }
    return s
  }, [requests, targetMonthFirst])

  const unsubmitted = useMemo(
    () => staff.filter((x) => !staffWithRequest.has(x.staff_id)),
    [staff, staffWithRequest]
  )

  const requestByStaffForGantt = useMemo(() => {
    const m = new Map<string, import('@/types/database').ShiftRequest>()
    if (!ganttWorkDate) return m
    for (const s of staff) {
      const r = requestsKey.get(`${s.staff_id}|${ganttWorkDate}`)
      if (r) m.set(s.staff_id, r)
    }
    return m
  }, [ganttWorkDate, requestsKey, staff])

  const shiftByStaffForGantt = useMemo(() => {
    const m = new Map<string, import('@/types/database').Shift>()
    if (!ganttWorkDate) return m
    for (const s of staff) {
      const sh = shiftsKey.get(`${s.staff_id}|${ganttWorkDate}`)
      if (sh) m.set(s.staff_id, sh)
    }
    return m
  }, [ganttWorkDate, shiftsKey, staff])

  const onPickCell = useCallback((workDate: string) => {
    setGanttWorkDate(workDate)
  }, [])

  async function onPublish() {
    if (!periodStart || !periodEnd) return
    const r = await publishSchedulePeriod({
      period_start: periodStart,
      period_end: periodEnd,
    })
    if (!r.ok) {
      alert(r.error)
      return
    }
    router.refresh()
  }

  async function onCsv() {
    const r = await buildScheduleCsv({ ym: ymQuery })
    if (!r.ok) {
      alert(r.error)
      return
    }
    const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `shift_${ymQuery}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function onGanttSave(
    staffId: string,
    startMin: number,
    endMin: number
  ) {
    if (!ganttWorkDate) return
    const res = await saveShiftFromMinutes({
      work_date: ganttWorkDate,
      staff_id: staffId,
      start_minutes: startMin,
      end_minutes: endMin,
    })
    if (!res.ok) {
      alert(res.error)
      return
    }
    router.refresh()
  }

  const prevYm = addMonthYm(ymQuery, -1)
  const nextYm = addMonthYm(ymQuery, 1)

  return (
    <div className="min-h-full bg-zinc-100 pb-24">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-lg font-semibold text-zinc-900">{storeName}</div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm text-zinc-600">
                担当: {session.staff_name}
              </span>
              {session.role === 'leader' ? (
                <Link
                  href="/settings"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
                >
                  設定
                </Link>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
                onClick={() => void logoutAndRedirectToLogin()}
              >
                ログアウト
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/schedule?ym=${prevYm}`}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              >
                ＜
              </Link>
              <span className="font-mono text-sm font-medium text-zinc-900">
                {(() => {
                  const [yy, mm] = ymQuery.split('-')
                  return `${yy}年${Number(mm)}月`
                })()}
              </span>
              <Link
                href={`/schedule?ym=${nextYm}`}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              >
                ＞
              </Link>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <span className="text-zinc-500">表示幅</span>
              <select
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5"
                value={span}
                onChange={(e) => setSpan(e.target.value as ViewSpan)}
              >
                <option value="1w">{viewSpanLabel('1w')}</option>
                <option value="2w">{viewSpanLabel('2w')}</option>
                <option value="half">{viewSpanLabel('half')}</option>
                <option value="1m">{viewSpanLabel('1m')}</option>
              </select>
            </label>

            <div className="flex rounded-lg border border-zinc-300 p-0.5">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  mode === 'request'
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-700'
                }`}
                onClick={() => setMode('request')}
              >
                希望
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  mode === 'shift'
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-700'
                }`}
                onClick={() => setMode('shift')}
              >
                シフト
              </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-600">公開：</span>
              {publishForRange?.status === 'published' ? (
                <span className="font-medium text-emerald-700">
                  公開済み{' '}
                  {publishForRange.published_at
                    ? `（${publishForRange.published_at.slice(0, 10)}）`
                    : ''}
                </span>
              ) : (
                <>
                  <span className="text-amber-700">ドラフト</span>
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                    onClick={() => void onPublish()}
                  >
                    公開する
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
              onClick={() => void onCsv()}
            >
              CSVエクスポート
            </button>
          </div>

          {unsubmitted.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <span className="font-medium">
                {targetMonthFirst.slice(0, 7)} の希望が未提出のスタッフ：
              </span>{' '}
              {unsubmitted.map((u) => u.staff_name).join('、')}
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <ScheduleGrid
          staff={staff}
          columnDates={columnDates}
          holidays={holidaysSet}
          mode={mode}
          patternsById={patternsById}
          shiftsKey={shiftsKey}
          requestsKey={requestsKey}
          onPickCell={(wd) => {
            if (mode === 'shift') onPickCell(wd)
          }}
        />

        {ganttWorkDate &&
        mode === 'shift' &&
        staff.length ? (
          <ScheduleGantt
            workDate={ganttWorkDate}
            staffLines={staff.map((s) => ({
              staff_id: s.staff_id,
              staff_name: s.staff_name,
            }))}
            settings={settings}
            shiftByStaff={shiftByStaffForGantt}
            requestByStaff={requestByStaffForGantt}
            patternsById={patternsById}
            onSave={onGanttSave}
          />
        ) : (
          mode === 'shift' && (
            <p className="mt-4 text-center text-sm text-zinc-500">
              「シフト」表示で日付セルをクリックすると、ガントチャートが表示されます。
            </p>
          )
        )}
      </main>
    </div>
  )
}
