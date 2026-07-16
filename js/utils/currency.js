/**
 * utils/currency.js — 금액 표기 (K 단위 금지, '123,456원' 형식)
 */

/** 숫자 → '123,456원' */
export function won(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ko-KR') + '원';
}

/** 입력 문자열에서 숫자만 추출 */
export function parseAmount(s) {
  const n = Number(String(s).replace(/[^0-9]/g, ''));
  return isNaN(n) ? 0 : n;
}
