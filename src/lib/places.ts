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

export type MarketDistrict = {
  name: string
  /** 이 자리에서 상권 대표점까지 거리(m) */
  distanceM: number
  /** 공실률 % */
  vacancyRate: number | null
  /** 임대료 천원/㎡ */
  rentPerM2: number | null
}

/**
 * 조사 상권까지 인정하는 최대 거리.
 *
 * 조사에는 상권 경계가 없다(구획도가 JPG 이미지다). 대표점 하나로 근사하므로,
 * 멀어지면 그 값은 이 자리와 무관해진다. 실측으로 정했다 —
 * 부평역 527m, 강남역 135m 는 맞고, 김포공항 4.5km · 영종도 15.5km 는 아니다.
 * 3km 를 넘으면 숫자를 내놓느니 아무것도 안 내놓는 편이 낫다.
 */
const MARKET_MAX_M = 3000

/**
 * 이 자리에서 가장 가까운 조사 상권의 공실률·임대료.
 *
 * "이 자리의 공실률"이 아니다. 경계를 모르므로 소속을 판정할 수 없고,
 * 화면에도 거리를 함께 적는다. 없으면 null 이다 — 억지로 채우지 않는다.
 */
export async function findMarketDistrict(p: {
  lon: number
  lat: number
}): Promise<MarketDistrict | null> {
  // KNN(<->)으로 가장 가까운 하나만 집는다. 68행이라 어떻게 해도 빠르지만,
  // 인덱스를 타는 형태로 두면 상권이 늘어도 그대로 쓸 수 있다.
  const [row] = await sql<
    { name: string; distance_m: number; vacancy: string | null; rent: string | null }[]
  >`
    SELECT d.name,
           ST_Distance(d.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography) AS distance_m,
           d.vacancy_rate::text AS vacancy,
           d.rent_per_m2::text  AS rent
    FROM market_district d
    ORDER BY d.geom <-> ST_MakePoint(${p.lon}, ${p.lat})::geography
    LIMIT 1
  `
  if (!row || row.distance_m > MARKET_MAX_M) return null
  return {
    name: row.name,
    distanceM: Math.round(row.distance_m),
    vacancyRate: row.vacancy === null ? null : Number(row.vacancy),
    rentPerM2: row.rent === null ? null : Number(row.rent),
  }
}

export type IndustrySurvival = {
  code: string
  name: string
  /** 이전 분기에 이 반경에 있던 수 (= 지금 + 사라짐 - 새로생김) */
  prev: number
  closed: number
  /** 사라진 비율 % */
  rate: number
}

/**
 * 표본 하한. 이보다 적은 업종은 아예 보여주지 않는다.
 *
 * 재서 정했다. 다섯 자리(부평역·강남역·홍대·주안·명동) 반경 500m에서 표본 구간별
 * 소멸률 분포를 보면, **평균은 7~8%로 일정한데 편차만 무너진다**:
 *
 *   표본  1–4  → 편차 15.6, 최대 100%   (2곳 중 1곳이면 50%다)
 *   표본  5–9  → 편차 12.8, 최대  66.7%
 *   표본 10–19 → 편차  8.0, 최대  31.3%
 *   표본 20–49 → 편차  6.8, 최대  33.3%
 *   표본 50+   → 편차  5.3, 최대  27.5%
 *
 * 20부터 편차가 평균 아래로 내려가고 그 뒤로는 완만하다. 더 올리면 표시되는 업종이
 * 너무 줄어든다. 이 값을 안 두면 "결혼 상담 서비스업 50% 사라짐"(2곳 중 1곳)이
 * 목록 맨 위에 온다 — 숫자는 맞지만 아무 뜻이 없다.
 */
const MIN_PREV = 20

/**
 * 이 자리 반경에서 업종별로 얼마나 사라졌나.
 *
 * 분모는 "지금"이 아니라 **이전 분기**다. 지금 남아 있는 것으로 나누면 많이 사라진
 * 업종일수록 분모가 작아져 비율이 부풀려진다. 이전 분기 수는 스냅샷 대조로 복원한다 —
 * 지금 + 사라짐 - 새로생김.
 */
export async function survivalByIndustry(p: {
  lon: number
  lat: number
  radius: number
  limit?: number
}): Promise<{ items: IndustrySurvival[]; baselineRate: number | null; minPrev: number }> {
  const limit = p.limit ?? 5
  const rows = await sql<
    { code: string; name: string; prev: string; closed: string; rate: string }[]
  >`
    WITH at AS (SELECT ST_MakePoint(${p.lon}, ${p.lat})::geography AS g),
    now_c AS (
      SELECT p.industry_code AS code, count(*) AS n
      FROM place p, at WHERE ST_DWithin(p.geom, at.g, ${p.radius}) GROUP BY 1
    ),
    closed_c AS (
      SELECT c.industry_code AS code, count(*) AS n
      FROM place_closed c, at WHERE ST_DWithin(c.geom, at.g, ${p.radius}) GROUP BY 1
    ),
    opened_c AS (
      SELECT p.industry_code AS code, count(*) AS n
      FROM place p JOIN place_opened o ON o.place_id = p.place_id, at
      WHERE ST_DWithin(p.geom, at.g, ${p.radius}) GROUP BY 1
    ),
    j AS (
      SELECT n.code,
             n.n + COALESCE(c.n, 0) - COALESCE(o.n, 0) AS prev,
             COALESCE(c.n, 0) AS closed
      FROM now_c n LEFT JOIN closed_c c ON c.code = n.code
                   LEFT JOIN opened_c o ON o.code = n.code
    )
    SELECT j.code, i.name, j.prev::text, j.closed::text,
           round(100.0 * j.closed / j.prev, 1)::text AS rate
    FROM j JOIN industry i ON i.code = j.code
    WHERE j.prev >= ${MIN_PREV}
    ORDER BY j.closed::numeric / j.prev DESC, j.prev DESC
    LIMIT ${limit}
  `

  // 비교 기준. 이 자리 전체가 몇 %인지 모르면 "12%"가 높은 건지 알 수 없다.
  const [base] = await sql<{ rate: string | null }[]>`
    WITH at AS (SELECT ST_MakePoint(${p.lon}, ${p.lat})::geography AS g),
    t AS (
      SELECT
        (SELECT count(*) FROM place p, at WHERE ST_DWithin(p.geom, at.g, ${p.radius})) AS now_n,
        (SELECT count(*) FROM place_closed c, at WHERE ST_DWithin(c.geom, at.g, ${p.radius})) AS closed_n,
        (SELECT count(*) FROM place p JOIN place_opened o ON o.place_id = p.place_id, at
          WHERE ST_DWithin(p.geom, at.g, ${p.radius})) AS opened_n
    )
    SELECT round(100.0 * closed_n / NULLIF(now_n + closed_n - opened_n, 0), 1)::text AS rate FROM t
  `

  return {
    items: rows.map((r) => ({
      code: r.code,
      name: r.name,
      prev: Number(r.prev),
      closed: Number(r.closed),
      rate: Number(r.rate),
    })),
    baselineRate: base?.rate == null ? null : Number(base.rate),
    minPrev: MIN_PREV,
  }
}

/**
 * 사라진 자리의 좌표.
 *
 * 패널은 "227곳 사라짐"이라고 말하지만 **어디서** 사라졌는지는 말하지 않는다.
 * 반경 전체 합계라 골목 단위의 쏠림이 안 보인다. 지도에 얹으면 그게 보인다.
 *
 * 살아 있는 마커와 같은 표본 규칙(hashtext)을 쓴다. 가까운 순으로 자르면
 * 사라진 곳이 중심에만 몰린 것처럼 보인다 — 살아 있는 쪽에서 이미 겪은 실수다.
 */
export async function findClosedPoints(p: {
  lon: number
  lat: number
  radius: number
  industry?: string
  limit?: number
}): Promise<{ points: { lon: number; lat: number }[]; total: number }> {
  const limit = p.limit ?? 300
  const rows = await sql<{ lon: number; lat: number; total: string }[]>`
    WITH hit AS (
      SELECT c.place_id, c.lon, c.lat
      FROM place_closed c
      WHERE ST_DWithin(c.geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
        ${p.industry ? sql`AND c.industry_code LIKE ${p.industry + '%'}` : sql``}
    )
    SELECT h.lon, h.lat, count(*) OVER ()::text AS total
    FROM hit h
    ORDER BY hashtext(h.place_id)
    LIMIT ${limit}
  `
  return {
    points: rows.map((r) => ({ lon: r.lon, lat: r.lat })),
    total: rows.length ? Number(rows[0].total) : 0,
  }
}
