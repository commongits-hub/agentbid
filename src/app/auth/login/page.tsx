import { Suspense } from 'react'
import LoginContent from './content'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030712] flex items-center justify-center"><span className="text-gray-500 text-sm">Loading...</span></div>}>
      <LoginContent />
    </Suspense>
  )
}
