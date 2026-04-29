'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shift, ShiftPattern, ShiftRequest } from '@/types/database'
import { formatShiftTimeRangeCompact } from '@/lib/jst-shift-time'
import { minutesToShort } from '@/lib/time'
import type { StaffRow } from '@/app/(shift)/schedule/types'

export type RequestSummary = {
  staff_id: string
  work_date: string
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null
  custom_start_minutes: number | null
  custom_end_minutes: number | null
}

type Props = {
  staff: StaffRow[]
  columnDates: string[]
  holidays: Set<string>
  mode: 'request' | 'shift'
  role: 'general' | 'leader'
  patternsById: Map<string, ShiftPattern>
  shiftsKey: Map<string, Shift>
  requestsKey: Map<string, ShiftRequest>
  allRequests: RequestSummary[]
  unsubmittedStaffIds: Set<string>
  onPickCell: (workDate: string) => void
}

const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

function labelDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${m}/${d}\n(${WD[dt.getDay()]})`
}

function requestLabel(
  r: ShiftRequest,
  patterns: Map<string, ShiftPattern>
): string {
  switch (r.request_type) {
    case 'pattern': {
      const p = r.shift_pattern_id
        ? patterns.get(r.shift_pattern_id)
        : undefined
      return p?.pattern_name ?? '-'
    }
    case 'free':
      return 'F'
    case 'off':
      return '×'
    case 'custom': {
      const cs = r.custom_start_minutes
      const ce = r.custom_end_minutes
      if (cs !== null && ce !== null) {
        return `${minutesToShort(cs)}-${minutesToShort(ce)}`
      }
      return '他'
    }
    default:
      return ''
  }
}

function requestShort(
  r: ShiftRequest,
  patterns: Map<string, ShiftPattern>
): string {
  if (r.request_type === 'free') return 'F'
  if (r.request_type === 'off') return '×'
  if (r.request_type === 'pattern') {
    return patterns.get(r.shift_pattern_id ?? '')?.pattern_name ?? '?'
  }
  if (r.request_type === 'custom') {
    const cs = r.custom_start_minutes
    const ce = r.custom_end_minutes
    if (cs !== null && ce !== null) {
      return `${minutesToShort(cs)}-${minutesToShort(ce)}`
    }
    return '他'
  }
  return '他'
}

function formatRequestLabel(
  req: RequestSummary,
  patterns: ShiftPattern[]
): string {
  if (req.request_type === 'off') return '休み'
  if (req.request_type === 'free') return '出勤可'
  if (req.request_type === 'pattern') {
    const p = patterns.find(
      (x) => x.shift_pattern_id === req.shift_pattern_id
    )
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

export function ScheduleGrid({
  staff,
  columnDates,
  holidays,
  mode,
  role,
  patternsById,
  shiftsKey,
  requestsKey,
  allRequests,
  unsubmittedStaffIds,
  onPickCell,
}: Props) {
  const todayStr = new Date().toLocaleDateString('sv-SE')
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayColIndex = columnDates.indexOf(todayStr)
  const [openRibbonKey, setOpenRibbonKey] = useState<string | null>(null)
  const [requestConfirm, setRequestConfirm] = useState<{
    staffId: string
    staffName: string
    date: string
    label: string
  } | null>(null)

  const requestMap = useMemo(() => {
    const m = new Map<string, RequestSummary>()
    for (const r of allRequests) {
      m.set(`${r.staff_id}_${r.work_date}`, r)
    }
    return m
  }, [allRequests])

  const patternsList = useMemo(
    () => [...patternsById.values()],
    [patternsById]
  )

  const toggleRibbon = useCallback((key: string) => {
    setOpenRibbonKey((prev) => (prev === key ? null : key))
  }, [])

  const handleDateHeaderClick = useCallback(
    (date: string) => {
      if (role !== 'leader' || mode !== 'shift') return
      onPickCell(date)
    },
    [mode, onPickCell, role]
  )

  const handleShiftCellClick = useCallback(
    (staffId: string, staffName: string, date: string) => {
      if (role !== 'leader') return
      const key = `${staffId}_${date}`
      const req = requestMap.get(key)
      if (req) {
        setRequestConfirm({
          staffId,
          staffName,
          date,
          label: formatRequestLabel(req, patternsList),
        })
      } else {
        onPickCell(date)
      }
    },
    [onPickCell, patternsList, requestMap, role]
  )

  useEffect(() => {
    if (openRibbonKey === null) return
    function handleDocPointerDown(ev: PointerEvent | MouseEvent) {
      const t = ev.target
      if (!(t instanceof Element)) return
      const hit = t.closest('[data-request-ribbon]')
      if (hit?.getAttribute('data-request-ribbon') === openRibbonKey) return
      setOpenRibbonKey(null)
    }
    document.addEventListener('pointerdown', handleDocPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', handleDocPointerDown, true)
  }, [openRibbonKey])

  useEffect(() => {
    if (scrollRef.current === null || todayColIndex < 0) return
    const container = scrollRef.current
    const STAFF_COL_WIDTH = 128 // スタッフ列幅(px) 8rem想定
    const DATE_COL_WIDTH = 44 // 日付列幅(px) 2.75rem想定
    const todayLeft = STAFF_COL_WIDTH + todayColIndex * DATE_COL_WIDTH
    const containerWidth = container.clientWidth
    const targetScrollLeft = todayLeft - containerWidth / 2 + DATE_COL_WIDTH / 2
    container.scrollLeft = Math.max(0, targetScrollLeft)
  }, [columnDates, todayColIndex])

  return (
    <>
    <div ref={scrollRef} className="w-full overflow-x-auto rounded-lg border border-zinc-200 shadow-sm">
      <div className="w-full min-w-fit">
        <table
          className="w-full border-collapse text-sm"
          style={{
            minWidth: `${120 + columnDates.length * 44}px`,
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            <col style={{ width: '8rem', minWidth: '8rem', maxWidth: '12rem' }} />
            {columnDates.map((d) => (
              <col key={d} style={{ width: '2.75rem', minWidth: '2.75rem' }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-zinc-200"
                style={{ willChange: 'transform' }}
              >
                スタッフ
              </th>
              {columnDates.map((d) => {
                const [y, mo, day] = d.split('-').map(Number)
                const dt = new Date(y, mo - 1, day)
                const dow = dt.getDay()
                const hol = holidays.has(d)
                const isToday = d === todayStr
                const tone = isToday
                  ? 'bg-slate-700 text-white font-bold'
                  : dow === 6
                    ? 'bg-sky-50 text-sky-700'
                    : dow === 0 || hol
                      ? 'bg-rose-50 text-rose-600'
                      : 'bg-zinc-50 text-zinc-600'
                const headerClickable =
                  role === 'leader' && mode === 'shift'
                    ? `cursor-pointer transition-colors ${
                        isToday
                          ? 'hover:bg-slate-600'
                          : 'hover:bg-slate-100'
                      }`
                    : ''
                return (
                  <th
                    key={d}
                    className={`sticky top-0 z-20 border-b border-r border-zinc-100 px-1 py-1.5 text-center text-xs font-medium whitespace-pre-line ${tone} ${headerClickable}`}
                    style={{ willChange: 'transform' }}
                    onClick={
                      role === 'leader' && mode === 'shift'
                        ? () => handleDateHeaderClick(d)
                        : undefined
                    }
                  >
                    {labelDate(d)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map((s, rowIdx) => (
              <tr
                key={s.staff_id}
                className={rowIdx % 2 === 1 ? 'bg-zinc-50/50' : 'bg-white'}
              >
                <td
                  className={`sticky left-0 z-10 whitespace-nowrap border-b border-r border-zinc-200 px-3 py-2 text-sm font-medium shadow-[1px_0_0_0_#e4e4e7] ${
                    unsubmittedStaffIds.has(s.staff_id)
                      ? 'border-l-2 border-l-amber-400 bg-amber-50 text-amber-800'
                      : rowIdx % 2 === 1
                        ? 'bg-zinc-50/50 text-zinc-900'
                        : 'bg-white text-zinc-900'
                  }`}
                  style={{ willChange: 'transform' }}
                >
                  {s.staff_name}
                </td>
                {columnDates.map((d) => {
                  const k = `${s.staff_id}|${d}`
                  const req = requestsKey.get(k)
                  const sh = shiftsKey.get(k)
                  const ribbonKey = `${s.staff_id}_${d}`
                  const summaryReq = requestMap.get(ribbonKey)
                  const showReq = mode === 'request'
                  const cellInteractive =
                    role === 'leader' && mode === 'shift'

                  return (
                    <td
                      key={`${s.staff_id}_${d}`}
                      className={`relative border-b border-r border-zinc-100 px-1 py-1 text-center align-middle text-xs ${
                        cellInteractive
                          ? 'cursor-pointer hover:bg-zinc-50'
                          : 'cursor-default'
                      }`}
                      onClick={
                        cellInteractive
                          ? () =>
                              handleShiftCellClick(s.staff_id, s.staff_name, d)
                          : undefined
                      }
                      title={
                        showReq && req
                          ? `希望: ${requestLabel(req, patternsById)}`
                          : undefined
                      }
                    >
                      {summaryReq && summaryReq.request_type !== 'off' ? (
                        <div
                          className="group absolute right-0 top-0 z-10"
                          data-request-ribbon={ribbonKey}
                        >
                          <button
                            type="button"
                            aria-expanded={openRibbonKey === ribbonKey}
                            aria-label="希望の内容を表示"
                            className="block border-0 bg-transparent p-0 leading-none"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleRibbon(ribbonKey)
                            }}
                          >
                            <span
                              className="block h-0 w-0 border-l-[10px] border-t-[10px] border-l-transparent border-t-emerald-400 cursor-pointer"
                              aria-hidden
                            />
                          </button>
                          <div
                            className={`pointer-events-none absolute right-0 top-3 z-50 rounded border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap text-zinc-700 shadow-md ${
                              openRibbonKey === ribbonKey
                                ? 'block'
                                : 'hidden group-focus-within:block group-hover:block'
                            }`}
                          >
                            <span className="mr-1 text-[10px] text-zinc-400">
                              希望:
                            </span>
                            {formatRequestLabel(summaryReq, patternsList)}
                          </div>
                        </div>
                      ) : null}
                      {showReq ? (
                        req ? (
                          req.request_type === 'free' ? (
                            <span className="inline-block rounded bg-pink-50 px-1 text-xs font-medium text-pink-600">
                              F
                            </span>
                          ) : req.request_type === 'off' ? (
                            <span className="text-xs text-zinc-400">×</span>
                          ) : (
                            <span className="text-xs text-zinc-500">
                              {requestShort(req, patternsById)}
                            </span>
                          )
                        ) : null
                      ) : sh ? (
                        <span
                          className={
                            sh.shift_pattern_name?.trim()
                              ? 'text-xs font-medium text-slate-700'
                              : 'text-xs text-slate-600'
                          }
                        >
                          {sh.shift_pattern_name?.trim()
                            ? sh.shift_pattern_name
                            : formatShiftTimeRangeCompact(
                                sh.scheduled_start_at,
                                sh.scheduled_end_at,
                                d
                              )}
                        </span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {requestConfirm ? (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
        onClick={() => setRequestConfirm(null)}
      >
        <div
          className="mx-4 w-full max-w-xs rounded-lg border border-zinc-200 bg-white p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 text-sm font-medium text-zinc-700">
            {requestConfirm.staffName}
          </div>
          <div className="mb-3 text-xs text-zinc-400">
            {requestConfirm.date} の希望シフト
          </div>
          <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {requestConfirm.label}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-md border border-zinc-200 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              onClick={() => setRequestConfirm(null)}
            >
              閉じる
            </button>
            <button
              type="button"
              className="flex-1 rounded-md bg-slate-700 py-2 text-sm text-white transition-colors hover:bg-slate-800"
              onClick={() => {
                onPickCell(requestConfirm.date)
                setRequestConfirm(null)
              }}
            >
              シフトを編集
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}
