/* 직접 자르기: College Board 형식이 아닌 PDF(모의고사·문제집·스캔본)에서 문제 영역을 고르고
 * 섹션·유형·정답을 정해 문제은행에 넣기. 번호·정답표는 자동으로 찾아 미리 채워 둠 */
const CropTool = (() => {
  const esc = s => U.esc(s);
  const DIFF = [['', '미지정'], ['Easy', '쉬움'], ['Medium', '보통'], ['Hard', '어려움']];
  const SK = () => Parser.SKILLS;

  // 상자 아래·옆의 빈 여백 잘라내기
  function trim(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y), w = Math.floor(p.w), h = Math.floor(p.h);
    const d = p.c.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
    let maxY = -1, minX = w, maxX = -1;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const o = (yy * w + xx) * 4;
      if (d[o] < 225 || d[o + 1] < 225 || d[o + 2] < 225) { if (yy > maxY) maxY = yy; if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; }
    }
    if (maxY < 0) return p;
    const P = 12;
    const nx = Math.max(0, minX - P), nw = Math.min(w, maxX + P) - nx;
    return { c: p.c, x: x + nx, y, w: nw, h: Math.min(h, maxY + P) };
  }

  // 결과: 저장할 문제 배열 (취소하면 null)
  function open(file, onStatus) {
    return new Promise(async (resolve, reject) => {
      let doc;
      try { doc = await Parser.openAny(file, (p, n) => onStatus && onStatus(`PDF 읽는 중 ${p}/${n}`)); }
      catch (e) { reject(e); return; }
      const { pdf, pages, N } = doc;
      const hasText = pages.slice(1).some(p => p.lines.length > 3);
      const det = Parser.detect(pages, N);
      const base = 'u' + (Math.abs([...file.name + file.size].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 1e8).toString(36);
      const S = { test: '', difficulty: '', sel: 0, attach: false };
      let qs = det.qs.map(q => mk(q.num, q.segs));
      function mk(num, segs) {
        const text = Parser.textIn(pages, segs);
        if (!num) { const m = text.trim().match(Parser.QSTART); if (m) num = +m[1]; } // 직접 그린 상자: 맨 앞 번호로 정답표 찾기
        const g = Parser.guess(text);
        const ans = det.key[num] || '';
        return { num, segs, text, test: g.test, skill: g.skill, domain: g.domain, auto: !!g.skill, answer: ans, type: /^[A-D]$/.test(ans) || /\(?A[.)]\s[\s\S]*\(?B[.)]\s/.test(text) ? 'mcq' : (g.test === 'RW' ? 'mcq' : 'spr') };
      }

      const bg = document.createElement('div');
      bg.className = 'crop-bg';
      bg.innerHTML = `<div class="crop">
        <div class="crop-head">
          <div class="crop-title"><b>직접 자르기</b> <span class="muted sm">${esc(file.name)}</span></div>
          <div class="crop-actions"><button class="btn" data-x="cancel">취소</button><button class="btn primary" data-x="save"></button></div>
        </div>
        <div class="crop-tip">${hasText
          ? (qs.length ? `문제 <b>${qs.length}개</b>를 자동으로 찾았어요${Object.keys(det.key).length ? ` · 정답 <b>${Object.keys(det.key).length}개</b>도 정답표에서 읽었어요` : ''}. 틀린 곳만 고치세요.` : '문제 번호를 찾지 못했어요. 페이지에서 문제 하나를 <b>드래그해서 상자</b>로 묶어 주세요.')
          : '글자가 없는 <b>스캔본</b>이에요. 문제를 하나씩 <b>드래그해서 상자</b>로 묶고, 정답을 입력해 주세요.'}
          <span class="muted sm">· 상자 그리기: 페이지 위에서 드래그 (휴대폰·아이패드는 꾹 누른 뒤 끌기) · 상자를 누르면 선택 · ×로 삭제</span></div>
        <div class="crop-all">
          <label>이 PDF 전체 과목 <select data-x="test"><option value="">자동으로 짐작</option><option value="RW">영어 (Reading and Writing)</option><option value="MATH">수학 (Math)</option></select></label>
          <label>난이도 <select data-x="diff">${DIFF.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        </div>
        <div class="crop-body">
          <div class="crop-pages"></div>
          <div class="crop-side"></div>
        </div>
      </div>`;
      document.body.appendChild(bg);
      const $ = s => bg.querySelector(s);
      const pagesEl = $('.crop-pages'), side = $('.crop-side');

      // 페이지: 보일 때만 그림 (큰 PDF도 가볍게)
      for (let p = 1; p <= N; p++) {
        const d = document.createElement('div');
        d.className = 'crop-page'; d.dataset.p = p;
        d.style.aspectRatio = `${pages[p].width} / ${pages[p].height}`;
        d.innerHTML = `<span class="crop-pno">${p}</span>`;
        pagesEl.appendChild(d);
      }
      const drawn = new Set();
      const io = new IntersectionObserver(es => es.forEach(async e => {
        const p = +e.target.dataset.p;
        if (!e.isIntersecting || drawn.has(p)) return;
        drawn.add(p);
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 1.3 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        e.target.prepend(c);
      }), { root: pagesEl, rootMargin: '600px' });
      pagesEl.querySelectorAll('.crop-page').forEach(d => io.observe(d));

      const pct = (v, all) => (v / all * 100) + '%';
      function drawBoxes() {
        pagesEl.querySelectorAll('.crop-box').forEach(b => b.remove());
        qs.forEach((q, qi) => q.segs.forEach((s, si) => {
          const pg = pages[s.page], host = pagesEl.querySelector(`[data-p="${s.page}"]`);
          const b = document.createElement('div');
          b.className = 'crop-box' + (qi === S.sel ? ' on' : '');
          b.dataset.q = qi; b.dataset.s = si;
          Object.assign(b.style, { left: pct(s.x1, pg.width), top: pct(s.y1, pg.height), width: pct(s.x2 - s.x1, pg.width), height: pct(s.y2 - s.y1, pg.height) });
          b.innerHTML = `<span class="crop-num">${qi + 1}${q.segs.length > 1 ? `-${si + 1}` : ''}</span><button class="crop-del" data-del title="${q.segs.length > 1 ? '이 부분 삭제' : '이 문제 삭제'}">×</button>`;
          host.appendChild(b);
        }));
      }
      const skillOpts = (test, cur) => {
        const list = SK().filter(k => !test || k[0] === test);
        let out = '<option value="">유형 모름</option>', lastD = '';
        list.forEach(([t, d, s]) => { if (d !== lastD) { out += `${lastD ? '</optgroup>' : ''}<optgroup label="${esc(d)}">`; lastD = d; } out += `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`; });
        return out + (lastD ? '</optgroup>' : '');
      };
      const effTest = q => S.test || q.test;
      function drawSide() {
        $('[data-x="save"]').textContent = `${qs.length}문제 문제은행에 넣기`;
        $('[data-x="save"]').disabled = !qs.length;
        side.innerHTML = qs.length ? qs.map((q, i) => `<div class="crop-q ${i === S.sel ? 'on' : ''}" data-q="${i}">
          <div class="cq-top"><b>${i + 1}번</b>${q.num && q.num !== i + 1 ? `<span class="muted sm">(PDF ${q.num}번)</span>` : ''}
            <select data-f="test"><option value="" ${!effTest(q) ? 'selected' : ''}>과목?</option><option value="RW" ${effTest(q) === 'RW' ? 'selected' : ''}>영어</option><option value="MATH" ${effTest(q) === 'MATH' ? 'selected' : ''}>수학</option></select>
            <select data-f="type"><option value="mcq" ${q.type === 'mcq' ? 'selected' : ''}>객관식</option><option value="spr" ${q.type === 'spr' ? 'selected' : ''}>주관식</option></select></div>
          <select data-f="skill" class="cq-skill">${skillOpts(effTest(q), q.skill)}</select>
          ${q.auto ? '<span class="cq-auto">자동 분류</span>' : ''}
          <div class="cq-ans">정답 ${q.type === 'mcq'
            ? ['A', 'B', 'C', 'D'].map(L => `<button class="${q.answer === L ? 'on' : ''}" data-ans="${L}">${L}</button>`).join('')
            : `<input data-f="answer" value="${esc(q.answer)}" placeholder="예: 12, 3/4">`}</div>
          ${i === S.sel ? `<button class="link sm" data-x="attach">${S.attach ? '✓ 페이지에서 이어 붙일 부분을 드래그하세요' : '+ 다음 페이지로 이어지는 부분 추가'}</button>` : ''}
        </div>`).join('') : '<p class="muted">아직 문제가 없어요. 왼쪽 페이지에서 문제를 드래그해 상자로 묶어 주세요.</p>';
      }
      const redraw = () => { drawBoxes(); drawSide(); };
      const sortQs = () => {
        const cur = qs[S.sel];
        qs.sort((a, b) => a.segs[0].page - b.segs[0].page || (a.segs[0].x1 >= pages[a.segs[0].page].width / 2) - (b.segs[0].x1 >= pages[b.segs[0].page].width / 2) || a.segs[0].y1 - b.segs[0].y1);
        S.sel = Math.max(0, qs.indexOf(cur));
      };
      const select = (i, scroll) => {
        S.sel = i; S.attach = false; redraw();
        if (scroll === 'page' && qs[i]) pagesEl.querySelector(`.crop-box[data-q="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (scroll === 'side') side.querySelector(`.crop-q[data-q="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };

      // 드래그로 상자 그리기 (마우스·손가락 모두)
      let drag = null;
      pagesEl.addEventListener('pointerdown', e => {
        if (e.target.closest('[data-del]')) return;
        const box = e.target.closest('.crop-box');
        if (box) { select(+box.dataset.q, 'side'); return; }
        const host = e.target.closest('.crop-page'); if (!host || e.button > 0) return;
        if (e.pointerType === 'touch') return; // 손가락은 스크롤, 상자는 길게 누른 뒤 → 아래 처리
        start(e, host);
      });
      let lp = null; // 터치: 길게 누르면 그리기 시작
      pagesEl.addEventListener('touchstart', e => {
        const host = e.target.closest('.crop-page'); if (!host || e.target.closest('.crop-box')) return;
        const t = e.touches[0];
        lp = setTimeout(() => { lp = null; start({ clientX: t.clientX, clientY: t.clientY }, host); navigator.vibrate && navigator.vibrate(15); }, 350);
      }, { passive: true });
      pagesEl.addEventListener('touchmove', e => {
        if (lp) { clearTimeout(lp); lp = null; return; }
        if (drag) { e.preventDefault(); move(e.touches[0]); }
      }, { passive: false });
      pagesEl.addEventListener('touchend', () => { if (lp) { clearTimeout(lp); lp = null; } if (drag) end(); });
      function start(e, host) {
        const r = host.getBoundingClientRect();
        drag = { host, r, x: e.clientX - r.left, y: e.clientY - r.top, el: document.createElement('div') };
        drag.el.className = 'crop-box drawing';
        host.appendChild(drag.el);
        move(e);
      }
      function move(e) {
        if (!drag) return;
        const { r, x, y, el } = drag;
        const cx = Math.min(r.width, Math.max(0, e.clientX - r.left)), cy = Math.min(r.height, Math.max(0, e.clientY - r.top));
        Object.assign(el.style, { left: Math.min(x, cx) + 'px', top: Math.min(y, cy) + 'px', width: Math.abs(cx - x) + 'px', height: Math.abs(cy - y) + 'px' });
        drag.cx = cx; drag.cy = cy;
      }
      function end() {
        const d = drag; drag = null; if (!d) return;
        d.el.remove();
        const w = Math.abs(d.cx - d.x), h = Math.abs(d.cy - d.y);
        if (w < 20 || h < 20) return;
        const p = +d.host.dataset.p, pg = pages[p], k = pg.width / d.r.width;
        const seg = { page: p, x1: Math.min(d.x, d.cx) * k, x2: Math.max(d.x, d.cx) * k, y1: Math.min(d.y, d.cy) * k, y2: Math.max(d.y, d.cy) * k };
        if (S.attach && qs[S.sel]) {
          const q = qs[S.sel]; q.segs.push(seg);
          Object.assign(q, mk(q.num, q.segs), { answer: q.answer, type: q.type });
          S.attach = false; redraw(); return;
        }
        const nq = mk(0, [seg]);
        qs.push(nq); sortQs(); S.sel = qs.indexOf(nq); redraw();
        side.querySelector(`.crop-q[data-q="${S.sel}"]`)?.scrollIntoView({ block: 'nearest' });
      }
      window.addEventListener('pointermove', e => drag && e.pointerType !== 'touch' && move(e));
      window.addEventListener('pointerup', e => drag && e.pointerType !== 'touch' && end());

      pagesEl.addEventListener('click', e => {
        const del = e.target.closest('[data-del]'); if (!del) return;
        const b = del.closest('.crop-box'), qi = +b.dataset.q, si = +b.dataset.s;
        if (qs[qi].segs.length > 1) qs[qi].segs.splice(si, 1); else qs.splice(qi, 1);
        S.sel = Math.min(S.sel, qs.length - 1); redraw();
      });
      side.addEventListener('click', e => {
        const row = e.target.closest('.crop-q'); if (!row) return;
        const i = +row.dataset.q, q = qs[i];
        if (e.target.dataset.ans) { q.answer = q.answer === e.target.dataset.ans ? '' : e.target.dataset.ans; drawSide(); return; }
        if (e.target.dataset.x === 'attach') { S.attach = !S.attach; drawSide(); return; }
        if (e.target.closest('select, input')) return;
        if (i !== S.sel) select(i, 'page');
      });
      side.addEventListener('change', e => {
        const row = e.target.closest('.crop-q'); if (!row) return;
        const q = qs[+row.dataset.q], f = e.target.dataset.f;
        if (f === 'test') { q.test = e.target.value; if (S.test && S.test !== q.test) S.test = ''; q.skill = ''; q.domain = ''; q.auto = false; if (q.test === 'RW') q.type = 'mcq'; }
        if (f === 'type') { q.type = e.target.value; q.answer = ''; }
        if (f === 'skill') { q.skill = e.target.value; const k = SK().find(x => x[2] === q.skill); q.domain = k ? k[1] : ''; if (k) q.test = k[0]; q.auto = false; }
        if (f === 'answer') q.answer = e.target.value.trim();
        if (f !== 'answer') drawSide();
      });
      $('[data-x="test"]').onchange = e => {
        S.test = e.target.value;
        if (S.test) qs.forEach(q => { if (q.test !== S.test) { q.test = S.test; q.skill = ''; q.domain = ''; q.auto = false; } if (S.test === 'RW') q.type = 'mcq'; });
        drawSide();
      };
      $('[data-x="diff"]').onchange = e => (S.difficulty = e.target.value);

      const close = v => { io.disconnect(); bg.remove(); resolve(v); };
      $('[data-x="cancel"]').onclick = async () => { if (await U.confirm('직접 자르기를 그만둘까요?', '이 PDF의 문제는 추가되지 않아요.', '그만두기')) { pdf.destroy(); close(null); } };
      $('[data-x="save"]').onclick = async () => {
        const noAns = qs.filter(q => !q.answer).length;
        if (noAns && !await U.confirm(`정답이 없는 문제가 ${noAns}개 있어요`, '정답 없이 넣으면 채점이 안 돼요. 나중에 문제은행에서 고칠 수도 있어요.', '그대로 넣기')) return;
        const b = $('[data-x="save"]'); b.disabled = true;
        const out = [];
        const cache = new Map();
        const pageCanvas = async p => {
          if (cache.has(p)) return cache.get(p);
          const page = await pdf.getPage(p);
          const vp = page.getViewport({ scale: 2 });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
          cache.set(p, c); if (cache.size > 3) cache.delete(cache.keys().next().value);
          return c;
        };
        for (let i = 0; i < qs.length; i++) {
          b.textContent = `자르는 중 ${i + 1}/${qs.length}`;
          const q = qs[i];
          const parts = [];
          for (const s of q.segs) {
            const c = await pageCanvas(s.page);
            const k = c.width / pages[s.page].width;
            const x = Math.max(0, s.x1 * k), y = Math.max(0, s.y1 * k), w = Math.min(c.width - x, (s.x2 - s.x1) * k), h = Math.min(c.height - y, (s.y2 - s.y1) * k);
            if (w > 4 && h > 4) parts.push(trim({ c, x, y, w, h }));
          }
          if (!parts.length) continue;
          const W = Math.max(...parts.map(p => p.w)), H = parts.reduce((t, p) => t + p.h, 0) + 16 * (parts.length - 1);
          const out1 = document.createElement('canvas'); out1.width = W; out1.height = H;
          const ctx = out1.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
          let yy = 0; parts.forEach(p => { ctx.drawImage(p.c, p.x, p.y, p.w, p.h, 0, yy, p.w, p.h); yy += p.h + 16; });
          const stemImg = await new Promise(r => out1.toBlob(r, 'image/png'));
          const test = effTest(q) || 'RW';
          const isMcq = q.type === 'mcq';
          out.push({
            id: `${base}-${String(i + 1).padStart(3, '0')}`, test, domain: q.domain || '', skill: q.skill || '', difficulty: S.difficulty,
            type: isMcq ? 'mcq' : 'spr', answer: isMcq ? (/^[A-D]$/.test(q.answer) ? q.answer : '') : q.answer,
            answers: isMcq ? [] : q.answer.split(/,|;|\bor\b/).map(x => x.trim()).filter(Boolean),
            stemImg, choiceImgs: [], stemText: q.text.replace(/\s+/g, ' ').slice(0, 400),
            source: file.name, custom: true, addedAt: Date.now() + i,
          });
        }
        pdf.destroy();
        close(out);
      };
      redraw();
    });
  }

  return { open };
})();
