/**
 * 회전율 통합 테스트.
 *
 * 회전 테이블은 CI 픽스처에 없다(픽스처는 최신 분기 한 장뿐이다). 비어 있으면
 * 건너뛰되, **건너뛴 사실을 남긴다** — 조용히 통과하면 로컬에서만 도는 기능이
 * CI에서 깨진 채로 배포된다.
 *
 * 실행: pnpm test
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { sql } from '../src/lib/db.ts'
import { CHURN_FROM, CHURN_TO, measureChurn } from '../src/lib/places.ts'

const BUPYEONG = { lon: 126.7244, lat: 37.4894 }

let hasChurn = false

before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place_closed`
  hasChurn = row.n > 0
  if (!hasChurn) {
    console.log('  (회전 테이블이 비어 있어 건너뜁니다 — db/etl/churn.sql 미실행)')
  }
})

describe('measureChurn', () => {
  it('대조한 분기를 그대로 돌려준다', { skip: false }, async () => {
    const c = await measureChurn({ ...BUPYEONG, radius: 500 })
    // 테이블이 비어 있어도 "언제부터 언제까지"는 답할 수 있어야 한다.
    assert.equal(c.from, CHURN_FROM)
    assert.equal(c.to, CHURN_TO)
    assert.ok(c.from < c.to, '이전 분기가 최신 분기보다 앞서야 한다')
  })

  it('반경을 넓히면 세 수가 모두 줄지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const near = await measureChurn({ ...BUPYEONG, radius: 300 })
    const far = await measureChurn({ ...BUPYEONG, radius: 1000 })
    assert.ok(far.active >= near.active, `영업중 ${far.active} < ${near.active}`)
    assert.ok(far.closed >= near.closed, `사라짐 ${far.closed} < ${near.closed}`)
    assert.ok(far.opened >= near.opened, `새로생김 ${far.opened} < ${near.opened}`)
  })

  it('업종을 좁히면 전체보다 많을 수 없다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const all = await measureChurn({ ...BUPYEONG, radius: 500 })
    const cafe = await measureChurn({ ...BUPYEONG, radius: 500, industry: 'I212' })
    assert.ok(cafe.closed <= all.closed)
    assert.ok(cafe.opened <= all.opened)
  })

  it('새로 생긴 곳은 전부 지금도 영업 중이다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    // place_opened 는 place 를 FK로 참조하지 않는다(transform.sql의 TRUNCATE 때문).
    // 참조 무결성을 DB가 안 지켜주므로 여기서 지킨다.
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM place_opened o
      WHERE NOT EXISTS (SELECT 1 FROM place p WHERE p.place_id = o.place_id)
    `
    assert.equal(row.n, 0, `place에 없는 place_opened 행이 ${row.n}건 있다`)
  })

  it('사라진 곳은 지금 목록에 없다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM place_closed c
      WHERE EXISTS (SELECT 1 FROM place p WHERE p.place_id = c.place_id)
    `
    assert.equal(row.n, 0, `사라졌다면서 place에도 있는 행이 ${row.n}건 있다`)
  })

  it('같은 이름·좌표가 살아 있으면 사라진 것으로 세지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    // 번호만 새로 발급된 경우다. 이걸 안 거르면 폐업 수를 30% 부풀려 말하게 된다.
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM place_closed c
      WHERE EXISTS (
        SELECT 1 FROM place p
        WHERE p.name = c.name AND p.lon = c.lon AND p.lat = c.lat
      )
    `
    assert.equal(row.n, 0, `이름·좌표가 그대로 살아 있는데 사라짐으로 센 행이 ${row.n}건`)
  })
})

describe('findClosedPoints', () => {
  it('반경 밖은 한 건도 넣지 않는다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const { findClosedPoints } = await import('../src/lib/places.ts')
    const r = await findClosedPoints({ ...BUPYEONG, radius: 300 })
    for (const p of r.points) {
      const [row] = await sql<{ d: number }[]>`
        SELECT ST_Distance(ST_MakePoint(${p.lon}, ${p.lat})::geography,
                           ST_MakePoint(${BUPYEONG.lon}, ${BUPYEONG.lat})::geography) AS d
      `
      assert.ok(row.d <= 300.5, `반경 밖 ${Math.round(row.d)}m`)
    }
  })

  it('총 개수는 표본과 따로 센다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const { findClosedPoints } = await import('../src/lib/places.ts')
    // 상한을 걸어도 total 은 잘리지 않은 수여야 한다. 잘린 수를 답으로 쓰면
    // 지도가 "여기는 조금만 사라졌다"고 거짓말한다.
    const few = await findClosedPoints({ ...BUPYEONG, radius: 500, limit: 5 })
    const all = await findClosedPoints({ ...BUPYEONG, radius: 500, limit: 10_000 })
    assert.equal(few.total, all.total)
    assert.ok(few.points.length <= 5)
  })

  it('사라진 수는 measureChurn 과 일치한다', async (t) => {
    if (!hasChurn) return t.skip('회전 데이터 없음')
    const { findClosedPoints } = await import('../src/lib/places.ts')
    const a = await measureChurn({ ...BUPYEONG, radius: 500 })
    const b = await findClosedPoints({ ...BUPYEONG, radius: 500, limit: 10_000 })
    assert.equal(a.closed, b.total, '패널 숫자와 지도 점 수가 다르면 둘 중 하나가 거짓말이다')
  })
})
