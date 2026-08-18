'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

type Market = {
  name: string
  distanceM: number
  rentPerM2: number | null
  vacancyRate: number | null
}

type Candidate = {
  dongCode: string
  dongName: string
  sigungu: string
  lon: number
  lat: number
  count: number
  prev: number
  closeRate: number | null
  market: Market | null
}

type Result = { items: Candidate[]; scanned: number; minPrev: number }

/** 천원/㎡ → 10평(33㎡) 월 임대료(만원). MapPanel과 같은 환산이다. */
function rent10(perM2: number) {
  return Math.round(perM2 * 3.3)
}

/**
 * 조건에 맞는 자리 찾기.
 *
 * 이 서비스는 지금까지 "이 자리는 어떤가"만 답했다 — 자리를 이미 알고 있어야 쓸 수 있다.
 * 여기서는 질문을 뒤집는다: "어디가 좋은가".
 *
 * 단위는 행정동이다. 격자로 자르면 "여기"라고 부를 이름이 없고, 임대료·공실률은
 * 어차피 상권 단위라 그보다 잘게 쪼갤 근거가 없다.
 */
export default function SpotFinder({
  industry,
  industryName,
  onPick,
}: {
  industry: string
  industryName: string
  onPick: (spot: { lon: number; lat: number }) => void
}) {
  const [sido, setSido] = useState<'' | '서울' | '인천'>('')
  const [maxRent, setMaxRent] = useState('')
  const [maxCloseRate, setMaxCloseRate] = useState('')

  const q = useQuery({
    queryKey: ['search', industry, sido, maxRent, maxCloseRate],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ industry, limit: '20' })
      if (sido) params.set('sido', sido)
      if (maxRent) params.set('maxRent', maxRent)
      if (maxCloseRate) params.set('maxCloseRate', maxCloseRate)
      const res = await fetch(`/api/search?${params}`, { signal })
      if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`)
      return res.json() as Promise<Result>
    },
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  const field =
    'w-full rounded border border-line bg-raised px-2 py-1.5 text-sm text-paper placeholder:text-muted'

  return (
    <div className="px-5 py-5">
      <p className="text-sm leading-relaxed text-muted">
        <span className="text-paper">{industryName}</span> 기준으로 조건에 맞는 동네를 찾습니다.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <label className="text-xs text-muted">
          지역
          <select
            value={sido}
            onChange={(e) => setSido(e.target.value as '' | '서울' | '인천')}
            className={`${field} mt-1`}
          >
            <option value="">전체</option>
            <option value="서울">서울</option>
            <option value="인천">인천</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          임대료 이하
          <input
            type="number"
            inputMode="numeric"
            value={maxRent}
            onChange={(e) => setMaxRent(e.target.value)}
            placeholder="만원"
            className={`${field} measure mt-1`}
          />
        </label>
        <label className="text-xs text-muted">
          소멸률 이하
          <input
            type="number"
            inputMode="numeric"
            value={maxCloseRate}
            onChange={(e) => setMaxCloseRate(e.target.value)}
            placeholder="%"
            className={`${field} measure mt-1`}
          />
        </label>
      </div>

      {q.error && <p className="mt-4 text-sm text-paper">{q.error.message}</p>}

      {q.data && (
        <>
          <p className="mt-4 text-xs text-muted">
            조건에 맞는 동네 <span className="measure text-paper">{q.data.scanned}</span>곳 · 소멸률
            낮은 순
          </p>
          <ul className="mt-2 divide-y divide-line" style={{ opacity: q.isFetching ? 0.5 : 1 }}>
            {q.data.items.map((c) => (
              <li key={c.dongCode}>
                <button
                  type="button"
                  onClick={() => onPick({ lon: c.lon, lat: c.lat })}
                  className="w-full py-2.5 text-left hover:text-commerce"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-paper">
                      {c.sigungu} {c.dongName}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {c.closeRate === null ? (
                        <span title={`표본이 ${q.data.minPrev}곳 미만`}>소멸률 —</span>
                      ) : (
                        <>
                          소멸 <span className="measure text-commerce">{c.closeRate}</span>%
                        </>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                    <span>
                      <span className="measure">{c.count}</span>곳
                      {c.market && (
                        <>
                          {' · '}
                          {c.market.name}
                          {c.market.rentPerM2 !== null && (
                            <>
                              {' '}
                              <span className="measure">{rent10(c.market.rentPerM2)}</span>만원
                            </>
                          )}
                        </>
                      )}
                    </span>
                    {c.market?.vacancyRate != null && (
                      <span className="shrink-0">
                        공실 <span className="measure">{c.market.vacancyRate}</span>%
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {q.data.items.length === 0 && (
            <p className="mt-4 text-sm leading-relaxed text-muted">
              조건에 맞는 동네가 없습니다. 임대료나 소멸률 상한을 올려 보세요.
            </p>
          )}
          <p className="mt-4 text-xs leading-snug text-muted">
            임대료·공실률은 그 동네에서 가장 가까운 조사 상권 값입니다(3km 밖이면 표시하지
            않습니다). 소멸률은 이전 분기에 <span className="measure">{q.data.minPrev}</span>곳
            이상 있던 동네만 냅니다 — 표본이 작으면 비율이 튀어 뜻을 잃습니다.
          </p>
        </>
      )}
    </div>
  )
}
