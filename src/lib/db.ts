import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // 연결 문자열이 없으면 조용히 기본값으로 떨어지지 않고 즉시 죽는다.
  // 로컬 DB로 붙은 줄 알았는데 아니었던 상황이 제일 찾기 어렵다.
  throw new Error('DATABASE_URL이 설정되지 않았습니다. .env.example을 .env.local로 복사해서 채우세요.')
}

declare global {
  var __jarioSql: ReturnType<typeof postgres> | undefined
}

/**
 * Supabase의 트랜잭션 모드 풀러(PgBouncer, 6543 포트)로 붙는지.
 *
 * 서버리스에서는 이걸 통해야 한다. 함수 인스턴스가 늘어날 때마다 DB에 직접
 * 커넥션을 열면 Supabase 한도를 금방 넘긴다.
 *
 * 대신 제약이 붙는다 — 트랜잭션 모드에서는 prepared statement가 세션을 넘어
 * 살아남지 못한다. postgres.js는 기본으로 prepare를 쓰기 때문에 끄지 않으면
 * "prepared statement ... already exists" 오류가 산발적으로 난다.
 * 로컬에서는 재현되지 않고 배포 후 트래픽이 붙어야 나타나는 종류의 문제다.
 */
const usesPooler = /pooler\.supabase\.com|:6543/.test(connectionString)

function create() {
  return postgres(connectionString!, {
    // 인스턴스 수만큼 곱해지므로 작게 잡되, 1로 두면 목록·집계처럼 병렬로 보낸
    // 쿼리가 한 줄로 서서 응답 시간이 그대로 두 배가 된다.
    max: process.env.NODE_ENV === 'production' ? 3 : 10,
    prepare: !usesPooler,

    // 공간 쿼리는 종종 수백 ms가 걸린다. 개발 중 느린 쿼리를 놓치지 않도록 넉넉히 두되
    // 무한정 매달리지는 않게 한다.
    idle_timeout: 20,
    connect_timeout: 10,
    // 좌표는 double precision으로 오는데 postgres.js 기본 파서면 충분하다.
    // BIGINT는 JS number 정밀도를 넘길 수 있어 문자열로 받는다.
    types: {
      bigint: postgres.BigInt,
    },
  })
}

// Next.js 개발 서버는 매 요청마다 모듈을 다시 평가할 수 있어
// 전역에 붙이지 않으면 커넥션이 계속 새로 열린다.
export const sql = globalThis.__jarioSql ?? create()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__jarioSql = sql
}
