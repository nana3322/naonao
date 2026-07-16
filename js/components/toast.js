/**
 * components/toast.js — 저장 완료/오류 안내 토스트
 * 스크린리더 인식을 위해 role="status" (요구사항 18)
 */
let holder = null;

function ensureHolder() {
  if (holder) return holder;
  holder = document.createElement('div');
  holder.className = 'toast-holder';
  holder.setAttribute('aria-live', 'polite');
  document.body.appendChild(holder);
  return holder;
}

/** type: 'info' | 'success' | 'warn' | 'error' */
export function toast(message, type = 'success', ms = 2600) {
  const h = ensureHolder();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  h.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
