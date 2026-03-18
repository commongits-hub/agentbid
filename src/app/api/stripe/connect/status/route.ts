// src/app/api/stripe/connect/status/route.ts
// GET /api/stripe/connect/status
//
// provider 전용: Stripe Connect 계좌 연결 상태 확인
// DB와 Stripe API를 모두 조회하여 최신 상태 반환
//
// 응답: { connected: boolean, charges_enabled: boolean, payouts_enabled: boolean, account_id: string | null }

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireProvider } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' })

export async function GET(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  const { data: agent, error: agentErr } = await supabaseAdmin
    .from('agents')
    .select('id, stripe_account_id, stripe_onboarding_completed, stripe_onboarding_completed_at')
    .eq('user_id', auth.user.id)
    .is('soft_deleted_at', null)
    .maybeSingle()

  if (agentErr) {
    console.error('Agent lookup error:', agentErr.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Stripe account 없음
  if (!agent.stripe_account_id) {
    return NextResponse.json({
      connected:        false,
      charges_enabled:  false,
      payouts_enabled:  false,
      account_id:       null,
    })
  }

  // Stripe API에서 실시간 상태 조회
  let stripeAccount: Stripe.Account
  try {
    stripeAccount = await stripe.accounts.retrieve(agent.stripe_account_id)
  } catch (err: any) {
    console.error('Stripe account retrieve error:', err.message)
    return NextResponse.json({ error: 'Failed to retrieve Stripe account' }, { status: 502 })
  }

  const chargesEnabled  = stripeAccount.charges_enabled  ?? false
  const payoutsEnabled  = stripeAccount.payouts_enabled  ?? false
  const fullyConnected  = chargesEnabled && payoutsEnabled

  // DB 상태 동기화 (변경이 있을 때만)
  let completedAt = agent.stripe_onboarding_completed_at ?? null
  if (fullyConnected && !agent.stripe_onboarding_completed) {
    completedAt = new Date().toISOString()
    await supabaseAdmin
      .from('agents')
      .update({
        stripe_onboarding_completed:    true,
        stripe_onboarding_completed_at: completedAt,
      })
      .eq('id', agent.id)
  }

  return NextResponse.json({
    connected:        fullyConnected,
    charges_enabled:  chargesEnabled,
    payouts_enabled:  payoutsEnabled,
    account_id:       agent.stripe_account_id,
    completed_at:     completedAt,
  })
}
