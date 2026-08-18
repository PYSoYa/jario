/**
 * 리포트 생성 제한.
 *
 * 로그인이 없어서 이 방어가 뚫리면 무료 티어 DB가 리포트로 찬다.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { sql } from '../src/lib/db.ts'
import { REPORTS_PER_HOUR, clientKey, sweepReportQuota, takeReportQuota } from '../src/lib/rate-limit.ts'

const keys: string[] = []

function freshKey(tag: string) {
  const k = `test-${tag}-${process.pid}`
  keys.push(k)
  return k
}

after(async () => {
  if (keys.length > 0) await sql`DELETE FROM report_quota WHERE ip_hash = ANY(${keys})`
  await sql.end()
})

describe('clientKey', () => {
  const req = (headers: Record<string, string>) =>
    new Request('http://x/api/reports', { method: 'POST', headers })

  it('IP를 그대로 담지 않는다', () => {
    const key = clientKey(req({ 'x-real-ip': '203.0.113.9' }))
    assert.ok(!key.includes('203.0.113.9'), '해시에 원본 IP가 남았다')
    assert.match(key, /^[A-Za-z0-9_-]{32}$/)
  })

  it('같은 IP는 같은 키, 다른 IP는 다른 키', () => {
    const a = clientKey(req({ 'x-real-ip': '203.0.113.9' }))
    const b = clientKey(req({ 'x-real-ip': '203.0.113.9' }))
    const c = clientKey(req({ 'x-real-ip': '203.0.113.10' }))
    assert.equal(a, b)
    assert.notEqual(a, c)
  })

  it('x-forwarded-for 는 맨 앞(실제 클라이언트)을 쓴다', () => {
    const viaChain = clientKey(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' }))
    const direct = clientKey(req({ 'x-real-ip': '203.0.113.9' }))
    assert.equal(viaChain, direct, '프록시 체인 뒤쪽 주소로 세면 모두가 한 사람이 된다')
  })

  it('헤더가 없어도 죽지 않는다', () => {
    assert.match(clientKey(req({})), /^[A-Za-z0-9_-]{32}$/)
  })
})

describe('takeReportQuota', () => {
  it('한도까지 허용하고 넘으면 막는다', async () => {
    const key = freshKey('limit')
    for (let i = 1; i <= REPORTS_PER_HOUR; i++) {
      const r = await takeReportQuota(key)
      assert.equal(r.allowed, true, `${i}번째가 막혔다`)
      assert.equal(r.remaining, REPORTS_PER_HOUR - i)
    }
    const over = await takeReportQuota(key)
    assert.equal(over.allowed, false)
    assert.equal(over.remaining, 0)
  })

  it('다른 요청자는 서로 영향을 주지 않는다', async () => {
    const a = freshKey('iso-a')
    const b = freshKey('iso-b')
    for (let i = 0; i < REPORTS_PER_HOUR + 1; i++) await takeReportQuota(a)
    const r = await takeReportQuota(b)
    assert.equal(r.allowed, true)
  })

  /**
   * 읽고 나서 쓰면 동시 요청이 한도를 넘길 수 있다. INSERT ... ON CONFLICT 로
   * 원자적으로 올리는지 확인한다.
   */
  it('동시에 들어와도 정확히 센다', async () => {
    const key = freshKey('race')
    const n = 30
    const results = await Promise.all(Array.from({ length: n }, () => takeReportQuota(key)))
    const allowed = results.filter((r) => r.allowed).length

    assert.equal(allowed, REPORTS_PER_HOUR, `동시 ${n}건 중 ${allowed}건 허용됐다`)

    const [row] = await sql<{ count: number }[]>`
      SELECT count FROM report_quota WHERE ip_hash = ${key} AND window_at = date_trunc('hour', now())
    `
    assert.equal(row.count, n, '카운터가 유실됐다')
  })

  it('reset 시각은 창의 끝이다', async () => {
    const r = await takeReportQuota(freshKey('reset'))
    const diff = r.resetAt.getTime() - Date.now()
    assert.ok(diff > 0 && diff <= 60 * 60 * 1000, `resetAt 이 ${diff}ms 뒤다`)
  })
})

describe('sweepReportQuota', () => {
  it('지난 창만 지운다', async () => {
    const old = freshKey('old')
    const now = freshKey('now')
    await sql`
      INSERT INTO report_quota (ip_hash, window_at, count)
      VALUES (${old}, date_trunc('hour', now() - interval '5 hours'), 3)
    `
    await takeReportQuota(now)

    await sweepReportQuota()

    const [{ n: oldLeft }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM report_quota WHERE ip_hash = ${old}
    `
    const [{ n: nowLeft }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM report_quota WHERE ip_hash = ${now}
    `
    assert.equal(oldLeft, 0, '지난 창이 남았다')
    assert.equal(nowLeft, 1, '현재 창이 지워졌다')
  })
})
