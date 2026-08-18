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
  lon: number
  lat: number
  distanceM: number
}

export type IndustryCount = {
  code: string
  name: string
  count: number
}

export type MarkerPoint = { placeId: string; name: string; lon: number; lat: number }

/**
 * 지도 마커용 최소 정보.
 *
 * 마커에는 좌표와 이름(툴팁)만 필요하다. 목록용 전체 행을 500건 실어 보내면
 * 응답이 145KB까지 커지는데, 그중 대부분이 화면에 안 쓰이는 주소·업종·거리다.
 */
export async function findMarkerPoints(
  p: Omit<NearbyParams, 'order'>,
): Promise<MarkerPoint[]> {
  const rows = await sql<{ place_id: string; name: string; lon: number; lat: number }[]>`
    SELECT p.place_id, p.name, p.lon, p.lat
    FROM place p
    WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
      ${industryFilter(p.industry)}
    -- 공간적으로 치우치지 않는 표본. 이유는 NearbyParams.order 주석 참고.
    ORDER BY hashtext(p.place_id)
    LIMIT ${p.limit}
  `
  return rows.map((r) => ({ placeId: r.place_id, name: r.name, lon: r.lon, lat: r.lat }))
}

/** 반경 안 업소 수만 센다. 분포까지 필요 없을 때 쓴다(집계보다 훨씬 싸다). */
export async function countNearby(p: Omit<NearbyParams, 'limit' | 'order'>): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n
    FROM place p
    WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
      ${industryFilter(p.industry)}
  `
  return Number(row.n)
}

export type StackedPlace = {
  placeId: string
  name: string
  industryName: string
  floorNo: number | null
}

/**
 * 한 지점에 겹쳐 있는 업소들.
 *
 * 서울·인천 업소의 85%가 다른 업소와 좌표가 완전히 같다. 건물 단위로
 * 지오코딩돼서 같은 건물이면 같은 점을 쓴다(한 지점 최대 1,040곳).
 * 마커를 누르면 위에 있는 하나만 열리는 게 아니라 그 자리에 뭐가 있는지를 보여준다.
 *
 * 좌표가 완전히 같은 것만 찾지 않고 1m 반경으로 잡는다 — 소수점 끝자리가
 * 다른 경우가 있고, GiST 인덱스를 그대로 탄다.
 */
export async function findPlacesAt(p: {
  lon: number
  lat: number
  limit?: number
}): Promise<{ total: number; buildingName: string | null; roadAddress: string | null; places: StackedPlace[] }> {
  const limit = p.limit ?? 50
  const rows = await sql<
    {
      place_id: string
      name: string
      industry_name: string
      floor_no: number | null
      building_name: string | null
      road_address: string | null
      total: string
    }[]
  >`
    WITH hit AS (
      SELECT p.*
      FROM place p
      WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, 1)
    )
    SELECT h.place_id, h.name, i.name AS industry_name, h.floor_no,
           h.building_name, h.road_address,
           count(*) OVER ()::text AS total
    FROM hit h
    JOIN industry i ON i.code = h.industry_code
    -- 층이 있으면 낮은 층부터. 1층 가게가 먼저 보이는 편이 자연스럽다.
    ORDER BY h.floor_no NULLS LAST, h.name
    LIMIT ${limit}
  `

  return {
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    buildingName: rows[0]?.building_name ?? null,
    roadAddress: rows[0]?.road_address ?? null,
    places: rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      industryName: r.industry_name,
      floorNo: r.floor_no,
    })),
  }
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
      sub.name AS industry_name,
      p.lon, p.lat,
      ST_Distance(p.geom, center.g) AS distance_m
    -- 업종 조인은 하나면 된다. 예전에는 대·중분류까지 3번 조인했는데
    -- 화면에서 쓰지도 않는 값이었고, 반경 안 업소 수만큼 조인이 반복돼
    -- 집계 쿼리에서만 2초를 잡아먹었다.
    FROM place p
    CROSS JOIN center
    JOIN industry sub ON sub.code = p.industry_code
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
    lon: r.lon,
    lat: r.lat,
    distanceM: Math.round(r.distance_m),
  }))
}

/**
 * 반경 내 총 업소 수와 업종별 분포.
 *
 * 목록과 따로 세는 이유: 목록은 LIMIT이 걸려 있어서 items.length로는
 * 실제 밀집도를 알 수 없다. "이 자리 반경 500m에 몇 개"가 이 서비스의 답이므로
 * 잘리지 않은 수를 따로 구한다.
 *
 * group:
 *   sub — 소분류(편의점·미용실·카페…). 기본값이자 사람이 실제로 아는 단위다.
 *   top — 대분류(소매·음식…). 행정 분류라 "소매 994곳"처럼 판단에 쓸 수 없는
 *         숫자가 나오므로, 상권 구성을 크게 훑을 때만 쓴다.
 */
export async function summarizeNearby(
  p: Omit<NearbyParams, 'limit' | 'order'> & { group?: 'top' | 'sub'; topN?: number },
): Promise<{ total: number; breakdown: IndustryCount[] }> {
  const bySub = (p.group ?? 'sub') === 'sub'
  const topN = p.topN ?? 15

  const rows = await sql<{ code: string; name: string; count: string; total: string }[]>`
    WITH center AS (
      SELECT ST_MakePoint(${p.lon}, ${p.lat})::geography AS g
    )
    /*
     * 집계를 먼저 하고 업종 이름은 마지막에 붙인다.
     *
     * 조인을 먼저 하면 반경 안 업소 수(강남역 6,615)만큼 업종 조회가 반복된다.
     * 실제로 Nested Loop 에서만 330ms가 들었다. 집계 후에는 15행뿐이라 사실상 공짜다.
     *
     * 대분류로 묶을 때도 트리를 거슬러 올라가지 않는다. 코드가 접두어 구조라
     * 앞 두 자가 곧 대분류 코드다(G20405 → G2).
     * (예전에는 sub→mid→top 을 3번 조인해 2,042ms가 나왔다)
     */
    , agg AS (
      SELECT
        ${bySub ? sql`p.industry_code` : sql`substring(p.industry_code, 1, 2)`} AS code,
        count(*) AS c,
        -- 윈도 함수는 LIMIT보다 먼저 계산된다. 잘라내기 전 전체 합이 담긴다.
        sum(count(*)) OVER () AS total
      FROM place p
      CROSS JOIN center
      WHERE ST_DWithin(p.geom, center.g, ${p.radius})
        ${industryFilter(p.industry)}
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT ${topN}
    )
    SELECT a.code, i.name, a.c::text AS count, a.total::text AS total
    FROM agg a
    JOIN industry i ON i.code = a.code
    ORDER BY a.c DESC, i.name
  `

  return {
    // 결과가 없으면 행 자체가 없어서 total을 꺼낼 곳도 없다.
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    breakdown: rows.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) })),
  }
}

export type Churn = {
  /** 최신 분기에 살아 있는 업소 수 */
  active: number
  /** 이전 분기에 있었고 최신 분기에 없는 업소 수 */
  closed: number
  /** 최신 분기에 새로 나타난 업소 수 */
  opened: number
  /** 대조에 쓴 분기 (YYYYMM) */
  from: number
  to: number
}

/**
 * 이 자리 반경의 업소 회전.
 *
 * 원본에는 개업일도 폐업일도 없다. 분기 스냅샷 두 장을 대조해서만 구할 수 있고,
 * 그 대조 결과가 place_closed / place_opened 다(db/etl/churn.sql).
 *
 * closed 를 "폐업"이라 부르지 않는 이유: 보정 후에도 이전(移轉)·상호변경·
 * 데이터 정비가 섞여 있고 스냅샷 대조로는 가릴 수 없다. 화면에도 "사라진 곳"으로 적는다.
 *
 * 세 수를 한 번에 세지 않고 쿼리 세 개로 나눈다. 각각 다른 테이블의 GiST 인덱스를
 * 그대로 타는 편이, 억지로 합쳐 조인 계획을 흔드는 것보다 빠르다.
 */
export async function measureChurn(p: {
  lon: number
  lat: number
  radius: number
  industry?: string
}): Promise<Churn> {
  const [active, closed, opened] = await Promise.all([
    sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM place p
      WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
        ${industryFilter(p.industry)}
    `,
    sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM place_closed p
      WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
        ${industryFilter(p.industry)}
    `,
    // place_opened 는 좌표를 들고 있지 않다. 반경 판정은 place 의 GiST가 하고,
    // 신규 여부만 PK 조인으로 확인한다.
    sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM place p
      JOIN place_opened o ON o.place_id = p.place_id
      WHERE ST_DWithin(p.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
        ${industryFilter(p.industry)}
    `,
  ])

  return {
    active: Number(active[0].n),
    closed: Number(closed[0].n),
    opened: Number(opened[0].n),
    from: CHURN_FROM,
    to: CHURN_TO,
  }
}

/**
 * 대조한 두 분기. 데이터를 새로 넣을 때 함께 고쳐야 한다.
 * DB에서 읽어오지 않는 이유: 회전 테이블이 비어 있으면 분기를 알 수 없는데,
 * 그때도 화면은 "언제부터 언제까지"를 말해야 한다.
 */
export const CHURN_FROM = 202512
export const CHURN_TO = 202606
