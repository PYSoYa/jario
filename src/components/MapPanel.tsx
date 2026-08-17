'use client'

import { useQuery } from '@tanstack/react-query'
import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'

type Industry = { code: string; name: string }

type NearbyResponse = {
  total: number
  truncated: boolean
  byTopIndustry: { code: string; name: string; count: number }[]
  items: {
    placeId: string
    name: string
    industryName: string
    roadAddress: string | null
    floorNo: number | null
    lon: number
    lat: number
    distanceM: number
  }[]
}

const RADII = [300, 500, 1000] as const
type Radius = (typeof RADII)[number]

/** 부평역. 내 위치를 못 쓰거나 데이터 범위 밖일 때의 기준점. */
const START = { lat: 37.4894, lon: 126.7244 }

/**
 * 적재된 데이터(인천)의 실제 좌표 범위. 실사에서 얻은 값에 여유를 조금 뒀다.
 * 이 밖에서는 결과가 0이 나오는 게 정상이므로, 빈 화면 대신 이유를 말해준다.
 */
const COVERAGE = { minLon: 124.5, maxLon: 126.9, minLat: 36.8, maxLat: 38.05 }

function withinCoverage(lon: number, lat: number) {
  return (
    lon >= COVERAGE.minLon &&
    lon <= COVERAGE.maxLon &&
    lat >= COVERAGE.minLat &&
    lat <= COVERAGE.maxLat
  )
}

/**
 * 업소 마커. 카카오 기본 핀은 빨강이라 우리 반경 표시와 부딪히고,
 * 배경 지도의 상점 아이콘과도 구분이 안 된다.
 * 흰 테두리를 두른 작은 점으로 바꾼다 — 라벨이 빽빽한 지도 위에서는
 * 색보다 흰 테두리가 형태를 살려준다.
 */
const DOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
<circle cx="7" cy="7" r="4.5" fill="#e0447f" stroke="#fff" stroke-width="2"/></svg>`

/**
 * 내가 찍은 자리 표식.
 *
 * 동그라미로 두면 클러스터 마커와 형태가 같아서, 색만으로는 "내가 찍은 점"과
 * "업소 뭉치"가 구분되지 않는다. 측량 표식(크로스헤어)으로 바꿔 형태 자체를 다르게 한다.
 * 흰 선을 먼저 굵게 깔아 어떤 배경 위에서도 형태가 살아남게 했다.
 */
const CROSSHAIR = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
<g stroke-linecap="round">
  <g stroke="#ffffff" stroke-width="6">
    <path d="M19 2v9M19 27v9M2 19h9M27 19h9"/>
  </g>
  <g stroke="#c01f5c" stroke-width="2.5">
    <path d="M19 2v9M19 27v9M2 19h9M27 19h9"/>
  </g>
</g>
<circle cx="19" cy="19" r="6" fill="#c01f5c" stroke="#ffffff" stroke-width="2.5"/>
</svg>`

/** 클러스터 크기 구간별 스타일. 어두운 판에 흰 숫자 — 밝은 지도 위에서 가장 잘 읽힌다. */
function clusterStyle(size: number, font: string) {
  return {
    width: `${size}px`,
    height: `${size}px`,
    lineHeight: `${size}px`,
    background: 'rgba(20,17,26,0.92)',
    border: '2px solid #e0447f',
    borderRadius: '9999px',
    color: '#f3eff2',
    textAlign: 'center',
    fontSize: font,
    fontWeight: '600',
    fontFamily: 'var(--font-plex-mono), ui-monospace, monospace',
    boxShadow: '0 0 0 2px rgba(255,255,255,0.85)',
  }
}

/**
 * 밀도 색은 순위가 아니라 최대 업종 대비 비율로 정한다.
 * 순위로 칠하면 2위가 1위의 90%든 5%든 같은 색이 되어 색이 아무것도 말해주지 않는다.
 */
function toneFor(share: number) {
  if (share >= 0.8) return 'var(--density-5)'
  if (share >= 0.5) return 'var(--density-4)'
  if (share >= 0.25) return 'var(--density-3)'
  if (share >= 0.1) return 'var(--density-2)'
  return 'var(--density-1)'
}

function formatRadius(m: number) {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`
}

async function fetchNearby(
  q: { lon: number; lat: number; radius: number; industry?: string },
  signal: AbortSignal,
): Promise<NearbyResponse> {
  const params = new URLSearchParams({
    lon: String(q.lon),
    lat: String(q.lat),
    radius: String(q.radius),
  })
  if (q.industry) params.set('industry', q.industry)

  const res = await fetch(`/api/places/nearby?${params}`, { signal })
  if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`)
  return res.json()
}

export default function MapPanel({ industries }: { industries: Industry[] }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<kakao.maps.Map | null>(null)
  const circle = useRef<kakao.maps.Circle | null>(null)
  const halo = useRef<kakao.maps.Circle | null>(null)
  const pin = useRef<kakao.maps.CustomOverlay | null>(null)
  const clusterer = useRef<kakao.maps.MarkerClusterer | null>(null)
  const clickTimer = useRef<number | undefined>(undefined)

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [center, setCenter] = useState(START)
  const [radius, setRadius] = useState<Radius>(500)
  const [industry, setIndustry] = useState('')
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 현재 위치로 이동한다.
   *
   * silent는 첫 진입에서만 쓴다 — 사용자가 요청하지도 않았는데 권한 거부 문구를
   * 띄우면 잔소리가 된다. 버튼으로 명시적으로 눌렀을 때는 실패 이유를 말해준다.
   */
  const locate = useCallback(({ silent }: { silent: boolean }) => {
    if (!navigator.geolocation) {
      if (!silent) setNotice('이 브라우저에서는 현재 위치를 쓸 수 없습니다.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const lon = pos.coords.longitude
        const lat = pos.coords.latitude

        // 범위 밖이면 옮기지 않는다. 옮겨봐야 0곳만 나오고 왜인지 알 수 없다.
        if (!withinCoverage(lon, lat)) {
          setNotice('현재 위치가 인천 밖입니다. 지금은 인천 데이터만 있어 부평역을 기준으로 보여줍니다.')
          return
        }

        setNotice(null)
        setCenter({ lon, lat })
        map.current?.panTo(new window.kakao.maps.LatLng(lat, lon))
      },
      () => {
        setLocating(false)
        if (!silent) setNotice('위치를 가져오지 못했습니다. 브라우저의 위치 권한을 확인하세요.')
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [])

  // 분포는 항상 업종 필터 없이 받는다. 필터를 걸어도 주변 업종 구성을
  // 계속 볼 수 있어야 "이 자리가 무슨 상권인지"를 판단할 수 있다.
  const contextQuery = useQuery({
    queryKey: ['nearby', center.lon, center.lat, radius, ''],
    queryFn: ({ signal }) => fetchNearby({ ...center, radius }, signal),
  })

  // 업종을 고르면 지도 마커와 헤드라인 숫자만 그 업종으로 좁힌다.
  const focusQuery = useQuery({
    queryKey: ['nearby', center.lon, center.lat, radius, industry],
    queryFn: ({ signal }) => fetchNearby({ ...center, radius, industry }, signal),
    enabled: industry !== '',
  })

  const context = contextQuery.data ?? null
  const focused = industry ? (focusQuery.data ?? null) : context
  const loading = contextQuery.isFetching || focusQuery.isFetching
  const error = contextQuery.error ?? focusQuery.error

  const initMap = useCallback(() => {
    if (!mapRef.current || map.current) return
    const { kakao } = window

    map.current = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(START.lat, START.lon),
      level: 4,
    })

    clusterer.current = new kakao.maps.MarkerClusterer({
      map: map.current,
      averageCenter: true,
      minLevel: 4,
      disableClickZoom: false,
      calculator: [10, 100, 500],
      styles: [
        clusterStyle(32, '12px'),
        clusterStyle(40, '13px'),
        clusterStyle(50, '14px'),
        clusterStyle(60, '15px'),
      ],
    })

    // 카카오 기본 더블클릭 확대와 "클릭 = 자리 선택"이 겹친다.
    // 그대로 두면 확대할 때마다 고른 자리가 딸려 움직인다.
    // 클릭을 잠깐 미뤄두고, 곧바로 더블클릭이 오면 취소한다.
    kakao.maps.event.addListener(map.current, 'click', (e) => {
      const lat = e.latLng.getLat()
      const lon = e.latLng.getLng()
      window.clearTimeout(clickTimer.current)
      clickTimer.current = window.setTimeout(() => {
        setNotice(null)
        setCenter({ lat, lon })
      }, 260)
    })

    kakao.maps.event.addListener(map.current, 'dblclick', () => {
      window.clearTimeout(clickTimer.current)
    })

    setReady(true)
    locate({ silent: true })
  }, [locate])

  // 반경 원과 중심 핀을 다시 그린다.
  useEffect(() => {
    if (!ready || !map.current) return
    const { kakao } = window
    const at = new kakao.maps.LatLng(center.lat, center.lon)

    // 반경 원은 두 겹으로 그린다.
    // 카카오 기본 지도는 밝고 라벨이 빽빽해서 선 하나만으로는 배경에 묻힌다.
    // 아래에 굵은 흰 선을 깔아 헤일로를 만들면 어떤 배경 위에서도 경계가 선다.
    halo.current?.setMap(null)
    halo.current = new kakao.maps.Circle({
      center: at,
      radius,
      strokeWeight: 6,
      strokeColor: '#ffffff',
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
      fillOpacity: 0,
    })
    halo.current.setMap(map.current)

    circle.current?.setMap(null)
    circle.current = new kakao.maps.Circle({
      center: at,
      radius,
      strokeWeight: 3,
      strokeColor: '#c01f5c',
      strokeOpacity: 1,
      strokeStyle: 'solid',
      fillColor: '#e0447f',
      fillOpacity: 0.12,
    })
    circle.current.setMap(map.current)

    // 새로 만들어야 측량 핑 애니메이션이 다시 재생된다.
    pin.current?.setMap(null)
    pin.current = new kakao.maps.CustomOverlay({
      position: at,
      // 클러스터 마커보다 항상 위에 있어야 한다.
      zIndex: 100,
      content:
        '<div style="position:relative;width:0;height:0">' +
        '<span class="survey-ping" style="position:absolute;left:-70px;top:-70px;width:140px;height:140px;' +
        'border:3px solid #c01f5c;border-radius:9999px;display:block"></span>' +
        `<span style="position:absolute;left:-19px;top:-19px;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))">${CROSSHAIR}</span>` +
        '</div>',
    })
    pin.current.setMap(map.current)
  }, [ready, center, radius])

  // 지도 마커
  useEffect(() => {
    if (!ready || !map.current || !clusterer.current || !focused) return
    const { kakao } = window

    const dot = new kakao.maps.MarkerImage(
      `data:image/svg+xml;utf8,${encodeURIComponent(DOT_SVG)}`,
      new kakao.maps.Size(14, 14),
      { offset: new kakao.maps.Point(7, 7) },
    )

    clusterer.current.clear()
    clusterer.current.addMarkers(
      focused.items.map(
        (p) =>
          new kakao.maps.Marker({
            position: new kakao.maps.LatLng(p.lat, p.lon),
            title: p.name,
            image: dot,
          }),
      ),
    )
  }, [ready, focused])

  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
  const max = context?.byTopIndustry[0]?.count ?? 0
  const selected = industries.find((i) => i.code === industry)

  return (
    <main className="relative h-full w-full">
      {appKey ? (
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=clusterer`}
          strategy="afterInteractive"
          onLoad={() => window.kakao.maps.load(initMap)}
          onError={() => setFailed(true)}
        />
      ) : null}

      <div ref={mapRef} className="map-canvas bg-surface" />

      {(!appKey || failed) && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-sm">
            <p className="text-paper">지도를 불러오지 못했습니다.</p>
            <p className="mt-2 text-sm text-muted">
              {appKey
                ? '카카오 콘솔에서 이 주소가 JavaScript SDK 도메인에 등록돼 있는지 확인하세요.'
                : '.env.local 의 NEXT_PUBLIC_KAKAO_MAP_KEY 를 채우세요.'}
            </p>
          </div>
        </div>
      )}

      {/* 분석 패널 — 데스크톱은 왼쪽, 모바일은 아래 시트 */}
      <section
        className="absolute inset-x-0 bottom-0 z-10 flex max-h-[62svh] flex-col border-t border-line bg-ink/95 backdrop-blur
                   md:inset-y-4 md:left-4 md:right-auto md:max-h-none md:w-[23rem] md:rounded-lg md:border"
        aria-label="상권 분석"
      >
        <header className="shrink-0 border-b border-line px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-paper">
            jario<span className="ml-2 text-sm font-normal text-muted">자리</span>
          </h1>
          <p className="mt-1 text-sm leading-snug text-muted">
            지도를 눌러 자리를 고르면 반경 안의 경쟁 밀도를 셉니다.
          </p>
          <button
            type="button"
            onClick={() => locate({ silent: false })}
            disabled={locating}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted hover:text-paper disabled:opacity-50"
          >
            <span aria-hidden="true">◎</span>
            {locating ? '위치 찾는 중' : '내 위치로'}
          </button>
          {notice && (
            <p className="mt-2 rounded border border-line bg-raised px-2.5 py-2 text-xs leading-snug text-paper/80">
              {notice}
            </p>
          )}
        </header>

        <div className="shrink-0 space-y-3 border-b border-line px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-xs font-medium tracking-wide text-muted">반경</legend>
            <div className="flex gap-1.5">
              {RADII.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadius(r)}
                  aria-pressed={radius === r}
                  className={`measure flex-1 rounded border px-3 py-1.5 text-sm transition-colors ${
                    radius === r
                      ? 'border-commerce bg-commerce/15 text-paper'
                      : 'border-line text-muted hover:border-muted hover:text-paper'
                  }`}
                >
                  {formatRadius(r)}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="industry" className="mb-2 block text-xs font-medium tracking-wide text-muted">
              업종
            </label>
            <select
              id="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full rounded border border-line bg-raised px-3 py-1.5 text-sm text-paper"
            >
              <option value="">전체 업종</option>
              {industries.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error ? (
            <p className="px-5 py-6 text-sm text-paper">{error.message}</p>
          ) : (
            <>
              <div className="px-5 py-5">
                <div className="flex items-baseline gap-2">
                  <span
                    data-testid="total"
                    className="measure text-4xl font-semibold text-paper"
                    style={{ opacity: loading ? 0.45 : 1, transition: 'opacity 150ms' }}
                  >
                    {focused ? focused.total.toLocaleString('ko-KR') : '—'}
                  </span>
                  <span className="text-sm text-muted">곳</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  반경 <span className="measure text-paper">{formatRadius(radius)}</span> 안의{' '}
                  {selected ? <span className="text-paper">{selected.name}</span> : '모든'} 업소
                </p>
                {focused?.truncated && (
                  <p className="mt-2 text-xs text-muted">
                    지도에는 가까운 <span className="measure">{focused.items.length}</span>곳만 표시됩니다.
                  </p>
                )}
                {focused?.total === 0 && (
                  <p className="mt-2 text-xs leading-snug text-muted">
                    이 자리 주변에는 등록된 업소가 없습니다. 인천 밖이라면 아직 데이터가 없는 지역입니다.
                  </p>
                )}
              </div>

              {context && context.byTopIndustry.length > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <h2 className="mb-3 text-xs font-medium tracking-wide text-muted">
                    주변 업종 구성
                  </h2>
                  <ul className="space-y-px">
                    {context.byTopIndustry.map((row) => {
                      const on = industry === row.code
                      const share = max ? row.count / max : 0
                      return (
                        <li key={row.code}>
                          <button
                            type="button"
                            onClick={() => setIndustry(on ? '' : row.code)}
                            aria-pressed={on}
                            className="density-row flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-raised/60"
                            style={
                              {
                                '--fill': `${share * 100}%`,
                                '--tone': toneFor(share),
                              } as React.CSSProperties
                            }
                          >
                            <span className={on ? 'text-paper' : 'text-paper/85'}>{row.name}</span>
                            <span className="measure shrink-0 text-paper/70">
                              {row.count.toLocaleString('ko-KR')}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {focused && focused.items.length > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <h2 className="mb-3 text-xs font-medium tracking-wide text-muted">가까운 순</h2>
                  <ul className="space-y-2.5">
                    {focused.items.slice(0, 25).map((p) => (
                      <li key={p.placeId} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-paper">{p.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {p.industryName}
                            {p.floorNo !== null && (
                              <>
                                {' · '}
                                <span className="measure">
                                  {p.floorNo < 0 ? `지하 ${-p.floorNo}층` : `${p.floorNo}층`}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                        <span className="measure shrink-0 text-xs text-muted">{p.distanceM}m</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}
