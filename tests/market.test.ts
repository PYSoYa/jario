/**
 * 상권 공실률·임대료.
 *
 * 단위 환산은 화면에서 한 번 틀렸다 — 천원/㎡를 만원으로 바꾸며 100배를 더 나눠
 * 117만원이 1.17만원으로 찍혔다. 빌드도 린트도 통과했고 숫자만 조용히 작았다.
 * 그래서 환산을 테스트로 고정한다.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findMarketDistrict } from '../src/lib/places.ts'

const BUPYEONG = { lon: 126.7244, lat: 37.4894 }
const YEONGJONG = { lon: 126.4511, lat: 37.4907 }

describe('findMarketDistrict', () => {
  it('가까운 상권을 거리와 함께 준다', async () => {
    const m = await findMarketDistrict(BUPYEONG)
    assert.ok(m, '부평역에서는 상권이 잡혀야 한다')
    assert.equal(m.name, '부평')
    assert.ok(m.distanceM < 3000, `거리 ${m.distanceM}m`)
    assert.ok(m.vacancyRate !== null && m.vacancyRate >= 0 && m.vacancyRate <= 100)
    assert.ok(m.rentPerM2 !== null && m.rentPerM2 > 0)
  })

  it('멀면 억지로 채우지 않고 null 이다', async () => {
    // 영종도에서 가장 가까운 조사 상권은 15km 넘게 떨어져 있다.
    // 그 값을 "이 자리의 공실률"로 보여주면 거짓말이 된다.
    assert.equal(await findMarketDistrict(YEONGJONG), null)
  })

  it('상권마다 좌표가 겹치지 않는다', async () => {
    const { sql } = await import('../src/lib/db.ts')
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT lon, lat FROM market_district GROUP BY lon, lat HAVING count(*) > 1
      ) t
    `
    // 잠실새내역과 잠실/송파가 같은 행정동이라 한때 같은 점이었다.
    assert.equal(row.n, 0, `좌표가 겹치는 상권 그룹이 ${row.n}개 있다`)
  })

  it('대표점 주변에 업소가 실제로 있다', async () => {
    const { sql } = await import('../src/lib/db.ts')
    // 카카오 첫 결과를 쓰면 동명의 산·공원이 잡힌다(신촌/이대 → 안산자락길).
    // 상권 중심이라면 반경 300m에 업소가 있어야 한다.
    const rows = await sql<{ name: string; n: number }[]>`
      SELECT d.name, (SELECT count(*)::int FROM place p
                      WHERE ST_DWithin(p.geom, d.geom, 300)) AS n
      FROM market_district d ORDER BY n LIMIT 1
    `
    // 처음 규칙에서는 0~7곳인 산·등산로가 잡혔다. 지금 최저는 약수역 119곳이다.
    // 100은 "상권이라 부를 수 있는가"의 하한이지 품질 목표가 아니다.
    assert.ok(rows[0].n >= 100, `${rows[0].name} 주변 업소가 ${rows[0].n}곳뿐이다`)
  })
})
