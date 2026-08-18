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
    /**
     * **한 요청이 동시에 던지는 쿼리 수보다 반드시 커야 한다.**
     *
     * 이걸 어기면 남는 쿼리가 커넥션을 기다리다 함수 타임아웃(20초)까지 간다.
     * 두 번 겪었다. 처음엔 max 3에 쿼리 5개였고, 두 번째는 내가 /api/spot 에
     * 회전·상권·소멸률을 얹어 쿼리를 8개로 늘려놓고 max 를 3으로 내렸다.
     *
     * 증상이 고약하다. 같은 인스턴스가 다른 경로는 200으로 처리하고 이 경로만
     * 504를 낸다. 쿼리별로 시간을 찍어보면 일곱 개는 200ms 안에 끝나고
     * **가장 무거운 하나만 로그가 아예 없다** — 영원히 매달려 있다.
     *
     * 늘리기만 하면 되는 것도 아니다. 서버리스는 인스턴스마다 자기 풀을 열어서,
     * 8로 뒀을 때 트래픽 없이도 연결이 24개였다(상한 60). 그래서 idle_timeout 을
     * 짧게 잡아 요청 사이에 바로 반납한다.
     */
    max: process.env.NODE_ENV === 'production' ? 10 : 10,
    prepare: !usesPooler,

    // 요청 사이에 커넥션을 오래 붙들지 않는다. 서버리스에서 요청은 짧고, 남겨두면
    // 인스턴스 수만큼 곱해져 상한에 닿는다. 짧게 잡아도 한 요청 안에서는 재사용된다.
    idle_timeout: 5,
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
