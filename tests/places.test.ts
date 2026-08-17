/**
 * 공간 쿼리 통합 테스트. 로컬 PostGIS에 인천 데이터가 적재돼 있어야 한다.
 *
 * 왜 목(mock)을 쓰지 않는가: 이 프로젝트에서 틀릴 수 있는 건 TypeScript가 아니라
 * SQL이다. geography 거리 계산, 업종 접두어 매칭, 인덱스 사용 — 전부 DB 안에서
 * 일어난다. 목으로 대체하면 정작 검증하고 싶은 것이 사라진다.
 *
 * 실행: pnpm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { sql } from '../src/lib/db.ts'
import { findNearbyPlaces, summarizeNearby } from '../src/lib/places.ts'

/** 부평역. 인천에서 가장 밀집한 상권이라 경계 조건을 만들기 좋다. */
const BUPYEONG = { lon: 126.7244, lat: 37.4894 }

let loaded = 0

before(async () => {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM place`
  loaded = row.n
  if (loaded === 0) {
    throw new Error(
      'place 테이블이 비어 있습니다. README의 "데이터 적재"를 먼저 수행하세요.\n' +
        '목으로 대체하지 않는 이유는 이 파일 상단 주석 참고.',
    )
  }
})

after(async () => {
  await sql.end()
})

describe('findNearbyPlaces', () => {
  it('가까운 순으로 정렬한다', async () => {
    const rows = await findNearbyPlaces({ ...BUPYEONG, radius: 500, limit: 50 })
    assert.ok(rows.length > 0)
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        rows[i].distanceM >= rows[i - 1].distanceM,
        `${i}번째가 앞보다 가깝다: ${rows[i].distanceM} < ${rows[i - 1].distanceM}`,
      )
    }
  })

  it('반경 밖은 한 건도 포함하지 않는다', async () => {
    const radius = 300
    const rows = await findNearbyPlaces({ ...BUPYEONG, radius, limit: 2000 })
    const over = rows.filter((r) => r.distanceM > radius)
    assert.deepEqual(over, [], `반경 ${radius}m를 넘는 결과가 ${over.length}건 있다`)
  })

  /**
   * 이 테스트가 이 파일의 핵심이다.
   *
   * EPSG:4326에서 ST_Distance의 단위는 미터가 아니라 도(degree)다. 누군가
   * geography를 geometry로 바꾸거나 상수 곱셈으로 "최적화"하면 거리가 조용히
   * 틀어지는데, 총 개수만 보면 그럴듯해서 눈치채기 어렵다.
   * 특정 업소 하나를 경계 양쪽에서 확인해 그걸 잡는다.
   */
  it('반경 경계에서 특정 업소가 정확히 들고 난다', async () => {
    const [nearest] = await findNearbyPlaces({ ...BUPYEONG, radius: 500, limit: 1 })
    assert.ok(nearest, '부평역 반경 500m에 업소가 없다')

    const d = nearest.distanceM
    const inside = await findNearbyPlaces({ ...BUPYEONG, radius: d + 5, limit: 2000 })
    const outside = await findNearbyPlaces({ ...BUPYEONG, radius: Math.max(d - 5, 1), limit: 2000 })

    assert.ok(
      inside.some((r) => r.placeId === nearest.placeId),
      `반경 ${d + 5}m에 ${d}m 거리의 업소가 없다`,
    )
    assert.ok(
      !outside.some((r) => r.placeId === nearest.placeId),
      `반경 ${d - 5}m에 ${d}m 거리의 업소가 포함됐다 — 거리 단위가 미터가 아닐 수 있다`,
    )
  })

  it('반경을 넓히면 결과가 줄지 않는다', async () => {
    const small = await summarizeNearby({ ...BUPYEONG, radius: 300 })
    const large = await summarizeNearby({ ...BUPYEONG, radius: 1000 })
    assert.ok(large.total >= small.total, `1000m(${large.total}) < 300m(${small.total})`)
  })
})

describe('마커 표본 추출 (order: sample)', () => {
  /**
   * 지도 마커를 '가까운 순 N개'로 뽑으면, 밀집 지역에서는 중심 근처에서 N개가
   * 다 소진돼 바깥이 텅 비어 보인다. 총 개수는 맞는데 지도만 거짓말을 한다.
   * 부평역 반경 500m에서 실제로 그랬다 — 500개가 전부 120m 안에 있었다.
   */
  it('표본은 반경 전체에 퍼지고, 가까운 순은 중심에 몰린다', async () => {
    const q = { ...BUPYEONG, radius: 500, limit: 500 }
    const [near, sample] = await Promise.all([
      findNearbyPlaces({ ...q, order: 'distance' }),
      findNearbyPlaces({ ...q, order: 'sample' }),
    ])

    assert.equal(near.length, 500, '이 테스트는 총계 > 500인 지점을 전제한다')
    assert.equal(sample.length, 500)

    const farNear = Math.max(...near.map((r) => r.distanceM))
    const farSample = Math.max(...sample.map((r) => r.distanceM))

    assert.ok(
      farSample > farNear * 2,
      `표본이 퍼지지 않았다: 가까운순 최대 ${farNear}m, 표본 최대 ${farSample}m`,
    )
    // 반경의 바깥 절반까지 실제로 닿아야 한다
    assert.ok(farSample > 400, `표본 최대 거리 ${farSample}m — 반경 500m를 대표하지 못한다`)
  })

  it('표본도 반경을 넘지 않는다', async () => {
    const rows = await findNearbyPlaces({ ...BUPYEONG, radius: 300, limit: 500, order: 'sample' })
    assert.deepEqual(
      rows.filter((r) => r.distanceM > 300),
      [],
    )
  })

  it('같은 입력이면 같은 표본이다 — 새로고침마다 마커가 바뀌면 안 된다', async () => {
    const q = { ...BUPYEONG, radius: 500, limit: 100, order: 'sample' } as const
    const [a, b] = await Promise.all([findNearbyPlaces(q), findNearbyPlaces(q)])
    assert.deepEqual(
      a.map((r) => r.placeId),
      b.map((r) => r.placeId),
    )
  })
})

describe('summarizeNearby', () => {
  it('분포가 다 담기면 총계는 업종별 합계와 일치한다', async () => {
    // 대분류는 10개뿐이라 topN 안에 전부 들어온다.
    const s = await summarizeNearby({ ...BUPYEONG, radius: 500, group: 'top', topN: 50 })
    const sum = s.breakdown.reduce((a, r) => a + r.count, 0)
    assert.equal(s.total, sum)
  })

  /**
   * 총계는 윈도 함수로 LIMIT 이전에 계산한다. 이걸 breakdown 합으로 바꾸면
   * 상위 N개만 더한 값이 "반경 안 업소 수"로 표시되어 조용히 작아진다.
   */
  it('분포를 잘라도 총계는 잘리지 않는다', async () => {
    const s = await summarizeNearby({ ...BUPYEONG, radius: 500, group: 'sub', topN: 3 })
    const sum = s.breakdown.reduce((a, r) => a + r.count, 0)
    assert.equal(s.breakdown.length, 3)
    assert.ok(s.total > sum, `총계(${s.total})가 상위 3개 합(${sum})으로 잘렸다`)
  })

  it('목록이 잘려도 총계는 잘리지 않는다', async () => {
    const radius = 500
    const limit = 10
    const [items, summary] = await Promise.all([
      findNearbyPlaces({ ...BUPYEONG, radius, limit }),
      summarizeNearby({ ...BUPYEONG, radius }),
    ])
    assert.equal(items.length, limit)
    assert.ok(
      summary.total > limit,
      '이 테스트는 총계 > limit인 지점을 전제한다. 데이터가 바뀌었으면 기준점을 조정하라.',
    )
  })

  it('소분류 분포는 사람이 아는 이름으로 나온다', async () => {
    const s = await summarizeNearby({ ...BUPYEONG, radius: 500, group: 'sub', topN: 30 })
    const names = s.breakdown.map((r) => r.name)
    // 대분류('소매', '음식')만 나오면 창업자가 판단에 쓸 수 없다.
    assert.ok(
      names.some((n) => ['편의점', '미용실', '카페', '노래방', '약국'].includes(n)),
      `구체 업종이 하나도 없다: ${names.slice(0, 10).join(', ')}`,
    )
    // 소분류 코드는 6자다
    assert.ok(s.breakdown.every((r) => r.code.length === 6), '소분류 코드가 6자가 아니다')
  })
})

describe('업종 접두어 필터', () => {
  it('대분류로 거르면 그 업종만 남고, 개수가 무필터 집계와 맞는다', async () => {
    const all = await summarizeNearby({ ...BUPYEONG, radius: 500, group: 'top', topN: 50 })
    const food = all.breakdown.find((r) => r.name === '음식')
    assert.ok(food, '부평역 반경 500m에 음식 업종이 없다')

    const filtered = await summarizeNearby({
      ...BUPYEONG,
      radius: 500,
      industry: food.code,
      group: 'top',
      topN: 50,
    })
    assert.equal(filtered.breakdown.length, 1)
    assert.equal(filtered.breakdown[0].code, food.code)
    assert.equal(filtered.total, food.count)
  })

  /**
   * 업종 코드가 접두어 구조(G2 → G204 → G20404)라는 전제 위에 필터가 서 있다.
   * 그 전제가 깨지면 소분류 결과가 상위 분류 결과의 부분집합이 아니게 된다.
   */
  it('소분류 ⊆ 중분류 ⊆ 대분류', async () => {
    const [sub] = await sql<{ code: string }[]>`
      SELECT code FROM industry WHERE level = 3 AND code LIKE 'I2%' ORDER BY code LIMIT 1
    `
    assert.ok(sub, '소분류 업종 코드를 찾지 못했다')

    const [small, mid, top] = await Promise.all([
      summarizeNearby({ ...BUPYEONG, radius: 1000, industry: sub.code }),
      summarizeNearby({ ...BUPYEONG, radius: 1000, industry: sub.code.slice(0, 4) }),
      summarizeNearby({ ...BUPYEONG, radius: 1000, industry: sub.code.slice(0, 2) }),
    ])

    assert.ok(small.total <= mid.total, `${sub.code}(${small.total}) > 중분류(${mid.total})`)
    assert.ok(mid.total <= top.total, `중분류(${mid.total}) > 대분류(${top.total})`)
    assert.ok(small.total > 0, '표본이 0건이라 포함관계를 검증할 수 없다')
  })

  it('없는 업종 코드는 빈 결과를 준다 (에러가 아니다)', async () => {
    const r = await summarizeNearby({ ...BUPYEONG, radius: 500, industry: 'Z9' })
    assert.equal(r.total, 0)
    assert.deepEqual(r.breakdown, [])
  })
})

describe('데이터 무결성', () => {
  it('모든 업소가 한국 좌표 범위 안에 있다', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM place
      WHERE lon NOT BETWEEN 124 AND 132 OR lat NOT BETWEEN 33 AND 39
    `
    assert.equal(row.n, 0)
  })

  it('geom이 lon/lat과 어긋나지 않는다 (생성 컬럼)', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM place
      WHERE ST_Distance(geom, ST_MakePoint(lon, lat)::geography) > 0.001
    `
    assert.equal(row.n, 0)
  })
})
