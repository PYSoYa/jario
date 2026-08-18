/**
 * 조건 검색.
 *
 * "이 자리는 어떤가"를 뒤집어 "어디가 좋은가"에 답한다. 여기서 틀릴 수 있는 건
 * 조건이 실제로 걸리지 않는 것과, 표본이 작은 동네가 0%로 맨 위에 오는 것이다.
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { sql } from '../src/lib/db.ts'
import { searchSpots } from '../src/lib/search-spots.ts'

let hasChurn = false
before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place_closed`
  hasChurn = row.n > 0
  if (!hasChurn) console.log('  (회전 테이블이 비어 있어 일부를 건너뜁니다)')
})

describe('searchSpots', () => {
  it('업종 조건이 실제로 걸린다', async () => {
    const r = await searchSpots({ industry: 'I212', limit: 5 })
    for (const c of r.items) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM place
        WHERE adm_dong_code = ${c.dongCode} AND industry_code LIKE 'I212%'
      `
      assert.equal(c.count, row.n, `${c.dongName}: ${c.count} != ${row.n}`)
    }
  })

  it('임대료 상한을 넘는 곳은 나오지 않는다', async () => {
    const cap = 100
    const r = await searchSpots({ industry: 'I212', maxRent: cap, limit: 20 })
    for (const c of r.items) {
      assert.ok(c.market, `${c.dongName}: 임대료 조건을 걸었는데 상권이 없다`)
      assert.ok(
        c.market.rentPerM2 !== null && Math.round(c.market.rentPerM2 * 3.3) <= cap + 1,
        `${c.dongName}: ${Math.round((c.market.rentPerM2 ?? 0) * 3.3)}만원 > ${cap}`,
      )
    }
  })

  it('조건을 좁히면 결과가 늘지 않는다', async () => {
    const wide = await searchSpots({ industry: 'I212', limit: 50 })
    const narrow = await searchSpots({ industry: 'I212', maxRent: 80, limit: 50 })
    assert.ok(narrow.scanned <= wide.scanned, `${narrow.scanned} > ${wide.scanned}`)
  })

  it('표본이 작으면 소멸률을 0%로 채우지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    // null 대신 0을 쓰면 "가장 안전한 동네"로 정렬 맨 위에 온다. 실제로는 모르는 것이다.
    const r = await searchSpots({ industry: 'I212', limit: 50 })
    for (const c of r.items) {
      if (c.prev < r.minPrev) {
        assert.equal(c.closeRate, null, `${c.dongName}: 표본 ${c.prev}인데 ${c.closeRate}%`)
      }
    }
  })

  it('소멸률 상한을 넘는 곳은 나오지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const r = await searchSpots({ industry: 'I212', maxCloseRate: 5, limit: 30 })
    for (const c of r.items) {
      assert.ok(c.closeRate !== null && c.closeRate <= 5, `${c.dongName}: ${c.closeRate}%`)
    }
  })

  it('결과가 자기를 만든 조건을 함께 돌려준다', async () => {
    // 화면이 보낸 값을 그대로 그리면, 이전 결과를 유지하는 동안 라벨만 먼저 바뀌어
    // "150만원 이하 → 532곳"처럼 조건과 숫자가 어긋난다. 532는 조건 없는 수다.
    const r = await searchSpots({ industry: 'I212', maxRent: 150, sido: '서울', limit: 5 })
    assert.deepEqual(r.applied, { sido: '서울', maxRent: 150, maxCloseRate: null })
    const none = await searchSpots({ industry: 'I212', limit: 5 })
    assert.deepEqual(none.applied, { sido: null, maxRent: null, maxCloseRate: null })
  })

  it('상권은 3km 안일 때만 붙인다', async () => {
    const r = await searchSpots({ industry: 'I212', limit: 50 })
    for (const c of r.items) {
      if (c.market) assert.ok(c.market.distanceM <= 3000, `${c.dongName}: ${c.market.distanceM}m`)
    }
  })
})
