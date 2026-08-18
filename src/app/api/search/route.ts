import { z } from 'zod'
import { searchSpots } from '@/lib/search-spots'

/**
 * GET /api/search?industry=I212&maxRent=150&maxCloseRate=8&sido=서울
 *
 * "이 자리는 어떤가"가 아니라 "어디가 좋은가"에 답한다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const schema = z.object({
  // 대(2)·중(4)·소(6)자리. nearby-query와 같은 규칙이다.
  industry: z.string().regex(/^[A-Z]([0-9]{1}|[0-9]{3}|[0-9]{5})$/, '업종 코드 형식이 아닙니다'),
  maxRent: z.coerce.number().positive().max(10_000).optional(),
  maxCloseRate: z.coerce.number().min(0).max(100).optional(),
  maxCount: z.coerce.number().int().positive().max(100_000).optional(),
  sido: z.enum(['서울', '인천']).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
})

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = schema.safeParse(params)

  if (!parsed.success) {
    return Response.json(
      {
        error: '잘못된 요청입니다.',
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    )
  }

  try {
    return Response.json(await searchSpots(parsed.data))
  } catch (err) {
    console.error('[search]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
