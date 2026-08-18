import { z } from 'zod'
import { findPlacesAt } from '@/lib/places'

/**
 * GET /api/places/at?lon=&lat= — 그 지점에 겹쳐 있는 업소들.
 *
 * 서울·인천 업소의 85%가 다른 업소와 좌표가 같다(건물 단위 지오코딩).
 * 마커 하나가 곧 업소 하나가 아니다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const querySchema = z.object({
  lon: z.coerce.number().min(124).max(132),
  lat: z.coerce.number().min(33).max(39),
})

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) {
    return Response.json({ error: '잘못된 좌표입니다.' }, { status: 400 })
  }

  try {
    return Response.json(await findPlacesAt(parsed.data))
  } catch (err) {
    console.error('[places/at]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
