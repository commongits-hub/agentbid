// src/app/onboarding/stripe/page.tsx
// Stripe Connect Express 온보딩 페이지 (provider 전용)

import { Suspense } from 'react'
import StripeOnboardingContent from './content'

export default function StripeOnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">로딩 중...</div>}>
      <StripeOnboardingContent />
    </Suspense>
  )
}
