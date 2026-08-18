import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * OG 이미지용 한글 폰트.
 *
 * Satori는 woff2를 읽지 못하고 실제 글리프 데이터를 요구한다. 한글 폰트는
 * 통째로 4.4MB라 그대로 쓸 수 없어서, 한글 음절 블록(U+AC00–D7A3)과 라틴·기호만
 * 남겨 1.5MB로 줄였다. 음절을 더 줄일 수도 있지만 지명·업종명에 어떤 글자가
 * 나올지 알 수 없어 커버리지를 깎지 않았다 — 글자 하나가 빠지면 네모로 나온다.
 *
 * 모듈 최상단에서 한 번만 읽는다. 요청마다 1.5MB를 다시 읽을 이유가 없다.
 */
export const ogFont = await readFile(join(process.cwd(), 'assets/NotoSansKR-subset.otf'))

export const OG_SIZE = { width: 1200, height: 630 }

/** 화면과 같은 팔레트. 지적편집도의 상업지역 분홍이 강조색이다. */
export const OG = {
  ink: '#14111a',
  surface: '#1e1a26',
  line: '#383044',
  paper: '#ece7e3',
  muted: '#968ea6',
  commerce: '#e0447f',
}

export function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

export function radiusLabel(m: number) {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`
}
