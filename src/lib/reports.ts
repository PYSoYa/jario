import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { DATA_VERSION, measureSpot, type SpotMetrics } from './compare.ts'
import { sql } from './db.ts'

const spotInput = z.object({
  lon: z.number().min(124).max(132),
  lat: z.number().min(33).max(39),
  label: z.string().trim().max(40).optional(),
})

export const reportInputSchema = z.object({
  radius: z.number().int().min(50).max(2000),
  industry: z
    .string()
    .regex(/^[A-Z][0-9]([0-9]{2}){0,2}$/, '업종 코드 형식이 올바르지 않습니다')
    .nullish(),
  a: spotInput,
  b: spotInput,
})

export type ReportInput = z.infer<typeof reportInputSchema>

export type Report = {
  id: string
  createdAt: string
  radius: number
  industry: { code: string; name: string } | null
  a: { label: string | null } & SpotMetrics
  b: { label: string | null } & SpotMetrics
  dataVersion: string
  /** 저장 당시 데이터와 지금 데이터가 다른가 */
  stale: boolean
}

/**
 * URL에 들어갈 짧은 식별자.
 *
 * 순번을 쓰면 남의 리포트를 훑어볼 수 있다. 로그인이 없으므로 추측 불가능성이
 * 유일한 보호막이다. 12자 base64url ≈ 72비트.
 */
function newId() {
  return randomBytes(9).toString('base64url')
}

export async function createReport(input: ReportInput): Promise<string> {
  const id = newId()
  await sql`
    INSERT INTO report (id, radius, industry_code, a_lon, a_lat, a_label, b_lon, b_lat, b_label, data_version)
    VALUES (
      ${id}, ${input.radius}, ${input.industry ?? null},
      ${input.a.lon}, ${input.a.lat}, ${input.a.label ?? null},
      ${input.b.lon}, ${input.b.lat}, ${input.b.label ?? null},
      ${DATA_VERSION}
    )
  `
  return id
}

export async function getReport(id: string): Promise<Report | null> {
  const [row] = await sql<
    {
      id: string
      created_at: Date
      radius: number
      industry_code: string | null
      industry_name: string | null
      a_lon: number
      a_lat: number
      a_label: string | null
      b_lon: number
      b_lat: number
      b_label: string | null
      data_version: string
    }[]
  >`
    SELECT r.*, i.name AS industry_name
    FROM report r
    LEFT JOIN industry i ON i.code = r.industry_code
    WHERE r.id = ${id}
  `

  if (!row) return null

  // 지표는 저장하지 않고 볼 때 다시 계산한다. 같은 분기 데이터면 같은 값이 나온다.
  const [a, b] = await Promise.all([
    measureSpot({ lon: row.a_lon, lat: row.a_lat, radius: row.radius, industry: row.industry_code }),
    measureSpot({ lon: row.b_lon, lat: row.b_lat, radius: row.radius, industry: row.industry_code }),
  ])

  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    radius: row.radius,
    industry: row.industry_code ? { code: row.industry_code, name: row.industry_name! } : null,
    a: { label: row.a_label, ...a },
    b: { label: row.b_label, ...b },
    dataVersion: row.data_version,
    stale: row.data_version !== DATA_VERSION,
  }
}
