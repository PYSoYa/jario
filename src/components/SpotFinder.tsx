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
  type Cond = { sido: '' | '서울' | '인천'; maxRent: string; maxCloseRate: string }
  const EMPTY: Cond = { sido: '', maxRent: '', maxCloseRate: '' }

  /**
   * 입력값(draft)과 조회에 쓰는 값(applied)을 나눈다.
   *
   * 하나로 두면 글자를 칠 때마다 조회가 나간다 — "150"을 치면 1, 15, 150으로 세 번이다.
   * 디바운스로 줄일 수도 있지만, 그러면 **언제 검색됐는지가 여전히 안 보인다**.
   * 버튼을 누른 순간에만 바뀌게 하면 조회 수도 줄고 화면도 설명이 된다.
   */
  const [draft, setDraft] = useState<Cond>(EMPTY)
  const [applied, setApplied] = useState<Cond>(EMPTY)
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied)

  const q = useQuery({
    queryKey: ['search', industry, applied.sido, applied.maxRent, applied.maxCloseRate],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ industry, limit: '20' })
      if (applied.sido) params.set('sido', applied.sido)
      if (applied.maxRent) params.set('maxRent', applied.maxRent)
      if (applied.maxCloseRate) params.set('maxCloseRate', applied.maxCloseRate)
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
        <span className="text-paper">{industryName}</span> 창업에 맞는 동네를 찾습니다. 조건을
        비워두면 전체에서 <span className="text-paper">소멸률이 낮은 순</span>으로 보여줍니다.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(draft)
        }}
      >
        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="text-xs text-muted">
            지역
            <select
              value={draft.sido}
              onChange={(e) => setDraft({ ...draft, sido: e.target.value as Cond['sido'] })}
              className={`${field} mt-1`}
            >
              <option value="">전체</option>
              <option value="서울">서울</option>
              <option value="인천">인천</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            월 임대료 이하
            <input
              type="number"
              inputMode="numeric"
              value={draft.maxRent}
              onChange={(e) => setDraft({ ...draft, maxRent: e.target.value })}
              placeholder="만원"
              className={`${field} measure mt-1`}
            />
          </label>
          <label className="text-xs text-muted">
            소멸률 이하
            <input
              type="number"
              inputMode="numeric"
              value={draft.maxCloseRate}
              onChange={(e) => setDraft({ ...draft, maxCloseRate: e.target.value })}
              placeholder="%"
              className={`${field} measure mt-1`}
            />
          </label>
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={!dirty || q.isFetching}
            className="flex-1 rounded border border-commerce px-3 py-2 text-sm text-commerce
                       transition-colors hover:bg-commerce/10 disabled:border-line
                       disabled:text-muted disabled:hover:bg-transparent"
          >
            {q.isFetching ? '찾는 중…' : dirty ? '이 조건으로 찾기' : '조건을 바꾸면 다시 찾습니다'}
          </button>
          {(applied.sido || applied.maxRent || applied.maxCloseRate) && (
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY)
                setApplied(EMPTY)
              }}
              className="rounded border border-line px-3 py-2 text-sm text-muted hover:text-paper"
            >
              초기화
            </button>
          )}
        </div>
      </form>

      {q.error && <p className="mt-4 text-sm text-paper">{q.error.message}</p>}

      {q.data && (
        <>
          <p className="mt-4 text-xs leading-snug text-muted">
            {[
              applied.sido || '서울·인천 전체',
              applied.maxRent && `월 ${applied.maxRent}만원 이하`,
              applied.maxCloseRate && `소멸률 ${applied.maxCloseRate}% 이하`,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            → 동네 <span className="measure text-paper">{q.data.scanned}</span>곳 · 소멸률 낮은 순
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
