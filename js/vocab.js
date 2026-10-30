/* 영단어장: 시험 중 빨간 형광펜으로 칠한 단어를 모아 뜻과 함께 저장 + 플래시카드 */
const Vocab = (() => {
  let words = [];          // 저장된 단어
  let loaded = false;
  let ui = null;           // { modal, closeModal, toast, preview }
  let looking = false;

  const keyOf = w => 'w_' + w.toLowerCase().replace(/[^a-z0-9_.~:@+-]/g, '_').slice(0, 120);
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');

  async function load() {
    try { words = await Store.all('vocab'); } catch (e) { words = []; }
    words.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    loaded = true;
    return words;
  }
  const all = () => words;
  const pending = () => words.filter(w => !w.ko);

  // 문장 안에서 단어가 들어 있는 한 문장만 골라냄
  function sentenceOf(text, word) {
    const parts = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
    const lw = word.toLowerCase();
    return (parts.find(p => p.toLowerCase().includes(lw)) || parts[0] || '').trim().slice(0, 400);
  }

  // 빨간 형광펜 → 단어장에 추가 (이미 있는 단어면 아무것도 하지 않음)
  async function capture(text, context, qid) {
    const word = clean(text);
    if (!word || word.length > 60 || !/[A-Za-z]/.test(word) || word.split(' ').length > 6) return null;
    if (!loaded) await load();
    const id = keyOf(word);
    if (words.some(x => x.id === id)) return null; // 겹치는 단어는 무시
    const sentence = sentenceOf(context, word);
    const v = { id, word, ko: '', pos: '', def: '', contexts: sentence ? [{ sentence, qid, at: Date.now() }] : [], addedAt: Date.now(), right: 0, wrong: 0, known: false };
    words.unshift(v);
    await Store.put('vocab', v);
    return v;
  }

  // 6초 안에 응답이 없으면 포기하는 fetch
  async function getJSON(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  }

  /* ---------- 뜻 찾기 ----------
   * claude.ai에서는 Claude가 문장 속 뜻을 한국어로 알려줌(한 번에 여러 단어),
   * 그 밖의 곳에서는 무료 번역(MyMemory) + 영영사전(dictionaryapi.dev) 사용 */
  // claude.ai의 "Claude 사용" 권한 상태: granted / prompt / denied / unavailable
  async function sampleState() {
    if (!(window.claude && window.claude.use)) return 'unavailable';
    try {
      const perm = await claude.use('permissions');
      if (!perm) return (await claude.use('sample')) ? 'prompt' : 'unavailable';
      return await perm.state('sample');
    } catch (e) { return 'unavailable'; }
  }
  async function askSample() {
    try { const perm = await claude.use('permissions'); if (perm) return (await perm.request(['sample'])).sample; } catch (e) {}
    return 'unavailable';
  }
  async function openPermissions() {
    try { const perm = await claude.use('permissions'); await perm.manage(); } catch (e) { ui && ui.toast('claude.ai 화면 위쪽 메뉴의 권한(Permissions)에서 Claude 사용을 켜주세요'); }
  }

  const ERR = {
    not_granted: 'Claude 사용이 허용되지 않아 뜻을 찾지 못했어요. 영단어 탭의 "허용하기"를 눌러주세요.',
    rate_limited: '잠시 Claude 사용량 한도에 걸렸어요. 조금 뒤 다시 눌러주세요.',
    session_expired: 'claude.ai 로그인이 만료됐어요. 새로고침 후 다시 로그인해주세요.',
    sampling_disabled: '이 계정에서는 Claude 자동 뜻 찾기를 쓸 수 없어요. 뜻을 직접 입력해주세요.',
    timeout: '뜻 찾기가 너무 오래 걸려 멈췄어요. 다시 눌러주세요.',
  };
  let lastError = '';

  // 단어 앞뒤 몇 단어만 남긴 짧은 문맥 (보내는 양 줄이기)
  function shortCtx(v) {
    const sent = (v.contexts && v.contexts[0] && v.contexts[0].sentence) || '';
    const words = sent.split(/\s+/);
    const i = words.findIndex(x => x.toLowerCase().includes(v.word.toLowerCase().split(' ')[0]));
    if (i < 0) return words.slice(0, 12).join(' ');
    return words.slice(Math.max(0, i - 5), i + 6).join(' ');
  }

  // Claude에게 단어 뜻 묻기 — 가장 가벼운 모델, 짧은 질문, 한국어 뜻·품사만
  async function askClaude(sample, chunk) {
    const lines = chunk.map((v, i) => `${i + 1}. ${v.word} | ${shortCtx(v)}`).join('\n');
    const prompt = '각 영단어가 옆 문맥에서 쓰인 한국어 뜻(짧게, 최대 2개)과 품사. JSON 배열만 답해: [{"n":번호,"k":"뜻","p":"품사"}]\n' + lines;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 40000);
    // 가장 낮은(가벼운) 모델: Haiku · 생각 최소 · 하루 동안 같은 질문은 저장된 답 재사용
    const LOWEST = { model: 'claude-haiku-5-5', modelTier: 'quick', effort: 'low', signal: ctl.signal, cache: { gcTime: 86400000 } };
    try {
      let res;
      if (typeof sample.json === 'function') {
        try { res = await sample.json(prompt, LOWEST); }
        catch (e) { if (e && e.code !== 'capability_removed') throw e; }
      }
      if (!res) {
        const { text } = await sample(prompt, LOWEST);
        const m = text.match(/\[[\s\S]*\]/);
        res = m ? JSON.parse(m[0]) : [];
      }
      return (Array.isArray(res) ? res : []).map(r => {
        const v = chunk[(+r.n || 0) - 1];
        return v ? { word: v.word, ko: r.k, pos: r.p } : null;
      }).filter(Boolean);
    } catch (e) {
      throw (e && e.code === 'cancelled') ? { code: 'timeout' } : e;
    } finally { clearTimeout(timer); }
  }

  /* 문맥 속 뜻 (무료): 구글 번역 사전의 뜻 목록 중에서, 예문 전체를 번역한 문장에 실제로 나온 뜻을 고름.
   * 못 고르면 앞뒤 단어로 품사를 짐작해 그 품사의 대표 뜻 */
  const GT = (q, dt) => 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dj=1&' + dt.map(d => 'dt=' + d).join('&') + '&q=' + encodeURIComponent(q);
  const POS_KO = { noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사' };
  function guessPos(sent, word) {
    const w = sent.toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean);
    const lw = word.toLowerCase().split(' ')[0];
    const i = w.findIndex(x => x.startsWith(lw.slice(0, Math.max(3, lw.length - 2))));
    if (i < 0) return '';
    const prev = w[i - 1] || '', me = w[i];
    if (/ly$/.test(me) && !/ly$/.test(lw.replace(/ly$/, '')) && me.length > 4) return '부사';
    if (/^(to|will|would|can|could|may|might|must|should|shall|not|did|does|do)$/.test(prev)) return '동사';
    if (/(ed|ing)$/.test(me) && /^(is|are|was|were|be|been|has|have|had)$/.test(prev)) return '동사';
    if (/^(very|so|too|quite|more|most|less|least|rather|is|are|was|were|seem|seems|seemed|become|became)$/.test(prev)) return '형용사';
    if (/^(the|a|an|this|that|these|those|his|her|their|its|our|my|your|of|such)$/.test(prev)) {
      const next = w[i + 1] || '';
      return /^(of|is|was|are|were|that|and|,)$/.test(next) || !next ? '명사' : '형용사';
    }
    return '';
  }
  async function contextMeaning(v) {
    const sent = (v.contexts && v.contexts[0] && v.contexts[0].sentence) || '';
    const [wd, st] = await Promise.all([getJSON(GT(v.word, ['t', 'bd', 'md'])), sent ? getJSON(GT(sent, ['t'])) : null]);
    if (!wd) { // 구글이 안 되면 예전 방식(MyMemory)
      const tr = await getJSON('https://api.mymemory.translated.net/get?langpair=en|ko&q=' + encodeURIComponent(v.word));
      const ko = tr && tr.responseData && tr.responseData.translatedText;
      return ko && !/MYMEMORY WARNING/i.test(ko) ? { ko: ko.slice(0, 120), pos: v.word.includes(' ') ? '구' : '' } : null;
    }
    const want = guessPos(sent, v.word);
    const groups = (wd.dict || []).map(g => ({ pos: g.pos, terms: (g.entry || []).map(e => String(e.word || '').replace(/^\.\.\.(의|을|를|에|에게|으로|로)?\s*/, '').trim()).filter(Boolean) }))
      .sort((a, b) => (b.pos === want) - (a.pos === want)); // 문장 속 품사로 짐작되는 뜻부터
    const sentKo = st ? (st.sentences || []).map(x => x.trans || '').join(' ') : '';
    const stem = t => t.replace(/\s+/g, '').replace(/(하다|되다|시키다|스럽다|롭다|적인|적으로|하게|하는|한|히|이|다)$/, '');
    const flat = sentKo.replace(/\s+/g, '');
    let pick = null;
    if (flat) for (const g of groups) { // 문맥 번역에 나온 뜻
      const t = g.terms.find(t => { const k = stem(t); return k.length >= 2 ? flat.includes(k) : flat.includes(t.replace(/\s+/g, '')); });
      if (t) { pick = { g, t }; break; }
    }
    if (!pick && groups.length) {
      const g = groups.find(x => x.pos === want) || groups[0];
      pick = { g, t: g.terms[0] };
    }
    const main = (wd.sentences || []).map(x => x.trans || '').join('').trim();
    if (!pick) return main && main.toLowerCase() !== v.word.toLowerCase() ? { ko: main.slice(0, 120), pos: v.word.includes(' ') ? '구' : '' } : null;
    const others = pick.g.terms.filter(t => t !== pick.t).slice(0, 2);
    let main1 = pick.t, pos = pick.g.pos || '';
    // 문장에선 명사인데 동사 뜻만 맞았을 때(예: a champion of → 옹호하다): 번역문에서 실제 낱말(옹호자)을 꺼냄
    if (want === '명사' && pos !== '명사' && flat) {
      const k = stem(pick.t);
      const tok = sentKo.split(/\s+/).find(w => w.includes(k));
      const n = tok && tok.replace(/[.,!?"'”’)]+$/, '').replace(/(였습니다|이었습니다|입니다|이었다|였다|이다|에게서|에게|에서|으로|로서|로|의|을|를|이|가|은|는|에|와|과|도|만)$/, '');
      if (n && n.length >= 2 && !/다$/.test(n)) { main1 = n; pos = '명사'; }
    }
    const defs = (wd.definitions || []).find(d => d.pos === pos) || (wd.definitions || []).find(d => d.pos === pick.g.pos) || (wd.definitions || [])[0];
    return {
      ko: [...new Set([main1, pick.t, ...others])].slice(0, 3).join(', ').slice(0, 120),
      pos, ctxKo: sentKo.slice(0, 300),
      def: defs && defs.entry && defs.entry[0] ? String(defs.entry[0].gloss || '').slice(0, 200) : '',
    };
  }

  /* ---------- 뜻 찾기 ----------
   * claude.ai에서는 Claude가 문장 속 뜻을 한국어로 알려줌(여러 단어를 한 번에),
   * 그 밖의 곳에서는 무료 번역(MyMemory) + 영영사전(dictionaryapi.dev) */
  async function lookup(list, onProgress, force) {
    list = force ? list : list.filter(v => !v.ko);
    if (!list.length) return 0;
    if (looking) return 0;
    if (navigator.onLine === false) { // 오프라인: 단어는 저장돼 있고, 인터넷이 연결되면 자동으로 뜻을 채움
      lastError = '지금은 오프라인이에요. 인터넷이 연결되면 뜻을 자동으로 채워요.';
      return 0;
    }
    looking = true; lastError = '';
    let n = 0;
    try {
      const sample = window.claude && window.claude.use ? await claude.use('sample').catch(() => null) : null;
      if (sample) {
        for (let i = 0; i < list.length; i += 40) {
          const chunk = list.slice(i, i + 40);
          const res = await askClaude(sample, chunk);
          for (const r of Array.isArray(res) ? res : []) {
            const v = chunk.find(x => x.word.toLowerCase() === String(r.word || '').toLowerCase());
            if (!v || !r.ko) continue;
            Object.assign(v, { ko: String(r.ko).slice(0, 120), pos: String(r.pos || '').slice(0, 20), src: 'auto' });
            await Store.put('vocab', v); n++;
          }
          onProgress && onProgress(Math.min(i + 40, list.length), list.length);
        }
      } else {
        let done = 0;
        const queue = [...list];
        const one = async v => {
          try {
            const r = await contextMeaning(v);
            if (r) { Object.assign(v, r, { src: 'auto' }); await Store.put('vocab', v); n++; }
          } catch (e) {}
          onProgress && onProgress(++done, list.length);
        };
        // 여러 단어를 동시에 찾기
        await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) await one(queue.shift()); }));
      }
    } catch (e) {
      console.error('뜻 찾기 실패', e);
      lastError = ERR[e && e.code] || `뜻을 불러오지 못했어요 (${(e && (e.code || e.message)) || '알 수 없는 오류'}). 다시 눌러주세요.`;
      ui && ui.toast(lastError);
    } finally { looking = false; }
    return n;
  }

  // 자동 뜻 찾기 설정: 'exam' = 시험이 끝날 때 한 번에, 'manual' = 버튼을 누를 때만
  const autoMode = () => { try { return JSON.parse(localStorage.getItem('sat-settings') || '{}').vocabAuto || 'exam'; } catch (e) { return 'exam'; } };
  const setAutoMode = v => { try { const o = JSON.parse(localStorage.getItem('sat-settings') || '{}'); o.vocabAuto = v; localStorage.setItem('sat-settings', JSON.stringify(o)); } catch (e) {} };

  /* ---------- 화면 ---------- */
  const esc = s => U.esc(s);
  const F = { q: '', show: 'all' };

  function markWord(sentence, word) {
    const s = esc(sentence);
    const i = s.toLowerCase().indexOf(esc(word).toLowerCase());
    return i < 0 ? s : s.slice(0, i) + '<b>' + s.slice(i, i + esc(word).length) + '</b>' + s.slice(i + esc(word).length);
  }

  async function view(el) {
    if (!loaded) await load();
    const q = F.q.trim().toLowerCase();
    const list = words.filter(w => (F.show === 'all' || (F.show === 'todo' ? !w.known : w.known))
      && (!q || w.word.toLowerCase().includes(q) || (w.ko || '').includes(q)));
    const pend = pending().length;
    const perm = pend ? await sampleState() : 'granted';
    el.innerHTML = `<div class="page">
      <div class="voc-head">
        <div><h1>영단어</h1><p class="muted">시험 중 <span class="hl-swatch red"></span><b>빨간 형광펜</b>으로 칠한 단어가 문장과 함께 자동으로 모입니다.</p></div>
        <div class="voc-actions">
          <button class="btn primary big" id="fc-start" ${words.length ? '' : 'disabled'}>플래시카드</button>
        </div>
      </div>
      ${pend && perm === 'prompt' ? `<div class="voc-banner"><div><b>뜻 자동 찾기를 켜주세요</b><br><span class="muted sm">Claude가 문장에 맞는 한국어 뜻을 찾아줍니다. 단어 40개를 한 번의 아주 짧은 질문으로 묻기 때문에 사용량은 매우 적어요.</span></div><button class="btn primary" id="voc-allow">허용하기</button></div>` : ''}
      ${pend && perm === 'denied' ? `<div class="voc-banner warn"><div><b>Claude 사용이 꺼져 있어서 뜻을 자동으로 찾을 수 없어요</b><br><span class="muted sm">권한 설정에서 Claude 사용을 켜거나, 뜻을 직접 입력할 수 있어요.</span></div><button class="btn" id="voc-perm">권한 설정 열기</button></div>` : ''}
      ${lastError && pend ? `<div class="voc-banner warn"><span>${esc(lastError)}</span></div>` : ''}
      <div class="toolbar">
        <input class="search" id="voc-q" placeholder="단어·뜻 검색" value="${esc(F.q)}">
        <div class="seg">${[['all', `전체 ${words.length}`], ['todo', `외우는 중 ${words.filter(w => !w.known).length}`], ['known', `외운 단어 ${words.filter(w => w.known).length}`]].map(([v, l]) => `<button class="${F.show === v ? 'on' : ''}" data-show="${v}">${l}</button>`).join('')}</div>
        <div class="spacer"></div>
        <div class="seg" title="Claude 사용량을 아끼려면 '버튼 누를 때만'을 고르세요">
          <button class="${autoMode() === 'exam' ? 'on' : ''}" data-auto="exam">뜻 찾기: 시험 끝날 때</button>
          <button class="${autoMode() === 'manual' ? 'on' : ''}" data-auto="manual">버튼 누를 때만</button>
        </div>
        ${pend ? `<button class="btn primary" id="voc-fill">뜻 채우기 (${pend})</button>` : ''}
        ${words.some(w => w.ko && w.src !== 'manual') ? '<button class="btn" id="voc-redo" title="직접 고친 뜻은 그대로 둬요">문맥 뜻 다시 찾기</button>' : ''}
        <button class="btn" id="voc-add">+ 단어 추가</button>
      </div>
      ${words.length ? '' : `<div class="empty"><div class="empty-icon">🖍️</div><h2>아직 모은 단어가 없어요</h2>
        <p>시험을 풀 때 <b>Highlights &amp; Notes</b>를 켜고 <b>빨간색</b>을 고른 뒤<br>모르는 단어를 드래그하면 여기에 자동으로 저장됩니다.</p></div>`}
      <div class="voc-list">${list.map(w => `
        <div class="voc ${w.known ? 'known' : ''}" data-id="${esc(w.id)}">
          <div class="voc-main">
            <div class="voc-word">${esc(w.word)} ${w.pos ? `<span class="voc-pos">${esc(w.pos)}</span>` : ''}</div>
            <input class="voc-ko" value="${esc(w.ko)}" placeholder="${w.ko ? '' : (looking ? '뜻 찾는 중…' : '뜻이 비어 있어요 — 직접 입력하거나 “뜻 채우기”를 누르세요')}" aria-label="${esc(w.word)} 뜻">
            ${w.def ? `<div class="voc-def">${esc(w.def)}</div>` : ''}
            ${(w.contexts || []).slice(0, 2).map(c => `<div class="voc-ctx">“${markWord(c.sentence, w.word)}”${c.qid ? ` <button class="link sm" data-q="${esc(c.qid)}">문제 보기</button>` : ''}</div>`).join('')}
            ${w.ctxKo ? `<div class="voc-ctxko">→ ${esc(w.ctxKo)}</div>` : ''}
          </div>
          <div class="voc-side">
            <div class="voc-stat" title="플래시카드 기록"><span class="ok">✓ ${w.right || 0}</span> <span class="no">✗ ${w.wrong || 0}</span></div>
            <label class="chk inline"><input type="checkbox" data-known ${w.known ? 'checked' : ''}> 외웠어요</label>
            <button class="btn ghost sm danger" data-del>삭제</button>
          </div>
        </div>`).join('')}</div>
    </div>`;
    const $ = s => el.querySelector(s);
    const rerender = () => view(el);
    $('#voc-q').oninput = e => { F.q = e.target.value; clearTimeout($('#voc-q')._t); $('#voc-q')._t = setTimeout(() => { rerender().then(() => { const i = el.querySelector('#voc-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
    el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { F.show = b.dataset.show; rerender(); });
    $('#fc-start') && ($('#fc-start').onclick = () => flashcards(F.show === 'known' ? words.filter(w => w.known) : words.filter(w => !w.known).length ? words.filter(w => !w.known) : words));
    $('#voc-fill') && ($('#voc-fill').onclick = async () => {
      lastError = '';
      if ((await sampleState()) === 'prompt') await askSample();
      await fill(); rerender();
    });
    $('#voc-add').onclick = () => addDialog(rerender);
    $('#voc-redo') && ($('#voc-redo').onclick = async () => {
      const redo = words.filter(w => w.ko && w.src !== 'manual');
      if (!await U.confirm(`${redo.length}개 단어의 뜻을 문장에 맞게 다시 찾을까요?`, '직접 입력하거나 고친 뜻은 바꾸지 않아요.', '다시 찾기')) return;
      const b = el.querySelector('#voc-redo'); b.disabled = true;
      const n = await lookup(redo, (i, t) => { const bb = el.querySelector('#voc-redo'); if (bb) bb.textContent = `찾는 중 ${i}/${t}`; }, true);
      ui.toast(`${n}개 단어의 뜻을 다시 찾았어요`); rerender();
    });
    $('#voc-allow') && ($('#voc-allow').onclick = async () => { const st = await askSample(); if (st === 'granted') { await fill(); } rerender(); });
    $('#voc-perm') && ($('#voc-perm').onclick = async () => { await openPermissions(); rerender(); });
    const fill = async () => {
      const b = el.querySelector('#voc-fill');
      if (b) { b.disabled = true; b.textContent = '뜻 찾는 중…'; }
      const n = await lookup(pending(), (i, t) => { const bb = el.querySelector('#voc-fill'); if (bb) bb.textContent = `뜻 찾는 중 ${i}/${t}`; });
      if (n) ui.toast(`${n}개 단어의 뜻을 채웠어요`);
    };
    el.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => { setAutoMode(b.dataset.auto); rerender(); });
    el.querySelectorAll('.voc').forEach(row => {
      const v = words.find(w => w.id === row.dataset.id);
      row.querySelector('.voc-ko').onchange = async e => { v.ko = e.target.value.trim(); v.src = 'manual'; await Store.put('vocab', v); ui.toast('저장했어요'); };
      row.querySelector('[data-known]').onchange = async e => { v.known = e.target.checked; await Store.put('vocab', v); rerender(); };
      row.querySelector('[data-del]').onclick = async () => {
        if (!await U.confirm(`“${v.word}”을(를) 단어장에서 삭제할까요?`, '', '삭제')) return;
        await Store.del('vocab', v.id); words = words.filter(w => w !== v); rerender();
      };
      row.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ui.preview && ui.preview(b.dataset.q));
    });
  }

  function addDialog(done) {
    const m = ui.modal(`<h2>단어 추가</h2>
      <div class="form plain">
        <label>영단어<input id="nw-word" placeholder="예: mitigate" autocomplete="off"></label>
        <label>뜻 (비워두면 나중에 “뜻 채우기”로 찾을 수 있어요)<input id="nw-ko" placeholder="예: 완화하다"></label>
        <label>예문 (선택)<input id="nw-ctx" placeholder="단어가 들어간 문장"></label>
      </div>
      <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" id="nw-save">추가</button></div>`);
    m.querySelector('#nw-word').focus();
    m.querySelector('#nw-save').onclick = async () => {
      const word = m.querySelector('#nw-word').value, ko = m.querySelector('#nw-ko').value.trim();
      const v = await capture(word, m.querySelector('#nw-ctx').value, null);
      if (!v) { ui.toast(clean(word) && words.some(x => x.id === keyOf(clean(word))) ? '이미 단어장에 있는 단어예요' : '영단어를 입력해주세요'); return; }
      if (ko) { v.ko = ko; v.src = 'manual'; await Store.put('vocab', v); }
      ui.closeModal();
      done();
    };
  }

  /* ---------- 플래시카드: 영단어 → 한국어 뜻 ---------- */
  function flashcards(pool) {
    if (!pool.length) return;
    // 많이 틀린 단어·아직 안 본 단어를 먼저, 그 안에서는 섞기
    let deck = [...pool].sort(() => Math.random() - 0.5).sort((a, b) => ((b.wrong || 0) - (b.right || 0)) - ((a.wrong || 0) - (a.right || 0))).slice(0, 50);
    let i = 0, flipped = false, ok = 0, no = 0;
    const missed = [];
    const m = ui.modal('<div id="fc"></div>', 'fc-modal');
    const box = m.querySelector('#fc');
    const draw = () => {
      if (i >= deck.length) {
        box.innerHTML = `<div class="fc-end"><h2>다 했어요!</h2>
          <p class="fc-score"><span class="ok">알아요 ${ok}</span> · <span class="no">몰라요 ${no}</span></p>
          <div class="modal-btns">${missed.length ? '<button class="btn" id="fc-again">모르는 것만 다시</button>' : ''}<button class="btn primary" data-close>끝내기</button></div></div>`;
        box.querySelector('#fc-again') && (box.querySelector('#fc-again').onclick = () => { deck = [...missed].sort(() => Math.random() - 0.5); missed.length = 0; i = 0; ok = 0; no = 0; flipped = false; draw(); });
        return;
      }
      const w = deck[i];
      const ctx = w.contexts && w.contexts[0] && w.contexts[0].sentence;
      box.innerHTML = `<div class="fc-top"><span class="muted">${i + 1} / ${deck.length}</span><span class="muted sm">카드를 누르거나 스페이스바로 뒤집기</span></div>
        <button class="fc-card ${flipped ? 'flip' : ''}" id="fc-card" aria-label="카드 뒤집기">
          <span class="fc-face fc-front"><span class="fc-word">${esc(w.word)}</span>${w.pos ? `<span class="fc-pos">${esc(w.pos)}</span>` : ''}
            ${ctx ? `<span class="fc-ctx">“${markWord(ctx, w.word)}”</span>` : ''}<span class="fc-hint">뜻을 떠올려 보세요</span></span>
          <span class="fc-face fc-back"><span class="fc-ko">${esc(w.ko || '(뜻이 아직 없어요)')}</span>${w.def ? `<span class="fc-def">${esc(w.def)}</span>` : ''}${w.ctxKo ? `<span class="fc-def">→ ${esc(w.ctxKo)}</span>` : ''}<span class="fc-word sm">${esc(w.word)}</span></span>
        </button>
        <div class="fc-btns">
          <button class="btn fc-no" id="fc-no" ${flipped ? '' : 'disabled'}>몰라요 <kbd>←</kbd></button>
          <button class="btn fc-ok" id="fc-ok" ${flipped ? '' : 'disabled'}>알아요 <kbd>→</kbd></button>
        </div>`;
      box.querySelector('#fc-card').onclick = () => { flipped = !flipped; draw(); };
      box.querySelector('#fc-no').onclick = () => answer(false);
      box.querySelector('#fc-ok').onclick = () => answer(true);
    };
    const answer = async good => {
      const w = deck[i];
      if (good) { ok++; w.right = (w.right || 0) + 1; } else { no++; w.wrong = (w.wrong || 0) + 1; missed.push(w); }
      w.lastReviewed = Date.now();
      i++; flipped = false; draw();
      try { await Store.put('vocab', w); } catch (e) {}
    };
    const key = e => {
      if (!document.body.contains(box)) { window.removeEventListener('keydown', key); return; }
      if (e.target.matches && e.target.matches('input, textarea')) return;
      if ((e.key === ' ' || e.key === 'Enter') && e.target.id === 'fc-card') return; // 카드 버튼이 직접 처리
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (i < deck.length) { flipped = !flipped; draw(); } }
      else if (e.key === 'ArrowRight' && flipped) answer(true);
      else if (e.key === 'ArrowLeft' && flipped) answer(false);
    };
    window.addEventListener('keydown', key);
    draw();
  }

  return { init: o => (ui = o), load, all, pending, capture, lookup, view, flashcards, sampleState, askSample, autoMode };
})();
