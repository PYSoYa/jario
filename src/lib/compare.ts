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
 * LQ 기준선 — 전체 지역에서 그 업종이 차지하는 비율.
 *
 * 자리마다 구하면 안 된다. 업종에만 달린 값인데 A·B 각각 계산하면 두 배다.
 * 그리고 `count(*) FILTER (...) / count(*) FROM place` 로 쓰면 691,087행을
 * 통째로 훑어 977ms가 걸린다 — analyzeDongs에서 이미 겪은 실수다.
 * 분모는 dong_stat 합계(585행)에서, 분자는 커버링 인덱스로 세면 22ms다.
 */
export async function industryBaseShare(industry: string | null): Promise<number | null> {
  if (!industry) return null
  const [row] = await sql<{ share: string | null }[]>`
    SELECT (
      (SELECT count(*)::numeric FROM place WHERE industry_code LIKE ${industry + '%'})
      / NULLIF((SELECT sum(total)::numeric FROM dong_stat), 0)
    )::text AS share
  `
  return row?.share === null || row?.share === undefined ? null : Number(row.share)
}

/**
 * 자리 한 곳의 지표.
 *
 * 쿼리를 병렬로 보낸다. 순차로 두면 왕복 지연이 그대로 쌓여서, A·B 합쳐
 * 여덟 번을 기다리게 된다(리포트가 10초 걸렸다).
 */
export async function measureSpot(p: {
  lon: number
  lat: number
  radius: number
  industry?: string | null
  /** industryBaseShare()로 미리 구한 값. 없으면 LQ를 계산하지 않는다. */
  baseShare?: number | null
}): Promise<SpotMetrics> {
  const prefix = p.industry ? p.industry + '%' : null
  const guard = <T,>(q: Promise<T>) => {
    q.catch(() => {})
    return q
  }

  const [counts, top, dongRow, nearest] = await Promise.all([
    guard(sql<{ total: string; target: string | null }[]>`
      SELECT
        count(*)::text AS total,
        ${prefix
          ? sql`count(*) FILTER (WHERE industry_code LIKE ${prefix})::text`
          : sql`NULL::text`} AS target
      FROM place
      WHERE ST_DWithin(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
    `),

    // 집계를 먼저 하고 이름은 마지막에 붙인다.
    guard(sql<{ code: string; name: string; count: string }[]>`
      WITH agg AS (
        SELECT industry_code AS code, count(*) AS c
        FROM place
        WHERE ST_DWithin(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography, ${p.radius})
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 5
      )
      SELECT a.code, i.name, a.c::text AS count
      FROM agg a JOIN industry i ON i.code = a.code
      ORDER BY a.c DESC
    `),

    // 이 자리가 속한 동 = 가장 가까운 업소의 동(경계 데이터가 없어 쓰는 근사).
    // 동 정보와 그 동의 업종 수까지 한 번에 가져온다.
    guard(sql<{ code: string; name: string; sigungu: string; total: string; t: string | null }[]>`
      WITH nearest AS (
        SELECT adm_dong_code AS code
        FROM place
        ORDER BY geom <-> ST_MakePoint(${p.lon}, ${p.lat})::geography
        LIMIT 1
      )
      SELECT d.code, d.name, d.sigungu, d.total::text,
        ${prefix
          ? sql`(SELECT count(*)::text FROM place
                  WHERE adm_dong_code = d.code AND industry_code LIKE ${prefix})`
          : sql`NULL::text`} AS t
      FROM dong_stat d
      JOIN nearest n ON n.code = d.code
    `),

    prefix
      ? guard(sql<{ d: number }[]>`
          SELECT ST_Distance(geom, ST_MakePoint(${p.lon}, ${p.lat})::geography) AS d
          FROM place
          WHERE industry_code LIKE ${prefix}
          ORDER BY geom <-> ST_MakePoint(${p.lon}, ${p.lat})::geography
          LIMIT 1
        `)
      : Promise.resolve([] as { d: number }[]),
  ])

  const c = counts[0]
  const d = dongRow[0]

  return {
    lon: p.lon,
    lat: p.lat,
    total: Number(c.total),
    targetCount: c.target === null ? null : Number(c.target),
    topIndustries: top.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) })),
    dong: d
      ? {
          code: d.code,
          name: d.name,
          sigungu: d.sigungu,
          total: Number(d.total),
          lq:
            d.t === null || !p.baseShare
              ? null
              : Number(d.t) / Number(d.total) / p.baseShare,
        }
      : null,
    nearestSameM: nearest[0] ? Math.round(nearest[0].d) : null,
  }
}
