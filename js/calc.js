/* 그래프 계산기 (Desmos 스타일, math.js 기반)
 * 한 줄에 식 하나: 2+3*4 · sqrt(50) · y=2x+1 · f(x)=x^2-9 · f(3) · a=5 · x^2-4 (자동으로 그래프) */
const Calc = (() => {
  const COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#1e1e1e'];
  let el = null, canvas, ctx, listEl, loading = null;
  let rows = [{ src: '' }];
  const view = { cx: 0, cy: 0, ppu: 40 }; // 화면 중심 좌표, 단위당 픽셀
  let plots = [];

  function loadMath() {
    if (window.math) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/math.min.js'; // 사이트 폴더 안에 있는 파일 → 오프라인에서도 동작
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return loading;
  }

  function build() {
    el = document.createElement('div');
    el.className = 'calc';
    el.innerHTML = `
      <div class="calc-side">
        <div class="calc-list"></div>
        <button class="calc-add" type="button">+ 식 추가</button>
        <p class="calc-tip">예: <code>y=2x+1</code> <code>f(x)=x^2-9</code> <code>f(3)</code> <code>sqrt(50)</code> <code>pi</code></p>
      </div>
      <div class="calc-graph"><canvas></canvas>
        <div class="calc-zoom"><button type="button" data-z="in" title="확대">+</button><button type="button" data-z="out" title="축소">−</button><button type="button" data-z="home" title="원점으로">⌂</button></div>
      </div>`;
    listEl = el.querySelector('.calc-list');
    canvas = el.querySelector('canvas');
    ctx = canvas.getContext('2d');
    el.querySelector('.calc-add').onclick = () => { rows.push({ src: '' }); renderList(); focusRow(rows.length - 1); };
    listEl.addEventListener('input', e => {
      const i = +e.target.dataset.i;
      if (Number.isNaN(i)) return;
      rows[i].src = e.target.value;
      evaluate();
    });
    listEl.addEventListener('keydown', e => {
      const i = +e.target.dataset.i;
      if (e.key === 'Enter') { e.preventDefault(); rows.splice(i + 1, 0, { src: '' }); renderList(); focusRow(i + 1); }
      else if (e.key === 'Backspace' && !e.target.value && rows.length > 1) { e.preventDefault(); rows.splice(i, 1); renderList(); focusRow(Math.max(0, i - 1)); }
      else if (e.key === 'ArrowDown' && i < rows.length - 1) focusRow(i + 1);
      else if (e.key === 'ArrowUp' && i > 0) focusRow(i - 1);
    });
    listEl.addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      rows.splice(+b.dataset.del, 1);
      if (!rows.length) rows.push({ src: '' });
      renderList();
    });
    el.querySelector('.calc-zoom').onclick = e => {
      const z = e.target.closest('[data-z]');
      if (!z) return;
      if (z.dataset.z === 'in') view.ppu *= 1.5;
      else if (z.dataset.z === 'out') view.ppu /= 1.5;
      else { view.cx = 0; view.cy = 0; view.ppu = 40; }
      draw();
    };
    // 드래그로 이동, 휠로 확대/축소
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      let lx = e.clientX, ly = e.clientY;
      const mv = ev => { view.cx -= (ev.clientX - lx) / view.ppu; view.cy += (ev.clientY - ly) / view.ppu; lx = ev.clientX; ly = ev.clientY; draw(); };
      const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', mv);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = view.cx + (mx - r.width / 2) / view.ppu, wy = view.cy - (my - r.height / 2) / view.ppu;
      view.ppu = Math.min(5000, Math.max(0.5, view.ppu * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      view.cx = wx - (mx - r.width / 2) / view.ppu; view.cy = wy + (my - r.height / 2) / view.ppu;
      draw();
    }, { passive: false });
    new ResizeObserver(draw).observe(el.querySelector('.calc-graph'));
    renderList();
  }

  function focusRow(i) { const inp = listEl.querySelector(`input[data-i="${i}"]`); inp && inp.focus(); }

  function renderList() {
    listEl.innerHTML = rows.map((r, i) => `
      <div class="calc-row">
        <span class="calc-n" style="--c:${COLORS[i % COLORS.length]}">${i + 1}</span>
        <div class="calc-cell">
          <input data-i="${i}" value="${U.esc(r.src)}" spellcheck="false" autocomplete="off" placeholder="${i === 0 ? '식을 입력하세요' : ''}">
          <div class="calc-out" data-o="${i}"></div>
        </div>
        <button type="button" class="calc-del" data-del="${i}" title="지우기">×</button>
      </div>`).join('');
    evaluate();
  }

  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(10));
    try { return math.format(v, { precision: 10 }); } catch (e) { return String(v); }
  }

  function evaluate() {
    if (!window.math) return;
    const scope = new Map();
    plots = [];
    rows.forEach((r, i) => {
      const out = listEl.querySelector(`[data-o="${i}"]`);
      const src = r.src.trim().replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      let text = '', err = false;
      if (src) {
        try {
          const color = COLORS[i % COLORS.length];
          const ym = src.match(/^y\s*=(.+)$/);
          if (ym) {
            const code = math.parse(ym[1]).compile();
            const sc = new Map(scope);
            plots.push({ color, f: x => { sc.set('x', x); return code.evaluate(sc); } });
          } else {
            const node = math.parse(src);
            if (node.type === 'FunctionAssignmentNode') {
              node.compile().evaluate(scope);
              if (node.params.length === 1) { const fn = scope.get(node.name); plots.push({ color, f: x => fn(x) }); }
            } else if (node.type === 'AssignmentNode') {
              text = `${node.object.name} = ${fmt(node.compile().evaluate(scope))}`;
            } else {
              const syms = new Set();
              node.traverse(n => { if (n.type === 'SymbolNode') syms.add(n.name); });
              if (syms.has('x') && !scope.has('x')) {
                const code = node.compile();
                const sc = new Map(scope);
                plots.push({ color, f: x => { sc.set('x', x); return code.evaluate(sc); } });
              } else {
                const v = node.compile().evaluate(scope);
                if (typeof v !== 'function') text = '= ' + fmt(v);
              }
            }
          }
        } catch (e) { err = true; text = '식을 확인하세요'; }
      }
      if (out) { out.textContent = text; out.classList.toggle('err', err); }
    });
    draw();
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  function draw() {
    if (!canvas) return;
    const box = canvas.parentElement.getBoundingClientRect();
    const W = Math.max(10, box.width), H = Math.max(10, box.height), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const sx = x => W / 2 + (x - view.cx) * view.ppu;
    const sy = y => H / 2 - (y - view.cy) * view.ppu;
    const x0 = view.cx - W / 2 / view.ppu, x1 = view.cx + W / 2 / view.ppu;
    const y0 = view.cy - H / 2 / view.ppu, y1 = view.cy + H / 2 / view.ppu;
    const step = niceStep(80 / view.ppu);
    // 보조 격자
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#eef0f3';
    for (let gx = Math.ceil(x0 / (step / 5)) * (step / 5); gx <= x1; gx += step / 5) { ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), H); ctx.stroke(); }
    for (let gy = Math.ceil(y0 / (step / 5)) * (step / 5); gy <= y1; gy += step / 5) { ctx.beginPath(); ctx.moveTo(0, sy(gy)); ctx.lineTo(W, sy(gy)); ctx.stroke(); }
    ctx.strokeStyle = '#d3d7de';
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) { ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), H); ctx.stroke(); }
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) { ctx.beginPath(); ctx.moveTo(0, sy(gy)); ctx.lineTo(W, sy(gy)); ctx.stroke(); }
    // 축
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(0), 0); ctx.lineTo(sx(0), H); ctx.moveTo(0, sy(0)); ctx.lineTo(W, sy(0)); ctx.stroke();
    // 눈금 숫자
    ctx.fillStyle = '#444'; ctx.font = '11px -apple-system, Helvetica, Arial, sans-serif';
    const lab = v => String(+v.toPrecision(6));
    const ay = Math.min(H - 4, Math.max(12, sy(0) + 13));
    ctx.textAlign = 'center';
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) if (Math.abs(gx) > step / 2) ctx.fillText(lab(gx), sx(gx), ay);
    ctx.textAlign = 'right';
    const ax = Math.min(W - 4, Math.max(28, sx(0) - 5));
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) if (Math.abs(gy) > step / 2) ctx.fillText(lab(gy), ax, sy(gy) + 4);
    // 그래프
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    for (const p of plots) {
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      let pen = false, prev = null;
      for (let px = 0; px <= W; px += 1) {
        const x = x0 + px / view.ppu;
        let y;
        try { y = p.f(x); y = typeof y === 'number' ? y : (y && typeof y.re === 'number' && Math.abs(y.im) < 1e-12 ? y.re : NaN); } catch (e) { y = NaN; }
        const py = sy(y);
        if (!Number.isFinite(y) || (prev !== null && Math.abs(py - prev) > H * 2)) { pen = false; prev = Number.isFinite(y) ? py : null; continue; }
        if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        prev = py;
      }
      ctx.stroke();
    }
  }

  function mount(host) {
    host.innerHTML = '<div class="calc-msg">계산기 불러오는 중…</div>';
    loadMath().then(() => {
      if (!el) build();
      host.innerHTML = '';
      host.appendChild(el);
      evaluate();
      requestAnimationFrame(draw);
    }).catch(() => { host.innerHTML = '<div class="calc-msg">계산기를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div>'; });
  }

  return { mount };
})();
