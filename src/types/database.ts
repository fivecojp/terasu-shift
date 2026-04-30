export type ShiftPattern = {
  shift_pattern_id: string
  store_id: string
  pattern_name: string
  start_minutes: number
  end_minutes: number
  display_order: number
  is_active: boolean
}

export type ShiftRequest = {
  shift_request_id: string
  store_id: string
  staff_id: string
  work_date: string // 'YYYY-MM-DD'
  target_month: string // 'YYYY-MM-01'
  period_type: 'first_half' | 'second_half' | 'full'
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null
  custom_start_minutes: number | null
  custom_end_minutes: number | null
  submitted_at: string
}

export type ShiftPublishStatus = {
  publish_status_id: string
  store_id: string
  period_start: string // 'YYYY-MM-DD'
  period_end: string // 'YYYY-MM-DD'
  status: 'draft' | 'published'
  published_at: string | null
  published_by_staff_id: string | null
  created_at: string
}

export type ShiftSetting = {
  store_id: string
  gantt_start_minutes: number
  gantt_end_minutes: number
  shift_cycle: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  week_start_day: 'mon' | 'sun'
  deadline_type: 'days_before' | 'weeks_before' | 'months_before'
  deadline_value: number
  csv_format_type: string | null
  show_requests_to_general: boolean
  attendance_location_code: string | null
  updated_at: string
}

// 既存テーブル（参照のみ・変更禁止）
export type Staff = {
  staff_id: string
  company_id: string
  staff_name: string
  staff_email: string | null
  staff_password_hash: string
  join_date: string
  leave_date: string | null
  birth_date: string
  staff_note: string | null
  staff_number: number
}

export type Membership = {
  store_id: string
  staff_id: string
  display_status: 'visible' | 'hidden'
  role: 'general' | 'leader'
  display_order: number
}

export type Shift = {
  shift_id: string
  store_id: string
  staff_id: string
  work_date: string
  shift_pattern_name: string | null // 既存カラム・後方互換
  scheduled_start_at: string // timestamptz
  scheduled_end_at: string // timestamptz
  attendance_mark: 'late' | 'left_early' | 'absent' | null
  shift_change_mark: boolean
  shift_pattern_id: string | null // 追加カラム
}
