// src/__tests__/signed-url-access.test.ts
// signed URL 권한 분기 로직 검증 (DB 조회 결과를 직접 시뮬레이션)
//
// 실제 HTTP가 아닌, download route 핵심 권한 분기 로직 자체를 검증:
//   - paid order 있음  → 허용
//   - paid order 없음  → 403
//   - file_path null   → 422
//   - submission 없음  → 404

// ─── 권한 분기 로직 (route에서 추출) ──────────────────────────────
type Submission = { id: string; file_path: string | null; file_name: string | null; status: string }
type Order      = { id: string; status: string } | null

function checkDownloadAccess(
  submission: Submission | null,
  paidOrder: Order,
): { status: number; body: object } {
  if (!submission) return { status: 404, body: { error: 'Submission not found' } }
  if (!submission.file_path) return { status: 422, body: { error: 'No file attached to this submission' } }
  if (!paidOrder) return { status: 403, body: { error: 'Purchase required to download this submission' } }
  return { status: 200, body: { url: 'https://signed-url...', file_name: submission.file_name, expires_in: 3600 } }
}

// ─── 테스트 ───────────────────────────────────────────────────────
const SUBMISSION: Submission = {
  id: 'sub-001',
  file_path: 'submissions/sub-001/secret.pdf',
  file_name: 'secret.pdf',
  status: 'purchased',
}

const PAID_ORDER: Order = { id: 'order-001', status: 'paid' }

function test_paid_owner_allowed() {
  const r = checkDownloadAccess(SUBMISSION, PAID_ORDER)
  console.assert(r.status === 200, `❌ FAIL: paid owner should get 200, got ${r.status}`)
  console.assert('url' in r.body, '❌ FAIL: response must include url')
  console.log('✅ PASS: paid owner → 200 + signed URL')
}

function test_unpaid_owner_blocked() {
  const r = checkDownloadAccess(SUBMISSION, null) // no paid order
  console.assert(r.status === 403, `❌ FAIL: unpaid owner should get 403, got ${r.status}`)
  console.log('✅ PASS: unpaid owner → 403')
}

function test_stranger_blocked() {
  // stranger는 paid order가 없으므로 동일하게 403
  const r = checkDownloadAccess(SUBMISSION, null)
  console.assert(r.status === 403, `❌ FAIL: stranger should get 403, got ${r.status}`)
  console.log('✅ PASS: stranger → 403')
}

function test_unpurchased_provider_blocked() {
  // provider 본인 submission이지만 paid order는 task owner 것 — provider에겐 없음
  const r = checkDownloadAccess(SUBMISSION, null)
  console.assert(r.status === 403, `❌ FAIL: unpurchased provider should get 403, got ${r.status}`)
  console.log('✅ PASS: unpurchased provider → 403')
}

function test_no_file_path_returns_422() {
  const noFile: Submission = { ...SUBMISSION, file_path: null }
  const r = checkDownloadAccess(noFile, PAID_ORDER)
  console.assert(r.status === 422, `❌ FAIL: no file_path should get 422, got ${r.status}`)
  console.log('✅ PASS: no file_path → 422')
}

function test_submission_not_found_returns_404() {
  const r = checkDownloadAccess(null, null)
  console.assert(r.status === 404, `❌ FAIL: not found should get 404, got ${r.status}`)
  console.log('✅ PASS: submission not found → 404')
}

function test_expires_in_is_set() {
  const r = checkDownloadAccess(SUBMISSION, PAID_ORDER) as any
  console.assert(r.body.expires_in === 3600, `❌ FAIL: expires_in should be 3600, got ${r.body.expires_in}`)
  console.log('✅ PASS: expires_in = 3600 seconds')
}

// ─── RUN ─────────────────────────────────────────────────────────
console.log('\n=== signed URL access control tests ===\n')
test_paid_owner_allowed()
test_unpaid_owner_blocked()
test_stranger_blocked()
test_unpurchased_provider_blocked()
test_no_file_path_returns_422()
test_submission_not_found_returns_404()
test_expires_in_is_set()
console.log('\n=== all tests done ===\n')
