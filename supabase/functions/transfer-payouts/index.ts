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

  // 호출자 검증 — x-cron-secret 헤더로 인증
  // ⚠️ 배포 시 Supabase Edge Function env에 CRON_SECRET 반드시 설정
  //   cron/수동 호출 측도 x-cron-secret 헤더 포함 필요
  //   둘 중 하나 빠지면 즉시 401 반환
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret) {
    const incoming = req.headers.get('x-cron-secret')
    if (incoming !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
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

    // stripe 계좌 없거나 온보딩 미완료 → skip (사유 분리)
    if (!agent?.stripe_account_id) {
      results.push({ payout_id: payout.id, status: 'skip', detail: 'No Stripe account' })
      continue
    }
    if (!agent?.stripe_onboarding_completed) {
      results.push({ payout_id: payout.id, status: 'skip', detail: 'Stripe onboarding incomplete' })
      continue
    }

    try {
      // 3. Stripe Transfer 생성 (idempotency key로 중복 transfer 방지)
      const transfer = await stripe.transfers.create({
        amount: payout.amount,
        currency: 'krw',
        destination: agent.stripe_account_id,
        metadata: {
          payout_id: payout.id,
          order_id: payout.order_id,
          agent_id: payout.agent_id,
        },
      }, {
        idempotencyKey: `payout:${payout.id}`,
      })

      // 4. payout 업데이트
      const { error: updateError, count } = await supabase
        .from('payouts')
        .update({
          status: 'transferred',
          stripe_transfer_id: transfer.id,
          transferred_at: new Date().toISOString(),
        }, { count: 'exact' })
        .eq('id', payout.id)
        .eq('status', 'released') // 동시 실행 방지

      if (updateError) {
        results.push({ payout_id: payout.id, status: 'error', detail: updateError.message })
        continue
      }

      // 0 rows: status='released' 조건 미충족 → 이미 처리됐을 가능성 확인
      // Stripe idempotency key 덕분에 transfer는 중복 생성 안 됐지만
      // DB가 'transferred'로 이미 반영된 경우라면 ok로 처리해야 error 반복 방지
      if (count === 0) {
        const { data: current } = await supabase
          .from('payouts')
          .select('status, stripe_transfer_id')
          .eq('id', payout.id)
          .single()

        if (current?.status === 'transferred' && current?.stripe_transfer_id === transfer.id) {
          // 이미 반영됨 — 중복 처리 없이 ok로 마킹
          results.push({ payout_id: payout.id, status: 'ok', detail: `already transferred: ${transfer.id}` })
        } else {
          results.push({ payout_id: payout.id, status: 'error', detail: `update 0 rows — current status: ${current?.status ?? 'unknown'}` })
        }
        continue
      }

      results.push({ payout_id: payout.id, status: 'ok', detail: transfer.id })
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
