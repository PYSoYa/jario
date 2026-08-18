import { createHash } from 'node:crypto'
import { sql } from './db.ts'

/** 한 시간에 한 곳에서 만들 수 있는 리포트 수. */
export const REPORTS_PER_HOUR = 20

/**
 * 요청자를 식별한다.
 *
 * IP를 그대로 저장하지 않는다. 필요한 건 "같은 곳에서 몇 번 왔나"뿐이고,
 * 개인정보를 남길 이유가 없다. 소금을 섞어 해시한다 — 소금이 없으면 IP 공간이
 * 좁아서 해시를 되돌릴 수 있다.
 */
export function clientKey(request: Request): string {
  // Vercel은 x-forwarded-for 앞쪽에 실제 클라이언트 IP를 넣는다.
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  const salt = process.env.CRON_SECRET ?? 'jario'
  return createHash('sha256').update(`${salt}:${ip}`).digest('base64url').slice(0, 32)
}

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date }

/**
 * 시간 단위 창으로 센다.
 *
 * 서버리스라 프로세스 메모리 카운터는 인스턴스마다 따로 세어 소용이 없다.
 * DB에서 원자적으로 올리고 그 결과로 판단한다 — 읽고 나서 쓰면 동시 요청이
 * 한도를 넘길 수 있다.
 */
export async function takeReportQuota(key: string): Promise<RateLimitResult> {
  const [row] = await sql<{ count: number; window_at: Date }[]>`
    INSERT INTO report_quota (ip_hash, window_at, count)
    VALUES (${key}, date_trunc('hour', now()), 1)
    ON CONFLICT (ip_hash, window_at)
      DO UPDATE SET count = report_quota.count + 1
    RETURNING count, window_at
  `

  const resetAt = new Date(row.window_at.getTime() + 60 * 60 * 1000)
  return {
    allowed: row.count <= REPORTS_PER_HOUR,
    remaining: Math.max(0, REPORTS_PER_HOUR - row.count),
    resetAt,
  }
}

/** 지난 창을 정리한다. 남겨둬야 할 이유가 없다. */
export async function sweepReportQuota(): Promise<number> {
  const rows = await sql`
    DELETE FROM report_quota WHERE window_at < now() - interval '2 hours'
  `
  return rows.count
}
