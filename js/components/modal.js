/**
 * components/modal.js — 바텀시트 모달 + 확인창
 * openSheet(title, contentEl, opts) → { close } 반환
 * confirmDialog(message) → Promise<boolean>
 */

/** 바텀시트 열기. contentEl 은 DOM 요소. */
export function openSheet(title, contentEl, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (opts.full ? ' sheet-full' : '');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', title);

  const header = document.createElement('div');
  header.className = 'sheet-header';
  const h = document.createElement('h2');
  h.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', '닫기');
  closeBtn.textContent = '✕';
  header.append(h, closeBtn);

  const body = document.createElement('div');
  body.className = 'sheet-body';
  body.appendChild(contentEl);

  sheet.append(header, body);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  function close() {
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      document.body.classList.remove('no-scroll');
      if (opts.onClose) opts.onClose();
    }, 200);
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !opts.blockOutside) close(); });
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { close, sheet, body };
}

/** 확인창 (삭제 전 확인 등). 확인=true / 취소=false */
export function confirmDialog(message, confirmLabel = '확인', danger = false) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'confirm-box';
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'confirm-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = '취소';
    const ok = document.createElement('button');
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    ok.textContent = confirmLabel;
    row.append(cancel, ok);
    box.append(p, row);
    const { close } = openSheet('확인', box, { blockOutside: true });
    cancel.addEventListener('click', () => { close(); resolve(false); });
    ok.addEventListener('click', () => { close(); resolve(true); });
  });
}
