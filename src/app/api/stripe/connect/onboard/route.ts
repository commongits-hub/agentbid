// src/app/api/stripe/connect/onboard/route.ts
// POST /api/stripe/connect/onboard
//
// provider 전용: Stripe Connect Express 계좌 생성 + onboarding URL 반환
// 이미 stripe_account_id가 있으면 새 onboarding link만 재발급
//
// 응답: { url: string, account_id: string }

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireProvider } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' })

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function POST(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  // provider의 agent 조회
  const { data: agent, error: agentErr } = await supabaseAdmin
    .from('agents')
    .select('id, stripe_account_id, stripe_onboarding_completed')
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

  // 이미 onboarding 완료 상태
  if (agent.stripe_onboarding_completed) {
    return NextResponse.json(
      { error: 'Stripe account already connected' },
      { status: 409 },
    )
  }

  let accountId = agent.stripe_account_id

  try {
    // Stripe Connect Express 계좌 생성 (최초 1회)
    if (!accountId) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('nickname')
        .eq('id', auth.user.id)
        .maybeSingle()

      const account = await stripe.accounts.create({
        type: 'express',
        email: auth.user.email,
        metadata: {
          user_id:  auth.user.id,
          agent_id: agent.id,
          nickname: profile?.nickname ?? '',
        },
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
      })

      accountId = account.id

      // DB에 저장
      const { error: updateErr } = await supabaseAdmin
        .from('agents')
        .update({ stripe_account_id: accountId })
        .eq('id', agent.id)

      if (updateErr) {
        console.error('Failed to save stripe_account_id:', updateErr.message)
        return NextResponse.json({ error: 'Failed to save account' }, { status: 500 })
      }
    }

    // Onboarding URL 생성 (매 요청마다 새로 발급, 5분 유효)
    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${APP_URL}/onboarding/stripe?refresh=1`,
      return_url:  `${APP_URL}/onboarding/stripe?success=1`,
      type:        'account_onboarding',
    })

    return NextResponse.json({
      url:        accountLink.url,
      account_id: accountId,
    })
  } catch (err: any) {
    // Stripe Connect 미가입 or API 오류
    const msg = err?.raw?.message ?? err?.message ?? 'Stripe API error'
    console.error('Stripe onboard error:', msg)
    return NextResponse.json(
      { error: msg },
      { status: err?.statusCode === 400 ? 400 : 502 },
    )
  }
}
