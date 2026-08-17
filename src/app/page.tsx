import MapPanel from '@/components/MapPanel'
import { sql } from '@/lib/db'

// 업종 목록을 DB에서 읽으므로 빌드 시점에 미리 렌더할 수 없다.
// (Vercel 빌드 환경에는 DB가 없다)
export const dynamic = 'force-dynamic'

export default async function Home() {
  const industries = await sql<{ code: string; name: string }[]>`
    SELECT code, name FROM industry WHERE level = 1 ORDER BY name
  `

  return <MapPanel industries={industries.map((i) => ({ code: i.code, name: i.name }))} />
}
