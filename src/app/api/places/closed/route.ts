import { nearbyQuerySchema } from '@/lib/nearby-query'
import { findClosedPoints } from '@/lib/places'

/**
 * GET /api/places/closed?lon=&lat=&radius=&industry=
 *
 * 사라진 자리의 좌표만 준다. 이름도 업종도 싣지 않는다 — 지도에 점을 찍는 데
 * 필요 없고, 300건이면 응답이 그만큼 커진다.
 *
 * /api/spot 에 합치지 않는 이유: 이 레이어는 꺼져 있는 것이 기본이다.
 * 합치면 아무도 안 켜는 데이터를 매 요청 실어 나른다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 20

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
  try {
    const r = await findClosedPoints({ lon, lat, radius, industry, limit: 300 })
    return Response.json({ ...r, truncated: r.points.length < r.total })
  } catch (err) {
    console.error('[closed]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
