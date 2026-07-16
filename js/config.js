/**
 * config.js — 앱 전역 설정
 * GAS_URL: Apps Script 웹앱 배포 URL
 * API_TOKEN: gas/Config.gs 의 API_TOKEN 과 반드시 동일해야 한다.
 */
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbw_O4z91EFEeCvDRNjJ6D86gqr4oJ3x1pOAxbpHszDeYn0ZavMcqxmC2Oj1ZxEyTBQR/exec';

// [필수] Apps Script Config.gs 의 API_TOKEN 값과 똑같이 맞출 것
export const API_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';

export const DB_NAME = 'lifeManager';
export const DB_VERSION = 1;

// 서버 RESOURCE_MAP 과 1:1 대응하는 리소스 목록 (IndexedDB 스토어로도 사용)
export const RESOURCES = [
  'schedule', 'scheduleCategory',
  'memo', 'memoVersion', 'memoCategory',
  'attachment',
  'ledgerPersonal', 'personalCategory',
  'ledgerSchool', 'schoolProject', 'schoolCategory',
  'exercise', 'exerciseCategory', 'exerciseItem', 'exerciseSet',
  'routine', 'routineItem', 'routineSet',
  'cycle'
];

// 가계부 색상 이름 → 실제 색 (라이트/다크 각각)
export const COLOR_MAP = {
  '빨강': { light: '#d32f2f', dark: '#ef5350' },
  '주황': { light: '#e65100', dark: '#ff9800' },
  '노랑': { light: '#b28704', dark: '#ffd54f' },
  '초록': { light: '#2e7d32', dark: '#66bb6a' },
  '파랑': { light: '#1565c0', dark: '#64b5f6' },
  '보라': { light: '#6a1b9a', dark: '#ba68c8' },
  '갈색': { light: '#5d4037', dark: '#bcaaa4' },
  // 다크모드에서 검정이 안 보이지 않도록 밝은 회색으로 명도 보정 (요구사항 7-2)
  '검정': { light: '#212121', dark: '#e0e0e0' }
};
export const COLOR_NAMES = Object.keys(COLOR_MAP);
