// 확장자를 명시한다 — 테스트가 번들러 없이 `node --test`로 이 모듈을 직접 불러온다.
import { sql } from './db.ts'

export type NearbyParams = {
  lon: number
  lat: number
  radius: number
  /** 업종 코드. 대(2자)·중(4자)·소(6자) 어느 레벨이든 받는다. */
  industry?: string
  limit: number
  /**
   * 결과가 limit을 넘을 때 무엇을 남길지.
   *
   * distance — 가까운 순. 목록에 쓴다.
   * sample   — 공간적으로 치우치지 않는 표본. 지도 마커에 쓴다.
   *
   * 지도에 '가까운 순 N개'를 찍으면 밀집 지역에서 중심 근처만 채워지고,
   * 바깥은 업소가 없는 것처럼 보인다. 실제로는 잘린 것뿐인데 지도가 거짓말을 하게 된다.
   */
  order?: 'distance' | 'sample'
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

export type PlaceDetail = {
  placeId: string
  name: string
  branchName: string | null
  industryCode: string
  industryPath: string[]
  ksicCode: string | null
  ksicName: string | null
  sigungu: string
  admDong: string
  roadAddress: string | null
  lotAddress: string | null
  buildingName: string | null
  floorNo: number | null
  floorRaw: string | null
  lon: number
  lat: number
}

/** 업소 한 건의 전체 정보. 목록 응답에는 담지 않는 필드까지 준다. */
export async function getPlaceDetail(placeId: string): Promise<PlaceDetail | null> {
  const [row] = await sql<
    {
      place_id: string
      name: string
      branch_name: string | null
      industry_code: string
      sub_name: string
      mid_name: string
      top_name: string
      ksic_code: string | null
      ksic_name: string | null
      sigungu_name: string
      adm_dong_name: string
      road_address: string | null
      lot_address: string | null
      building_name: string | null
      floor_no: number | null
      floor_raw: string | null
      lon: number
      lat: number
    }[]
  >`
    SELECT
      p.place_id, p.name, p.branch_name, p.industry_code,
      sub.name AS sub_name, mid.name AS mid_name, top.name AS top_name,
      p.ksic_code, p.ksic_name,
      p.sigungu_name, p.adm_dong_name,
      p.road_address, p.lot_address, p.building_name,
      p.floor_no, p.floor_raw,
      p.lon, p.lat
    FROM place p
    JOIN industry sub ON sub.code = p.industry_code
    JOIN industry mid ON mid.code = sub.parent_code
    JOIN industry top ON top.code = mid.parent_code
    WHERE p.place_id = ${placeId}
  `

  if (!row) return null

  return {
    placeId: row.place_id,
    name: row.name,
    branchName: row.branch_name,
    industryCode: row.industry_code,
    industryPath: [row.top_name, row.mid_name, row.sub_name],
    ksicCode: row.ksic_code,
    ksicName: row.ksic_name,
    sigungu: row.sigungu_name,
    admDong: row.adm_dong_name,
    roadAddress: row.road_address,
    lotAddress: row.lot_address,
    buildingName: row.building_name,
    floorNo: row.floor_no,
    floorRaw: row.floor_raw,
    lon: row.lon,
    lat: row.lat,
  }
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
    ${
      p.order === 'sample'
        ? // place_id 해시 순. 위치와 무관하므로 반경 안에서 고르게 뽑히고,
          // 같은 입력이면 같은 결과라 지도가 새로고침마다 깜빡이지 않는다.
          sql`ORDER BY hashtext(p.place_id)`
        : sql`ORDER BY distance_m`
    }
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
