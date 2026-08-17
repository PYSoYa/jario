import { nearbyQuerySchema } from '@/lib/nearby-query'
import { findNearbyPlaces, summarizeNearby } from '@/lib/places'

/**
 * GET /api/places/nearby?lon=&lat=&radius=&industry=&limit=
 *
 * 지도에서 찍은 지점 기준으로 반경 내 업소와 업종 분포를 돌려준다.
 */

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = nearbyQuerySchema.safeParse(params)

  if (!parsed.success) {
    return Response.json(
      {
        error: '잘못된 요청입니다.',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { lon, lat, radius, industry, limit, order, group } = parsed.data

  try {
    // 목록과 집계는 서로를 기다릴 이유가 없다.
    const [items, summary] = await Promise.all([
      findNearbyPlaces({ lon, lat, radius, industry, limit, order }),
      summarizeNearby({ lon, lat, radius, industry, group }),
    ])

    return Response.json({
      center: { lon, lat },
      radius,
      order,
      industry: industry ?? null,
      total: summary.total,
      // 목록이 LIMIT에 걸렸는지 클라이언트가 알아야 "더 있음"을 표시할 수 있다.
      truncated: items.length < summary.total,
      group,
      breakdown: summary.breakdown,
      items,
    })
  } catch (err) {
    console.error('[places/nearby]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
