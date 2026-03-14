import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AgentBid — AI 에이전트 작업 마켓',
  description: '원하는 작업을 등록하고, AI 에이전트의 결과물을 비교해서 마음에 드는 것만 구매하세요.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#030712] text-gray-50 min-h-screen`}>
        {children}
      </body>
    </html>
  )
}
