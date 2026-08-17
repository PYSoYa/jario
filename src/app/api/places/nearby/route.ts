import { z } from 'zod'
import { findNearbyPlaces, summarizeNearby } from '@/lib/places'

/**
 * GET /api/places/nearby?lon=&lat=&radius=&industry=&limit=
 *
 * 지도에서 찍은 지점 기준으로 반경 내 업소와 업종 분포를 돌려준다.
 */

const querySchema = z.object({
  // 한국 범위를 벗어난 좌표는 좌표계를 잘못 쓴 것이다. DB CHECK와 같은 범위로 막는다.
  lon: z.coerce.number().min(124).max(132),
  lat: z.coerce.number().min(33).max(39),

  // 반경 상한이 없으면 한 번의 요청으로 인천 전체를 긁을 수 있다.
  // 상권 분석에서 도보권을 넘어서면 의미도 희박해진다.
  radius: z.coerce.number().int().min(50).max(2000).default(500),

  // 업종 코드는 대(2) · 중(4) · 소(6)자만 유효하다.
  industry: z
    .string()
    .regex(/^[A-Z][0-9]([0-9]{2}){0,2}$/, '업종 코드 형식이 올바르지 않습니다')
    .optional(),

  // 목록은 지도 마커용이라 상한을 둔다. 총 개수는 summary가 따로 알려준다.
  limit: z.coerce.number().int().min(1).max(2000).default(500),
})

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = querySchema.safeParse(params)

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

  const { lon, lat, radius, industry, limit } = parsed.data

  try {
    // 목록과 집계는 서로를 기다릴 이유가 없다.
    const [items, summary] = await Promise.all([
      findNearbyPlaces({ lon, lat, radius, industry, limit }),
      summarizeNearby({ lon, lat, radius, industry }),
    ])

    return Response.json({
      center: { lon, lat },
      radius,
      industry: industry ?? null,
      total: summary.total,
      // 목록이 LIMIT에 걸렸는지 클라이언트가 알아야 "더 있음"을 표시할 수 있다.
      truncated: items.length < summary.total,
      byTopIndustry: summary.byTopIndustry,
      items,
    })
  } catch (err) {
    console.error('[places/nearby]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
