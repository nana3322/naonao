/**
 * services/attachmentService.js — 사진 / 손글씨 / 음성 첨부
 *
 * 저장 구조:
 *  - 원본 파일(Blob) → IndexedDB 'blobs' 스토어 (오프라인 재생/표시용, 요구사항 11)
 *  - 메타데이터 → 'attachment' 리소스 (동기화 대상)
 *  - 온라인 시 syncService 가 Drive 업로드 후 driveUrl 기록
 *
 * 재생/표시 우선순위: 로컬 Blob → Drive URL
 */
import { dbPut, dbGet } from '../db/indexedDb.js';
import { saveLocal, queueAttachmentUpload } from '../api/syncService.js';
import { uuid } from '../utils/uuid.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { button } from '../state.js';

/** 첨부 저장 공통: Blob + 메타 기록 후 업로드 큐 등록 */
export async function saveAttachment(ownerType, ownerId, fileType, blob, fileName, mimeType) {
  const id = uuid();
  await dbPut('blobs', { id, blob });
  await saveLocal('attachment', {
    id, ownerType, ownerId, fileType,
    driveFileId: '', driveUrl: '',
    fileName, mimeType, size: blob.size
  });
  await queueAttachmentUpload(id);
  return id;
}

/** 첨부의 재생/표시용 URL. 로컬 Blob 우선, 없으면 Drive URL */
export async function attachmentUrl(att) {
  const row = await dbGet('blobs', att.id);
  if (row && row.blob) return URL.createObjectURL(row.blob);
  return att.driveUrl || '';
}

/* ---------------- 사진 (여러 장, 압축) ---------------- */

/** 카메라/갤러리에서 사진 선택 → 압축 → 저장. 완료 후 onSaved(ids) */
export function pickPhotos(ownerType, ownerId, onSaved) {
  const inputEl = document.createElement('input');
  inputEl.type = 'file';
  inputEl.accept = 'image/*';
  inputEl.multiple = true; // 여러 장 첨부 (요구사항 6-2)
  inputEl.addEventListener('change', async () => {
    const ids = [];
    for (const file of inputEl.files) {
      const compressed = await compressImage(file, 1280, 0.8); // 클라이언트 압축 (요구사항 17)
      const id = await saveAttachment(ownerType, ownerId, 'image', compressed,
        file.name || ('photo-' + Date.now() + '.jpg'), 'image/jpeg');
      ids.push(id);
    }
    if (ids.length) { toast(`사진 ${ids.length}장을 첨부했습니다.`); onSaved && onSaved(ids); }
  });
  inputEl.click();
}

/** 이미지 압축: 최대 변 maxSize, JPEG 품질 quality */
export function compressImage(file, maxSize = 1280, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (Math.max(width, height) > maxSize) {
        const ratio = maxSize / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b || file); }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ---------------- 손글씨 (Canvas) ---------------- */

/** 손글씨 시트 열기. 완료 시 이미지 저장 후 onSaved(id) */
export function openHandwriting(ownerType, ownerId, onSaved) {
  const wrap = document.createElement('div');

  // 도구: 펜 굵기 / 지우개 / 전체 지우기 / 실행 취소 (요구사항 6-2)
  const tools = document.createElement('div');
  tools.className = 'hw-tools';
  const sizeSel = document.createElement('select');
  sizeSel.className = 'input hw-size';
  [['2', '가는 펜'], ['4', '보통 펜'], ['8', '굵은 펜']].forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; sizeSel.appendChild(o);
  });
  sizeSel.value = '4';
  const eraserBtn = button('지우개', 'btn btn-ghost', '지우개');
  const undoBtn = button('실행 취소', 'btn btn-ghost', '실행 취소');
  const clearBtn = button('전체 지우기', 'btn btn-ghost', '전체 지우기');
  tools.append(sizeSel, eraserBtn, undoBtn, clearBtn);

  const canvas = document.createElement('canvas');
  canvas.className = 'hw-canvas';
  canvas.width = Math.min(window.innerWidth - 32, 600);
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false, erasing = false;
  const history = []; // 실행 취소용 스냅샷

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (canvas.width / rect.width), y: (t.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function start(e) {
    e.preventDefault();
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > 20) history.shift();
    drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.strokeStyle = erasing ? '#ffffff' : '#111111';
    ctx.lineWidth = erasing ? 24 : Number(sizeSel.value);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end() { drawing = false; }

  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);

  eraserBtn.addEventListener('click', () => {
    erasing = !erasing;
    eraserBtn.classList.toggle('btn-primary', erasing);
    eraserBtn.textContent = erasing ? '지우개 사용 중' : '지우개';
  });
  undoBtn.addEventListener('click', () => {
    const snap = history.pop();
    if (snap) ctx.putImageData(snap, 0, 0);
  });
  clearBtn.addEventListener('click', () => {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  const done = button('완료 — 이미지로 저장', 'btn btn-primary btn-block');
  wrap.append(tools, canvas, done);
  const { close } = openSheet('손글씨', wrap, { full: true });

  done.addEventListener('click', () => {
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('저장에 실패했습니다.', 'error'); return; }
      const id = await saveAttachment(ownerType, ownerId, 'handwriting', blob,
        'handwriting-' + Date.now() + '.png', 'image/png');
      toast('손글씨를 저장했습니다.');
      close();
      onSaved && onSaved(id);
    }, 'image/png');
  });
}

/* ---------------- 음성 녹음 (MediaRecorder) ---------------- */

/** 녹음 시트 열기. 저장 시 onSaved(id). 안드로이드 mp4/AAC 우선 지원. */
export function openRecorder(ownerType, ownerId, onSaved) {
  const wrap = document.createElement('div');
  wrap.className = 'rec-wrap';

  const timeEl = document.createElement('div');
  timeEl.className = 'rec-time';
  timeEl.textContent = '00:00';

  const controls = document.createElement('div');
  controls.className = 'rec-controls';
  const recBtn = button('● 녹음 시작', 'btn btn-danger', '녹음 시작');
  const pauseBtn = button('일시 정지', 'btn btn-ghost', '일시 정지');
  const stopBtn = button('■ 중지', 'btn btn-ghost', '녹음 중지');
  pauseBtn.disabled = true; stopBtn.disabled = true;
  controls.append(recBtn, pauseBtn, stopBtn);

  const preview = document.createElement('div');
  preview.className = 'rec-preview';

  const actions = document.createElement('div');
  actions.className = 'rec-actions';
  const saveBtn = button('저장', 'btn btn-primary btn-block');
  const discardBtn = button('삭제', 'btn btn-ghost btn-block');
  saveBtn.disabled = true; discardBtn.disabled = true;
  actions.append(saveBtn, discardBtn);

  wrap.append(timeEl, controls, preview, actions);
  const { close } = openSheet('음성 기록', wrap);

  let recorder = null, chunks = [], stream = null, timer = null, seconds = 0, resultBlob = null, mime = '';

  function tick() {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timeEl.textContent = `${m}:${s}`;
  }

  // 지원 형식 선택: 안드로이드 크롬은 audio/mp4(AAC) 지원 → 재생 호환 최우선
  function pickMime() {
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  recBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.', 'error');
      return;
    }
    mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      resultBlob = new Blob(chunks, { type: mime || 'audio/webm' });
      // 재생 미리듣기
      preview.innerHTML = '';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = URL.createObjectURL(resultBlob);
      preview.appendChild(audio);
      saveBtn.disabled = false;
      discardBtn.disabled = false;
      stream.getTracks().forEach(t => t.stop());
    };
    recorder.start();
    seconds = 0; timeEl.textContent = '00:00';
    timer = setInterval(tick, 1000);
    recBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
  });

  pauseBtn.addEventListener('click', () => {
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause(); clearInterval(timer);
      pauseBtn.textContent = '다시 시작';
    } else if (recorder.state === 'paused') {
      recorder.resume(); timer = setInterval(tick, 1000);
      pauseBtn.textContent = '일시 정지';
    }
  });

  stopBtn.addEventListener('click', () => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); clearInterval(timer);
      pauseBtn.disabled = true; stopBtn.disabled = true;
    }
  });

  discardBtn.addEventListener('click', async () => {
    if (await confirmDialog('이 녹음을 삭제할까요?', '삭제', true)) {
      resultBlob = null; preview.innerHTML = '';
      saveBtn.disabled = true; discardBtn.disabled = true;
      recBtn.disabled = false;
      seconds = 0; timeEl.textContent = '00:00';
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!resultBlob) return;
    const ext = (mime || '').includes('mp4') ? 'm4a' : 'webm';
    const id = await saveAttachment(ownerType, ownerId, 'audio', resultBlob,
      'voice-' + Date.now() + '.' + ext, resultBlob.type || 'audio/webm');
    toast('음성 기록을 저장했습니다.');
    close();
    onSaved && onSaved(id);
  });
}
