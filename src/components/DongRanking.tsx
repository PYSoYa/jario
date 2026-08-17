'use client'

import { useQuery } from '@tanstack/react-query'
import { josa } from '@/lib/josa'

type DongStat = {
  code: string
  name: string
  sigungu: string
  total: number
  target: number
  share: number
  lq: number
  lon: number
  lat: number
}

type DongAnalysis = {
  baseShare: number
  minTotal: number
  dongs: DongStat[]
}

/**
 * LQ 색. 1이 기준선이다.
 * 1보다 크면 몰린 것(분홍), 작으면 적은 것(청록). 1 근처는 특징 없음이므로 회색으로 둔다.
 */
function toneForLq(lq: number) {
  if (lq >= 1.5) return 'var(--density-5)'
  if (lq >= 1.15) return 'var(--density-4)'
  if (lq > 0.85) return 'var(--density-3)'
  if (lq > 0.6) return 'var(--density-2)'
  return 'var(--density-1)'
}

export default function DongRanking({
  industry,
  industryName,
  onPick,
}: {
  industry: string
  industryName: string
  onPick: (spot: { lon: number; lat: number }) => void
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['dong', industry],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/analysis/dong?industry=${industry}`, { signal })
      if (!res.ok) throw new Error(`분석에 실패했습니다 (${res.status})`)
      return res.json() as Promise<DongAnalysis>
    },
  })

  if (isPending) return <p className="px-5 py-6 text-sm text-muted">계산 중…</p>
  if (error) return <p className="px-5 py-6 text-sm text-paper">{(error as Error).message}</p>
  if (!data || data.dongs.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted">비교할 동이 없습니다.</p>
  }

  const maxLq = Math.max(...data.dongs.map((d) => d.lq), 1)
  const top = data.dongs.slice(0, 8)
  const bottom = data.dongs.slice(-8).reverse()

  const row = (d: DongStat) => (
    <li key={d.code}>
      <button
        type="button"
        onClick={() => onPick({ lon: d.lon, lat: d.lat })}
        className="density-row flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-raised/60"
        style={
          {
            '--fill': `${(d.lq / maxLq) * 100}%`,
            '--tone': toneForLq(d.lq),
          } as React.CSSProperties
        }
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-paper">{d.name}</span>
          <span className="block truncate text-xs text-muted">
            {d.sigungu} · {industryName} <span className="measure">{d.target}</span> / 전체{' '}
            <span className="measure">{d.total.toLocaleString('ko-KR')}</span>
          </span>
        </span>
        <span className="measure shrink-0 text-sm text-paper">{d.lq.toFixed(2)}</span>
      </button>
    </li>
  )

  return (
    <div className="px-5 py-4">
      <p className="text-sm leading-snug text-muted">
        인천 전체에서 <span className="text-paper">{industryName}</span>
        {josa(industryName, '은는')} 업소{' '}
        <span className="measure text-paper">100</span>곳당{' '}
        <span className="measure text-paper">{(data.baseShare * 100).toFixed(1)}</span>곳입니다. 이
        기준선을 <span className="measure text-paper">1.00</span>으로 두고 동네별로 비교합니다.
      </p>

      <h2 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted">
        상권 규모 대비 많은 동네
      </h2>
      <ul className="space-y-px">{top.map(row)}</ul>

      <h2 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted">
        상권 규모 대비 적은 동네
      </h2>
      <ul className="space-y-px">{bottom.map(row)}</ul>

      {/* 이 지표로 할 수 없는 말을 분명히 해둔다. 낮은 LQ를 기회로 읽으면 위험하다. */}
      <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        <span className="text-paper/80">적다 = 기회가 아닙니다.</span> 이 값은 업소 구성만 보며,
        인구·유동인구·임대료·소득은 들어 있지 않습니다. 적은 이유가 수요가 없어서일 수 있습니다.
        업소 <span className="measure">{data.minTotal}</span>곳 미만인 동은 표본이 작아 제외했습니다.
      </p>
    </div>
  )
}
