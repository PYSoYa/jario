/**
 * M0 · 데이터 실사.
 *
 * 스키마를 추측해서 쓰지 않기 위한 스크립트다. 공공데이터는 분기마다 컬럼이
 * 조용히 바뀌고, 인코딩이 UTF-8이라고 써 있어도 CP949인 경우가 있다.
 * 적재 전에 실물을 확인한다.
 *
 * 사용:
 *   pnpm data:inspect data/소상공인시장진흥공단_상가정보_202603.zip
 *   pnpm data:inspect data/somefile.csv
 */
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'

const target = process.argv[2]
if (!target) {
  console.error('사용법: pnpm data:inspect <경로.zip | 경로.csv>')
  process.exit(1)
}

/** zip 안의 csv 엔트리 목록 */
function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-Z1', zipPath])
    let out = ''
    p.stdout.on('data', (c) => (out += c))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`unzip -Z1 실패 (code ${code})`))
      resolve(out.split('\n').map((s) => s.trim()).filter((s) => s.toLowerCase().endsWith('.csv')))
    })
  })
}

function openStream(path: string, zipEntry?: string): Readable {
  if (!zipEntry) return createReadStream(path)
  // zip 전체를 풀지 않고 해당 엔트리만 스트림으로 뽑는다.
  const p = spawn('unzip', ['-p', path, zipEntry])
  return p.stdout
}

/**
 * 인코딩 판별. 앞부분을 UTF-8로 엄격하게(fatal) 디코딩해보고 실패하면 CP949로 본다.
 *
 * 주의: 표본을 그냥 잘라서 디코딩하면 안 된다. 한글은 UTF-8에서 3바이트라
 * 자르는 지점이 문자 중간일 확률이 높고, 그러면 멀쩡한 UTF-8 파일도
 * "깨졌다"고 오판한다. `stream: true`로 디코딩해 뒤에 남은 불완전한
 * 바이트열은 판정에서 제외한다.
 */
async function detectEncoding(path: string, zipEntry?: string): Promise<'utf-8' | 'euc-kr'> {
  const stream = openStream(path, zipEntry)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
    size += (chunk as Buffer).length
    if (size > 64 * 1024) break
  }
  stream.destroy?.()
  const head = Buffer.concat(chunks)

  try {
    // fatal: true → 잘못된 바이트열이면 치환하지 않고 예외를 던진다.
    // stream: true → 끝에 걸린 불완전한 문자는 보류하고 넘어간다.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true })
    return 'utf-8'
  } catch {
    return 'euc-kr'
  }
}

/** 따옴표를 고려한 최소한의 CSV 한 줄 파서 */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { quoted = false }
      } else cur += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

async function inspect(path: string, zipEntry?: string) {
  const label = zipEntry ? `${path} :: ${zipEntry}` : path
  console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`)

  const encoding = await detectEncoding(path, zipEntry)
  console.log(`인코딩 판별: ${encoding}${encoding === 'euc-kr' ? '  ⚠ UTF-8 아님 — 적재 시 변환 필요' : ''}`)

  const decoder = new TextDecoder(encoding)
  const stream = openStream(path, zipEntry)
  const rl = createInterface({
    input: Readable.from((async function* () {
      for await (const chunk of stream) yield decoder.decode(chunk as Buffer, { stream: true })
    })()),
    crlfDelay: Infinity,
  })

  let header: string[] = []
  let rows = 0
  let malformed = 0
  const samples: string[][] = []

  // 좌표 품질과 지역 분포를 같이 본다.
  let lonIdx = -1, latIdx = -1, sidoIdx = -1
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
  let missingCoord = 0
  const sidoCount = new Map<string, number>()

  for await (const line of rl) {
    if (!line.trim()) continue

    if (header.length === 0) {
      header = parseCsvLine(line).map((h) => h.replace(/^﻿/, '').trim())
      lonIdx = header.findIndex((h) => h === '경도' || /longitude|^lon$|^x$/i.test(h))
      latIdx = header.findIndex((h) => h === '위도' || /latitude|^lat$|^y$/i.test(h))
      sidoIdx = header.findIndex((h) => h.includes('시도명'))
      continue
    }

    const cols = parseCsvLine(line)
    rows++
    if (cols.length !== header.length) malformed++
    if (samples.length < 3) samples.push(cols)

    if (lonIdx >= 0 && latIdx >= 0) {
      const lon = Number(cols[lonIdx])
      const lat = Number(cols[latIdx])
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon === 0 || lat === 0) {
        missingCoord++
      } else {
        if (lon < lonMin) lonMin = lon
        if (lon > lonMax) lonMax = lon
        if (lat < latMin) latMin = lat
        if (lat > latMax) latMax = lat
      }
    }

    if (sidoIdx >= 0) {
      const v = cols[sidoIdx] ?? ''
      sidoCount.set(v, (sidoCount.get(v) ?? 0) + 1)
    }
  }

  console.log(`\n컬럼 ${header.length}개:`)
  header.forEach((h, i) => console.log(`  [${String(i).padStart(2)}] ${h}`))

  console.log(`\n데이터 행: ${rows.toLocaleString()}`)
  if (malformed > 0) {
    console.log(`⚠ 컬럼 수가 헤더와 다른 행: ${malformed.toLocaleString()} — 파서 보강 필요`)
  }

  if (lonIdx >= 0 && latIdx >= 0) {
    console.log(`\n좌표 (경도 [${lonIdx}], 위도 [${latIdx}])`)
    console.log(`  경도 범위: ${lonMin} ~ ${lonMax}`)
    console.log(`  위도 범위: ${latMin} ~ ${latMax}`)
    console.log(`  좌표 없음/0: ${missingCoord.toLocaleString()} (${((missingCoord / rows) * 100).toFixed(2)}%)`)
    // 한국 본토 대략 범위. 벗어나면 좌표계가 WGS84가 아닐 수 있다.
    const inKorea = lonMin >= 124 && lonMax <= 132 && latMin >= 33 && latMax <= 39
    console.log(`  WGS84 한국 범위 부합: ${inKorea ? '예' : '아니오  ⚠ 좌표계 확인 필요'}`)
  } else {
    console.log('\n⚠ 경도/위도 컬럼을 찾지 못했습니다. 헤더를 보고 스크립트를 조정하세요.')
  }

  if (sidoCount.size > 0) {
    console.log('\n시도 분포 (상위 10):')
    ;[...sidoCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([k, v]) => console.log(`  ${(k || '(빈값)').padEnd(10)} ${v.toLocaleString()}`))
  }

  console.log('\n샘플 행:')
  samples.forEach((cols, n) => {
    console.log(`  --- ${n + 1} ---`)
    header.forEach((h, i) => {
      const v = cols[i] ?? ''
      if (v !== '') console.log(`    ${h}: ${v}`)
    })
  })
}

async function main() {
  await stat(target).catch(() => {
    throw new Error(`파일이 없습니다: ${target}`)
  })

  if (target.toLowerCase().endsWith('.zip')) {
    const entries = await listZipEntries(target)
    if (entries.length === 0) throw new Error('zip 안에 csv가 없습니다.')
    console.log(`zip 내 CSV ${entries.length}개:`)
    entries.forEach((e) => console.log(`  - ${e}`))
    for (const entry of entries) await inspect(target, entry)
  } else {
    await inspect(target)
  }
}

main().catch((err) => {
  console.error('\n실사 실패:', err instanceof Error ? err.message : err)
  process.exit(1)
})
