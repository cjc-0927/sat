/* 오답노트: "왜 틀리는지 버릇 찾기"
 * - 틀린 문제 + 찍어서 맞힌 문제 + 맞았지만 오래 걸린 문제를 자동으로 모음
 * - 틀린 이유 4가지(개념·실수·시간·전략)로 분류하고 원인별로 묶어 보기
 * - 해설을 보기 전에 다시 풀기 → 다시 맞히면 3일·7일 뒤 다시 등장, 두 번 연속 맞히면 졸업
 * - 문제마다 "다음엔 기억할 한 줄"
 */
const WrongNotes = (() => {
  let ctx = null;         // { getQ, attempts, qCard, hydrate, modal, closeModal, toast, practice, retryInExam }
  let meta = null;        // qid -> 저장된 기록 { cause, lesson, retries:[{at, ok, resp}], nextAt, mastered }
  const F = { tab: 'type', slow: false, groups: new Set() };
  const open = new Set(); // 펼쳐진 카드
  let focusQ = null;      // 바로 펼쳐서 보여줄 문제
  const revealed = new Set(); // 이번에 해설을 연 카드

  const CAUSES = [
    ['concept', '개념 부족', '공식·문법·뜻을 몰랐어요'],
    ['mistake', '실수', '알았는데 잘못 읽거나 계산했어요'],
    ['time', '시간 부족', '시간에 쫓겨 서두르거나 못 풀었어요'],
    ['strategy', '전략 오류', '푸는 방법·접근을 잘못 골랐어요'],
  ];
  const CAUSE_NAME = Object.fromEntries(CAUSES.map(c => [c[0], c[1]]));
  const KIND = { wrong: ['✗', '틀림', 'no'], guess: ['?', '찍어서 맞힘', 'guess'], slow: ['⏱', '오래 걸림', 'slow'], added: ['✎', '직접 추가', 'added'] };
  const DAY = 86400000;
  const TIPS = { concept: '해당 개념을 먼저 정리하고 같은 유형을 몇 문제 더 풀어보세요.', mistake: '문제를 끝까지 읽고, 답을 고르기 전에 조건을 한 번 더 확인하는 습관을 들이세요.', time: '모르는 문제는 표시하고 넘어갔다가 마지막에 돌아오는 연습을 해보세요.', strategy: '해설의 풀이 방식을 따라 같은 유형을 다시 풀어보며 접근법을 익히세요.' };
  const MEMO_PH = '왜 그 답을 골랐는지 · 정답의 근거 · 헷갈린 단어/개념';
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
      const mm = meta[qid];
      const kind = !it.correct ? 'wrong' : it.guess ? 'guess' : (it.timeSpent || 0) > slowLimit(it.test) ? 'slow' : mm && mm.added ? 'added' : null;
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
  const DIFF_KO = { Easy: '쉬움', Medium: '보통', Hard: '어려움' };
  const decoder = document.createElement('textarea');
  const strip = h => { decoder.innerHTML = (h || '').replace(/<math[\s\S]*?<\/math>/g, ' [수식] ').replace(/<[^>]+>/g, ' '); return decoder.value.replace(/\s+/g, ' ').trim(); };
  // 어떤 문제인지 알아볼 수 있게: R&W는 지문 첫 부분, Math는 문제 첫 부분
  function preview(q) {
    // Math는 수식이 보이도록 문제 HTML을 그대로 (두 줄까지만 보임)
    if (q.test === 'MATH' && q.kind === 'html' && q.stem) return { html: q.stem.replace(/<\/?(p|div|br|figure|table|tbody|tr|td|img)[^>]*>/gi, ' ') };
    const t = (q.test !== 'MATH' && strip(q.stim)) || q.stemText || strip(q.stem);
    if (!t) return q.id ? `문제 ${q.id}` : '문제';
    return t.length > 170 ? t.slice(0, 170) + '…' : t;
  }
  function card(e, withSkill = true) {
    const q = ctx.getQ(e.qid) || {};
    const [ic, kname, kcls] = KIND[e.kind] || ['✓', '다시 맞힘', 'ok'];
    const r = e.meta.retries || [];
    const lastR = r[r.length - 1];
    const isOpen = open.has(e.qid);
    return `<div class="wn ${isOpen ? 'open' : ''}" data-qid="${esc(e.qid)}">
      <div class="wn-row">
        <span class="wn-kind ${kcls}" title="${kname}">${ic}</span>
        <div class="wn-main">
          <div class="wn-prev">${(p => (p.html ? p.html : esc(p)))(preview(q))}</div>
          <div class="wn-sub">${withSkill ? `<b>${esc(q.skill || q.domain || '')}</b> · ` : ''}${DIFF_KO[q.difficulty] || ''}${q.difficulty ? ' · ' : ''}${kname} · 내 답 <b>${esc(e.it.response || '—')}</b>${r.length || e.meta.mastered ? ` · 정답 <b>${esc(q.answer || e.it.answer || '?')}</b>` : ''} · ${U.korDur(e.it.timeSpent || 0)} · ${esc(e.date || '')}${e.count.wrong > 1 ? ` · <b class="no">${e.count.wrong}번 틀림</b>` : ''}</div>
        </div>
        ${e.meta.cause ? `<span class="wn-cause c-${e.meta.cause}">${CAUSE_NAME[e.meta.cause]}</span>` : ''}
        ${lastR ? `<span class="wn-retry ${lastR.ok ? 'ok' : 'no'}">다시 ${lastR.ok ? '✓' : '✗'}</span>` : ''}
        <span class="wn-chev">${isOpen ? '▾' : '▸'}</span>
      </div>
      ${e.meta.lesson && !isOpen ? `<div class="wn-lesson-view">💡 ${esc(e.meta.lesson)}</div>` : ''}
      ${e.meta.memo && !isOpen ? `<div class="wn-memo-view">📝 ${esc(e.meta.memo)}</div>` : ''}
      ${isOpen ? `<div class="wn-body">
        <div class="wn-tagbox">
          <div class="rv-line"><span class="rv-k ${e.meta.cause ? 'ok' : ''}">① 왜?</span><div class="rv-chips">${CAUSES.map(([k, n, d]) => `<button class="wn-c mini c-${k} ${e.meta.cause === k ? 'on' : ''}" data-cause="${k}" title="${d}">${n}</button>`).join('')}</div></div>
          <div class="rv-line"><span class="rv-k ${(e.meta.lesson || '').trim() ? 'ok' : ''}">② 한 줄</span><input class="wn-lesson" maxlength="120" value="${esc(e.meta.lesson || '')}" placeholder="다음엔 이렇게 할게요 · 예: 문제에 'NOT'이 나오면 동그라미 치기"></div>
          <details class="rv-more" ${e.meta.memo ? 'open' : ''}><summary>메모 더 쓰기 (선택)</summary><textarea class="wn-memo" rows="3" placeholder="${MEMO_PH}">${esc(e.meta.memo || '')}</textarea></details>
        </div>
        ${solverHTML(e)}
        <div class="wn-foot">
          ${q.skill && withSkill ? `<button class="btn sm" data-practice>「${esc(q.skill)}」 문제은행에서 더 풀기</button>` : ''}
          <div class="spacer"></div>
          ${e.meta.mastered ? '<button class="btn sm ghost" data-unmaster>다시 복습 목록으로</button>' : '<button class="btn sm ghost" data-master>다 이해했어요 (졸업)</button>'}
        </div>
      </div>` : ''}
    </div>`;
  }

  function summaryHTML(list, pool) {
    if (!pool.length) return '';
    const tagged = pool.filter(e => e.meta.cause);
    const causeCnt = CAUSES.map(([k, n]) => [k, n, tagged.filter(e => e.meta.cause === k).length]).filter(c => c[2]).sort((a, b) => b[2] - a[2]);
    const top = causeCnt[0];
    return `<div class="wn-sum">
      <div class="wn-sum-k"><b>${pool.filter(e => e.kind === 'wrong').length}</b> 틀림 <span>·</span> <b>${pool.filter(e => e.kind === 'guess').length}</b> 찍어서 맞힘 <span>·</span> <b>${list.filter(e => e.meta.mastered).length}</b> 졸업</div>
      <div class="wn-sum-h">${top
        ? `내 버릇: ${causeCnt.map(([k, n, c]) => `<span class="wn-cause c-${k}">${n} ${Math.round(c / tagged.length * 100)}%</span>`).join(' ')} <span class="muted sm">— ${TIPS[top[0]]}</span>`
        : '<span class="muted sm">문제를 펼쳐서 <b>왜 틀렸는지</b> 고르면 여기에 내 버릇이 보여요.</span>'}</div>
    </div>`;
  }

  async function view(el) {
    await loadMeta();
    const list = entries();
    const act = list.filter(active);
    const slowN = act.filter(e => e.kind === 'slow').length;
    // 풀이 기록의 "다시 풀기"로 들어온 경우: 그 문제를 펼친 채로 보여주기
    const fe = focusQ && list.find(e => e.qid === focusQ);
    // 유형 이름 대소문자 차이(Cross-Text / Cross-text)는 같은 유형으로 묶기
    const gname = {};
    const gkey = e => { const q = ctx.getQ(e.qid) || e.it || {}; const nm = (q.skill || q.domain || '기타').trim(); const k = (q.test === 'MATH' ? 'MATH' : 'RW') + '|' + nm.toLowerCase(); gname[k] = gname[k] || nm; return k; };
    if (fe) { F.tab = active(fe) ? 'type' : 'done'; if (fe.kind === 'slow') F.slow = true; open.clear(); open.add(fe.qid); F.groups.add(gkey(fe)); }
    if (F.tab === 'all') F.tab = 'type';
    const pool = act.filter(e => F.slow || e.kind !== 'slow'); // 오래 걸린 문제는 기본으로 숨김
    const dueList = pool.filter(due).sort((a, b) => (b.count.wrong - a.count.wrong) || ((a.meta.retries || []).length - (b.meta.retries || []).length) || (a.date || '').localeCompare(b.date || '')).slice(0, 5);
    const grads = list.filter(e => !active(e));
    const tab = F.tab;
    if (tab === 'today') dueList.forEach(e => open.add(e.qid));
    let body = '';
    if (tab === 'today') {
      body = dueList.length
        ? `<p class="muted wn-today-tip">오늘 다시 풀 ${dueList.length}문제예요. <b>해설을 보기 전에</b> 먼저 풀어보세요. 두 번 연속 맞히면 졸업해요.</p>
           <div class="wn-list">${dueList.map(e => card(e)).join('')}</div>`
        : `<div class="empty small"><div class="empty-icon">🎉</div><h2>오늘 복습할 문제를 다 했어요</h2><p class="muted">다시 풀 차례가 된 문제가 생기면 여기에 나타나요.</p></div>`;
    } else if (tab === 'type') {
      const groups = {};
      pool.forEach(e => (groups[gkey(e)] = groups[gkey(e)] || []).push(e));
      const sec = t => Object.entries(groups).filter(([k]) => k.startsWith(t + '|')).sort((a, b) => b[1].length - a[1].length);
      const gHTML = ([k, es]) => {
        const isOpen = F.groups.has(k), skill = gname[k];
        const n = kk => es.filter(e => e.kind === kk).length;
        es.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return `<div class="wg ${isOpen ? 'open' : ''}" data-g="${esc(k)}">
          <button class="wg-head" data-gt="${esc(k)}">
            <span class="wn-chev">${isOpen ? '▾' : '▸'}</span>
            <b class="wg-name">${esc(skill)}</b>
            <span class="wg-kinds">${n('wrong') ? `<span class="no">✗ 틀림 ${n('wrong')}</span>` : ''}${n('guess') ? `<span class="guess">? 찍음 ${n('guess')}</span>` : ''}${n('slow') ? `<span class="slow">⏱ 오래 ${n('slow')}</span>` : ''}${n('added') ? `<span>✎ ${n('added')}</span>` : ''}</span>
            <span class="wg-cnt">${es.length}문제</span>
          </button>
          ${isOpen ? `<div class="wg-body">
            <div class="wn-list">${es.map(e => card(e, false)).join('')}</div>
            <div class="wg-actions"><button class="btn sm" data-gexam="${esc(k)}">이 유형 ${es.length}문제 시험으로 다시 풀기</button><button class="btn sm ghost" data-weak="${esc(skill)}">문제은행에서 이 유형 새 문제 풀기</button></div>
          </div>` : ''}
        </div>`;
      };
      const rw = sec('RW'), ma = sec('MATH');
      body = pool.length
        ? `<p class="muted sm wn-today-tip">유형을 누르면 그 유형에서 틀린 문제가 펼쳐져요. 문제를 누르면 원인·한 줄 다짐을 적고 해설 없이 다시 풀 수 있어요.</p>`
          + (rw.length ? `<h3 class="wsec">Reading &amp; Writing</h3><div class="wg-list">${rw.map(gHTML).join('')}</div>` : '')
          + (ma.length ? `<h3 class="wsec">Math</h3><div class="wg-list">${ma.map(gHTML).join('')}</div>` : '')
        : '<p class="muted">오답노트가 비어 있어요. 시험을 풀면 틀린 문제·찍은 문제가 자동으로 모여요.</p>';
    } else {
      body = grads.length ? `<p class="muted">두 번 연속 다시 맞혔거나 이후 시험에서 맞힌 문제예요.</p><div class="wn-list">${grads.map(e => card(e)).join('')}</div>` : '<p class="muted">아직 졸업한 문제가 없어요.</p>';
    }
    el.innerHTML = `<div class="page">
      <div class="voc-head"><div><h1>오답노트</h1><p class="muted">틀린 문제를 모으는 곳이 아니라, <b>내가 왜 틀리는지 버릇을 찾는 곳</b>이에요.</p></div></div>
      ${summaryHTML(list, pool)}
      <div class="toolbar"><div class="seg">
        <button class="${tab === 'type' ? 'on' : ''}" data-tab="type">유형별 ${pool.length}</button>
        <button class="${tab === 'today' ? 'on' : ''}" data-tab="today">오늘의 복습 ${dueList.length}</button>
        <button class="${tab === 'done' ? 'on' : ''}" data-tab="done">졸업 ${grads.length}</button>
      </div>
      ${slowN ? `<label class="wn-slowtg"><input type="checkbox" id="wn-slow" ${F.slow ? 'checked' : ''}> 맞혔지만 오래 걸린 문제도 보기 (${slowN})</label>` : ''}
      </div>
      ${body}
    </div>`;
    const rer = () => view(el);
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { F.tab = b.dataset.tab; open.clear(); rer(); });
    el.querySelector('#wn-slow') && (el.querySelector('#wn-slow').onchange = e => { F.slow = e.target.checked; rer(); });
    el.querySelectorAll('[data-gt]').forEach(b => b.onclick = () => { const k = b.dataset.gt; F.groups.has(k) ? F.groups.delete(k) : F.groups.add(k); rer(); });
    el.querySelectorAll('[data-gexam]').forEach(b => b.onclick = () => ctx.retryInExam(pool.filter(e => gkey(e) === b.dataset.gexam).map(e => e.qid)));
    el.querySelectorAll('[data-weak]').forEach(b => b.onclick = () => ctx.practice(b.dataset.weak));
    // 펼친 카드의 문제 이미지 준비 후 연결
    const shown = list.filter(e => open.has(e.qid)).map(e => ctx.getQ(e.qid)).filter(Boolean);
    if (shown.some(q => q.kind !== 'html' && !q.stemImg)) { await ctx.hydrate(shown); return rer(); }
    if (fe) {
      focusQ = null; // 펼친 문제로 스크롤
      const fc = el.querySelector(`.wn[data-qid="${CSS.escape(fe.qid)}"]`);
      if (fc) { fc.classList.add('flash'); setTimeout(() => fc.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); setTimeout(() => fc.classList.remove('flash'), 2000); }
    }
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
      const mo = c.querySelector('.wn-memo');
      if (mo) { let t; mo.oninput = () => { m(e.qid).memo = mo.value; clearTimeout(t); t = setTimeout(() => saveMeta(e.qid), 600); }; }
      c.querySelector('[data-practice]') && (c.querySelector('[data-practice]').onclick = () => ctx.practice(ctx.getQ(e.qid).skill));
      c.querySelector('[data-master]') && (c.querySelector('[data-master]').onclick = async () => { m(e.qid).mastered = true; await saveMeta(e.qid); ctx.toast('졸업했어요 🎓'); rer(); });
      c.querySelector('[data-unmaster]') && (c.querySelector('[data-unmaster]').onclick = async () => { const mm = m(e.qid); mm.mastered = false; mm.nextAt = 0; mm.retries = []; await saveMeta(e.qid); rer(); });
      bindSolver(c, e, rer);
    });
  }

  // 결과 화면에서 원인 바로 고르기
  async function setCause(qid, cause) { await loadMeta(); const mm = m(qid); mm.cause = cause; await saveMeta(qid); }
  async function causeOf(qid) { await loadMeta(); return meta[qid] ? meta[qid].cause : ''; }
  // 풀이 기록에서 오답노트 직접 쓰기
  async function noteOf(qid) { await loadMeta(); return meta[qid] ? { ...meta[qid] } : null; }
  async function saveNote(qid, patch) { await loadMeta(); Object.assign(m(qid), patch); await saveMeta(qid); }
  function focus(qid) { focusQ = qid; }
  async function notesFor(qids) { await loadMeta(); const o = {}; qids.forEach(q => { if (meta[q]) o[q] = meta[q]; }); return o; }
  function reset() { meta = null; }

  return { init: c => (ctx = c), view, preview, setCause, causeOf, noteOf, saveNote, focus, notesFor, TIPS, CAUSE_NAME, reset, CAUSES, slowLimit, MEMO_PH };
})();
