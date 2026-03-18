// src/app/onboarding/stripe/page.tsx
// Stripe Connect Express onboarding page (provider only)

import { Suspense } from 'react'
import StripeOnboardingContent from './content'

export default function StripeOnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <StripeOnboardingContent />
    </Suspense>
  )
}
