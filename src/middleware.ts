import { type NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, decodeSessionToken } from '@/lib/session-token'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const payload = token ? await decodeSessionToken(token) : null

  if (pathname.startsWith('/login/select-store')) {
    if (!payload) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    // ログイン済みなら active_store_id の有無にかかわらず店舗選択（切り替え）を許可
    return NextResponse.next()
  }

  if (!payload) {
    const login = new URL('/login', request.url)
    login.searchParams.set('from', pathname)
    return NextResponse.redirect(login)
  }

  if (!payload.active_store_id) {
    return NextResponse.redirect(new URL('/login/select-store', request.url))
  }

  const m = payload.memberships.find(
    (x) => x.store_id === payload.active_store_id
  )
  if (!m) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (
    (pathname.startsWith('/schedule') || pathname.startsWith('/settings')) &&
    m.role === 'general'
  ) {
    return NextResponse.redirect(new URL('/request', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/request',
    '/request/:path*',
    '/schedule',
    '/schedule/:path*',
    '/settings',
    '/settings/:path*',
    '/login/select-store',
  ],
}
