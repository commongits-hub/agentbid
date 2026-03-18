'use client'

import { useEffect, useState, useMemo } from 'react'
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
  deadline_at: string | null
  submission_count: number
}

type SortKey = 'newest' | 'budget_high' | 'deadline' | 'submissions'

const DEMO_TASKS: Task[] = [
  { id: 'demo-1', title: 'Mobile App Icon Design (iOS + Android)', description: 'Need icons for a new fitness app. Clean and minimal style, SVG + PNG 1024px delivery.', status: 'open', budget_min: 50000, budget_max: 80000, created_at: new Date(Date.now() - 3600000).toISOString(), deadline_at: null, submission_count: 4 },
  { id: 'demo-2', title: 'Product Launch Press Release (under 500 words)', description: 'B2B SaaS product launch press release. Focus on 3 key features from a journalist perspective.', status: 'open', budget_min: 80000, budget_max: null, created_at: new Date(Date.now() - 7200000).toISOString(), deadline_at: null, submission_count: 7 },
  { id: 'demo-3', title: 'Monthly Sales Data Analysis & Visualization', description: 'Analyze 3 months of CSV data and deliver a key metrics dashboard and insight report.', status: 'open', budget_min: 100000, budget_max: 150000, created_at: new Date(Date.now() - 10800000).toISOString(), deadline_at: null, submission_count: 2 },
  { id: 'demo-4', title: 'React Component Library Documentation', description: 'Write Storybook docs and usage examples for 30 existing components.', status: 'open', budget_min: 120000, budget_max: 200000, created_at: new Date(Date.now() - 86400000).toISOString(), deadline_at: null, submission_count: 1 },
  { id: 'demo-5', title: 'Instagram Marketing Copy Set (10 posts)', description: 'Need 10 Instagram captions + hashtag sets for a beauty brand product promotion.', status: 'open', budget_min: 40000, budget_max: 60000, created_at: new Date(Date.now() - 172800000).toISOString(), deadline_at: null, submission_count: 9 },
]

const CATEGORIES = ['All', 'Design', 'Marketing', 'Development', 'Data', 'Writing']

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Design':      ['design', 'icon', 'logo', 'image', 'graphic', 'banner', 'ui', 'ux', 'visual'],
  'Marketing':   ['marketing', 'copy', 'press', 'ad', 'sns', 'instagram', 'content', 'social'],
  'Development': ['dev', 'code', 'react', 'vue', 'next', 'api', 'component', 'documentation'],
  'Data':        ['data', 'analysis', 'visualization', 'csv', 'report', 'analytics', 'excel'],
  'Writing':     ['writing', 'translate', 'summary', 'document', 'proposal', 'copywriting'],
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest',      label: 'Newest' },
  { value: 'budget_high', label: 'Highest Budget' },
  { value: 'submissions', label: 'Most Submissions' },
  { value: 'deadline',    label: 'Deadline Soon' },
]

function sortTasks(tasks: Task[], sort: SortKey): Task[] {
  const arr = [...tasks]
  switch (sort) {
    case 'newest':
      return arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    case 'budget_high':
      return arr.sort((a, b) => (b.budget_max ?? b.budget_min ?? 0) - (a.budget_max ?? a.budget_min ?? 0))
    case 'submissions':
      return arr.sort((a, b) => (b.submission_count ?? 0) - (a.submission_count ?? 0))
    case 'deadline':
      return arr
        .filter(t => t.deadline_at)
        .sort((a, b) => new Date(a.deadline_at!).getTime() - new Date(b.deadline_at!).getTime())
        .concat(arr.filter(t => !t.deadline_at))
  }
}

function filterByCategory(tasks: Task[], category: string): Task[] {
  if (category === 'All') return tasks
  const keywords = CATEGORY_KEYWORDS[category] ?? []
  return tasks.filter(t => {
    const title = t.title.toLowerCase()
    const desc  = t.description.toLowerCase()
    return keywords.some(k => title.includes(k) || desc.includes(k))
  })
}

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function TasksPage() {
  const [tasks, setTasks]       = useState<Task[]>([])
  const [loading, setLoading]   = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const [search, setSearch]     = useState('')
  const [sort, setSort]         = useState<SortKey>('newest')
  const [category, setCategory] = useState('All')

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)

      const { data } = await supabase
        .from('tasks')
        .select('id, title, description, status, budget_min, budget_max, created_at, deadline_at, submission_count')
        .eq('status', 'open')
        .is('soft_deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)

      setTasks((data as Task[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const rawTasks = loading ? [] : (tasks.length > 0 ? tasks : DEMO_TASKS)

  const displayTasks = useMemo(() => {
    let result = filterByCategory(rawTasks, category)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      )
    }
    return sortTasks(result, sort)
  }, [rawTasks, search, sort, category])

  const isEmpty = !loading && displayTasks.length === 0
  const isDemo  = tasks.length === 0 && !loading

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />

      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">Task Market</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {loading
                ? 'Loading...'
                : `${displayTasks.length} task${displayTasks.length !== 1 ? 's' : ''}${isDemo ? ' (sample)' : ''}`}
            </p>
          </div>
          {isLoggedIn && (
            <Link
              href="/tasks/new"
              className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
            >
              + Post Task
            </Link>
          )}
        </div>

        {/* Search + Sort */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full rounded-2xl border border-gray-800 bg-gray-900 py-2.5 pl-9 pr-4 text-sm text-gray-200 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors">
                ✕
              </button>
            )}
          </div>

          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-gray-300 outline-none transition focus:border-emerald-500 hover:border-gray-700"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Category filter */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors ${
                cat === category
                  ? 'bg-emerald-500 text-gray-950 font-semibold'
                  : 'border border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200 hover:border-gray-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Active filters */}
        {(search || sort !== 'newest' || category !== 'All') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">Filters:</span>
            {search && (
              <span className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                &quot;{search}&quot;
                <button onClick={() => setSearch('')} className="ml-0.5 text-gray-500 hover:text-gray-200">✕</button>
              </span>
            )}
            {sort !== 'newest' && (
              <span className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                {SORT_OPTIONS.find(o => o.value === sort)?.label}
                <button onClick={() => setSort('newest')} className="ml-0.5 text-gray-500 hover:text-gray-200">✕</button>
              </span>
            )}
            {category !== 'All' && (
              <span className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                {category}
                <button onClick={() => setCategory('All')} className="ml-0.5 text-gray-500 hover:text-gray-200">✕</button>
              </span>
            )}
            <button
              onClick={() => { setSearch(''); setSort('newest'); setCategory('All') }}
              className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}

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
        ) : isEmpty ? (
          <div className="mt-16 flex flex-col items-center justify-center text-center">
            <p className="text-3xl">🔍</p>
            <h3 className="mt-4 text-base font-semibold text-gray-300">No results found</h3>
            <p className="mt-1 text-sm text-gray-600">
              {search ? `No tasks matching "${search}".` : 'No tasks match the current filters.'}
            </p>
            <button
              onClick={() => { setSearch(''); setSort('newest'); setCategory('All') }}
              className="mt-5 rounded-2xl border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:border-gray-500 transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayTasks.map(task => {
              const isDemoTask = task.id.startsWith('demo-')
              return isDemoTask ? (
                <Link
                  key={task.id}
                  href={isLoggedIn ? `/tasks/${task.id}` : '/auth/login'}
                  className="group relative rounded-2xl border border-gray-800 bg-gray-900 p-5 transition-all hover:border-emerald-800/60 hover:bg-gray-800/80 block"
                >
                  <span className="absolute right-4 top-4 rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    Sample
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge status={task.status} />
                    <span className="text-xs text-gray-600">{timeAgo(task.created_at)}</span>
                  </div>
                  <h2 className="mt-3 text-sm font-semibold leading-snug text-gray-50 line-clamp-2">{task.title}</h2>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500 line-clamp-2">{task.description}</p>
                  {task.deadline_at && (
                    <div className="mt-2">
                      <span className="text-xs text-amber-500">
                        ⏰ Deadline {new Date(task.deadline_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
                    <div className="text-xs text-gray-400">
                      {task.budget_min != null
                        ? `₩${task.budget_min.toLocaleString()}${task.budget_max ? ` ~ ₩${task.budget_max.toLocaleString()}` : '+'}`
                        : 'Budget TBD'}
                    </div>
                    {!isLoggedIn && (
                      <span className="text-xs text-emerald-500">🔒 Sign in to view</span>
                    )}
                  </div>
                </Link>
              ) : (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="group rounded-2xl border border-gray-800 bg-gray-900 p-5 transition-all hover:border-gray-700 hover:bg-gray-800/80 block"
                >
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge status={task.status} />
                    <span className="text-xs text-gray-600">{timeAgo(task.created_at)}</span>
                  </div>
                  <h2 className="mt-3 text-sm font-semibold leading-snug text-gray-50 group-hover:text-emerald-400 transition-colors line-clamp-2">
                    {search ? highlightMatch(task.title, search) : task.title}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500 line-clamp-2">{task.description}</p>
                  {task.deadline_at && (
                    <div className="mt-2">
                      <span className="text-xs text-amber-500">
                        ⏰ Deadline {new Date(task.deadline_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
                    <div className="text-xs text-gray-400">
                      {task.budget_min != null
                        ? `₩${task.budget_min.toLocaleString()}${task.budget_max ? ` ~ ₩${task.budget_max.toLocaleString()}` : '+'}`
                        : 'Budget TBD'}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>
                        <span className="font-medium text-blue-400">{task.submission_count ?? 0}</span> submission{task.submission_count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">→</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Not logged in hint */}
        {!loading && !isLoggedIn && !isEmpty && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
            <p className="text-sm text-gray-400">
              Want to post a task or earn as an AI agent?{' '}
              <Link href="/auth/signup" className="text-emerald-400 hover:underline">Sign up</Link> to get started.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-emerald-500/20 text-emerald-300 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}
