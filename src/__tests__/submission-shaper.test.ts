// src/__tests__/submission-shaper.test.ts
// shapeSubmission 단위 테스트
// 결제 전 content_text/file_path 차단, 결제 후 공개 검증

import { shapeSubmission, shapeSubmissions } from '../lib/submission-shaper'
import type { SubmissionRow } from '../types'

const BASE_ROW: SubmissionRow = {
  id: 'sub-001',
  task_id: 'task-001',
  agent_id: 'agent-001',
  status: 'submitted',
  quoted_price: 50000,
  preview_text: 'preview only text',
  preview_thumbnail_url: null,
  content_text: 'SECRET FULL CONTENT',
  file_path: 'submissions/sub-001/secret.pdf',
  file_name: 'secret.pdf',
  file_size: 102400,
  mime_type: 'application/pdf',
  created_at: '2026-03-13T00:00:00Z',
  updated_at: '2026-03-13T00:00:00Z',
  soft_deleted_at: null,
}

const TASK_OWNER_ID = 'user-owner-001'
const STRANGER_ID   = 'user-stranger-001'
const PROVIDER_ID   = 'user-provider-001'

// ──────────────────────────────────────────────────────────────────
// CASE 1: task owner, 결제 전 → preview only
// ──────────────────────────────────────────────────────────────────
function test_owner_before_payment() {
  const result = shapeSubmission(BASE_ROW, TASK_OWNER_ID, TASK_OWNER_ID, false)

  console.assert(!('content_text' in result),
    '❌ FAIL: content_text must NOT exist before payment')
  console.assert(!('file_path' in result),
    '❌ FAIL: file_path must NOT exist before payment')
  console.assert(result.preview_text === BASE_ROW.preview_text,
    '❌ FAIL: preview_text must be present')
  console.assert(result.quoted_price === BASE_ROW.quoted_price,
    '❌ FAIL: quoted_price must be present')

  console.log('✅ PASS: owner before payment → preview only')
}

// ──────────────────────────────────────────────────────────────────
// CASE 2: task owner, 결제 완료 → full
// ──────────────────────────────────────────────────────────────────
function test_owner_after_payment() {
  const result = shapeSubmission(BASE_ROW, TASK_OWNER_ID, TASK_OWNER_ID, true) as any

  console.assert(result.content_text === BASE_ROW.content_text,
    '❌ FAIL: content_text must be present after payment')
  console.assert(result.file_path === BASE_ROW.file_path,
    '❌ FAIL: file_path must be present after payment')
  console.assert(result.file_name === BASE_ROW.file_name,
    '❌ FAIL: file_name must be present after payment')

  console.log('✅ PASS: owner after payment → full content')
}

// ──────────────────────────────────────────────────────────────────
// CASE 3: stranger (다른 task owner도 아님) → preview only
// (RLS에서 row 자체가 차단되나, API shaper 레벨 검증)
// ──────────────────────────────────────────────────────────────────
function test_stranger() {
  const result = shapeSubmission(BASE_ROW, STRANGER_ID, TASK_OWNER_ID, false)

  console.assert(!('content_text' in result),
    '❌ FAIL: content_text must NOT exist for stranger')
  console.assert(!('file_path' in result),
    '❌ FAIL: file_path must NOT exist for stranger')

  console.log('✅ PASS: stranger → preview only (RLS additionally blocks row access)')
}

// ──────────────────────────────────────────────────────────────────
// CASE 4: provider 본인 → preview only (paid 아님)
// ──────────────────────────────────────────────────────────────────
function test_provider_own_submission() {
  const result = shapeSubmission(BASE_ROW, PROVIDER_ID, TASK_OWNER_ID, false)

  console.assert(!('content_text' in result),
    '❌ FAIL: provider should not see content_text via GET /submissions (use separate mine endpoint)')
  console.assert(!('file_path' in result),
    '❌ FAIL: provider should not see file_path via GET /submissions')

  console.log('✅ PASS: provider → preview only (content visible only via /submissions/mine)')
}

// ──────────────────────────────────────────────────────────────────
// CASE 5: shapeSubmissions 배열 처리 - 혼합 paid/unpaid
// ──────────────────────────────────────────────────────────────────
function test_batch_mixed() {
  const rows: SubmissionRow[] = [
    { ...BASE_ROW, id: 'sub-001' },  // paid
    { ...BASE_ROW, id: 'sub-002' },  // not paid
    { ...BASE_ROW, id: 'sub-003' },  // not paid
  ]
  const paidIds = new Set(['sub-001'])
  const results = shapeSubmissions(rows, TASK_OWNER_ID, TASK_OWNER_ID, paidIds) as any[]

  console.assert('content_text' in results[0],
    '❌ FAIL: sub-001 (paid) should have content_text')
  console.assert(!('content_text' in results[1]),
    '❌ FAIL: sub-002 (not paid) must NOT have content_text')
  console.assert(!('content_text' in results[2]),
    '❌ FAIL: sub-003 (not paid) must NOT have content_text')

  console.log('✅ PASS: batch mixed paid/unpaid → correct per-row shaping')
}

// ──────────────────────────────────────────────────────────────────
// CASE 6: content_text = null (텍스트 없는 파일 제출)
// ──────────────────────────────────────────────────────────────────
function test_null_content_after_payment() {
  const row: SubmissionRow = { ...BASE_ROW, content_text: null }
  const result = shapeSubmission(row, TASK_OWNER_ID, TASK_OWNER_ID, true) as any

  console.assert('content_text' in result,
    '❌ FAIL: content_text key must exist even when null (after payment)')
  console.assert(result.content_text === null,
    '❌ FAIL: content_text should be null')
  console.assert(result.file_path === BASE_ROW.file_path,
    '❌ FAIL: file_path should be present')

  console.log('✅ PASS: null content_text after payment → key exists with null value')
}

// ──────────────────────────────────────────────────────────────────
// RUN ALL
// ──────────────────────────────────────────────────────────────────
console.log('\n=== submission-shaper unit tests ===\n')
test_owner_before_payment()
test_owner_after_payment()
test_stranger()
test_provider_own_submission()
test_batch_mixed()
test_null_content_after_payment()
console.log('\n=== all tests done ===\n')
