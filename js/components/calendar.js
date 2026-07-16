/**
 * components/calendar.js — 달력 렌더러 2종
 *  1) renderMonthCalendar: 월간 그리드. 셀 내용은 cellContent 콜백으로 주입
 *     (홈: 가계부 금액+일정 키워드+주기 예정 / 주기 탭: 기간·예측 표시에 재사용)
 *  2) renderWeeklyStrip: 오늘부터 7일 세로 카드 스트립 (좌우 이동 지원)
 */
import { WEEKDAYS_KR, ymd, addDays, monthGrid, today } from '../utils/date.js';

/**
 * 월간 달력.
 * @param opts {
 *   year, month,                       // 표시할 연/월
 *   cellContent(dateStr) → Node|null,  // 각 날짜 칸 안에 넣을 내용
 *   cellClass(dateStr) → string,       // 날짜 칸 추가 클래스
 *   onSelectDate(dateStr),             // 날짜 탭
 *   onMonthChange(year, month)         // 이전/다음 달 이동
 * }
 */
export function renderMonthCalendar(container, opts) {
  container.innerHTML = '';
  const { year, month } = opts;

  // 상단: ◀ 2026년 7월 ▶
  const head = document.createElement('div');
  head.className = 'cal-head';
  const prev = navBtn('◀', '이전 달');
  const title = document.createElement('div');
  title.className = 'cal-title';
  title.textContent = `${year}년 ${month}월`;
  const next = navBtn('▶', '다음 달');
  head.append(prev, title, next);

  prev.addEventListener('click', () => {
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    opts.onMonthChange && opts.onMonthChange(y, m);
  });
  next.addEventListener('click', () => {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    opts.onMonthChange && opts.onMonthChange(y, m);
  });

  // 요일 헤더
  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  WEEKDAYS_KR.forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    c.textContent = w;
    grid.appendChild(c);
  });

  // 날짜 칸
  const todayStr = ymd(today());
  monthGrid(year, month).forEach(({ date, inMonth }) => {
    const dateStr = ymd(date);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell'
      + (inMonth ? '' : ' out')
      + (dateStr === todayStr ? ' today' : '')
      + (opts.cellClass ? ' ' + (opts.cellClass(dateStr) || '') : '');
    cell.setAttribute('aria-label', `${date.getMonth() + 1}월 ${date.getDate()}일`);

    const num = document.createElement('div');
    num.className = 'cal-num' + (date.getDay() === 0 ? ' sun' : date.getDay() === 6 ? ' sat' : '');
    num.textContent = date.getDate();
    cell.appendChild(num);

    if (opts.cellContent) {
      const content = opts.cellContent(dateStr);
      if (content) cell.appendChild(content);
    }
    cell.addEventListener('click', () => opts.onSelectDate && opts.onSelectDate(dateStr));
    grid.appendChild(cell);
  });

  container.append(head, grid);
}

/**
 * 위클리 스트립: startDate 부터 7일 (요구사항 4-6).
 * @param opts {
 *   startDate: Date,
 *   dayContent(dateStr) → Node|null,  // 일정 목록 (최대 3개 규칙은 호출측에서)
 *   onSelectDate(dateStr),
 *   onShift(days)                     // -7 / +7 이동
 * }
 */
export function renderWeeklyStrip(container, opts) {
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'weekly-head';
  const prev = navBtn('◀', '이전 7일');
  const label = document.createElement('div');
  label.className = 'weekly-label';
  const end = addDays(opts.startDate, 6);
  label.textContent = `${opts.startDate.getMonth() + 1}/${opts.startDate.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
  const next = navBtn('▶', '다음 7일');
  head.append(prev, label, next);
  prev.addEventListener('click', () => opts.onShift && opts.onShift(-7));
  next.addEventListener('click', () => opts.onShift && opts.onShift(7));

  const strip = document.createElement('div');
  strip.className = 'weekly-strip';
  const todayStr = ymd(today());
  for (let i = 0; i < 7; i++) {
    const d = addDays(opts.startDate, i);
    const dateStr = ymd(d);
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'weekly-col' + (dateStr === todayStr ? ' today' : '');
    col.setAttribute('aria-label', `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS_KR[d.getDay()]}요일 일정 보기`);

    const dow = document.createElement('div');
    dow.className = 'weekly-dow' + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '');
    dow.textContent = WEEKDAYS_KR[d.getDay()];
    const num = document.createElement('div');
    num.className = 'weekly-num';
    num.textContent = d.getDate();
    col.append(dow, num);

    if (opts.dayContent) {
      const c = opts.dayContent(dateStr);
      if (c) col.appendChild(c);
    }
    col.addEventListener('click', () => opts.onSelectDate && opts.onSelectDate(dateStr));
    strip.appendChild(col);
  }
  container.append(head, strip);
}

function navBtn(text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.setAttribute('aria-label', label);
  b.textContent = text;
  return b;
}
