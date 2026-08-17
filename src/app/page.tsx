import MapPanel from '@/components/MapPanel'

/**
 * 정적 셸이다. DB를 건드리지 않는다.
 *
 * 예전에는 업종 목록을 여기서 읽느라 force-dynamic 이었다. 분기마다만 바뀌는
 * 10행을 매 요청마다 DB에 다녀왔고, 그만큼 TTFB와 첫 페인트가 늦어졌다.
 * 업종 목록은 어차피 한 번은 나가는 /api/spot 응답에 얹어 보낸다.
 */
export default function Home() {
  return <MapPanel />
}
