/* 오답노트: "왜 틀리는지 버릇 찾기"
 * - 틀린 문제 + 찍어서 맞힌 문제 + 맞았지만 오래 걸린 문제를 자동으로 모음
 * - 틀린 이유 4가지(개념·실수·시간·전략)로 분류하고 원인별로 묶어 보기
 * - 해설을 보기 전에 다시 풀기 → 다시 맞히면 3일·7일 뒤 다시 등장, 두 번 연속 맞히면 졸업
 * - 문제마다 "다음엔 기억할 한 줄"
 */
const WrongNotes = (() => {
  let ctx = null;         // { getQ, attempts, qCard, hydrate, modal, closeModal, toast, practice, retryInExam }
  let meta = null;        // qid -> 저장된 기록 { cause, lesson, retries:[{at, ok, resp}], nextAt, mastered }
  const F = { tab: 'today' };
  const open = new Set(); // 펼쳐진 카드
  const revealed = new Set(); // 이번에 해설을 연 카드

  const CAUSES = [
    ['concept', '개념 부족', '공식·문법·뜻을 몰랐어요'],
    ['mistake', '실수', '알았는데 잘못 읽거나 계산했어요'],
    ['time', '시간 부족', '시간에 쫓겨 서두르거나 못 풀었어요'],
    ['strategy', '전략 오류', '푸는 방법·접근을 잘못 골랐어요'],
  ];
  const CAUSE_NAME = Object.fromEntries(CAUSES.map(c => [c[0], c[1]]));
  const KIND = { wrong: ['✗', '틀림', 'no'], guess: ['?', '찍어서 맞힘', 'guess'], slow: ['⏱', '오래 걸림', 'slow'] };
  const DAY = 86400000;
  const slowLimit = test => Math.round(U.RATE[test === 'MATH' ? 'MATH' : 'RW'] * 1.5); // 실제 SAT 문항당 시간의 1.5배
  const esc = s => U.esc(s);

  async function loadMeta() {
    if (meta) return meta;
    meta = {};
    try { (await Store.all('wnotes')).forEach(m => (meta[m.id] = m)); } catch (e) {}
    return meta;
  }
  function m(qid) { return meta[qid] || (meta[qid] = { id: qid, qid, cause: '', lesson: '', retries: [], mastered: false }); }
  async function saveMeta(qid) { const v = m(qid); v.updatedAt = Date.now(); try { await Store.put('wnotes', v); } catch (e) { console.error(e); } }

  // 풀이 기록에서 오답노트 대상 뽑기 (가장 최근 풀이 기준)
  function entries() {
    const latest = {}, count = {};
    const list = [...ctx.attempts()].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
    for (const a of list) for (const it of a.items) {
      latest[it.qid] = { it, date: a.date, aid: a.aid };
      const c = (count[it.qid] = count[it.qid] || { n: 0, wrong: 0 });
      c.n++; if (!it.correct) c.wrong++;
    }
    const out = [];
    for (const [qid, L] of Object.entries(latest)) {
      const it = L.it;
      const kind = !it.correct ? 'wrong' : it.guess ? 'guess' : (it.timeSpent || 0) > slowLimit(it.test) ? 'slow' : null;
      const mm = meta[qid];
      if (!kind && !mm) continue;
      out.push({ qid, kind: kind || 'fixed', it, date: L.date, aid: L.aid, count: count[qid], meta: m(qid) });
    }
    return out;
  }
  const active = e => e.kind !== 'fixed' && !e.meta.mastered;
  const due = e => active(e) && (!e.meta.nextAt || e.meta.nextAt <= Date.now());

  /* ---------- 다시 풀기 (해설 가리고) ---------- */
  function solverHTML(e) {
    const q = ctx.getQ(e.qid);
    if (!q) return '<p class="muted">문제를 찾을 수 없어요.</p>';
    const isText = q.kind === 'html';
    const pimg = b => (b ? `<img class="pimg" src="${U.url(b)}" alt="">` : '');
    const body = isText
      ? `${q.stim ? `<div class="q-text">${q.stim}</div>` : ''}<div class="q-text sv-stem">${q.stem}</div>`
      : q.passageImg && q.promptImg ? pimg(q.passageImg) + pimg(q.promptImg) : pimg(q.stemImg);
    const answer = q.type === 'mcq'
      ? `<div class="sv-choices">${['A', 'B', 'C', 'D'].map((L, i) => `<button class="sv-ch" data-l="${L}"><span class="qc-l">${L}</span><span class="sv-ct">${isText ? `<span class="q-choice">${(q.choices || [])[i] || ''}</span>` : pimg(q.choiceImgs && q.choiceImgs[i])}</span></button>`).join('')}</div>`
      : `<div class="sv-spr"><input class="sv-input" placeholder="답 입력 (예: 12, 3/4)" autocomplete="off"></div>`;
    return `<div class="solver" data-qid="${esc(e.qid)}">
      <p class="sv-tip">📝 <b>해설 보기 전에 다시 풀어보세요.</b> 처음부터 직접 풀고, 그래도 모르겠을 때 해설을 봐요.</p>
      <div class="sv-body">${body}</div>
      ${answer}
      <div class="sv-actions"><button class="btn primary sv-check">채점하기</button>
        <button class="link sm sv-peek">${revealed.has(e.qid) ? '해설 숨기기' : '해설 바로 보기'}</button></div>
      <div class="sv-result" aria-live="polite"></div>
      <div class="sv-rat" ${revealed.has(e.qid) ? '' : 'hidden'}>${q.rat ? `<div class="q-text">${q.rat}</div>` : q.rationaleImg ? pimg(q.rationaleImg) : '<p class="muted">해설이 없는 문제예요.</p>'}
        <p class="sv-ans">정답: <b>${esc(q.answer || '?')}</b></p></div>
    </div>`;
  }

  function bindSolver(card, e, rerender) {
    const sv = card.querySelector('.solver');
    if (!sv) return;
    const q = ctx.getQ(e.qid);
    let pick = null;
    sv.querySelectorAll('.sv-ch').forEach(b => b.onclick = () => {
      pick = b.dataset.l;
      sv.querySelectorAll('.sv-ch').forEach(x => x.classList.toggle('on', x === b));
    });
    const showRat = on => { sv.querySelector('.sv-rat').hidden = !on; on ? revealed.add(e.qid) : revealed.delete(e.qid); sv.querySelector('.sv-peek').textContent = on ? '해설 숨기기' : '해설 보기'; };
    sv.querySelector('.sv-peek').onclick = () => showRat(sv.querySelector('.sv-rat').hidden);
    sv.querySelector('.sv-check').onclick = async () => {
      const resp = q.type === 'mcq' ? pick : sv.querySelector('.sv-input').value.trim();
      if (!resp) { ctx.toast('답을 먼저 고르세요'); return; }
      const ok = U.isCorrect(q, resp);
      const mm = m(e.qid);
      mm.retries = [...(mm.retries || []), { at: Date.now(), ok, resp }].slice(-10);
      const last2 = mm.retries.slice(-2);
      // 간격 반복: 맞히면 3일 → 7일 뒤, 틀리면 내일 다시
      const streak = (() => { let n = 0; for (let i = mm.retries.length - 1; i >= 0 && mm.retries[i].ok; i--) n++; return n; })();
      mm.nextAt = Date.now() + (ok ? (streak >= 2 ? 7 : 3) * DAY : DAY);
      const graduate = ok && last2.length === 2 && last2.every(r => r.ok);
      if (graduate) mm.mastered = true;
      await saveMeta(e.qid);
      if (q.type === 'mcq') sv.querySelectorAll('.sv-ch').forEach(x => {
        x.classList.toggle('right', ok && x.dataset.l === resp);
        x.classList.toggle('wrongpick', !ok && x.dataset.l === resp);
      });
      sv.querySelector('.sv-result').innerHTML = ok
        ? `<div class="sv-ok">✓ 맞았어요! ${graduate ? '두 번 연속 맞혀서 <b>졸업</b>했어요 🎓' : `${streak >= 2 ? '7일' : '3일'} 뒤에 한 번 더 확인할게요.`}</div>`
        : `<div class="sv-no">✗ 아직 틀렸어요. 한 번 더 생각해 보고, 그래도 모르겠으면 <button class="link sv-open">해설 보기</button>. 내일 다시 나와요.</div>`;
      const o = sv.querySelector('.sv-open'); if (o) o.onclick = () => showRat(true);
      if (ok) showRat(true);
      if (graduate) setTimeout(rerender, 1800);
    };
  }

  /* ---------- 화면 ---------- */
  function card(e) {
    const q = ctx.getQ(e.qid) || {};
    const [ic, kname, kcls] = KIND[e.kind] || ['✓', '다시 맞힘', 'ok'];
    const r = e.meta.retries || [];
    const lastR = r[r.length - 1];
    const isOpen = open.has(e.qid);
    return `<div class="wn ${isOpen ? 'open' : ''}" data-qid="${esc(e.qid)}">
      <div class="wn-row">
        <span class="wn-kind ${kcls}" title="${kname}">${ic}</span>
        ${q.test ? `<span class="badge t-${q.test}">${q.test === 'RW' ? 'R&amp;W' : 'Math'}</span>` : ''}
        <span class="wn-skill">${esc(q.skill || q.domain || '문제')}</span>
        <span class="wn-meta">${kname} · 내 답 <b>${esc(e.it.response || '—')}</b> · 정답 <b>${esc(q.answer || e.it.answer || '?')}</b> · ${U.korDur(e.it.timeSpent || 0)}${e.count.wrong > 1 ? ` · <b class="no">${e.count.wrong}번 틀림</b>` : ''}</span>
        ${e.meta.cause ? `<span class="wn-cause c-${e.meta.cause}">${CAUSE_NAME[e.meta.cause]}</span>` : '<span class="wn-cause none">원인 미분류</span>'}
        ${lastR ? `<span class="wn-retry ${lastR.ok ? 'ok' : 'no'}">다시 풀기 ${lastR.ok ? '✓' : '✗'}</span>` : ''}
        <span class="wn-date">${esc(e.date || '')}</span>
      </div>
      ${e.meta.lesson && !isOpen ? `<div class="wn-lesson-view">💡 ${esc(e.meta.lesson)}</div>` : ''}
      ${isOpen ? `<div class="wn-body">
        <div class="wn-tagbox">
          <div class="wn-label">왜 틀렸나요?</div>
          <div class="wn-causes">${CAUSES.map(([k, n, d]) => `<button class="wn-c c-${k} ${e.meta.cause === k ? 'on' : ''}" data-cause="${k}" title="${d}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>
          <label class="wn-label" for="ls-${esc(e.qid)}">다음엔 이렇게 할게요 (한 줄)</label>
          <input class="wn-lesson" id="ls-${esc(e.qid)}" maxlength="120" value="${esc(e.meta.lesson || '')}" placeholder="예: 문제에 'NOT'이 나오면 동그라미 치기">
        </div>
        ${solverHTML(e)}
        <div class="wn-foot">
          ${q.skill ? `<button class="btn sm" data-practice>「${esc(q.skill)}」 문제은행에서 더 풀기</button>` : ''}
          <div class="spacer"></div>
          ${e.meta.mastered ? '<button class="btn sm ghost" data-unmaster>다시 복습 목록으로</button>' : '<button class="btn sm ghost" data-master>다 이해했어요 (졸업)</button>'}
        </div>
      </div>` : ''}
    </div>`;
  }

  function statsHTML(list) {
    const act = list.filter(active);
    if (!act.length) return '';
    const byKind = k => act.filter(e => e.kind === k).length;
    const tagged = act.filter(e => e.meta.cause);
    const causeCnt = CAUSES.map(([k, n]) => [k, n, tagged.filter(e => e.meta.cause === k).length]);
    const top = [...causeCnt].sort((a, b) => b[2] - a[2])[0];
    const skills = {};
    act.forEach(e => { const q = ctx.getQ(e.qid); if (q && q.skill) skills[q.skill] = (skills[q.skill] || 0) + 1; });
    const weak = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `<div class="wn-stats">
      <div class="wn-kpis">
        <div><b>${byKind('wrong')}</b><span>틀린 문제</span></div>
        <div><b>${byKind('guess')}</b><span>찍어서 맞힘</span></div>
        <div><b>${byKind('slow')}</b><span>오래 걸림</span></div>
        <div><b>${list.filter(e => e.meta.mastered).length}</b><span>졸업</span></div>
      </div>
      <div class="wn-insight">
        <div>
          <h3>내가 틀리는 이유</h3>
          ${tagged.length ? causeCnt.map(([k, n, c]) => `<div class="sbar"><span class="sbar-l">${n}</span><div class="sbar-t"><i class="c-${k}" style="width:${Math.round(c / tagged.length * 100)}%"></i></div><span class="sbar-v">${Math.round(c / tagged.length * 100)}% <span class="muted">(${c})</span></span></div>`).join('')
            + (top[2] ? `<p class="wn-tip">가장 많은 원인은 <b>${top[1]}</b>이에요. ${({ concept: '해당 개념을 먼저 정리하고 같은 유형을 몇 문제 더 풀어보세요.', mistake: '문제를 끝까지 읽고, 답을 고르기 전에 조건을 한 번 더 확인하는 습관을 들이세요.', time: '모르는 문제는 표시하고 넘어갔다가 마지막에 돌아오는 연습을 해보세요.', strategy: '해설의 풀이 방식을 따라 같은 유형을 다시 풀어보며 접근법을 익히세요.' })[top[0]]}</p>` : '')
            : '<p class="muted sm">문제를 펼쳐서 <b>왜 틀렸는지</b>를 골라주면 여기에 내 버릇이 보여요.</p>'}
        </div>
        <div>
          <h3>약한 유형</h3>
          ${weak.map(([s, c]) => `<div class="wn-weak"><span>${esc(s)} <span class="muted">${c}문제</span></span><button class="btn sm" data-weak="${esc(s)}">더 풀기</button></div>`).join('') || '<p class="muted sm">아직 없어요</p>'}
        </div>
      </div>
    </div>`;
  }

  async function view(el) {
    await loadMeta();
    const list = entries();
    const act = list.filter(active);
    const dueList = act.filter(due).sort((a, b) => (b.count.wrong - a.count.wrong) || ((a.meta.retries || []).length - (b.meta.retries || []).length) || (a.date || '').localeCompare(b.date || '')).slice(0, 5);
    const grads = list.filter(e => !active(e));
    const tab = F.tab;
    if (tab === 'today') dueList.forEach(e => open.add(e.qid));
    let body = '';
    if (tab === 'today') {
      body = dueList.length
        ? `<p class="muted wn-today-tip">오늘 다시 풀 ${dueList.length}문제예요. <b>해설을 보기 전에</b> 먼저 풀어보세요. 다시 맞히면 며칠 뒤 한 번 더 나오고, 두 번 연속 맞히면 졸업해요.</p>
           <div class="wn-list">${dueList.map(card).join('')}</div>`
        : `<div class="empty small"><div class="empty-icon">🎉</div><h2>오늘 복습할 문제를 다 했어요</h2><p class="muted">다시 풀 차례가 된 문제가 생기면 여기에 나타나요.</p></div>`;
    } else if (tab === 'all') {
      const groups = [['', '원인 미분류'], ...CAUSES.map(c => [c[0], c[1]])].map(([k, n]) => [k, n, act.filter(e => (e.meta.cause || '') === k)]).filter(g => g[2].length);
      body = act.length ? groups.map(([k, n, es]) => `<h3 class="wgroup"><span class="wn-cause ${k ? 'c-' + k : 'none'}">${n}</span> <span class="muted">${es.length}</span></h3><div class="wn-list">${es.map(card).join('')}</div>`).join('')
        : '<p class="muted">오답노트가 비어 있어요. 시험을 풀면 틀린 문제·찍은 문제·오래 걸린 문제가 자동으로 모여요.</p>';
    } else {
      body = grads.length ? `<p class="muted">두 번 연속 다시 맞혔거나 이후 시험에서 맞힌 문제예요.</p><div class="wn-list">${grads.map(card).join('')}</div>` : '<p class="muted">아직 졸업한 문제가 없어요.</p>';
    }
    el.innerHTML = `<div class="page">
      <div class="voc-head"><div><h1>오답노트</h1><p class="muted">틀린 문제를 모으는 곳이 아니라, <b>내가 왜 틀리는지 버릇을 찾는 곳</b>이에요.</p></div>
        ${act.length ? '<button class="btn" id="wn-exam">복습 문제로 시험 보기</button>' : ''}</div>
      ${statsHTML(list)}
      <div class="toolbar"><div class="seg">
        <button class="${tab === 'today' ? 'on' : ''}" data-tab="today">오늘의 복습 ${dueList.length}</button>
        <button class="${tab === 'all' ? 'on' : ''}" data-tab="all">원인별 전체 ${act.length}</button>
        <button class="${tab === 'done' ? 'on' : ''}" data-tab="done">졸업 ${grads.length}</button>
      </div></div>
      ${body}
    </div>`;
    const rer = () => view(el);
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { F.tab = b.dataset.tab; open.clear(); rer(); });
    el.querySelector('#wn-exam') && (el.querySelector('#wn-exam').onclick = () => ctx.retryInExam((tab === 'today' ? dueList : act).map(e => e.qid)));
    el.querySelectorAll('[data-weak]').forEach(b => b.onclick = () => ctx.practice(b.dataset.weak));
    // 펼친 카드의 문제 이미지 준비 후 연결
    const shown = list.filter(e => open.has(e.qid)).map(e => ctx.getQ(e.qid)).filter(Boolean);
    if (shown.some(q => q.kind !== 'html' && !q.stemImg)) { await ctx.hydrate(shown); return rer(); }
    el.querySelectorAll('.wn').forEach(c => {
      const e = list.find(x => x.qid === c.dataset.qid);
      c.querySelector('.wn-row').onclick = () => { open.has(e.qid) ? open.delete(e.qid) : open.add(e.qid); rer(); };
      c.querySelectorAll('[data-cause]').forEach(b => b.onclick = async () => {
        const mm = m(e.qid); mm.cause = mm.cause === b.dataset.cause ? '' : b.dataset.cause;
        await saveMeta(e.qid);
        c.querySelectorAll('[data-cause]').forEach(x => x.classList.toggle('on', x.dataset.cause === mm.cause));
        const chip = c.querySelector('.wn-row .wn-cause');
        chip.className = 'wn-cause ' + (mm.cause ? 'c-' + mm.cause : 'none'); chip.textContent = mm.cause ? CAUSE_NAME[mm.cause] : '원인 미분류';
      });
      const ls = c.querySelector('.wn-lesson');
      if (ls) { let t; ls.oninput = () => { m(e.qid).lesson = ls.value; clearTimeout(t); t = setTimeout(() => saveMeta(e.qid), 600); }; }
      c.querySelector('[data-practice]') && (c.querySelector('[data-practice]').onclick = () => ctx.practice(ctx.getQ(e.qid).skill));
      c.querySelector('[data-master]') && (c.querySelector('[data-master]').onclick = async () => { m(e.qid).mastered = true; await saveMeta(e.qid); ctx.toast('졸업했어요 🎓'); rer(); });
      c.querySelector('[data-unmaster]') && (c.querySelector('[data-unmaster]').onclick = async () => { const mm = m(e.qid); mm.mastered = false; mm.nextAt = 0; mm.retries = []; await saveMeta(e.qid); rer(); });
      bindSolver(c, e, rer);
    });
  }

  // 결과 화면에서 원인 바로 고르기
  async function setCause(qid, cause) { await loadMeta(); const mm = m(qid); mm.cause = cause; await saveMeta(qid); }
  async function causeOf(qid) { await loadMeta(); return meta[qid] ? meta[qid].cause : ''; }
  function reset() { meta = null; }

  return { init: c => (ctx = c), view, setCause, causeOf, reset, CAUSES, slowLimit };
})();
