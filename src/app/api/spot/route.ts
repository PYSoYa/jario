import { sql } from '@/lib/db'
import { nearbyQuerySchema } from '@/lib/nearby-query'
import {
  countNearby,
  findMarkerPoints,
  findNearbyPlaces,
  measureChurn,
  summarizeNearby,
} from '@/lib/places'

/**
 * GET /api/spot?lon=&lat=&radius=&industry=
 *
 * 한 자리를 분석하는 데 필요한 것을 한 번에 준다.
 *
 * 예전에는 화면 하나가 조회를 세 번 보냈다. 병렬이라 벽시계 시간은 최댓값이었지만,
 * 서버리스 호출이 3번이라 콜드 스타트를 맞을 확률도 3배였고 커넥션도 3번 잡았다.
 */
export const dynamic = 'force-dynamic'
// 기본값(300초)이면 막힌 요청이 함수를 5분간 붙잡는다. 정상이면 1초 안에 끝난다.
export const maxDuration = 20

/**
 * Promise.all 은 하나가 거부되면 즉시 실패하지만, 나머지 프로미스는 나중에
 * 각자 거부된다. 그때 핸들러가 없으면 unhandledRejection 이 되고 Node 프로세스가
 * 통째로 죽는다(실제로 exit 128 이 찍혔고, 이후 요청들이 500/504를 맞았다).
 *
 * 사용자가 반경을 빠르게 바꾸면 이전 요청이 중단되고 DB 쿼리가 취소되므로
 * 흔히 발생한다. 미리 핸들러를 붙여 프로세스가 죽지 않게 한다.
 */
function guard<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

/** 업종 대분류. select 채우는 용도라 10개뿐이고 분기마다만 바뀐다. */
function topIndustries() {
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
  const at = { lon, lat, radius }

  // 분포는 대분류 범위에서 본다. 소분류를 골라도 형제 업종을 계속 보여줘야
  // "이 자리가 무슨 상권인지"를 판단할 수 있다.
  const breakdownScope = industry ? industry.slice(0, 2) : undefined

  try {
    const [industries, summary, items, markers, filtered, churn] = await Promise.all([
      guard(topIndustries()),
      guard(summarizeNearby({ ...at, industry: breakdownScope, group: 'sub' })),
      guard(findNearbyPlaces({ ...at, industry, limit: 25, order: 'distance' })),
      guard(findMarkerPoints({ ...at, industry, limit: 500 })),
      // 헤드라인 숫자는 선택한 업종 기준이다. 분포를 한 번 더 돌리는 것보다
      // 단순 count 가 훨씬 싸다. 필터가 없으면 분포 총계가 곧 전체 수라 건너뛴다.
      industry ? guard(countNearby({ ...at, industry })) : Promise.resolve(null),
      // 회전은 별도 테이블 두 개를 보므로 여기 얹어도 기존 쿼리를 건드리지 않는다.
      guard(measureChurn({ ...at, industry })),
    ])

    const total = filtered ?? summary.total

    return Response.json({
      center: { lon, lat },
      radius,
      industry: industry ?? null,
      industries,
      total,
      breakdown: summary.breakdown,
      items,
      markers,
      truncated: markers.length < total,
      churn,
    })
  } catch (err) {
    console.error('[spot]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
