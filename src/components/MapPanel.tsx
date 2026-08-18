'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Script from 'next/script'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import DongRanking from './DongRanking'

type Industry = { code: string; name: string }

type PlaceDetail = {
  placeId: string
  name: string
  branchName: string | null
  industryCode: string
  industryPath: string[]
  ksicCode: string | null
  ksicName: string | null
  sigungu: string
  admDong: string
  roadAddress: string | null
  lotAddress: string | null
  buildingName: string | null
  floorNo: number | null
  floorRaw: string | null
  lon: number
  lat: number
}

type NearbyResponse = {
  total: number
  truncated: boolean
  breakdown: { code: string; name: string; count: number }[]
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

/** 데이터가 있는 지역. 문구에 그대로 쓰이므로 한 곳에서 관리한다. */
const COVERAGE_LABEL = '서울·인천'

/**
 * 적재된 데이터의 실제 좌표 범위(서울·인천)에 여유를 조금 뒀다.
 * 이 밖에서는 결과가 0이 나오는 게 정상이므로, 빈 화면 대신 이유를 말해준다.
 */
const COVERAGE = { minLon: 124.5, maxLon: 127.25, minLat: 36.8, maxLat: 38.05 }

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
/**
 * 색의 역할을 나눈다.
 *   분홍 = 내가 고른 것 (크로스헤어, 반경선, 선택한 업소)
 *   어두운 점 = 데이터 (업소, 클러스터)
 *
 * 처음엔 업소 점도 분홍으로 뒀는데, 반경 원의 분홍 채움 위에서 점이 묻혔다.
 * 어두운 점 + 흰 링이 밝은 지도와 분홍 채움 양쪽에서 가장 잘 버틴다.
 */
const DOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
<circle cx="10" cy="10" r="6.5" fill="#14111a" stroke="#ffffff" stroke-width="2.5"/></svg>`

/**
 * 손가락용 마커. 보이는 점은 같고 주변 여백만 넓힌다.
 *
 * 20px 점은 마우스로는 충분한데 손가락으로는 빗나간다. 권장 터치 타깃은 44px다.
 * 점을 키우면 지도가 지저분해지므로, 투명한 여백을 둘러 누를 수 있는 면적만 넓힌다.
 */
const DOT_TOUCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
<rect width="40" height="40" fill="transparent"/>
<circle cx="20" cy="20" r="6.5" fill="#14111a" stroke="#ffffff" stroke-width="2.5"/></svg>`

/** 선택한 업소만 분홍으로, 조금 더 크게. */
const DOT_SELECTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
<circle cx="13" cy="13" r="10" fill="#e0447f" fill-opacity="0.25"/>
<circle cx="13" cy="13" r="7" fill="#c01f5c" stroke="#ffffff" stroke-width="3"/></svg>`

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

/** 마커는 좌표와 이름만 온다. 목록용 전체 행을 500건 실으면 응답이 145KB가 된다. */
type MarkerPoint = { placeId: string; name: string; lon: number; lat: number }

type Churn = {
  active: number
  closed: number
  opened: number
  from: number
  to: number
}

type SpotResponse = NearbyResponse & {
  industries: Industry[]
  markers: MarkerPoint[]
  churn: Churn
}

/** 202512 → '2025년 12월' */
function formatQuarter(q: number) {
  return `${Math.floor(q / 100)}년 ${q % 100}월`
}

/** 한 자리를 분석하는 데 필요한 것을 한 번에 받는다. */
async function fetchSpot(
  q: { lon: number; lat: number; radius: number; industry?: string },
  signal: AbortSignal,
): Promise<SpotResponse> {
  const params = new URLSearchParams({
    lon: String(q.lon),
    lat: String(q.lat),
    radius: String(q.radius),
  })
  if (q.industry) params.set('industry', q.industry)

  const res = await fetch(`/api/spot?${params}`, { signal })
  if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`)
  return res.json()
}

async function fetchNearby(
  q: {
    lon: number
    lat: number
    radius: number
    industry?: string
    limit?: number
    order?: 'distance' | 'sample'
    group?: 'top' | 'sub'
  },
  signal: AbortSignal,
): Promise<NearbyResponse> {
  const params = new URLSearchParams({
    lon: String(q.lon),
    lat: String(q.lat),
    radius: String(q.radius),
  })
  if (q.industry) params.set('industry', q.industry)
  if (q.limit) params.set('limit', String(q.limit))
  if (q.order) params.set('order', q.order)
  if (q.group) params.set('group', q.group)

  const res = await fetch(`/api/places/nearby?${params}`, { signal })
  if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`)
  return res.json()
}

/**
 * 서랍이 멈추는 높이. 화면 높이 대비 비율이다.
 *   요약  — 숫자 한 줄만 남기고 지도를 다 보여준다
 *   절반  — 지도와 목록을 같이 본다
 *   전체  — 목록·분포를 훑는다
 */
const SNAPS = [0.075, 0.55, 0.92] as const

/**
 * 뷰포트가 좁은가. effect에서 setState 하지 않으려고 외부 스토어로 구독한다.
 * (React 19의 set-state-in-effect 규칙에 걸리지 않는다)
 */
function useIsNarrow() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(max-width: 767px)')
      mq.addEventListener('change', onChange)
      window.addEventListener('resize', onChange)
      return () => {
        mq.removeEventListener('change', onChange)
        window.removeEventListener('resize', onChange)
      }
    },
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false, // 서버에서는 알 수 없다. 데스크톱 레이아웃으로 렌더한다.
  )
}

/** 상세 정보 한 줄. 라벨 폭을 고정해 값이 세로로 정렬되게 한다. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-paper/90">{children}</dd>
    </div>
  )
}

export default function MapPanel() {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<kakao.maps.Map | null>(null)
  const circle = useRef<kakao.maps.Circle | null>(null)
  const halo = useRef<kakao.maps.Circle | null>(null)
  const pin = useRef<kakao.maps.CustomOverlay | null>(null)
  const clusterer = useRef<kakao.maps.MarkerClusterer | null>(null)
  const clickTimer = useRef<number | undefined>(undefined)
  const searchTimer = useRef<number | undefined>(undefined)

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [center, setCenter] = useState(START)
  const [radius, setRadius] = useState<Radius>(500)
  const [industry, setIndustry] = useState('')
  const sheetRef = useRef<HTMLElement>(null)
  const isNarrow = useIsNarrow()
  const [snap, setSnap] = useState(1) // 절반에서 시작한다
  const [dragH, setDragH] = useState<number | null>(null)
  const grab = useRef<{ startY: number; startH: number; moved: boolean } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // 후보지 A/B 비교. 자리를 두 곳 골라 나란히 보는 리포트를 만든다.
  type Pick = { lon: number; lat: number; label?: string }
  const [picks, setPicks] = useState<{ a: Pick | null; b: Pick | null }>({ a: null, b: null })
  const [saving, setSaving] = useState(false)
  const [reportUrl, setReportUrl] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 장소 검색. 내 위치만으로는 다른 동네를 볼 수 없다.
  type Hit = { id: string; name: string; address: string; lon: number; lat: number }
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchNote, setSearchNote] = useState<string | null>(null)
  /** 키보드로 훑고 있는 검색 결과. -1이면 입력창에 머물러 있다. */
  const [activeHit, setActiveHit] = useState(-1)
  /**
   * 지도를 움직였는데 분석은 이전 자리 기준으로 남아 있는 상태.
   *
   * 지도 앱들은 이럴 때 "이 지역 재검색"을 띄운다. 자동으로 다시 계산하면
   * 손가락을 뗄 때마다 조회가 나가고, 사용자가 고른 자리도 제멋대로 바뀐다.
   * 다시 볼지는 사용자가 정한다.
   */
  const [movedTo, setMovedTo] = useState<{ lon: number; lat: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 상세를 열기 전 서랍 높이. 닫을 때 되돌린다. */
  const [snapBeforeDetail, setSnapBeforeDetail] = useState<number | null>(null)
  /**
   * 마커를 눌렀을 때 그 자리에 겹쳐 있는 업소들.
   *
   * 서울·인천 업소의 85%가 다른 업소와 좌표가 같다(건물 단위 지오코딩,
   * 한 지점 최대 1,040곳). 마커 하나가 곧 업소 하나가 아니라서,
   * 위에 있는 것만 열어주면 나머지는 닿을 방법이 없다.
   */
  const [stackAt, setStackAt] = useState<{ lon: number; lat: number } | null>(null)
  const [view, setView] = useState<'spot' | 'dong'>('spot')

  const heightFor = (i: number) =>
    typeof window === 'undefined' ? 0 : Math.round(window.innerHeight * SNAPS[i])
  const sheetHeight = dragH ?? heightFor(snap)

  /**
   * 고른 자리가 하단 시트에 가리지 않도록 지도를 밀어 올린다.
   *
   * 모바일에서는 패널이 화면 아래 60% 이상을 덮는다. 지도 중심에 마커를 두면
   * 정작 내가 찍은 자리가 시트 뒤에 숨는다 — 자리를 고르는 도구인데 고른 자리가
   * 안 보인다. 보이는 영역의 한가운데로 오도록 시트 높이의 절반만큼 보정한다.
   * (조회에 쓰는 좌표는 그대로다. 화면만 옮긴다.)
   */
  const keepVisible = useCallback(() => {
    const m = map.current
    const sheet = sheetRef.current
    if (!m || !sheet) return
    // md 이상에서는 패널이 왼쪽에 있어 지도 중심을 가리지 않는다.
    if (window.matchMedia('(min-width: 768px)').matches) return
    m.panBy(0, sheet.getBoundingClientRect().height / 2)
  }, [])

  /** 서랍 높이가 바뀌면 가려지는 영역도 달라진다. 중심을 다시 잡고 새 높이로 보정한다. */
  const resettle = useCallback(() => {
    window.setTimeout(() => {
      map.current?.relayout()
      map.current?.setCenter(new window.kakao.maps.LatLng(center.lat, center.lon))
      keepVisible()
    }, 230)
  }, [center, keepVisible])

  const gotoSnap = useCallback(
    (i: number) => {
      setSnap(i)
      resettle()
    },
    [resettle],
  )

  const onGrabStart = (e: React.PointerEvent) => {
    if (!isNarrow) return
    e.currentTarget.setPointerCapture(e.pointerId)
    grab.current = { startY: e.clientY, startH: sheetHeight, moved: false }
  }

  const onGrabMove = (e: React.PointerEvent) => {
    const g = grab.current
    if (!g) return
    const dy = g.startY - e.clientY // 위로 끌면 커진다
    if (Math.abs(dy) > 4) g.moved = true
    setDragH(Math.min(heightFor(SNAPS.length - 1), Math.max(heightFor(0), g.startH + dy)))
  }

  const onGrabEnd = () => {
    const g = grab.current
    if (!g) return
    grab.current = null
    const h = dragH ?? g.startH
    setDragH(null)

    if (!g.moved) {
      // 움직이지 않았으면 탭이다. 다음 단계로 넘긴다.
      gotoSnap((snap + 1) % SNAPS.length)
      return
    }
    // 놓은 높이에서 가장 가까운 단계로 붙인다.
    let best = 0
    for (let i = 1; i < SNAPS.length; i++) {
      if (Math.abs(heightFor(i) - h) < Math.abs(heightFor(best) - h)) best = i
    }
    gotoSnap(best)
  }

  /**
   * 업소를 고른다. 마커를 누르든 목록에서 누르든 여기로 온다.
   *
   * 모바일에서는 서랍이 요약(7.5%)에 접혀 있을 수 있다. 그 상태로 상세만
   * 바꿔놓으면 눌렀는데 아무 일도 안 일어난 것처럼 보인다. 상세가 보이는
   * 높이까지 올려준다. 이미 더 올라가 있으면 건드리지 않는다.
   */
  /** 마커를 눌렀을 때. 그 자리에 뭐가 있는지부터 보여준다. */
  const openStack = useCallback(
    (at: { lon: number; lat: number }) => {
      setSelectedId(null)
      setStackAt(at)
      if (!isNarrow) return
      setSnapBeforeDetail((prev) => prev ?? snap)
      if (snap < 1) gotoSnap(1)
      window.setTimeout(
        () => {
          map.current?.panTo(new window.kakao.maps.LatLng(at.lat, at.lon))
          keepVisible()
        },
        snap < 1 ? 260 : 0,
      )
    },
    [isNarrow, snap, gotoSnap, keepVisible],
  )

  const selectPlace = useCallback(
    (placeId: string, at?: { lon: number; lat: number }) => {
      setSelectedId(placeId)
      if (!isNarrow) return

      setSnapBeforeDetail((prev) => prev ?? snap)
      if (snap < 1) gotoSnap(1)

      // 고른 업소가 서랍에 가리지 않게 지도도 옮긴다.
      if (at) {
        window.setTimeout(() => {
          map.current?.panTo(new window.kakao.maps.LatLng(at.lat, at.lon))
          keepVisible()
        }, snap < 1 ? 260 : 0)
      }
    },
    [isNarrow, snap, gotoSnap, keepVisible],
  )

  /**
   * 마커 이벤트 핸들러가 참조할 최신 selectPlace.
   *
   * 의존성 배열에 selectPlace를 직접 넣으면 서랍을 움직일 때마다(snap 변경)
   * 마커 500개가 통째로 다시 만들어진다. 콜백만 갈아끼운다.
   */
  const openStackRef = useRef(openStack)
  useEffect(() => {
    openStackRef.current = openStack
  }, [openStack])

  /** 상세를 닫고 원래 서랍 높이로 돌아간다. */
  const closeDetail = useCallback(() => {
    setSelectedId(null)
    setStackAt(null)
    if (snapBeforeDetail !== null) {
      gotoSnap(snapBeforeDetail)
      setSnapBeforeDetail(null)
    }
  }, [snapBeforeDetail, gotoSnap])

  /** 검색 결과나 내 위치로 자리를 옮긴다. */
  const goTo = useCallback(
    (lon: number, lat: number) => {
      setNotice(null)
      setSelectedId(null)
      setCenter({ lon, lat })
      map.current?.panTo(new window.kakao.maps.LatLng(lat, lon))
    },
    [],
  )

  const search = useCallback((raw?: string) => {
    const q = (raw ?? query).trim()
    if (!q) return
    if (!window.kakao?.maps?.services) {
      setSearchNote('검색 기능을 불러오지 못했습니다.')
      return
    }

    setSearching(true)
    setSearchNote(null)
    setActiveHit(-1)
    new window.kakao.maps.services.Places().keywordSearch(
      q,
      (data, status) => {
        setSearching(false)
        const S = window.kakao.maps.services.Status
        if (status === S.ZERO_RESULT) {
          setHits([])
          setSearchNote('검색 결과가 없습니다.')
          return
        }
        if (status !== S.OK) {
          setHits(null)
          setSearchNote('검색에 실패했습니다.')
          return
        }
        setHits(
          data.map((d) => ({
            id: d.id,
            name: d.place_name,
            address: d.road_address_name || d.address_name,
            lon: Number(d.x),
            lat: Number(d.y),
          })),
        )
      },
      { size: 8 },
    )
  }, [query])

  const pickHit = (h: Hit) => {
    setHits(null)
    setActiveHit(-1)
    setQuery(h.name)
    if (!withinCoverage(h.lon, h.lat)) {
      // 옮기긴 한다. 결과가 0곳으로 나오는 이유를 함께 알려준다.
      setNotice(`${h.name}은(는) ${COVERAGE_LABEL} 밖이라 표시할 업소 데이터가 없습니다.`)
      setSelectedId(null)
      setCenter({ lon: h.lon, lat: h.lat })
      map.current?.panTo(new window.kakao.maps.LatLng(h.lat, h.lon))
      return
    }
    goTo(h.lon, h.lat)
  }

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
          setNotice(
            `현재 위치가 ${COVERAGE_LABEL} 밖입니다. 지금은 ${COVERAGE_LABEL} 데이터만 있어 부평역을 기준으로 보여줍니다.`,
          )
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

  // 세 개의 조회는 목적이 서로 다르다.
  //
  //   분포 — 업종 필터를 걸어도 주변 구성은 전체 기준으로 봐야 이 자리가
  //          무슨 상권인지 알 수 있다. 목록은 필요 없으니 limit=1.
  //   목록 — 가까운 순. 사람이 훑는 용도라 25건이면 충분하다.
  //   마커 — 공간적으로 고른 표본. 가까운 순으로 뽑으면 밀집 지역에서
  //          중심만 채워지고 바깥이 비어 보인다.
  // 분포를 어느 범위에서 셀지.
  //   필터 없음   → 반경 안 전체의 소분류
  //   대분류 선택 → 그 안의 소분류 (음식 → 백반/한정식, 카페, 치킨…)
  //   소분류 선택 → 형제 업종을 계속 보여준다. 고른 것만 남으면 비교가 안 된다.
  const breakdownScope = industry ? industry.slice(0, 2) : ''

  // 분포·목록·마커·업종목록을 한 번에 받는다. 예전에는 조회를 세 번 보냈는데,
  // 병렬이라 벽시계 시간은 최댓값이었지만 서버리스 호출이 3번이라
  // 콜드 스타트를 맞을 확률도 3배였고 커넥션도 3번 잡았다.
  const spotQuery = useQuery({
    queryKey: ['spot', center.lon, center.lat, radius, industry],
    queryFn: ({ signal }) =>
      fetchSpot({ ...center, radius, industry: industry || undefined }, signal),
    // 키가 바뀌면 기본값은 data가 undefined가 된다. 그러면 반경이나 업종을 바꿀
    // 때마다 패널이 통째로 비고, 업종 목록도 응답에 실려 오므로 select 옵션까지
    // 사라졌다가 돌아온다. 이전 결과를 유지하고 새 값이 오면 갈아끼운다.
    placeholderData: keepPreviousData,
  })

  const stackQuery = useQuery({
    queryKey: ['stack', stackAt?.lon, stackAt?.lat],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/places/at?lon=${stackAt!.lon}&lat=${stackAt!.lat}`, { signal })
      if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`)
      return res.json() as Promise<{
        total: number
        buildingName: string | null
        roadAddress: string | null
        places: { placeId: string; name: string; industryName: string; floorNo: number | null }[]
      }>
    },
    enabled: stackAt !== null,
  })

  /**
   * 겹친 게 한 곳뿐이면 목록을 거칠 이유가 없다.
   * 상태를 바꾸지 않고 파생값으로 둔다 — effect에서 setState 하면 렌더가 한 번 더 돌고,
   * React 19의 set-state-in-effect 규칙에도 걸린다.
   */
  const soleStackId =
    stackQuery.data?.total === 1 ? (stackQuery.data.places[0]?.placeId ?? null) : null
  const detailId = selectedId ?? soleStackId

  const detailQuery = useQuery({
    queryKey: ['place', detailId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/places/${detailId}`, { signal })
      if (!res.ok) throw new Error(`업소 정보를 불러오지 못했습니다 (${res.status})`)
      return res.json() as Promise<PlaceDetail>
    },
    enabled: detailId !== null,
  })

  const detail = detailQuery.data ?? null

  // 이 업소와 같은 소분류가 지금 반경 안에 몇 곳인지.
  // 상세를 데이터 나열로 끝내지 않고, 이 서비스가 답하려는 질문을 한 업소에 적용한다.
  // limit=1로 목록은 받지 않는다 — 필요한 건 총 개수뿐이다.
  const peersQuery = useQuery({
    queryKey: ['nearby', center.lon, center.lat, radius, detail?.industryCode, 'peers'],
    queryFn: ({ signal }) =>
      fetchNearby({ ...center, radius, industry: detail!.industryCode, limit: 1 }, signal),
    enabled: detail !== null,
  })

  const spot = spotQuery.data ?? null

  /** 자리 이름은 가장 가까운 업소의 도로명주소 앞부분을 쓴다. 좌표보다 알아보기 쉽다. */
  const spotLabel = () =>
    spot?.items[0]?.roadAddress?.split(' ').slice(0, 3).join(' ') || undefined

  const pickHere = (slot: 'a' | 'b') => {
    setPicks((prev) => ({ ...prev, [slot]: { ...center, label: spotLabel() } }))
    setReportUrl(null)
    setSaveError(null)
  }

  const saveReport = async () => {
    if (!picks.a || !picks.b) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radius,
          industry: industry || null,
          a: picks.a,
          b: picks.b,
        }),
      })
      if (!res.ok) throw new Error(`저장에 실패했습니다 (${res.status})`)
      const { url } = (await res.json()) as { url: string }
      setReportUrl(new URL(url, window.location.origin).toString())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  const industries = spot?.industries ?? []
  const context = spot
  const focused = spot
  // 배열을 그대로 쓴다. 렌더마다 객체를 새로 만들면 참조가 바뀌어
  // 마커 effect가 매번 돌고 마커 500개를 다시 생성한다.
  const markers = spot?.markers ?? null
  const loading = spotQuery.isFetching
  const error = spotQuery.error

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
      // 기본 화면(level 4)에서 개별 업소가 보이게 한다.
      // minLevel은 "이 레벨부터 뭉친다"는 뜻이라 4로 두면 첫 화면이 전부 클러스터였다.
      // 이 서비스에서는 점이 빽빽한 것 자체가 밀도라는 정보다.
      minLevel: 5,
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
        setSelectedId(null)
        setStackAt(null)
        setCenter({ lat, lon })
      }, 260)
    })

    kakao.maps.event.addListener(map.current, 'dblclick', () => {
      window.clearTimeout(clickTimer.current)
    })

    // 지도가 멈출 때마다 분석 기준점에서 얼마나 벗어났는지 본다.
    kakao.maps.event.addListener(map.current, 'idle', () => {
      const c = map.current?.getCenter()
      if (!c) return
      setMovedTo({ lon: c.getLng(), lat: c.getLat() })
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

    keepVisible()

    // 새로 만들어야 측량 핑 애니메이션이 다시 재생된다.
    pin.current?.setMap(null)
    pin.current = new kakao.maps.CustomOverlay({
      position: at,
      // 클러스터 마커보다 항상 위에 있어야 한다.
      zIndex: 100,
      content:
        // pointer-events:none 이 없으면 핑(140px 원)이 애니메이션이 끝난 뒤에도
        // DOM에 남아 중심 근처 업소 마커의 클릭을 가로챈다.
        '<div style="position:relative;width:0;height:0;pointer-events:none">' +
        '<span class="survey-ping" style="position:absolute;left:-70px;top:-70px;width:140px;height:140px;' +
        'border:3px solid #c01f5c;border-radius:9999px;display:block"></span>' +
        `<span style="position:absolute;left:-19px;top:-19px;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))">${CROSSHAIR}</span>` +
        '</div>',
    })
    pin.current.setMap(map.current)
  }, [ready, center, radius, keepVisible])

  // 지도 마커
  useEffect(() => {
    if (!ready || !map.current || !clusterer.current || !markers) return
    const { kakao } = window

    // 좁은 화면에서는 누를 수 있는 면적을 넓힌 이미지를 쓴다. 보이는 점은 같다.
    const dot = isNarrow
      ? new kakao.maps.MarkerImage(
          `data:image/svg+xml;utf8,${encodeURIComponent(DOT_TOUCH_SVG)}`,
          new kakao.maps.Size(40, 40),
          { offset: new kakao.maps.Point(20, 20) },
        )
      : new kakao.maps.MarkerImage(
          `data:image/svg+xml;utf8,${encodeURIComponent(DOT_SVG)}`,
          new kakao.maps.Size(20, 20),
          { offset: new kakao.maps.Point(10, 10) },
        )
    const dotSelected = new kakao.maps.MarkerImage(
      `data:image/svg+xml;utf8,${encodeURIComponent(DOT_SELECTED_SVG)}`,
      new kakao.maps.Size(26, 26),
      { offset: new kakao.maps.Point(13, 13) },
    )

    clusterer.current.clear()
    clusterer.current.addMarkers(
      markers.map((p) => {
        const isSelected = p.placeId === detailId
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(p.lat, p.lon),
          title: p.name,
          image: isSelected ? dotSelected : dot,
          zIndex: isSelected ? 50 : undefined,
        })
        // 어떤 업소인지는 클로저로 안다. 마커 클릭은 자리 선택이 아니라 상세 보기다.
        kakao.maps.event.addListener(marker, 'click', () => {
          window.clearTimeout(clickTimer.current) // 지도 클릭(자리 이동)으로 번지지 않게
          openStackRef.current({ lon: p.lon, lat: p.lat })
        })
        return marker
      }),
    )
  }, [ready, markers, detailId, isNarrow])

  /**
   * 지도 중심이 분석 기준점에서 얼마나 벗어났나(m).
   * 반경의 40%를 넘으면 "다른 곳을 보고 있다"고 판단한다 — 조금 흔들린 정도로
   * 버튼이 뜨면 성가시다.
   */
  const movedAway = (() => {
    if (!movedTo) return false
    const dLat = (movedTo.lat - center.lat) * 111_000
    const dLon = (movedTo.lon - center.lon) * 111_000 * Math.cos((center.lat * Math.PI) / 180)
    return Math.hypot(dLat, dLon) > radius * 0.4
  })()

  /** 좁은 화면에서 업소 상세를 보는 중인가. 그동안은 검색·필터·탭을 감춘다. */
  const detailMode = isNarrow && (detailId !== null || stackAt !== null) && view === 'spot'

  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
  const max = context?.breakdown[0]?.count ?? 0
  // 대분류는 select에서, 소분류는 분포 목록에서 고른다. 둘 다 같은 industry 값을 쓴다.
  const selected =
    industries.find((i) => i.code === industry) ??
    context?.breakdown.find((b) => b.code === industry)

  /**
   * 결과가 바뀐 것을 보조기술에 알리는 한 줄.
   *
   * 반경이나 업종을 바꾸면 화면의 숫자는 바뀌는데, 시각적으로 보지 않으면
   * 아무 일도 일어나지 않은 것과 같다. 이 서비스의 답이 바로 그 숫자다.
   * 조회 중에는 비워둔다 — 중간 상태를 읽어주면 소음이 된다.
   */
  const liveMessage =
    loading || !focused
      ? ''
      : `반경 ${formatRadius(radius)} 안 ${selected?.name ?? '전체 업종'} ${focused.total.toLocaleString('ko-KR')}곳`

  return (
    <main className="relative h-full w-full">
      {appKey ? (
        <Script
          // services: 장소·주소 검색. 지도용 JS 키를 그대로 쓴다.
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=clusterer,services`}
          strategy="afterInteractive"
          onLoad={() => window.kakao.maps.load(initMap)}
          onError={() => setFailed(true)}
        />
      ) : null}

      <div ref={mapRef} className="map-canvas bg-surface" />

      {/* 지도 위 컨트롤. 지도 앱들이 쓰는 자리다 — 패널 안에 묻어두면
          지도를 보는 중에 손이 닿지 않는다. */}
      {ready && !failed && (
        <>
          {/* 지도를 옮겼는데 분석은 이전 자리 그대로다. 다시 볼지는 사용자가 정한다. */}
          {movedAway && (
            <button
              type="button"
              onClick={() => {
                if (!movedTo) return
                setSelectedId(null)
                setNotice(null)
                setCenter(movedTo)
              }}
              className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-commerce bg-ink/95 px-4 py-2 text-sm text-paper shadow-lg backdrop-blur transition-colors hover:bg-raised"
            >
              <span aria-hidden="true" className="mr-1.5">↻</span>이 지역에서 다시 찾기
            </button>
          )}

          <div
            className="absolute right-3 z-20 flex flex-col gap-2 md:right-4"
            style={{ bottom: isNarrow ? sheetHeight + 12 : 24 }}
          >
            <button
              type="button"
              onClick={() => locate({ silent: false })}
              disabled={locating}
              aria-label="현재 위치로 이동"
              className="grid h-11 w-11 place-items-center rounded-full border border-line bg-ink/95 text-lg text-paper shadow-lg backdrop-blur transition-colors hover:bg-raised disabled:opacity-50"
            >
              {locating ? '…' : '◎'}
            </button>
            {/* 모바일은 핀치만으로 확대해야 했다. 한 손으로 쓸 때 불편하다. */}
            <div className="flex flex-col overflow-hidden rounded-full border border-line bg-ink/95 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => map.current?.setLevel(Math.max(1, (map.current?.getLevel() ?? 4) - 1))}
                aria-label="확대"
                className="grid h-11 w-11 place-items-center text-lg text-paper transition-colors hover:bg-raised"
              >
                +
              </button>
              <div className="mx-2 h-px bg-line" />
              <button
                type="button"
                onClick={() => map.current?.setLevel(Math.min(14, (map.current?.getLevel() ?? 4) + 1))}
                aria-label="축소"
                className="grid h-11 w-11 place-items-center text-lg text-paper transition-colors hover:bg-raised"
              >
                −
              </button>
            </div>
          </div>
        </>
      )}

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

      {/* 분석 패널 — 데스크톱은 왼쪽 고정, 모바일은 끌어올리는 서랍 */}
      <section
        ref={sheetRef}
        style={isNarrow ? { height: sheetHeight } : undefined}
        className={`absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden border-t border-line bg-ink/95 backdrop-blur
                    ${dragH === null ? 'transition-[height] duration-200' : ''}
                    md:inset-y-4 md:left-4 md:right-auto md:h-auto md:w-[23rem] md:rounded-lg md:border`}
        aria-label="상권 분석"
      >
        {/* 시각적으로는 이미 숫자가 보이므로 화면에서는 감춘다. */}
        <p className="sr-only" role="status" aria-live="polite">
          {liveMessage}
        </p>
        {/* 서랍 손잡이. 끌면 따라오고, 놓으면 가까운 단계로 붙는다. 탭하면 다음 단계.
            touch-none 이 없으면 브라우저 스크롤 제스처가 드래그를 가로챈다. */}
        <div
          onPointerDown={onGrabStart}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabEnd}
          onPointerCancel={onGrabEnd}
          role="slider"
          tabIndex={0}
          aria-label="패널 높이"
          aria-valuemin={0}
          aria-valuemax={SNAPS.length - 1}
          aria-valuenow={snap}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') gotoSnap(Math.min(snap + 1, SNAPS.length - 1))
            if (e.key === 'ArrowDown') gotoSnap(Math.max(snap - 1, 0))
          }}
          className="shrink-0 cursor-grab touch-none select-none px-5 pb-1.5 pt-2 active:cursor-grabbing md:hidden"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
          {/* 요약 상태에서는 내용이 안 보이므로 숫자를 여기 둔다.
              펼친 상태에서는 본문에 같은 숫자가 있어 중복이다. */}
          <div className="flex items-baseline justify-between gap-3">
            {snap === 0 ? (
              <span className="flex items-baseline gap-1.5">
                <span className="measure text-lg font-semibold text-paper">
                  {focused ? focused.total.toLocaleString('ko-KR') : '—'}
                </span>
                <span className="text-xs text-muted">
                  곳 · 반경 <span className="measure">{formatRadius(radius)}</span>
                  {selected ? ` · ${selected.name}` : ''}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted">끌어서 높이 조절</span>
            )}
            <span className="text-xs text-muted">
              {snap === SNAPS.length - 1 ? '내리기' : '올리기'}
            </span>
          </div>
        </div>

        {/* 모바일에서는 제목·설명이 세로 공간을 크게 잡아먹는다. 쓰는 중에는 필요 없는 정보라
            좁은 화면에서는 줄이고, 위치 버튼만 남긴다. */}
        <header className="shrink-0 border-b border-line px-5 pb-3 pt-1 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-base font-semibold tracking-tight text-paper md:text-lg">
              jario<span className="ml-2 text-sm font-normal text-muted">자리</span>
            </h1>
            <button
              type="button"
              onClick={() => locate({ silent: false })}
              disabled={locating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted hover:text-paper disabled:opacity-50 md:hidden"
            >
              <span aria-hidden="true">◎</span>
              {locating ? '찾는 중' : '내 위치'}
            </button>
          </div>
          <p className="mt-1 hidden text-sm leading-snug text-muted md:block">
            지도를 눌러 자리를 고르면 반경 안의 경쟁 밀도를 셉니다.
          </p>
          <button
            type="button"
            onClick={() => locate({ silent: false })}
            disabled={locating}
            className="mt-3 hidden items-center gap-1.5 rounded border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted hover:text-paper disabled:opacity-50 md:inline-flex"
          >
            <span aria-hidden="true">◎</span>
            {locating ? '위치 찾는 중' : '내 위치로'}
          </button>
          {/* 장소 검색. 내 위치만으로는 다른 동네를 볼 수 없다.
              업소 하나를 들여다보는 중에는 검색·필터가 필요 없다. 좁은 화면에서는
              그 자리를 상세에 내준다 — 안 그러면 정작 정보가 화면 밖으로 밀린다. */}
          <div className={`relative mt-3 ${detailMode ? 'hidden md:block' : ''}`}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                search()
              }}
              className="flex gap-1.5"
            >
              {/* 결과 목록을 방향키로 훑을 수 있어야 한다. 마우스로만 고를 수 있으면
                  키보드 사용자는 첫 결과조차 선택하지 못한다. combobox 패턴을 따른다. */}
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  const v = e.target.value
                  setQuery(v)
                  setSearchNote(null)
                  // 입력이 바뀌면 지금 떠 있는 결과는 옛 검색어의 것이다.
                  // type=search 의 기본 X 버튼도 여기로 들어오므로, 지우면 목록도 닫힌다.
                  setHits(null)
                  setActiveHit(-1)

                  // 타이핑하는 동안 알아서 찾아준다. 엔터를 눌러야만 하면 한 번 더 손이 간다.
                  // 다만 글자마다 호출하면 카카오 Local API 쿼터를 빠르게 쓴다 —
                  // 멈춘 뒤에 한 번만 부른다.
                  window.clearTimeout(searchTimer.current)
                  if (v.trim().length >= 2) {
                    searchTimer.current = window.setTimeout(() => search(v), 300)
                  }
                }}
                onKeyDown={(e) => {
                  if (!hits || hits.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveHit((i) => (i + 1) % hits.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveHit((i) => (i <= 0 ? hits.length - 1 : i - 1))
                  } else if (e.key === 'Enter' && activeHit >= 0) {
                    e.preventDefault()
                    pickHit(hits[activeHit])
                  } else if (e.key === 'Escape') {
                    setHits(null)
                    setActiveHit(-1)
                  }
                }}
                placeholder="장소·주소 검색 (예: 강남역, 부평구청)"
                aria-label="장소 검색"
                role="combobox"
                aria-expanded={!!hits && hits.length > 0}
                aria-controls="search-results"
                aria-autocomplete="list"
                aria-activedescendant={activeHit >= 0 ? `search-hit-${activeHit}` : undefined}
                className="min-w-0 flex-1 rounded border border-line bg-raised px-3 py-1.5 text-sm text-paper placeholder:text-muted/70"
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="shrink-0 rounded border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-muted hover:text-paper disabled:opacity-50"
              >
                {searching ? '…' : '검색'}
              </button>
            </form>

            {hits && hits.length > 0 && (
              <ul
                id="search-results"
                role="listbox"
                aria-label="검색 결과"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded border border-line bg-ink shadow-lg"
              >
                {hits.map((h, i) => (
                  <li key={h.id} id={`search-hit-${i}`} role="option" aria-selected={i === activeHit}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setActiveHit(i)}
                      onClick={() => pickHit(h)}
                      className={`block w-full px-3 py-2 text-left transition-colors hover:bg-raised ${
                        i === activeHit ? 'bg-raised' : ''
                      }`}
                    >
                      <span className="block truncate text-sm text-paper">{h.name}</span>
                      <span className="block truncate text-xs text-muted">{h.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {searchNote && <p className="mt-2 text-xs text-muted">{searchNote}</p>}

          {notice && (
            <p className="mt-2 rounded border border-line bg-raised px-2.5 py-2 text-xs leading-snug text-paper/80">
              {notice}
            </p>
          )}
        </header>

        {/* 좁은 화면에서는 필터도 접어둔다. 늘 보일 필요는 없고, 그만큼 내용이 넓어진다. */}
        <div className={`shrink-0 border-b border-line md:hidden ${detailMode ? 'hidden' : ''}`}>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left"
          >
            <span className="min-w-0 truncate text-xs text-muted">
              반경 <span className="measure text-paper">{formatRadius(radius)}</span>
              <span className="mx-1.5 text-muted/50">·</span>
              <span className="text-paper">{selected?.name ?? '전체 업종'}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">{filtersOpen ? '닫기 ▾' : '필터 ▴'}</span>
          </button>
        </div>

        <div
          className={`${filtersOpen && !detailMode ? 'block' : 'hidden'} shrink-0 space-y-3 border-b border-line px-5 pb-4 pt-1 md:block md:py-4`}
        >
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
            {/* select는 큰 단위, 아래 분포 목록은 세부 업종. 소분류를 고르면
                select에는 그 상위 대분류가 표시돼 둘이 어긋나지 않는다. */}
            <select
              id="industry"
              value={breakdownScope}
              onChange={(e) => {
                setSelectedId(null)
                setIndustry(e.target.value)
              }}
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

        {/* 두 가지 질문을 나눈다. "이 자리는 어떤가"와 "어느 동네가 나은가". */}
        <div
          role="tablist"
          aria-label="분석 방식"
          className={`flex shrink-0 gap-1 border-b border-line px-5 py-2 ${detailMode ? 'hidden md:flex' : ''}`}
        >
          {(
            [
              ['spot', '이 자리'],
              ['dong', '동네 비교'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded px-3 py-1 text-sm transition-colors ${
                view === key ? 'bg-raised text-paper' : 'text-muted hover:text-paper'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {view === 'dong' ? (
            industry ? (
              <DongRanking
                industry={industry}
                industryName={selected?.name ?? '이 업종'}
                onPick={(spot) => {
                  setSelectedId(null)
                  setNotice(null)
                  setCenter(spot)
                  setView('spot')
                  map.current?.panTo(new window.kakao.maps.LatLng(spot.lat, spot.lon))
                }}
              />
            ) : (
              <p className="px-5 py-6 text-sm leading-relaxed text-muted">
                업종을 먼저 고르세요. 동네 비교는 &ldquo;이 업종이 상권 규모에 비해 많은가&rdquo;를
                보는 것이라 대상 업종이 있어야 합니다.
              </p>
            )
          ) : error ? (
            <p className="px-5 py-6 text-sm text-paper">{error.message}</p>
          ) : stackAt && !detailId ? (
            /* 마커를 누르면 그 자리에 겹친 업소부터 보여준다.
               한 곳뿐이면 목록이 아니라 바로 상세로 보내는 게 자연스럽다. */
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={closeDetail}
                className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-paper"
              >
                <span aria-hidden="true">←</span> 목록으로
              </button>

              {stackQuery.isPending && <p className="text-sm text-muted">불러오는 중…</p>}
              {stackQuery.error && (
                <p className="text-sm text-paper">{(stackQuery.error as Error).message}</p>
              )}

              {stackQuery.data && (
                <>
                  <h2 className="text-lg font-semibold text-paper">
                    이 위치에 <span className="measure text-commerce">{stackQuery.data.total}</span>곳
                  </h2>
                  <p className="mt-1 text-xs leading-snug text-muted">
                    {stackQuery.data.buildingName ?? stackQuery.data.roadAddress ?? '같은 좌표'}
                    {stackQuery.data.total > stackQuery.data.places.length &&
                      ` · ${stackQuery.data.places.length}곳만 표시`}
                  </p>

                  <ul className="mt-4 space-y-0.5">
                    {stackQuery.data.places.map((q) => (
                      <li key={q.placeId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(q.placeId)}
                          className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-raised"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-paper">{q.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {q.industryName}
                            </span>
                          </span>
                          {q.floorNo !== null && (
                            <span className="measure shrink-0 text-xs text-muted">
                              {q.floorNo < 0 ? `지하 ${-q.floorNo}층` : `${q.floorNo}층`}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : detailId ? (
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={closeDetail}
                className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-paper"
              >
                <span aria-hidden="true">←</span> 목록으로
              </button>

              {detailQuery.isPending && <p className="text-sm text-muted">불러오는 중…</p>}
              {detailQuery.error && (
                <p className="text-sm text-paper">{(detailQuery.error as Error).message}</p>
              )}

              {detail && (
                <article>
                  <h2 className="text-xl font-semibold leading-tight text-paper">
                    {detail.name}
                    {detail.branchName && (
                      <span className="ml-1.5 text-sm font-normal text-muted">
                        {detail.branchName}
                      </span>
                    )}
                  </h2>

                  <p className="mt-1.5 text-sm text-muted">
                    {detail.industryPath.map((step, i) => (
                      <span key={step}>
                        {i > 0 && <span className="mx-1 text-muted/60">›</span>}
                        <span className={i === 2 ? 'text-paper' : undefined}>{step}</span>
                      </span>
                    ))}
                  </p>

                  {/* 이 서비스가 답하려는 질문을 한 업소에 적용한 값. 상세의 핵심이다. */}
                  <div className="mt-4 rounded border border-line bg-raised px-4 py-3">
                    <div className="flex items-baseline gap-1.5">
                      <span className="measure text-2xl font-semibold text-commerce">
                        {peersQuery.data ? peersQuery.data.total.toLocaleString('ko-KR') : '—'}
                      </span>
                      <span className="text-sm text-muted">곳</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted">
                      선택한 자리 반경 <span className="measure">{formatRadius(radius)}</span> 안의{' '}
                      <span className="text-paper">{detail.industryPath[2]}</span> 업소 수 (이 가게
                      포함)
                    </p>
                  </div>

                  <dl className="mt-4 space-y-2.5 text-sm">
                    <Row label="도로명">{detail.roadAddress ?? '—'}</Row>
                    <Row label="지번">{detail.lotAddress ?? '—'}</Row>
                    {detail.buildingName && <Row label="건물">{detail.buildingName}</Row>}
                    <Row label="층">
                      {detail.floorNo !== null ? (
                        <span className="measure">
                          {detail.floorNo < 0 ? `지하 ${-detail.floorNo}층` : `${detail.floorNo}층`}
                        </span>
                      ) : detail.floorRaw ? (
                        // 층수로 환산할 수 없는 원문은 그대로 보여준다. 버리지 않았다.
                        <span className="text-muted">{detail.floorRaw} (원문)</span>
                      ) : (
                        '—'
                      )}
                    </Row>
                    <Row label="행정동">
                      {detail.sigungu} {detail.admDong}
                    </Row>
                    <Row label="업종코드">
                      <span className="measure">{detail.industryCode}</span>
                    </Row>
                    {detail.ksicName && (
                      <Row label="표준산업분류">
                        {detail.ksicName}{' '}
                        <span className="measure text-muted">{detail.ksicCode}</span>
                      </Row>
                    )}
                    <Row label="좌표">
                      <span className="measure text-xs">
                        {detail.lon.toFixed(6)}, {detail.lat.toFixed(6)}
                      </span>
                    </Row>
                  </dl>

                  {/*
                    이 데이터에는 사진도 리뷰도 영업시간도 없다. 그건 지도 서비스가 갖고 있고,
                    카카오 로컬 API는 리뷰를 응답에 주지 않는다 — 가져오려면 크롤링뿐인데
                    약관 위반이다. 그래서 가져오지 않고 넘긴다.

                    Places API를 호출하지도 않는다. 카카오맵 공식 URL 링크 규격이
                    `/link/map/이름,위도,경도` 라 좌표만으로 열 수 있다.
                    키도, 왕복도, 매칭 실패도 없다.
                  */}
                  <a
                    href={`https://map.kakao.com/link/map/${encodeURIComponent(detail.name)},${detail.lat},${detail.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center justify-between rounded border border-line px-3 py-2 text-sm text-paper transition-colors hover:border-commerce hover:text-commerce"
                  >
                    <span>카카오맵에서 보기</span>
                    <span aria-hidden="true" className="text-muted">
                      ↗
                    </span>
                    <span className="sr-only">새 창에서 열립니다</span>
                  </a>

                  <p className="mt-4 text-xs leading-snug text-muted">
                    소상공인시장진흥공단 2026-06 스냅샷입니다. 폐업·이전이 반영되지 않았을 수
                    있습니다.
                  </p>
                </article>
              )}
            </div>
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
                {spot?.truncated && markers && (
                  <p className="mt-2 text-xs leading-snug text-muted">
                    지도에는 이 중 <span className="measure">{markers.length}</span>곳을 고르게
                    추려 표시합니다.
                  </p>
                )}
                {focused?.total === 0 && (
                  <p className="mt-2 text-xs leading-snug text-muted">
                    이 자리 주변에는 등록된 업소가 없습니다. {COVERAGE_LABEL} 밖이라면 아직
                    데이터가 없는 지역입니다.
                  </p>
                )}

                {/*
                  밀도만으로는 이 자리가 좋은지 나쁜지 알 수 없다. 같은 반경에서
                  얼마나 사라지고 생겼는지가 훨씬 직접적인 신호다.
                  "폐업"이라 쓰지 않는다 — 이전·상호변경·데이터 정비가 섞여 있고
                  스냅샷 대조로는 가릴 수 없다.
                */}
                {spot?.churn && spot.churn.active + spot.churn.closed > 0 && (
                  <div className="mt-4 border-t border-line pt-4">
                    <div className="flex gap-6">
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="measure text-xl font-semibold text-commerce">
                            {spot.churn.closed.toLocaleString('ko-KR')}
                          </span>
                          <span className="text-xs text-muted">곳</span>
                        </div>
                        <p className="text-xs text-muted">사라짐</p>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="measure text-xl font-semibold text-paper">
                            {spot.churn.opened.toLocaleString('ko-KR')}
                          </span>
                          <span className="text-xs text-muted">곳</span>
                        </div>
                        <p className="text-xs text-muted">새로 생김</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-snug text-muted">
                      <span className="measure">{formatQuarter(spot.churn.from)}</span> 대비{' '}
                      <span className="measure">{formatQuarter(spot.churn.to)}</span> 기준입니다.
                      사라진 곳에는 폐업뿐 아니라 이전·상호변경도 섞여 있습니다.
                    </p>
                  </div>
                )}
              </div>

              {/* 후보지 비교. 자리를 두 곳 골라야 의미가 생기는 기능이라
                  버튼을 항상 두고, 둘 다 정해지면 저장이 열린다. */}
              <div className="border-t border-line px-5 py-4">
                <h2 className="mb-2 text-xs font-medium tracking-wide text-muted">후보지 비교</h2>
                <div className="flex gap-1.5">
                  {(['a', 'b'] as const).map((slot) => {
                    const p = picks[slot]
                    const isHere =
                      p && Math.abs(p.lon - center.lon) < 1e-9 && Math.abs(p.lat - center.lat) < 1e-9
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => pickHere(slot)}
                        className={`flex-1 rounded border px-3 py-1.5 text-left text-xs transition-colors ${
                          isHere
                            ? 'border-commerce bg-commerce/15 text-paper'
                            : 'border-line text-muted hover:border-muted hover:text-paper'
                        }`}
                      >
                        <span className="measure">{slot.toUpperCase()}</span>
                        <span className="ml-1.5">{p ? '' : '로 지정'}</span>
                        {p && (
                          <span className="mt-0.5 block truncate text-muted">
                            {p.label ?? '지정됨'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {picks.a && picks.b && !reportUrl && (
                  <button
                    type="button"
                    onClick={saveReport}
                    disabled={saving}
                    className="mt-2 w-full rounded border border-commerce bg-commerce/15 px-3 py-1.5 text-sm text-paper transition-colors hover:bg-commerce/25 disabled:opacity-50"
                  >
                    {saving ? '만드는 중…' : '비교 리포트 만들기'}
                  </button>
                )}

                {reportUrl && (
                  <div className="mt-2 rounded border border-line bg-raised px-3 py-2">
                    <p className="text-xs text-muted">링크가 만들어졌습니다.</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <a
                        href={reportUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-xs text-commerce underline"
                      >
                        {reportUrl}
                      </a>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(reportUrl)}
                        className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-paper"
                      >
                        복사
                      </button>
                    </div>
                  </div>
                )}

                {saveError && <p className="mt-2 text-xs text-paper">{saveError}</p>}
              </div>

              {context && context.breakdown.length > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <h2 className="mb-1 text-xs font-medium tracking-wide text-muted">
                    {breakdownScope
                      ? `${industries.find((i) => i.code === breakdownScope)?.name ?? ''} 안에서 많은 업종`
                      : '주변에 많은 업종'}
                  </h2>
                  <p className="mb-3 text-xs text-muted/70">눌러서 그 업종만 보기</p>
                  <ul className="space-y-px">
                    {context.breakdown.map((row) => {
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
                  <h2 className="mb-3 text-xs font-medium tracking-wide text-muted">
                    가까운 순 <span className="measure">{focused.items.length}</span>곳
                  </h2>
                  <ul className="space-y-0.5">
                    {focused.items.slice(0, 25).map((p) => (
                      <li key={p.placeId}>
                        <button
                          type="button"
                          onClick={() => selectPlace(p.placeId, { lon: p.lon, lat: p.lat })}
                          className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-raised"
                        >
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
                          <span className="measure shrink-0 text-xs text-muted">
                            {p.distanceM}m
                          </span>
                        </button>
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
