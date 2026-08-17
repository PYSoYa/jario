/**
 * 받침에 따라 조사를 고른다.
 *
 * 업종 이름이 데이터에서 오기 때문에 문구에 조사를 고정할 수 없다.
 * "카페은 / 편의점는" 같은 문장이 나오면 만든 사람이 한국어를 안 쓴 것처럼 보인다.
 */
type JosaPair = '은는' | '이가' | '을를' | '과와' | '으로로'

// 인덱스 산술로 자르면 '으로로'처럼 길이가 다른 쌍에서 틀린다. 표로 둔다.
const FORMS: Record<JosaPair, { batchim: string; noBatchim: string }> = {
  은는: { batchim: '은', noBatchim: '는' },
  이가: { batchim: '이', noBatchim: '가' },
  을를: { batchim: '을', noBatchim: '를' },
  과와: { batchim: '과', noBatchim: '와' },
  으로로: { batchim: '으로', noBatchim: '로' },
}

const RIEUL = 8 // 종성 ㄹ

export function josa(word: string, pair: JosaPair): string {
  const form = FORMS[pair]
  const last = word.at(-1)
  if (!last) return form.noBatchim

  const code = last.charCodeAt(0)
  // 한글 음절 영역이 아니면(숫자·영문 등) 판별할 수 없다. 받침 없음으로 둔다.
  if (code < 0xac00 || code > 0xd7a3) return form.noBatchim

  const jongseong = (code - 0xac00) % 28
  if (jongseong === 0) return form.noBatchim

  // '서울로'처럼 ㄹ 받침 뒤에는 '으로'가 아니라 '로'를 쓴다.
  if (pair === '으로로' && jongseong === RIEUL) return form.noBatchim

  return form.batchim
}

/** 단어와 조사를 붙여서 돌려준다. */
export function withJosa(word: string, pair: JosaPair): string {
  return word + josa(word, pair)
}
