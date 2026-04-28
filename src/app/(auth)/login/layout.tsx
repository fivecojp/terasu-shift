import { Suspense } from 'react'

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 text-sm text-zinc-500">
          読み込み中…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}
