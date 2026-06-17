#!/usr/bin/env node
// 공유받은 Google 캘린더(.ics)를 Firebase Realtime DB로 동기화하는 스크립트.
// 비밀 ICS 주소는 코드에 없음 — Firebase의 gcalConfig 노드(관리자 설정 화면에서 등록)에서 직접 읽어온다.
// 사용법: node scripts/sync-gcal.js
const DB_BASE = 'https://aigen-pmo-default-rtdb.asia-southeast1.firebasedatabase.app';
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function fmtDate(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function shiftDateStr(str, days) {
  const dt = new Date(str + 'T00:00:00');
  dt.setDate(dt.getDate() + days);
  return fmtDate(dt);
}
function icsDateToStr(v) {
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}
function icsUnfold(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  lines.forEach(line => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  });
  return out;
}
function expandDateRange(startStr, endStr) {
  const out = [];
  let cur = startStr, guard = 0;
  while (cur <= endStr && guard < 400) { out.push(cur); cur = shiftDateStr(cur, 1); guard++; }
  return out;
}
function expandRRule(rule, startStr) {
  const params = {};
  rule.split(';').forEach(p => { const [k, v] = p.split('='); params[k] = v; });
  const freq = params.FREQ;
  const interval = parseInt(params.INTERVAL || '1', 10);
  const count = params.COUNT ? parseInt(params.COUNT, 10) : null;
  const until = params.UNTIL ? icsDateToStr(params.UNTIL.slice(0, 8)) : null;
  const byday = params.BYDAY ? params.BYDAY.split(',') : null;
  const windowStart = shiftDateStr(fmtDate(new Date()), -60);
  const windowEnd = shiftDateStr(fmtDate(new Date()), 180);
  const out = [];
  if (freq === 'WEEKLY') {
    let cur = new Date(startStr + 'T00:00:00');
    const days = byday || [DOW[cur.getDay()]];
    let n = 0, guard = 0;
    while (guard < 1000) {
      guard++;
      const weekStartStr = fmtDate(cur);
      days.forEach(d => {
        const idx = DOW.indexOf(d);
        const dt = new Date(cur);
        dt.setDate(dt.getDate() + (idx - dt.getDay()));
        const dStr = fmtDate(dt);
        if (dStr >= startStr && (!until || dStr <= until) && dStr <= windowEnd && dStr >= windowStart) out.push(dStr);
      });
      n++;
      if (count && n >= count) break;
      if (until && weekStartStr > until) break;
      if (weekStartStr > windowEnd) break;
      cur.setDate(cur.getDate() + 7 * interval);
    }
  } else if (freq === 'DAILY') {
    let cur = new Date(startStr + 'T00:00:00');
    let n = 0, guard = 0;
    while (guard < 1000) {
      guard++;
      const dStr = fmtDate(cur);
      if (dStr > windowEnd || (until && dStr > until)) break;
      if (dStr >= windowStart) out.push(dStr);
      n++;
      if (count && n >= count) break;
      cur.setDate(cur.getDate() + interval);
    }
  } else {
    out.push(startStr);
  }
  return out;
}
function parseICS(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  blocks.forEach(block => {
    const endIdx = block.indexOf('END:VEVENT');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const lines = icsUnfold(body);
    let summary = '', dtstartRaw = '', dtendRaw = '', allDay = false, rrule = '';
    lines.forEach(line => {
      if (line.startsWith('SUMMARY:')) summary = line.slice(8).replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
      else if (line.startsWith('DTSTART')) { allDay = line.includes('VALUE=DATE') && !line.includes('VALUE=DATE-TIME'); dtstartRaw = line.split(':').pop(); }
      else if (line.startsWith('DTEND')) dtendRaw = line.split(':').pop();
      else if (line.startsWith('RRULE:')) rrule = line.slice(6);
    });
    if (!dtstartRaw || !summary) return;
    const sStr = icsDateToStr(dtstartRaw.slice(0, 8));
    let eStr = dtendRaw ? icsDateToStr(dtendRaw.slice(0, 8)) : sStr;
    if (allDay && eStr > sStr) eStr = shiftDateStr(eStr, -1);
    if (rrule) {
      const durDays = Math.max(0, (new Date(eStr) - new Date(sStr)) / 86400000);
      expandRRule(rrule, sStr).forEach(occStart => {
        const occEnd = shiftDateStr(occStart, durDays);
        expandDateRange(occStart, occEnd).forEach(d => events.push({ date: d, title: summary }));
      });
    } else {
      expandDateRange(sStr, eStr).forEach(d => events.push({ date: d, title: summary }));
    }
  });
  return events;
}

async function main() {
  const configRes = await fetch(`${DB_BASE}/gcalConfig.json`);
  const config = await configRes.json();
  const icsUrl = config && config.icsUrl;
  if (!icsUrl) {
    console.error('gcalConfig.icsUrl이 비어 있습니다. 관리자 설정 화면에서 캘린더 주소를 먼저 등록하세요.');
    process.exit(1);
  }

  const icsRes = await fetch(icsUrl);
  if (!icsRes.ok) {
    console.error(`ICS 다운로드 실패: HTTP ${icsRes.status}`);
    process.exit(1);
  }
  const icsText = await icsRes.text();
  const events = parseICS(icsText);

  const putRes = await fetch(`${DB_BASE}/gcalEvents.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(events),
  });
  if (!putRes.ok) {
    console.error(`Firebase 저장 실패: HTTP ${putRes.status}`);
    process.exit(1);
  }
  console.log(`동기화 완료: ${events.length}개 일정을 Firebase에 저장했습니다.`);
}

main().catch(e => { console.error('동기화 실패:', e.message); process.exit(1); });
