/**
 * 쿼리 검증 규칙. DB가 필요 없는 순수 테스트다.
 *
 * 여기 걸린 상한들이 서비스의 실질적인 안전장치라서, 누가 무심코 풀어버리면
 * 요청 한 번으로 인천 전체를 긁을 수 있게 된다. 그래서 값 자체를 고정한다.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nearbyQuerySchema as schema } from '../src/lib/nearby-query.ts'

const base = { lon: '126.7244', lat: '37.4894' }

describe('nearbyQuerySchema', () => {
  it('좌표만 주면 반경 500m, 최대 500건이 기본값이다', () => {
    const r = schema.parse(base)
    assert.equal(r.radius, 500)
    assert.equal(r.limit, 500)
    assert.equal(r.industry, undefined)
  })

  it('쿼리 스트링의 문자열을 숫자로 변환한다', () => {
    const r = schema.parse({ ...base, radius: '300', limit: '10' })
    assert.equal(r.radius, 300)
    assert.equal(r.limit, 10)
    assert.equal(typeof r.lon, 'number')
  })

  it('한국 밖 좌표를 거부한다 — 좌표계를 잘못 쓴 요청이다', () => {
    for (const bad of [{ lon: '999' }, { lon: '123' }, { lat: '0' }, { lat: '45' }]) {
      assert.equal(schema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad))
    }
  })

  it('좌표가 빠지면 거부한다', () => {
    assert.equal(schema.safeParse({ lat: base.lat }).success, false)
    assert.equal(schema.safeParse({ lon: base.lon }).success, false)
  })

  it('반경 상한은 2000m다', () => {
    assert.equal(schema.safeParse({ ...base, radius: '2000' }).success, true)
    assert.equal(schema.safeParse({ ...base, radius: '2001' }).success, false)
    assert.equal(schema.safeParse({ ...base, radius: '49' }).success, false)
    // 소수 반경은 의미가 없다
    assert.equal(schema.safeParse({ ...base, radius: '500.5' }).success, false)
  })

  it('목록 상한은 2000건이다', () => {
    assert.equal(schema.safeParse({ ...base, limit: '2000' }).success, true)
    assert.equal(schema.safeParse({ ...base, limit: '2001' }).success, false)
    assert.equal(schema.safeParse({ ...base, limit: '0' }).success, false)
  })

  it('정렬 기본값은 가까운 순이고, 정해진 두 값만 받는다', () => {
    assert.equal(schema.parse(base).order, 'distance')
    assert.equal(schema.parse({ ...base, order: 'sample' }).order, 'sample')
    assert.equal(schema.safeParse({ ...base, order: 'random()' }).success, false)
  })

  it('업종 코드는 대(2)·중(4)·소(6)자만 받는다', () => {
    for (const ok of ['I2', 'I201', 'I20102']) {
      assert.equal(schema.safeParse({ ...base, industry: ok }).success, true, ok)
    }
    // 홀수 길이·소문자·SQL 조각은 전부 막혀야 한다.
    // 접두어 LIKE 매칭에 그대로 쓰이는 값이라 형식이 곧 방어선이다.
    for (const bad of ['I', 'I20', 'i2', 'XX', "I2' OR '1'='1", 'I2%', 'I2010203']) {
      assert.equal(schema.safeParse({ ...base, industry: bad }).success, false, bad)
    }
  })
})
