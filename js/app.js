/* 문제은행 / 업로드 / 기록 / 오답노트 / 설정 */
const App = (() => {
  let questions = [], attempts = [], qmap = {}, status = {}, dupUploads = [];
  // 기본 문제(텍스트)로 들어간 PDF들 — 예전에 이 PDF로 올린 이미지 문제는 중복이라 숨김
  const BANK_SOURCES = ['sat reading 모든 문제 답.pdf', '문법 모든 문제 답.pdf', 'hard 모든 문제 답.pdf'];
  const sel = new Set();
  let bankLast = -1; // Shift+클릭 범위 선택의 시작 줄
  const F = { test: 'all', skills: new Set(), diff: new Set(), status: new Set(), src: 'all', q: '' };
  const srcBadge = q => q.bank
    ? '<span class="badge src-cb" title="College Board SAT Suite Question Bank 문제">CB Question Bank</span>'
    : '<span class="badge src-me" title="내가 PDF로 올린 문제">내 업로드</span>';
  const view = () => document.getElementById('view');
  const DIFF_ORDER = { Easy: 0, Medium: 1, Hard: 2, '': 3 };
  const DIFF_KO = { Easy: '쉬움', Medium: '보통', Hard: '어려움', '': '미지정' };
  const DOMAIN_ORDER = [];
  for (const t of ['RW', 'MATH']) for (const d of Object.keys(Parser.DOMAINS[t])) DOMAIN_ORDER.push(d);
  const SKILL_ORDER = [];
  for (const t of ['RW', 'MATH']) for (const d of Object.keys(Parser.DOMAINS[t])) SKILL_ORDER.push(...Parser.DOMAINS[t][d]);

  const guest = () => { try { return sessionStorage.getItem('sat-guest') === '1'; } catch (e) { return false; } };
  const settings = () => { try { return JSON.parse(localStorage.getItem('sat-settings') || '{}'); } catch (e) { return {}; } };
  const setSettings = s => { try { localStorage.setItem('sat-settings', JSON.stringify({ ...settings(), ...s })); } catch (e) {} };

  async function load() {
    const [own, bank] = await Promise.all([Store.all('questions'), Store.loadBank()]);
    attempts = await Store.all('attempts');
    // 기본 문제 + 내가 올리거나 수정한 문제(같은 ID면 내 것이 우선, hidden이면 숨김)
    const byId = {};
    bank.forEach(q => (byId[q.id] = q));
    dupUploads = bank.length ? own.filter(q => q.kind !== 'html' && BANK_SOURCES.includes((q.source || '').normalize('NFC'))) : [];
    const dupSet = new Set(dupUploads.map(q => q.id));
    own.filter(q => !dupSet.has(q.id)).forEach(q => { byId[q.id] = q.hidden ? null : (byId[q.id] ? { ...byId[q.id], ...q } : q); });
    questions = Object.values(byId).filter(Boolean);
    qmap = {};
    questions.forEach(q => (qmap[q.id] = q));
    questions.sort(sortQ);
    computeStatus();
    if (typeof WrongNotes !== 'undefined') WrongNotes.reset();
  }

  function sortQ(a, b) {
    const ti = x => (x.test === 'RW' ? 0 : x.test === 'MATH' ? 1 : 2);
    const di = x => { const i = DOMAIN_ORDER.indexOf(x.domain); return i < 0 ? 99 : i; };
    const si = x => { const i = SKILL_ORDER.indexOf(x.skill); return i < 0 ? 99 : i; };
    return ti(a) - ti(b) || di(a) - di(b) || si(a) - si(b) ||
      (DIFF_ORDER[a.difficulty || ''] - DIFF_ORDER[b.difficulty || '']) || a.id.localeCompare(b.id);
  }

  function computeStatus() {
    status = {};
    const sorted = [...attempts].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
    for (const a of sorted) for (const it of a.items) {
      const s = (status[it.qid] = status[it.qid] || { n: 0, wrong: 0, right: 0, last: null, lastDate: null, lastResp: '' });
      s.n++; it.correct ? s.right++ : s.wrong++;
      s.last = it.correct; s.lastDate = a.date; s.lastResp = it.response;
    }
  }

  /* ---------- 공통 조각 ---------- */
  const tBadge = t => `<span class="badge t-${t || 'x'}">${t === 'RW' ? 'R&amp;W' : t === 'MATH' ? 'Math' : '?'}</span>`;
  const dBadge = d => `<span class="badge d-${d || 'none'}">${DIFF_KO[d || '']}</span>`;
  const pimg = (blob, cls = '') => blob ? `<img class="pimg ${cls}" src="${U.url(blob)}" alt="">` : '';

  // 이미지 문제의 형광펜 사각형을 그림 위에 다시 그림
  const rectHL = (html, rects) => !rects || !rects.length ? html
    : `<div class="hl-wrap">${html}${rects.map(r => `<div class="hl-mark c-${r.c || 'yellow'}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></div>`).join('')}</div>`;

  function qCard(q, o = {}) {
    if (!q) return '<div class="qcard"><p class="muted">삭제된 문제입니다.</p></div>';
    const resp = o.response;
    const isText = q.kind === 'html';
    const hl = o.hl || {}; // 풀이 때 칠한 형광펜
    const stim = hl.stim || q.stim, stem = hl.stem || q.stem;
    const body = isText
      ? (q.stim ? `<div class="q-text">${stim}</div><div class="qc-prompt q-text">${stem}</div>` : `<div class="q-text">${stem}</div>`)
      : rectHL(q.passageImg && q.promptImg ? pimg(q.passageImg) + `<div class="qc-prompt">${pimg(q.promptImg)}</div>` : pimg(q.stemImg), hl.rects);
    let ans;
    if (q.type === 'mcq') {
      ans = `<div class="qc-choices">${['A', 'B', 'C', 'D'].map((L, i) => {
        const cls = [L === q.answer ? 'right' : '', resp === L && L !== q.answer ? 'wrongpick' : '', resp === L ? 'picked' : ''].join(' ');
        return `<div class="qc-choice ${cls}"><span class="qc-l">${L}</span><div>${isText ? `<div class="q-choice">${hl['c' + i] || (q.choices || [])[i] || ''}</div>` : pimg(q.choiceImgs && q.choiceImgs[i])}</div>
          ${L === q.answer ? '<span class="qc-tag ok">정답</span>' : ''}${resp === L && L !== q.answer ? '<span class="qc-tag no">내 답</span>' : ''}</div>`;
      }).join('')}</div>`;
    } else {
      ans = `<div class="qc-spr">정답: <b>${U.esc(q.answer || '(미입력)')}</b>${resp !== undefined ? ` · 내 답: <b class="${U.isCorrect(q, resp) ? 'ok' : 'no'}">${U.esc(resp || '(무응답)')}</b>` : ''}</div>`;
    }
    return `<div class="qcard">
      <div class="qc-meta">${tBadge(q.test)} ${dBadge(q.difficulty)} <span>${U.esc(q.domain || '카테고리 미분류')}</span>${q.skill ? ` › <span>${U.esc(q.skill)}</span>` : ''}${srcBadge(q)}<span class="qc-id">ID ${U.esc(q.id)}</span></div>
      <div class="qc-body">${body}</div>
      ${ans}
      ${q.rat ? `<details class="qc-rat" ${o.openRat ? 'open' : ''}><summary>해설 보기</summary><div class="q-text qc-rattext">${q.rat}</div></details>`
        : q.rationaleImg ? `<details class="qc-rat" ${o.openRat ? 'open' : ''}><summary>해설 보기</summary>${pimg(q.rationaleImg)}</details>` : ''}
    </div>`;
  }

  function modal(html, cls = '') {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal-bg';
    m.innerHTML = `<div class="modal ${cls}"><button class="modal-x" data-close>×</button>${html}</div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  function closeModal() { document.querySelectorAll('.modal-bg').forEach(m => m.remove()); }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function hydrateOrToast(qs, onProgress) {
    try { await Store.hydrateAll(qs.filter(Boolean), onProgress); return true; }
    catch (e) { console.error(e); toast('문제 이미지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'); return false; }
  }

  /* ---------- 문제은행 ---------- */
  function filtered() {
    const q = F.q.trim().toLowerCase();
    return questions.filter(x => {
      if (F.test !== 'all' && x.test !== F.test) return false;
      if (F.src === 'cb' && !x.bank) return false;
      if (F.src === 'me' && x.bank) return false;
      if (F.skills.size && !F.skills.has(x.skill || '__none:' + (x.domain || ''))) return false;
      if (F.diff.size && !F.diff.has(x.difficulty || '')) return false;
      if (F.status.size) {
        const s = status[x.id];
        const ok = (F.status.has('new') && !s) || (F.status.has('wrong') && s && s.last === false) ||
          (F.status.has('everwrong') && s && s.wrong > 0) || (F.status.has('right') && s && s.last === true);
        if (!ok) return false;
      }
      if (q && !(x.id.includes(q) || (x.stemText || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  // 로그인 전 시작 화면 (Google 로그인을 쓸 수 있고 아직 로그인 안 했을 때)
  function landingHTML() {
    return `<div class="landing">
      <img class="land-logo" src="icons/icon-192.png" alt="">
      <h1>SAT Practice Bank</h1>
      <p class="land-sub">실제 Bluebook 화면 그대로 푸는 나만의 SAT 문제은행</p>
      <button class="btn gbtn land-login" id="land-login"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Google로 시작하기</button>
      <p class="muted sm">로그인하면 문제·풀이 기록·영단어가 컴퓨터와 휴대폰에서 자동으로 맞춰집니다. 인터넷이 없어도 이어서 풀 수 있어요.</p>
      <div class="land-feats">
        <div><b>Bluebook 시험 화면</b><span>실제 SAT 시간, 계산기, 공식표, 문항 이동까지 똑같이</span></div>
        <div><b>카테고리·난이도별 문제은행</b><span>College Board Question Bank 문제를 골라서 풀기</span></div>
        <div><b>오답노트 · 질문노트</b><span>틀린 문제와 선생님께 물어볼 문제를 한곳에</span></div>
        <div><b>형광펜 영단어장</b><span>빨간 형광펜으로 칠한 단어를 플래시카드로</span></div>
      </div>
      <button class="link land-guest" id="land-guest">로그인 없이 둘러보기</button>
    </div>`;
  }

  function bankView() {
    if (Store.googleReady && !Store.user && !guest()) {
      view().innerHTML = landingHTML();
      view().querySelector('#land-login').onclick = async () => { try { await Store.signIn(); } catch (e) { toast('로그인하지 못했습니다: ' + (e.message || e.code)); } };
      view().querySelector('#land-guest').onclick = () => { try { sessionStorage.setItem('sat-guest', '1'); } catch (e) {} route(); };
      return;
    }
    if (!questions.length) {
      view().innerHTML = `<div class="empty">
        <div class="empty-icon">📄</div>
        <h2>아직 문제가 없습니다</h2>
        <p>College Board SAT Suite Question Bank에서 내보낸 PDF를 올리면<br>카테고리·난이도별로 자동 분류됩니다.</p>
        <a class="btn primary" href="#import">PDF 업로드하기</a></div>`;
      return;
    }
    const base = questions.filter(x => F.test === 'all' || x.test === F.test);
    const cnt = (fn) => base.filter(fn).length;
    const saved = Exam.pending();
    const tree = ['RW', 'MATH'].filter(t => F.test === 'all' || F.test === t).map(t => {
      const doms = Object.keys(Parser.DOMAINS[t]);
      const extra = [...new Set(questions.filter(x => x.test === t && !x.skill).map(x => x.domain || ''))];
      return `<div class="ftree-test">${U.TEST_NAME[t]}</div>` + doms.map(d => {
        const skills = Parser.DOMAINS[t][d];
        const dc = questions.filter(x => x.domain === d).length;
        const allOn = skills.every(s => F.skills.has(s));
        return `<div class="ftree-dom">
          <label class="chk dom"><input type="checkbox" data-dom="${U.esc(d)}" ${allOn ? 'checked' : ''}> <span>${U.esc(d)}</span><em>${dc}</em></label>
          ${skills.map(s => `<label class="chk sk"><input type="checkbox" data-skill="${U.esc(s)}" ${F.skills.has(s) ? 'checked' : ''}> <span>${U.esc(s)}</span><em>${questions.filter(x => x.skill === s).length}</em></label>`).join('')}
        </div>`;
      }).join('') + extra.map(d => `<label class="chk sk"><input type="checkbox" data-skill="${U.esc('__none:' + d)}" ${F.skills.has('__none:' + d) ? 'checked' : ''}> <span>${U.esc(d || '미분류')} (스킬 미확인)</span><em>${questions.filter(x => x.test === t && !x.skill && (x.domain || '') === d).length}</em></label>`).join('');
    }).join('');
    const unk = questions.filter(x => !x.test).length;

    const list = filtered();
    view().innerHTML = `
    <div class="bank">
      <aside class="filters">
        <div class="fgroup">
          <h4>섹션</h4>
          <div class="seg">${[['all', '전체'], ['RW', 'Reading &amp; Writing'], ['MATH', 'Math']].map(([v, l]) => `<button class="${F.test === v ? 'on' : ''}" data-test="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="fgroup">
          <h4>출처</h4>
          <div class="seg">${[['all', '전체'], ['cb', 'CB Question Bank'], ['me', '내 업로드']].map(([v, l]) => `<button class="${F.src === v ? 'on' : ''}" data-src="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="fgroup">
          <h4>난이도</h4>
          ${['Easy', 'Medium', 'Hard', ''].map(d => `<label class="chk"><input type="checkbox" data-diff="${d}" ${F.diff.has(d) ? 'checked' : ''}> ${dBadge(d)}<em>${cnt(x => (x.difficulty || '') === d)}</em></label>`).join('')}
        </div>
        <div class="fgroup">
          <h4>풀이 상태</h4>
          ${[['new', '안 푼 문제', x => !status[x.id]], ['wrong', '최근에 틀린 문제', x => status[x.id] && status[x.id].last === false], ['everwrong', '한 번이라도 틀린 문제', x => status[x.id] && status[x.id].wrong > 0], ['right', '최근에 맞힌 문제', x => status[x.id] && status[x.id].last === true]]
            .map(([v, l, fn]) => `<label class="chk"><input type="checkbox" data-st="${v}" ${F.status.has(v) ? 'checked' : ''}> <span>${l}</span><em>${cnt(fn)}</em></label>`).join('')}
        </div>
        <div class="fgroup">
          <h4>카테고리 <button class="link sm" data-act="clear-skills">초기화</button></h4>
          <div class="ftree">${tree}${unk ? `<p class="muted sm">섹션 미확인 문제 ${unk}개</p>` : ''}</div>
        </div>
      </aside>
      <section class="qlist">
        ${saved ? `<div class="resume-bar"><div><b>⏸ 저장해 둔 시험이 있어요</b><br><span class="muted sm">${U.esc(saved.date)} · ${saved.modules.map(x => `${U.TEST_NAME[x.test]} ${x.qids.length}문항`).join(', ')} · ${Object.keys(saved.responses || {}).length}문항 풀었음</span></div>
          <div class="row"><button class="btn ghost danger sm" data-act="saved-del">버리기</button><button class="btn primary" data-act="saved-go">이어서 풀기</button></div></div>` : ''}
        <div class="toolbar">
          <input class="search" placeholder="ID 또는 지문 검색" value="${U.esc(F.q)}">
          <span class="muted">${list.length}문항</span>
          <span class="sel-hint muted sm" title="여러 문제 한 번에 선택">💡 여러 개 선택: 줄을 누른 채 위아래로 끌기 · 또는 첫 줄 클릭 후 Shift+클릭</span>
          <div class="spacer"></div>
          <button class="btn" data-act="sel-all">필터 결과 전체 선택</button>
          <span class="rand"><input type="number" min="1" value="${settings().randN || 10}" class="randN"> <button class="btn" data-act="sel-rand">개 랜덤 선택</button></span>
          <button class="btn ghost" data-act="sel-none">선택 해제</button>
        </div>
        ${questions.some(q => q.bank) ? `<p class="src-note">기본 문제 ${questions.filter(q => q.bank).length.toLocaleString()}개는 <b>College Board SAT Suite Question Bank</b> 문제입니다 (Reading &amp; Writing 전체 · Math Hard). 문제·정답·해설의 저작권은 College Board에 있습니다.</p>` : ''}
        <div class="table-wrap"><table class="qtable">
          <thead><tr><th><input type="checkbox" data-act="toggle-page" ${list.length && list.every(x => sel.has(x.id)) ? 'checked' : ''}></th><th>섹션</th><th>카테고리</th><th>난이도</th><th>유형</th><th>기록</th><th>ID</th><th></th></tr></thead>
          <tbody>${list.map(x => {
            const s = status[x.id];
            const rec = s ? `<span class="rec ${s.last ? 'ok' : 'no'}">${s.last ? '✓' : '✗'}</span> <span class="muted sm">${s.right}/${s.n} · ${U.esc(s.lastDate || '')}</span>` : '<span class="muted sm">—</span>';
            return `<tr class="${sel.has(x.id) ? 'sel' : ''}" data-id="${U.esc(x.id)}">
              <td><input type="checkbox" class="rowchk" ${sel.has(x.id) ? 'checked' : ''}></td>
              <td>${tBadge(x.test)}</td>
              <td><button class="cat-link" data-view="1" title="문제 보기"><span class="cat-d">${U.esc(x.domain || '미분류')}</span><span class="cat-s">${U.esc(x.skill || '')}</span></button><div class="cat-src">${srcBadge(x)}</div></td>
              <td>${dBadge(x.difficulty)}</td>
              <td class="sm">${x.type === 'mcq' ? '객관식' : '주관식'}${!x.answer ? ' <span class="warn" title="정답 정보 없음">!</span>' : ''}</td>
              <td>${rec}</td>
              <td class="mono sm">${U.esc(x.id)}</td>
              <td><button class="btn sm ghost viewbtn" data-view="1">보기</button></td></tr>`;
          }).join('')}</tbody></table>
          ${list.length ? '' : '<p class="muted center pad">조건에 맞는 문제가 없습니다.</p>'}
        </div>
      </section>
    </div>
    ${startBar()}`;
    bindBank();
  }

  function startBar() {
    const chosen = questions.filter(q => sel.has(q.id));
    const rw = chosen.filter(q => q.test !== 'MATH').length, m = chosen.filter(q => q.test === 'MATH').length;
    const tRW = rw ? U.timeFor('RW', rw) : 0, tM = m ? U.timeFor('MATH', m) : 0;
    return `<div class="startbar ${chosen.length ? '' : 'idle'}">
      <div class="sb-info">
        <b>${chosen.length}문항 선택</b>
        ${rw ? `<span>R&amp;W ${rw}문항 · <b>${U.korDur(tRW)}</b></span>` : ''}
        ${m ? `<span>Math ${m}문항 · <b>${U.korDur(tM)}</b></span>` : ''}
        ${chosen.length ? `<span class="muted">총 ${U.korDur(tRW + tM)} (실제 SAT 문항당 시간 기준)</span>` : '<span class="muted">풀 문제를 선택하세요</span>'}
      </div>
      <div class="sb-actions">
        <label class="chk inline"><input type="checkbox" id="shuffle" ${settings().shuffle ? 'checked' : ''}> 순서 섞기</label>
        <label class="datelbl">풀이 날짜 <input type="date" id="examDate" value="${U.today()}"></label>
        <button class="btn primary big" data-act="start" ${chosen.length ? '' : 'disabled'}>시험 시작</button>
      </div>
    </div>`;
  }

  function refreshBank() { const y = document.querySelector('.table-wrap')?.scrollTop; bankView(); if (y) document.querySelector('.table-wrap').scrollTop = y; }

  function bindBank() {
    const v = view();
    v.querySelectorAll('[data-test]').forEach(b => b.onclick = () => { F.test = b.dataset.test; refreshBank(); });
    v.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { F.src = b.dataset.src; refreshBank(); });
    v.querySelectorAll('[data-diff]').forEach(c => c.onchange = () => { c.checked ? F.diff.add(c.dataset.diff) : F.diff.delete(c.dataset.diff); refreshBank(); });
    v.querySelectorAll('[data-st]').forEach(c => c.onchange = () => { c.checked ? F.status.add(c.dataset.st) : F.status.delete(c.dataset.st); refreshBank(); });
    v.querySelectorAll('[data-skill]').forEach(c => c.onchange = () => { c.checked ? F.skills.add(c.dataset.skill) : F.skills.delete(c.dataset.skill); refreshBank(); });
    v.querySelectorAll('[data-dom]').forEach(c => c.onchange = () => {
      const d = c.dataset.dom;
      const t = Object.keys(Parser.DOMAINS).find(t => Parser.DOMAINS[t][d]);
      Parser.DOMAINS[t][d].forEach(s => c.checked ? F.skills.add(s) : F.skills.delete(s));
      refreshBank();
    });
    const search = v.querySelector('.search');
    search.oninput = () => { F.q = search.value; clearTimeout(search._t); search._t = setTimeout(() => { refreshBank(); const s = view().querySelector('.search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); };
    const tbody = v.querySelector('tbody');
    const rows = () => [...tbody.querySelectorAll('tr[data-id]')];
    const setRow = (tr, on) => { const id = tr.dataset.id; on ? sel.add(id) : sel.delete(id); tr.classList.toggle('sel', on); tr.querySelector('.rowchk').checked = on; };
    // 여러 개 한 번에: 드래그(누른 채로 줄 위를 지나가기) · Shift+클릭(범위)
    let drag = null, dragged = false, dragEnd = 0;
    tbody.onmousedown = e => {
      if (e.button !== 0 || e.shiftKey || e.target.closest('.viewbtn')) return; // 줄 어디서든(카테고리 글씨 포함) 드래그 시작
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      drag = { on: !sel.has(tr.dataset.id), start: tr };
      dragged = false;
    };
    tbody.onmouseover = e => {
      if (!drag) return;
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      if (!dragged && tr !== drag.start) { dragged = true; tbody.classList.add('dragging'); }
      if (dragged) {
        // 마우스를 빨리 움직여도 빠지는 줄이 없게 시작 줄부터 지금 줄까지 전부 칠함
        const all = rows(), i0 = all.indexOf(drag.start), i1 = all.indexOf(tr);
        const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
        for (let i = a; i <= b; i++) setRow(all[i], drag.on);
        bankLast = i1;
      }
    };
    const endDrag = () => { if (drag && dragged) { updateStartBar(); dragEnd = Date.now(); } dragged = false; drag = null; tbody.classList.remove('dragging'); };
    window.removeEventListener('mouseup', window._bankUp || (() => {}));
    window._bankUp = endDrag;
    window.addEventListener('mouseup', endDrag);
    tbody.onclick = e => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const id = tr.dataset.id;
      if (Date.now() - dragEnd < 300) return; // 드래그 직후 생기는 클릭은 무시
      // Shift+클릭이 아닐 때만: 글씨(카테고리)나 "보기"를 누르면 문제 정보, 그 외 줄 아무 곳이나 누르면 선택/해제
      if (!e.shiftKey && e.target.closest('[data-view]')) { preview(id); return; }
      const all = rows(), idx = all.indexOf(tr);
      const on = e.target.classList.contains('rowchk') ? e.target.checked : !sel.has(id);
      if (e.shiftKey && bankLast >= 0 && bankLast < all.length) {
        const [a, b] = bankLast < idx ? [bankLast, idx] : [idx, bankLast];
        for (let i = a; i <= b; i++) setRow(all[i], on);
        getSelection().removeAllRanges();
      } else setRow(tr, on);
      bankLast = idx;
      updateStartBar();
    };
    v.onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const list = filtered();
      switch (b.dataset.act) {
        case 'sel-all': list.forEach(x => sel.add(x.id)); refreshBank(); break;
        case 'sel-none': sel.clear(); refreshBank(); break;
        case 'toggle-page': { const on = b.checked; list.forEach(x => on ? sel.add(x.id) : sel.delete(x.id)); refreshBank(); break; }
        case 'sel-rand': {
          const n = Math.max(1, parseInt(v.querySelector('.randN').value) || 10);
          setSettings({ randN: n });
          const pool = list.filter(x => !sel.has(x.id));
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
          pool.slice(0, n).forEach(x => sel.add(x.id));
          refreshBank(); break;
        }
        case 'clear-skills': F.skills.clear(); refreshBank(); break;
        case 'start': startExam(); break;
        case 'saved-go': resumeExam(Exam.pending(), b); break;
        case 'saved-del': U.confirm('저장해 둔 시험을 버릴까요?', '푼 답은 기록되지 않습니다.', '버리기').then(ok => { if (ok) { Exam.discard(); refreshBank(); } }); break;
      }
    };
  }

  function updateStartBar() {
    const old = document.querySelector('.startbar');
    const date = old.querySelector('#examDate').value;
    old.outerHTML = startBar();
    document.querySelector('#examDate').value = date;
    const all = document.querySelector('[data-act="toggle-page"]');
    if (all) all.checked = filtered().every(x => sel.has(x.id));
  }

  function startExam() {
    const date = document.querySelector('#examDate').value || U.today();
    const shuffle = document.querySelector('#shuffle').checked;
    setSettings({ shuffle });
    let chosen = questions.filter(q => sel.has(q.id));
    if (shuffle) for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    const name = settings().name || (Store.user && Store.user.name) || 'Student';
    const rw = chosen.filter(q => q.test !== 'MATH').length, m = chosen.length - rw;
    modal(`<h2>시험을 시작할까요?</h2>
      <ul class="startinfo">
        ${rw ? `<li>Section 1 · Reading and Writing <b>${rw}문항 · ${U.korDur(U.timeFor('RW', rw))}</b></li>` : ''}
        ${m ? `<li>Section ${rw ? 2 : 1} · Math <b>${m}문항 · ${U.korDur(U.timeFor('MATH', m))}</b></li>` : ''}
        <li>풀이 날짜: <b>${date}</b></li>
      </ul>
      <div class="timing" role="radiogroup" aria-label="시간 설정">
        <label class="tchoice"><input type="radio" name="timed" value="1" ${settings().timed === false ? '' : 'checked'}><span><b>시간 재기</b><small>실제 SAT 시간 · 시간이 끝나면 자동 제출</small></span></label>
        <label class="tchoice"><input type="radio" name="timed" value="0" ${settings().timed === false ? 'checked' : ''}><span><b>시간 안 재기</b><small>제한 없이 풀기 · 걸린 시간만 기록</small></span></label>
      </div>
      <div class="notice">
        <b>시험 중 화면 이탈 방지</b><br>
        시작하면 자동으로 전체화면으로 바뀝니다. 다른 탭·앱으로 이동하거나 전체화면을 끄면 시험 화면이 잠기고 이탈 횟수가 결과에 기록됩니다. 타이머는 이탈 중에도 계속 흐릅니다.
      </div>
      <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" id="goExam">시작하기</button></div>`);
    document.getElementById('goExam').onclick = async () => {
      Exam.enterFs(); // 클릭하자마자 전체화면 (브라우저는 클릭 직후에만 허용)
      const b = document.getElementById('goExam');
      b.disabled = true;
      const timed = (document.querySelector('input[name="timed"]:checked') || {}).value !== '0';
      setSettings({ timed });
      const ok = await hydrateOrToast(chosen, (n, t) => { b.textContent = `문제 불러오는 중 ${n}/${t}`; });
      closeModal();
      if (ok) Exam.start(chosen, { date, name, timed, onFinish: afterExam, onAsk });
    };
  }

  async function afterExam(aid) {
    setTimeout(fillVocab, 800); // 시험 중 모은 단어 뜻 찾기 (제출·종료 모두)
    if (aid === 'suspended') {
      try { await load(); } catch (e) {}
      location.hash = '#bank'; route();
      toast('시험을 저장했어요. 문제은행 맨 위에서 이어서 풀 수 있어요');
      return;
    }
    if (typeof aid === 'string' && aid.startsWith('pending:')) {
      sel.clear();
      modal(`<h2>결과를 임시 저장했어요</h2>
        <p>인터넷 연결이 끊겨 있어서 이번 풀이 결과를 이 기기에 보관했습니다. 인터넷이 다시 연결되면 자동으로 저장되고 풀이 기록에 나타납니다.</p>
        <p class="muted sm">그 전에 이 브라우저의 사이트 데이터를 지우면 결과가 사라질 수 있어요.</p>
        <div class="modal-btns"><button class="btn primary" data-close>확인</button></div>`);
      try { await load(); } catch (e) {}
      location.hash = '#bank'; route();
      return;
    }
    await load();
    if (aid != null) {
      sel.clear();
      // 질문노트에 넣은 문제는 이번 풀이 결과(내 답·정답 여부)도 함께 기록
      const a = attempts.find(x => x.aid == aid);
      if (a) for (const it of a.items.filter(i => i.ask)) {
        const n = await QNotes.get(it.qid);
        if (n) { Object.assign(n, { response: it.response, correct: it.correct, date: a.date, aid: a.aid, hl: it.hl }); await Store.put('qnotes', n); }
      }
      location.hash = '#attempt-' + aid;
    }
    route();
  }

  // 시험 중 "선생님께 질문" 체크 → 질문노트에 바로 저장 (체크 해제하면 메모가 없을 때만 삭제)
  async function onAsk(qid, on, note) {
    const n = await QNotes.get(qid);
    if (on) {
      const v = n || { id: qid, qid, note: '', resolved: false, addedAt: Date.now() };
      if (note != null && note !== '') v.note = note;
      v.resolved = false; v.updatedAt = Date.now();
      await Store.put('qnotes', v); QNotes.cache(v);
    } else if (n && !n.note) { await Store.del('qnotes', qid); QNotes.uncache(qid); }
  }

  function resumeExam(p, btn) {
    Exam.enterFs(); // 클릭 직후에 전체화면 요청
    const need = p.modules.flatMap(x => x.qids).map(id => qmap[id]).filter(Boolean);
    if (btn) btn.textContent = '불러오는 중…';
    return hydrateOrToast(need).then(() => { closeModal(); Exam.resume(qmap, { onFinish: afterExam, onAsk }); });
  }

  // 시험을 제출한 뒤, 새로 모은 단어의 뜻을 한 번에 찾아 채움
  async function fillVocab() {
    try {
      await Vocab.load();
      const p = Vocab.pending();
      if (!p.length || Vocab.autoMode() === 'manual') return;
      const st = await Vocab.sampleState();
      if (st === 'denied') return;
      if (st === 'prompt' && (await Vocab.askSample()) !== 'granted') return;
      toast(`새 영단어 ${p.length}개의 뜻을 찾는 중…`);
      const n = await Vocab.lookup(p);
      if (n) toast(`영단어 ${n}개의 뜻을 채웠어요 · 영단어 탭에서 확인하세요`);
      if ((location.hash || '').startsWith('#vocab')) route();
    } catch (e) { console.error(e); }
  }

  // 새로고침·업데이트로 끊긴 업로드를 자동으로 이어서 진행
  async function resumeJobs() {
    let jobs = [];
    try { jobs = (await DB.all('jobs')).sort((a, b) => a.at - b.at); } catch (e) { return; }
    if (!jobs.length) return;
    if (!Store.canUpload || !window.pdfjsLib) return;
    toast(`중간에 끊긴 업로드 ${jobs.length}개를 이어서 진행합니다`);
    const files = jobs.map(j => new File([j.blob], j.name, { type: 'application/pdf' }));
    runImport(files, jobs);
  }

  async function syncPending() {
    if (!Store.pendingCount()) return;
    const n = await Store.flushPending();
    if (n) { await load(); route(); toast(`인터넷에 다시 연결되어 풀이 기록 ${n}개를 저장했습니다`); }
  }

  /* ---------- 문제 미리보기 / 편집 ---------- */
  async function preview(id) {
    const q = qmap[id];
    if (!(await hydrateOrToast([q]))) return;
    const s = status[id];
    const hist = attempts.filter(a => a.items.some(i => i.qid === id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const domOpts = t => Object.keys(Parser.DOMAINS[t] || {});
    const m = modal(`
      ${qCard(q, {})}
      <div class="edit">
        <h3>분류 수정</h3>
        <div class="edit-grid">
          <label>섹션<select id="e-test"><option value="RW">Reading and Writing</option><option value="MATH">Math</option></select></label>
          <label>도메인<select id="e-dom"></select></label>
          <label>스킬<select id="e-skill"></select></label>
          <label>난이도<select id="e-diff">${['Easy', 'Medium', 'Hard', ''].map(d => `<option value="${d}" ${(q.difficulty || '') === d ? 'selected' : ''}>${d || '미지정'}</option>`).join('')}</select></label>
          <label>정답<input id="e-ans" value="${U.esc(q.answer || '')}" placeholder="${q.type === 'mcq' ? 'A~D' : '예: 12, 3/4'}"></label>
          <label>유형<select id="e-type"><option value="mcq" ${q.type === 'mcq' ? 'selected' : ''}>객관식</option><option value="spr" ${q.type === 'spr' ? 'selected' : ''}>주관식</option></select></label>
        </div>
        ${hist.length ? `<h3>풀이 기록</h3><ul class="hist">${hist.map(a => { const it = a.items.find(i => i.qid === id); return `<li><span class="rec ${it.correct ? 'ok' : 'no'}">${it.correct ? '✓' : '✗'}</span> ${U.esc(a.date)} · 내 답 ${U.esc(it.response || '무응답')} · ${U.korDur(it.timeSpent)}</li>`; }).join('')}</ul>` : ''}
        <p class="muted sm">출처: ${U.esc(q.bank ? 'College Board SAT Suite Question Bank (기본 문제)' : q.source || '')}</p>
        <div class="modal-btns"><button class="btn danger" id="e-del">문제 삭제</button><div class="spacer"></div><button class="btn" data-close>닫기</button><button class="btn primary" id="e-save">저장</button></div>
      </div>`, 'wide');
    const $ = s => m.querySelector(s);
    $('#e-test').value = q.test || 'RW';
    const fillDom = () => {
      const t = $('#e-test').value;
      $('#e-dom').innerHTML = `<option value="">미분류</option>` + domOpts(t).map(d => `<option ${d === q.domain ? 'selected' : ''}>${U.esc(d)}</option>`).join('');
      fillSkill();
    };
    const fillSkill = () => {
      const t = $('#e-test').value, d = $('#e-dom').value;
      $('#e-skill').innerHTML = `<option value="">미분류</option>` + ((Parser.DOMAINS[t] || {})[d] || []).map(s => `<option ${s === q.skill ? 'selected' : ''}>${U.esc(s)}</option>`).join('');
    };
    $('#e-test').onchange = fillDom; $('#e-dom').onchange = fillSkill;
    fillDom();
    $('#e-save').onclick = async () => {
      q.test = $('#e-test').value; q.domain = $('#e-dom').value; q.skill = $('#e-skill').value;
      q.difficulty = $('#e-diff').value; q.type = $('#e-type').value;
      const a = $('#e-ans').value.trim();
      if (q.type === 'mcq') { q.answer = a.toUpperCase().slice(0, 1); q.answers = []; }
      else { q.answers = a.split(/,|\bor\b/).map(x => x.trim()).filter(Boolean); q.answer = q.answers.join(', '); }
      await Store.put('questions', q);
      closeModal(); questions.sort(sortQ); toast('저장했습니다'); route();
    };
    $('#e-del').onclick = async () => {
      if (!await U.confirm('이 문제를 삭제할까요?', '풀이 기록은 남습니다.', '삭제')) return;
      if (q.bank) await Store.put('questions', { id, hidden: true }); // 기본 문제는 숨김 처리
      else await Store.del('questions', id);
      sel.delete(id);
      closeModal(); await load(); route();
    };
  }

  /* ---------- 업로드 ---------- */
  function importView() {
    view().innerHTML = `<div class="page narrow">
      <h1>PDF 업로드</h1>
      <p class="lead">College Board <b>SAT Suite Question Bank</b>에서 내보낸 PDF를 올리세요. 문제마다 섹션·카테고리(도메인/스킬)·난이도·정답·해설을 자동으로 읽어 분류합니다.</p>
      <ol class="howto">
        <li>Question Bank에서 문제를 고른 뒤 <b>Export</b> → PDF로 저장합니다. <b>정답·해설이 포함된 PDF("답" 파일)</b>를 올려야 채점과 해설 보기가 됩니다. 문제만 있는 PDF를 먼저 올렸다면, 나중에 같은 문제의 답 PDF를 올리면 정답이 자동으로 채워집니다.</li>
        <li>아래에 PDF를 끌어다 놓기 · 여러 파일 한 번에 가능</li>
        ${Store.mode === 'cloud' ? '<li>올린 문제와 풀이 기록은 내 계정에 저장되어 다른 컴퓨터·태블릿에서도 그대로 보입니다</li>' : ''}
      </ol>
      <label class="drop" id="drop">
        <input type="file" id="pdfs" accept="application/pdf,.pdf" multiple hidden>
        <div class="drop-icon">⬆</div>
        <div><b>PDF 파일을 여기에 끌어다 놓거나 클릭해서 선택</b></div>
        <div class="muted sm">${Store.mode === 'cloud' ? '문제는 이 페이지에 저장되어 어느 기기에서나 열립니다' : '파일은 이 컴퓨터 브라우저 안에만 저장됩니다'}</div>
      </label>
      <div class="opts">
        <label>PDF에 난이도 표시가 없을 때 지정할 난이도
          <select id="defDiff"><option value="">미지정 (나중에 수정)</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
        <label class="chk inline"><input type="checkbox" id="overwrite"> 이미 있는 문제(같은 ID)도 다시 가져와 덮어쓰기</label>
      </div>
      <div id="importLog"></div>
    </div>`;
    const input = document.getElementById('pdfs'), drop = document.getElementById('drop');
    input.onchange = () => runImport([...input.files]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); runImport([...e.dataTransfer.files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf')); };
    renderImportLog();
  }

  // 업로드 작업 상태 — 화면(탭)을 옮겨도 계속 진행되고, 돌아오면 그대로 다시 그려짐
  const job = { running: false, rows: [], totalAdd: 0 };
  let importing = false;

  function renderImportLog() {
    const log = document.getElementById('importLog');
    if (log) {
      const rows = job.rows.slice().reverse().map(r => `
        <div class="imp-row ${r.state}">
          <div class="imp-name">${U.esc(r.name)}</div>
          <div class="bar"><i style="width:${r.pct}%"></i></div>
          <div class="imp-msg muted sm">${r.msg}</div>
        </div>`).join('');
      const done = !job.running && job.totalAdd ? `<div class="imp-done"><b>${job.totalAdd}문항을 추가했습니다.</b> <a class="btn primary" href="#bank">문제은행으로 가기</a></div>` : '';
      log.innerHTML = done + rows;
    }
    renderJobBadge();
  }

  function renderJobBadge() {
    const b = document.getElementById('jobBadge');
    if (!b) return;
    if (!job.running) { b.hidden = true; return; }
    let i = job.rows.findIndex(r => r.state === 'run');
    if (i < 0) i = Math.min(job.rows.length - 1, job.rows.filter(r => r.state === 'done' || r.state === 'fail').length);
    const cur = job.rows[i];
    b.hidden = false;
    b.textContent = `⬆ 업로드 중 ${i + 1}/${job.rows.length} · ${cur ? cur.pct : 0}%`;
    // 업로드 화면이 아닐 때는 화면 위에 진행 카드도 보여줌
    let card = document.getElementById('jobCard');
    const onImport = (location.hash || '').startsWith('#import');
    if (onImport) { card && card.remove(); return; }
    if (!card) {
      card = document.createElement('a');
      card.id = 'jobCard'; card.className = 'jobcard'; card.href = '#import';
      document.body.appendChild(card);
    }
    card.innerHTML = `<b>PDF 업로드 중 (${i + 1}/${job.rows.length})</b>
      <span class="jc-name">${U.esc(cur ? cur.name : '')}</span>
      <span class="bar"><i style="width:${cur ? cur.pct : 0}%"></i></span>
      <span class="jc-msg">${cur ? cur.msg : ''}</span>`;
  }

  // 업로드 중 저장된 문제를 문제은행 목록에 바로 반영
  let liveTimer = null;
  function liveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      questions.sort(sortQ);
      const h = location.hash || '#bank';
      if (h.startsWith('#bank') && !document.querySelector('.modal-bg')) refreshBank();
    }, 800);
  }

  let renderPending = false;
  const scheduleRender = () => { if (renderPending) return; renderPending = true; requestAnimationFrame(() => { renderPending = false; renderImportLog(); }); setTimeout(() => { if (renderPending) { renderPending = false; renderImportLog(); } }, 300); };

  const keepOpen = e => { e.preventDefault(); e.returnValue = ''; return ''; };

  // resume: 새로고침 전에 저장해 둔 업로드 작업 [{id, name, blob, difficulty, overwrite}]
  async function runImport(files, resume) {
    if (!files.length || importing) { if (importing) toast('지금 업로드 중입니다. 끝난 뒤에 다시 올려주세요.'); return; }
    if (!Store.canUpload) { toast('이 계정은 문제를 추가할 권한이 없습니다. 이 페이지의 소유자만 업로드할 수 있어요.'); return; }
    if (!window.pdfjsLib) { toast('PDF 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'); return; }
    importing = true;
    const difficulty = resume ? resume[0].difficulty : document.getElementById('defDiff').value;
    const overwrite = resume ? false : document.getElementById('overwrite').checked;
    // PDF 원본을 이 브라우저에 잠시 보관 — 중간에 페이지가 새로고침돼도 다시 열면 이어서 진행
    const jobIds = [];
    for (let i = 0; i < files.length; i++) {
      if (resume) { jobIds.push(resume[i].id); continue; }
      const id = Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6);
      try { await DB.put('jobs', { id, name: files[i].name, blob: files[i], difficulty, at: Date.now() }); jobIds.push(id); }
      catch (e) { jobIds.push(null); }
    }
    job.running = true; job.totalAdd = 0;
    job.rows = files.map(f => ({ name: f.name, pct: 0, msg: '대기 중…', state: 'wait' }));
    window.addEventListener('beforeunload', keepOpen);
    renderImportLog();
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi], row = job.rows[fi];
      row.state = 'run';
      const set = (msg, pct) => { row.msg = U.esc(msg); if (pct != null) row.pct = Math.round(pct); scheduleRender(); };
      try {
        // PDF 분석 0~50%, 저장 50~100%
        const qs = await Parser.parse(f, { difficulty }, (m, p) => set(m, p * 50));
        let add = 0, dup = 0, merged = 0;
        const warn = [];
        for (let qi = 0; qi < qs.length; qi++) {
          const q = qs[qi];
          set(`저장 중 (${qi + 1}/${qs.length})`, 50 + ((qi + 1) / qs.length) * 50);
          const old = qmap[q.id];
          if (old && !overwrite) {
            // 같은 문제의 "답" PDF를 나중에 올린 경우: 정답·해설만 채워 넣음
            if (!old.answer && q.answer) {
              await Store.hydrate(old);
              Object.assign(old, { answer: q.answer, answers: q.answers, rationaleImg: q.rationaleImg, difficulty: old.difficulty || q.difficulty, type: q.type });
              ['stemImg', 'passageImg', 'promptImg', 'choiceImgs'].forEach(k => { old[k] = q[k]; });
              delete old.sprite; delete old.spriteChunks; delete old.parts;
              await Store.put('questions', old); merged++;
              liveRefresh();
            } else dup++;
            continue;
          }
          await Store.put('questions', q);
          if (!qmap[q.id]) questions.push(q); else questions[questions.indexOf(qmap[q.id])] = q;
          qmap[q.id] = q; add++;
          liveRefresh();
          if (!q.skill || !q.answer || !q.difficulty) warn.push(q.id);
        }
        job.totalAdd += add;
        const by = t => qs.filter(q => q.test === t).length;
        row.msg = `<span class="ok">✓ ${qs.length}문항 인식</span> · 새로 추가 ${add}${merged ? ` · 정답 추가 ${merged}` : ''} · 중복 건너뜀 ${dup} · R&amp;W ${by('RW')} / Math ${by('MATH')}` +
          (warn.length ? `<br><span class="warn-t">확인 필요 ${warn.length}문항 (카테고리·정답·난이도 중 누락) — 문제은행에서 클릭해 수정할 수 있어요</span>` : '');
        row.pct = 100; row.state = 'done';
      } catch (err) {
        console.error(err);
        row.msg = `<span class="no">✗ ${U.esc(err.message || err.code || String(err))}</span>`;
        row.state = 'fail';
      }
      if (jobIds[fi]) { try { await DB.del('jobs', jobIds[fi]); } catch (e) {} }
      renderImportLog();
    }
    await load().catch(e => console.error(e));
    importing = false; job.running = false;
    window.removeEventListener('beforeunload', keepOpen);
    document.getElementById('jobCard')?.remove();
    renderImportLog();
    if (job.totalAdd) {
      if ((location.hash || '#bank').startsWith('#bank')) route();
      if (!location.hash.startsWith('#import')) toast(`업로드 완료: ${job.totalAdd}문항을 추가했습니다`);
    }
  }

  /* ---------- 기록 ---------- */
  function scoreOf(a) { const c = a.items.filter(i => i.correct).length; return { c, n: a.items.length, p: a.items.length ? Math.round((c / a.items.length) * 100) : 0 }; }

  function statsHTML() {
    const items = attempts.flatMap(a => a.items);
    if (!items.length) return '';
    const group = (keyFn, order) => {
      const g = {};
      items.forEach(i => { const k = keyFn(i); if (k == null) return; (g[k] = g[k] || { c: 0, n: 0 }); g[k].n++; if (i.correct) g[k].c++; });
      return Object.entries(g).sort((a, b) => order(a[0]) - order(b[0]));
    };
    const bars = rows => rows.map(([k, v]) => {
      const p = Math.round((v.c / v.n) * 100);
      return `<div class="sbar"><span class="sbar-l">${U.esc(k)}</span><div class="sbar-t"><i style="width:${p}%" class="${p >= 80 ? 'hi' : p >= 60 ? 'mid' : 'lo'}"></i></div><span class="sbar-v">${p}% <span class="muted">(${v.c}/${v.n})</span></span></div>`;
    }).join('');
    const total = items.filter(i => i.correct).length;
    return `<div class="stats">
      <div class="kpis">
        <div class="kpi"><b>${attempts.length}</b><span>풀이 횟수</span></div>
        <div class="kpi"><b>${items.length}</b><span>푼 문항</span></div>
        <div class="kpi"><b>${Math.round((total / items.length) * 100)}%</b><span>전체 정답률</span></div>
        <div class="kpi"><b>${Object.values(status).filter(s => s.last === false).length}</b><span>현재 오답</span></div>
      </div>
      <div class="stat-cols">
        <div><h3>카테고리별 정답률</h3>${bars(group(i => i.domain || '미분류', k => { const x = DOMAIN_ORDER.indexOf(k); return x < 0 ? 99 : x; }))}</div>
        <div><h3>난이도별 정답률</h3>${bars(group(i => DIFF_KO[i.difficulty || ''], k => ['쉬움', '보통', '어려움', '미지정'].indexOf(k)))}
          <h3 class="mt">스킬별 정답률 (낮은 순)</h3>${bars(group(i => i.skill || null, () => 0).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n).slice(0, 8))}</div>
      </div>
    </div>`;
  }

  function historyView() {
    const list = [...attempts].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    view().innerHTML = `<div class="page">
      <h1>풀이 기록</h1>
      ${list.length ? statsHTML() : '<p class="muted">아직 풀이 기록이 없습니다. 문제은행에서 문제를 골라 시험을 시작해보세요.</p>'}
      <div class="att-list">${list.map(a => {
        const s = scoreOf(a);
        const v = (a.violations || []).filter(x => x.type !== 'reload').length;
        return `<div class="att" data-aid="${a.aid}">
          <input type="date" class="att-date" value="${U.esc(a.date)}" title="풀이 날짜 변경">
          <div class="att-main">
            <div>${a.modules.map(m => `${tBadge(m.test)} ${m.count}문항`).join(' ')}</div>
            <div class="muted sm">${a.modules.map(m => `${m.test === 'RW' ? 'R&W' : 'Math'} ${U.korDur(m.used)} / ${(m.limit ? U.korDur(m.limit) : '제한 없음')}`).join(' · ')}</div>
          </div>
          <div class="att-score"><b>${s.c}/${s.n}</b><span>${s.p}%</span></div>
          <div class="att-v ${v ? 'bad' : ''}">${v ? `이탈 ${v}회` : '이탈 없음'}</div>
          <div class="att-rv" data-rv="${a.aid}"></div>
          <a class="btn" href="#attempt-${a.aid}">상세</a>
          <button class="btn ghost danger sm" data-del="${a.aid}">삭제</button>
        </div>`;
      }).join('')}</div></div>`;
    // 시험마다 오답 정리를 얼마나 했는지 (양보다 질)
    WrongNotes.notesFor([...new Set(list.flatMap(a => a.items.map(i => i.qid)))]).then(notes => list.forEach(a => {
      const el = view().querySelector(`[data-rv="${CSS.escape(String(a.aid))}"]`); if (!el) return;
      const t = a.items.filter(it => reviewKind(it, notes[it.qid]));
      if (!t.length) { el.innerHTML = '<span class="muted sm">복습할 문제 없음</span>'; return; }
      const d = t.filter(it => stepsDone(reviewSteps(a, notes[it.qid]))).length;
      el.innerHTML = `<span class="rv-badge ${d === t.length ? 'ok' : d ? 'mid' : ''}">${d === t.length ? '✓ 오답 정리 완료' : `오답 정리 ${d}/${t.length}`}</span>`;
    }));
    view().querySelectorAll('.att-date').forEach(inp => inp.onchange = async () => {
      const a = attempts.find(x => x.aid == inp.closest('.att').dataset.aid);
      a.date = inp.value; await Store.put('attempts', a); computeStatus(); toast('날짜를 변경했습니다');
    });
    view().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await U.confirm('이 풀이 기록을 삭제할까요?', '', '삭제')) return;
      await Store.del('attempts', b.dataset.del); await load(); route();
    });
  }

  function practiceSkill(skill) { F.test = 'all'; F.skills.clear(); F.skills.add(skill); F.diff.clear(); F.status.clear(); F.status.add('new'); F.q = ''; F.src = 'all'; location.hash = '#bank'; toast(`「${skill}」 중 안 푼 문제만 보여요`); }

  // 복습 대상: 틀림 · 찍어서 맞힘 · 오래 걸림 · 직접 추가
  function reviewKind(it, n) { return !it.correct ? 'wrong' : it.guess ? 'guess' : (it.timeSpent || 0) > WrongNotes.slowLimit(it.test) ? 'slow' : n && n.added ? 'added' : null; }
  const RK = { wrong: ['✗', '틀림', 'no'], guess: ['?', '찍어서 맞힘', 'guess'], slow: ['⏱', '오래 걸림', 'slow'], added: ['✎', '직접 추가', 'added'] };
  // 한 문제의 복습 단계: ① 원인 ② 해설 없이 다시 풀기 ③ 한 줄 다짐
  function reviewSteps(a, n) {
    n = n || {};
    const tries = (n.retries || []).filter(r => r.at >= (a.createdAt || 0));
    return { cause: !!n.cause, retry: tries.length > 0 || !!n.mastered, retryOk: tries.length ? tries[tries.length - 1].ok : null, lesson: !!(n.lesson || '').trim() };
  }
  const stepsDone = st => st.cause && st.retry && st.lesson;

  async function attemptView(aid) {
    const a = attempts.find(x => x.aid == aid);
    if (!a) { view().innerHTML = '<div class="page"><p>기록을 찾을 수 없습니다.</p></div>'; return; }
    const notes = await WrongNotes.notesFor(a.items.map(i => i.qid));
    const qn = {}; for (const i of a.items) { const n = await QNotes.get(i.qid); if (n) qn[i.qid] = n; } // 질문노트
    if (!location.hash.startsWith('#attempt-')) return; // 그 사이 다른 화면으로 이동함
    if (attemptView.aid !== aid) { attemptView.aid = aid; attemptView.f = null; attemptView.peek = new Set(); }
    const s = scoreOf(a);
    const all = a.items.map((it, i) => ({ it, i, n: notes[it.qid], kind: reviewKind(it, notes[it.qid]) }));
    all.forEach(x => (x.st = x.kind && reviewSteps(a, x.n)));
    const targets = all.filter(x => x.kind);
    const F2 = attemptView.f = attemptView.f || (targets.length ? 'review' : 'all');
    const items = F2 === 'review' ? targets : F2 === 'wrong' ? all.filter(x => !x.it.correct) : all;
    const v = (a.violations || []);
    const VT = { 'tab-hidden': '다른 탭/앱 이동', 'window-blur': '창 벗어남', 'fullscreen-exit': '전체화면 종료', reload: '새로고침' };
    const cnt = k => targets.filter(x => x.st[k]).length;
    const done = targets.filter(x => stepsDone(x.st)).length;
    // 이번 시험에서 보이는 패턴
    const causeCnt = WrongNotes.CAUSES.map(([k, nm]) => [k, nm, targets.filter(x => x.n && x.n.cause === k).length]);
    const top = [...causeCnt].sort((p, q) => q[2] - p[2])[0];
    const sk = {}; targets.forEach(x => { const k = x.it.skill || x.it.domain; if (k) sk[k] = (sk[k] || 0) + 1; });
    const weak = Object.entries(sk).sort((p, q) => q[1] - p[1]).slice(0, 3);
    const step = (no, label, c, hint) => `<div class="rv-step ${c >= targets.length ? 'done' : ''}"><span class="rv-no">${c >= targets.length ? '✓' : no}</span><div><b>${label}</b> <span class="rv-cnt">${c}/${targets.length}</span><div class="muted sm">${hint}</div></div></div>`;
    const peekAns = x => x.kind && !x.st.retry && !attemptView.peek?.has(x.i);
    const causeBtns = x => WrongNotes.CAUSES.map(([k, nm, d]) => `<button class="wn-c mini c-${k} ${x.n && x.n.cause === k ? 'on' : ''}" data-cause="${k}" title="${U.esc(d)}">${nm}</button>`).join('');

    view().innerHTML = `<div class="page">
      <a href="#history" class="back">← 풀이 기록</a>
      <div class="att-head">
        <div>
          <h1>풀이 결과</h1>
          <label class="datelbl">풀이 날짜 <input type="date" id="adate" value="${U.esc(a.date)}"></label>
        </div>
        <div class="att-big"><b>${s.c}</b><span>/ ${s.n}</span><em>${s.p}%</em></div>
      </div>
      <div class="mods">${a.modules.map(m => {
        const its = a.items.filter(i => (i.test === 'MATH' ? 'MATH' : 'RW') === m.test);
        const c = its.filter(i => i.correct).length;
        return `<div class="mod">${tBadge(m.test)} <b>${c}/${its.length}</b> 정답 · 사용 ${U.korDur(m.used)} / 제한 ${(m.limit ? U.korDur(m.limit) : '제한 없음')}</div>`;
      }).join('')}
        <div class="mod ${v.filter(x => x.type !== 'reload').length ? 'bad' : ''}">화면 이탈 <b>${v.filter(x => x.type !== 'reload').length}회</b>${v.length ? ` <span class="muted sm">(${v.map(x => VT[x.type] || x.type).join(', ')})</span>` : ''}</div>
      </div>

      ${targets.length ? `<section class="rv-panel">
        <div class="rv-top">
          <div><h2>이 시험 오답 정리</h2>
            <p class="muted sm">틀린 문제를 모으는 게 아니라 <b>내가 왜 틀리는지 버릇을 찾는 것</b>이 목표예요. 틀린 문제 ${targets.filter(x => x.kind === 'wrong').length} · 찍어서 맞힌 문제 ${targets.filter(x => x.kind === 'guess').length} · 오래 걸린 문제 ${targets.filter(x => x.kind === 'slow').length}${targets.some(x => x.kind === 'added') ? ` · 직접 추가 ${targets.filter(x => x.kind === 'added').length}` : ''}</p></div>
          <div class="rv-prog"><b>${done}</b>/${targets.length}<span>정리 완료</span></div>
        </div>
        <div class="rv-bar"><i style="width:${Math.round(done / targets.length * 100)}%"></i></div>
        <div class="rv-steps">
          ${step(1, '왜 틀렸는지 이름 붙이기', cnt('cause'), '개념 부족 · 실수 · 시간 부족 · 전략 오류 중 하나')}
          ${step(2, '해설 보기 전에 다시 풀기', cnt('retry'), '답을 보지 말고 처음부터. 그래도 안 되면 그때 해설')}
          ${step(3, '다음엔 이렇게 할게요 (한 줄)', cnt('lesson'), '다음 시험에서 바로 쓸 행동으로')}
        </div>
        ${done === targets.length ? '<p class="rv-done">🎉 이 시험 복습을 끝까지 했어요. 여러 시험을 대충 보는 것보다 이렇게 하나를 깊게 보는 게 점수에 더 도움이 돼요.</p>' : ''}
        <div class="rv-pattern">
          <div><div class="wn-label">이번 시험에서 틀린 이유</div>
            ${top && top[2] ? `<div class="rv-causes">${causeCnt.filter(c => c[2]).map(([k, nm, c]) => `<span class="wn-cause c-${k}">${nm} ${c}</span>`).join(' ')}</div><p class="sm">가장 많은 원인은 <b>${top[1]}</b>이에요. ${WrongNotes.TIPS[top[0]]}</p>` : '<p class="muted sm">원인을 고르면 여기에 내 버릇이 보여요.</p>'}
          </div>
          <div><div class="wn-label">다음 공부 계획 — 약한 유형 메우기</div>
            ${weak.map(([k, c]) => `<div class="rv-weak"><span>${U.esc(k)} <span class="muted">${c}문제</span></span><button class="btn sm" data-weak="${U.esc(k)}">문제은행에서 풀기</button></div>`).join('') || '<p class="muted sm">—</p>'}
          </div>
        </div>
      </section>` : ''}

      <div class="toolbar">
        <div class="seg">
          ${targets.length ? `<button class="${F2 === 'review' ? 'on' : ''}" data-f="review">복습할 문제 ${targets.length}</button>` : ''}
          <button class="${F2 === 'wrong' ? 'on' : ''}" data-f="wrong">틀린 문제 ${a.items.length - s.c}</button>
          <button class="${F2 === 'all' ? 'on' : ''}" data-f="all">전체 ${a.items.length}</button>
        </div>
        <div class="spacer"></div>
        ${targets.length ? '<a class="btn" href="#wrong">오답노트 전체 보기</a>' : ''}
        ${a.items.length - s.c ? '<button class="btn primary" data-act="retry">틀린 문제 시험으로 다시 풀기</button>' : ''}
      </div>
      <div class="res-list">${items.map(x => {
        const { it, i, n, kind, st } = x;
        const q = qmap[it.qid] || {};
        const [kic, kname, kcls] = RK[kind] || [];
        return `
        <div class="res ${kind ? 'rv' : ''} ${st && stepsDone(st) ? 'rv-ok' : ''}" data-i="${i}" data-q="${U.esc(it.qid)}">
          <div class="res-row">
            <span class="res-n">${i + 1}</span>
            <span class="rec big ${it.correct ? 'ok' : 'no'}">${it.correct ? '✓' : '✗'}</span>
            ${tBadge(it.test)} ${dBadge(it.difficulty)}
            <span class="res-cat">${U.esc(it.skill || it.domain || '미분류')}</span>
            ${kind && kind !== 'wrong' ? `<span class="wn-kind-tag ${kcls}">${kic} ${kname}</span>` : ''}
            <span class="res-a">내 답 <b>${U.esc(it.response || '—')}</b> · 정답 ${peekAns(x) ? `<button class="ans-peek" data-peek="${i}" title="다시 풀기 전에는 정답을 가려 둬요">가림 · 보기</button>` : `<b>${U.esc(q.answer || it.answer || '?')}</b>`}</span>
            <span class="muted sm">${U.korDur(it.timeSpent)}${it.marked ? ' · 🚩' : ''}${it.hl ? ' · 🖍️' : ''}</span>
            <button class="btn sm ghost ask-btn ${qn[it.qid] ? 'on' : ''}" data-ask title="질문노트에 넣기/빼기">❓ ${qn[it.qid] ? '질문노트에 있음' : '질문하기'}</button>
            <button class="btn sm ghost" data-flip="${i}">${it.correct ? '오답으로 처리' : '정답으로 처리'}</button>
          </div>
          ${qn[it.qid] ? `<div class="res-ask"><span class="rv-k">❓ 질문</span><input class="ask-note" maxlength="300" value="${U.esc(qn[it.qid].note || '')}" placeholder="무엇을 물어볼지 메모 — 질문노트에 저장돼요">${qn[it.qid].resolved ? '<span class="muted sm">해결됨</span>' : ''}</div>` : ''}
          ${kind ? `<div class="rv-box">
            <div class="rv-line"><span class="rv-k ${st.cause ? 'ok' : ''}">① 왜?</span><div class="rv-chips">${causeBtns(x)}</div></div>
            <div class="rv-line"><span class="rv-k ${st.retry ? 'ok' : ''}">② 다시</span>
              <button class="btn sm ${st.retry ? 'ghost' : 'primary'}" data-redo>↻ 해설 없이 다시 풀기</button>
              ${st.retryOk === true ? '<span class="wn-retry ok">다시 풀기 ✓ 맞힘</span>' : st.retryOk === false ? '<span class="wn-retry no">다시 풀기 ✗ — 이제 해설을 보세요</span>' : '<span class="muted sm">답을 보지 말고 처음부터 풀어 보세요</span>'}
            </div>
            <div class="rv-line"><span class="rv-k ${st.lesson ? 'ok' : ''}">③ 한 줄</span><input class="wn-lesson" maxlength="120" value="${U.esc((n && n.lesson) || '')}" placeholder="다음엔 이렇게 할게요 · 예: 문제에 'NOT'이 나오면 동그라미 치기"></div>
            <details class="rv-more" ${n && n.memo ? 'open' : ''}><summary>메모 더 쓰기 (선택)</summary>
              <textarea class="wn-memo" rows="3" placeholder="${WrongNotes.MEMO_PH}">${U.esc((n && n.memo) || '')}</textarea>
            </details>
            <div class="rv-foot"><span class="muted sm res-saved"></span>${kind === 'guess' ? `<button class="btn sm ghost" data-guess="${i}">찍음 표시 지우기</button>` : ''}${kind === 'added' ? '<button class="btn sm ghost" data-unadd>오답노트에서 빼기</button>' : ''}</div>
          </div>` : `<div class="res-cause"><span class="muted sm">맞혔어도 운이었다면 복습 대상이에요 →</span><button class="btn sm ghost" data-guess="${i}">찍어서 맞힌 거예요</button><button class="btn sm ghost" data-add>✎ 오답노트에 추가</button></div>`}
          <div class="res-detail" hidden></div>
        </div>`;
      }).join('')}</div>
    </div>`;

    const V = view();
    const rer = () => attemptView(aid);
    V.querySelector('#adate').onchange = async e => { a.date = e.target.value; await Store.put('attempts', a); computeStatus(); toast('날짜를 변경했습니다'); };
    V.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { attemptView.f = b.dataset.f; rer(); });
    V.querySelectorAll('[data-weak]').forEach(b => b.onclick = () => practiceSkill(b.dataset.weak));
    V.querySelectorAll('[data-flip]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const it = a.items[+b.dataset.flip]; it.correct = !it.correct; it.manual = true;
      await Store.put('attempts', a); computeStatus(); rer();
    });
    V.querySelectorAll('[data-peek]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (!await U.confirm('정답을 볼까요?', '해설을 보기 전에 먼저 다시 풀어 보는 게 실력으로 남아요.', '그래도 보기')) return;
      (attemptView.peek = attemptView.peek || new Set()).add(+b.dataset.peek); rer();
    });
    V.querySelectorAll('.res').forEach(res => {
      const qid = res.dataset.q, x = all[+res.dataset.i];
      const saved = res.querySelector('.res-saved');
      const save = async patch => {
        if (!x.kind) patch.added = true;
        await WrongNotes.saveNote(qid, patch);
        if (saved) { saved.textContent = '저장했어요 ✓'; clearTimeout(save.t); save.t = setTimeout(() => (saved.textContent = ''), 1500); }
      };
      res.querySelectorAll('[data-cause]').forEach(b => b.onclick = async () => {
        const on = !b.classList.contains('on');
        await save({ cause: on ? b.dataset.cause : '' }); rer();
      });
      const ls = res.querySelector('.rv-box .wn-lesson'), mo = res.querySelector('.rv-box .wn-memo');
      if (ls) {
        ls.oninput = () => { clearTimeout(ls.t); ls.t = setTimeout(() => save({ lesson: ls.value }), 500); };
        ls.onchange = () => { clearTimeout(ls.t); save({ lesson: ls.value }).then(rer); }; // 칸을 벗어나면 단계 표시 갱신
      }
      if (mo) mo.oninput = () => { clearTimeout(mo.t); mo.t = setTimeout(() => save({ memo: mo.value }), 500); };
      // 질문노트에 넣기/빼기 + 질문 메모
      res.querySelector('[data-ask]').onclick = async () => {
        const n = qn[qid];
        if (n) {
          if (n.note && !await U.confirm('질문노트에서 뺄까요?', '적어 둔 질문 메모도 함께 지워져요.', '빼기')) return;
          await Store.del('qnotes', qid); QNotes.uncache(qid); toast('질문노트에서 뺐어요');
        } else {
          await onAsk(qid, true, '');
          const v = await QNotes.get(qid);
          if (v) { Object.assign(v, { response: x.it.response, correct: x.it.correct, date: a.date, aid: a.aid, hl: x.it.hl }); await Store.put('qnotes', v); }
          toast('질문노트에 넣었어요');
        }
        await rer();
        if (!n) view().querySelector(`.res[data-i="${x.i}"] .ask-note`)?.focus();
      };
      const an = res.querySelector('.ask-note');
      if (an) an.oninput = () => { const n = qn[qid]; n.note = an.value; n.updatedAt = Date.now(); clearTimeout(an.t); an.t = setTimeout(() => Store.put('qnotes', n), 500); };
      const redo = res.querySelector('[data-redo]');
      if (redo) redo.onclick = () => { WrongNotes.focus(qid); location.hash = '#wrong'; };
      const add = res.querySelector('[data-add]');
      if (add) add.onclick = async () => { await save({}); toast('오답노트에 넣었어요'); rer(); };
      const un = res.querySelector('[data-unadd]');
      if (un) un.onclick = async () => { await WrongNotes.saveNote(qid, { added: false }); toast('오답노트에서 뺐어요'); rer(); };
    });
    V.querySelectorAll('[data-guess]').forEach(b => b.onclick = async () => {
      const it = a.items[+b.dataset.guess]; it.guess = !it.guess || undefined;
      await Store.put('attempts', a); rer();
      if (it.guess) toast('찍어서 맞힌 문제도 복습 대상이에요');
    });
    V.querySelectorAll('.res-row').forEach(r => r.onclick = async e => {
      if (e.target.closest('button')) return;
      const res = r.parentElement, d = res.querySelector('.res-detail');
      const x = all[+res.dataset.i], it = x.it;
      if (d.hidden && peekAns(x)) {
        const go = await U.confirm('해설이 보이는 문제 화면을 열까요?', '해설 보기 전에 먼저 다시 풀어 보세요. 다시 풀어도 안 풀릴 때 해설을 보면 돼요.', '그래도 보기');
        if (!go) return;
        (attemptView.peek = attemptView.peek || new Set()).add(x.i);
        const pk = res.querySelector('.ans-peek'); if (pk) pk.outerHTML = `<b>${U.esc((qmap[it.qid] || {}).answer || it.answer || '?')}</b>`;
      }
      if (d.hidden) { d.innerHTML = '<p class="muted">불러오는 중…</p>'; hydrateOrToast([qmap[it.qid]]).then(() => { d.innerHTML = (it.hl ? '<p class="hl-note">🖍️ 풀 때 칠한 형광펜이 함께 보입니다</p>' : '') + qCard(qmap[it.qid], { response: it.response, hl: it.hl }); }); }
      d.hidden = !d.hidden;
    });
    V.querySelector('[data-act="retry"]')?.addEventListener('click', () => {
      sel.clear(); a.items.filter(i => !i.correct && qmap[i.qid]).forEach(i => sel.add(i.qid));
      F.test = 'all'; F.skills.clear(); F.diff.clear(); F.status.clear(); F.q = '';
      location.hash = '#bank'; toast(`틀린 ${sel.size}문항을 선택했습니다. 시험 시작을 누르세요.`);
    });
  }

  /* ---------- 오답노트 ---------- */
  function wrongView() {
    const ever = !!wrongView.ever;
    const list = questions.filter(q => status[q.id] && (ever ? status[q.id].wrong > 0 : status[q.id].last === false));
    const groups = {};
    list.forEach(q => (groups[q.domain || '미분류'] = groups[q.domain || '미분류'] || []).push(q));
    view().innerHTML = `<div class="page">
      <h1>오답노트</h1>
      <div class="toolbar">
        <div class="seg"><button class="${!ever ? 'on' : ''}" data-ever="0">최근 풀이에서 틀린 문제</button><button class="${ever ? 'on' : ''}" data-ever="1">한 번이라도 틀린 문제</button></div>
        <span class="muted">${list.length}문항</span>
        <div class="spacer"></div>
        ${list.length ? '<button class="btn primary" data-act="retry-all">전부 다시 풀기</button>' : ''}
      </div>
      ${list.length ? '' : '<p class="muted">틀린 문제가 없습니다.</p>'}
      ${Object.entries(groups).map(([d, qs]) => `<h3 class="wgroup">${U.esc(d)} <span class="muted">${qs.length}</span></h3>
        <div class="res-list">${qs.map(q => {
          const s = status[q.id];
          return `<div class="res" data-id="${U.esc(q.id)}"><div class="res-row">
            <span class="rec big ${s.last ? 'ok' : 'no'}">${s.last ? '✓' : '✗'}</span>
            ${tBadge(q.test)} ${dBadge(q.difficulty)} <span class="res-cat">${U.esc(q.skill || '')}</span>
            <span class="res-a">틀린 횟수 <b>${s.wrong}</b> / ${s.n} · 마지막 ${U.esc(s.lastDate)} · 마지막 답 <b>${U.esc(s.lastResp || '—')}</b></span>
          </div><div class="res-detail" hidden></div></div>`;
        }).join('')}</div>`).join('')}
    </div>`;
    const V = view();
    V.querySelectorAll('[data-ever]').forEach(b => b.onclick = () => { wrongView.ever = b.dataset.ever === '1'; wrongView(); });
    V.querySelectorAll('.res-row').forEach(r => r.onclick = () => {
      const res = r.parentElement, d = res.querySelector('.res-detail');
      if (d.hidden) { d.innerHTML = '<p class="muted">불러오는 중…</p>'; hydrateOrToast([qmap[res.dataset.id]]).then(() => { d.innerHTML = qCard(qmap[res.dataset.id], { response: status[res.dataset.id].lastResp }); }); }
      d.hidden = !d.hidden;
    });
    V.querySelector('[data-act="retry-all"]')?.addEventListener('click', () => {
      sel.clear(); list.forEach(q => sel.add(q.id));
      F.test = 'all'; F.skills.clear(); F.diff.clear(); F.status.clear(); F.q = '';
      location.hash = '#bank'; toast(`${sel.size}문항을 선택했습니다. 시험 시작을 누르세요.`);
    });
  }

  /* ---------- 설정 ---------- */
  function settingsView() {
    const s = settings();
    view().innerHTML = `<div class="page narrow">
      <h1>설정</h1>
      <div class="form">
        <label>시험 화면에 표시할 이름<input id="s-name" value="${U.esc(s.name || '')}" placeholder="Student"></label>
        <label>문제 글자 크기 <span class="muted sm" id="zv">${Math.round((parseFloat(s.zoom) || 0.85) * 100)}%</span>
          <input type="range" id="s-zoom" min="0.5" max="1.1" step="0.02" value="${parseFloat(s.zoom) || 0.85}"></label>
        <button class="btn primary" id="s-save">저장</button>
      </div>
      ${Store.mode === 'google' ? `<h2>기본 문제 (College Board)</h2>
      <p class="muted" id="bank-st">확인하는 중…</p>
      <div class="row" id="bank-row"></div>` : ''}
      <h2>데이터 백업</h2>
      <p class="muted">${Store.mode === 'google' ? `문제와 기록은 Google 계정(${U.esc(Store.user.email)})에 저장되어 어느 기기에서나 같습니다.` : Store.mode === 'cloud' ? '문제와 기록은 이 페이지에 저장되어 어느 기기에서나 같습니다. 컴퓨터에서만 쓰던 버전(start.command)의 백업 파일을 여기서 불러오면 옮겨집니다.' : '문제와 기록은 이 브라우저(이 주소)에만 저장됩니다. 다른 컴퓨터로 옮기거나 브라우저 데이터를 지우기 전에 백업하세요.'}</p>
      <div class="row">
        <button class="btn" id="b-exp">백업 파일 저장 (.json)</button>
        <label class="btn">백업 불러오기<input type="file" id="b-imp" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted sm" id="b-msg"></p>
      ${dupUploads.length ? `<h2>중복 정리</h2>
      <p class="muted">예전에 이미지로 올린 문제 ${dupUploads.length}개가 기본 문제(텍스트)와 같은 문제라서 목록에서 숨겨져 있습니다. 지우면 저장 공간이 정리됩니다. 풀이 기록에는 영향이 없습니다.</p>
      <div class="row"><button class="btn danger" id="r-dup">이미지로 올린 중복 문제 ${dupUploads.length}개 삭제</button></div>` : ''}
      <h2>초기화</h2>
      <div class="row"><button class="btn danger" id="r-att">풀이 기록 모두 삭제</button><button class="btn danger" id="r-all">업로드한 문제·기록 모두 삭제</button></div>
    </div>`;
    const $ = id => document.getElementById(id);
    $('s-zoom').oninput = () => { $('zv').textContent = Math.round($('s-zoom').value * 100) + '%'; };
    $('s-save').onclick = () => { setSettings({ name: $('s-name').value.trim(), zoom: $('s-zoom').value }); toast('저장했습니다'); };
    $('b-exp').onclick = exportBackup;
    if (Store.mode === 'google') bankStatus();
    $('b-imp').onchange = e => importBackup(e.target.files[0]);
    const wipe = async stores => {
      const m = modal(`<h2>삭제하는 중…</h2><p id="w-msg" class="muted">준비 중</p><div class="bar"><i id="w-bar" style="width:0"></i></div>
        <p class="muted sm">창을 닫거나 다른 페이지로 이동하지 마세요.</p>`);
      m.querySelector('.modal-x').remove();
      const msg = m.querySelector('#w-msg'), bar = m.querySelector('#w-bar');
      try {
        for (const st of stores) {
          await Store.clear(st, (i, t) => { msg.textContent = `${st === 'questions' ? '문제' : '기록'} ${i} / ${t}`; bar.style.width = Math.round(i / t * 100) + '%'; });
        }
        sel.clear(); await load();
        closeModal(); toast('모두 삭제했습니다');
      } catch (e) {
        console.error(e);
        await load().catch(() => {});
        msg.innerHTML = `<span class="no">중간에 멈췄습니다 (${U.esc(e.message || e.code || e)}). 잠시 후 다시 누르면 남은 것부터 이어서 지웁니다.</span>`;
        m.querySelector('.modal').insertAdjacentHTML('beforeend', '<div class="modal-btns"><button class="btn" data-close>닫기</button></div>');
      }
    };
    $('r-dup') && ($('r-dup').onclick = async () => {
      if (!await U.confirm(`이미지로 올린 중복 문제 ${dupUploads.length}개를 삭제할까요?`, '같은 문제가 텍스트로 이미 들어 있습니다. 되돌릴 수 없습니다.', '삭제')) return;
      const list = [...dupUploads];
      const m = modal(`<h2>정리하는 중…</h2><p id="w-msg" class="muted">0 / ${list.length}</p><div class="bar"><i id="w-bar" style="width:0"></i></div><p class="muted sm">창을 닫지 마세요.</p>`);
      m.querySelector('.modal-x').remove();
      let n = 0;
      try {
        const queue = [...list];
        const worker = async () => { while (queue.length) { const q = queue.shift(); await Store.del('questions', q.id, q); n++; m.querySelector('#w-msg').textContent = `${n} / ${list.length}`; m.querySelector('#w-bar').style.width = Math.round(n / list.length * 100) + '%'; } };
        await Promise.all([worker(), worker(), worker()]);
        await load(); closeModal(); toast('중복 문제를 정리했습니다'); route();
      } catch (e) {
        console.error(e); await load().catch(() => {});
        m.querySelector('#w-msg').innerHTML = `<span class="no">중간에 멈췄습니다 (${U.esc(e.message || e.code || e)}). 다시 누르면 남은 것부터 지웁니다.</span>`;
        m.querySelector('.modal').insertAdjacentHTML('beforeend', '<div class="modal-btns"><button class="btn" data-close>닫기</button></div>');
      }
    });
    $('r-att').onclick = async () => { if (await U.confirm('풀이 기록을 모두 삭제할까요?', '되돌릴 수 없습니다.', '삭제')) wipe(['attempts']); };
    $('r-all').onclick = async () => { if (await U.confirm('업로드한 문제와 풀이 기록을 모두 삭제할까요?', '기본으로 들어 있는 College Board 문제는 그대로 남습니다. 되돌릴 수 없습니다.', '삭제')) wipe(['attempts', 'questions']); };
  }

  const BLOB_KEYS = ['stemImg', 'passageImg', 'promptImg', 'rationaleImg'];
  const toDataURL = b => new Promise(r => { if (!b) return r(null); const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  const fromDataURL = async d => d ? await (await fetch(d)).blob() : null;

  async function exportBackup() {
    const msg = document.getElementById('b-msg');
    msg.textContent = '백업 파일 만드는 중…';
    const qs = [];
    // 기본 문제(College Board)는 양쪽에 이미 있으니 빼고, 내가 올린 문제만
    const mine = questions.filter(q => !q.bank);
    await hydrateOrToast(mine, (n, t) => { msg.textContent = `이미지 불러오는 중 ${n}/${t}`; });
    for (const q of mine) {
      const o = { ...q };
      delete o.sprite; delete o.parts; delete o._k;
      for (const k of BLOB_KEYS) o[k] = await toDataURL(q[k]);
      o.choiceImgs = await Promise.all((q.choiceImgs || []).map(toDataURL));
      qs.push(o);
    }
    attempts = await Store.all('attempts');
    const vocab = await Store.all('vocab').catch(() => []);
    const qnotes = await Store.all('qnotes').catch(() => []);
    const wnotes = await Store.all('wnotes').catch(() => []);
    const blob = new Blob([JSON.stringify({ app: 'sat-practice-bank', version: 3, exportedAt: new Date().toISOString(), questions: qs, attempts, vocab, qnotes, wnotes })], { type: 'application/json' });
    try { await Store.saveFile(`sat-backup-${U.today()}.json`, blob); }
    catch (e) { msg.textContent = e.code === 'declined' ? '저장을 취소했습니다.' : '저장하지 못했습니다: ' + (e.message || e.code); return; }
    msg.textContent = `올린 문제 ${qs.length}개, 풀이 기록 ${attempts.length}개, 영단어 ${vocab.length}개, 질문노트 ${qnotes.length}개를 백업했습니다.`;
  }

  async function importBackup(file) {
    if (!file) return;
    const msg = document.getElementById('b-msg');
    try {
      msg.textContent = '불러오는 중…';
      const data = JSON.parse(await file.text());
      if (data.app !== 'sat-practice-bank') throw new Error('이 사이트의 백업 파일이 아닙니다.');
      for (const o of data.questions || []) {
        for (const k of BLOB_KEYS) o[k] = await fromDataURL(o[k]);
        o.choiceImgs = await Promise.all((o.choiceImgs || []).map(fromDataURL));
        if (qmap[o.id]) continue;
        await Store.put('questions', o);
      }
      const existing = new Set((await Store.all('attempts')).map(a => a.createdAt));
      let na = 0, nv = 0, nq = 0;
      for (const a of data.attempts || []) {
        if (existing.has(a.createdAt)) continue;
        delete a.aid; delete a._k; await Store.put('attempts', a); na++;
      }
      // 영단어: 이미 있는 단어는 건너뜀
      const haveV = new Set((await Store.all('vocab').catch(() => [])).map(v => v.id));
      for (const v of data.vocab || []) { if (haveV.has(v.id)) continue; delete v._k; await Store.put('vocab', v); nv++; }
      // 질문노트: 같은 문제면 더 최근에 고친 쪽을 남김
      const haveQ = Object.fromEntries((await Store.all('qnotes').catch(() => [])).map(n => [n.id, n]));
      for (const n of data.qnotes || []) {
        const cur = haveQ[n.id];
        if (cur && (cur.updatedAt || cur.addedAt || 0) >= (n.updatedAt || n.addedAt || 0)) continue;
        delete n._k; await Store.put('qnotes', n); nq++;
      }
      const haveW = Object.fromEntries((await Store.all('wnotes').catch(() => [])).map(w => [w.id, w]));
      for (const w of data.wnotes || []) {
        const cur = haveW[w.id];
        if (cur && (cur.updatedAt || 0) >= (w.updatedAt || 0)) continue;
        delete w._k; await Store.put('wnotes', w);
      }
      await load(); await Vocab.load();
      msg.textContent = `새로 합친 것: 풀이 기록 ${na}개, 영단어 ${nv}개, 질문노트 ${nq}개 (이미 있던 것은 건너뜀)`;
    } catch (e) { msg.textContent = '불러오기 실패: ' + e.message; }
  }

  // Google 계정에 기본 문제가 있는지 + (이 컴퓨터 버전이면) 올리기 버튼
  async function bankStatus() {
    const st = document.getElementById('bank-st'), row = document.getElementById('bank-row');
    if (!st) return;
    const has = await Store.bankInAccount();
    if (has) { st.textContent = '기본 문제 2,322개가 내 Google 계정에 들어 있어요. 로그인한 모든 기기에서 보이고, 나만 볼 수 있어요.'; row.innerHTML = window.SAT_BANK ? '<button class="btn" id="bank-up">다시 올리기</button>' : ''; }
    else if (window.SAT_BANK) { st.textContent = '기본 문제를 내 Google 계정에 올리면 휴대폰·태블릿 등 다른 기기에서도 보여요. (처음 한 번만, 약 10MB)'; row.innerHTML = '<button class="btn primary" id="bank-up">기본 문제 내 계정에 올리기</button>'; }
    else { st.textContent = '기본 문제가 아직 계정에 없어요. 컴퓨터 버전(start.command)에서 로그인한 뒤 이 화면에서 올려주세요.'; row.innerHTML = ''; }
    const b = document.getElementById('bank-up');
    if (b) b.onclick = async () => {
      b.disabled = true;
      try { await Store.uploadBank((i, n) => { b.textContent = `올리는 중 ${i}/${n}`; }); toast('기본 문제를 계정에 올렸어요'); }
      catch (e) { console.error(e); toast('올리지 못했어요: ' + (e.message || e.code)); }
      bankStatus();
    };
  }

  // Google 로그인 직후, 이 컴퓨터에 있는 기본 문제를 계정에 올릴지 한 번 물어봄
  async function offerBankUpload() {
    if (Store.mode !== 'google' || !window.SAT_BANK) return;
    try { if (localStorage.getItem('sat-bank-asked')) return; } catch (e) {}
    if (await Store.bankInAccount()) return;
    const m = modal(`<h2>기본 문제를 내 계정에 올릴까요?</h2>
      <p>College Board 기본 문제 2,322개를 내 Google 계정에 저장하면, 같은 계정으로 로그인한 휴대폰·태블릿에서도 보입니다. 나만 볼 수 있게 저장돼요.</p>
      <p class="muted sm" id="bu-msg">처음 한 번만 하면 됩니다 (약 10MB).</p>
      <div class="modal-btns"><button class="btn" id="bu-no">나중에</button><button class="btn primary" id="bu-go">올리기</button></div>`);
    m.querySelector('#bu-no').onclick = () => { try { localStorage.setItem('sat-bank-asked', '1'); } catch (e) {} closeModal(); };
    m.querySelector('#bu-go').onclick = async () => {
      const b = m.querySelector('#bu-go'); b.disabled = true;
      try { await Store.uploadBank((i, n) => { m.querySelector('#bu-msg').textContent = `올리는 중 ${i}/${n}`; }); try { localStorage.setItem('sat-bank-asked', '1'); } catch (e) {} closeModal(); toast('기본 문제를 계정에 올렸어요'); }
      catch (e) { m.querySelector('#bu-msg').textContent = '올리지 못했어요: ' + (e.message || e.code); b.disabled = false; }
    };
  }

  /* ---------- 앱 설치 (홈 화면 / 크롬 앱) ---------- */
  let installEvt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function setupInstall() {
    const b = document.getElementById('installBtn');
    if (!b || isStandalone() || (window.claude && window.claude.use)) return;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; b.hidden = false; });
    window.addEventListener('appinstalled', () => { b.hidden = true; toast('앱으로 설치했어요. 바탕화면·홈 화면의 SAT 아이콘으로 여세요'); });
    if (isIOS()) b.hidden = false; // 아이폰·아이패드는 직접 안내
    b.onclick = async () => {
      if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r && r.outcome === 'accepted') b.hidden = true; installEvt = null; return; }
      modal(`<h2>앱으로 설치하기</h2>
        <ol class="howto">
          <li><b>아이폰·아이패드 (Safari):</b> 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b> → <b>추가</b></li>
          <li><b>안드로이드 (크롬):</b> 오른쪽 위 <b>⋮</b> → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b></li>
          <li><b>컴퓨터 (크롬):</b> 주소창 오른쪽의 <b>설치 아이콘(⊕)</b> → <b>설치</b></li>
        </ol>
        <p class="muted sm">설치하면 주소창 없이 앱처럼 열리고, 인터넷이 없어도 열립니다.</p>
        <div class="modal-btns"><button class="btn primary" data-close>확인</button></div>`);
    };
  }

  /* ---------- Google 로그인 ---------- */
  function renderAccount() {
    const box = document.getElementById('account');
    if (!box) return;
    if (!Store.googleReady) { box.innerHTML = ''; return; }
    const u = Store.user;
    if (u) {
      box.innerHTML = `<div class="acct">${u.photo ? `<img src="${U.esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : ''}
        <span class="acct-name" title="${U.esc(u.email)}">${U.esc(u.name || u.email)}</span>
        <button class="btn ghost sm" id="logout">로그아웃</button></div>`;
      box.querySelector('#logout').onclick = async () => { if (await U.confirm('로그아웃할까요?', '로그아웃하면 이 브라우저에 따로 저장된 데이터가 보입니다.', '로그아웃')) Store.signOut(); };
    } else {
      box.innerHTML = `<button class="btn gbtn" id="login"><svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Google로 로그인</button>`;
      box.querySelector('#login').onclick = async () => {
        try { await Store.signIn(); } catch (e) { console.error(e); toast('로그인하지 못했습니다: ' + (e.message || e.code)); }
      };
    }
  }

  async function offerLocalMove() {
    let n = 0;
    try { if (localStorage.getItem('sat-local-moved')) return; n = await Store.localCount(); } catch (e) { return; }
    if (!n) return;
    const m = modal(`<h2>이 브라우저에 저장된 데이터가 있어요</h2>
      <p>로그인 전에 이 브라우저에 저장한 문제와 풀이 기록을 Google 계정으로 옮길까요? 옮기면 다른 기기에서도 보입니다.</p>
      <p class="muted sm" id="mv-msg"></p>
      <div class="modal-btns"><button class="btn" id="mv-no">나중에</button><button class="btn primary" id="mv-go">계정으로 옮기기</button></div>`);
    m.querySelector('#mv-no').onclick = () => { try { localStorage.setItem('sat-local-moved', '1'); } catch (e) {} closeModal(); };
    m.querySelector('#mv-go').onclick = async () => {
      const b = m.querySelector('#mv-go'); b.disabled = true;
      try {
        const r = await Store.importLocal((i, t) => { m.querySelector('#mv-msg').textContent = `옮기는 중 ${i}/${t}`; });
        try { localStorage.setItem('sat-local-moved', '1'); } catch (e) {}
        closeModal(); toast(`문제 ${r.q}개, 기록 ${r.a}개를 옮겼습니다`); await load(); route();
      } catch (e) { console.error(e); m.querySelector('#mv-msg').textContent = '옮기지 못했습니다: ' + (e.message || e.code); b.disabled = false; }
    };
  }

  /* ---------- 질문노트 ---------- */
  const QNotes = (() => {
    let list = null;
    const F2 = { show: 'open' };
    async function all() { if (!list) { try { list = await Store.all('qnotes'); } catch (e) { list = []; } } return list; }
    const get = async id => (await all()).find(n => n.qid === id) || null;
    const cache = v => { if (list && !list.includes(v)) list.push(v); };
    const uncache = id => { if (list) list = list.filter(n => n.qid !== id); };

    function textList(items) {
      return items.map((n, i) => {
        const q = qmap[n.qid] || {};
        return `${i + 1}. [${q.test === 'MATH' ? 'Math' : 'R&W'} · ${q.skill || q.domain || ''} · ${DIFF_KO[q.difficulty || '']}] 문제 ID ${n.qid}`
          + (n.response !== undefined ? ` — 내 답 ${n.response || '무응답'} / 정답 ${q.answer || '?'}` : '')
          + (n.note ? `\n   질문: ${n.note}` : '');
      }).join('\n');
    }

    async function view(el) {
      const items = (await all()).slice().sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));
      const shown = items.filter(n => F2.show === 'all' || (F2.show === 'open' ? !n.resolved : n.resolved));
      const open = items.filter(n => !n.resolved).length;
      el.innerHTML = `<div class="page">
        <div class="voc-head"><div><h1>질문노트</h1><p class="muted">시험 중 문제 위의 <b>☑ 선생님께 질문</b>을 체크하거나, 풀이 기록에서 <b>❓ 질문하기</b>를 누르면 여기에 모입니다. 무엇을 물어볼지 메모해 두세요.</p></div>
          ${shown.length ? '<button class="btn" id="qn-copy">질문 목록 복사</button>' : ''}</div>
        <div class="toolbar"><div class="seg">${[['open', `물어볼 질문 ${open}`], ['done', `해결됨 ${items.length - open}`], ['all', `전체 ${items.length}`]].map(([v, l]) => `<button class="${F2.show === v ? 'on' : ''}" data-qs="${v}">${l}</button>`).join('')}</div>
          <div class="spacer"></div>${shown.filter(n => qmap[n.qid]).length ? '<button class="btn primary" id="qn-retry">이 문제들 다시 풀기</button>' : ''}</div>
        ${items.length ? '' : `<div class="empty"><div class="empty-icon">🙋</div><h2>아직 질문이 없어요</h2><p>시험을 풀다가 모르는 문제에서 <b>선생님께 질문</b>을 체크하세요.</p></div>`}
        ${items.length && !shown.length ? '<p class="muted">이 목록은 비어 있어요.</p>' : ''}
        <div class="res-list">${shown.map(n => {
          const q = qmap[n.qid];
          return `<div class="res qn ${n.resolved ? 'resolved' : ''}" data-id="${U.esc(n.qid)}">
            <div class="res-row">
              ${q ? `${tBadge(q.test)} ${dBadge(q.difficulty)} <span class="res-cat">${U.esc(q.skill || q.domain || '')}</span>` : '<span class="muted">삭제된 문제</span>'}
              ${n.response !== undefined ? `<span class="rec ${n.correct ? 'ok' : 'no'}">${n.correct ? '✓' : '✗'}</span><span class="muted sm">내 답 ${U.esc(n.response || '—')} · 정답 ${U.esc(q ? q.answer : '?')}</span>` : '<span class="muted sm">아직 제출 전</span>'}
              <span class="res-a muted sm">${n.date ? U.esc(n.date) : new Date(n.addedAt).toLocaleDateString('ko-KR')}</span>
              <button class="btn sm ghost" data-toggle>문제 보기</button>
            </div>
            <div class="qn-body">
              <textarea class="qn-note" placeholder="선생님께 물어볼 내용을 적어두세요 (예: B가 왜 틀렸는지 모르겠어요)" rows="2">${U.esc(n.note || '')}</textarea>
              <div class="qn-side"><label class="chk inline"><input type="checkbox" data-done ${n.resolved ? 'checked' : ''}> 해결됨</label><button class="btn ghost sm danger" data-del>삭제</button></div>
            </div>
            <div class="res-detail" hidden></div>
          </div>`;
        }).join('')}</div></div>`;
      const rer = () => view(el);
      el.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => { F2.show = b.dataset.qs; rer(); });
      el.querySelector('#qn-copy') && (el.querySelector('#qn-copy').onclick = async () => {
        const txt = '선생님께 질문할 SAT 문제\n\n' + textList(shown);
        try { await navigator.clipboard.writeText(txt); toast('복사했어요. 메시지에 붙여넣으세요'); }
        catch (e) { modal(`<h2>질문 목록</h2><textarea class="qn-copybox" rows="12" readonly>${U.esc(txt)}</textarea><p class="muted sm">전체 선택(Cmd+A) 후 복사하세요.</p>`); }
      });
      el.querySelector('#qn-retry') && (el.querySelector('#qn-retry').onclick = () => {
        sel.clear(); shown.forEach(n => qmap[n.qid] && sel.add(n.qid));
        F.test = 'all'; F.skills.clear(); F.diff.clear(); F.status.clear(); F.q = ''; F.src = 'all';
        location.hash = '#bank'; toast(`${sel.size}문항을 선택했어요. 시험 시작을 누르세요`);
      });
      el.querySelectorAll('.qn').forEach(row => {
        const n = items.find(x => x.qid === row.dataset.id);
        let t = null;
        row.querySelector('.qn-note').oninput = e => { n.note = e.target.value; n.updatedAt = Date.now(); clearTimeout(t); t = setTimeout(() => Store.put('qnotes', n), 600); };
        row.querySelector('[data-done]').onchange = async e => { n.resolved = e.target.checked; await Store.put('qnotes', n); toast(n.resolved ? '해결됨으로 표시했어요' : '다시 물어볼 질문으로 옮겼어요'); rer(); };
        row.querySelector('[data-del]').onclick = async () => { if (!await U.confirm('이 질문을 삭제할까요?', '', '삭제')) return; await Store.del('qnotes', n.qid); uncache(n.qid); rer(); };
        row.querySelector('[data-toggle]').onclick = () => {
          const d = row.querySelector('.res-detail');
          if (d.hidden) { d.innerHTML = '<p class="muted">불러오는 중…</p>'; hydrateOrToast([qmap[n.qid]]).then(() => { d.innerHTML = qCard(qmap[n.qid], { response: n.response, hl: n.hl }); }); }
          d.hidden = !d.hidden;
        };
      });
    }
    return { view, get, cache, uncache, all };
  })();

  /* ---------- 라우터 ---------- */
  function route() {
    if (Exam.active()) return;
    if (job.running) setTimeout(renderJobBadge, 0);
    const h = location.hash || '#bank';
    const key = h.startsWith('#attempt-') ? '#history' : h;
    document.querySelectorAll('.topbar nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === key));
    window.scrollTo(0, 0);
    if (h.startsWith('#import')) importView();
    else if (h.startsWith('#history')) historyView();
    else if (h.startsWith('#attempt-')) attemptView(decodeURIComponent(h.slice(9)));
    else if (h.startsWith('#wrong')) WrongNotes.view(view());
    else if (h.startsWith('#settings')) settingsView();
    else if (h.startsWith('#vocab')) Vocab.view(view());
    else if (h.startsWith('#qnotes')) QNotes.view(view());
    else bankView();
  }

  async function init() {
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdf.worker.min.js', location.href).href;
    U.watchImages();
    WrongNotes.init({
      getQ: id => qmap[id], attempts: () => attempts, toast,
      hydrate: qs => hydrateOrToast(qs),
      practice: practiceSkill,
      retryInExam: qids => { sel.clear(); qids.forEach(id => qmap[id] && sel.add(id)); F.test = 'all'; F.skills.clear(); F.diff.clear(); F.status.clear(); F.q = ''; F.src = 'all'; location.hash = '#bank'; toast(`${sel.size}문항을 선택했어요. 시험 시작을 누르세요`); },
    });
    setupInstall();
    Vocab.init({ modal, closeModal, toast, preview: id => (qmap[id] ? preview(id) : toast('문제를 찾을 수 없어요')), refresh: () => { if ((location.hash || '').startsWith('#vocab')) route(); } });
    await Store.init();
    const mb = document.getElementById('modeBadge');
    if (mb) { mb.textContent = { cloud: '☁ 모든 기기에서 동기화', google: '☁ Google 계정에 저장' }[Store.mode] || '이 기기에만 저장'; mb.className = 'mode ' + Store.mode; }
    renderAccount();
    Store.onAuthChange(() => location.reload());
    try { await load(); } catch (e) { console.error(e); toast('데이터를 불러오지 못했습니다: ' + (e.message || e.code)); }
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => setTimeout(() => { syncPending(); fillVocab(); }, 1500));
    syncPending();
    resumeJobs();
    route();
    const p = Exam.pending();
    if (!p && Store.mode === 'google') { offerLocalMove(); setTimeout(offerBankUpload, 1500); }
    if (p && !p.suspended) {
      const m = modal(`<h2>진행 중이던 시험이 있습니다</h2>
        <p>${U.esc(p.date)} · ${p.modules.map(x => `${U.TEST_NAME[x.test]} ${x.qids.length}문항`).join(', ')}</p>
        <p class="muted">이어서 풀면 재접속이 이탈 기록으로 남습니다. 타이머는 그동안에도 계속 흘렀습니다.</p>
        <div class="modal-btns"><button class="btn danger" id="p-del">기록 없이 버리기</button><div class="spacer"></div><button class="btn primary" id="p-go">이어서 풀기</button></div>`);
      m.querySelector('#p-del').onclick = () => { Exam.discard(); closeModal(); };
      m.querySelector('#p-go').onclick = () => resumeExam(p, m.querySelector('#p-go'));
    }
  }

  return { init };
})();

App.init();
