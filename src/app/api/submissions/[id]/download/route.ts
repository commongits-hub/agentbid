// src/app/api/submissions/[id]/download/route.ts
// GET /api/submissions/:id/download
//
// paid user만 Supabase Storage signed URL 발급
// 차단 대상: unpaid task owner, stranger, 비구매 provider
//
// 보안:
//   1. requireAuth → JWT 검증
//   2. orders 테이블에서 status='paid' 확인 (service_role)
//   3. paid 확인 후 Storage signed URL 발급 (1시간 만료)
//   4. 응답은 URL만 반환 — 파일 스트리밍 X (Storage CDN이 처리)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const SIGNED_URL_EXPIRES_IN = 3600 // 1시간 (초)

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. 인증
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  const { id: submissionId } = await params

  // 2. submission 조회 (service_role: RLS 우회, file_path 확인)
  const { data: submission, error: subErr } = await supabaseAdmin
    .from('submissions')
    .select('id, task_id, file_path, file_name, status')
    .eq('id', submissionId)
    .is('soft_deleted_at', null)
    .single()

  if (subErr || !submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }

  if (!submission.file_path) {
    return NextResponse.json({ error: 'No file attached to this submission' }, { status: 422 })
  }

  // 2-B. submission 상태 가드: purchased 상태만 다운로드 허용
  // paid order가 있더라도 상태가 비정상이면 차단
  if (submission.status !== 'purchased') {
    return NextResponse.json(
      { error: 'Submission is not available for download' },
      { status: 422 },
    )
  }

  // 3. 결제 확인: 이 submission에 대해 caller가 paid order를 보유하는지
  const { data: paidOrder } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('submission_id', submissionId)
    .eq('user_id', auth.user.id)
    .eq('status', 'paid')
    .maybeSingle()

  if (!paidOrder) {
    // paid order 없음 → 차단
    // stranger, unpaid owner, 비구매 provider 모두 여기서 막힘
    return NextResponse.json(
      { error: 'Purchase required to download this submission' },
      { status: 403 },
    )
  }

  // 4. Storage signed URL 발급 (bucket: 'submission-files')
  const { data: urlData, error: urlErr } = await supabaseAdmin.storage
    .from('submission-files')
    .createSignedUrl(submission.file_path, SIGNED_URL_EXPIRES_IN)

  if (urlErr || !urlData?.signedUrl) {
    console.error('Storage signed URL error:', urlErr?.message)
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    url: urlData.signedUrl,
    file_name: submission.file_name,
    expires_in: SIGNED_URL_EXPIRES_IN,
  })
}
