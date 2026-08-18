import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getReport, type Report } from '@/lib/reports'
import { josa } from '@/lib/josa'

export const dynamic = 'force-dynamic'

function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

function radiusLabel(m: number) {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`
}

export async function generateMetadata({
  params,
}: PageProps<'/r/[id]'>): Promise<Metadata> {
  const { id } = await params
  const report = await getReport(id)
  if (!report) return { title: '없는 리포트 — jario' }

  const what = report.industry ? report.industry.name : '전체 업종'
  return {
    title: `${report.a.label ?? 'A'} vs ${report.b.label ?? 'B'} — jario`,
    description: `반경 ${radiusLabel(report.radius)} 안 ${what} 비교. ${fmt(report.a.total)}곳 vs ${fmt(report.b.total)}곳.`,
  }
}

/** 두 값 중 나은 쪽을 표시한다. 경쟁 밀도는 낮을수록 유리하다. */
function Row({
  label,
  a,
  b,
  hint,
  lowerIsBetter = false,
}: {
  label: string
  a: React.ReactNode
  b: React.ReactNode
  hint?: string
  lowerIsBetter?: boolean
}) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-3 pr-4 text-left text-sm font-normal text-muted">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-muted/70">{hint}</span>}
        {lowerIsBetter && <span className="mt-0.5 block text-xs text-muted/70">낮을수록 유리</span>}
      </th>
      <td className="py-3 pr-4 text-sm text-paper">{a}</td>
      <td className="py-3 text-sm text-paper">{b}</td>
    </tr>
  )
}

function spotCol(s: Report['a'], industryName: string | null) {
  return {
    total: <span className="measure">{fmt(s.total)}</span>,
    target:
      s.targetCount === null ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="measure text-commerce">{fmt(s.targetCount)}</span>
      ),
    nearest:
      s.nearestSameM === null ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="measure">{fmt(s.nearestSameM)}m</span>
      ),
    dong: s.dong ? (
      <>
        {s.dong.sigungu} {s.dong.name}
        {s.dong.lq !== null && (
          <span className="ml-1.5 measure text-muted">LQ {s.dong.lq.toFixed(2)}</span>
        )}
      </>
    ) : (
      <span className="text-muted">—</span>
    ),
    churn: s.churn ? (
      <>
        <span className="measure text-commerce">{fmt(s.churn.closed)}</span>
        <span className="text-muted"> 사라짐 · </span>
        <span className="measure">{fmt(s.churn.opened)}</span>
        <span className="text-muted"> 새로 생김</span>
      </>
    ) : (
      <span className="text-muted">—</span>
    ),
    vacancy:
      s.market?.vacancyRate == null ? (
        <span className="text-muted">—</span>
      ) : (
        <>
          <span className="measure">{s.market.vacancyRate}</span>
          <span className="text-muted">% · {s.market.name}</span>
        </>
      ),
    rent:
      s.market?.rentPerM2 == null ? (
        <span className="text-muted">—</span>
      ) : (
        <>
          <span className="measure">{Math.round(s.market.rentPerM2 * 3.3)}</span>
          <span className="text-muted">만원 · {s.market.name}</span>
        </>
      ),
    top: (
      <ul className="space-y-0.5">
        {s.topIndustries.map((t) => (
          <li key={t.code} className="flex justify-between gap-3">
            <span className="truncate">{t.name}</span>
            <span className="measure shrink-0 text-muted">{fmt(t.count)}</span>
          </li>
        ))}
      </ul>
    ),
    coords: (
      <span className="measure text-xs text-muted">
        {s.lon.toFixed(5)}, {s.lat.toFixed(5)}
      </span>
    ),
    industryName,
  }
}

export default async function ReportPage({ params }: PageProps<'/r/[id]'>) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const what = report.industry?.name ?? null
  const A = spotCol(report.a, what)
  const B = spotCol(report.b, what)
  const aName = report.a.label ?? '후보지 A'
  const bName = report.b.label ?? '후보지 B'

  return (
    <main className="mx-auto min-h-full max-w-3xl px-5 py-10 md:py-16">
      <header>
        <Link href="/" className="text-sm text-muted transition-colors hover:text-paper">
          jario <span className="text-muted/60">자리</span>
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-paper md:text-3xl">
          {aName} <span className="text-muted">vs</span> {bName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          반경 <span className="measure text-paper">{radiusLabel(report.radius)}</span> 기준
          {what && (
            <>
              , <span className="text-paper">{what}</span>
              {josa(what, '을를')} 중심으로
            </>
          )}{' '}
          비교했습니다.
        </p>
      </header>

      {report.stale && (
        <p className="mt-6 rounded border border-line bg-raised px-4 py-3 text-sm leading-snug text-paper/80">
          이 리포트는 <span className="measure">{report.dataVersion}</span> 데이터로 만들어졌는데,
          지금 서비스는 다른 분기 데이터를 쓰고 있습니다. 아래 숫자는 <b>현재 데이터로 다시
          계산한 값</b>이라 공유한 시점과 다를 수 있습니다.
        </p>
      )}

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr>
            <th className="w-32 pb-3 text-left text-xs font-medium tracking-wide text-muted md:w-44">
              항목
            </th>
            <th className="pb-3 pr-4 text-left text-sm font-semibold text-paper">{aName}</th>
            <th className="pb-3 text-left text-sm font-semibold text-paper">{bName}</th>
          </tr>
        </thead>
        <tbody>
          <Row label="반경 안 전체 업소" a={A.total} b={B.total} />
          {what && (
            <>
              <Row label={`${what} 수`} a={A.target} b={B.target} lowerIsBetter />
              <Row
                label={`가장 가까운 ${what}`}
                a={A.nearest}
                b={B.nearest}
                hint="멀수록 바로 옆 경쟁이 없다"
              />
            </>
          )}
          <Row
            label="행정동"
            a={A.dong}
            b={B.dong}
            hint={what ? `LQ는 상권 규모 대비 ${what} 편중도` : undefined}
          />
          <Row
            label="최근 6개월 회전"
            a={A.churn}
            b={B.churn}
            hint="사라진 곳에는 폐업뿐 아니라 이전·상호변경도 섞여 있다"
          />
          <Row
            label="공실률"
            a={A.vacancy}
            b={B.vacancy}
            lowerIsBetter
            hint="가장 가까운 조사 상권 기준 (3km 밖이면 표시하지 않는다)"
          />
          <Row
            label="10평 월 임대료"
            a={A.rent}
            b={B.rent}
            lowerIsBetter
            hint="㎡당 조사값을 33㎡로 환산한 값 — 실제 면적은 가게마다 다르다"
          />
          <Row label="주변에 많은 업종" a={A.top} b={B.top} />
          <Row label="좌표" a={A.coords} b={B.coords} />
        </tbody>
      </table>

      <section className="mt-10 border-t border-line pt-6 text-xs leading-relaxed text-muted">
        <p>
          <span className="text-paper/80">이 표로 할 수 없는 말이 있습니다.</span> 인구·유동인구·소득은
          들어 있지 않습니다. 경쟁이 적은 것이 곧 기회는 아닙니다 — 수요가 없어서일 수 있습니다.
        </p>
        <p className="mt-2">
          행정동은 경계 데이터가 없어 가장 가까운 업소의 동으로 판단했습니다. 경계 근처에서는
          틀릴 수 있습니다.
        </p>
        <p className="mt-2">
          공실률·임대료는 한국부동산원 상업용부동산 임대동향조사(소규모상가)이고, 이 자리가 아니라{' '}
          <span className="text-paper/80">가장 가까운 조사 상권</span>의 값입니다 — 조사에 상권
          경계가 없어 소속을 판정할 수 없습니다. 회전은 분기 스냅샷 두 장을 대조한 값이라
          &ldquo;폐업&rdquo;으로 단정하지 않습니다.
        </p>
        <p className="mt-2">
          소상공인시장진흥공단 <span className="measure">{report.dataVersion}</span> 스냅샷 ·
          작성 {new Date(report.createdAt).toLocaleDateString('ko-KR')}
        </p>
      </section>
    </main>
  )
}
