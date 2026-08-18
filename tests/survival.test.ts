/**
 * 업종별 소멸률.
 *
 * 여기서 틀릴 수 있는 건 두 가지다 — 분모를 잘못 잡는 것, 그리고 표본이 작은 업종을
 * 걸러내지 않는 것. 둘 다 숫자가 조용히 이상해지고 에러는 안 난다.
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { sql } from '../src/lib/db.ts'
import { survivalByIndustry } from '../src/lib/places.ts'

const BUPYEONG = { lon: 126.7244, lat: 37.4894, radius: 500 }
let hasChurn = false

before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place_closed`
  hasChurn = row.n > 0
  if (!hasChurn) console.log('  (회전 테이블이 비어 있어 건너뜁니다)')
})

describe('survivalByIndustry', () => {
  it('표본이 작은 업종은 아예 넣지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const r = await survivalByIndustry(BUPYEONG)
    for (const it of r.items) {
      assert.ok(
        it.prev >= r.minPrev,
        `${it.name} 표본 ${it.prev}이 하한 ${r.minPrev} 미만인데 목록에 있다`,
      )
    }
  })

  it('분모는 지금이 아니라 이전 분기다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    // 지금 남은 수로 나누면 많이 사라진 업종일수록 분모가 작아져 비율이 부풀려진다.
    // prev = 지금 + 사라짐 - 새로생김 이므로, prev 는 closed 이상이어야 한다.
    const r = await survivalByIndustry(BUPYEONG)
    for (const it of r.items) {
      assert.ok(it.prev >= it.closed, `${it.name}: prev ${it.prev} < closed ${it.closed}`)
      const expected = Math.round((1000 * it.closed) / it.prev) / 10
      assert.ok(
        Math.abs(it.rate - expected) < 0.11,
        `${it.name}: rate ${it.rate} != ${expected} (${it.closed}/${it.prev})`,
      )
    }
  })

  it('비율은 0~100 안이고, 많이 사라진 순이다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const r = await survivalByIndustry(BUPYEONG)
    assert.ok(r.items.length > 0, '부평역 500m에서는 표본을 넘는 업종이 있어야 한다')
    let last = Infinity
    for (const it of r.items) {
      assert.ok(it.rate >= 0 && it.rate <= 100, `${it.name} ${it.rate}%`)
      assert.ok(it.rate <= last + 0.001, `정렬이 깨졌다: ${it.rate} > ${last}`)
      last = it.rate
    }
  })

  it('비교 기준(반경 전체)도 함께 준다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    // 12%가 높은 건지 낮은 건지는 이 자리 전체와 견줘야 알 수 있다.
    const r = await survivalByIndustry(BUPYEONG)
    assert.ok(r.baselineRate !== null && r.baselineRate >= 0 && r.baselineRate <= 100)
  })
})
