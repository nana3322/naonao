/**
 * services/cycleService.js — 주기 자동 계산 (요구사항 9-2)
 *
 * 계산 기준:
 *  - 평균 주기 길이 = 시작일을 오름차순 정렬한 뒤, 연속된 시작일 간격의 단순 평균
 *    (최근 기록 가중치는 사용하지 않는 단순 평균 방식이다)
 *  - 기록이 1건뿐이면 설정의 기본 주기 길이(기본 28일)를 사용
 *  - 평균 기간 = 각 기록의 (종료일 - 시작일 + 1) 평균, 종료일 없는 기록은 제외
 *  - 다음 시작 예정일 = 가장 최근 시작일 + 평균 주기 길이
 *  - 다음 종료 예정일 = 다음 시작 예정일 + 평균 기간 - 1일
 *  - 예상 배란일 = 다음 시작 예정일 - 14일
 */
import { listActive } from '../db/indexedDb.js';
import { getSetting } from '../state.js';
import { parseYmd, addDays, ymd } from '../utils/date.js';

/** 주기 기록 전체 → 계산 결과 객체 (기록 없으면 null) */
export async function calcCycle() {
  const records = (await listActive('cycle'))
    .filter(r => r.startDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

  if (!records.length) return null;

  const defLength = Number(await getSetting('cycleDefaultLength')) || 28;
  const defPeriod = Number(await getSetting('cycleDefaultPeriod')) || 5;

  // 평균 주기 길이: 연속 시작일 간격 평균 (2건 이상일 때만)
  let avgLength = defLength;
  if (records.length >= 2) {
    let sum = 0;
    for (let i = 1; i < records.length; i++) {
      sum += (parseYmd(records[i].startDate) - parseYmd(records[i - 1].startDate)) / 86400000;
    }
    avgLength = Math.round(sum / (records.length - 1));
  }

  // 평균 기간: 종료일이 있는 기록만
  const withEnd = records.filter(r => r.endDate);
  let avgPeriod = defPeriod;
  if (withEnd.length) {
    const sum = withEnd.reduce((acc, r) =>
      acc + ((parseYmd(r.endDate) - parseYmd(r.startDate)) / 86400000 + 1), 0);
    avgPeriod = Math.round(sum / withEnd.length);
  }

  const lastStart = parseYmd(records[records.length - 1].startDate);
  const nextStart = addDays(lastStart, avgLength);
  const nextEnd = addDays(nextStart, avgPeriod - 1);
  const ovulation = addDays(nextStart, -14);

  return {
    records,
    avgLength, avgPeriod,
    nextStart: ymd(nextStart),
    nextEnd: ymd(nextEnd),
    ovulation: ymd(ovulation)
  };
}
