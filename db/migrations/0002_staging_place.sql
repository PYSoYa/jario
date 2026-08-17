-- 원본 CSV를 손대지 않고 그대로 받는 스테이징 테이블.
--
-- 모든 컬럼이 text인 이유: 적재와 정제를 한 단계에서 같이 하면
-- 타입 변환 실패 한 건 때문에 13만 행 COPY 전체가 롤백된다.
-- 일단 다 받아놓고, 무엇이 더러운지 SQL로 확인한 뒤 정제한다.
--
-- 컬럼 순서는 CSV 헤더 순서와 정확히 일치해야 한다 (COPY가 순서로 매핑).
-- 2026-06 기준 39개 컬럼.

CREATE TABLE staging_place (
  상가업소번호        text,
  상호명              text,
  지점명              text,
  상권업종대분류코드  text,
  상권업종대분류명    text,
  상권업종중분류코드  text,
  상권업종중분류명    text,
  상권업종소분류코드  text,
  상권업종소분류명    text,
  표준산업분류코드    text,
  표준산업분류명      text,
  시도코드            text,
  시도명              text,
  시군구코드          text,
  시군구명            text,
  행정동코드          text,
  행정동명            text,
  법정동코드          text,
  법정동명            text,
  지번코드            text,
  대지구분코드        text,
  대지구분명          text,
  지번본번지          text,
  지번부번지          text,
  지번주소            text,
  도로명코드          text,
  도로명              text,
  건물본번지          text,
  건물부번지          text,
  건물관리번호        text,
  건물명              text,
  도로명주소          text,
  구우편번호          text,
  신우편번호          text,
  동정보              text,
  층정보              text,
  호정보              text,
  경도                text,
  위도                text
);

COMMENT ON TABLE staging_place IS
  '소상공인시장진흥공단 상가(상권)정보 CSV 원본. 분기마다 TRUNCATE 후 재적재한다.';
