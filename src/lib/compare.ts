import { sql } from './db.ts'

/** 이 배포가 담고 있는 상가 데이터의 기준 분기. 리포트에 함께 저장한다. */
export const DATA_VERSION = '202606'

export type SpotMetrics = {
  lon: number
  lat: number
  /** 반경 안 전체 업소 수 */
  total: number
  /** 선택한 업종의 업소 수. 업종을 안 고르면 null */
  targetCount: number | null
  /** 상위 업종(소분류) */
  topIndustries: { code: string; name: string; count: number }[]
  /** 이 자리가 속한 행정동. 경계 폴리곤이 없어 가장 가까운 업소의 동으로 본다. */
  dong: { code: string; name: string; sigungu: string; total: number; lq: number | null } | null
  /** 가장 가까운 동종 업소까지 거리(m). 업종 미선택이거나 없으면 null */
  nearestSameM: number | null
}

/**
 * 자리 한 곳의 지표를 모은다.
 *
 * 쿼리를 여러 번 나눈 이유: 하나로 합치면 조인이 반경 안 업소 수만큼 반복되면서
 * 오히려 느려진다(반경 검색 최적화에서 겪었다). 각각은 인덱스를 그대로 탄다.
 */
export async function measureSpot(p: {
  lon: number
  lat: number
  radius: number
  industry?: string | null
}): Promise<SpotMetrics> {
  const prefix = p.industry ? p.industry + '%' : null

  const [counts] = await sql<{ total: string; target: string | null }[]>`
    SELECT
      count(*)::text AS total,
      ${prefix
        ? sql`count(*) FILTER (WHERE industry_code LIKE ${prefix})::text`
        : sql`NULL::text`} AS target
    FROM place
    WHERE ST_DWithin(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
  `

  // 상위 업종. 집계를 먼저 하고 이름은 마지막에 붙인다.
  const top = await sql<{ code: string; name: string; count: string }[]>`
    WITH agg AS (
      SELECT industry_code AS code, count(*) AS c
      FROM place
      WHERE ST_DWithin(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 5
    )
    SELECT a.code, i.name, a.c::text AS count
    FROM agg a JOIN industry i ON i.code = a.code
    ORDER BY a.c DESC
  `

  // 이 자리가 속한 동 = 가장 가까운 업소의 동. 경계 데이터가 없어서 쓰는 근사다.
  const [near] = await sql<{ adm_dong_code: string }[]>`
    SELECT adm_dong_code
    FROM place
    ORDER BY geom <-> ST_MakePoint(${p.lon}, ${p.lat})::geography
    LIMIT 1
  `

  let dong: SpotMetrics['dong'] = null
  if (near) {
    const [row] = await sql<
      { code: string; name: string; sigungu: string; total: string; lq: string | null }[]
    >`
      SELECT
        d.code, d.name, d.sigungu, d.total::text,
        ${prefix
          ? sql`(
              (SELECT count(*) FILTER (WHERE industry_code LIKE ${prefix})::numeric
                 FROM place WHERE adm_dong_code = d.code) / d.total
              / NULLIF((SELECT count(*) FILTER (WHERE industry_code LIKE ${prefix})::numeric
                          / count(*) FROM place), 0)
            )::text`
          : sql`NULL::text`} AS lq
      FROM dong_stat d
      WHERE d.code = ${near.adm_dong_code}
    `
    if (row) {
      dong = {
        code: row.code,
        name: row.name,
        sigungu: row.sigungu,
        total: Number(row.total),
        lq: row.lq === null ? null : Number(row.lq),
      }
    }
  }

  let nearestSameM: number | null = null
  if (prefix) {
    const [row] = await sql<{ d: number }[]>`
      SELECT ST_Distance(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography) AS d
      FROM place
      WHERE industry_code LIKE ${prefix}
      ORDER BY geom <-> ST_MakePoint(${p.lon}, ${p.lat})::geography
      LIMIT 1
    `
    nearestSameM = row ? Math.round(row.d) : null
  }

  return {
    lon: p.lon,
    lat: p.lat,
    total: Number(counts.total),
    targetCount: counts.target === null ? null : Number(counts.target),
    topIndustries: top.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) })),
    dong,
    nearestSameM,
  }
}
