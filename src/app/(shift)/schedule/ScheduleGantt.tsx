'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  displayToMinutes,
  minutesToDisplay,
  minutesToPosition,
} from '@/lib/time'

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
  onDelete: (shiftId: string) => Promise<void>
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

type TapEditModal = {
  staffId: string
  staffName: string
  initStartMin: number | null
  initEndMin: number | null
  shiftId: string | null
}

type TapEditFormProps = {
  modal: TapEditModal
  patternsById: Map<string, ShiftPattern>
  ganttStart: number
  ganttEnd: number
  onSave: (staffId: string, startMin: number, endMin: number) => Promise<void>
  onClose: () => void
  onDelete: (shiftId: string) => Promise<void>
}

function TapEditForm({
  modal,
  patternsById,
  ganttStart,
  ganttEnd,
  onSave,
  onClose,
  onDelete,
}: TapEditFormProps) {
  const patterns = useMemo(
    () => Array.from(patternsById.values()).filter((p) => p.is_active),
    [patternsById]
  )

  const [mode, setMode] = useState<'pattern' | 'time'>(
    patterns.length > 0 ? 'pattern' : 'time'
  )
  const [startInput, setStartInput] = useState(
    modal.initStartMin !== null ? minutesToDisplay(modal.initStartMin) : ''
  )
  const [endInput, setEndInput] = useState(
    modal.initEndMin !== null ? minutesToDisplay(modal.initEndMin) : ''
  )
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const timeOptions = useMemo(() => {
    const opts: string[] = []
    for (let m = ganttStart; m <= ganttEnd; m += 30) {
      opts.push(minutesToDisplay(m))
    }
    return opts
  }, [ganttStart, ganttEnd])

  const handlePatternSave = async (p: ShiftPattern) => {
    setSaving(true)
    await onSave(modal.staffId, p.start_minutes, p.end_minutes)
    setSaving(false)
    onClose()
  }

  const handleTimeSave = async () => {
    const s = displayToMinutes(startInput)
    const e = displayToMinutes(endInput)
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return
    setSaving(true)
    await onSave(modal.staffId, s, e)
    setSaving(false)
    onClose()
  }

  const deleteFooterClass =
    'border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-md px-4 py-2 text-sm transition-colors'
  const secondaryFooterClass =
    'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded-md px-4 py-2 text-sm'

  const handleConfirmDelete = async () => {
    const sid = modal.shiftId
    if (!sid) return
    setIsDeleting(true)
    try {
      await onDelete(sid)
      setShowDeleteConfirm(false)
      onClose()
    } catch {
      /* 親が alert 済み */
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-800">{modal.staffName}</div>
        <button
          type="button"
          onClick={onClose}
          className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
        >
          ×
        </button>
      </div>

      {patterns.length > 0 && (
        <div className="mb-4 flex overflow-hidden rounded-md border border-zinc-200 text-sm">
          <button
            type="button"
            className={`flex-1 py-2 transition-colors ${
              mode === 'pattern'
                ? 'bg-slate-700 text-white'
                : 'text-zinc-600 hover:bg-zinc-50'
            }`}
            onClick={() => setMode('pattern')}
          >
            パターン
          </button>
          <button
            type="button"
            className={`flex-1 py-2 transition-colors ${
              mode === 'time'
                ? 'bg-slate-700 text-white'
                : 'text-zinc-600 hover:bg-zinc-50'
            }`}
            onClick={() => setMode('time')}
          >
            時間指定
          </button>
        </div>
      )}

      {mode === 'pattern' && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          {patterns.map((p) => (
            <button
              type="button"
              key={p.shift_pattern_id}
              disabled={saving || isDeleting}
              className="rounded-md border border-zinc-200 py-2 text-sm text-zinc-700 transition-colors hover:border-slate-700 hover:bg-slate-700 hover:text-white disabled:opacity-50"
              onClick={() => handlePatternSave(p)}
            >
              <div>{p.pattern_name}</div>
              <div className="text-[10px] opacity-70">
                {minutesToDisplay(p.start_minutes)}–
                {minutesToDisplay(p.end_minutes)}
              </div>
            </button>
          ))}
        </div>
      )}

      {mode === 'time' && (
        <div className="mb-4 flex items-center gap-2">
          <select
            className="flex-1 rounded-md border border-zinc-200 px-2 py-2 text-sm"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
          >
            <option value="">開始</option>
            {timeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-sm text-zinc-400">〜</span>
          <select
            className="flex-1 rounded-md border border-zinc-200 px-2 py-2 text-sm"
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
          >
            <option value="">終了</option>
            {timeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {modal.shiftId ? (
            <button
              type="button"
              className={deleteFooterClass}
              disabled={saving || isDeleting}
              onClick={() => setShowDeleteConfirm(true)}
            >
              削除
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={secondaryFooterClass}
            disabled={saving || isDeleting}
            onClick={onClose}
          >
            キャンセル
          </button>
          {mode === 'time' ? (
            <button
              type="button"
              disabled={saving || isDeleting || !startInput || !endInput}
              className="rounded-md bg-slate-700 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleTimeSave()}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          ) : null}
        </div>
      </div>

      {showDeleteConfirm ? (
        <div
          className="fixed inset-0 z-[210] flex items-start justify-center bg-black/40 pt-40"
          role="dialog"
          aria-modal
          aria-labelledby="tap-delete-confirm-title"
          onClick={() => {
            if (!isDeleting) setShowDeleteConfirm(false)
          }}
        >
          <div
            className="mx-auto mt-0 w-80 rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="tap-delete-confirm-title"
              className="font-medium text-zinc-900"
            >
              シフトを削除しますか？
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              この操作は取り消せません。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className={`${secondaryFooterClass} transition-colors`}
                disabled={isDeleting}
                onClick={() => setShowDeleteConfirm(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="rounded-md bg-rose-600 px-4 py-2 text-sm text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
              >
                {isDeleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ScheduleGantt({
  workDate,
  staffLines,
  settings,
  shiftByStaff,
  requestByStaff,
  patternsById,
  onSave,
  onDelete,
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

  /** PC: バー上 mousedown 後に mousemove が一度でもあると true（クリックとドラッグの区別） */
  const pcBarPointerMovedRef = useRef(false)

  const [isTouchDevice, setIsTouchDevice] = useState(false)
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  const [tapModal, setTapModal] = useState<TapEditModal | null>(null)

  const [pcPatternPopover, setPcPatternPopover] = useState<{
    staffId: string
    workDate: string
    x: number
    y: number
  } | null>(null)
  const pcPatternPopoverRef = useRef<HTMLDivElement | null>(null)

  const activePatterns = useMemo(
    () => Array.from(patternsById.values()).filter((p) => p.is_active),
    [patternsById]
  )

  const [pcDeleteTarget, setPcDeleteTarget] = useState<{
    shiftId: string
    staffName: string
  } | null>(null)
  const [isPcDeleting, setIsPcDeleting] = useState(false)

  useEffect(() => {
    setPcPatternPopover(null)
  }, [workDate])

  useEffect(() => {
    if (!pcPatternPopover) return
    const handler = (ev: MouseEvent) => {
      const root = pcPatternPopoverRef.current
      if (root?.contains(ev.target as Node)) return
      setPcPatternPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pcPatternPopover])

  useEffect(() => {
    if (pcPatternPopover) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [pcPatternPopover])

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
    pcBarPointerMovedRef.current = false
    const dur = Math.max(endMin - startMin, MIN_DURATION_MIN)
    const startMid = (startMin + endMin) / 2

    function onMove(me: MouseEvent) {
      pcBarPointerMovedRef.current = true
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
        if (!isTouchDevice && !pcBarPointerMovedRef.current) {
          const shRow = shiftByStaff.get(fin.staffId)
          const delId = shRow?.shift_id
          if (delId) {
            const line = staffLines.find((u) => u.staff_id === fin.staffId)
            setPcDeleteTarget({
              shiftId: delId,
              staffName: line?.staff_name ?? '',
            })
            return
          }
        }
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
    pcBarPointerMovedRef.current = false

    function onMove(me: MouseEvent) {
      pcBarPointerMovedRef.current = true
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
        if (!isTouchDevice && !pcBarPointerMovedRef.current) {
          const shRow = shiftByStaff.get(fin.staffId)
          const delId = shRow?.shift_id
          if (delId) {
            const line = staffLines.find((u) => u.staff_id === fin.staffId)
            setPcDeleteTarget({
              shiftId: delId,
              staffName: line?.staff_name ?? '',
            })
            return
          }
        }
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
    pcBarPointerMovedRef.current = false

    function onMove(me: MouseEvent) {
      pcBarPointerMovedRef.current = true
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
        if (!isTouchDevice && !pcBarPointerMovedRef.current) {
          const shRow = shiftByStaff.get(fin.staffId)
          const delId = shRow?.shift_id
          if (delId) {
            const line = staffLines.find((u) => u.staff_id === fin.staffId)
            setPcDeleteTarget({
              shiftId: delId,
              staffName: line?.staff_name ?? '',
            })
            return
          }
        }
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

  async function handlePcDeleteConfirm() {
    const t = pcDeleteTarget
    if (!t) return
    setIsPcDeleting(true)
    try {
      await onDelete(t.shiftId)
      setPcDeleteTarget(null)
    } catch {
      /* 親が alert 済み */
    } finally {
      setIsPcDeleting(false)
    }
  }

  async function handlePcPatternPick(pattern: ShiftPattern) {
    const pop = pcPatternPopover
    if (!pop) return
    await onSave(pop.staffId, pattern.start_minutes, pattern.end_minutes)
    setPcPatternPopover(null)
  }

  return (
    <>
    <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-zinc-900">タイムライン</h2>
        <span className="text-sm font-semibold text-zinc-800">{workDate}</span>
        <span className="text-xs text-zinc-400 hidden sm:inline">
          確定シフト: ドラッグで移動・端でリサイズ　未登録: クリックでパターン登録
        </span>
      </div>
      <div className="px-4 pt-0 pb-0">
        <div className="grid grid-cols-[minmax(140px,180px),minmax(0,1fr)] items-end gap-2">
          <div aria-hidden className="min-h-0" />
          <div className="relative h-6 border-b border-zinc-200 bg-zinc-50">
            {hourTicks.map((tick) => (
              <span
                key={tick.minutes}
                className="absolute top-0 -translate-x-1/2 text-[10px] text-zinc-600 select-none"
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
              className="grid grid-cols-[minmax(140px,180px),minmax(0,1fr)] items-center gap-x-2 border-b border-zinc-100 py-0 last:border-b-0"
            >
              <div className="truncate text-sm font-medium text-zinc-900 flex items-center">
                {s.staff_name}
              </div>
              <div
                ref={(el) => setTrack(s.staff_id, el)}
                role="presentation"
                className="relative h-10 cursor-default bg-white"
                onMouseDown={(e) => {
                  if (isTouchDevice) return
                  const t = e.target as HTMLElement | null
                  if (t?.closest('[data-shift-bar]')) return
                  pcBarPointerMovedRef.current = false
                }}
                onClick={(e) => {
                  if (isTouchDevice) {
                    e.stopPropagation()
                    const existing = shiftByStaff.get(s.staff_id)
                    setTapModal({
                      staffId: s.staff_id,
                      staffName: s.staff_name,
                      initStartMin: existing
                        ? isoToMinutesFromWorkDateMidnight(
                            existing.scheduled_start_at,
                            workDate
                          )
                        : null,
                      initEndMin: existing?.scheduled_end_at
                        ? isoToMinutesFromWorkDateMidnight(
                            existing.scheduled_end_at,
                            workDate
                          )
                        : null,
                      shiftId: existing?.shift_id ?? null,
                    })
                    return
                  }
                  const tg = e.target as HTMLElement | null
                  if (tg?.closest('[data-shift-bar]')) return
                  if (pcBarPointerMovedRef.current) return
                  if (shiftByStaff.has(s.staff_id)) return
                  const POPOVER_W = 220
                  const POPOVER_H = Math.min(
                    activePatterns.length * 44 + 88,
                    400
                  )
                  const x = Math.min(
                    e.clientX,
                    window.innerWidth - POPOVER_W - 8
                  )
                  const y = Math.min(
                    e.clientY,
                    window.innerHeight - POPOVER_H - 8
                  )
                  setPcPatternPopover({
                    staffId: s.staff_id,
                    workDate,
                    x,
                    y,
                  })
                }}
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
                    data-shift-bar
                    className={`absolute top-1 bottom-1 flex overflow-hidden rounded ${barBg}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(widthPct, 0)}%`,
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      if (!isTouchDevice) return
                      const existing = shiftByStaff.get(s.staff_id)
                      setTapModal({
                        staffId: s.staff_id,
                        staffName: s.staff_name,
                        initStartMin: existing
                          ? isoToMinutesFromWorkDateMidnight(
                              existing.scheduled_start_at,
                              workDate
                            )
                          : null,
                        initEndMin: existing?.scheduled_end_at
                          ? isoToMinutesFromWorkDateMidnight(
                              existing.scheduled_end_at,
                              workDate
                            )
                          : null,
                        shiftId: existing?.shift_id ?? null,
                      })
                    }}
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
                      className={`flex min-w-[20px] flex-1 cursor-grab items-center justify-center overflow-hidden px-0.5 text-center text-xs font-medium leading-tight whitespace-nowrap active:cursor-grabbing ${barBg} ${barText}`}
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

    {pcPatternPopover && !isTouchDevice ? (
      <div
        ref={pcPatternPopoverRef}
        className="fixed z-[150] bg-white rounded-lg border border-zinc-200 shadow-lg p-3 min-w-[12rem] max-h-[400px] overflow-y-auto"
        style={{ left: pcPatternPopover.x, top: pcPatternPopover.y }}
        role="dialog"
        aria-labelledby="pc-pattern-popover-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          id="pc-pattern-popover-title"
          className="mb-2 text-xs font-medium text-zinc-500"
        >
          パターンを選択
        </div>
        {activePatterns.length === 0 ? (
          <p className="text-sm text-zinc-600">パターンが登録されていません</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {activePatterns.map((p) => (
              <button
                key={p.shift_pattern_id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 rounded-md"
                onClick={() => void handlePcPatternPick(p)}
              >
                {p.pattern_name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-50 rounded-md border-t border-zinc-100 mt-1"
          onClick={() => setPcPatternPopover(null)}
        >
          キャンセル
        </button>
      </div>
    ) : null}

    {tapModal && isTouchDevice && (
      <div
        className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 sm:items-center"
        onClick={() => setTapModal(null)}
      >
        <div
          className="w-full rounded-t-2xl border border-zinc-200 bg-white p-5 pb-8 shadow-xl sm:max-w-sm sm:rounded-xl sm:pb-5"
          onClick={(e) => e.stopPropagation()}
        >
          <TapEditForm
            key={`${tapModal.staffId}-${tapModal.shiftId ?? 'new'}-${tapModal.initStartMin ?? 's'}-${tapModal.initEndMin ?? 'e'}`}
            modal={tapModal}
            patternsById={patternsById}
            ganttStart={settings.gantt_start_minutes}
            ganttEnd={settings.gantt_end_minutes}
            onSave={onSave}
            onClose={() => setTapModal(null)}
            onDelete={onDelete}
          />
        </div>
      </div>
    )}

    {pcDeleteTarget ? (
      <div
        className="fixed inset-0 z-[210] flex items-start justify-center bg-black/40 pt-40"
        role="dialog"
        aria-modal
        aria-labelledby="pc-delete-confirm-title"
        onClick={() => {
          if (!isPcDeleting) setPcDeleteTarget(null)
        }}
      >
        <div
          className="mx-auto mt-0 w-80 rounded-xl bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3
            id="pc-delete-confirm-title"
            className="font-medium text-zinc-900"
          >
            シフトを削除しますか？
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            この操作は取り消せません。
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              disabled={isPcDeleting}
              onClick={() => setPcDeleteTarget(null)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="rounded-md bg-rose-600 px-4 py-2 text-sm text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPcDeleting}
              onClick={() => void handlePcDeleteConfirm()}
            >
              {isPcDeleting ? '削除中...' : '削除する'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}
