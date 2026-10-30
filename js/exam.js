/* Bluebook 스타일 시험 화면 */
const Exam = (() => {
  const KEY = 'sat-active-session';
  let S = null;          // 저장되는 세션 상태
  let Q = {};            // id -> 문제
  let root = null;
  let onFinish = null;
  let onAsk = null; // 질문노트에 넣고 빼기 (qid, 체크 여부, 메모)
  let timerId = null, lastTick = 0, lastSave = 0, lastViolation = 0;
  const ui = { hideTimer: false, crossOut: false, highlight: false, nav: false, more: false, dir: false, calc: false, ref: false, split: 55, modal: null, hlColor: 'yellow' };
  // 형광펜 색 — 빨강은 "모르는 단어" (영단어장에 자동 저장)
  const HL_COLORS = [['yellow', '노랑'], ['green', '초록'], ['blue', '파랑'], ['pink', '분홍'], ['red', '빨강 · 모르는 단어']];

  const ICON = {
    chevDown: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevUp: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" fill="var(--bm-fill,none)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 3h12v18l-6-4-6 4z" fill="#c8102e"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 1.8a7.2 7.2 0 0 0-7.2 7.2c0 5.3 7.2 13.2 7.2 13.2s7.2-7.9 7.2-13.2A7.2 7.2 0 0 0 12 1.8z" fill="#1c3c95"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.7"/></svg>',
    dots: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>',
    calc: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="2.5" width="14" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="8" y="5.5" width="8" height="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><g fill="currentColor"><circle cx="9" cy="13" r="1"/><circle cx="12" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><circle cx="9" cy="17" r="1"/><circle cx="12" cy="17" r="1"/><circle cx="15" cy="17" r="1"/></g></svg>',
    ref: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><text x="12" y="17" font-size="7" text-anchor="middle" fill="currentColor" font-family="serif" font-style="italic">x²</text></svg>',
    clock: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 8.5v7M14 8.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };

  const cur = () => S.modules[S.mi];
  const curQid = () => cur().qids[S.qi];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} lastSave = Date.now(); };
  
  /* ---------- 시작 / 재개 / 종료 ---------- */
  function start(questions, opt) {
    const rw = questions.filter(q => q.test !== 'MATH');
    const math = questions.filter(q => q.test === 'MATH');
    const modules = [];
    // 모의고사: 실제 SAT처럼 섹션마다 모듈 2개로 나눔 (R&W 27+27 · Math 22+22)
    const add = (test, list, sec) => {
      const parts = opt.mock && list.length > 1 ? [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))] : [list];
      parts.forEach((p, i) => modules.push({ test, qids: p.map(q => q.id), limit: U.timeFor(test, p.length), sec, mod: i + 1 }));
    };
    if (rw.length) add('RW', rw, 1);
    if (math.length) add('MATH', math, rw.length ? 2 : 1);
    Q = {}; questions.forEach(q => (Q[q.id] = q));
    const now = Date.now();
    modules[0].startAt = now;
    S = {
      date: opt.date || U.today(), name: opt.name || 'Student', startedAt: now,
      modules, mi: 0, qi: 0, review: false, phase: 'test', endAt: now + modules[0].limit * 1000,
      used: [], responses: {}, marked: {}, elim: {}, hl: {}, th: {}, spent: {}, violations: [], warned5: false,
      timed: opt.timed !== false, mock: opt.mock || undefined,
    };
    onFinish = opt.onFinish;
    onAsk = opt.onAsk || null;
    ui.dir = true;
    mount();
  }

  function pending() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function discard() { localStorage.removeItem(KEY); }

  function resume(qmap, opt) {
    S = pending();
    if (!S) return false;
    Q = qmap;
    if (S.suspended) { // "저장하고 나가기"로 멈춘 시험 → 일시정지 상태로 다시 열기 (나가 있던 시간은 빼기)
      const d = Date.now() - (S.suspendedAt || Date.now());
      if (S.phase === 'test' && d > 0) { S.endAt += d; cur().startAt += d; }
      S.suspended = false; S.paused = true;
    }
    else S.violations.push({ type: 'reload', at: Date.now() });
    onFinish = opt.onFinish;
    onAsk = opt.onAsk || null;
    mount();
    return true;
  }

  function mount() {
    root = document.createElement('div');
    root.id = 'exam';
    root.className = 'bb';
    document.body.appendChild(root);
    document.body.classList.add('exam-on');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('mouseup', onMouseUp);
    addGuards();
    enterFs();
    render();
    lastTick = Date.now();
    timerId = setInterval(tick, 250);
    save();
    // 전체화면이 아직 아니면(브라우저가 막은 경우) 버튼 한 번으로 전체화면 전환 — 그 전까지 타이머 멈춤
    setTimeout(() => { if (root && fsSupported() && !isFs()) showGate(); }, 400);
  }

  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  let gateOpen = false;
  function showGate() {
    gateOpen = true;
    let g = root.querySelector('.bb-gate');
    if (!g) { g = document.createElement('div'); g.className = 'bb-lock bb-gate'; root.appendChild(g); }
    g.innerHTML = `<div class="bb-lock-card">
      <h2>전체화면으로 시험을 시작합니다</h2>
      <p class="sub">시험은 전체화면에서만 진행됩니다. 버튼을 누르면 전체화면으로 바뀌고 타이머가 시작됩니다.</p>
      <button class="bb-btn" data-act="gate">전체화면으로 시작</button>
    </div>`;
  }
  function hideGate() { gateOpen = false; root && root.querySelector('.bb-gate')?.remove(); }

  function unmount(keepSession) {
    clearInterval(timerId);
    removeGuards();
    try { navigator.keyboard && navigator.keyboard.unlock && navigator.keyboard.unlock(); } catch (e) {}
    gateOpen = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    root && root.remove();
    root = null;
    document.body.classList.remove('exam-on');
    if (!keepSession) localStorage.removeItem(KEY);
  }

  // 저장하고 나가기: 지금 상태(답·시간·형광펜) 그대로 보관 → 나중에 이어서
  function suspend() {
    S.paused = true; S.suspended = true; S.suspendedAt = Date.now();
    save();
    const cb = onFinish;
    unmount(true);
    cb && cb('suspended');
  }

  async function finish() {
    const now = Date.now();
    if (S.phase === 'test') S.used[S.mi] = usedNow();
    const items = [];
    S.modules.forEach(m => m.qids.forEach(qid => {
      const q = Q[qid] || {};
      const resp = S.responses[qid] ?? '';
      items.push({
        qid, test: q.test, domain: q.domain, skill: q.skill, difficulty: q.difficulty, type: q.type,
        response: resp, answer: q.answer, correct: U.isCorrect(q, resp),
        timeSpent: Math.round(S.spent[qid] || 0), marked: !!S.marked[qid],
        hl: highlightsOf(qid),
        ask: S.ask && S.ask[qid] ? true : undefined,
        guess: S.guess && S.guess[qid] ? true : undefined,
      });
    }));
    const attempt = {
      date: S.date, createdAt: S.startedAt, finishedAt: now,
      modules: S.modules.map((m, i) => ({ test: m.test, limit: timed() ? m.limit : 0, used: Math.round(S.used[i] ?? 0), count: m.qids.length })),
      items, violations: S.violations, mock: S.mock,
    };
    let aid;
    // 인터넷이 끊겨 있으면 결과를 이 기기에 임시 보관했다가 연결되면 자동으로 올림
    if (navigator.onLine === false) aid = Store.queueAttempt(attempt);
    else {
      try { aid = await Store.put('attempts', attempt); }
      catch (e) { console.error(e); aid = Store.queueAttempt(attempt); }
    }
    const cb = onFinish;
    unmount();
    cb && cb(aid);
  }

  // 이 문제에서 칠한 형광펜(텍스트: 칠한 HTML, 이미지: 사각형) — 풀이 기록에 함께 저장
  function highlightsOf(qid) {
    const out = {};
    for (const [k, v] of Object.entries(S.th || {})) {
      const [id, key] = k.split('|');
      if (id === qid && /<mark class="hl/.test(v)) out[key] = v;
    }
    if ((S.hl[qid] || []).length) out.rects = S.hl[qid];
    return Object.keys(out).length ? out : undefined;
  }

  function abandon() { unmount(); onFinish && onFinish(null); }

  const timed = () => S.timed !== false;
  // 이 모듈에서 쓴 시간(초)
  const usedNow = () => { const u = (Date.now() - cur().startAt) / 1000; return timed() ? Math.min(cur().limit, u) : u; };
  // 타이머 표시값: 시간 재기 = 남은 시간, 안 재기 = 지난 시간
  const timerSecs = () => (timed() ? (S.endAt - Date.now()) / 1000 : (Date.now() - cur().startAt) / 1000);

  function endModule() {
    S.used[S.mi] = usedNow();
    closePops();
    if (S.mi < S.modules.length - 1) { S.phase = 'transition'; save(); render(); }
    else finish();
  }

  function nextModule() {
    S.mi++; S.qi = 0; S.review = false; S.phase = 'test'; S.warned5 = false;
    const now = Date.now();
    cur().startAt = now;
    S.endAt = now + cur().limit * 1000;
    ui.dir = true; ui.calc = false; ui.ref = false; ui.highlight = false;
    save(); render();
  }

  /* ---------- 타이머 ---------- */
  function tick() {
    const now = Date.now();
    if (gateOpen || S.paused) { // 전체화면 대기·일시정지 중에는 시간을 멈춤
      if (S.phase === 'test') { const d = now - lastTick; S.endAt += d; cur().startAt += d; }
      lastTick = now;
      return;
    }
    if (S.phase === 'test') {
      if (!S.review) { const id = curQid(); S.spent[id] = (S.spent[id] || 0) + (now - lastTick) / 1000; }
      if (!timed()) { updateTimer(timerSecs()); lastTick = now; if (now - lastSave > 2000) save(); return; }
      const rem = (S.endAt - now) / 1000;
      if (rem <= 300 && !S.warned5 && cur().limit > 300) {
        S.warned5 = true; ui.hideTimer = false;
        toast('5 minutes remaining in this module.');
      }
      updateTimer(rem);
      if (rem <= 0) { lastTick = now; endModule(); return; }
    }
    lastTick = now;
    if (now - lastSave > 2000) save();
  }

  function updateTimer(rem) {
    const t = root && root.querySelector('.bb-timer');
    if (!t) return;
    t.textContent = U.mmss(timed() ? Math.ceil(rem) : Math.floor(rem));
    t.classList.toggle('low', rem <= 300);
    const hb = root.querySelector('.bb-hide');
    if (hb) hb.textContent = ui.hideTimer ? 'Show' : 'Hide';
    root.querySelector('.bb-timerbox').classList.toggle('hidden-t', ui.hideTimer);
  }

  /* ---------- 렌더링 ---------- */
  const modTitle = (m, i) => `Section ${m.sec || i + 1}, Module ${m.mod || 1}: ${U.TEST_NAME[m.test]}`;
  function sectionTitle() {
    return modTitle(cur(), S.mi);
  }

  function img(blob, cls = '') {
    return blob ? `<img class="qimg ${cls}" draggable="false" src="${U.url(blob)}" alt="">` : '';
  }

  // 한 화면(오른쪽 문제·선택지 / 왼쪽 지문)의 이미지들을 같은 배율로 맞춰 글자 크기를 통일
  function fitImages() {
    if (!root) return;
    const imgs = [...root.querySelectorAll('.qimg')];
    Promise.all(imgs.map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })))).then(() => {
      if (!root) return;
      const z = U.zoom();
      const groups = [root.querySelectorAll('.bb-left .qimg'), root.querySelectorAll('.bb-right .qimg, .bb-single .qimg')];
      for (const g of groups) {
        const list = [...g].filter(i => i.naturalWidth);
        let s = 1;
        for (const im of list) {
          const box = im.closest('.bb-ctext, .bb-prompt, .bb-stem, .bb-pane-inner, .bb-single-inner');
          if (!box) continue;
          const cs = getComputedStyle(box);
          const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          if (avail > 0) s = Math.min(s, avail / (im.naturalWidth * z));
        }
        // 아주 긴 한 줄 때문에 전체가 작아지지 않도록 최소 배율 유지 (넘치는 이미지만 따로 줄어듦)
        s = Math.max(s, 0.8);
        list.forEach(im => { im.style.width = Math.floor(im.naturalWidth * z * s) + 'px'; });
      }
    });
  }
  let fitTimer = null;
  const onResize = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitImages, 120); };

  // 텍스트 문제: 형광펜 칠한 상태(HTML)를 문제·부분별로 저장
  function qtext(qid, key, html, extra = '') {
    const saved = S.th && S.th[qid + '|' + key];
    return `<div class="q-text q-${key} ${extra}" data-qid="${U.esc(qid)}" data-key="${key}">${saved != null ? saved : html || ''}</div>`;
  }

  function hlWrap(qid, blob) {
    if (!blob) return '';
    const marks = (S.hl[qid] || []).map((r, i) =>
      `<div class="hl-mark c-${r.c || 'yellow'}" data-i="${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></div>`).join('');
    return `<div class="hl-wrap" data-qid="${U.esc(qid)}">${img(blob)}${marks}</div>`;
  }

  function render() {
    if (!root) return;
    const keep = [...root.querySelectorAll('.bb-lock')];
    renderInner();
    keep.forEach(l => root.appendChild(l));
  }

  function renderInner() {
    const m = cur();
    const isMath = m.test === 'MATH';
    const trans = S.phase === 'transition';
    root.innerHTML = `
      <header class="bb-head">
        <div class="bb-head-left">
          <div class="bb-sec-title">${trans ? 'Module Complete' : sectionTitle()}</div>
          ${trans ? '' : `<button class="bb-directions" data-act="dir">Directions ${ui.dir ? ICON.chevUp : ICON.chevDown}</button>`}
        </div>
        <div class="bb-head-center">
          ${trans ? '' : `<div class="bb-timerbox ${ui.hideTimer ? 'hidden-t' : ''}"><div class="bb-timer ${timed() ? '' : 'untimed'}" title="${timed() ? '남은 시간' : '시간 제한 없음 · 지난 시간'}">--:--</div><span class="bb-clock">${ICON.clock}</span></div>
          <button class="bb-hide" data-act="hide">${ui.hideTimer ? 'Show' : 'Hide'}</button>`}
        </div>
        <div class="bb-head-right">
          ${trans ? '' : `
          ${isMath ? `<button class="bb-tool ${ui.calc ? 'on' : ''}" data-act="calc">${ICON.calc}<span>Calculator</span></button>
          <button class="bb-tool ${ui.ref ? 'on' : ''}" data-act="ref">${ICON.ref}<span>Reference</span></button>` : ''}
          <button class="bb-tool" data-act="pause" title="일시정지 (타이머 멈춤)">${ICON.pause}<span>Pause</span></button>
          <button class="bb-tool ${ui.highlight ? 'on' : ''}" data-act="highlight">${ICON.pen}<span>Highlights &amp; Notes</span></button>
          <div class="bb-more-wrap">
            <button class="bb-tool" data-act="more">${ICON.dots}<span>More</span></button>
            ${ui.more ? `<div class="bb-menu">
              <button data-act="pause">Pause <small>일시정지 · 타이머 멈춤</small></button>
              <button data-act="suspend">Save and Exit <small>저장하고 나가기 · 나중에 이어서 풀기</small></button>
              <button data-act="submit-now">Submit and Exit <small>지금 제출하고 채점</small></button>
              <button data-act="quit">Exit Without Saving <small>기록 없이 종료</small></button>
            </div>` : ''}
          </div>`}
        </div>
      </header>
      <div class="bb-dash"></div>
      <main class="bb-main ${ui.highlight ? 'hl-mode' : ''}">${trans ? transitionHTML() : S.review ? reviewHTML() : questionHTML()}</main>
      <div class="bb-dash"></div>
      <footer class="bb-foot">
        <div class="bb-name">${U.esc(S.name)}</div>
        <div class="bb-foot-center">${trans || S.review ? '' : `<button class="bb-qnav" data-act="nav">Question ${S.qi + 1} of ${m.qids.length} ${ui.nav ? ICON.chevDown : ICON.chevUp}</button>`}</div>
        <div class="bb-navbtns">
          ${trans ? '' : (S.qi > 0 || S.review) ? '<button class="bb-btn" data-act="back">Back</button>' : ''}
          ${trans ? '<button class="bb-btn" data-act="next-module">Continue</button>' : '<button class="bb-btn" data-act="next">Next</button>'}
        </div>
      </footer>
      ${ui.nav && !trans && !S.review ? navHTML() : ''}
      ${ui.dir && !trans ? directionsHTML() : ''}
      ${ui.calc && isMath && !trans ? calcHTML() : ''}
      ${ui.ref && isMath && !trans ? refHTML() : ''}
      ${ui.modal ? modalHTML(ui.modal) : ''}
      ${S.paused ? `<div class="bb-pause" role="dialog" aria-label="일시정지">
        <div class="bb-lock-card">
          <div class="bb-pause-icon">${ICON.pause}</div>
          <h2>일시정지됨</h2>
          <p class="sub">타이머가 멈춰 있고, 문제는 가려져 있습니다.<br>일시정지 중에는 다른 탭으로 가도 이탈로 기록되지 않아요.</p>
          <div class="bb-pause-btns">
            <button class="bb-btn" data-act="unpause">계속 풀기</button>
            <button class="bb-btn ghost" data-act="suspend">저장하고 나가기</button>
          </div>
          <p class="sub sm">저장하고 나가면 문제은행 화면 위에서 이어서 풀 수 있어요.</p>
        </div>
      </div>` : ''}
      ${ui.highlight && !trans && !S.review ? `<div class="hl-palette" role="toolbar" aria-label="형광펜 색">
        ${HL_COLORS.map(([c, l]) => `<button class="sw ${c} ${ui.hlColor === c ? 'on' : ''}" data-act="hlc" data-c="${c}" title="${l}" aria-label="${l}"></button>`).join('')}
        <span class="hl-tip">${ui.hlColor === 'red' ? '빨강: 모르는 단어 → 영단어장에 저장' : '드래그해서 칠하기 · 칠한 곳 클릭하면 지우기'}</span>
      </div>` : ''}
    `;
    if (!trans) updateTimer(timerSecs());
    fitImages();
    if (ui.calc && isMath && !trans) mountCalc();
    setupDrag();
  }

  function qHeader(n, qid, q) {
    return `<div class="bb-qhead">
      <div class="bb-qnum">${n}</div>
      <button class="bb-mark ${S.marked[qid] ? 'on' : ''}" data-act="mark">${ICON.bookmark}<span>Mark for Review</span></button>
      <label class="bb-guess ${S.guess && S.guess[qid] ? 'on' : ''}" title="확실하지 않아서 찍었다면 체크 — 맞아도 오답노트에 들어갑니다"><input type="checkbox" data-act="guess" ${S.guess && S.guess[qid] ? 'checked' : ''}><span>찍음</span></label>
      <label class="bb-ask ${S.ask && S.ask[qid] ? 'on' : ''}" title="체크하면 질문노트에 들어갑니다"><input type="checkbox" data-act="ask" ${S.ask && S.ask[qid] ? 'checked' : ''}><span>선생님께 질문</span></label>
      ${q.type === 'mcq' ? `<button class="bb-abc ${ui.crossOut ? 'on' : ''}" data-act="crossout" title="Cross out answer choices"><span>ABC</span></button>` : ''}
    </div>
    ${S.ask && S.ask[qid] ? `<input class="bb-asknote" data-qid="${U.esc(qid)}" value="${U.esc((S.askNote || {})[qid] || '')}" placeholder="무엇을 물어볼지 메모 (선택) — 질문노트에 함께 저장돼요" maxlength="300">` : ''}`;
  }

  function choicesHTML(qid, q) {
    const sel = S.responses[qid];
    const el = S.elim[qid] || {};
    return `<div class="bb-choices">${['A', 'B', 'C', 'D'].map((L, i) => `
      <div class="bb-crow ${sel === L ? 'sel' : ''} ${el[L] ? 'elim' : ''}">
        <div class="bb-choice" role="button" tabindex="0" data-act="choose" data-l="${L}">
          <span class="bb-letter">${L}</span>
          <span class="bb-ctext">${q.kind === 'html' ? qtext(qid, 'c' + i, (q.choices || [])[i] || '', 'q-choice') : img(q.choiceImgs && q.choiceImgs[i])}</span>
        </div>
        ${ui.crossOut ? (el[L]
          ? `<button class="bb-undo" data-act="elim" data-l="${L}">Undo</button>`
          : `<button class="bb-elim" data-act="elim" data-l="${L}" title="Cross out ${L}"><span>${L}</span></button>`) : ''}
      </div>`).join('')}</div>`;
  }

  function questionHTML() {
    const qid = curQid();
    const q = Q[qid];
    const n = S.qi + 1;
    if (!q) return `<div class="bb-single"><div class="bb-single-inner"><p>문제를 불러올 수 없습니다 (ID ${U.esc(qid)}).</p></div></div>`;
    const right = (top) => `${qHeader(n, qid, q)}${top}${q.type === 'mcq' ? choicesHTML(qid, q) : sprHTML(qid)}`;
    if (q.kind === 'html') {
      const split = (left, top) => `<div class="bb-split">
        <div class="bb-pane bb-left" style="flex-basis:${ui.split}%"><div class="bb-pane-inner">${left}</div></div>
        <div class="bb-divider" data-drag="split"><span class="bb-grip"></span></div>
        <div class="bb-pane bb-right"><div class="bb-pane-inner bb-right-inner">${right(top)}</div></div>
      </div>`;
      if (q.type === 'spr') return split(sprDirections(), qtext(qid, 'stem', q.stem));
      if (q.stim) return split(qtext(qid, 'stim', q.stim), qtext(qid, 'stem', q.stem));
      return `<div class="bb-single"><div class="bb-single-inner">${qHeader(n, qid, q)}${qtext(qid, 'stem', q.stem)}${choicesHTML(qid, q)}</div></div>`;
    }
    if (q.test === 'MATH' && q.type === 'mcq') {
      return `<div class="bb-single"><div class="bb-single-inner">${qHeader(n, qid, q)}<div class="bb-stem">${hlWrap(qid, q.stemImg)}</div>${choicesHTML(qid, q)}</div></div>`;
    }
    let leftHTML, top;
    if (q.test === 'MATH') { // 주관식(SPR)
      leftHTML = sprDirections();
      top = `<div class="bb-stem">${hlWrap(qid, q.stemImg)}</div>`;
    } else if (q.passageImg && q.promptImg) {
      leftHTML = hlWrap(qid, q.passageImg);
      top = `<div class="bb-prompt">${img(q.promptImg)}</div>`;
    } else {
      leftHTML = hlWrap(qid, q.stemImg);
      top = '';
    }
    return `<div class="bb-split">
      <div class="bb-pane bb-left" style="flex-basis:${ui.split}%"><div class="bb-pane-inner">${leftHTML}</div></div>
      <div class="bb-divider" data-drag="split"><span class="bb-grip"></span></div>
      <div class="bb-pane bb-right"><div class="bb-pane-inner bb-right-inner">${right(top)}</div></div>
    </div>`;
  }

  function sprHTML(qid) {
    const v = S.responses[qid] || '';
    return `<div class="bb-spr">
      <input class="bb-spr-input" data-qid="${U.esc(qid)}" value="${U.esc(v)}" autocomplete="off" spellcheck="false" inputmode="text">
      <div class="bb-preview">Answer Preview: <b>${previewHTML(v)}</b></div>
    </div>`;
  }

  function previewHTML(v) {
    const f = String(v).match(/^(-?)(\d*\.?\d+)\/(\d*\.?\d+)$/);
    if (f) return `${f[1] ? '&minus;' : ''}<span class="frac"><span>${f[2]}</span><span>${f[3]}</span></span>`;
    return U.esc(v).replace(/^-/, '&minus;');
  }

  function sprDirections() {
    return `<div class="bb-sprdir">
      <h3>Student-produced response directions</h3>
      <ul>
        <li>If you find <b>more than one correct answer</b>, enter only one answer.</li>
        <li>You can enter up to 5 characters for a <b>positive</b> answer and up to 6 characters (including the negative sign) for a <b>negative</b> answer.</li>
        <li>If your answer is a <b>fraction</b> that doesn't fit in the provided space, enter the decimal equivalent.</li>
        <li>If your answer is a <b>decimal</b> that doesn't fit in the provided space, enter it by truncating or rounding at the fourth digit.</li>
        <li>If your answer is a <b>mixed number</b> (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>
        <li>Don't enter <b>symbols</b> such as a percent sign, comma, or dollar sign.</li>
      </ul>
      <table class="bb-sprtable">
        <tr><th>Answer</th><th>Acceptable ways to enter answer</th><th>Unacceptable: will NOT receive credit</th></tr>
        <tr><td>3.5</td><td>3.5<br>3.50<br>7/2</td><td>31/2<br>3 1/2</td></tr>
        <tr><td>2/3</td><td>2/3<br>.6666<br>.6667<br>0.666<br>0.667</td><td>0.66<br>.66<br>0.67<br>.67</td></tr>
        <tr><td>−1/3</td><td>−1/3<br>−.3333<br>−0.333</td><td>−.33<br>−0.33</td></tr>
      </table>
    </div>`;
  }

  function navHTML() {
    const m = cur();
    return `<div class="bb-navpop">
      <div class="bb-navpop-head"><span>${sectionTitle()} Questions</span><button class="bb-x" data-act="nav">${ICON.close}</button></div>
      <div class="bb-legend"><span>${ICON.pin} Current</span><span><i class="lg-un"></i> Unanswered</span><span>${ICON.flag} For Review</span></div>
      <div class="bb-grid">${gridHTML(true)}</div>
      <button class="bb-gotoreview" data-act="review">Go to Review Page</button>
      <i class="bb-navpop-arrow"></i>
    </div>`;
  }

  function gridHTML(showCur) {
    return cur().qids.map((id, i) => {
      const ans = S.responses[id] != null && S.responses[id] !== '';
      return `<button class="bb-cell ${ans ? 'ans' : ''}" data-act="goto" data-i="${i}">
        ${showCur && i === S.qi ? `<span class="c-pin">${ICON.pin}</span>` : ''}
        ${S.marked[id] ? `<span class="c-flag">${ICON.flag}</span>` : ''}${i + 1}</button>`;
    }).join('');
  }

  function reviewHTML() {
    const m = cur();
    const answered = m.qids.filter(id => S.responses[id] != null && S.responses[id] !== '').length;
    return `<div class="bb-review">
      <h1>Check Your Work</h1>
      <p>Select any question number to go back to it. When you're ready, select <b>Next</b> to submit this module.<br>
      <span class="sub">${answered} of ${m.qids.length} answered</span></p>
      <div class="bb-revcard">
        <div class="bb-revcard-head"><span>${sectionTitle()} Questions</span>
          <div class="bb-legend"><span><i class="lg-un"></i> Unanswered</span><span>${ICON.flag} For Review</span></div></div>
        <div class="bb-grid">${gridHTML(false)}</div>
      </div>
    </div>`;
  }

  function transitionHTML() {
    const nm = S.modules[S.mi + 1];
    return `<div class="bb-review bb-trans">
      <h1>This module is complete</h1>
      <p>Your answers for <b>${U.TEST_NAME[cur().test]}</b> have been saved.</p>
      <div class="bb-revcard">
        <p class="t-next">Up next: <b>${modTitle(nm, S.mi + 1)}</b></p>
        <p class="t-next">${nm.qids.length} questions · ${timed() ? U.mmss(nm.limit) : 'No time limit'}</p>
        <p class="sub">Select <b>Continue</b> when you're ready.${timed() ? ' The timer starts immediately.' : ''}</p>
      </div>
    </div>`;
  }

  function directionsHTML() {
    const isMath = cur().test === 'MATH';
    const body = isMath
      ? `<p>The questions in this section cover a range of important math skills.</p>
         <p>You may use a calculator for every question. For each multiple-choice question, choose the single best answer. For each student-produced response question, enter your answer in the box provided.</p>
         <p>Unless otherwise noted: all variables and expressions are real numbers, figures are drawn to scale and lie in a plane, and the domain of any function f is the set of all real numbers x for which f(x) is a real number.</p>
         <p>Open <b>Reference</b> in the toolbar for common formulas.</p>`
      : `<p>The questions in this section assess key reading and writing skills.</p>
         <p>Each question comes with one or more short passages, which may include a table or graph. Read each passage and question carefully, then select the best answer based on the passage(s).</p>
         <p>All questions in this section are multiple-choice with four answer choices, and each has a single best answer.</p>`;
    return `<div class="bb-dirpop">
      <div class="bb-dirpop-body">${body}
      <p class="bb-meta">${cur().qids.length} questions · ${timed() ? `${U.mmss(cur().limit)} (실제 SAT 시간 비율로 자동 계산)` : '시간 제한 없음 (걸린 시간만 기록)'}</p></div>
      <div class="bb-dirpop-foot"><button class="bb-btn" data-act="dir">Close</button></div>
    </div>`;
  }

  function calcHTML() {
    return `<div class="bb-float bb-calc" style="left:${ui.calcX ?? 24}px;top:${ui.calcY ?? 90}px">
      <div class="bb-float-head" data-drag="calc"><span>Calculator</span><button class="bb-x" data-act="calc">${ICON.close}</button></div>
      <div id="calc-host" class="bb-desmos"></div>
    </div>`;
  }

  function refHTML() {
    return `<div class="bb-float bb-ref" style="left:${ui.refX ?? 'auto'}px;top:${ui.refY ?? 90}px;${ui.refX == null ? 'right:24px;left:auto' : ''}">
      <div class="bb-float-head" data-drag="ref"><span>Reference</span><button class="bb-x" data-act="ref">${ICON.close}</button></div>
      <div class="bb-ref-body">
        <div class="ref-grid">
          <div><svg viewBox="0 0 80 60"><circle cx="40" cy="30" r="22" fill="none" stroke="#000"/><line x1="40" y1="30" x2="62" y2="30" stroke="#000"/><text x="49" y="27" font-size="8" font-style="italic">r</text></svg><p>A = πr²<br>C = 2πr</p></div>
          <div><svg viewBox="0 0 80 60"><rect x="10" y="15" width="60" height="30" fill="none" stroke="#000"/><text x="38" y="12" font-size="8" font-style="italic">ℓ</text><text x="73" y="33" font-size="8" font-style="italic">w</text></svg><p>A = ℓw</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M8 50h64L30 12z" fill="none" stroke="#000"/><line x1="30" y1="12" x2="30" y2="50" stroke="#000" stroke-dasharray="2"/><text x="32" y="35" font-size="8" font-style="italic">h</text><text x="38" y="58" font-size="8" font-style="italic">b</text></svg><p>A = ½bh</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M12 50h50V12z" fill="none" stroke="#000"/><text x="34" y="58" font-size="8" font-style="italic">a</text><text x="65" y="33" font-size="8" font-style="italic">b</text><text x="30" y="28" font-size="8" font-style="italic">c</text></svg><p>c² = a² + b²</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M10 50h52V14z" fill="none" stroke="#000"/><text x="28" y="58" font-size="7">x√3</text><text x="64" y="34" font-size="7">x</text><text x="26" y="28" font-size="7">2x</text><text x="15" y="47" font-size="6">30°</text><text x="54" y="22" font-size="6">60°</text></svg><p>Special Right Triangles</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M14 50h40V10z" fill="none" stroke="#000"/><text x="30" y="58" font-size="7">s</text><text x="57" y="32" font-size="7">s</text><text x="22" y="28" font-size="7">s√2</text><text x="19" y="47" font-size="6">45°</text><text x="46" y="20" font-size="6">45°</text></svg><p>&nbsp;</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M12 25h40v28H12zM12 25l14-12h40L52 25M66 13v28L52 53" fill="none" stroke="#000"/><text x="28" y="60" font-size="7" font-style="italic">ℓ</text><text x="60" y="52" font-size="7" font-style="italic">w</text><text x="3" y="42" font-size="7" font-style="italic">h</text></svg><p>V = ℓwh</p></div>
          <div><svg viewBox="0 0 80 60"><ellipse cx="40" cy="14" rx="18" ry="5" fill="none" stroke="#000"/><path d="M22 14v32M58 14v32" stroke="#000"/><path d="M22 46a18 5 0 0 0 36 0" fill="none" stroke="#000"/><text x="62" y="34" font-size="7" font-style="italic">h</text><text x="44" y="12" font-size="7" font-style="italic">r</text></svg><p>V = πr²h</p></div>
          <div><svg viewBox="0 0 80 60"><circle cx="40" cy="30" r="22" fill="none" stroke="#000"/><ellipse cx="40" cy="30" rx="22" ry="6" fill="none" stroke="#000" stroke-dasharray="2"/><text x="46" y="28" font-size="7" font-style="italic">r</text></svg><p>V = <sup>4</sup>⁄<sub>3</sub>πr³</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M40 6L22 48M40 6l18 42" stroke="#000" fill="none"/><ellipse cx="40" cy="48" rx="18" ry="5" fill="none" stroke="#000"/><line x1="40" y1="6" x2="40" y2="48" stroke="#000" stroke-dasharray="2"/><text x="42" y="32" font-size="7" font-style="italic">h</text></svg><p>V = <sup>1</sup>⁄<sub>3</sub>πr²h</p></div>
          <div><svg viewBox="0 0 80 60"><path d="M40 6L14 46h40l12-12zM40 6l26 28M40 6l14 40" stroke="#000" fill="none"/><text x="30" y="56" font-size="7" font-style="italic">ℓ</text><text x="62" y="46" font-size="7" font-style="italic">w</text></svg><p>V = <sup>1</sup>⁄<sub>3</sub>ℓwh</p></div>
        </div>
        <p class="ref-note">The number of degrees of arc in a circle is 360.<br>The number of radians of arc in a circle is 2π.<br>The sum of the measures in degrees of the angles of a triangle is 180.</p>
      </div>
    </div>`;
  }

  function modalHTML(mo) {
    return `<div class="bb-modal-bg"><div class="bb-modal">
      <h2>${mo.title}</h2><p>${mo.body}</p>
      <div class="bb-modal-btns">
        <button class="bb-btn ghost" data-act="modal-cancel">${mo.cancel || 'Cancel'}</button>
        <button class="bb-btn" data-act="modal-ok">${mo.ok || 'OK'}</button>
      </div></div></div>`;
  }

  function toast(msg) {
    if (!root) return;
    const t = document.createElement('div');
    t.className = 'bb-toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  /* ---------- 계산기 ---------- */
  function mountCalc() {
    const host = root.querySelector('#calc-host');
    if (host) Calc.mount(host);
  }

  /* ---------- 이벤트 ---------- */
  function closePops() { ui.nav = false; ui.more = false; }

  function go(i) {
    S.qi = Math.max(0, Math.min(cur().qids.length - 1, i));
    S.review = false;
    closePops(); save(); render();
    root.querySelector('.bb-pane-inner, .bb-single')?.scrollTo?.(0, 0);
  }

  function onClick(e) {
    // 형광펜 모드에서 칠한 부분을 클릭하면 지움
    const mk = ui.highlight && e.target.closest('mark.hl');
    if (mk) {
      const box = mk.closest('.q-text');
      const parent = mk.parentNode;
      while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
      mk.remove(); parent.normalize();
      if (box) saveText(box);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) {
      if (ui.more && !e.target.closest('.bb-menu')) { ui.more = false; render(); }
      return;
    }
    const act = b.dataset.act;
    const qid = S.phase === 'test' ? curQid() : null;
    switch (act) {
      case 'choose': {
        if (Date.now() - justHL < 400) break; // 형광펜으로 드래그한 직후의 클릭은 답 선택이 아님
        const L = b.dataset.l;
        if (S.elim[qid] && S.elim[qid][L]) delete S.elim[qid][L];
        S.responses[qid] = S.responses[qid] === L ? S.responses[qid] : L;
        save(); render(); break;
      }
      case 'elim': {
        const L = b.dataset.l;
        S.elim[qid] = S.elim[qid] || {};
        if (S.elim[qid][L]) delete S.elim[qid][L];
        else { S.elim[qid][L] = true; if (S.responses[qid] === L) delete S.responses[qid]; }
        save(); render(); break;
      }
      case 'crossout': ui.crossOut = !ui.crossOut; render(); break;
      case 'hlc': ui.hlColor = b.dataset.c; render(); break;
      case 'guess': {
        S.guess = S.guess || {};
        if (b.checked) S.guess[qid] = true; else delete S.guess[qid];
        save(); render(); break;
      }
      case 'ask': {
        S.ask = S.ask || {}; S.askNote = S.askNote || {};
        const on = b.checked;
        if (on) S.ask[qid] = true; else delete S.ask[qid];
        save(); render();
        try { onAsk && onAsk(qid, on, S.askNote[qid] || ''); } catch (e) {}
        if (on) toast('질문노트에 추가했어요');
        break;
      }
      case 'pause': ui.more = false; S.paused = true; save(); render(); break;
      case 'unpause': S.paused = false; lastTick = Date.now(); save(); render(); break;
      case 'suspend': ui.more = false; suspend(); break;
      case 'mark': S.marked[qid] = !S.marked[qid]; if (!S.marked[qid]) delete S.marked[qid]; save(); render(); break;
      case 'next':
        if (S.review) {
          ui.modal = { kind: 'submit', title: 'Submit this module?', body: S.mi < S.modules.length - 1 ? '이 모듈을 제출하고 다음 섹션으로 넘어갑니다. 제출 후에는 이 모듈로 돌아올 수 없습니다.' : '시험을 제출하고 채점합니다. 제출 후에는 답을 바꿀 수 없습니다.', ok: 'Submit' };
          render();
        } else if (S.qi < cur().qids.length - 1) go(S.qi + 1);
        else { S.review = true; closePops(); save(); render(); }
        break;
      case 'back':
        if (S.review) { S.review = false; S.qi = cur().qids.length - 1; save(); render(); }
        else go(S.qi - 1);
        break;
      case 'nav': ui.nav = !ui.nav; ui.more = false; render(); break;
      case 'goto': go(+b.dataset.i); break;
      case 'review': S.review = true; closePops(); save(); render(); break;
      case 'hide': ui.hideTimer = !ui.hideTimer; updateTimer(timerSecs()); break;
      case 'dir': ui.dir = !ui.dir; closePops(); render(); break;
      case 'highlight': ui.highlight = !ui.highlight; render(); break;
      case 'calc': ui.calc = !ui.calc; render(); break;
      case 'ref': ui.ref = !ui.ref; render(); break;
      case 'more': ui.more = !ui.more; ui.nav = false; render(); break;
      case 'submit-now':
        ui.more = false;
        ui.modal = { kind: 'submit-all', title: 'Submit and exit?', body: '지금까지 푼 답으로 채점하고 기록을 저장합니다. 남은 모듈은 풀지 않은 것으로 처리됩니다.', ok: 'Submit' };
        render(); break;
      case 'quit':
        ui.more = false;
        ui.modal = { kind: 'quit', title: 'Exit without saving?', body: '이번 풀이는 기록에 저장되지 않습니다.', ok: 'Exit' };
        render(); break;
      case 'modal-cancel': ui.modal = null; render(); break;
      case 'modal-ok': {
        const k = ui.modal.kind; ui.modal = null;
        if (k === 'submit') endModule();
        else if (k === 'submit-all') { if (S.phase === 'test') S.used[S.mi] = usedNow(); S.phase = 'done'; finish(); }
        else if (k === 'quit') abandon();
        break;
      }
      case 'next-module': nextModule(); break;
      case 'refocus': hideLock(); enterFs(); break;
      case 'gate': enterFs().then(ok => {
        if (ok || !fsSupported()) { hideGate(); return; }
        // 브라우저가 전체화면을 거부한 경우(일부 앱·임베드 화면): 막히지 않게 그냥 시작할 수 있게 함
        const g = root.querySelector('.bb-gate .bb-lock-card');
        if (g) g.innerHTML = `<h2>이 화면에서는 전체화면을 쓸 수 없어요</h2>
          <p class="sub">브라우저가 전체화면을 막았습니다. 크롬에서 직접 열면 전체화면으로 진행됩니다. 지금은 전체화면 없이 시작할 수 있고, 다른 탭 이동은 계속 기록됩니다.</p>
          <button class="bb-btn" data-act="gate-skip">전체화면 없이 시작</button>`;
      }); break;
      case 'gate-skip': hideGate(); break;
    }
  }

  let askTimer = null;
  function onInput(e) {
    const t = e.target;
    if (t.classList.contains('bb-asknote')) {
      S.askNote = S.askNote || {};
      S.askNote[t.dataset.qid] = t.value;
      save();
      clearTimeout(askTimer);
      askTimer = setTimeout(() => { try { onAsk && onAsk(t.dataset.qid, true, t.value); } catch (er) {} }, 800);
      return;
    }
    if (!t.classList.contains('bb-spr-input')) return;
    let v = t.value.replace(/[^0-9./-]/g, '');
    v = v.replace(/(?!^)-/g, '');
    const max = v.startsWith('-') ? 6 : 5;
    if (v.length > max) v = v.slice(0, max);
    if (v !== t.value) t.value = v;
    if (v) S.responses[t.dataset.qid] = v; else delete S.responses[t.dataset.qid];
    const p = root.querySelector('.bb-preview b');
    if (p) p.innerHTML = previewHTML(v);
    save();
  }

  let justHL = 0;
  function saveText(box) {
    S.th = S.th || {};
    S.th[box.dataset.qid + '|' + box.dataset.key] = box.innerHTML;
    save();
  }

  // 글자 드래그 → 형광펜 (MathML·도형 안쪽은 건너뜀)
  function onMouseUp() {
    if (!ui.highlight) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const box = anc && anc.closest('.q-text');
    if (!box) { sel.removeAllRanges(); return; }
    const picked = sel.toString();
    const color = ui.hlColor || 'yellow';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue.trim() && range.intersectsNode(n) && !n.parentElement.closest('math, svg, mark.hl')) nodes.push(n);
    }
    for (const n of nodes) {
      const start = n === range.startContainer ? range.startOffset : 0;
      const end = n === range.endContainer ? range.endOffset : n.nodeValue.length;
      if (end <= start) continue;
      const mid = start > 0 ? n.splitText(start) : n;
      if (end - start < mid.nodeValue.length) mid.splitText(end - start);
      const mark = document.createElement('mark');
      mark.className = 'hl hl-' + color;
      mid.parentNode.insertBefore(mark, mid);
      mark.appendChild(mid);
    }
    sel.removeAllRanges();
    if (nodes.length) { saveText(box); justHL = Date.now(); }
    // 빨간색 = 모르는 단어 → 영단어장에 문장과 함께 저장
    if (nodes.length && color === 'red' && typeof Vocab !== 'undefined') {
      const block = (nodes[0].parentElement && nodes[0].parentElement.closest('p, li, td')) || box;
      Vocab.capture(picked, block.textContent, box.dataset.qid)
        .then(v => { if (v) toast(`영단어장에 추가: ${v.word}`); })
        .catch(e => console.error(e));
    }
  }

  // 형광펜 / 패널 드래그 / 분할선
  function onPointerDown(e) {
    const drag = e.target.closest('[data-drag]');
    if (drag && !e.target.closest('[data-act]')) return startDrag(e, drag.dataset.drag);
    if (!ui.highlight) return;
    const mark = e.target.closest('.hl-mark');
    const wrap = e.target.closest('.hl-wrap');
    if (!wrap) return;
    const qid = wrap.dataset.qid;
    if (mark) { S.hl[qid].splice(+mark.dataset.i, 1); save(); render(); return; }
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    const box = document.createElement('div');
    box.className = 'hl-mark drawing';
    wrap.appendChild(box);
    const mv = ev => {
      const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY);
      box.style.left = (x - r.left) + 'px'; box.style.top = (y - r.top) + 'px';
      box.style.width = Math.abs(ev.clientX - x0) + 'px'; box.style.height = Math.abs(ev.clientY - y0) + 'px';
    };
    const up = ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      const w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0);
      if (w > 6 && h > 4) {
        (S.hl[qid] = S.hl[qid] || []).push({
          x: (Math.min(x0, ev.clientX) - r.left) / r.width, y: (Math.min(y0, ev.clientY) - r.top) / r.height,
          w: w / r.width, h: h / r.height, c: ui.hlColor || 'yellow',
        });
        save();
      }
      render();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  function startDrag(e, kind) {
    e.preventDefault();
    if (kind === 'split') {
      const split = root.querySelector('.bb-split');
      const left = root.querySelector('.bb-left');
      const r = split.getBoundingClientRect();
      const mv = ev => {
        ui.split = Math.max(20, Math.min(80, ((ev.clientX - r.left) / r.width) * 100));
        left.style.flexBasis = ui.split + '%';
      };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); fitImages(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      return;
    }
    const panel = e.target.closest('.bb-float');
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = ev => {
      const x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto';
      ui[kind + 'X'] = x; ui[kind + 'Y'] = y;
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }
  function setupDrag() {}

  /* ---------- 화면 이탈 방지 ---------- */
  // 반드시 클릭 직후(사용자 동작 안에서) 호출해야 브라우저가 허용함
  function enterFs() {
    const el = document.documentElement;
    let p = null;
    try {
      if (!isFs()) {
        if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch (e) {}
    // 일부 화면에서는 요청이 끝나지 않으므로 1.5초 후엔 결과와 상관없이 진행
    const settled = Promise.race([Promise.resolve(p).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    return settled.then(async () => {
      try { if (isFs() && navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock(); } catch (e) {}
      return isFs();
    });
  }

  function violation(type) {
    if (!S || !root || gateOpen || S.paused) return;
    const now = Date.now();
    if (now - lastViolation > 1500) {
      S.violations.push({ type, at: now, q: S.phase === 'test' ? S.qi + 1 : null, module: S.mi });
      save();
    }
    lastViolation = now;
    showLock(type);
  }

  const V_TEXT = { 'tab-hidden': '다른 탭/앱으로 이동함', 'window-blur': '시험 창에서 벗어남', 'fullscreen-exit': '전체화면 종료', reload: '새로고침/재접속' };

  function showLock(type) {
    let lk = document.querySelector('.bb-lock:not(.bb-gate)');
    if (!lk) {
      lk = document.createElement('div');
      lk.className = 'bb-lock';
      root.appendChild(lk);
    }
    lk.innerHTML = `<div class="bb-lock-card">
      <div class="bb-lock-icon">!</div>
      <h2>시험 화면을 벗어났습니다</h2>
      <p>${V_TEXT[type] || type} · 이탈 기록 <b>${S.violations.filter(v => v.type !== 'reload').length}회</b></p>
      <p class="sub">시험 중에는 다른 탭이나 앱으로 이동할 수 없습니다. 이탈한 시간에도 타이머는 계속 흐르며, 모든 이탈은 결과에 기록됩니다.</p>
      <button class="bb-btn" data-act="refocus">시험으로 돌아가기</button>
    </div>`;
  }
  function hideLock() { document.querySelector('.bb-lock:not(.bb-gate)')?.remove(); }

  const H = {
    vis: () => { if (document.hidden) violation('tab-hidden'); },
    blur: () => { setTimeout(() => { if (!document.hasFocus()) violation('window-blur'); }, 150); },
    fs: () => {
      if (isFs()) { if (gateOpen) hideGate(); return; }
      if (!gateOpen) violation('fullscreen-exit');
    },
    key: e => {
      const inInput = e.target && e.target.matches && e.target.matches('input, textarea');
      const k = (e.key || '').toLowerCase();
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if (inInput && !e.altKey && ['a', 'c', 'v', 'x', 'z'].includes(k)) return;
        if (!e.altKey && ['=', '+', '-', '0'].includes(k)) return; // 브라우저 확대/축소는 허용
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (/^f\d+$/.test(k)) { e.preventDefault(); return; }
      if (k === 'escape') { if (ui.nav || ui.more || ui.dir || ui.modal) { closePops(); ui.dir = false; ui.modal = null; render(); } e.preventDefault(); return; }
      if ((k === 'enter' || k === ' ') && e.target.matches && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); return; }
      if (!inInput && S.phase === 'test' && !ui.modal && !S.paused && !document.querySelector('.bb-lock')) {
        if (e.key === 'ArrowRight') { root.querySelector('[data-act="next"]')?.click(); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { root.querySelector('[data-act="back"]')?.click(); e.preventDefault(); }
      }
    },
    ctx: e => { if (!e.target.matches || !e.target.matches('input')) e.preventDefault(); },
    copy: e => { if (!e.target.matches || !e.target.matches('input')) e.preventDefault(); },
    drag: e => e.preventDefault(),
    unload: e => { e.preventDefault(); e.returnValue = ''; return ''; },
    pop: () => { try { history.pushState({ exam: 1 }, '', location.href); } catch (e) {} violation('window-blur'); },
  };

  function addGuards() {
    document.addEventListener('visibilitychange', H.vis);
    window.addEventListener('blur', H.blur);
    document.addEventListener('fullscreenchange', H.fs);
    document.addEventListener('webkitfullscreenchange', H.fs);
    window.addEventListener('keydown', H.key, true);
    document.addEventListener('contextmenu', H.ctx);
    document.addEventListener('copy', H.copy);
    document.addEventListener('cut', H.copy);
    document.addEventListener('dragstart', H.drag);
    window.addEventListener('beforeunload', H.unload);
    try { history.pushState({ exam: 1 }, '', location.href); } catch (e) {}
    window.addEventListener('popstate', H.pop);
    window.addEventListener('resize', onResize);
  }
  function removeGuards() {
    document.removeEventListener('visibilitychange', H.vis);
    window.removeEventListener('blur', H.blur);
    document.removeEventListener('fullscreenchange', H.fs);
    document.removeEventListener('webkitfullscreenchange', H.fs);
    window.removeEventListener('keydown', H.key, true);
    document.removeEventListener('contextmenu', H.ctx);
    document.removeEventListener('copy', H.copy);
    document.removeEventListener('cut', H.copy);
    document.removeEventListener('dragstart', H.drag);
    window.removeEventListener('beforeunload', H.unload);
    window.removeEventListener('popstate', H.pop);
    window.removeEventListener('resize', onResize);
  }

  return { start, resume, pending, discard, enterFs, active: () => !!root };
})();
