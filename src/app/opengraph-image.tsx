import { ImageResponse } from 'next/og'
import { OG, OG_SIZE, ogFont } from '@/lib/og'

export const alt = 'jario — 창업 상권 분석 지도'
export const size = OG_SIZE
export const contentType = 'image/png'

/**
 * 서비스 자체의 미리보기.
 *
 * 실제 수치를 박아둔다. "상권 분석 서비스입니다"보다 부평역·강남역이 어떻게
 * 다른지 보여주는 쪽이 무엇을 하는 도구인지 훨씬 빨리 전달한다.
 */
export default function Image() {
  const row = (place: string, count: string, top: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18 }}>
      <span style={{ fontSize: 30, color: OG.paper, width: 220 }}>{place}</span>
      <span style={{ fontSize: 34, color: OG.commerce, width: 170 }}>{count}</span>
      <span style={{ fontSize: 26, color: OG.muted }}>{top}</span>
    </div>
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: OG.ink,
          padding: 64,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontSize: 44, color: OG.paper }}>jario</span>
            <span style={{ fontSize: 30, color: OG.muted, marginLeft: 14 }}>자리</span>
          </div>
          <div style={{ fontSize: 30, color: OG.muted, marginTop: 14 }}>
            창업할 자리를 고를 때, 반경 500m 안에 같은 업종이 몇 개인지부터 본다
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {row('부평역 500m', '3,074곳', '여성 의류 · 백반/한정식')}
          {row('강남역 500m', '6,615곳', '경영 컨설팅 · 광고 대행')}
          {row('홍대입구역', '5,145곳', '펜션 · 카페')}
        </div>

        <div style={{ fontSize: 24, color: OG.muted, display: 'flex' }}>
          서울·인천 691,087곳 · PostGIS 공간 분석
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'NotoSansKR', data: ogFont, style: 'normal', weight: 400 }] },
  )
}
