import { sql } from '@/lib/db'
import { sweepReportQuota } from '@/lib/rate-limit'

/**
 * GET /api/cron/keepalive — Vercel Cron이 하루 한 번 호출한다.
 *
 * Supabase 무료 티어는 일주일 요청이 없으면 프로젝트를 멈춘다.
 * GitHub Actions에도 같은 역할의 워크플로가 있는데, 그쪽은 저장소가 60일간
 * 활동이 없으면 스케줄이 자동 비활성화된다. 포트폴리오는 방치되기 쉬워서
 * 서로 다른 곳에서 도는 장치를 둘 둔다.
 *
 * 단순 SELECT 1이 아니라 실제 테이블을 읽는다. 연결만 살아 있고 데이터가
 * 사라진 상태를 잡기 위해서다.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Vercel Cron은 CRON_SECRET이 설정돼 있으면 Authorization 헤더를 붙여 보낸다.
  // 설정하지 않으면 이 엔드포인트가 공개된다 — 무거운 일을 하지는 않지만 막아둔다.
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 401 })
  }

  try {
    const [row] = await sql<{ places: string; industries: string }[]>`
      SELECT
        (SELECT count(*) FROM place)::text    AS places,
        (SELECT count(*) FROM industry)::text AS industries
    `

    // 지난 창의 레이트 리밋 기록을 치운다. 남겨둬야 할 이유가 없고,
    // 어차피 하루 한 번 도는 작업이라 여기 얹는 게 맞다.
    const swept = await sweepReportQuota()

    const places = Number(row.places)
    // 연결은 됐는데 데이터가 비었으면 살아 있다고 볼 수 없다.
    const healthy = places > 1000

    return Response.json(
      { ok: healthy, places, industries: Number(row.industries), sweptQuotaRows: swept },
      { status: healthy ? 200 : 503 },
    )
  } catch (err) {
    console.error('[cron/keepalive]', err)
    return Response.json({ ok: false, error: 'DB에 접근하지 못했습니다.' }, { status: 503 })
  }
}
