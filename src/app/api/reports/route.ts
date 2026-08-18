import { createReport, reportInputSchema } from '@/lib/reports'

/**
 * POST /api/reports — 후보지 A/B 비교 리포트를 저장하고 공유용 id를 준다.
 *
 * 로그인이 없다. 저장되는 것은 좌표·반경·업종뿐이고 개인정보가 없다.
 * id는 추측하기 어려운 난수라, 링크를 받은 사람만 볼 수 있다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'JSON 형식이 아닙니다.' }, { status: 400 })
  }

  const parsed = reportInputSchema.safeParse(body)
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
    const id = await createReport(parsed.data)
    return Response.json({ id, url: `/r/${id}` }, { status: 201 })
  } catch (err) {
    console.error('[reports]', err)
    return Response.json({ error: '저장에 실패했습니다.' }, { status: 500 })
  }
}
