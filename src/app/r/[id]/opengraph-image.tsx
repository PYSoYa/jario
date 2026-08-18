import { ImageResponse } from 'next/og'
import { fmt, OG, OG_SIZE, ogFont, radiusLabel } from '@/lib/og'
import { getReportCard } from '@/lib/reports'

export const alt = '후보지 비교 리포트'
export const size = OG_SIZE
export const contentType = 'image/png'

/**
 * 리포트 링크를 카카오톡·슬랙에 붙였을 때 뜨는 이미지.
 *
 * 링크 공유가 이 기능의 전부인데 미리보기가 비어 있으면 아무 설득력이 없다.
 * 그래서 제목만 넣지 않고 **실제 수치**를 넣는다 — 열어보기 전에 판단할 수 있어야 한다.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const report = await getReportCard(id)

  const font = { name: 'NotoSansKR', data: ogFont, style: 'normal' as const, weight: 400 as const }

  if (!report) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: OG.ink,
            color: OG.muted,
            fontSize: 44,
          }}
        >
          없는 리포트입니다
        </div>
      ),
      { ...size, fonts: [font] },
    )
  }

  const what = report.industryName
  const aName = report.a.label ?? '후보지 A'
  const bName = report.b.label ?? '후보지 B'

  const column = (name: string, total: number, target: number | null) => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 30,
          color: OG.paper,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18 }}>
        <span style={{ fontSize: 76, color: OG.paper }}>{fmt(total)}</span>
        <span style={{ fontSize: 26, color: OG.muted, marginLeft: 10 }}>곳</span>
      </div>
      {target !== null && what && (
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 6 }}>
          <span style={{ fontSize: 40, color: OG.commerce }}>{fmt(target)}</span>
          <span style={{ fontSize: 24, color: OG.muted, marginLeft: 10 }}>{what}</span>
        </div>
      )}
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
            <span style={{ fontSize: 28, color: OG.paper }}>jario</span>
            <span style={{ fontSize: 24, color: OG.muted, marginLeft: 12 }}>자리</span>
          </div>
          {/* Satori는 자식이 둘 이상인 요소에 display를 명시하라고 요구한다.
              텍스트와 표현식이 섞이면 자식이 여러 개가 된다. */}
          <div style={{ display: 'flex', fontSize: 26, color: OG.muted, marginTop: 10 }}>
            {`반경 ${radiusLabel(report.radius)} 안${what ? ` · ${what}` : ''} 비교`}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 48 }}>
          {column(aName, report.a.total, report.a.target)}
          <div
            style={{
              width: 2,
              alignSelf: 'stretch',
              background: OG.line,
              display: 'flex',
            }}
          />
          {column(bName, report.b.total, report.b.target)}
        </div>

        <div style={{ fontSize: 22, color: OG.muted, display: 'flex' }}>
          소상공인시장진흥공단 {report.dataVersion} · 인구·임대료는 포함되지 않습니다
        </div>
      </div>
    ),
    { ...size, fonts: [font] },
  )
}
