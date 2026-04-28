import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  SESSION_COOKIE_NAME,
  encodeSessionToken,
  homePathForRole,
  type SessionMembership,
} from '@/lib/session-token'

type MembershipRow = {
  store_id: string
  role: 'general' | 'leader'
  stores?: { store_name: string } | { store_name: string }[] | null
}

function storeNameFromMembership(r: MembershipRow): string {
  const s = r.stores
  if (!s) return '店舗'
  const one = Array.isArray(s) ? s[0] : s
  return one?.store_name?.trim() || '店舗'
}

export async function POST(request: Request) {
  let body: { staff_email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawEmail = body.staff_email?.trim()
  const password = body.password
  if (!rawEmail || !password) {
    return NextResponse.json(
      { error: 'メールアドレスとパスワードを入力してください' },
      { status: 400 }
    )
  }

  const staff_email = rawEmail.toLowerCase()

  const supabase = createServiceClient()

  const { data: staff, error: staffError } = await supabase
    .from('staffs')
    .select(
      'staff_id, staff_name, staff_email, staff_password_hash, leave_date'
    )
    .eq('staff_email', staff_email)
    .maybeSingle()

  if (staffError || !staff) {
    return NextResponse.json(
      { error: 'メールアドレスまたはパスワードが正しくありません' },
      { status: 401 }
    )
  }

  if (staff.leave_date) {
    return NextResponse.json(
      { error: '退職済みのアカウントはログインできません' },
      { status: 403 }
    )
  }

  console.log('email:', staff_email)
  console.log('hash from DB:', staff.staff_password_hash)
  console.log('password input:', password)

  const valid = await bcrypt.compare(password, staff.staff_password_hash)
  console.log('bcrypt result:', valid)

  if (!valid) {
    return NextResponse.json(
      { error: 'メールアドレスまたはパスワードが正しくありません' },
      { status: 401 }
    )
  }

  const { data: rows, error: memError } = await supabase
    .from('memberships')
    .select('store_id, role, stores(store_name)')
    .eq('staff_id', staff.staff_id)

  if (memError || !rows?.length) {
    return NextResponse.json(
      { error: '店舗への所属がありません' },
      { status: 403 }
    )
  }

  const typed = rows as unknown as MembershipRow[]
  const memberships: SessionMembership[] = typed.map((r) => ({
    store_id: r.store_id,
    role: r.role,
  }))

  const active_store_id: string | null =
    memberships.length === 1 ? memberships[0].store_id : null

  const token = await encodeSessionToken({
    staff_id: staff.staff_id,
    staff_name: staff.staff_name,
    memberships,
    active_store_id,
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  const store_ids = memberships.map((m) => m.store_id)
  const stores = typed.map((r) => ({
    store_id: r.store_id,
    role: r.role,
    store_name: storeNameFromMembership(r),
  }))

  let redirect: string
  if (active_store_id) {
    const role = memberships[0].role
    redirect = homePathForRole(role)
  } else {
    redirect = '/login/select-store'
  }

  return NextResponse.json({
    ok: true,
    redirect,
    store_ids,
    stores,
  })
}
