/**
 * utils/validation.js — 입력 검증 + 필드 아래 오류 메시지 표시 (요구사항 16)
 * 오류는 해당 입력란 바로 아래 .field-error 요소에 표시한다.
 */

/** input 요소 아래에 오류 메시지를 표시 */
export function showFieldError(input, message) {
  clearFieldError(input);
  const el = document.createElement('div');
  el.className = 'field-error';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  input.classList.add('input-invalid');
  input.insertAdjacentElement('afterend', el);
}

/** 해당 input 의 오류 메시지 제거 */
export function clearFieldError(input) {
  input.classList.remove('input-invalid');
  const next = input.nextElementSibling;
  if (next && next.classList.contains('field-error')) next.remove();
}

/** 폼(컨테이너) 안의 모든 오류 제거 */
export function clearAllErrors(container) {
  container.querySelectorAll('.field-error').forEach(e => e.remove());
  container.querySelectorAll('.input-invalid').forEach(e => e.classList.remove('input-invalid'));
}

/** 필수값 검사. 비어 있으면 오류 표시 후 false */
export function required(input, message) {
  if (!input.value || !String(input.value).trim()) {
    showFieldError(input, message || '필수 입력 항목입니다.');
    return false;
  }
  clearFieldError(input);
  return true;
}

/** 0보다 큰 숫자인지 */
export function positiveNumber(input, message) {
  const n = Number(String(input.value).replace(/[^0-9.-]/g, ''));
  if (!(n > 0)) {
    showFieldError(input, message || '0보다 큰 숫자를 입력하세요.');
    return false;
  }
  clearFieldError(input);
  return true;
}

/** 음수가 아닌지 (빈 값은 통과 — kg/rep/세트는 선택 입력) */
export function nonNegativeOrEmpty(input, message) {
  if (input.value === '' || input.value === null) { clearFieldError(input); return true; }
  const n = Number(input.value);
  if (isNaN(n) || n < 0) {
    showFieldError(input, message || '0 이상의 숫자를 입력하세요.');
    return false;
  }
  clearFieldError(input);
  return true;
}

/** 시작/종료 시간 순서 검사 (같은 날 기준, 종료가 빠르면 오류) */
export function timeOrder(startInput, endInput, message) {
  if (!startInput.value || !endInput.value) return true;
  if (endInput.value < startInput.value) {
    showFieldError(endInput, message || '종료 시간이 시작 시간보다 빠릅니다.');
    return false;
  }
  clearFieldError(endInput);
  return true;
}

/** 종료일이 시작일보다 빠르지 않은지 */
export function dateOrder(startInput, endInput, message) {
  if (!startInput.value || !endInput.value) return true;
  if (endInput.value < startInput.value) {
    showFieldError(endInput, message || '종료일이 시작일보다 빠릅니다.');
    return false;
  }
  clearFieldError(endInput);
  return true;
}
