/**
 * 카카오맵 JS SDK 중 이 프로젝트가 실제로 쓰는 부분만 선언한다.
 * 전체 타입 패키지를 의존성으로 들이는 대신, 쓰는 만큼만 적어 무엇에 의존하는지 드러낸다.
 */

declare namespace kakao.maps {
  class LatLng {
    constructor(lat: number, lng: number)
    getLat(): number
    getLng(): number
  }

  class Map {
    constructor(container: HTMLElement, options: { center: LatLng; level?: number })
    setCenter(latlng: LatLng): void
    getLevel(): number
    setLevel(level: number): void
    panTo(latlng: LatLng): void
    /** 지도를 픽셀 단위로 이동한다. 화면 일부가 패널에 가릴 때 보정용. */
    panBy(dx: number, dy: number): void
    relayout(): void
  }

  class Size {
    constructor(width: number, height: number)
  }

  class Point {
    constructor(x: number, y: number)
  }

  class MarkerImage {
    constructor(src: string, size: Size, options?: { offset?: Point })
  }

  class Marker {
    constructor(options: {
      position: LatLng
      title?: string
      zIndex?: number
      image?: MarkerImage
    })
    setMap(map: Map | null): void
  }

  class Circle {
    constructor(options: {
      center: LatLng
      radius: number
      strokeWeight?: number
      strokeColor?: string
      strokeOpacity?: number
      strokeStyle?: string
      fillColor?: string
      fillOpacity?: number
    })
    setMap(map: Map | null): void
  }

  class CustomOverlay {
    constructor(options: {
      position: LatLng
      content: string | HTMLElement
      yAnchor?: number
      xAnchor?: number
      zIndex?: number
    })
    setMap(map: Map | null): void
    setPosition(latlng: LatLng): void
  }

  class MarkerClusterer {
    constructor(options: {
      map: Map
      averageCenter?: boolean
      minLevel?: number
      disableClickZoom?: boolean
      /** 각 구간의 클러스터 div에 그대로 적용되는 인라인 스타일 */
      styles?: Record<string, string>[]
      /** 구간 경계값. styles 개수보다 하나 적어야 한다. */
      calculator?: number[]
    })
    addMarkers(markers: Marker[]): void
    clear(): void
  }

  namespace event {
    function addListener(
      target: Map,
      type: 'click' | 'dblclick',
      handler: (mouseEvent: { latLng: LatLng }) => void,
    ): void
    /** 마커 클릭은 좌표 인자를 주지 않는다 — 어떤 마커인지는 클로저로 안다. */
    function addListener(target: Marker, type: 'click', handler: () => void): void
  }

  /**
   * 장소·주소 검색. SDK를 libraries=services 로 불러와야 존재한다.
   * 지도용 JavaScript 키를 그대로 쓴다.
   */
  namespace services {
    const Status: { OK: string; ZERO_RESULT: string; ERROR: string }

    type PlaceResult = {
      id: string
      place_name: string
      address_name: string
      road_address_name: string
      category_name: string
      /** 경도(문자열로 온다) */
      x: string
      /** 위도(문자열로 온다) */
      y: string
    }

    class Places {
      keywordSearch(
        keyword: string,
        callback: (data: PlaceResult[], status: string) => void,
        options?: { size?: number; page?: number },
      ): void
    }
  }

  /** autoload=false로 로드했을 때 SDK 초기화를 끝내는 콜백 */
  function load(callback: () => void): void
}

interface Window {
  kakao: typeof kakao
}
