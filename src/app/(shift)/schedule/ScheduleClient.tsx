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
  role: 'general' | 'leader'
  storeCount: number
  viewStartYmd: string
  scheduleViewKind: ScheduleViewKind
}

export function ScheduleClient(init: Props) {
  const router = useRouter()
  const {
    session,
    role,
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

  const [viewMode, setViewMode] = useState<'request' | 'shift'>('request')
  const [ganttWorkDate, setGanttWorkDate] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const effectiveViewMode =
    role === 'general' ? 'shift' : viewMode

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

  const handleViewKindChange = useCallback(
    (nextKind: ScheduleViewKind) => {
      if (nextKind === 'monthly') {
        const monthStart = `${viewStartYmd.slice(0, 7)}-01`
        router.push(buildSchedulePath(monthStart, nextKind))
        return
      }
      const todayYmd = new Date().toLocaleDateString('sv-SE')
      router.push(buildSchedulePath(todayYmd, nextKind))
    },
    [router, viewStartYmd]
  )

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

  const prevPath = buildSchedulePath(viewRange.prevStart, scheduleViewKind)
  const nextPath = buildSchedulePath(viewRange.nextStart, scheduleViewKind)
  const staffName = session.staff_name
  const publishStatus =
    publishForRange?.status === 'published' ? 'published' : 'draft'
  const publishLabelPc =
    publishStatus === 'published'
      ? `公開済み${publishForRange?.published_at ? `（${publishForRange.published_at.slice(0, 10)}）` : ''}`
      : 'ドラフト'

  function handleCsvExport() {
    void onCsv()
  }

  function handleLogout() {
    void logoutAndRedirectToLogin()
  }

  return (
    <div className="min-h-full bg-zinc-50 pb-24">
      {/* PC（lg以上） */}
      <header className="sticky top-0 z-10 hidden border-b border-zinc-200 bg-white shadow-sm lg:block">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="shrink-0 text-base font-bold text-zinc-900">
            {storeName}
          </span>
          <span className="shrink-0 text-zinc-200" aria-hidden>
            |
          </span>
          <span className="shrink-0 text-sm text-zinc-500">{staffName}</span>

          <div className="ml-4 flex shrink-0 items-center gap-1">
            <Link
              href={prevPath}
              className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            >
              ‹
            </Link>
            <span className="min-w-[6rem] text-center text-sm font-semibold text-zinc-800">
              {viewRange.viewLabel}
            </span>
            <Link
              href={nextPath}
              className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            >
              ›
            </Link>
          </div>

          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:outline-none"
            value={kindToViewSpan(scheduleViewKind)}
            onChange={(e) => {
              const nextKind = viewSpanToKind(e.target.value as ViewSpan)
              handleViewKindChange(nextKind)
            }}
          >
            <option value="1w">{viewSpanLabel('1w')}</option>
            <option value="2w">{viewSpanLabel('2w')}</option>
            <option value="half">{viewSpanLabel('half')}</option>
            <option value="1m">{viewSpanLabel('1m')}</option>
          </select>

          {role === 'leader' ? (
            <div className="flex shrink-0 overflow-hidden rounded border border-zinc-300">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm ${
                  viewMode === 'request'
                    ? 'bg-slate-700 font-semibold text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
                onClick={() => setViewMode('request')}
              >
                希望
              </button>
              <button
                type="button"
                className={`border-l border-zinc-300 px-3 py-1.5 text-sm ${
                  viewMode === 'shift'
                    ? 'bg-slate-700 font-semibold text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
                onClick={() => setViewMode('shift')}
              >
                シフト
              </button>
            </div>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {role === 'leader' ? (
              <>
                <span
                  className={`text-sm font-medium ${
                    publishStatus === 'published'
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }`}
                >
                  {publishLabelPc}
                </span>
                {publishStatus === 'draft' ? (
                  <button
                    type="button"
                    className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                    onClick={() => void onPublish()}
                  >
                    公開する
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
                  onClick={() => void handleCsvExport()}
                >
                  CSVエクスポート
                </button>
              </>
            ) : null}

            <Link
              href="/request"
              className="whitespace-nowrap rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              希望シフト提出
            </Link>
            {role === 'leader' ? (
              <Link
                href="/settings"
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                設定
              </Link>
            ) : null}
            {storeCount >= 2 ? (
              <Link
                href="/login/select-store"
                className="whitespace-nowrap rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                店舗切替
              </Link>
            ) : null}
            <button
              type="button"
              className="text-sm text-zinc-400 underline hover:text-zinc-600"
              onClick={() => void handleLogout()}
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* スマホ・タブレット（lg未満） */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white shadow-sm lg:hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>

          <Link
            href={prevPath}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
          >
            ‹
          </Link>
          <span className="min-w-[5rem] shrink-0 whitespace-nowrap text-center text-xs font-semibold text-zinc-800">
            {viewRange.viewLabel}
          </span>
          <Link
            href={nextPath}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
          >
            ›
          </Link>

          <select
            className="shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs text-zinc-700 focus:outline-none"
            value={kindToViewSpan(scheduleViewKind)}
            onChange={(e) => {
              const nextKind = viewSpanToKind(e.target.value as ViewSpan)
              handleViewKindChange(nextKind)
            }}
          >
            <option value="1w">{viewSpanLabel('1w')}</option>
            <option value="2w">{viewSpanLabel('2w')}</option>
            <option value="half">{viewSpanLabel('half')}</option>
            <option value="1m">{viewSpanLabel('1m')}</option>
          </select>

          {role === 'leader' ? (
            <div className="flex shrink-0 overflow-hidden rounded border border-zinc-300">
              <button
                type="button"
                className={`px-2 py-1 text-xs ${
                  viewMode === 'request'
                    ? 'bg-slate-700 font-semibold text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
                onClick={() => setViewMode('request')}
              >
                希望
              </button>
              <button
                type="button"
                className={`border-l border-zinc-300 px-2 py-1 text-xs ${
                  viewMode === 'shift'
                    ? 'bg-slate-700 font-semibold text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
                onClick={() => setViewMode('shift')}
              >
                シフト
              </button>
            </div>
          ) : null}

          {role === 'leader' && publishStatus === 'draft' ? (
            <button
              type="button"
              className="ml-auto shrink-0 rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              onClick={() => void onPublish()}
            >
              公開
            </button>
          ) : null}
          {role === 'leader' && publishStatus === 'published' ? (
            <span className="ml-auto shrink-0 text-xs font-medium text-emerald-600">
              公開済
            </span>
          ) : null}
        </div>

        {menuOpen ? (
          <>
            <div
              className="fixed inset-0 z-10"
              aria-hidden
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 w-56 rounded-b-lg border border-zinc-200 bg-white py-1 shadow-lg">
              <div className="border-b border-zinc-100 px-4 py-2">
                <p className="text-xs font-semibold text-zinc-800">{storeName}</p>
                <p className="text-xs text-zinc-500">{staffName}</p>
              </div>
              <Link
                href="/request"
                className="flex items-center px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => setMenuOpen(false)}
              >
                希望シフト提出
              </Link>
              {role === 'leader' ? (
                <>
                  <Link
                    href="/settings"
                    className="flex items-center px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    設定
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => {
                      setMenuOpen(false)
                      handleCsvExport()
                    }}
                  >
                    CSVエクスポート
                  </button>
                </>
              ) : null}
              {storeCount >= 2 ? (
                <Link
                  href="/login/select-store"
                  className="flex items-center px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                  onClick={() => setMenuOpen(false)}
                >
                  店舗切り替え
                </Link>
              ) : null}
              <hr className="my-1 border-zinc-100" />
              <button
                type="button"
                className="flex w-full items-center px-4 py-3 text-left text-sm text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
                onClick={() => {
                  setMenuOpen(false)
                  handleLogout()
                }}
              >
                ログアウト
              </button>
            </div>
          </>
        ) : null}
      </header>

      <main className="mx-auto max-w-screen-xl px-4 py-6">
        <ScheduleGrid
          staff={staff}
          columnDates={columnDates}
          holidays={holidaysSet}
          mode={effectiveViewMode}
          role={role}
          patternsById={patternsById}
          shiftsKey={shiftsKey}
          requestsKey={requestsKey}
          unsubmittedStaffIds={unsubmittedStaffIds}
          onPickCell={(wd) => {
            if (effectiveViewMode === 'shift') onPickCell(wd)
          }}
        />

        {role === 'leader' &&
        ganttWorkDate &&
        effectiveViewMode === 'shift' &&
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
          role === 'leader' &&
          effectiveViewMode === 'shift' && (
            <p className="mt-4 text-center text-sm text-zinc-400">
              「シフト」表示で日付セルをクリックすると、ガントチャートが表示されます。
            </p>
          )
        )}
      </main>
    </div>
  )
}
