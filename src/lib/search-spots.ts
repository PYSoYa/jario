import { sql } from './db.ts'

export type SpotCandidate = {
  dongCode: string
  dongName: string
  sigungu: string
  lon: number
  lat: number
  /** 이 동의 해당 업종 업소 수 */
  count: number
  /** 이전 분기 수 (지금 + 사라짐 - 새로생김) */
  prev: number
  /** 사라진 비율 % */
  closeRate: number | null
  /** 가장 가까운 조사 상권 */
  market: { name: string; distanceM: number; rentPerM2: number | null; vacancyRate: number | null } | null
}

export type SpotSearch = {
  items: SpotCandidate[]
  /** 조건을 걸기 전 후보 동 수 */
  scanned: number
  minPrev: number
  /**
   * 이 결과를 만든 조건. 화면이 자기가 보낸 값이 아니라 **이 값을** 표시해야 한다.
   *
   * 이전 결과를 유지한 채 새로 조회하면(keepPreviousData) 라벨만 먼저 바뀌어
   * "월 150만원 이하 → 532곳"처럼 조건과 숫자가 어긋난다. 532는 조건 없는 수다.
   * 숫자와 설명이 어긋나면 둘 중 하나가 거짓말이다.
   */
  applied: { sido: string | null; maxRent: number | null; maxCloseRate: number | null }
}

/**
 * 동 전체 업소 수 하한. 이보다 작은 동은 아예 후보에서 뺀다.
 * analyzeDongs와 같은 이유다 — 업소가 20곳뿐인 동에서 카페 2곳은 비율이 무의미하다.
 */
const MIN_DONG_TOTAL = 300

/**
 * 소멸률을 계산할 최소 표본. survivalByIndustry의 MIN_PREV와 같은 값이고 같은 근거다.
 * 미만이면 closeRate를 null로 둔다 — 0%로 두면 "안전한 동네"로 정렬 맨 위에 온다.
 */
const MIN_PREV = 20

/**
 * 조건에 맞는 자리를 찾는다.
 *
 * 지금까지 이 서비스는 "이 자리는 어떤가"만 답했다. 자리를 이미 알고 있어야 쓸 수 있다.
 * 이 함수는 질문을 뒤집는다 — "어디가 좋은가".
 *
 * 단위는 행정동이다. 격자로 자르면 "여기"라고 부를 이름이 없고, 임대료·공실률은
 * 어차피 상권 단위라 그보다 잘게 쪼갤 근거가 없다.
 */
export async function searchSpots(p: {
  industry: string
  /** 10평 월 임대료 상한(만원). 없으면 임대료로 거르지 않는다. */
  maxRent?: number
  /** 소멸률 상한(%). 없으면 거르지 않는다. */
  maxCloseRate?: number
  /** 이 업종 업소 수 상한 — 경쟁이 적은 곳을 찾을 때 */
  maxCount?: number
  sido?: '서울' | '인천'
  limit?: number
}): Promise<SpotSearch> {
  const limit = p.limit ?? 20
  const prefix = p.industry + '%'
  // 만원 → 천원/㎡ (10평 = 33㎡, 만원 = 천원/㎡ × 3.3)
  const maxRentPerM2 = p.maxRent === undefined ? null : p.maxRent / 3.3

  const rows = await sql<
    {
      code: string
      name: string
      sigungu: string
      lon: number
      lat: number
      cnt: string
      prev: string
      rate: string | null
      m_name: string | null
      m_dist: number | null
      m_rent: string | null
      m_vac: string | null
      scanned: string
    }[]
  >`
    WITH d AS (
      SELECT code, name, sigungu, total, lon, lat
      FROM dong_stat
      WHERE total >= ${MIN_DONG_TOTAL}
        ${p.sido ? sql`AND sigungu IN (SELECT DISTINCT sigungu_name FROM place WHERE sido_name LIKE ${p.sido + '%'})` : sql``}
    ),
    cur AS (
      SELECT adm_dong_code AS c, count(*) AS n FROM place
      WHERE industry_code LIKE ${prefix} GROUP BY 1
    ),
    cls AS (
      SELECT adm_dong_code AS c, count(*) AS n FROM place_closed
      WHERE industry_code LIKE ${prefix} GROUP BY 1
    ),
    opn AS (
      SELECT p.adm_dong_code AS c, count(*) AS n FROM place p
      JOIN place_opened o ON o.place_id = p.place_id
      WHERE p.industry_code LIKE ${prefix} GROUP BY 1
    ),
    j AS (
      SELECT d.*,
             COALESCE(cur.n, 0) AS cnt,
             COALESCE(cur.n, 0) + COALESCE(cls.n, 0) - COALESCE(opn.n, 0) AS prev,
             COALESCE(cls.n, 0) AS closed
      FROM d LEFT JOIN cur ON cur.c = d.code
             LEFT JOIN cls ON cls.c = d.code
             LEFT JOIN opn ON opn.c = d.code
    ),
    m AS (
      SELECT j.*, md.name AS m_name, md.rent_per_m2 AS m_rent, md.vacancy_rate AS m_vac,
             ST_Distance(md.geom, ST_MakePoint(j.lon, j.lat)::geography) AS m_dist
      FROM j LEFT JOIN LATERAL (
        SELECT name, rent_per_m2, vacancy_rate, geom FROM market_district
        ORDER BY geom <-> ST_MakePoint(j.lon, j.lat)::geography LIMIT 1
      ) md ON true
    ),
    f AS (
      SELECT m.*,
             -- 표본이 적으면 비율을 내지 않는다. 0%로 두면 "안전한 동네"로 맨 위에 온다.
             CASE WHEN prev >= ${MIN_PREV} THEN round(100.0 * closed / prev, 1) END AS rate,
             -- 3km를 넘으면 그 상권 값은 이 동네와 무관하다. 이 자리 화면과 같은 규칙이다.
             CASE WHEN m_dist <= 3000 THEN m_name END AS near_name
      FROM m
    )
    SELECT code, name, sigungu, lon, lat,
           cnt::text, prev::text, rate::text,
           near_name AS m_name,
           CASE WHEN near_name IS NULL THEN NULL ELSE m_dist END AS m_dist,
           CASE WHEN near_name IS NULL THEN NULL ELSE m_rent END::text AS m_rent,
           CASE WHEN near_name IS NULL THEN NULL ELSE m_vac END::text AS m_vac,
           count(*) OVER ()::text AS scanned
    FROM f
    WHERE cnt > 0
      ${maxRentPerM2 === null ? sql`` : sql`AND near_name IS NOT NULL AND m_rent <= ${maxRentPerM2}`}
      ${p.maxCloseRate === undefined ? sql`` : sql`AND rate IS NOT NULL AND rate <= ${p.maxCloseRate}`}
      ${p.maxCount === undefined ? sql`` : sql`AND cnt <= ${p.maxCount}`}
    -- 소멸률이 낮은 순. 같으면 업소가 많은 쪽(상권이 살아 있는 쪽)을 먼저.
    ORDER BY rate NULLS LAST, cnt DESC
    LIMIT ${limit}
  `

  return {
    applied: {
      sido: p.sido ?? null,
      maxRent: p.maxRent ?? null,
      maxCloseRate: p.maxCloseRate ?? null,
    },
    items: rows.map((r) => ({
      dongCode: r.code,
      dongName: r.name,
      sigungu: r.sigungu,
      lon: r.lon,
      lat: r.lat,
      count: Number(r.cnt),
      prev: Number(r.prev),
      closeRate: r.rate === null ? null : Number(r.rate),
      market:
        r.m_name === null
          ? null
          : {
              name: r.m_name,
              distanceM: Math.round(r.m_dist ?? 0),
              rentPerM2: r.m_rent === null ? null : Number(r.m_rent),
              vacancyRate: r.m_vac === null ? null : Number(r.m_vac),
            },
    })),
    scanned: rows.length ? Number(rows[0].scanned) : 0,
    minPrev: MIN_PREV,
  }
}
