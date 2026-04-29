export function minutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function displayToMinutes(display: string): number {
  const [h, m] = display.split(':').map(Number)
  return h * 60 + m
}

export function minutesToPosition(
  minutes: number,
  ganttStart: number,
  ganttEnd: number
): number {
  return ((minutes - ganttStart) / (ganttEnd - ganttStart)) * 100
}

/**
 * 分数を短縮表示文字列に変換する（希望シフト「その他」用）
 * 例: 1080 → '18'  / 1110 → '18.5' / 1500 → '25' / 1530 → '25.5'
 */
export function minutesToShort(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return String(h)
  if (m === 30) return `${h}.5`
  // 30分刻み以外は HH:MM 形式にフォールバック
  return minutesToDisplay(minutes)
}
