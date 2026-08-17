import { sql } from './db.ts'

export type DongStat = {
  code: string
  name: string
  sigungu: string
  /** 그 동의 전체 업소 수 */
  total: number
  /** 그 동의 해당 업종 업소 수 */
  target: number
  /** 그 동에서 해당 업종이 차지하는 비율 */
  share: number
  /**
   * 입지계수(Location Quotient) = 동의 업종 비율 ÷ 인천 전체의 업종 비율
   *
   * 1보다 크면 상권 규모에 비해 그 업종이 몰려 있고, 작으면 적다.
   * 업소 수를 그냥 비교하면 큰 동네가 항상 이기므로, 규모를 나눠서 본다.
   */
  lq: number
  lon: number
  lat: number
}

export type DongAnalysis = {
  /** 인천 전체에서 그 업종이 차지하는 비율. LQ의 기준선이다. */
  baseShare: number
  minTotal: number
  dongs: DongStat[]
}

/**
 * 행정동별 업종 편중도.
 *
 * minTotal로 작은 동을 걸러내는 이유: 업소가 20곳뿐인 섬 지역에서 카페 2곳이면
 * 비율 10%로 LQ가 2를 넘는다. 표본이 작아서 생긴 숫자를 "카페 성지"로 읽게 된다.
 */
export async function analyzeDongs(p: {
  industry: string
  minTotal?: number
}): Promise<DongAnalysis> {
  const minTotal = p.minTotal ?? 300

  const rows = await sql<
    {
      code: string
      name: string
      sigungu: string
      total: string
      target: string
      share: string
      lq: string
      lon: number
      lat: number
      base_share: string
    }[]
  >`
    WITH dong AS (
      SELECT
        adm_dong_code AS code,
        adm_dong_name AS name,
        sigungu_name  AS sigungu,
        count(*)                                                       AS total,
        count(*) FILTER (WHERE industry_code LIKE ${p.industry + '%'}) AS target,
        avg(lon) AS fallback_lon,
        avg(lat) AS fallback_lat
      FROM place
      GROUP BY 1, 2, 3
    ),
    /*
     * 동을 대표하는 지점 = 그 업종이 가장 빽빽한 곳.
     *
     * 평균 좌표는 쓸 수 없다. 강화 길상면처럼 넓은 지역은 카페 80곳이 흩어져 있어
     * 평균점이 아무것도 없는 한가운데에 떨어진다("카페 많은 동네"를 눌렀는데
     * 반경 500m에 0곳). 개항동도 전체 평균으로는 1곳이었다.
     *
     * 그래서 약 450m 격자로 묶는다. 다만 칸 하나만 보면 안 된다 — 칸(450m)이
     * 반경(500m)보다 작아서, 인접한 두 밀집 칸 사이의 지점이 어느 한 칸의 중심보다
     * 나을 수 있다(송도4동에서 실제로 그랬다). 3×3 이웃을 합쳐 반경에 가깝게 본 뒤,
     * 그 이웃 안 업소들의 무게중심을 쓴다.
     *
     * 업소마다 반경 질의를 도는 방식보다 훨씬 싸다(집계 1회 + 동 안에서만 자기조인).
     */
    cell AS (
      SELECT
        adm_dong_code AS code,
        round(lon / 0.005) AS gx,
        round(lat / 0.004) AS gy,
        count(*) AS c,
        sum(lon) AS slon,
        sum(lat) AS slat
      FROM place
      WHERE industry_code LIKE ${p.industry + '%'}
      GROUP BY 1, 2, 3
    ),
    smoothed AS (
      SELECT
        a.code, a.gx, a.gy,
        sum(b.c) AS c,
        sum(b.slon) / sum(b.c) AS lon,
        sum(b.slat) / sum(b.c) AS lat
      FROM cell a
      JOIN cell b
        ON b.code = a.code
       AND b.gx BETWEEN a.gx - 1 AND a.gx + 1
       AND b.gy BETWEEN a.gy - 1 AND a.gy + 1
      GROUP BY 1, 2, 3
    ),
    hotspot AS (
      SELECT DISTINCT ON (code) code, lon, lat
      FROM smoothed
      ORDER BY code, c DESC, lon
    ),
    base AS (
      SELECT
        count(*) FILTER (WHERE industry_code LIKE ${p.industry + '%'})::numeric
          / NULLIF(count(*), 0) AS share
      FROM place
    )
    SELECT
      d.code, d.name, d.sigungu,
      d.total::text, d.target::text,
      (d.target::numeric / d.total)::text AS share,
      ((d.target::numeric / d.total) / NULLIF(b.share, 0))::text AS lq,
      -- 그 업종이 한 곳도 없는 동은 hotspot이 없으므로 전체 평균으로 되돌린다.
      COALESCE(h.lon, d.fallback_lon) AS lon,
      COALESCE(h.lat, d.fallback_lat) AS lat,
      b.share::text AS base_share
    FROM dong d
    CROSS JOIN base b
    LEFT JOIN hotspot h ON h.code = d.code
    WHERE d.total >= ${minTotal}
    ORDER BY lq DESC NULLS LAST, d.total DESC
  `

  return {
    baseShare: rows.length > 0 ? Number(rows[0].base_share) : 0,
    minTotal,
    dongs: rows.map((r) => ({
      code: r.code,
      name: r.name,
      sigungu: r.sigungu,
      total: Number(r.total),
      target: Number(r.target),
      share: Number(r.share),
      lq: Number(r.lq),
      lon: r.lon,
      lat: r.lat,
    })),
  }
}
