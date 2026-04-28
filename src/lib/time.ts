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
