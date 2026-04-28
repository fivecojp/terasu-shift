/**
 * POST /api/auth/logout（セッション削除）のあと /login へ遷移
 */
export async function logoutAndRedirectToLogin(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  window.location.assign('/login')
}
