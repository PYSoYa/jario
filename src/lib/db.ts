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
    // 한 요청이 병렬로 보내는 쿼리 수(현재 최대 5)보다 커야 한다.
    // 3으로 뒀을 때 /api/spot 이 성공과 504를 번갈아 냈다 — 쿼리가 커넥션을
    // 기다리다 함수 타임아웃까지 갔다. 쿼리 2개짜리 엔드포인트는 멀쩡했다.
    // 서버리스에서는 인스턴스마다 자기 풀을 연다. 8로 두었더니 트래픽이 없는데도
    // 연결이 24개(상한 60)였고, 인스턴스가 몇 개만 더 떠도 상한에 닿아 새 연결이
    // 막혔다 — 요청은 maxDuration(20초)까지 매달려 있다가 실패한다.
    // 간격을 두고 부를수록 새 인스턴스가 떠서 더 자주 걸렸다.
    //
    // 인스턴스 하나는 요청 하나를 다룬다. 한 요청 안의 병렬 쿼리를 위해 몇 개는
    // 필요하지만 8은 과했다. 쿼리 자체도 합쳐서 동시 개수를 줄였다.
    max: process.env.NODE_ENV === 'production' ? 3 : 10,
    prepare: !usesPooler,

    // 공간 쿼리는 종종 수백 ms가 걸린다. 개발 중 느린 쿼리를 놓치지 않도록 넉넉히 두되
    // 무한정 매달리지는 않게 한다.
    idle_timeout: 20,
    connect_timeout: 10,

    // statement_timeout 을 시작 파라미터로 보내는 것은 트랜잭션 모드 풀러에서
    // 지원 여부가 불확실해 넣지 않는다. 대신 라우트의 maxDuration 으로 막는다.
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
