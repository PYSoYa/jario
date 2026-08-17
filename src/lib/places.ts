import { sql } from './db'

export type NearbyParams = {
  lon: number
  lat: number
  radius: number
  /** 업종 코드. 대(2자)·중(4자)·소(6자) 어느 레벨이든 받는다. */
  industry?: string
  limit: number
}

export type NearbyPlace = {
  placeId: string
  name: string
  branchName: string | null
  roadAddress: string | null
  floorNo: number | null
  industryCode: string
  industryName: string
  industryMid: string
  industryTop: string
  lon: number
  lat: number
  distanceM: number
}

export type IndustryCount = {
  code: string
  name: string
  count: number
}

/**
 * 업종 필터는 접두어 매칭으로 처리한다.
 *
 * 업종 코드는 대(2자) → 중(4자) → 소(6자)의 접두어 구조이고,
 * 레벨별 길이가 균일하다는 것을 데이터에서 확인했다(G2 → G204 → G20404).
 * 그래서 코드 하나만 받아도 어느 레벨로 거를지가 모호하지 않고,
 * 조인을 늘리지 않고 place.industry_code 인덱스를 그대로 쓸 수 있다.
 */
function industryFilter(industry?: string) {
  return industry ? sql`AND p.industry_code LIKE ${industry + '%'}` : sql``
}

/** 반경 내 업소 목록. 가까운 순. */
export async function findNearbyPlaces(p: NearbyParams): Promise<NearbyPlace[]> {
  const rows = await sql<
    {
      place_id: string
      name: string
      branch_name: string | null
      road_address: string | null
      floor_no: number | null
      industry_code: string
      industry_name: string
      industry_mid: string
      industry_top: string
      lon: number
      lat: number
      distance_m: number
    }[]
  >`
    WITH center AS (
      SELECT ST_MakePoint(${p.lon}, ${p.lat})::geography AS g
    )
    SELECT
      p.place_id, p.name, p.branch_name, p.road_address, p.floor_no,
      p.industry_code,
      sub.name  AS industry_name,
      mid.name  AS industry_mid,
      top.name  AS industry_top,
      p.lon, p.lat,
      ST_Distance(p.geom, center.g) AS distance_m
    FROM place p
    CROSS JOIN center
    JOIN industry sub ON sub.code = p.industry_code
    JOIN industry mid ON mid.code = sub.parent_code
    JOIN industry top ON top.code = mid.parent_code
    WHERE ST_DWithin(p.geom, center.g, ${p.radius})
      ${industryFilter(p.industry)}
    ORDER BY distance_m
    LIMIT ${p.limit}
  `

  return rows.map((r) => ({
    placeId: r.place_id,
    name: r.name,
    branchName: r.branch_name,
    roadAddress: r.road_address,
    floorNo: r.floor_no,
    industryCode: r.industry_code,
    industryName: r.industry_name,
    industryMid: r.industry_mid,
    industryTop: r.industry_top,
    lon: r.lon,
    lat: r.lat,
    distanceM: Math.round(r.distance_m),
  }))
}

/**
 * 반경 내 총 업소 수와 대분류별 분포.
 *
 * 목록과 따로 세는 이유: 목록은 LIMIT이 걸려 있어서 items.length로는
 * 실제 밀집도를 알 수 없다. "이 자리 반경 500m에 몇 개"가 이 서비스의 답이므로
 * 잘리지 않은 수를 따로 구한다.
 */
export async function summarizeNearby(
  p: Omit<NearbyParams, 'limit'>,
): Promise<{ total: number; byTopIndustry: IndustryCount[] }> {
  const rows = await sql<{ code: string; name: string; count: string }[]>`
    WITH center AS (
      SELECT ST_MakePoint(${p.lon}, ${p.lat})::geography AS g
    )
    SELECT top.code, top.name, count(*)::text AS count
    FROM place p
    CROSS JOIN center
    JOIN industry sub ON sub.code = p.industry_code
    JOIN industry mid ON mid.code = sub.parent_code
    JOIN industry top ON top.code = mid.parent_code
    WHERE ST_DWithin(p.geom, center.g, ${p.radius})
      ${industryFilter(p.industry)}
    GROUP BY top.code, top.name
    ORDER BY count(*) DESC
  `

  const byTopIndustry = rows.map((r) => ({
    code: r.code,
    name: r.name,
    count: Number(r.count),
  }))

  return {
    total: byTopIndustry.reduce((sum, r) => sum + r.count, 0),
    byTopIndustry,
  }
}
