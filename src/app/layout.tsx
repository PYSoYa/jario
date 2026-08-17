import type { Metadata } from 'next'
import { IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'

/**
 * 본문·UI. 도면과 계기의 성격이 있는 서체라 측정 도구인 이 서비스에 맞는다.
 *
 * preload를 끈 이유: 한글 폰트는 유니코드 서브셋이 100개 남짓으로 쪼개진다.
 * 굵기까지 곱하면 페이스가 300개를 넘고, next/font 기본값은 그걸 전부
 * <link rel=preload> 로 걸어버린다. 실제로 preload 링크 283개 · 폰트 2,143KB를
 * 내려받고 있었고 FCP가 1.75초였다.
 * 끄면 브라우저가 화면에 실제로 쓰인 글자의 서브셋만 가져온다.
 *
 * 굵기는 코드에서 쓰는 것만 남겼다(700은 한 번도 쓰지 않았다).
 */
const plexKr = IBM_Plex_Sans_KR({
  variable: '--font-plex-kr',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
})

// 계측값 전용. 개수·거리·반경·업종 코드가 전부 이걸로 셋팅된다.
// 라틴 전용이라 서브셋이 몇 개뿐이고, 첫 화면의 큰 숫자에 바로 쓰이므로 preload를 유지한다.
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '600'],
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
