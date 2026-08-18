/**
 * 원격 DB(Supabase) 상태 점검.
 *
 * 적재를 시작하기 전에 붙는지·PostGIS가 있는지·이미 뭐가 들어 있는지를 본다.
 * 되돌리기 어려운 작업 전에 대상을 확인하는 용도라 아무것도 바꾸지 않는다.
 *
 * 사용: pnpm db:remote:check
 */
import postgres from 'postgres'

const url = process.env.SUPABASE_SESSION_URL

if (!url) {
  console.error('SUPABASE_SESSION_URL 이 없습니다. .env.local 을 확인하세요.')
  process.exit(1)
}

if (url.includes('<PASSWORD>')) {
  console.error('SUPABASE_SESSION_URL 의 <PASSWORD> 자리를 실제 비밀번호로 바꾸세요.')
  process.exit(1)
}

let target: URL
try {
  target = new URL(url)
} catch {
  console.error('SUPABASE_SESSION_URL 을 URL로 해석하지 못했습니다.')
  console.error('비밀번호에 @ : / ? # % 같은 문자가 있으면 URL 인코딩이 필요합니다.')
  process.exit(1)
}

const sql = postgres(url, { max: 1, connect_timeout: 15, prepare: false })

async function main() {
  console.log(`대상: ${target.hostname}:${target.port}${target.pathname}\n`)

  const [ver] = await sql<{ v: string }[]>`SELECT version() AS v`
  console.log('버전 :', ver.v.split(',')[0])

  const [gis] = await sql<{ installed: string | null; available: string | null }[]>`
    SELECT
      (SELECT extversion FROM pg_extension WHERE extname = 'postgis')            AS installed,
      (SELECT default_version FROM pg_available_extensions WHERE name='postgis') AS available
  `
  console.log('PostGIS :', gis.installed ? `설치됨 ${gis.installed}` : `미설치 (설치 가능 ${gis.available ?? '아니오'})`)

  const tables = await sql<{ name: string; rows: string }[]>`
    SELECT c.relname AS name, c.reltuples::bigint::text AS rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `
  console.log('\n기존 public 테이블:', tables.length === 0 ? '없음' : '')
  for (const t of tables) console.log(`  ${t.name} (약 ${Number(t.rows).toLocaleString('ko-KR')}행)`)

  const [size] = await sql<{ size: string }[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `
  console.log('\nDB 크기 :', size.size)

  // 서버리스에서 인스턴스가 늘어나면 각자 풀을 연다. 한도를 넘으면 새 연결이
  // 막히고, 요청은 maxDuration 까지 매달려 있다가 실패한다. 실제로 그렇게 겪었다.
  const [conn] = await sql<
    { total: string; active: string; idle: string; limit_: string }[]
  >`
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE state = 'active')::text AS active,
           count(*) FILTER (WHERE state = 'idle')::text   AS idle,
           current_setting('max_connections')             AS limit_
    FROM pg_stat_activity WHERE datname = current_database()
  `
  console.log(
    `연결    : ${conn.total}개 (활성 ${conn.active} / 유휴 ${conn.idle}) · 상한 ${conn.limit_}`,
  )
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('\n연결 실패:', msg)
    if (/password authentication failed/i.test(msg)) {
      console.error('→ 비밀번호가 틀렸습니다. 대시보드에서 재설정할 수 있습니다.')
    } else if (/ENOTFOUND|EAI_AGAIN/.test(msg)) {
      console.error('→ 호스트를 찾지 못했습니다. 프로젝트 ref를 확인하세요.')
    } else if (/timeout/i.test(msg)) {
      console.error('→ 프로젝트가 일시정지 상태일 수 있습니다. 대시보드에서 깨우세요.')
    }
    process.exitCode = 1
  })
  .finally(() => sql.end())
