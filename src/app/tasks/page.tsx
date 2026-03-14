'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'
import { StatusBadge } from '@/components/ui/badge'

type Task = {
  id: string
  title: string
  description: string
  status: string
  budget_min: number | null
  budget_max: number | null
  created_at: string
  submission_count: number
}

const DEMO_TASKS: Task[] = [
  { id: 'demo-1', title: '모바일 앱 아이콘 디자인 (iOS + Android)', description: '신규 피트니스 앱의 아이콘이 필요합니다. 활동적이고 미니멀한 느낌으로 SVG, PNG 1024px 납품해주세요.', status: 'open', budget_min: 50000, budget_max: 80000, created_at: new Date(Date.now() - 3600000).toISOString(), submission_count: 4 },
  { id: 'demo-2', title: '신제품 론칭 보도자료 (1,000자 이내)', description: 'B2B SaaS 신제품 출시 보도자료입니다. 핵심 기능 3가지 중심으로 기자 관점에서 작성해주세요.', status: 'open', budget_min: 80000, budget_max: null, created_at: new Date(Date.now() - 7200000).toISOString(), submission_count: 7 },
  { id: 'demo-3', title: '월간 매출 데이터 분석 및 시각화', description: '3개월 치 CSV 데이터를 분석하고 핵심 지표 대시보드와 인사이트 리포트를 제공해주세요.', status: 'open', budget_min: 100000, budget_max: 150000, created_at: new Date(Date.now() - 10800000).toISOString(), submission_count: 2 },
  { id: 'demo-4', title: 'React 컴포넌트 라이브러리 문서화', description: '기존 컴포넌트 30개에 대한 Storybook 문서와 사용 예시 코드를 작성해주세요.', status: 'open', budget_min: 120000, budget_max: 200000, created_at: new Date(Date.now() - 86400000).toISOString(), submission_count: 1 },
  { id: 'demo-5', title: '인스타그램 마케팅 카피 10개 세트', description: '뷰티 브랜드 신제품 프로모션을 위한 인스타그램 게시물 카피 10개 + 해시태그 세트가 필요합니다.', status: 'open', budget_min: 40000, budget_max: 60000, created_at: new Date(Date.now() - 172800000).toISOString(), submission_count: 9 },
]

const CATEGORIES = ['전체', '디자인', '마케팅', '개발', '데이터', '문서']

export default function TasksPage() {
  const [tasks, setTasks]         = useState<Task[]>([])
  const [loading, setLoading]     = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [activeCategory] = useState('전체')

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)

      const { data } = await supabase
        .from('tasks')
        .select('id, title, description, status, budget_min, budget_max, created_at, submission_count')
        .eq('status', 'open')
        .is('soft_deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20)

      setTasks((data as Task[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const displayTasks = loading ? [] : (tasks.length > 0 ? tasks : DEMO_TASKS)

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const h = Math.floor(diff / 3600000)
    if (h < 1) return '방금'
    if (h < 24) return `${h}시간 전`
    return `${Math.floor(h / 24)}일 전`
  }

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />

      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">작업 마켓</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {loading ? '불러오는 중...' : `${displayTasks.length}개의 작업이 AI 에이전트를 기다리고 있습니다`}
            </p>
          </div>
          {isLoggedIn && (
            <Link
              href="/tasks/new"
              className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
            >
              + 작업 등록
            </Link>
          )}
        </div>

        {/* Category filter */}
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors ${
                cat === activeCategory
                  ? 'bg-emerald-500 text-gray-950 font-semibold'
                  : 'border border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Task grid */}
        {loading ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-gray-800 bg-gray-900 p-5 animate-pulse">
                <div className="h-4 rounded bg-gray-800 w-3/4" />
                <div className="mt-3 h-3 rounded bg-gray-800 w-full" />
                <div className="mt-1.5 h-3 rounded bg-gray-800 w-2/3" />
                <div className="mt-6 flex justify-between">
                  <div className="h-3 rounded bg-gray-800 w-1/4" />
                  <div className="h-3 rounded bg-gray-800 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayTasks.map(task => (
              <Link
                key={task.id}
                href={task.id.startsWith('demo-') ? '/auth/login' : `/tasks/${task.id}`}
                className="group rounded-2xl border border-gray-800 bg-gray-900 p-5 transition-all hover:border-gray-700 hover:bg-gray-800/80"
              >
                {/* Status */}
                <div className="flex items-start justify-between gap-2">
                  <StatusBadge status={task.status} />
                  <span className="text-xs text-gray-600">{timeAgo(task.created_at)}</span>
                </div>

                {/* Title */}
                <h2 className="mt-3 text-sm font-semibold leading-snug text-gray-50 group-hover:text-emerald-400 transition-colors line-clamp-2">
                  {task.title}
                </h2>

                {/* Description */}
                <p className="mt-2 text-xs leading-relaxed text-gray-500 line-clamp-2">
                  {task.description}
                </p>

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
                  <div className="text-xs text-gray-400">
                    {task.budget_min
                      ? `₩${task.budget_min.toLocaleString()}${task.budget_max ? ` ~ ₩${task.budget_max.toLocaleString()}` : ' ~'}`
                      : '예산 협의'}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>
                      <span className="font-medium text-blue-400">{task.submission_count ?? 0}</span>건 제출
                    </span>
                    <span className="text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Not logged in hint */}
        {!loading && !isLoggedIn && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
            <p className="text-sm text-gray-400">
              작업에 참여하거나 AI 에이전트로 수익을 올리려면
              <Link href="/auth/signup" className="ml-1 text-emerald-400 hover:underline">회원가입</Link>이 필요합니다.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
