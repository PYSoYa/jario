/**
 * 행정동 입지계수(LQ) 분석. 로컬 PostGIS에 인천 데이터가 적재돼 있어야 한다.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { analyzeDongs } from '../src/lib/analysis.ts'
import { sql } from '../src/lib/db.ts'
import { summarizeNearby } from '../src/lib/places.ts'

const CAFE = 'I21201'

/**
 * 전체 데이터인가, CI용 시드 픽스처인가.
 *
 * 픽스처는 행정동 11개만 담은 부분집합이라, "어떤 지점의 반경 500m 이웃"이
 * 픽스처 경계 밖으로 뻗는다. 그런 이웃을 비교하는 검증은 부분 데이터에서
 * 성립할 수 없다. 데이터 크기로 판별해 그런 테스트만 건너뛴다.
 */
let fullDataset = false

before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place`
  if (row.n === 0) throw new Error('place 테이블이 비어 있습니다. README의 "데이터 적재" 참고.')
  fullDataset = row.n > 100_000
})

after(async () => {
  await sql.end()
})

describe('analyzeDongs', () => {
  it('LQ가 큰 순으로 정렬된다', async () => {
    const { dongs } = await analyzeDongs({ industry: CAFE })
    assert.ok(dongs.length > 0)
    for (let i = 1; i < dongs.length; i++) {
      assert.ok(dongs[i].lq <= dongs[i - 1].lq, `${i}번째 LQ가 앞보다 크다`)
    }
  })

  /**
   * LQ는 전체 평균을 1로 두는 상대 지표다. 각 동을 업소 수로 가중 평균하면
   * 1 근처로 모여야 한다. 여기서 크게 벗어나면 기준선(baseShare) 계산이 틀린 것이다.
   * (minTotal로 작은 동을 잘라내므로 정확히 1은 아니다)
   */
  it('업소 수로 가중 평균한 LQ는 1 근처다', async () => {
    const { dongs } = await analyzeDongs({ industry: CAFE, minTotal: 0 })
    const totalPlaces = dongs.reduce((a, d) => a + d.total, 0)
    const weighted = dongs.reduce((a, d) => a + d.lq * d.total, 0) / totalPlaces
    assert.ok(Math.abs(weighted - 1) < 0.02, `가중 평균 LQ가 ${weighted.toFixed(3)}`)
  })

  it('share와 lq가 서로 맞는다', async () => {
    const { dongs, baseShare } = await analyzeDongs({ industry: CAFE })
    for (const d of dongs.slice(0, 20)) {
      assert.ok(Math.abs(d.share - d.target / d.total) < 1e-9, `${d.name} share 불일치`)
      assert.ok(Math.abs(d.lq - d.share / baseShare) < 1e-6, `${d.name} lq 불일치`)
    }
  })

  it('minTotal 미만인 동은 제외한다', async () => {
    const { dongs } = await analyzeDongs({ industry: CAFE, minTotal: 500 })
    assert.deepEqual(
      dongs.filter((d) => d.total < 500),
      [],
    )
    const all = await analyzeDongs({ industry: CAFE, minTotal: 0 })
    assert.ok(all.dongs.length > dongs.length, 'minTotal이 아무것도 걸러내지 못했다')
  })

  /**
   * 이 테스트가 이 파일의 핵심이다.
   *
   * 동의 대표 지점을 평균 좌표로 잡으면, 넓게 흩어진 동에서 그 점이 정작
   * 해당 업종이 없는 곳에 떨어진다. 실제로 개항동은 반경 500m에 카페 1곳,
   * 강화 길상면은 0곳이었다 — "카페가 가장 몰린 동네"라고 안내하면서.
   * 대표 지점은 반드시 그 업종이 실제로 모인 곳이어야 한다.
   */
  it('대표 지점은 평균 좌표보다 그 업종에 가깝다', async (t) => {
    if (!fullDataset) {
      // 두 지점의 반경 500m 이웃을 비교하는데, 픽스처에서는 그 이웃이 경계 밖으로
      // 뻗으면서 두 지점이 서로 다르게 잘린다. 부분 데이터로는 판정할 수 없다.
      t.skip('전체 데이터가 필요합니다 (CI 픽스처에서는 반경 이웃이 잘림)')
      return
    }

    const { dongs } = await analyzeDongs({ industry: CAFE })
    const top = dongs.slice(0, 6)

    const compared = await Promise.all(
      top.map(async (d) => {
        // 예전 방식: 동 전체 업소의 평균 좌표
        const [plain] = await sql<{ lon: number; lat: number }[]>`
          SELECT avg(lon) AS lon, avg(lat) AS lat FROM place WHERE adm_dong_code = ${d.code}
        `
        const [hot, avg] = await Promise.all([
          summarizeNearby({ lon: d.lon, lat: d.lat, radius: 500, industry: CAFE }),
          summarizeNearby({ lon: plain.lon, lat: plain.lat, radius: 500, industry: CAFE }),
        ])
        return { name: d.name, hot: hot.total, avg: avg.total }
      }),
    )

    for (const c of compared) {
      // 절대 조건: 대표 지점이 그 업종을 하나도 못 잡으면
      // "몰린 동네"라는 안내가 거짓이 된다. 이게 원래 고치려던 문제다.
      assert.ok(c.hot > 0, `${c.name}의 대표 지점 반경 500m에 한 곳도 없다`)

      // 격자 방식은 휴리스틱이라, 업종이 고르게 깔린 동에서는 단순 평균이
      // 우연히 근소하게 나을 수 있다(안암동 96 vs 98). 의미 있게 나빠지지만
      // 않으면 된다.
      assert.ok(
        c.hot >= c.avg * 0.95,
        `${c.name}: 대표 지점(${c.hot}곳)이 단순 평균(${c.avg}곳)보다 뚜렷하게 나쁘다`,
      )
    }

    // 전체로 보면 확실히 나아야 한다. 넓게 흩어진 동에서 평균이 크게 빗나가는 것이
    // 이 방식을 쓰는 이유이므로, 합계 차이로 확인한다.
    const hot = compared.reduce((a, c) => a + c.hot, 0)
    const avg = compared.reduce((a, c) => a + c.avg, 0)
    assert.ok(hot > avg, `합계가 나아지지 않았다: 대표 ${hot} vs 평균 ${avg}`)
  })

  it('없는 업종이면 모든 LQ가 0이고 좌표는 여전히 유효하다', async () => {
    const { dongs, baseShare } = await analyzeDongs({ industry: 'Z9' })
    assert.equal(baseShare, 0)
    for (const d of dongs.slice(0, 5)) {
      assert.equal(d.target, 0)
      // baseShare가 0이라 lq는 계산 불가(NaN). 좌표는 대체값으로 살아 있어야 한다.
      assert.ok(Number.isFinite(d.lon) && Number.isFinite(d.lat), `${d.name} 좌표가 없다`)
    }
  })
})
