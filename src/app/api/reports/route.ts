import { clientKey, REPORTS_PER_HOUR, takeReportQuota } from '@/lib/rate-limit'
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
    // 로그인이 없어서 누구나 무제한으로 부를 수 있다. 스크립트 한 번이면
    // 무료 티어 DB가 리포트로 찬다. 검증을 통과한 뒤에 센다 — 잘못된 요청까지
    // 한도에 넣으면 오타 몇 번에 막히게 된다.
    const quota = await takeReportQuota(clientKey(request))
    if (!quota.allowed) {
      return Response.json(
        {
          error: `리포트는 한 시간에 ${REPORTS_PER_HOUR}개까지 만들 수 있습니다.`,
          resetAt: quota.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((quota.resetAt.getTime() - Date.now()) / 1000)),
          },
        },
      )
    }

    const id = await createReport(parsed.data)
    return Response.json(
      { id, url: `/r/${id}` },
      { status: 201, headers: { 'X-RateLimit-Remaining': String(quota.remaining) } },
    )
  } catch (err) {
    console.error('[reports]', err)
    return Response.json({ error: '저장에 실패했습니다.' }, { status: 500 })
  }
}
