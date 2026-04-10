/* ============================================
   전역 변수 및 상태
   - currentAssets: 현재 로드된 자산 배열
   - editingId / detailId: 수정/상세 대상 자산 ID
   - searchTimer: 검색 디바운스 타이머
   - replaceYears: 교체 기준 연수
   - sortKey / sortDir: 정렬 기준 컬럼 및 방향
   - currentRole: 현재 로그인 사용자 역할
   ============================================ */
let currentAssets = [];
let editingId = null;
let detailId = null;
let searchTimer = null;
let replaceMonths = 60;  // 교체 기준 (개월)
let replaceYears = 5;   // 교체 기준 (정수 년, 표시용)
let sortKey = null;
let sortDir = 1; // 1=오름차순, -1=내림차순
let currentRole = null; // 'admin' | 'user' | null

// 네비게이션 바에 오늘 날짜 표시
document.getElementById('nav-date').textContent =
  new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'short'});


/* ============================================
   인증 (로그인/로그아웃/세션)
   - checkAuth: 세션 확인 후 로그인 화면 또는 앱 표시
   - doLogin / doLogout: 로그인·로그아웃 처리
   - authFetch: 401 응답 시 자동 로그인 화면 전환
   ============================================ */

// 페이지 로드 시 세션 유효성 확인
async function checkAuth() {
  try {
    const data = await fetch('/api/auth/me').then(r => r.json());
    if (data.loggedIn) {
      currentRole = data.role;
      showApp(data.name, data.role);
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

// 로그인 화면 표시
function showLoginScreen() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-username').focus();
}

// 로그인 성공 후 앱 메인 화면 전환
function showApp(name, role) {
  document.getElementById('login-overlay').classList.add('hidden');
  const navUser = document.getElementById('nav-user');
  const logoutBtn = document.getElementById('logout-btn');
  navUser.textContent = `${name} (${role === 'admin' ? '관리자' : '일반'})`;
  navUser.style.display = '';
  logoutBtn.style.display = '';
  applyRoleUI();
  initMultiSelectFilters();
  loadDeptFilter();
  loadMakerFilter();
  loadDashboard();
}

// 역할(admin/user)에 따라 관리자 전용 UI 표시/숨김
function applyRoleUI() {
  const isAdmin = currentRole === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

// 로그인 요청 처리
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = '사번과 비밀번호를 입력하세요.'; return; }

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.success) {
    currentRole = data.role;
    document.getElementById('login-password').value = '';
    showApp(data.name, data.role);
  } else {
    errEl.textContent = data.message || '로그인에 실패했습니다.';
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
  }
}

// 비밀번호 변경 모달 열기
function openChangePwModal() {
  document.getElementById('cpw-current').value = '';
  document.getElementById('cpw-new').value = '';
  document.getElementById('cpw-confirm').value = '';
  document.getElementById('cpw-error').textContent = '';
  openModal('change-pw-modal');
  setTimeout(() => document.getElementById('cpw-current').focus(), 100);
}

// 비밀번호 변경 처리
async function doChangePassword() {
  const current  = document.getElementById('cpw-current').value;
  const newPw    = document.getElementById('cpw-new').value;
  const confirm  = document.getElementById('cpw-confirm').value;
  const errEl    = document.getElementById('cpw-error');
  errEl.textContent = '';

  if (!current || !newPw || !confirm) { errEl.textContent = '모든 항목을 입력하세요.'; return; }
  if (newPw.length < 6) { errEl.textContent = '새 비밀번호는 6자 이상이어야 합니다.'; return; }
  if (newPw !== confirm) { errEl.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }

  const res = await fetch('/api/auth/change_password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: current, new_password: newPw }),
  });
  const data = await res.json();
  if (data.success) {
    closeModal('change-pw-modal');
    alert('비밀번호가 변경되었습니다.');
  } else {
    errEl.textContent = data.message || '변경에 실패했습니다.';
  }
}

// 로그아웃 처리 및 상태 초기화
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentRole = null;
  currentAssets = [];
  document.getElementById('nav-user').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  showLoginScreen();
}

// 인증 포함 fetch — 401 시 자동으로 로그인 화면 전환
async function authFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    currentRole = null;
    showLoginScreen();
    throw new Error('unauthorized');
  }
  return res;
}


/* ============================================
   페이지 전환
   - showPage: 대시보드/자산목록/등록 탭 전환
   - setOldFilter: 연수 필터 설정 후 목록 로드
   ============================================ */

// 탭 클릭 시 해당 페이지 표시 및 데이터 로드
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const idx = ['dashboard','assets','register'].indexOf(name);
  if (idx >= 0) document.querySelectorAll('.nav-tab')[idx].classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'assets') { buildHeader(); loadAssets(); }
  if (name === 'register') renderRegisterPage();
}

function setOldFilter(val) {
  document.getElementById('filter-old').value = val || 'old';
  showPage('assets');
}


/* ============================================
   대시보드 (로드, 차트 렌더링)
   - loadDashboard: API에서 통계 데이터 로드 및 KPI 카드 업데이트
   - goAssetList: 대시보드에서 자산 목록으로 필터링 이동
   - renderClickableDonut: 도넛 차트 SVG 및 범례 렌더링
   - renderAgeDonut: 사용 연한 도넛 차트 렌더링
   - monoGradient / rgb2hsl: HSL 기반 그라데이션 색상 생성
   - openSettingsModal / closeSettingsModal / saveYears: 교체 기준 설정
   ============================================ */

// 대시보드 데이터 로드 및 KPI 카드·차트 렌더링
async function loadDashboard() {
  let data;
  try { data = await authFetch('/api/dashboard').then(r => r.json()); }
  catch { return; }
  replaceMonths = data.replace_months;
  replaceYears = Math.floor(replaceMonths / 12);
  const extraMonths = replaceMonths % 12;
  const replaceLabel = extraMonths === 0 ? `${replaceYears}년` : (replaceYears > 0 ? `${replaceYears}년 ${extraMonths}개월` : `${extraMonths}개월`);

  document.getElementById('years-input').value = replaceYears;
  document.getElementById('months-input').value = extraMonths;
  document.getElementById('years-display').textContent = replaceLabel;
  const badge = document.getElementById('years-badge');
  if (badge) badge.textContent = replaceLabel;

  // 연수 필터 옵션을 교체 기준에 따라 동적 생성
  const oldSel = document.getElementById('filter-old');
  const curVal = oldSel.value;
  let ageOpts = '<option value="">전체 (연수 무관)</option>' +
    '<option value="lt1">1년 미만</option>' +
    Array.from({length: Math.max(replaceYears - 1, 0)}, (_, i) =>
      `<option value="${i+1}to${i+2}">${i+1}년 이상 ~ ${i+2}년 미만</option>`
    ).join('');
  if (extraMonths > 0) {
    ageOpts += `<option value="${replaceYears}y${extraMonths}m">${replaceYears}년 이상 ~ ${replaceLabel} 미만</option>`;
  }
  ageOpts += `<option value="old">교체 검토 대상 (${replaceLabel}+)</option>`;
  oldSel.innerHTML = ageOpts;
  oldSel.value = curVal;

  const unit = n => `${n.toLocaleString()}<span class="card-unit">대</span>`;
  document.getElementById('d-total').innerHTML = unit(data.total);
  // old_count는 by_age의 "N년 이상" 구간과 동일 데이터 소스
  document.getElementById('d-old').innerHTML   = unit(data.old_count);
  document.getElementById('d-old-sub').textContent = `교체 검토 (${replaceLabel}+)`;

  const using = (data.by_status.find(s => s['상태'] === '사용중') || {})['수량'] || 0;
  const loan  = (data.by_status.find(s => s['상태'] === '대여중') || {})['수량'] || 0;
  document.getElementById('d-using').innerHTML = unit(using);
  document.getElementById('d-loan').innerHTML  = unit(loan);

  renderClickableDonut('d-by-site', data.by_site, '사업장', data.total, BASE_SITE, '사업장');
  renderClickableDonut('d-by-status', data.by_status, '상태', data.total, BASE_STATUS, '상태');
  renderClickableDonut('d-by-maker', data.by_maker, '제조사', data.total, BASE_MAKER, '제조사', data.by_type);
  renderAgeDonut('d-by-age', data.by_age, data.total);
}

// 대시보드 차트/카드 클릭 시 자산 목록 페이지로 필터링 이동
function goAssetList(filterType, filterValue) {
  // 필터 초기화 후 지정된 필터만 설정
  document.getElementById('search-input').value = '';
  Object.keys(msFilterState).forEach(k => { msFilterState[k] = new Set(); });
  document.getElementById('filter-old').value = '';
  if (filterType === '연수') {
    document.getElementById('filter-old').value = filterValue;
  } else if (msFilterState[filterType]) {
    msFilterState[filterType].add(filterValue);
  }
  showPage('assets');
}

// RGB → HSL 변환 유틸리티
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s, l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// HSL 기준색에서 밝기를 단계적으로 올려 고대비 그라데이션 색상 배열 생성
function monoGradient(baseHSL, count) {
  const [h, s, lBase] = baseHSL;
  return Array.from({length: count}, (_, i) => {
    const l = Math.min(lBase + i * 18, 92);
    const sat = Math.max(s - i * 8, 20);
    return `hsl(${h}, ${sat}%, ${l}%)`;
  });
}

// 영역별 HSL 기준색 (가장 진한 색)
const BASE_SITE   = [215, 100, 42];  // Deep Blue  #0055D4 계열
const BASE_STATUS = [145, 72, 38];   // Emerald    #1BA854 계열
const BASE_MAKER  = [241, 60, 45];   // Indigo     #5240B8 계열
const BASE_TYPE   = [241, 60, 45];   // Indigo (same family)
const BASE_AGE    = [240, 4, 40];    // Cool Gray  #626268 계열
const AGE_WARN    = '#E8685A';        // Soft Coral for 경고 (톤앤매너 유지)

// 클릭 가능한 도넛 차트 + 범례를 SVG로 렌더링 (사업장, 상태, 제조사 등)
function renderClickableDonut(elId, rows, key, total, baseRGB, filterType, extraRows) {
  const el = document.getElementById(elId);
  if (!rows || !rows.length) { el.innerHTML = '<div style="color:#8E8E93;font-size:13px">데이터 없음</div>'; return; }
  const sum = rows.reduce((s, r) => s + r['수량'], 0);
  if (!sum) { el.innerHTML = '<div style="color:#8E8E93;font-size:13px">데이터 없음</div>'; return; }

  const colors = monoGradient(baseRGB, rows.length);
  const FN = "Pretendard Variable,SF Pro Display,sans-serif";
  const R = 52, cx = 70, cy = 70, SW = 18, circ = 2 * Math.PI * R;
  const gap = 4;
  const bgCircle = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#F2F2F7" stroke-width="${SW}"/>`;
  const subBgCircle = bgCircle;
  // 가운데 텍스트: 1위 항목의 수량 + 이름
  const centerTextTopItem = (topRows, labelKey) => {
    if (!topRows || !topRows.length) return '';
    const top = topRows[0];
    const num = top['수량'];
    const label = top[labelKey] || '기타';
    const labelFs = label.length > 4 ? 10 : 12;
    return `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="28" font-weight="700" fill="#1D1D1F" font-family="${FN}">${num.toLocaleString()}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="${labelFs}" font-weight="400" fill="#6E6E73" font-family="${FN}">${label}</text>`;
  };

  let cum = 0;
  const segs = rows.map((r, i) => {
    const pct = r['수량'] / sum;
    const rawLen = pct * circ;
    const len = Math.max(rawLen - gap, 0.5);
    const offset = gap / 2;
    const angle = -90 + cum * 360;
    cum += pct;
    return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${colors[i]}" stroke-width="${SW}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="-${offset.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(${angle.toFixed(1)} ${cx} ${cy})" style="cursor:pointer;transition:opacity 0.2s"
      onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'"
      onclick="goAssetList('${filterType}','${(r[key]||'').replace(/'/g,"\\'")}')" />`;
  }).join('');

  // 범례: 순위 낮을수록 텍스트 연하게 (시각적 위계)
  const textDim = [1.0, 0.85, 0.65, 0.5, 0.4, 0.35, 0.3, 0.3];
  const legend = rows.map((r, i) => {
    const pct = Math.round(r['수량'] / sum * 100);
    const label = r[key] || '미지정';
    const dim = textDim[Math.min(i, textDim.length - 1)];
    const labelColor = `rgba(28,28,30,${Math.min(dim + 0.15, 1)})`;
    const valueColor = `rgba(28,28,30,${dim})`;
    return `<div class="donut-legend-item" onclick="goAssetList('${filterType}','${label.replace(/'/g,"\\'")}')">
      <div style="width:8px;height:8px;border-radius:50%;background:${colors[i]};flex-shrink:0"></div>
      <span class="donut-legend-label" style="color:${labelColor}">${label}</span>
      <span class="donut-legend-value" style="color:${valueColor}">${r['수량'].toLocaleString()}</span>
      <span class="donut-legend-pct">${pct}%</span>
    </div>`;
  }).join('');

  // 기기종류 서브 차트 (제조사·기기 패널용)
  let subChart = '';
  if (extraRows && extraRows.length) {
    const subSum = extraRows.reduce((s, r) => s + r['수량'], 0);
    // 기기종류별 명시적 고대비 색상
    const DEVICE_COLORS = { '노트북': '#2563EB', 'Mac': '#6B7280', '데스크탑': '#0891B2', '데스크톱': '#0891B2' };
    const DEVICE_FB = ['#2563EB', '#6B7280', '#0891B2', '#A78BFA'];
    const subColors = extraRows.map((r, i) => DEVICE_COLORS[r['기기종류']] || DEVICE_FB[i % DEVICE_FB.length]);
    let subCum = 0;
    const subSegs = extraRows.map((r, i) => {
      const pct = r['수량'] / subSum;
      const rawLen = pct * circ;
      const len = Math.max(rawLen - gap, 0.5);
      const offset = gap / 2;
      const angle = -90 + subCum * 360;
      subCum += pct;
      return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${subColors[i]}" stroke-width="${SW}"
        stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
        stroke-dashoffset="-${offset.toFixed(2)}"
        stroke-linecap="round"
        transform="rotate(${angle.toFixed(1)} ${cx} ${cy})" style="cursor:pointer;transition:opacity 0.2s"
        onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'"
        onclick="goAssetList('기기종류','${(r['기기종류']||'').replace(/'/g,"\\'")}')" />`;
    }).join('');
    const subLegend = extraRows.map((r, i) => {
      const pct = Math.round(r['수량'] / subSum * 100);
      const label = r['기기종류'] || '기타';
      const dim = textDim[Math.min(i, textDim.length - 1)];
      const labelColor = `rgba(28,28,30,${Math.min(dim + 0.15, 1)})`;
      const valueColor = `rgba(28,28,30,${dim})`;
      return `<div class="donut-legend-item" onclick="goAssetList('기기종류','${label.replace(/'/g,"\\'")}')">
        <div style="width:8px;height:8px;border-radius:50%;background:${subColors[i]};flex-shrink:0"></div>
        <span class="donut-legend-label" style="color:${labelColor}">${label}</span>
        <span class="donut-legend-value" style="color:${valueColor}">${r['수량'].toLocaleString()}</span>
        <span class="donut-legend-pct">${pct}%</span>
      </div>`;
    }).join('');
    // 좌우 배치: 제조사(좌) + 기기종류(우)
    el.innerHTML = `<div class="maker-dual">
      <div class="maker-half">
        <div class="maker-half-title">제조사별</div>
        <div class="donut-chart-row">
          <div class="donut-svg-wrap"><svg viewBox="0 0 140 140" class="donut-svg">${bgCircle}${segs}${centerTextTopItem(rows, key)}</svg></div>
          <div class="donut-legend">${legend}</div>
        </div>
      </div>
      <div class="maker-half">
        <div class="maker-half-title">기기종류별</div>
        <div class="donut-chart-row">
          <div class="donut-svg-wrap"><svg viewBox="0 0 140 140" class="donut-svg">${subBgCircle}${subSegs}${centerTextTopItem(extraRows, '기기종류')}</svg></div>
          <div class="donut-legend">${subLegend}</div>
        </div>
      </div>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="donut-chart-row">
    <div class="donut-svg-wrap"><svg viewBox="0 0 140 140" class="donut-svg">${bgCircle}${segs}${centerTextTopItem(rows, key)}</svg></div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}


const DEVICE_ICONS = { '노트북': '💻', 'Mac': '🍎', '데스크톱': '🖥️', '데스크탑': '🖥️', '기타': '📦' };

// 사용 연한 도넛 차트 — 경고(N년 이상) 구간만 코랄 색상 적용
function renderAgeDonut(elId, rows, total) {
  const el = document.getElementById(elId);
  if (!rows || !rows.length) { el.innerHTML = '<div style="color:#8E8E93;font-size:13px">데이터 없음</div>'; return; }

  const warnLabel = `${replaceYears}년 이상`;
  const FN = "Pretendard Variable,SF Pro Display,sans-serif";

  // Cool Gray HSL 그라데이션 + 경고만 Coral Red
  const ageColors = monoGradient(BASE_AGE, 6);
  function ageColor(label, idx) {
    if (label === warnLabel) return AGE_WARN;
    if (label === '도입일 없음') return `hsl(${BASE_AGE[0]}, ${Math.max(BASE_AGE[1] - 2, 0)}%, 88%)`;
    return ageColors[Math.min(idx, ageColors.length - 1)];
  }

  const R = 52, cx = 70, cy = 70, SW = 18, circ = 2 * Math.PI * R;
  const gap = 4;
  const sum = rows.reduce((s, r) => s + r['수량'], 0);
  const textDim = [1.0, 0.85, 0.65, 0.5, 0.4, 0.35];

  // 가장 많은 구간 찾기
  const topAge = rows.reduce((max, r) => r['수량'] > max['수량'] ? r : max, rows[0]);

  let grayIdx = 0;
  let cum = 0;
  const segs = rows.map((r, i) => {
    const pct = r['수량'] / sum;
    const rawLen = pct * circ;
    const len = Math.max(rawLen - gap, 0.5);
    const offset = gap / 2;
    const angle = -90 + cum * 360;
    const isWarn = r['구간'] === warnLabel;
    const isNone = r['구간'] === '도입일 없음';
    const color = ageColor(r['구간'], isWarn || isNone ? 0 : grayIdx);
    if (!isWarn && !isNone) grayIdx++;
    cum += pct;
    return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="-${offset.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(${angle.toFixed(1)} ${cx} ${cy})"
      style="cursor:pointer;transition:opacity 0.2s"
      onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'"/>`;
  }).join('');

  const ageRangeMap = { '1년 미만': 'lt1' };
  const _extraM = replaceMonths % 12;
  for (let i = 1; i < replaceYears; i++) {
    ageRangeMap[`${i}년 이상 ~ ${i+1}년 미만`] = `${i}to${i+1}`;
  }
  if (_extraM > 0) {
    const _midLabel = replaceYears > 0
      ? `${replaceYears}년 이상 ~ ${replaceYears}년 ${_extraM}개월 미만`
      : `${_extraM}개월 미만`;
    ageRangeMap[_midLabel] = `${replaceYears}y${_extraM}m`;
  }
  ageRangeMap[warnLabel] = 'old';

  let grayIdx2 = 0;
  const legend = rows.map((r, i) => {
    const pct = sum > 0 ? Math.round(r['수량'] / sum * 100) : 0;
    const isWarn = r['구간'] === warnLabel;
    const isNone = r['구간'] === '도입일 없음';
    const color = ageColor(r['구간'], isWarn || isNone ? 0 : grayIdx2);
    if (!isWarn && !isNone) grayIdx2++;
    const ageKey = ageRangeMap[r['구간']] || '';
    const dim = textDim[Math.min(i, textDim.length - 1)];
    const labelColor = isWarn ? AGE_WARN : `rgba(28,28,30,${Math.min(dim + 0.15, 1)})`;
    const valueColor = isWarn ? AGE_WARN : `rgba(28,28,30,${dim})`;
    return `<div class="donut-legend-item" ${ageKey ? `onclick="goAssetList('연수','${ageKey}')"` : ''} style="${ageKey ? 'cursor:pointer' : ''}">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <span class="donut-legend-label" style="color:${labelColor};${isWarn ? 'font-weight:600' : ''}">${r['구간']}</span>
      <span class="donut-legend-value" style="color:${valueColor}">${r['수량']}</span>
      <span class="donut-legend-pct">${pct}%</span>
    </div>`;
  }).join('');

  // 중앙 텍스트: 교체 검토 대상(warnLabel) 수량 고정 표시
  const warnRow = rows.find(r => r['구간'] === warnLabel);
  const warnCount = warnRow ? warnRow['수량'] : 0;
  el.innerHTML = `<div class="donut-chart-row">
    <div class="donut-svg-wrap"><svg viewBox="0 0 140 140" class="donut-svg">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#F2F2F7" stroke-width="${SW}"/>
      ${segs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="28" font-weight="700" fill="${AGE_WARN}" font-family="${FN}">${warnCount.toLocaleString()}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" font-weight="400" fill="#6E6E73" font-family="${FN}">교체 검토 대상</text>
    </svg></div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

// 교체 기준 설정 모달 열기/닫기
function openSettingsModal() {
  document.getElementById('settings-modal').classList.add('open');
}
function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('open');
}

// 교체 기준 저장 후 대시보드 새로고침
async function saveReplaceMonths() {
  const y = parseInt(document.getElementById('years-input').value) || 0;
  const m = parseInt(document.getElementById('months-input').value) || 0;
  const totalMonths = y * 12 + m;
  if (totalMonths < 1 || totalMonths > 240) { alert('1개월 ~ 20년 사이로 입력하세요.'); return; }
  await fetch('/api/settings', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({replace_months: String(totalMonths)})
  });
  replaceMonths = totalMonths;
  replaceYears = Math.floor(totalMonths / 12);
  const extra = totalMonths % 12;
  const label = extra === 0 ? `${replaceYears}년` : (replaceYears > 0 ? `${replaceYears}년 ${extra}개월` : `${extra}개월`);
  loadDashboard();
  closeSettingsModal();
  showToast(`교체 기준이 ${label}(으)로 변경되었습니다.`);
}


/* ============================================
   자산 목록 (로드, 렌더링, 정렬, 검색)
   - debounceSearch: 검색 입력 디바운스
   - loadAssets: 필터 조건으로 자산 목록 API 호출
   - renderTable / renderRow: 테이블 렌더링
   - sortTable: 컬럼 클릭 정렬
   - resetFilters: 전체 필터 초기화
   - renderFilterTags: 활성 필터 태그 UI 렌더링
   - loadDeptFilter / loadMakerFilter: 부서/제조사 드롭다운 동적 로드
   ============================================ */

// 검색 입력 시 300ms 디바운스 후 자산 로드
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadAssets, 300);
}

// 도입일 문자열에서 사용 연수(년) 계산
function calcYears(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const diff = (new Date() - d) / (1000 * 60 * 60 * 24 * 365.25);
  return diff;
}

// 연수를 "N년 M개월" 형태로 포맷
function formatYears(yrs) {
  if (yrs === null) return '-';
  const totalMonths = Math.floor(yrs * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년`;
  return `${y}년 ${m}개월`;
}

/* ===== 멀티 셀렉트 필터 상태 ===== */
const MS_FILTER_KEYS = ['사업장', '상태', '제조사', '기기종류', '부서명'];
const MS_FILTER_LABELS = { '사업장': '사업장', '상태': '상태', '제조사': '제조사', '기기종류': '기기종류', '부서명': '부서' };
const msFilterState = { '사업장': new Set(), '상태': new Set(), '제조사': new Set(), '기기종류': new Set(), '부서명': new Set() };
const msFilterOptions = {
  '사업장': ['GS에너지', 'GS파워', '인천종합에너지'],
  '상태': ['사용중', '대여중', '재고', '반납', '폐기'],
  '기기종류': ['노트북', '데스크톱', 'Mac'],
  '제조사': [],
  '부서명': [],
};

// 멀티 셀렉트 필터 컴포넌트 초기화 (페이지 로드 시 1회)
function initMultiSelectFilters() {
  document.querySelectorAll('.ms-filter').forEach(el => {
    const key = el.dataset.key;
    el.innerHTML = `<button type="button" class="ms-btn" id="ms-btn-${key}">${MS_FILTER_LABELS[key]}</button>
      <div class="ms-panel" id="ms-panel-${key}"></div>`;
    el.querySelector('.ms-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMsPanel(key);
    });
    updateMsButton(key);
  });
  // 외부 클릭 시 패널 닫기
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ms-filter')) {
      document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
    }
  });
}

function toggleMsPanel(key) {
  const panel = document.getElementById(`ms-panel-${key}`);
  const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
  if (isOpen) return;
  renderMsPanel(key);
  panel.classList.add('open');
}

function renderMsPanel(key) {
  const panel = document.getElementById(`ms-panel-${key}`);
  const opts = msFilterOptions[key] || [];
  const selected = msFilterState[key];
  const optsHtml = opts.length
    ? opts.map(o => `<label class="ms-opt">
        <input type="checkbox" value="${o.replace(/"/g, '&quot;')}" ${selected.has(o) ? 'checked' : ''}>
        <span>${o}</span>
      </label>`).join('')
    : '<div class="ms-opt empty">옵션 없음</div>';
  panel.innerHTML = optsHtml + `<div class="ms-panel-actions">
    <button type="button" data-act="clear">선택 해제</button>
    <button type="button" data-act="close">닫기</button>
  </div>`;
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.value);
      else selected.delete(cb.value);
      updateMsButton(key);
      loadAssets();
    });
  });
  panel.querySelector('[data-act="clear"]').addEventListener('click', () => {
    msFilterState[key] = new Set();
    renderMsPanel(key);
    updateMsButton(key);
    loadAssets();
  });
  panel.querySelector('[data-act="close"]').addEventListener('click', () => {
    panel.classList.remove('open');
  });
}

function updateMsButton(key) {
  const btn = document.getElementById(`ms-btn-${key}`);
  if (!btn) return;
  const count = msFilterState[key].size;
  const label = MS_FILTER_LABELS[key];
  btn.textContent = count > 0 ? `${label} (${count})` : label;
  btn.classList.toggle('has-selection', count > 0);
}

// 필터 조건 조합 후 API 호출, 결과를 currentAssets에 저장
async function loadAssets() {
  const params = new URLSearchParams();
  const s   = document.getElementById('search-input').value;
  const old = document.getElementById('filter-old').value;

  if (s) params.set('search', s);
  MS_FILTER_KEYS.forEach(key => {
    msFilterState[key].forEach(v => params.append(key, v));
  });
  if (old === 'old') params.set('old_years', replaceMonths);
  else if (old) params.set('age_range', old);

  document.getElementById('asset-tbody').innerHTML =
    `<tr><td colspan="${getColOrder().length}" class="loading">로딩 중...</td></tr>`;

  try {
    currentAssets = await authFetch('/api/assets?' + params).then(r => r.json());
  } catch { return; }
  renderTable();
  renderFilterTags();
}

// 모든 필터 및 검색어 초기화 후 자산 재로드
function resetFilters() {
  document.getElementById('search-input').value = '';
  MS_FILTER_KEYS.forEach(key => {
    msFilterState[key] = new Set();
    updateMsButton(key);
  });
  document.getElementById('filter-old').value = '';
  loadAssets();
}

// 활성 필터를 태그 형태로 렌더링 (클릭 시 해당 필터 해제)
function renderFilterTags() {
  const container = document.getElementById('filter-tags');
  container.innerHTML = '';

  const addTag = (text, onRemove) => {
    const tag = document.createElement('span');
    tag.className = 'filter-tag';
    tag.innerHTML = `${text} <button class="filter-tag-x" title="필터 해제">×</button>`;
    tag.querySelector('.filter-tag-x').addEventListener('click', onRemove);
    container.appendChild(tag);
  };

  // 검색어 태그
  const searchEl = document.getElementById('search-input');
  if (searchEl.value.trim()) {
    addTag(`"${searchEl.value.trim()}"`, () => { searchEl.value = ''; loadAssets(); });
  }

  // 멀티 셀렉트 태그
  MS_FILTER_KEYS.forEach(key => {
    const label = MS_FILTER_LABELS[key];
    msFilterState[key].forEach(v => {
      addTag(`${label}: ${v}`, () => {
        msFilterState[key].delete(v);
        updateMsButton(key);
        loadAssets();
      });
    });
  });

  // 연수 필터 태그
  const oldEl = document.getElementById('filter-old');
  const ov = oldEl.value.trim();
  if (ov) {
    let txt = ov;
    if (ov === 'lt1') txt = '1년 미만';
    else if (ov === 'old') txt = '교체 검토 대상';
    else if (ov.includes('y') && ov.includes('m')) {
      const m = ov.match(/(\d+)y(\d+)m/);
      if (m) txt = `${m[1]}년 이상 ~ ${m[1]}년 ${m[2]}개월 미만`;
    } else if (ov.includes('to')) {
      const p = ov.split('to');
      txt = `${p[0]}년 이상 ~ ${p[1]}년 미만`;
    }
    addTag(txt, () => { oldEl.value = ''; loadAssets(); });
  }

  // "전체 해제" 버튼 (태그가 하나라도 있으면 표시)
  if (container.children.length > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'filter-tag';
    clearBtn.style.cssText = 'background:#1D1D1F;color:#fff;border-color:#1D1D1F;cursor:pointer;font-family:inherit';
    clearBtn.textContent = '전체 해제';
    clearBtn.addEventListener('click', resetFilters);
    container.appendChild(clearBtn);
  }
}

// 부서 옵션 동적 로드
async function loadDeptFilter() {
  try {
    const depts = await authFetch('/api/filters/departments').then(r => r.json());
    msFilterOptions['부서명'] = depts;
  } catch {}
}

// 제조사 옵션 동적 로드
async function loadMakerFilter() {
  try {
    const makers = await authFetch('/api/filters/makers').then(r => r.json());
    msFilterOptions['제조사'] = makers;
  } catch {}
}

// 컬럼 헤더 클릭 시 오름/내림차순 토글 정렬
function sortTable(key) {
  if (sortKey === key) {
    sortDir = -sortDir;
  } else {
    sortKey = key;
    sortDir = 1;
  }
  // 모든 헤더 초기화
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-active');
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = '⇅';
  });
  // 활성 헤더 표시 (도입일 클릭 시 '사용 연수' 헤더도 함께 표시)
  const thIds = ['th-' + key];
  if (key === '도입일') thIds.push('th-연수');
  thIds.forEach(id => {
    const th = document.getElementById(id);
    if (!th) return;
    th.classList.add('sort-active');
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = sortDir === 1 ? '▲' : '▼';
  });
  renderTable();
}

// 단일 자산 행(tr) HTML 생성
function renderRow(a) {
  const badge = `<span class="badge badge-${a['상태'] || 'default'}">${a['상태'] || '-'}</span>`;
  const yrs = calcYears(a['도입일']);
  const yrsText = formatYears(yrs);
  const isOld = yrs !== null && yrs * 12 >= replaceMonths;
  const _rl = replaceMonths % 12 === 0 ? `${replaceYears}년` : `${replaceYears}년${replaceMonths%12}개월`;
  const oldBadge = isOld ? `<span class="old-badge">${_rl}+</span>` : '';
  const assetNo = a['자산번호']
    ? `<span style="font-size:12px;color:#888">${a['자산번호']}</span>`
    : `<span style="font-size:12px;color:#c0c8d8">미등록</span>`;

  const CELL = {
    '사용자명': { style: 'white-space:nowrap;font-weight:600;color:#1D1D1F', html: a['사용자명'] || '-' },
    '부서명':   { style: 'white-space:nowrap;color:#6E6E73', html: a['부서명'] || '-' },
    '상태':     { html: badge },
    '모델명':   { html: a['모델명'] || '-' },
    '사용연수': { style: `white-space:nowrap${isOld ? ';color:#dc2626;font-weight:600' : ''}`, html: `${yrsText} ${oldBadge}` },
    '사업장':   { style: 'white-space:nowrap', html: a['사업장'] || '-' },
    '자산번호': { html: assetNo },
    '사번':     { html: a['사번'] || '-' },
    '기기종류': { style: 'white-space:nowrap', html: a['기기종류'] || '-' },
    '제조사':   { style: 'white-space:nowrap', html: a['제조사'] || '-' },
    '시리얼번호': { style: 'font-size:12px;color:#666;font-family:monospace;white-space:nowrap', html: a['시리얼번호'] || '-' },
    '도입일':   { style: 'white-space:nowrap', html: a['도입일'] || '-' },
    '관리':     { extra: 'onclick="event.stopPropagation()"', html: currentRole === 'admin' ? `<button class="btn-outline-sm" onclick="startInlineEdit(${a.id})">수정</button>` : '' },
  };

  const order = getColOrder();
  const settings = getColSettings();
  let stickyIdx = 0;

  const cells = order.map(col => {
    const c = CELL[col];
    if (!c) return '';
    const isHidden = settings[col] === false;
    let cls = [];
    if (!isHidden && stickyIdx < STICKY_COUNT) {
      cls.push('col-sticky', `col-sticky-${stickyIdx}`);
      stickyIdx++;
    }
    if (isHidden) cls.push('col-hidden');
    const clsStr = cls.length ? ` class="${cls.join(' ')}"` : '';
    const styleStr = c.style ? ` style="${c.style}"` : '';
    const extraStr = c.extra ? ` ${c.extra}` : '';
    return `<td${clsStr} data-col="${col}"${styleStr}${extraStr}>${c.html}</td>`;
  }).join('');

  return `<tr data-id="${a.id}" onclick="showDetail(${a.id})">${cells}</tr>`;
}

// 전체 테이블 렌더링 — 정렬 적용 후 tbody 갱신
function renderTable() {
  const tbody = document.getElementById('asset-tbody');
  document.getElementById('result-info').textContent =
    `검색 결과: ${currentAssets.length.toLocaleString()}건`;

  if (!currentAssets.length) {
    const colCount = getColOrder().length;
    tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div>검색 결과가 없습니다</div></div></td></tr>`;
    return;
  }

  const sorted = [...currentAssets];
  if (sortKey) {
    sorted.sort((a, b) => {
      let va, vb;

      if (sortKey === '도입일') {
        // YYYY-MM-DD 문자열 직접 비교, 유효하지 않은 날짜는 항상 맨 뒤
        const isValidDate = v => v && /^\d{4}-\d{2}-\d{2}/.test(v);
        const da = isValidDate(a['도입일']) ? a['도입일'] : null;
        const db_ = isValidDate(b['도입일']) ? b['도입일'] : null;
        if (da === null && db_ === null) return 0;
        if (da === null) return 1;
        if (db_ === null) return -1;
        return da < db_ ? -sortDir : da > db_ ? sortDir : 0;
      }

      va = a[sortKey] ?? '';
      vb = b[sortKey] ?? '';
      // null/빈값은 방향 무관 항상 맨 뒤
      const emptyA = va === '' || va === null;
      const emptyB = vb === '' || vb === null;
      if (emptyA && emptyB) return 0;
      if (emptyA) return 1;
      if (emptyB) return -1;
      va = va.toString();
      vb = vb.toString();
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }

  tbody.innerHTML = sorted.map(renderRow).join('');
  applyColVisibility();
  initColumnResize();
}


/* ============================================
   컬럼 설정 (순서 변경, 표시/숨기기, 드래그앤드롭)
   - getColOrder / saveColOrder: localStorage 기반 컬럼 순서 관리
   - getColSettings / saveColSettings: 컬럼 표시/숨김 설정
   - buildHeader: 테이블 헤더 동적 생성
   - toggleColSettings: 설정 패널 토글
   - initColDragAndDrop: 드래그 앤 드롭으로 컬럼 순서 변경
   - resetColOrder: 기본 컬럼 순서로 초기화
   ============================================ */

const DEFAULT_COL_ORDER = ['사업장','사용자명','사번','부서명','상태','모델명','자산번호','기기종류','제조사','시리얼번호','도입일','사용연수','관리'];
const COL_LABELS = { '시리얼번호': 'S/N' };
const STICKY_COUNT = 3;
// 컬럼 헤더 인라인 필터에서 사용할 멀티 셀렉트 필터 키
const FILTER_COLS = {
  '부서명': '부서명', '상태': '상태',
  '사업장': '사업장', '기기종류': '기기종류', '제조사': '제조사',
};

function getColOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('col_order'));
    if (saved && saved.length === DEFAULT_COL_ORDER.length) return saved;
  } catch {}
  return [...DEFAULT_COL_ORDER];
}
function saveColOrder(order) { localStorage.setItem('col_order', JSON.stringify(order)); }
function getColSettings() {
  try { return JSON.parse(localStorage.getItem('col_settings') || '{}'); } catch { return {}; }
}
function saveColSettings(s) { localStorage.setItem('col_settings', JSON.stringify(s)); }

// 컬럼 표시/숨김 CSS 클래스 적용
function applyColVisibility() {
  const s = getColSettings();
  getColOrder().forEach(col => {
    const hidden = s[col] === false;
    document.querySelectorAll(`[data-col="${col}"]`).forEach(el => {
      el.classList.toggle('col-hidden', hidden);
    });
  });
}

// 테이블 헤더 행 동적 생성 (정렬, 필터 버튼 포함)
function buildHeader() {
  const tr = document.getElementById('header-row');
  tr.innerHTML = '';
  const order = getColOrder();
  const settings = getColSettings();
  let stickyIdx = 0;

  order.forEach(col => {
    const th = document.createElement('th');
    th.dataset.col = col;
    th.id = `th-${col}`;
    const isHidden = settings[col] === false;
    if (isHidden) th.classList.add('col-hidden');

    if (!isHidden && stickyIdx < STICKY_COUNT) {
      th.classList.add('col-sticky', `col-sticky-${stickyIdx}`);
      stickyIdx++;
    }

    const label = COL_LABELS[col] || col;
    const colSortKey = col === '사용연수' ? '도입일' : col;

    if (col === '관리') {
      th.textContent = '관리';
    } else if (FILTER_COLS[col]) {
      th.classList.add('sortable');
      th.innerHTML = `<div class="th-inner">
        <span onclick="sortTable('${colSortKey}')">${label} <span class="sort-arrow">⇅</span></span>
        <button class="col-filter-btn" id="cfb-${col}" onclick="event.stopPropagation();toggleColFilter('${col}','${FILTER_COLS[col]}',this)" title="필터">⊟</button>
      </div>`;
    } else {
      th.classList.add('sortable');
      th.setAttribute('onclick', `sortTable('${colSortKey}')`);
      th.innerHTML = `${label} <span class="sort-arrow">⇅</span>`;
    }
    tr.appendChild(th);
  });
  updateStickyPositions();
}

// 고정(sticky) 컬럼의 left 위치를 실제 너비 기반으로 재계산
function updateStickyPositions() {
  const ths = document.querySelectorAll('thead .col-sticky');
  let left = 0;
  ths.forEach((th, i) => {
    th.style.left = left + 'px';
    const col = th.dataset.col;
    document.querySelectorAll(`tbody td.col-sticky[data-col="${col}"]`).forEach(td => {
      td.style.left = left + 'px';
    });
    left += th.offsetWidth;
  });
}

// 컬럼 설정 패널 토글 (표시/숨김 체크박스 + 드래그 순서 변경)
function toggleColSettings() {
  const panel = document.getElementById('col-settings-panel');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    const order = getColOrder();
    const s = getColSettings();
    panel.innerHTML = '<div class="col-settings-title">컬럼 순서 및 표시</div>' +
      order.filter(c => c !== '관리').map(col => {
        const checked = s[col] !== false ? 'checked' : '';
        const label = COL_LABELS[col] || col;
        return `<div class="col-settings-item" draggable="true" data-col="${col}">
          <span class="col-settings-grip">☰</span>
          <span class="col-settings-label">${label}</span>
          <input type="checkbox" ${checked} onchange="onColToggle('${col}', this.checked)" onclick="event.stopPropagation()">
        </div>`;
      }).join('') +
      '<div class="col-settings-reset"><button onclick="resetColOrder()">기본값으로 초기화</button></div>';
    initColDragAndDrop(panel);
  }
}

// 개별 컬럼 표시/숨김 토글
function onColToggle(col, visible) {
  const s = getColSettings();
  if (visible) delete s[col]; else s[col] = false;
  saveColSettings(s);
  buildHeader();
  renderTable();
}

// 컬럼 순서 및 설정 초기화 (localStorage 삭제)
function resetColOrder() {
  localStorage.removeItem('col_order');
  localStorage.removeItem('col_settings');
  buildHeader();
  renderTable();
  const panel = document.getElementById('col-settings-panel');
  panel.classList.remove('open');
}

// 컬럼 설정 항목에 드래그 앤 드롭 이벤트 바인딩
function initColDragAndDrop(panel) {
  let dragItem = null;
  const items = panel.querySelectorAll('.col-settings-item');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      items.forEach(i => { i.classList.remove('drag-over-top', 'drag-over-bottom'); });
      dragItem = null;
      // 새 순서 저장
      const newOrder = [...panel.querySelectorAll('.col-settings-item')].map(i => i.dataset.col);
      newOrder.push('관리');
      saveColOrder(newOrder);
      buildHeader();
      renderTable();
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragItem || item === dragItem) return;
      items.forEach(i => { i.classList.remove('drag-over-top', 'drag-over-bottom'); });
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        item.classList.add('drag-over-top');
        item.parentNode.insertBefore(dragItem, item);
      } else {
        item.classList.add('drag-over-bottom');
        item.parentNode.insertBefore(dragItem, item.nextSibling);
      }
    });
  });
}

// 컬럼 설정 패널 바깥 클릭 시 닫기
document.addEventListener('click', e => {
  const panel = document.getElementById('col-settings-panel');
  if (panel && panel.classList.contains('open') && !e.target.closest('.col-settings-btn') && !e.target.closest('.col-settings-panel')) {
    panel.classList.remove('open');
  }
});


/* ============================================
   컬럼 필터 팝업
   - toggleColFilter: 컬럼 헤더 인라인 필터 팝업 열기/닫기
   - closeColFilter: 팝업 닫기
   - COL_FILTER_OPTIONS: 각 컬럼별 필터 옵션 정의
   ============================================ */

const COL_FILTER_OPTIONS = {
  '사업장':  ['GS에너지', 'GS파워', '인천종합에너지'],
  '상태':    ['사용중', '대여중', '재고', '반납', '폐기'],
  '기기종류': ['노트북', '데스크톱', 'Mac'],
  '제조사':  null, // 동적 로드
  '부서명':  null, // 동적 로드
};

let _colFilterActive = null; // { colKey, selectId, btnEl }

// 컬럼 헤더의 필터 버튼 클릭 시 팝업 표시 (멀티 셀렉트)
function toggleColFilter(colKey, _unused, btnEl) {
  const popup = document.getElementById('col-filter-popup');
  // 이미 같은 컬럼 팝업이 열려있으면 닫기
  if (_colFilterActive && _colFilterActive.colKey === colKey) {
    closeColFilter(); return;
  }
  closeColFilter();
  _colFilterActive = { colKey, btnEl };
  btnEl.classList.add('active');

  const opts = msFilterOptions[colKey] || [];
  const selected = msFilterState[colKey];
  popup.innerHTML = opts.map(o => `<label class="col-filter-opt">
      <input type="checkbox" value="${o.replace(/"/g, '&quot;')}" ${selected.has(o) ? 'checked' : ''} style="margin-right:6px;accent-color:#007AFF">
      <span>${o}</span>
    </label>`).join('') +
    `<div style="border-top:1px solid #F2F2F7;padding:6px 10px;text-align:right">
       <button type="button" data-act="clear" style="background:none;border:none;color:#007AFF;font-size:12px;cursor:pointer;font-family:inherit">선택 해제</button>
     </div>`;

  popup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.value);
      else selected.delete(cb.value);
      updateMsButton(colKey);
      loadAssets();
    });
  });
  popup.querySelector('[data-act="clear"]').addEventListener('click', () => {
    msFilterState[colKey] = new Set();
    updateMsButton(colKey);
    closeColFilter();
    loadAssets();
  });

  // 팝업 위치: 버튼 바로 아래
  const rect = btnEl.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 4) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
  popup.classList.remove('hidden');
}

function closeColFilter() {
  const popup = document.getElementById('col-filter-popup');
  popup.classList.add('hidden');
  if (_colFilterActive) {
    _colFilterActive.btnEl.classList.remove('active');
    _colFilterActive = null;
  }
}

// 필터 팝업 외부 클릭 시 닫기
document.addEventListener('click', e => {
  if (_colFilterActive && !e.target.closest('#col-filter-popup') && !e.target.closest('.col-filter-btn')) {
    closeColFilter();
  }
});


/* ============================================
   컬럼 리사이즈
   - initColumnResize: 각 th에 리사이즈 핸들 추가
   - getColWidths / saveColumnWidths / loadColumnWidths: 너비 저장/복원
   - 더블클릭 시 기본 너비로 초기화
   ============================================ */

function getColWidths() { try { return JSON.parse(localStorage.getItem('col_widths') || '{}'); } catch { return {}; } }

// 현재 컬럼 너비를 localStorage에 저장
function saveColumnWidths() {
  const ths = document.querySelectorAll('#asset-table thead th[data-col]');
  const w = {};
  ths.forEach(th => { if (th.style.width) w[th.dataset.col] = parseInt(th.style.width); });
  localStorage.setItem('col_widths', JSON.stringify(w));
}

// 저장된 컬럼 너비를 th에 복원 적용
function loadColumnWidths() {
  const saved = getColWidths();
  Object.entries(saved).forEach(([col, width]) => {
    const th = document.querySelector(`#asset-table thead th[data-col="${col}"]`);
    if (th) { th.style.width = width + 'px'; th.style.minWidth = width + 'px'; }
  });
}

let _resizeStartX, _resizeStartW, _resizeTh, _resizeHandle;

function _onResizeMove(e) {
  const width = _resizeStartW + (e.pageX - _resizeStartX);
  if (width >= 60 && width <= 400) {
    _resizeTh.style.width = width + 'px';
    _resizeTh.style.minWidth = width + 'px';
  }
}
function _onResizeUp() {
  document.removeEventListener('mousemove', _onResizeMove);
  document.removeEventListener('mouseup', _onResizeUp);
  if (_resizeHandle) _resizeHandle.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  saveColumnWidths();
  updateStickyPositions();
}

// 각 th 헤더에 드래그 리사이즈 핸들 추가
function initColumnResize() {
  const table = document.getElementById('asset-table');
  if (!table) return;

  // 기존 resizer 제거
  table.querySelectorAll('.resizer').forEach(r => r.remove());

  const ths = table.querySelectorAll('thead th[data-col]');
  ths.forEach(th => {
    const resizer = document.createElement('div');
    resizer.className = 'resizer';

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _resizeStartX = e.pageX;
      _resizeTh = th;
      _resizeStartW = th.offsetWidth;
      _resizeHandle = resizer;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', _onResizeMove);
      document.addEventListener('mouseup', _onResizeUp);
    });

    // 더블클릭 → 기본 너비 초기화
    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      th.style.width = '';
      th.style.minWidth = '';
      saveColumnWidths();
      updateStickyPositions();
    });

    th.appendChild(resizer);
  });

  loadColumnWidths();
  updateStickyPositions();
}


/* ============================================
   자산 등록/수정 폼
   - assetFormHTML: 폼 HTML 생성 (모달·페이지 공용)
   - openRegisterModal / openEditModal: 등록/수정 모달 열기
   - editFromDetail: 상세보기에서 수정 모달 전환
   - getFormData / validateAsset / saveAsset: 폼 데이터 수집·검증·저장
   - onMakerChange / onModelSelectChange: 제조사·모델명 연동
   - loadMakerList / loadModelList: 드롭다운 동적 로드
   - startInlineEdit / saveInlineEdit / cancelInlineEdit: 인라인 편집
   ============================================ */

// 인라인 편집 모드 시작 — 해당 행을 입력 필드로 변환
function startInlineEdit(id) {
  const a = currentAssets.find(x => x.id === id);
  if (!a) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;

  const sel = (name, opts, val) => {
    const options = opts.map(o =>
      `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`
    ).join('');
    return `<select class="ie-ctl" id="ie-${name}"><option value=""></option>${options}</select>`;
  };
  const inp = (name, type, val) =>
    `<input type="${type}" class="ie-ctl" id="ie-${name}" value="${(val || '').replace(/"/g, '&quot;')}">`;

  row.classList.add('inline-edit-row');
  row.removeAttribute('onclick');
  row.innerHTML = `
    <td>${sel('사업장', ['GS에너지','GS파워','인천종합에너지'], a['사업장'])}</td>
    <td>${inp('자산번호', 'text', a['자산번호'])}</td>
    <td>${inp('사용자명', 'text', a['사용자명'])}</td>
    <td>${inp('부서명', 'text', a['부서명'])}</td>
    <td>${inp('사번', 'text', a['사번'])}</td>
    <td>${sel('상태', ['사용중','대여중','재고','반납','폐기'], a['상태'])}</td>
    <td>${sel('기기종류', ['노트북','데스크톱','Mac'], a['기기종류'])}</td>
    <td>${inp('제조사', 'text', a['제조사'])}</td>
    <td>${inp('모델명', 'text', a['모델명'])}</td>
    <td><span class="ie-sn">${a['시리얼번호'] || '-'}</span></td>
    <td>${inp('도입일', 'date', a['도입일'])}</td>
    <td style="color:#b0b8c8;font-size:12px">-</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap">
      <button class="btn btn-success btn-sm" onclick="saveInlineEdit(${id})">저장</button>
      <button class="btn btn-secondary btn-sm" style="margin-left:4px" onclick="cancelInlineEdit(${id})">취소</button>
    </td>`;
}

// 인라인 편집 저장 — 변경 데이터를 API로 전송
async function saveInlineEdit(id) {
  const a = currentAssets.find(x => x.id === id);
  if (!a) return;

  const get = name => {
    const el = document.getElementById(`ie-${name}`);
    return el ? (el.value.trim() || null) : (a[name] ?? null);
  };

  const updated = {
    ...a,
    사업장:  get('사업장'),
    자산번호: get('자산번호'),
    사용자명: get('사용자명'),
    부서명:  get('부서명'),
    사번:    get('사번'),
    상태:    get('상태'),
    기기종류: get('기기종류'),
    제조사:  get('제조사'),
    모델명:  get('모델명'),
    도입일:  get('도입일'),
  };

  const res = await fetch(`/api/assets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });
  const result = await res.json();

  if (result.success) {
    const idx = currentAssets.findIndex(x => x.id === id);
    if (idx >= 0) currentAssets[idx] = updated;
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.outerHTML = renderRow(updated);
    showToast('수정되었습니다.');
  } else {
    showToast('저장에 실패했습니다.');
  }
}

// 인라인 편집 취소 — 원래 행으로 복원
function cancelInlineEdit(id) {
  const a = currentAssets.find(x => x.id === id);
  if (!a) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.outerHTML = renderRow(a);
}

// 자산 등록/수정 폼 HTML 생성 (모달·페이지 모두 사용)
function assetFormHTML(data, isPage=false) {
  const v = data || {};
  const fld = (label, name, type='text', opts=null, hint='', req=false, extra='') => {
    const r = req ? ' <span class="required">*</span>' : '';
    const h = hint ? `<span class="hint">${hint}</span>` : '';
    const errMsg = '<div class="form-error-msg">필수 입력 항목입니다</div>';
    if (opts) {
      const options = opts.map(o => `<option value="${o}" ${v[name]===o?'selected':''}>${o || '(없음)'}</option>`).join('');
      return `<div class="form-group" data-field="${name}">
        <label class="form-label">${label}${r}${h}${extra}</label>
        <select class="form-control" id="f-${name}"><option value="">선택</option>${options}</select>
        ${req ? errMsg : ''}
      </div>`;
    }
    if (type === 'textarea') {
      return `<div class="form-group" data-field="${name}">
        <label class="form-label">${label}${r}${h}${extra}</label>
        <textarea class="form-control" id="f-${name}" rows="1" style="resize:vertical">${v[name]||''}</textarea>
      </div>`;
    }
    return `<div class="form-group" data-field="${name}">
      <label class="form-label">${label}${r}${h}${extra}</label>
      <input type="${type}" class="form-control" id="f-${name}" value="${v[name]||''}">
      ${req ? errMsg : ''}
    </div>`;
  };

  const sec1 = `<div class="${isPage ? 'register-section' : ''}">
    ${isPage ? '<div class="register-section-title">사용자 정보</div>' : ''}
    <div class="form-grid">
      ${fld('사업장', '사업장', 'text', ['GS에너지','GS파워','인천종합에너지'], '', true)}
      ${fld('상태', '상태', 'text', ['사용중','대여중','재고','반납','폐기'], '', true)}
      ${fld('사용자명', '사용자명', 'text', null, '', true)}
      ${fld('사번', '사번', 'text', null, '', true)}
      ${fld('이메일', '이메일', 'email')}
      ${fld('부서명', '부서명')}
    </div>
  </div>`;

  const sec2 = `<div class="${isPage ? 'register-section' : ''}">
    ${isPage ? '<div class="register-section-title">기기 정보</div>' : ''}
    <div class="form-grid">
      ${fld('기기종류', '기기종류', 'text', ['노트북','데스크톱','Mac'])}
      <div class="form-group" data-field="제조사">
        <label class="form-label">제조사</label>
        <select class="form-control" id="f-제조사-select" onchange="onMakerChange()">
          <option value="">선택</option>
          <option value="__custom__">직접 입력</option>
        </select>
        <input type="text" class="form-control" id="f-제조사" placeholder="제조사 직접 입력" style="margin-top:6px;display:none" value="${v['제조사']||''}">
      </div>
      <div class="form-group" data-field="모델명">
        <label class="form-label">모델명</label>
        <select class="form-control" id="f-모델명-select" onchange="onModelSelectChange()">
          <option value="">선택</option>
          <option value="__custom__">직접 입력</option>
        </select>
        <input type="text" class="form-control" id="f-모델명" placeholder="모델명 직접 입력" style="margin-top:6px;display:${v['모델명'] ? '' : 'none'}" value="${v['모델명']||''}" autocomplete="off">
      </div>
      ${fld('자산번호', '자산번호', 'text', null, '(ERP 연동 예정)')}
      <div class="form-group full" data-field="시리얼번호">
        <label class="form-label">시리얼번호 (S/N) <span class="required">*</span></label>
        <input type="text" class="form-control" id="f-시리얼번호" value="${v['시리얼번호']||''}">
        <div class="form-error-msg">필수 입력 항목입니다</div>
      </div>
    </div>
  </div>`;

  const returnTip = '<span class="tooltip-icon" data-tip="대여 또는 반납 처리 시 입력">?</span>';
  const sec3 = `<div class="${isPage ? 'register-section' : ''}">
    ${isPage ? '<div class="register-section-title">날짜 및 기타</div>' : ''}
    <div class="form-grid">
      ${fld('도입일', '도입일', 'date')}
      ${fld('지급일', '지급일', 'date')}
      ${fld('반납일', '반납일', 'date', null, '', false, returnTip)}
      ${fld('비고', '비고')}
    </div>
  </div>`;

  return sec1 + sec2 + sec3;
}

// 모델명 드롭다운 변경 시 직접 입력 필드 토글
function onModelSelectChange() {
  const sel = document.getElementById('f-모델명-select');
  const input = document.getElementById('f-모델명');
  if (sel.value === '__custom__') {
    input.style.display = '';
    input.value = '';
    input.focus();
  } else if (sel.value) {
    input.style.display = '';
    input.value = sel.value;
  } else {
    input.style.display = 'none';
    input.value = '';
  }
}

// 제조사 드롭다운 변경 시 모델 목록 연동 갱신
function onMakerChange() {
  const sel = document.getElementById('f-제조사-select');
  const input = document.getElementById('f-제조사');
  if (sel.value === '__custom__') {
    input.style.display = '';
    input.value = '';
    input.focus();
    loadModelList('');
  } else {
    input.style.display = '';
    input.value = sel.value;
    loadModelList(sel.value);
  }
}

// 제조사 목록을 API에서 로드하여 드롭다운에 채움
async function loadMakerList() {
  const sel = document.getElementById('f-제조사-select');
  const input = document.getElementById('f-제조사');
  if (!sel) return;
  try {
    const makers = await authFetch('/api/filters/makers').then(r => r.json());
    sel.innerHTML = '<option value="">선택</option>' +
      makers.map(m => `<option value="${m}">${m}</option>`).join('') +
      '<option value="__custom__">직접 입력</option>';
    if (input && input.value) {
      const found = makers.find(m => m === input.value);
      if (found) { sel.value = found; input.style.display = ''; }
      else if (input.value) { sel.value = '__custom__'; input.style.display = ''; }
    }
  } catch { sel.innerHTML = '<option value="">선택</option><option value="__custom__">직접 입력</option>'; }
}

// 모델명 목록을 제조사 기준으로 API에서 로드
async function loadModelList(maker) {
  const sel = document.getElementById('f-모델명-select');
  const input = document.getElementById('f-모델명');
  if (!sel) return;
  try {
    const params = maker ? `?제조사=${encodeURIComponent(maker)}` : '';
    const models = await authFetch(`/api/filters/models${params}`).then(r => r.json());
    sel.innerHTML = '<option value="">선택</option>' +
      models.map(m => `<option value="${m}">${m}</option>`).join('') +
      '<option value="__custom__">직접 입력</option>';
    // 기존 값이 목록에 있으면 선택
    if (input && input.value) {
      const found = models.find(m => m === input.value);
      if (found) { sel.value = found; input.style.display = ''; }
      else if (input.value) { sel.value = '__custom__'; input.style.display = ''; }
    }
  } catch { sel.innerHTML = '<option value="">선택</option><option value="__custom__">직접 입력</option>'; }
}

// 신규 등록 모달 열기
function openRegisterModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '신규 자산 등록';
  document.getElementById('modal-form-body').innerHTML = assetFormHTML(null);
  document.getElementById('modal-save-btn').textContent = '등록';
  openModal('asset-modal');
  loadMakerList();
  loadModelList('');
}

// 기존 자산 수정 모달 열기
function openEditModal(id) {
  const asset = currentAssets.find(a => a.id === id);
  if (!asset) return;
  editingId = id;
  document.getElementById('modal-title').textContent = '자산 수정';
  document.getElementById('modal-form-body').innerHTML = assetFormHTML(asset);
  document.getElementById('modal-save-btn').textContent = '저장';
  openModal('asset-modal');
  const maker = asset['제조사'] || '';
  loadMakerList().then(() => {
    const sel = document.getElementById('f-제조사-select');
    const input = document.getElementById('f-제조사');
    if (sel && input) {
      const found = [...sel.options].find(o => o.value === maker);
      if (found) { sel.value = maker; }
      else if (maker) { sel.value = '__custom__'; }
      input.style.display = '';
      input.value = maker;
    }
  });
  loadModelList(maker);
}

// 상세 모달에서 수정 모달로 전환
function editFromDetail() {
  closeModal('detail-modal');
  const asset = currentAssets.find(a => a.id === detailId);
  if (asset) {
    editingId = detailId;
    document.getElementById('modal-title').textContent = '자산 수정';
    document.getElementById('modal-form-body').innerHTML = assetFormHTML(asset);
    document.getElementById('modal-save-btn').textContent = '저장';
    openModal('asset-modal');
  }
}

// 폼 필드에서 데이터 수집
function getFormData() {
  const fields = ['자산번호','지급일','반납일','부서명','사번','이메일','사용자명',
    '상태','기기종류','제조사','모델명','시리얼번호','사업장','도입일','비고'];
  const data = {};
  fields.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) data[f] = el.value.trim() || null;
  });
  // 제조사: input 필드 값을 직접 사용
  const makerInput = document.getElementById('f-제조사');
  if (makerInput) data['제조사'] = makerInput.value.trim() || null;
  return data;
}

// 필수 필드 유효성 검사 — 미입력 항목에 에러 표시
function validateAsset(data) {
  // 이전 에러 상태 클리어
  document.querySelectorAll('.form-group.has-error').forEach(g => g.classList.remove('has-error'));
  const required = [
    ['사업장', '사업장'],
    ['상태', '상태'],
    ['사용자명', '사용자명'],
    ['사번', '사번'],
    ['시리얼번호', '시리얼번호(S/N)']
  ];
  const missing = [];
  required.forEach(([field, label]) => {
    if (!data[field]) {
      missing.push(label);
      const grp = document.querySelector(`.form-group[data-field="${field}"]`);
      if (grp) grp.classList.add('has-error');
    }
  });
  return missing;
}

// 자산 등록/수정 저장 (모달용)
async function saveAsset() {
  const data = getFormData();
  const missing = validateAsset(data);
  if (missing.length) { alert(`필수 항목을 입력하세요:\n• ${missing.join('\n• ')}`); return; }
  const url    = editingId ? `/api/assets/${editingId}` : '/api/assets';
  const method = editingId ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  const result = await res.json();
  if (result.success) {
    closeModal('asset-modal');
    loadAssets();
    showToast(editingId ? '수정되었습니다.' : '등록되었습니다.');
  }
}


/* ============================================
   상세 보기 모달
   - showDetail: 자산 상세 정보를 API에서 로드하여 모달에 표시
   - returnAsset: 반납 처리 (상태·반납일 업데이트)
   ============================================ */

// 자산 상세 정보 모달 표시
async function showDetail(id) {
  detailId = id;
  const a = await fetch(`/api/assets/${id}`).then(r => r.json());
  const yrs = calcYears(a['도입일']);
  const yrsText = yrs !== null ? `${yrs.toFixed(1)}년` + (yrs * 12 >= replaceMonths ? ' ⚠️ 교체 검토 대상' : '') : '-';
  const item = (label, key) => `<div class="detail-item">
    <div class="detail-item-label">${label}</div>
    <div class="detail-item-value">${a[key] || '-'}</div>
  </div>`;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-grid">
      ${item('사업장','사업장')}   ${item('상태','상태')}
      ${item('자산번호','자산번호')} ${item('기기종류','기기종류')}
      ${item('사용자명','사용자명')} ${item('사번','사번')}
      ${item('이메일','이메일')}    ${item('부서명','부서명')}
      ${item('제조사','제조사')}    ${item('모델명','모델명')}
      <div class="detail-item full">
        <div class="detail-item-label">시리얼번호 (S/N)</div>
        <div class="detail-item-value" style="font-family:monospace">${a['시리얼번호'] || '-'}</div>
      </div>
      ${item('도입일','도입일')}
      <div class="detail-item">
        <div class="detail-item-label">사용 연수</div>
        <div class="detail-item-value">${yrsText}</div>
      </div>
      ${item('지급일','지급일')}    ${item('반납일','반납일')}
      <div class="detail-item full">
        <div class="detail-item-label">비고</div>
        <div class="detail-item-value">${a['비고'] || '-'}</div>
      </div>
      ${item('등록일','생성일')}    ${item('최종수정일','수정일')}
    </div>`;
  openModal('detail-modal');
}

// 반납 처리 — 확인 후 상태를 '반납'으로 변경하고 반납일 기록
function returnAsset() {
  const a = currentAssets.find(x => x.id === detailId);
  const name = a ? (a['사용자명'] || 'N/A') : '';
  showConfirm('반납 처리',
    `[${name}] 사용자의 자산을 반납 처리하시겠습니까?\n반납일이 오늘 날짜로 기록됩니다.`,
    async () => {
      const asset = await fetch(`/api/assets/${detailId}`).then(r => r.json());
      asset['상태'] = '반납';
      asset['반납일'] = new Date().toISOString().split('T')[0];
      await fetch(`/api/assets/${detailId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(asset)
      });
      closeModal('confirm-modal');
      closeModal('detail-modal');
      loadAssets();
      showToast('반납 처리되었습니다.');
    }
  );
}


/* ============================================
   엑셀 업로드
   - renderRegisterPage: 등록 페이지 (단건 + 엑셀 탭) 렌더링
   - switchRegisterTab: 단건/엑셀 탭 전환
   - downloadTemplate: 업로드 양식 엑셀 다운로드
   - downloadExcel: 현재 자산 목록 엑셀 다운로드
   - handleExcelUpload: 엑셀 파일 파싱 및 일괄 등록
   - saveFromPage: 단건 등록 페이지에서 저장
   - showUploadResult: 업로드 결과 모달 표시
   - xlDate / xlStr / STATUS_MAP_XL: 엑셀 데이터 변환 유틸
   ============================================ */

// 등록 페이지 전체 렌더링 (단건 등록 폼 + 엑셀 업로드 영역)
function renderRegisterPage() {
  editingId = null;
  // 단건 등록 탭
  document.getElementById('register-tab-single').innerHTML =
    assetFormHTML(null, true) +
    `<div class="register-actions">
      <button class="btn-apple-secondary" onclick="renderRegisterPage()">초기화</button>
      <button class="btn-apple-primary" onclick="saveFromPage()">등록하기</button>
    </div>
    <div id="register-result" style="margin-top:12px"></div>`;
  loadMakerList();
  loadModelList('');

  // 엑셀 업로드 탭
  document.getElementById('register-tab-excel').innerHTML = `
    <div class="register-section">
      <div class="register-section-title">엑셀 파일 업로드</div>
      <div class="upload-dropzone" id="upload-dropzone"
        onclick="document.getElementById('excel-file-input2').click()">
        <div class="upload-dropzone-icon">📥</div>
        <div class="upload-dropzone-text">클릭하여 파일 선택 또는 파일을 여기에 드래그</div>
        <div class="upload-dropzone-hint">.xlsx, .xls 파일만 가능</div>
        <input type="file" id="excel-file-input2" accept=".xlsx,.xls" style="display:none" onchange="handleExcelUpload(this)">
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#4b5563;cursor:pointer;user-select:none">
          <input type="checkbox" id="excel-overwrite" style="width:16px;height:16px;cursor:pointer;accent-color:#0071e3">
          중복 시리얼번호 덮어쓰기
        </label>
        <button class="btn-apple-secondary" onclick="downloadTemplate()" style="font-size:12px;padding:6px 14px">
          📄 업로드 양식 다운로드
        </button>
      </div>
    </div>
    <div class="register-section" style="padding:16px 20px">
      <div style="font-size:12px;color:#8E8E93;line-height:1.7">
        <strong style="color:#6E6E73">업로드 안내</strong><br>
        • 시리얼번호(S/N)는 필수이며, 없는 행은 자동으로 건너뜁니다.<br>
        • 기존 S/N과 동일한 데이터는 "중복 덮어쓰기" 체크 시 업데이트됩니다.<br>
        • 날짜 형식: YYYY-MM-DD 또는 YYYY.MM.DD
      </div>
    </div>`;

  // 드래그앤드롭 이벤트 바인딩
  const dz = document.getElementById('upload-dropzone');
  if (dz) {
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && /\.xlsx?$/i.test(file.name)) {
        const input = document.getElementById('excel-file-input2');
        const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
        handleExcelUpload(input);
      }
    });
  }
}

// 단건/엑셀 탭 전환
function switchRegisterTab(tab) {
  const btns = document.querySelectorAll('.segment-btn');
  btns[0].classList.toggle('active', tab === 'single');
  btns[1].classList.toggle('active', tab === 'excel');
  document.getElementById('register-tab-single').style.display = tab === 'single' ? '' : 'none';
  document.getElementById('register-tab-excel').style.display = tab === 'excel' ? '' : 'none';
}

// 빈 엑셀 업로드 양식 다운로드
function downloadTemplate() {
  const headers = ['지급일','반납일','부서명','사번','사용자명','상태','기기종류','도입일','제조사','모델명','S/N','비고'];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  // 컬럼 너비 설정
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '자산목록');
  XLSX.writeFile(wb, 'GS에너지_PC자산_업로드양식.xlsx');
}

// 현재 자산 목록을 엑셀 파일로 다운로드
function downloadExcel() {
  const headers = ['지급일','반납일','부서명','사번','사용자명','상태','기기종류','도입일','제조사','모델명','S/N','비고'];
  const fieldMap = { 'S/N': '시리얼번호' };
  const data = currentAssets.map(a =>
    headers.map(h => a[fieldMap[h] || h] || '')
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '자산목록');
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  XLSX.writeFile(wb, `GS에너지_PC자산목록_${dateStr}.xlsx`);
}

// 단건 등록 페이지에서 저장
async function saveFromPage() {
  const data = getFormData();
  const missing = validateAsset(data);
  if (missing.length) {
    document.getElementById('register-result').innerHTML =
      `<div style="color:#dc2626;font-size:13px;line-height:1.8">
        ⚠️ 필수 항목을 입력하세요:<br>• ${missing.join('<br>• ')}
      </div>`;
    return;
  }
  const res = await fetch('/api/assets', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
  });
  const result = await res.json();
  if (result.success) {
    showToast('✓ 자산이 등록되었습니다.');
    showPage('assets');
  }
}

// 엑셀 상태값 매핑 (다양한 표현 → 표준 상태값)
const STATUS_MAP_XL = {
  '사용중':'사용중','재고':'재고','대여중':'대여중',
  '퇴직':'반납','반납':'반납','폐기':'폐기','파기':'폐기',
  '수리필요':'사용중','분실':'폐기'
};

// 엑셀 셀 값을 YYYY-MM-DD 날짜 문자열로 변환
function xlDate(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    const y = val.getFullYear(), m = val.getMonth() + 1, d = val.getDate();
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const s = String(val).trim().replace(/\u3000|\u00a0/g, '');
  if (!s || ['nan','NaT','None','-'].includes(s)) return null;
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('.');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// 엑셀 셀 값을 정제된 문자열로 변환 (빈값·특수값 null 처리)
function xlStr(val) {
  if (val == null) return null;
  const s = String(val).trim().replace(/\u3000|\u00a0/g, '');
  return (s && !['nan','NaT','None','-','　'].includes(s)) ? s : null;
}

// 업로드 결과를 확인 모달로 표시
function showUploadResult(result, noSn) {
  const total = result.inserted + (result.skipped || 0) + (result.updated || 0) + noSn;
  const lines = [
    `총 ${total}행 처리 완료`,
    ``,
    `✅ 신규 등록:  ${result.inserted}건`,
  ];
  if (result.updated > 0) lines.push(`🔄 덮어쓰기:  ${result.updated}건`);
  if (result.skipped > 0) lines.push(`⏭  중복 스킵:  ${result.skipped}건`);
  if (noSn > 0) lines.push(`⚠️  S/N 없어 스킵: ${noSn}건`);

  document.getElementById('confirm-title').textContent = '업로드 결과';
  document.getElementById('confirm-text').textContent  = lines.join('\n');
  document.getElementById('confirm-ok-btn').textContent = '확인';
  document.getElementById('confirm-ok-btn').onclick = () => {
    closeModal('confirm-modal');
    loadAssets();
  };
  // 이 경우 취소 버튼 불필요 → 숨김
  const cancelBtn = document.querySelector('#confirm-modal .btn-secondary');
  cancelBtn.dataset.hiddenByUpload = '1';
  cancelBtn.style.display = 'none';
  openModal('confirm-modal');
}

// 엑셀 파일 읽기 및 일괄 등록 API 호출
async function handleExcelUpload(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // 같은 파일 재업로드 허용

  showToast('엑셀 파일 읽는 중...');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

      let noSn = 0;
      const assets = [];
      const dateErrors = [];

      for (const [i, row] of rows.entries()) {
        // S/N 컬럼 다양한 이름 허용
        const sn = xlStr(row['S/N'] ?? row['시리얼번호'] ?? row['SN'] ?? row['s/n'] ?? row['Serial No']);
        if (!sn) { noSn++; continue; }

        const 반납일 = xlDate(row['반납일']);
        const 지급일 = xlDate(row['지급일']);
        const 도입일 = xlDate(row['도입일']) || 지급일;
        const 상태raw = xlStr(row['상태']);
        const 상태 = 상태raw
          ? (STATUS_MAP_XL[상태raw] ?? 상태raw)
          : (반납일 ? '반납' : '사용중');

        // 날짜 형식 오류 감지 (변환 불가이면서 원본값이 있는 경우)
        for (const [col, parsed, raw] of [
          ['지급일', 지급일, row['지급일']],
          ['반납일', 반납일, row['반납일']],
          ['도입일', 도입일, row['도입일']],
        ]) {
          if (raw && !parsed) dateErrors.push(`행 ${i + 2}: ${col}="${raw}" 날짜 형식 불명확`);
        }

        assets.push({
          지급일, 반납일, 도입일,
          부서명:   xlStr(row['부서명']),
          사번:     xlStr(row['사번']),
          사용자명: xlStr(row['사용자명']),
          상태,
          기기종류: xlStr(row['기기종류']) || '노트북',
          제조사:   xlStr(row['제조사']),
          모델명:   xlStr(row['모델명']),
          시리얼번호: sn,
          사업장:   xlStr(row['사업장']),
          비고:     xlStr(row['비고']),
        });
      }

      if (assets.length === 0 && noSn === 0) {
        alert('인식된 데이터가 없습니다.\n헤더 컬럼명(S/N, 사용자명 등)을 확인해 주세요.');
        return;
      }

      const overwrite = document.getElementById('excel-overwrite').checked;
      const res = await fetch('/api/assets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets, overwrite }),
      });
      const result = await res.json();

      if (result.success) {
        showUploadResult(result, noSn);
        if (dateErrors.length) {
          console.warn('[날짜 경고]', dateErrors.join('\n'));
        }
      } else {
        alert(`업로드 오류 (전체 롤백됨):\n${result.error}`);
      }
    } catch (err) {
      alert(`엑셀 파일 읽기 실패:\n${err.message}`);
    }
  };
  reader.readAsArrayBuffer(file);
}


/* ============================================
   유틸리티 (토스트, 모달, 날짜 계산 등)
   - openModal / closeModal: 모달 열기/닫기
   - showConfirm: 확인 대화상자 표시
   - showToast: 하단 토스트 메시지 표시
   ============================================ */

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// 모달 오버레이 클릭 시 닫기
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

// 확인/취소 선택 모달 표시
function showConfirm(title, text, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent  = text;
  document.getElementById('confirm-ok-btn').onclick    = onOk;
  openModal('confirm-modal');
}

// 토스트 알림 (하단 중앙, 2.5초 후 자동 사라짐)
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'#1a3a5c', color:'white', padding:'10px 24px',
    borderRadius:'24px', fontSize:'14px', zIndex:'9999',
    boxShadow:'0 4px 12px rgba(0,0,0,0.2)', transition:'opacity 0.3s'
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}


/* ============================================
   초기화
   - 앱 시작 시 세션 확인 후 로그인 또는 메인 화면 표시
   ============================================ */
checkAuth();
