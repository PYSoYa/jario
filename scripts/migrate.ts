/**
 * 마이그레이션 러너.
 *
 * ORM 마이그레이션 도구를 쓰지 않는 이유: 이 프로젝트의 핵심은 공간 인덱스와
 * geography 컬럼인데, 대부분의 도구가 그걸 제대로 표현하지 못해 결국 raw SQL로
 * 탈출하게 된다. 그럴 바에는 처음부터 SQL 파일을 진실의 원본으로 둔다.
 *
 * 사용: pnpm db:migrate
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL이 없습니다.')
  }

  const sql = postgres(connectionString, {
    max: 1,
    // 기본 핸들러는 NOTICE를 객체째로 덤프해서 출력이 지저분해진다.
    onnotice: (notice) => console.log(`  note  ${notice.message}`),
  })

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    )

    let ran = 0
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`)
        continue
      }

      const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')

      // 마이그레이션 하나를 통째로 트랜잭션에 넣는다.
      // 중간에 실패하면 부분 적용된 스키마가 남지 않는다.
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
      })

      console.log(`  apply ${file}`)
      ran += 1
    }

    console.log(ran === 0 ? '\n변경 없음 — 이미 최신입니다.' : `\n${ran}개 적용 완료.`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('\n마이그레이션 실패:', err instanceof Error ? err.message : err)
  process.exit(1)
})
