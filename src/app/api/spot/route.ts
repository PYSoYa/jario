import { sql } from '@/lib/db'
import { nearbyQuerySchema } from '@/lib/nearby-query'
import { findNearbyPlaces, summarizeNearby } from '@/lib/places'

/**
 * GET /api/spot?lon=&lat=&radius=&industry=
 *
 * 한 자리를 분석하는 데 필요한 것을 한 번에 준다.
 *
 * 예전에는 화면 하나가 조회를 세 번 보냈다(분포·목록·마커). 병렬이라 벽시계
 * 시간은 최댓값이었지만, 서버리스 호출이 3번이라 콜드 스타트를 맞을 확률도 3배였고
 * 커넥션도 3번 잡았다. DB에서 하는 일은 그대로 두고 왕복만 하나로 줄인다.
 */
export const dynamic = 'force-dynamic'

/** 업종 대분류. select 채우는 용도라 10개뿐이고 분기마다만 바뀐다. */
async function topIndustries() {
  return sql<{ code: string; name: string }[]>`
    SELECT code, name FROM industry WHERE level = 1 ORDER BY name
  `
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = nearbyQuerySchema.safeParse(params)

  if (!parsed.success) {
    return Response.json(
      {
        error: '잘못된 요청입니다.',
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    )
  }

  const { lon, lat, radius, industry } = parsed.data

  // 분포는 대분류 범위에서 본다. 소분류를 골라도 형제 업종을 계속 보여줘야
  // "이 자리가 무슨 상권인지"를 판단할 수 있다.
  const breakdownScope = industry ? industry.slice(0, 2) : undefined

  try {
    const [industries, summary, list, markers] = await Promise.all([
      topIndustries(),
      summarizeNearby({ lon, lat, radius, industry: breakdownScope, group: 'sub' }),
      findNearbyPlaces({ lon, lat, radius, industry, limit: 25, order: 'distance' }),
      findNearbyPlaces({ lon, lat, radius, industry, limit: 500, order: 'sample' }),
    ])

    // 헤드라인 숫자는 선택한 업종 기준이어야 한다.
    // 필터가 없으면 분포 총계가 곧 전체 수다.
    const focused = industry
      ? await summarizeNearby({ lon, lat, radius, industry, group: 'sub', topN: 1 })
      : summary

    return Response.json({
      center: { lon, lat },
      radius,
      industry: industry ?? null,
      industries,
      total: focused.total,
      breakdown: summary.breakdown,
      items: list,
      markers,
      truncated: markers.length < focused.total,
    })
  } catch (err) {
    console.error('[spot]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
