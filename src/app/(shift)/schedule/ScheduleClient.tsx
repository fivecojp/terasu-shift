'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import {
  buildSchedulePath,
  calcViewRange,
  kindToViewSpan,
  viewSpanLabel,
  viewSpanToKind,
  uniqueTargetMonthFirstsInRange,
  type ScheduleViewKind,
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

type Props = SchedulePageData & {
  session: SessionUser
  storeCount: number
  viewStartYmd: string
  scheduleViewKind: ScheduleViewKind
}

export function ScheduleClient(init: Props) {
  const router = useRouter()
  const {
    session,
    storeCount,
    storeName,
    staff,
    settings,
    patterns,
    shifts,
    requests,
    publishRows,
    holidays,
    ymQuery,
    viewStartYmd,
    scheduleViewKind,
  } = init

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

  const viewRange = useMemo(
    () => calcViewRange(viewStartYmd, scheduleViewKind),
    [scheduleViewKind, viewStartYmd]
  )
  const columnDates = viewRange.dates

  const periodStart = columnDates[0]
  const periodEnd = columnDates[columnDates.length - 1]

  const publishForRange = useMemo(() => {
    return publishRows.find(
      (p) =>
        p.period_start === periodStart && p.period_end === periodEnd
    )
  }, [periodEnd, periodStart, publishRows])

  /** 対象月に希望が1件でもある staff_id（page 取得の staff は visible・退職日なしのみ） */
  const monthsInView = useMemo(() => {
    if (columnDates.length === 0) return []
    return uniqueTargetMonthFirstsInRange(
      columnDates[0],
      columnDates[columnDates.length - 1]
    )
  }, [columnDates])

  const unsubmittedStaffIds = useMemo(() => {
    if (monthsInView.length === 0) return new Set<string>()
    const byStaff = new Map<string, Set<string>>()
    for (const r of requests) {
      if (!monthsInView.includes(r.target_month)) continue
      let got = byStaff.get(r.staff_id)
      if (!got) {
        got = new Set()
        byStaff.set(r.staff_id, got)
      }
      got.add(r.target_month)
    }
    const ids = new Set<string>()
    for (const x of staff) {
      const got = byStaff.get(x.staff_id) ?? new Set<string>()
      if (monthsInView.some((m) => !got.has(m))) ids.add(x.staff_id)
    }
    return ids
  }, [monthsInView, requests, staff])

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

  return (
    <div className="min-h-full bg-zinc-50 pb-24">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-lg font-bold text-zinc-900">{storeName}</span>
            <span className="text-zinc-300" aria-hidden>
              |
            </span>
            <span className="text-sm text-zinc-500">{session.staff_name}</span>
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={buildSchedulePath(
                viewRange.prevStart,
                scheduleViewKind
              )}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            >
              ＜
            </Link>
            <span className="min-w-[7rem] text-center text-base font-semibold text-zinc-800">
              {viewRange.viewLabel}
            </span>
            <Link
              href={buildSchedulePath(
                viewRange.nextStart,
                scheduleViewKind
              )}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            >
              ＞
            </Link>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <span className="text-zinc-500">表示幅</span>
            <select
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={kindToViewSpan(scheduleViewKind)}
              onChange={(e) => {
                const nextKind = viewSpanToKind(e.target.value as ViewSpan)
                router.push(buildSchedulePath(viewStartYmd, nextKind))
              }}
            >
              <option value="1w">{viewSpanLabel('1w')}</option>
              <option value="2w">{viewSpanLabel('2w')}</option>
              <option value="half">{viewSpanLabel('half')}</option>
              <option value="1m">{viewSpanLabel('1m')}</option>
            </select>
          </label>

          <div className="inline-flex rounded-lg border border-zinc-300">
            <button
              type="button"
              className={`rounded-l-lg px-4 py-1.5 text-sm ${
                mode === 'request'
                  ? 'bg-slate-700 font-semibold text-white'
                  : 'border-r border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
              onClick={() => setMode('request')}
            >
              希望
            </button>
            <button
              type="button"
              className={`rounded-r-lg px-4 py-1.5 text-sm ${
                mode === 'shift'
                  ? 'bg-slate-700 font-semibold text-white'
                  : 'bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
              onClick={() => setMode('shift')}
            >
              シフト
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">公開：</span>
            {publishForRange?.status === 'published' ? (
              <span className="font-medium text-emerald-600">
                公開済み{' '}
                {publishForRange.published_at
                  ? `（${publishForRange.published_at.slice(0, 10)}）`
                  : ''}
              </span>
            ) : (
              <>
                <span className="font-medium text-amber-600">ドラフト</span>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  onClick={() => void onPublish()}
                >
                  公開する
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            onClick={() => void onCsv()}
          >
            CSVエクスポート
          </button>

          <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
            {session.role === 'leader' ? (
              <Link
                href="/settings"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                設定
              </Link>
            ) : null}
            {storeCount >= 2 ? (
              <Link
                href="/login/select-store"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                店舗切り替え
              </Link>
            ) : null}
            <button
              type="button"
              className="text-sm text-zinc-400 underline hover:text-zinc-600"
              onClick={() => void logoutAndRedirectToLogin()}
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl px-4 py-6">
        <ScheduleGrid
          staff={staff}
          columnDates={columnDates}
          holidays={holidaysSet}
          mode={mode}
          patternsById={patternsById}
          shiftsKey={shiftsKey}
          requestsKey={requestsKey}
          unsubmittedStaffIds={unsubmittedStaffIds}
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
            <p className="mt-4 text-center text-sm text-zinc-400">
              「シフト」表示で日付セルをクリックすると、ガントチャートが表示されます。
            </p>
          )
        )}
      </main>
    </div>
  )
}
