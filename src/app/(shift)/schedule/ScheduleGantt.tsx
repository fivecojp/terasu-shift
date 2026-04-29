'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  Shift,
  ShiftPattern,
  ShiftRequest,
  ShiftSetting,
} from '@/types/database'
import {
  isoToMinutesFromWorkDateMidnight,
  snapMinutes,
} from '@/lib/jst-shift-time'
import { minutesToDisplay, minutesToPosition } from '@/lib/time'

export type StaffLine = {
  staff_id: string
  staff_name: string
}

type Props = {
  workDate: string
  staffLines: StaffLine[]
  settings: ShiftSetting
  shiftByStaff: Map<string, Shift>
  requestByStaff: Map<string, ShiftRequest>
  patternsById: Map<string, ShiftPattern>
  onSave: (
    staffId: string,
    startMin: number,
    endMin: number
  ) => Promise<void>
}

function shiftEndMissing(sh: Shift): boolean {
  const end = sh.scheduled_end_at as string | null | undefined
  return end == null || String(end).trim() === ''
}

function barLabelText(
  sh: Shift | undefined,
  lo: number,
  hi: number | null
): string {
  const name = sh?.shift_pattern_name?.trim()
  if (name) return name
  if (hi !== null && hi > lo) {
    return `${minutesToDisplay(lo)}–${minutesToDisplay(hi)}`
  }
  return minutesToDisplay(lo)
}

const MIN_DURATION_MIN = 30
const HANDLE_CLASS =
  'relative z-[2] w-2 shrink-0 cursor-ew-resize select-none rounded-sm bg-slate-800 opacity-60 hover:opacity-100'

function pctLeft(lo: number, gs: number, ge: number) {
  const sp = ge - gs
  if (sp <= 0) return 0
  return ((lo - gs) / sp) * 100
}

function pctWidth(lo: number, hi: number, gs: number, ge: number) {
  const sp = ge - gs
  if (sp <= 0) return 0
  return Math.max(((hi - lo) / sp) * 100, 0.4)
}

export function ScheduleGantt({
  workDate,
  staffLines,
  settings,
  shiftByStaff,
  requestByStaff,
  patternsById,
  onSave,
}: Props) {
  const gs = settings.gantt_start_minutes
  const ge = settings.gantt_end_minutes
  const span = ge - gs

  const hourTicks = useMemo(() => {
    if (ge <= gs) return []
    const ticks: { minutes: number; label: string; left: string }[] = []
    const firstHour = Math.ceil(gs / 60) * 60
    for (let m = firstHour; m <= ge; m += 60) {
      const left = ((m - gs) / (ge - gs)) * 100
      ticks.push({
        minutes: m,
        label: minutesToDisplay(m),
        left: `${left}%`,
      })
    }
    return ticks
  }, [gs, ge])

  const halfHourTicks = useMemo(() => {
    if (ge <= gs) return []
    const ticks: { minutes: number; left: string }[] = []
    const firstHalf = Math.ceil(gs / 30) * 30
    for (let m = firstHalf; m <= ge; m += 30) {
      if (m % 60 === 0) continue
      const left = ((m - gs) / (ge - gs)) * 100
      ticks.push({ minutes: m, left: `${left}%` })
    }
    return ticks
  }, [gs, ge])

  const tracks = useRef<Map<string, HTMLDivElement>>(new Map())
  const setTrack = (id: string, el: HTMLDivElement | null) => {
    if (el) tracks.current.set(id, el)
    else tracks.current.delete(id)
  }

  const [live, setLive] = useState<Map<string, { s: number; e: number }>>(
    () => new Map()
  )
  const [committed, setCommitted] = useState<Map<string, { s: number; e: number }>>(
    () => new Map()
  )

  const lastDrag = useRef<{ staffId: string; s: number; e: number } | null>(
    null
  )

  const minuteFromClientX = useCallback(
    (staffId: string, clientX: number) => {
      const tel = tracks.current.get(staffId)
      if (!tel || span <= 0) return gs
      const r = tel.getBoundingClientRect()
      const pct = Math.max(
        0,
        Math.min(1, (clientX - r.left) / r.width)
      )
      return snapMinutes(gs + pct * span, 30)
    },
    [gs, span]
  )

  const rangeFor = useCallback(
    (sid: string, sh: Shift | undefined) => {
      const l = live.get(sid)
      if (l) return { lo: l.s, hi: l.e, endMissing: false }
      const c = committed.get(sid)
      if (c) return { lo: c.s, hi: c.e, endMissing: false }
      if (!sh)
        return {
          lo: null as number | null,
          hi: null as number | null,
          endMissing: false,
        }
      const lo = isoToMinutesFromWorkDateMidnight(
        sh.scheduled_start_at,
        workDate
      )
      if (shiftEndMissing(sh)) {
        return { lo, hi: null as number | null, endMissing: true }
      }
      const hi = isoToMinutesFromWorkDateMidnight(
        sh.scheduled_end_at,
        workDate
      )
      return { lo, hi, endMissing: false }
    },
    [live, committed, workDate]
  )

  /** 中央ドラッグ: バーごと平行移動 */
  const startMoveDrag = (
    staffId: string,
    startMin: number,
    endMin: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (!tracks.current.get(staffId) || span <= 0) return
    const dur = Math.max(endMin - startMin, MIN_DURATION_MIN)
    const startMid = (startMin + endMin) / 2

    function onMove(me: MouseEvent) {
      const tel = tracks.current.get(staffId)
      if (!tel) return
      const r = tel.getBoundingClientRect()
      const curMid = gs + ((me.clientX - r.left) / r.width) * span
      const delta = snapMinutes(curMid - startMid, 30)
      let ns = snapMinutes(startMin + delta, 30)
      let ne = ns + dur
      if (ns < gs) {
        ns = gs
        ne = ns + dur
      }
      if (ne > ge) {
        ne = ge
        ns = Math.max(gs, ne - dur)
      }
      lastDrag.current = { staffId, s: ns, e: ne }
      setLive((m) => new Map(m).set(staffId, { s: ns, e: ne }))
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const fin = lastDrag.current
      lastDrag.current = null
      setLive((m) => {
        const n = new Map(m)
        n.delete(staffId)
        return n
      })
      if (fin && fin.e - fin.s >= MIN_DURATION_MIN) {
        setCommitted((m) => new Map(m).set(fin.staffId, { s: fin.s, e: fin.e }))
        void onSave(fin.staffId, fin.s, fin.e).finally(() => {
          setCommitted((m) => {
            const n = new Map(m)
            n.delete(fin.staffId)
            return n
          })
        })
      }
    }

    lastDrag.current = { staffId, s: startMin, e: endMin }
    setLive((m) => new Map(m).set(staffId, { s: startMin, e: endMin }))
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /** 左端リサイズ: 開始のみ変更（終了は維持） */
  const startResizeLeft = (
    staffId: string,
    startMin: number,
    endMin: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (!tracks.current.get(staffId)) return

    function onMove(me: MouseEvent) {
      let ns = minuteFromClientX(staffId, me.clientX)
      const maxStart = endMin - MIN_DURATION_MIN
      ns = Math.min(ns, maxStart)
      ns = Math.max(gs, ns)
      ns = snapMinutes(ns, 30)
      lastDrag.current = { staffId, s: ns, e: endMin }
      setLive((m) => new Map(m).set(staffId, { s: ns, e: endMin }))
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const fin = lastDrag.current
      lastDrag.current = null
      setLive((m) => {
        const n = new Map(m)
        n.delete(staffId)
        return n
      })
      if (fin && fin.e - fin.s >= MIN_DURATION_MIN) {
        setCommitted((m) => new Map(m).set(fin.staffId, { s: fin.s, e: fin.e }))
        void onSave(fin.staffId, fin.s, fin.e).finally(() => {
          setCommitted((m) => {
            const n = new Map(m)
            n.delete(fin.staffId)
            return n
          })
        })
      }
    }

    lastDrag.current = { staffId, s: startMin, e: endMin }
    setLive((m) => new Map(m).set(staffId, { s: startMin, e: endMin }))
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /** 右端リサイズ: 終了のみ変更 */
  const startResizeRight = (
    staffId: string,
    startMin: number,
    endMin: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (!tracks.current.get(staffId)) return

    function onMove(me: MouseEvent) {
      let ne = minuteFromClientX(staffId, me.clientX)
      const minEnd = startMin + MIN_DURATION_MIN
      ne = Math.max(ne, minEnd)
      ne = Math.min(ge, ne)
      ne = snapMinutes(ne, 30)
      lastDrag.current = { staffId, s: startMin, e: ne }
      setLive((m) => new Map(m).set(staffId, { s: startMin, e: ne }))
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const fin = lastDrag.current
      lastDrag.current = null
      setLive((m) => {
        const n = new Map(m)
        n.delete(staffId)
        return n
      })
      if (fin && fin.e - fin.s >= MIN_DURATION_MIN) {
        setCommitted((m) => new Map(m).set(fin.staffId, { s: fin.s, e: fin.e }))
        void onSave(fin.staffId, fin.s, fin.e).finally(() => {
          setCommitted((m) => {
            const n = new Map(m)
            n.delete(fin.staffId)
            return n
          })
        })
      }
    }

    lastDrag.current = { staffId, s: startMin, e: endMin }
    setLive((m) => new Map(m).set(staffId, { s: startMin, e: endMin }))
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const clickEmpty = (staffId: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (shiftByStaff.has(staffId)) return
    if (e.target !== e.currentTarget) return
    const el = tracks.current.get(staffId)
    if (!el) return
    const r = el.getBoundingClientRect()
    const mid = gs + ((e.clientX - r.left) / r.width) * span
    const ns = snapMinutes(mid - 90, 30)
    const ne = Math.min(ge, ns + 180)
    if (ne > ns && ne - ns >= MIN_DURATION_MIN) {
      setCommitted((m) => new Map(m).set(staffId, { s: ns, e: ne }))
      void onSave(staffId, ns, ne).finally(() => {
        setCommitted((m) => {
          const n = new Map(m)
          n.delete(staffId)
          return n
        })
      })
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-zinc-900">タイムライン</h2>
        <span className="text-xs text-zinc-400">{workDate}</span>
        <span className="text-xs text-zinc-400 hidden sm:inline">
          確定シフト: ドラッグで移動・端でリサイズ　未登録: クリックで仮登録
        </span>
      </div>
      <div className="px-4 py-2">
        <div className="grid grid-cols-[minmax(140px,180px),minmax(0,1fr)] items-end gap-2">
          <div aria-hidden className="min-h-6" />
          <div className="relative h-6 border-b border-zinc-200 bg-zinc-50">
            {hourTicks.map((tick) => (
              <span
                key={tick.minutes}
                className="absolute top-0 -translate-x-1/2 text-[10px] text-zinc-400 select-none"
                style={{ left: tick.left }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        {staffLines.map((s) => {
          const sh = shiftByStaff.get(s.staff_id)
          const { lo, hi, endMissing } = rangeFor(s.staff_id, sh)
          const hiForDrag =
            lo !== null ? (hi ?? lo + MIN_DURATION_MIN) : null

          let leftPct = 0
          let widthPct = 0
          let showShiftBar = false
          if (
            lo !== null &&
            hiForDrag !== null &&
            hiForDrag > lo &&
            span > 0
          ) {
            if (endMissing) {
              leftPct = minutesToPosition(lo, gs, ge)
              widthPct = 2
              showShiftBar = true
            } else if (hi !== null && hi > lo) {
              leftPct = minutesToPosition(lo, gs, ge)
              widthPct = minutesToPosition(hi, gs, ge) - leftPct
              showShiftBar = widthPct > 0
            }
          }

          const barBg = endMissing ? 'bg-zinc-400' : 'bg-slate-600'
          const barText = endMissing ? 'text-zinc-900' : 'text-white'
          const labelText =
            lo !== null ? barLabelText(sh, lo, hi) : ''
          const titleFull =
            lo !== null && hi !== null && hi > lo
              ? `${minutesToDisplay(lo)}〜${minutesToDisplay(hi)}`
              : lo !== null
                ? `${minutesToDisplay(lo)}〜`
                : ''

          const req = requestByStaff.get(s.staff_id)
          let rqLo: number | null = null
          let rqHi: number | null = null
          if (req) {
            if (req.request_type === 'pattern') {
              const p = req.shift_pattern_id
                ? patternsById.get(req.shift_pattern_id)
                : undefined
              if (p) {
                rqLo = p.start_minutes
                rqHi = p.end_minutes
              }
            } else if (req.request_type === 'custom') {
              rqLo = req.custom_start_minutes ?? gs
              rqHi = req.custom_end_minutes ?? rqLo + 60
            } else if (req.request_type === 'free') {
              rqLo = gs
              rqHi = ge
            }
          }

          return (
            <div
              key={s.staff_id}
              className="grid grid-cols-[minmax(140px,180px),minmax(0,1fr)] items-center gap-2 border-b border-zinc-100 py-1.5 last:border-b-0"
            >
              <div className="truncate text-sm font-medium text-zinc-900">
                {s.staff_name}
              </div>
              <div
                ref={(el) => setTrack(s.staff_id, el)}
                role="presentation"
                className="relative h-10 cursor-default bg-white"
                onClick={(e) => clickEmpty(s.staff_id, e)}
              >
                {hourTicks.map((tick) => (
                  <div
                    key={tick.minutes}
                    className="pointer-events-none absolute top-0 bottom-0 z-0 w-px bg-zinc-100"
                    style={{ left: tick.left }}
                  />
                ))}
                {halfHourTicks.map((tick) => (
                  <div
                    key={`half-${tick.minutes}`}
                    className="pointer-events-none absolute top-0 bottom-0 z-0 w-px bg-zinc-50"
                    style={{ left: tick.left }}
                  />
                ))}
                {rqLo !== null && rqHi !== null && rqHi > rqLo ? (
                  <div
                    className="pointer-events-none absolute top-1 bottom-1 rounded bg-slate-200"
                    style={{
                      left: `${pctLeft(rqLo, gs, ge)}%`,
                      width: `${pctWidth(rqLo, rqHi, gs, ge)}%`,
                    }}
                  />
                ) : null}

                {showShiftBar ? (
                  <div
                    className={`absolute top-1 bottom-1 flex overflow-hidden rounded ${barBg}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(widthPct, 0)}%`,
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    role="presentation"
                  >
                    <div
                      className={HANDLE_CLASS}
                      onMouseDown={(ev) =>
                        startResizeLeft(
                          s.staff_id,
                          lo as number,
                          hiForDrag as number,
                          ev
                        )
                      }
                      title="開始を変更"
                    />
                    <div
                      className={`flex min-w-[20px] flex-1 cursor-grab items-center justify-center overflow-hidden px-0.5 text-center text-[10px] font-medium leading-tight whitespace-nowrap active:cursor-grabbing ${barBg} ${barText}`}
                      title={titleFull}
                      onMouseDown={(ev) =>
                        startMoveDrag(
                          s.staff_id,
                          lo as number,
                          hiForDrag as number,
                          ev
                        )
                      }
                    >
                      <span
                        className={`truncate ${
                          widthPct < 5 ? 'invisible' : ''
                        }`}
                      >
                        {labelText}
                      </span>
                    </div>
                    <div
                      className={HANDLE_CLASS}
                      onMouseDown={(ev) =>
                        startResizeRight(
                          s.staff_id,
                          lo as number,
                          hiForDrag as number,
                          ev
                        )
                      }
                      title="終了を変更"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
