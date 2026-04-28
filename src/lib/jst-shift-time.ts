/** work_date の東京 0:00 からの経過分数 → ISO（timestamptz） */
export function workDateMinutesToIso(workDate: string, minutesFromMidnight: number): string {
  const base = Date.parse(`${workDate}T00:00:00+09:00`)
  return new Date(base + minutesFromMidnight * 60_000).toISOString()
}

/** ISO を work_date の JST 0:00 基準の分数に（深夜帯の長いシフトにも対応） */
export function isoToMinutesFromWorkDateMidnight(iso: string, workDate: string): number {
  const base = Date.parse(`${workDate}T00:00:00+09:00`)
  return Math.round((new Date(iso).getTime() - base) / 60_000)
}

export function formatJstHHmm(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

/** 確定セル表示: shift_pattern_name が無いとき HH:MM-HH:MM（先頭の 0 は可能なら省略しないで統一） */
export function formatShiftTimeRangeCompact(startIso: string, endIso: string, workDate: string): string {
  const s = isoToMinutesFromWorkDateMidnight(startIso, workDate)
  const e = isoToMinutesFromWorkDateMidnight(endIso, workDate)
  const sh = Math.floor(s / 60)
  const sm = s % 60
  const eh = Math.floor(e / 60)
  const em = e % 60
  const startStr = `${sh}${sm === 0 ? '' : `:${String(sm).padStart(2, '0')}`}`
  const endStr = `${eh}${em === 0 ? '' : `:${String(em).padStart(2, '0')}`}`
  /* ドキュメント例 18-255 に近い簡潔表記（分があるときはコロン付き） */
  return `${startStr}-${endStr}`
}

/** ガント用: ドラッグ後の分数（30分刻み） */
export function snapMinutes(m: number, step: number): number {
  return Math.round(m / step) * step
}
