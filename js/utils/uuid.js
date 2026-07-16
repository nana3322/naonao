/**
 * utils/uuid.js — UUID v4 생성 (crypto 지원 브라우저 우선)
 */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // 구형 브라우저 폴백
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
