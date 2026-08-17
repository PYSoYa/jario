import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { josa, withJosa } from '../src/lib/josa.ts'

describe('josa', () => {
  it('받침이 없으면 는/가/를/와', () => {
    assert.equal(josa('카페', '은는'), '는')
    assert.equal(josa('미용실', '은는'), '은') // ㄹ도 받침이다
    assert.equal(josa('약국', '이가'), '이')
    assert.equal(josa('노래방', '을를'), '을')
    assert.equal(josa('세탁소', '과와'), '와')
  })

  it('실제 업종명에 맞는 조사를 고른다', () => {
    assert.equal(withJosa('카페', '은는'), '카페는')
    assert.equal(withJosa('편의점', '은는'), '편의점은')
    assert.equal(withJosa('슈퍼마켓', '은는'), '슈퍼마켓은')
    assert.equal(withJosa('네일숍', '은는'), '네일숍은')
    assert.equal(withJosa('피자', '은는'), '피자는')
    assert.equal(withJosa('백반/한정식', '은는'), '백반/한정식은')
  })

  it("'으로/로'는 ㄹ 받침에서 '로'가 된다", () => {
    assert.equal(withJosa('부평', '으로로'), '부평으로')
    assert.equal(withJosa('서울', '으로로'), '서울로')
    assert.equal(withJosa('개항동', '으로로'), '개항동으로')
    assert.equal(withJosa('카페', '으로로'), '카페로')
  })

  it('한글이 아니면 받침 없음으로 본다', () => {
    assert.equal(withJosa('PC방', '은는'), 'PC방은')
    assert.equal(withJosa('CU', '은는'), 'CU는')
    assert.equal(withJosa('', '은는'), '는')
  })
})
