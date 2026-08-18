/**
 * 후보지 비교 리포트. 로컬 PostGIS에 데이터가 적재돼 있어야 한다.
 *
 * 여기서 만든 리포트는 after()에서 지운다. 로컬 DB는 실제 데이터가 들어 있는
 * 곳이라 테스트 찌꺼기를 남기지 않는다.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { industryBaseShare, measureSpot, DATA_VERSION } from '../src/lib/compare.ts'
import { sql } from '../src/lib/db.ts'
import { countNearby } from '../src/lib/places.ts'
import { createReport, getReport, getReportCard, reportInputSchema } from '../src/lib/reports.ts'

const BUPYEONG = { lon: 126.7244, lat: 37.4894 }
const GANGNAM = { lon: 127.0276, lat: 37.4979 }
const CAFE = 'I21201'

const created: string[] = []

before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place`
  if (row.n === 0) throw new Error('place 테이블이 비어 있습니다.')
})

after(async () => {
  if (created.length > 0) {
    await sql`DELETE FROM report WHERE id = ANY(${created})`
  }
  await sql.end()
})

async function make(industry: string | null = CAFE) {
  const id = await createReport({
    radius: 500,
    industry,
    a: { ...BUPYEONG, label: '부평역' },
    b: { ...GANGNAM, label: '강남역' },
  })
  created.push(id)
  return id
}

describe('reportInputSchema', () => {
  const base = { radius: 500, a: { lon: 126.7, lat: 37.4 }, b: { lon: 127.0, lat: 37.5 } }

  it('업종 없이도 저장할 수 있다', () => {
    assert.equal(reportInputSchema.safeParse(base).success, true)
    assert.equal(reportInputSchema.safeParse({ ...base, industry: null }).success, true)
  })

  it('한국 밖 좌표를 거부한다', () => {
    assert.equal(reportInputSchema.safeParse({ ...base, a: { lon: 999, lat: 37 } }).success, false)
    assert.equal(reportInputSchema.safeParse({ ...base, b: { lon: 127, lat: 0 } }).success, false)
  })

  it('반경 상한은 API와 같다', () => {
    assert.equal(reportInputSchema.safeParse({ ...base, radius: 2001 }).success, false)
    assert.equal(reportInputSchema.safeParse({ ...base, radius: 49 }).success, false)
  })

  it('업종 코드 형식과 라벨 길이를 검사한다', () => {
    assert.equal(reportInputSchema.safeParse({ ...base, industry: 'i2' }).success, false)
    assert.equal(
      reportInputSchema.safeParse({ ...base, a: { ...base.a, label: 'x'.repeat(41) } }).success,
      false,
    )
  })
})

describe('createReport / getReport', () => {
  it('id는 추측하기 어려운 난수다', async () => {
    const [a, b] = await Promise.all([make(), make()])
    assert.notEqual(a, b)
    // 순번이면 남의 리포트를 훑어볼 수 있다. 길이와 문자 집합을 고정해둔다.
    for (const id of [a, b]) {
      assert.match(id, /^[A-Za-z0-9_-]{12}$/, `추측 가능한 형태: ${id}`)
    }
  })

  it('없는 id는 null이다 (예외가 아니다)', async () => {
    assert.equal(await getReport('doesnotexist'), null)
    assert.equal(await getReportCard('doesnotexist'), null)
  })

  it('저장한 조건이 그대로 돌아온다', async () => {
    const id = await make(CAFE)
    const r = await getReport(id)
    assert.ok(r)
    assert.equal(r.radius, 500)
    assert.equal(r.industry?.code, CAFE)
    assert.equal(r.a.label, '부평역')
    assert.equal(r.b.label, '강남역')
    assert.equal(r.dataVersion, DATA_VERSION)
    assert.equal(r.stale, false)
  })

  it('지표를 저장하지 않고 볼 때 계산한다 — 직접 센 값과 같아야 한다', async () => {
    const id = await make(CAFE)
    const r = await getReport(id)
    assert.ok(r)

    const [aTotal, aTarget] = await Promise.all([
      countNearby({ ...BUPYEONG, radius: 500 }),
      countNearby({ ...BUPYEONG, radius: 500, industry: CAFE }),
    ])
    assert.equal(r.a.total, aTotal)
    assert.equal(r.a.targetCount, aTarget)
  })

  /**
   * OG 이미지는 getReportCard 를 쓴다. 가벼운 쿼리로 바꾸면서 값이 달라지면
   * 미리보기와 본문이 다른 숫자를 말하게 된다.
   */
  it('OG용 요약은 본문과 같은 숫자를 준다', async () => {
    const id = await make(CAFE)
    const [full, card] = await Promise.all([getReport(id), getReportCard(id)])
    assert.ok(full && card)
    assert.equal(card.radius, full.radius)
    assert.equal(card.industryName, full.industry?.name)
    assert.equal(card.a.total, full.a.total)
    assert.equal(card.a.target, full.a.targetCount)
    assert.equal(card.b.total, full.b.total)
    assert.equal(card.b.target, full.b.targetCount)
  })

  it('업종 없이 저장하면 업종 관련 값이 전부 비어 있다', async () => {
    const id = await make(null)
    const r = await getReport(id)
    assert.ok(r)
    assert.equal(r.industry, null)
    assert.equal(r.a.targetCount, null)
    assert.equal(r.a.nearestSameM, null)
    assert.equal(r.a.dong?.lq ?? null, null)
    // 업종과 무관한 값은 그대로 나와야 한다
    assert.ok(r.a.total > 0)
    assert.ok(r.a.topIndustries.length > 0)
  })
})

describe('measureSpot', () => {
  it('상위 업종은 5개 이하이고 많은 순이다', async () => {
    const s = await measureSpot({ ...BUPYEONG, radius: 500, industry: CAFE })
    assert.ok(s.topIndustries.length > 0 && s.topIndustries.length <= 5)
    for (let i = 1; i < s.topIndustries.length; i++) {
      assert.ok(s.topIndustries[i].count <= s.topIndustries[i - 1].count)
    }
  })

  it('자리가 속한 동을 찾는다', async () => {
    const s = await measureSpot({ ...BUPYEONG, radius: 500, industry: CAFE })
    assert.ok(s.dong, '가장 가까운 업소의 동을 찾지 못했다')
    assert.ok(s.dong.total > 0)
    assert.ok(s.dong.name.length > 0)
  })

  /** LQ = 동의 업종 비율 ÷ 전체 기준선. 기준선을 바꿔치면 값이 어긋난다. */
  it('LQ가 기준선과 맞물린다', async () => {
    const baseShare = await industryBaseShare(CAFE)
    assert.ok(baseShare && baseShare > 0)
    const s = await measureSpot({ ...BUPYEONG, radius: 500, industry: CAFE, baseShare })
    assert.ok(s.dong?.lq != null)

    const [row] = await sql<{ t: string; total: string }[]>`
      SELECT (SELECT count(*)::text FROM place
              WHERE adm_dong_code = ${s.dong.code} AND industry_code LIKE ${CAFE + '%'}) AS t,
             (SELECT total::text FROM dong_stat WHERE code = ${s.dong.code}) AS total
    `
    const expected = Number(row.t) / Number(row.total) / baseShare
    assert.ok(Math.abs(s.dong.lq - expected) < 1e-9, `LQ ${s.dong.lq} vs ${expected}`)
  })

  it('baseShare를 주지 않으면 LQ를 계산하지 않는다', async () => {
    const s = await measureSpot({ ...BUPYEONG, radius: 500, industry: CAFE })
    assert.equal(s.dong?.lq ?? null, null)
  })

  it('가장 가까운 동종 업소는 반경과 무관하게 찾는다', async () => {
    // 반경을 아주 좁혀도 "가장 가까운 카페"는 나와야 한다. 반경 밖에 있을 수 있다.
    const s = await measureSpot({ ...BUPYEONG, radius: 50, industry: CAFE })
    assert.ok(s.nearestSameM !== null && s.nearestSameM >= 0)
  })
})
