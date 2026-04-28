'use client'

import type { ShiftPattern } from '@/types/database'
import { minutesToDisplay } from '@/lib/time'

export type Tone = 'sat' | 'sunh' | 'plain'

export type RowVals = {
  mode: 'pattern' | 'free' | 'off' | 'custom'
  patternId: string | null
  customStart: number | null
  customEnd: number | null
}

type Props = {
  dateYmd: string
  labelText: string
  tone: Tone
  patterns: ShiftPattern[]
  halfOpts: number[]
  disabled: boolean
  row: RowVals
  onChangeMode: (next: RowVals) => void
}

function selectValueFromRow(r: RowVals): string {
  if (r.mode === 'pattern' && r.patternId) return `p:${r.patternId}`
  if (r.mode === 'free') return 'free'
  if (r.mode === 'off') return 'off'
  return 'custom'
}

export function RequestDateRow({
  dateYmd,
  labelText,
  tone,
  patterns,
  halfOpts,
  disabled,
  row,
  onChangeMode,
}: Props) {
  const bg =
    tone === 'sat'
      ? 'bg-sky-50'
      : tone === 'sunh'
        ? 'bg-rose-50'
        : 'bg-white'

  const sel = selectValueFromRow(row)

  function onSelectChange(v: string) {
    if (v.startsWith('p:')) {
      onChangeMode({
        mode: 'pattern',
        patternId: v.slice(2),
        customStart: null,
        customEnd: null,
      })
      return
    }
    if (v === 'free') {
      onChangeMode({
        mode: 'free',
        patternId: null,
        customStart: null,
        customEnd: null,
      })
      return
    }
    if (v === 'off') {
      onChangeMode({
        mode: 'off',
        patternId: null,
        customStart: null,
        customEnd: null,
      })
      return
    }
    onChangeMode({
      mode: 'custom',
      patternId: null,
      customStart: row.customStart ?? halfOpts[0] ?? null,
      customEnd: row.customEnd ?? halfOpts[Math.min(1, halfOpts.length - 1)] ?? null,
    })
  }

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2 border-b border-zinc-100 py-3 ${bg}`}
    >
      <div className="flex min-h-11 items-center pl-1 text-sm text-zinc-900">
        {labelText}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="sr-only" htmlFor={`req-${dateYmd}`}>
          {labelText}
        </label>
        <select
          id={`req-${dateYmd}`}
          className="min-h-11 min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-base font-medium text-slate-800"
          disabled={disabled}
          value={
            sel === 'custom' && !halfOpts.length
              ? patterns[0]
                ? `p:${patterns[0].shift_pattern_id}`
                : 'off'
              : sel
          }
          onChange={(e) => onSelectChange(e.target.value)}
        >
          <optgroup label="パターン">
            {patterns.length === 0 ? (
              <option value="_none" disabled>
                （パターン未登録）
              </option>
            ) : (
              patterns.map((p) => (
                <option
                  key={p.shift_pattern_id}
                  value={`p:${p.shift_pattern_id}`}
                >
                  {p.pattern_name}
                </option>
              ))
            )}
          </optgroup>
          <option value="free">F（終日）</option>
          <option value="off">×（休み）</option>
          <option value="custom" disabled={!halfOpts.length}>
            その他（時間入力）
          </option>
        </select>

        {row.mode === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-zinc-600">開始</label>
            <select
              className="min-h-11 min-w-[7rem] rounded-lg border border-zinc-300 bg-white px-2 py-2 text-base font-medium text-slate-800"
              disabled={disabled}
              value={row.customStart ?? ''}
              onChange={(e) =>
                onChangeMode({
                  ...row,
                  customStart:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {halfOpts.map((m) => (
                <option key={`s-${dateYmd}-${m}`} value={m}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">〜</span>
            <label className="text-zinc-600">終了</label>
            <select
              className="min-h-11 min-w-[7rem] rounded-lg border border-zinc-300 bg-white px-2 py-2 text-base font-medium text-slate-800"
              disabled={disabled}
              value={row.customEnd ?? ''}
              onChange={(e) =>
                onChangeMode({
                  ...row,
                  customEnd:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {halfOpts.map((m) => (
                <option key={`e-${dateYmd}-${m}`} value={m}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  )
}

