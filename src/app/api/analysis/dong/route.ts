import { z } from 'zod'
import { analyzeDongs } from '@/lib/analysis'

/**
 * GET /api/analysis/dong?industry=I21201&minTotal=300
 *
 * 행정동별로 그 업종이 상권 규모 대비 몰려 있는지(입지계수)를 돌려준다.
 */

const querySchema = z.object({
  // 업종이 없으면 LQ를 정의할 수 없다. 반경 검색과 달리 필수다.
  industry: z
    .string()
    .regex(/^[A-Z][0-9]([0-9]{2}){0,2}$/, '업종 코드 형식이 올바르지 않습니다'),
  // 표본이 작은 동을 걸러내는 기준. 낮추면 섬 지역의 우연한 값이 상위로 올라온다.
  minTotal: z.coerce.number().int().min(0).max(10_000).default(300),
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

  try {
    return Response.json(await analyzeDongs(parsed.data))
  } catch (err) {
    console.error('[analysis/dong]', err)
    return Response.json({ error: '분석에 실패했습니다.' }, { status: 500 })
  }
}
