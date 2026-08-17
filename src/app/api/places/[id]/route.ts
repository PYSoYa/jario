import { getPlaceDetail } from '@/lib/places'

/**
 * GET /api/places/:id — 업소 한 건의 상세.
 *
 * 목록 응답에 이 필드들을 다 넣지 않는 이유: 목록은 최대 2,000건까지 나가는데
 * 지도에 찍을 때 쓰지 않는 지번주소·표준산업분류까지 실어 보내면
 * 응답이 몇 배로 커진다. 상세는 한 번에 한 건만 필요하다.
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/places/[id]'>) {
  const { id } = await ctx.params

  // 상가업소번호는 영숫자 고정 형식이다. 형식이 다르면 조회 자체를 하지 않는다.
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) {
    return Response.json({ error: '잘못된 업소 번호입니다.' }, { status: 400 })
  }

  try {
    const place = await getPlaceDetail(id)
    if (!place) {
      return Response.json({ error: '없는 업소입니다.' }, { status: 404 })
    }
    return Response.json(place)
  } catch (err) {
    console.error('[places/:id]', err)
    return Response.json({ error: '조회에 실패했습니다.' }, { status: 500 })
  }
}
