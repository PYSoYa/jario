import type { Metadata } from 'next'
import { IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'

// 본문·UI. 도면과 계기의 성격이 있는 서체라 측정 도구인 이 서비스에 맞는다.
const plexKr = IBM_Plex_Sans_KR({
  variable: '--font-plex-kr',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

// 계측값 전용. 개수·거리·반경·업종 코드가 전부 이걸로 셋팅된다.
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'jario — 창업 상권 분석',
  description: '자리를 찍으면 반경 안의 경쟁 밀도를 계산합니다. 인천 상가업소 데이터 기반.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${plexKr.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
