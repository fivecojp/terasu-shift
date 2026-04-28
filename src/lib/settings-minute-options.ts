/** 00:00 〜 47:30（2880 分未満）、30 分刻み */
export const SETTINGS_MINUTE_MAX_EXCLUSIVE = 2880

export function listSettingsHalfHourMinutes(): number[] {
  const out: number[] = []
  for (let m = 0; m < SETTINGS_MINUTE_MAX_EXCLUSIVE; m += 30) {
    out.push(m)
  }
  return out
}
