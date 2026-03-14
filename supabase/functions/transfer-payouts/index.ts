/**
 * transfer-payouts Edge Function
 *
 * 매일 03:00 UTC (pg_cron 또는 Supabase Dashboard에서 호출)
 *
 * 동작:
 *   1. payouts WHERE status = 'released' 조회
 *   2. 각 payout의 agent.stripe_account_id 확인
 *   3. Stripe Transfer 생성 (플랫폼 → Connect 계좌)
 *   4. payout.status = 'transferred', stripe_transfer_id, transferred_at 저장
 *
 * 실패 처리:
 *   - 개별 payout 실패 시 skip하고 로그 기록 (다음 실행 때 재시도)
 *   - stripe_account_id 없으면 skip (hold 상태로 남음 — payout_guard 트리거가 처리)
 */

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-02-25.clover',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  // POST only (cron 또는 수동 트리거)
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results: { payout_id: string; status: 'ok' | 'skip' | 'error'; detail?: string }[] = []

  // 1. released payouts 조회 (agent join)
  const { data: payouts, error: fetchError } = await supabase
    .from('payouts')
    .select(`
      id,
      order_id,
      agent_id,
      amount,
      agents!inner (
        stripe_account_id,
        stripe_onboarding_completed
      )
    `)
    .eq('status', 'released')

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!payouts || payouts.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No released payouts found', results: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 2. 각 payout 처리
  for (const payout of payouts) {
    const agent = payout.agents as { stripe_account_id: string | null; stripe_onboarding_completed: boolean }

    // stripe 계좌 없거나 온보딩 미완료 → skip
    if (!agent?.stripe_account_id || !agent?.stripe_onboarding_completed) {
      results.push({ payout_id: payout.id, status: 'skip', detail: 'No connected Stripe account' })
      continue
    }

    try {
      // 3. Stripe Transfer 생성
      const transfer = await stripe.transfers.create({
        amount: payout.amount,
        currency: 'krw',
        destination: agent.stripe_account_id,
        metadata: {
          payout_id: payout.id,
          order_id: payout.order_id,
          agent_id: payout.agent_id,
        },
      })

      // 4. payout 업데이트
      const { error: updateError } = await supabase
        .from('payouts')
        .update({
          status: 'transferred',
          stripe_transfer_id: transfer.id,
          transferred_at: new Date().toISOString(),
        })
        .eq('id', payout.id)
        .eq('status', 'released') // 동시 실행 방지

      if (updateError) {
        results.push({ payout_id: payout.id, status: 'error', detail: updateError.message })
      } else {
        results.push({ payout_id: payout.id, status: 'ok', detail: transfer.id })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ payout_id: payout.id, status: 'error', detail: msg })
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    skip: results.filter((r) => r.status === 'skip').length,
    error: results.filter((r) => r.status === 'error').length,
  }

  return new Response(JSON.stringify({ summary, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
