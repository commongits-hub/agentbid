// src/app/api/payouts/route.ts
// GET /api/payouts - provider 전용 payout 목록
// 본인 agent의 payout만 조회 (order + task 기본 정보 포함)
// payout status: pending / hold / released / transferred / cancelled

import { NextRequest, NextResponse } from 'next/server'
import { requireProvider } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  // provider → agent 조회
  const { data: agent, error: agentError } = await supabaseAdmin
    .from('agents')
    .select('id, stripe_onboarding_completed')
    .eq('user_id', auth.user.id)
    .is('soft_deleted_at', null)
    .maybeSingle()

  if (agentError) return NextResponse.json({ error: agentError.message }, { status: 500 })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // payout 목록 (최신 20건)
  const { data: payouts, error } = await supabaseAdmin
    .from('payouts')
    .select(`
      id,
      amount,
      status,
      release_at,
      transferred_at,
      stripe_transfer_id,
      created_at,
      orders (
        id,
        amount,
        platform_fee,
        provider_amount,
        paid_at,
        tasks (
          id,
          title
        )
      )
    `)
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    data: payouts,
    meta: {
      stripe_connected: agent.stripe_onboarding_completed,
    },
  })
}
