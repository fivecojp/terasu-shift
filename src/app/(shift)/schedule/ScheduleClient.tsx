'use client'

import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { displayToMinutes, minutesToDisplay, minutesToShort } from '@/lib/time'
import {
  buildKeyedRequests,
  buildKeyedShifts,
  type RequestEditTarget,
  type SchedulePageData,
  type StaffRow,
} from '@/app/(shift)/schedule/types'
import {
  buildScheduleCsv,
  deleteShiftAction,
  deleteShiftRequestAction,
  publishSchedulePeriod,
  saveShiftFromMinutes,
  upsertShiftRequestAction,
} from '@/app/(shift)/schedule/actions'
import {
  ScheduleGrid,
  type RequestSummary,
} from '@/app/(shift)/schedule/ScheduleGrid'
import { ScheduleGantt } from '@/app/(shift)/schedule/ScheduleGantt'
import { logoutAndRedirectToLogin } from '@/lib/logout-client'
export type { StaffRow }

function MonthNavSpinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
    </svg>
  )
}

const WD_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

function formatWorkDateJa(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${m}月${d}日（${WD_LABELS[dt.getDay()]}）`
}

function scheduleRequestSummaryLabel(
  req: RequestSummary,
  plist: ShiftPattern[]
): string {
  if (req.request_type === 'off') return '休み'
  if (req.request_type === 'free') return '出勤可'
  if (req.request_type === 'pattern') {
    const p = plist.find((x) => x.shift_pattern_id === req.shift_pattern_id)
    return p ? p.pattern_name : 'パターン'
  }
  if (req.request_type === 'custom') {
    const s = req.custom_start_minutes
    const e = req.custom_end_minutes
    if (s !== null && e !== null) {
      return `${minutesToShort(s)}〜${minutesToShort(e)}`
    }
    return 'その他'
  }
  return '希望あり'
}

type RequestEditModalProps = {
  target: RequestEditTarget
  allRequests: RequestSummary[]
  patterns: ShiftPattern[]
  ganttStart: number
  ganttEnd: number
  onClose: () => void
}

function RequestEditModal({
  target,
  allRequests,
  patterns,
  ganttStart,
  ganttEnd,
  onClose,
}: RequestEditModalProps) {
  const router = useRouter()
  const activePatterns = useMemo(
    () =>
      [...patterns]
        .filter((p) => p.is_active)
        .sort((a, b) => a.display_order - b.display_order),
    [patterns]
  )

  const [editRequestType, setEditRequestType] = useState<
    'pattern' | 'free' | 'off' | 'custom'
  >('off')
  const [editPatternId, setEditPatternId] = useState<string | null>(null)
  const [editCustomStart, setEditCustomStart] = useState(1080)
  const [editCustomEnd, setEditCustomEnd] = useState(1500)
  const [isSavingRequest, setIsSavingRequest] = useState(false)
  const [isDeletingRequest, setIsDeletingRequest] = useState(false)

  const timeOptions = useMemo(() => {
    const opts: number[] = []
    for (let m = ganttStart; m <= ganttEnd; m += 30) {
      opts.push(m)
    }
    return opts
  }, [ganttStart, ganttEnd])

  const existingSummary = useMemo(
    () =>
      allRequests.find(
        (r) => r.staff_id === target.staffId && r.work_date === target.workDate
      ),
    [allRequests, target.staffId, target.workDate]
  )

  useEffect(() => {
    const ex = allRequests.find(
      (r) => r.staff_id === target.staffId && r.work_date === target.workDate
    )
    if (!ex) {
      setEditRequestType('off')
      setEditPatternId(activePatterns[0]?.shift_pattern_id ?? null)
      setEditCustomStart(1080)
      setEditCustomEnd(1500)
      return
    }
    if (ex.request_type === 'pattern') {
      setEditRequestType('pattern')
      setEditPatternId(ex.shift_pattern_id)
      setEditCustomStart(1080)
      setEditCustomEnd(1500)
      return
    }
    if (ex.request_type === 'free') {
      setEditRequestType('free')
      setEditPatternId(null)
      setEditCustomStart(1080)
      setEditCustomEnd(1500)
      return
    }
    if (ex.request_type === 'off') {
      setEditRequestType('off')
      setEditPatternId(null)
      setEditCustomStart(1080)
      setEditCustomEnd(1500)
      return
    }
    setEditRequestType('custom')
    setEditPatternId(null)
    setEditCustomStart(ex.custom_start_minutes ?? ganttStart)
    setEditCustomEnd(
      ex.custom_end_minutes ?? Math.min(ganttStart + 120, ganttEnd)
    )
  }, [target, allRequests, activePatterns, ganttStart, ganttEnd])

  const hasExisting = Boolean(existingSummary)

  const saveDisabled =
    isSavingRequest ||
    isDeletingRequest ||
    (editRequestType === 'pattern' && !editPatternId) ||
    (editRequestType === 'custom' && editCustomEnd <= editCustomStart)

  async function handleSaveRequest() {
    if (editRequestType === 'pattern' && !editPatternId) return
    if (
      editRequestType === 'custom' &&
      editCustomEnd <= editCustomStart
    )
      return

    setIsSavingRequest(true)
    const targetMonth = `${target.workDate.slice(0, 7)}-01`
    const res = await upsertShiftRequestAction({
      store_id: target.storeId,
      staff_id: target.staffId,
      work_date: target.workDate,
      target_month: targetMonth,
      period_type: 'full',
      request_type: editRequestType,
      shift_pattern_id: editRequestType === 'pattern' ? editPatternId : null,
      custom_start_minutes:
        editRequestType === 'custom' ? editCustomStart : null,
      custom_end_minutes: editRequestType === 'custom' ? editCustomEnd : null,
    })
    setIsSavingRequest(false)
    if (res.error) {
      alert(res.error)
      return
    }
    onClose()
    router.refresh()
  }

  async function handleDeleteRequest() {
    if (!hasExisting) return
    setIsDeletingRequest(true)
    const res = await deleteShiftRequestAction({
      store_id: target.storeId,
      staff_id: target.staffId,
      work_date: target.workDate,
    })
    setIsDeletingRequest(false)
    if (res.error) {
      alert(res.error)
      return
    }
    onClose()
    router.refresh()
  }

  const selectBtnOn = 'bg-slate-700 text-white'
  const selectBtnOff =
    'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 pt-24"
      role="dialog"
      aria-modal
      onClick={() => {
        if (!isSavingRequest && !isDeletingRequest) onClose()
      }}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-medium text-zinc-900">
              {target.staffName}
            </div>
            <div className="mt-0.5 text-sm text-zinc-500">
              {formatWorkDateJa(target.workDate)}
            </div>
          </div>
          <button
            type="button"
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label="閉じる"
            disabled={isSavingRequest || isDeletingRequest}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="mb-4">
          <div className="text-xs text-zinc-500">既存の希望</div>
          {existingSummary ? (
            <div className="mt-1 text-sm text-zinc-800">
              {scheduleRequestSummaryLabel(existingSummary, patterns)}
            </div>
          ) : (
            <div className="mt-1 text-sm text-zinc-400">未登録</div>
          )}
        </div>

        <div className="space-y-2">
          {activePatterns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activePatterns.map((p) => (
                <button
                  key={p.shift_pattern_id}
                  type="button"
                  disabled={isSavingRequest || isDeletingRequest}
                  className={`rounded-md px-3 py-2 text-sm ${
                    editRequestType === 'pattern' &&
                    editPatternId === p.shift_pattern_id
                      ? selectBtnOn
                      : selectBtnOff
                  }`}
                  onClick={() => {
                    setEditRequestType('pattern')
                    setEditPatternId(p.shift_pattern_id)
                  }}
                >
                  {p.pattern_name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isSavingRequest || isDeletingRequest}
              className={`rounded-md px-3 py-2 text-sm ${
                editRequestType === 'free' ? selectBtnOn : selectBtnOff
              }`}
              onClick={() => {
                setEditRequestType('free')
                setEditPatternId(null)
              }}
            >
              終日
            </button>
            <button
              type="button"
              disabled={isSavingRequest || isDeletingRequest}
              className={`rounded-md px-3 py-2 text-sm ${
                editRequestType === 'off' ? selectBtnOn : selectBtnOff
              }`}
              onClick={() => {
                setEditRequestType('off')
                setEditPatternId(null)
              }}
            >
              ×
            </button>
            <button
              type="button"
              disabled={isSavingRequest || isDeletingRequest}
              className={`rounded-md px-3 py-2 text-sm ${
                editRequestType === 'custom' ? selectBtnOn : selectBtnOff
              }`}
              onClick={() => {
                setEditRequestType('custom')
                setEditPatternId(null)
              }}
            >
              その他
            </button>
          </div>
        </div>

        {editRequestType === 'custom' ? (
          <div className="mt-4 flex items-center gap-2">
            <select
              className="flex-1 rounded-md border border-zinc-200 px-2 py-2 text-sm"
              value={minutesToDisplay(editCustomStart)}
              disabled={isSavingRequest || isDeletingRequest}
              onChange={(e) =>
                setEditCustomStart(displayToMinutes(e.target.value))
              }
            >
              {timeOptions.map((m) => (
                <option key={m} value={minutesToDisplay(m)}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
            <span className="text-sm text-zinc-400">〜</span>
            <select
              className="flex-1 rounded-md border border-zinc-200 px-2 py-2 text-sm"
              value={minutesToDisplay(editCustomEnd)}
              disabled={isSavingRequest || isDeletingRequest}
              onChange={(e) =>
                setEditCustomEnd(displayToMinutes(e.target.value))
              }
            >
              {timeOptions.map((m) => (
                <option key={`e-${m}`} value={minutesToDisplay(m)}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            {hasExisting ? (
              <button
                type="button"
                className="rounded-md border border-rose-300 px-4 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                disabled={isSavingRequest || isDeletingRequest}
                onClick={() => void handleDeleteRequest()}
              >
                {isDeletingRequest ? '削除中...' : '削除'}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              disabled={isSavingRequest || isDeletingRequest}
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-700 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saveDisabled}
              onClick={() => void handleSaveRequest()}
            >
              {isSavingRequest ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type Props = SchedulePageData & {
  session: SessionUser
  role: 'general' | 'leader'
  storeCount: number
  viewStartYmd: string
  scheduleViewKind: ScheduleViewKind
  allRequests: RequestSummary[]
  showRequestsToGeneral: boolean
}

export function ScheduleClient(init: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

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
    allRequests,
    showRequestsToGeneral: _showRequestsToGeneral,
    publishRows,
    holidays,
    ymQuery,
    viewStartYmd,
    scheduleViewKind,
  } = init

  const [viewMode, setViewMode] = useState<'request' | 'shift'>('shift')
  const [ganttWorkDate, setGanttWorkDate] = useState<string | null>(null)
  const [requestEditTarget, setRequestEditTarget] =
    useState<RequestEditTarget | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)

  useEffect(() => {
    setIsNavigating(false)
  }, [pathname, searchParams])

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
    if (!periodStart || !periodEnd) return undefined
    const overlapping = publishRows.filter(
      (p) => p.period_start <= periodEnd && p.period_end >= periodStart
    )
    const published = overlapping.find((p) => p.status === 'published')
    if (published) return published
    return overlapping[0]
  }, [periodEnd, periodStart, publishRows])

  /** 対象月に希望が1件でもある staff_id（page 取得の staff は visible・退職日なしのみ） */
  const monthsInView = useMemo(() => {
    if (columnDates.length === 0) return []
    return uniqueTargetMonthFirstsInRange(
      columnDates[0],
      columnDates[columnDates.length - 1]
    )
  }, [columnDates])

  const todayYmdJst = Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
  }).format(new Date()).slice(0, 10)
  const currentMonthFirst = `${todayYmdJst.slice(0, 7)}-01`
  const currentViewMonthFirst =
    monthsInView.length > 0
      ? monthsInView[0]!
      : columnDates.length > 0
        ? `${columnDates[0].slice(0, 7)}-01`
        : `${viewStartYmd.slice(0, 7)}-01`
  const isPrevDisabled =
    role === 'general' && currentViewMonthFirst <= currentMonthFirst
  const prevNavDisabled = isNavigating || isPrevDisabled

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

  const handleRequestCellClick = useCallback((target: RequestEditTarget) => {
    setRequestEditTarget(target)
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
    const r = await buildScheduleCsv({
      ym: ymQuery,
      attendance_location_code: settings.attendance_location_code ?? '',
    })
    if (!r.ok) {
      alert(r.error)
      return
    }
    const blob = new Blob([new Uint8Array(r.buffer)], {
      type: 'application/octet-stream',
    })
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

  const handleDelete = async (shiftId: string) => {
    const result = await deleteShiftAction(shiftId)
    if (result.error) {
      alert(result.error)
      throw new Error(result.error)
    }
    setGanttWorkDate(null)
    router.refresh()
  }

  const prevPath = buildSchedulePath(viewRange.prevStart, scheduleViewKind)
  const nextPath = buildSchedulePath(viewRange.nextStart, scheduleViewKind)

  function goMonthNav(path: string) {
    setIsNavigating(true)
    router.push(path)
  }
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
      <header className="sticky top-0 z-10 hidden border-b border-zinc-100 bg-white/95 backdrop-blur-sm shadow-sm lg:block">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex shrink-0 items-center gap-2 rounded-md bg-zinc-50 px-3 py-1">
            <span className="text-sm font-bold text-zinc-900">{storeName}</span>
            <span className="text-zinc-300" aria-hidden>
              ·
            </span>
            <span className="text-xs text-zinc-500">{staffName}</span>
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="前の期間へ"
              disabled={prevNavDisabled}
              onClick={() => goMonthNav(prevPath)}
              className={`flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors ${
                prevNavDisabled
                  ? 'pointer-events-none cursor-not-allowed opacity-40'
                  : 'hover:border-zinc-300 hover:bg-zinc-50'
              }`}
            >
              {isNavigating ? <MonthNavSpinner /> : '‹'}
            </button>
            <span className="min-w-[6rem] text-center text-sm font-semibold text-zinc-700">
              {viewRange.viewLabel}
            </span>
            <button
              type="button"
              aria-label="次の期間へ"
              disabled={isNavigating}
              onClick={() => goMonthNav(nextPath)}
              className={`flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 ${
                isNavigating ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              {isNavigating ? <MonthNavSpinner /> : '›'}
            </button>
          </div>

          <select
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 hover:border-zinc-300 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors"
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
            <div className="flex shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'request'
                    ? 'bg-slate-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-700 hover:bg-white'
                }`}
                onClick={() => setViewMode('request')}
              >
                希望
              </button>
              <button
                type="button"
                className={`border-l border-zinc-200 px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'shift'
                    ? 'bg-slate-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-700 hover:bg-white'
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
                  className={`text-xs font-medium ${
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
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    onClick={() => void onPublish()}
                  >
                    公開する
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                  onClick={() => void handleCsvExport()}
                >
                  CSVエクスポート
                </button>
              </>
            ) : null}

            <Link
              href="/request"
              className="whitespace-nowrap rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
            >
              希望シフト提出
            </Link>
            {role === 'leader' ? (
              <Link
                href="/settings"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
              >
                設定
              </Link>
            ) : null}
            {storeCount >= 2 ? (
              <Link
                href="/login/select-store"
                className="whitespace-nowrap rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
              >
                店舗切替
              </Link>
            ) : null}
            <button
              type="button"
              className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              onClick={() => void handleLogout()}
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* スマホ・タブレット（lg未満） */}
      <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/95 backdrop-blur-sm shadow-sm lg:hidden">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>

          <button
            type="button"
            aria-label="前の期間へ"
            disabled={prevNavDisabled}
            onClick={() => goMonthNav(prevPath)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors ${
              prevNavDisabled
                ? 'pointer-events-none cursor-not-allowed opacity-40'
                : 'hover:bg-zinc-50'
            }`}
          >
            {isNavigating ? <MonthNavSpinner /> : '‹'}
          </button>
          <span className="min-w-[5rem] shrink-0 whitespace-nowrap text-center text-xs font-semibold text-zinc-700">
            {viewRange.viewLabel}
          </span>
          <button
            type="button"
            aria-label="次の期間へ"
            disabled={isNavigating}
            onClick={() => goMonthNav(nextPath)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 ${
              isNavigating ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {isNavigating ? <MonthNavSpinner /> : '›'}
          </button>

          <select
            className="shrink-0 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 focus:outline-none"
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
            <div className="flex shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
              <button
                type="button"
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'request'
                    ? 'bg-slate-700 text-white'
                    : 'text-zinc-500 hover:bg-white'
                }`}
                onClick={() => setViewMode('request')}
              >
                希望
              </button>
              <button
                type="button"
                className={`border-l border-zinc-200 px-2 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'shift'
                    ? 'bg-slate-700 text-white'
                    : 'text-zinc-500 hover:bg-white'
                }`}
                onClick={() => setViewMode('shift')}
              >
                シフト
              </button>
            </div>
          ) : null}
        </div>

        {menuOpen ? (
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute left-0 top-full z-50 w-56 rounded-b-xl border border-zinc-100 bg-white py-1 shadow-xl">
              <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-bold text-zinc-900">{storeName}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{staffName}</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    aria-label="前の期間へ"
                    disabled={prevNavDisabled}
                    onClick={() => {
                      if (prevNavDisabled) return
                      goMonthNav(prevPath)
                      setMenuOpen(false)
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors ${
                      prevNavDisabled
                        ? 'pointer-events-none cursor-not-allowed opacity-40'
                        : 'hover:bg-white'
                    }`}
                  >
                    {isNavigating ? <MonthNavSpinner /> : '‹'}
                  </button>
                  <span className="min-w-[5rem] shrink-0 text-center text-xs font-semibold text-zinc-700">
                    {viewRange.viewLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="次の期間へ"
                    disabled={isNavigating}
                    onClick={() => {
                      goMonthNav(nextPath)
                      setMenuOpen(false)
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-white ${
                      isNavigating ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    {isNavigating ? <MonthNavSpinner /> : '›'}
                  </button>
                </div>
              </div>
              <Link
                href="/request"
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                希望シフト提出
              </Link>
              {role === 'leader' ? (
                <>
                  {publishStatus === 'draft' ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                      onClick={() => void onPublish()}
                    >
                      公開する
                    </button>
                  ) : (
                    <div className="px-4 py-2.5 text-sm font-medium text-emerald-600">
                      {publishLabelPc}
                    </div>
                  )}
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    設定
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
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
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  店舗切り替え
                </Link>
              ) : null}
              <hr className="my-1 border-zinc-100" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors"
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

      <main className="w-full px-4 py-6">
        <ScheduleGrid
          staff={staff}
          columnDates={columnDates}
          holidays={holidaysSet}
          mode={effectiveViewMode}
          role={role}
          patternsById={patternsById}
          shiftsKey={shiftsKey}
          requestsKey={requestsKey}
          allRequests={allRequests}
          unsubmittedStaffIds={unsubmittedStaffIds}
          storeId={session.store_id}
          onPickCell={(wd) => {
            if (effectiveViewMode === 'shift') onPickCell(wd)
          }}
          onRequestCellClick={
            role === 'leader' &&
            effectiveViewMode === 'request' &&
            publishStatus !== 'published'
              ? handleRequestCellClick
              : undefined
          }
        />

        {requestEditTarget ? (
          <RequestEditModal
            target={requestEditTarget}
            allRequests={allRequests}
            patterns={patterns}
            ganttStart={settings.gantt_start_minutes}
            ganttEnd={settings.gantt_end_minutes}
            onClose={() => setRequestEditTarget(null)}
          />
        ) : null}

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
            onDelete={handleDelete}
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
