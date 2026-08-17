import { z } from 'zod'

/**
 * /api/places/nearby 의 쿼리 스트링 스키마.
 *
 * 라우트 핸들러에서 분리한 이유: 검증 규칙은 HTTP와 무관한 순수 로직이고,
 * 여기 담긴 상한들(반경·limit·좌표 범위)이 서비스의 실질적인 안전장치라
 * 서버를 띄우지 않고 단독으로 검증할 수 있어야 한다.
 */
export const nearbyQuerySchema = z.object({
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

  // 잘릴 때 무엇을 남길지. 자세한 이유는 places.ts의 NearbyParams 주석 참고.
  order: z.enum(['distance', 'sample']).default('distance'),
})

export type NearbyQuery = z.infer<typeof nearbyQuerySchema>
