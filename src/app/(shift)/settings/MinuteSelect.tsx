'use client'

import { minutesToDisplay } from '@/lib/time'
import { listSettingsHalfHourMinutes } from '@/lib/settings-minute-options'

const OPTIONS = listSettingsHalfHourMinutes()

function snapToGrid(m: number): number {
  const s = Math.round(m / 30) * 30
  const max = OPTIONS[OPTIONS.length - 1] ?? 2850
  return Math.min(max, Math.max(0, s))
}

type Props = {
  value: number
  onChange: (minutes: number) => void
  disabled?: boolean
  id?: string
  className?: string
}

export function MinuteSelect({
  value,
  onChange,
  disabled,
  id,
  className = 'min-h-10 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm',
}: Props) {
  return (
    <select
      id={id}
      className={className}
      disabled={disabled}
      value={
        OPTIONS.includes(value) ? value : snapToGrid(value)
      }
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {OPTIONS.map((m) => (
        <option key={m} value={m}>
          {minutesToDisplay(m)}
        </option>
      ))}
    </select>
  )
}
