/**
 * utils/date.js — 날짜/시간 헬퍼 (한국 형식, Asia/Seoul 기준)
 * 저장 포맷: 날짜 'YYYY-MM-DD', 시간 'HH:MM'
 */
export const WEEKDAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** 오늘 Date 객체 (기기 로컬 시각 = 사용자가 한국이면 KST) */
export function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/** Date → 'YYYY-MM-DD' */
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → Date */
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** n일 더한 새 Date */
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** '2026년 7월 16일 목요일' */
export function formatKoreanFull(d) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS_KR[d.getDay()]}요일`;
}

/** '7월 16일' / '7/16' */
export function formatMd(d) { return `${d.getMonth() + 1}월 ${d.getDate()}일`; }
export function formatMdShort(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }

/** 'YYYY-MM-DD' 문자열용 짧은 표기 */
export function ymdToMdShort(s) { const d = parseYmd(s); return formatMdShort(d); }
export function ymdToKorean(s) { const d = parseYmd(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`; }
export function weekdayOf(s) { return WEEKDAYS_KR[parseYmd(s).getDay()]; }

/** 두 'HH:MM' 사이 분 차이 (종료가 자정 넘으면 24h 보정) */
export function diffMinutes(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

/** 60 → '1시간', 90 → '1시간 30분', 45 → '45분' */
export function formatMinutes(min) {
  min = Number(min) || 0;
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

/** ISO 문자열 → '7월 16일 23:10' 형태 */
export function formatIsoShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}

/**
 * 월 달력 그리드용 날짜 배열 생성.
 * year, month(1~12) → 앞뒤 빈칸 포함 6주*7일 이내의 { date, inMonth } 목록
 */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = addDays(first, -first.getDay()); // 일요일 시작
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    cells.push({ date: d, inMonth: d.getMonth() === month - 1 });
    // 마지막 주가 다음 달로만 채워지면 중단 (5주 달력 지원)
    if (i >= 34 && d.getDay() === 6 && addDays(d, 1).getMonth() !== month - 1) break;
  }
  return cells;
}
