import type {
  Shift,
  ShiftPattern,
  ShiftPublishStatus,
  ShiftRequest,
  ShiftSetting,
} from '@/types/database'

export type StaffRow = {
  staff_id: string
  staff_name: string
  staff_number: number
  display_order: number
}

export type RequestEditTarget = {
  staffId: string
  staffName: string
  workDate: string // YYYY-MM-DD
  storeId: string
}

export type SchedulePageData = {
  storeName: string
  staff: StaffRow[]
  settings: ShiftSetting
  patterns: ShiftPattern[]
  shifts: Shift[]
  requests: ShiftRequest[]
  publishRows: ShiftPublishStatus[]
  holidays: { holiday_date: string }[]
  targetMonthFirst: string
  ymQuery: string
}

export function buildKeyedRequests(
  rows: ShiftRequest[]
): Map<string, ShiftRequest> {
  const m = new Map<string, ShiftRequest>()
  for (const r of rows) {
    m.set(`${r.staff_id}|${r.work_date}`, r)
  }
  return m
}

export function buildKeyedShifts(rows: Shift[]): Map<string, Shift> {
  const m = new Map<string, Shift>()
  for (const r of rows) {
    m.set(`${r.staff_id}|${r.work_date}`, r)
  }
  return m
}
