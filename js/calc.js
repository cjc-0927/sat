/* 그래프 계산기: Bluebook과 같은 Desmos(College Board 시험용)를 iframe으로 띄움
   iframe은 다시 그리면 초기화되므로 시험 화면 밖(body)에 한 번만 만들고 보이기/숨기기만 함
   문제를 가리지 않도록 왼쪽에 붙이고(좁은 화면은 위쪽) 문제 영역을 그만큼 밀어냄 */
const Calc = (() => {
  const SRC = 'https://www.desmos.com/testing/collegeboard/graphing';
  let el = null, main = null, width = 0;
  const narrow = () => window.innerWidth < 700;

  function ensure(closeIcon) {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'bb-calc-dock';
    el.innerHTML = `<div class="bb-float-head"><span>Calculator</span><button class="bb-x" type="button" data-calc-x>${closeIcon || '×'}</button></div>
      <div class="bb-desmos"><iframe src="${SRC}" title="Desmos 그래프 계산기" allow="clipboard-read; clipboard-write"></iframe></div>
      <div class="bb-calc-grip" title="끌어서 크기 조절"></div>`;
    document.body.appendChild(el);
    el.querySelector('.bb-calc-grip').addEventListener('pointerdown', startResize);
    window.addEventListener('resize', layout);
    return el;
  }

  function layout() {
    if (!el || !main || !main.isConnected || el.style.display === 'none') return;
    main.style.marginLeft = main.style.marginTop = '';
    const r = main.getBoundingClientRect();
    el.classList.toggle('top', narrow());
    if (narrow()) {
      const h = Math.round(Math.min(Math.max(width || r.height * 0.45, 200), r.height - 120));
      Object.assign(el.style, { left: '0px', top: r.top + 'px', width: '100%', height: h + 'px' });
      main.style.marginTop = h + 'px';
    } else {
      const w = Math.round(Math.min(Math.max(width || Math.min(520, r.width * 0.42), 300), r.width - 320));
      Object.assign(el.style, { left: '0px', top: r.top + 'px', width: w + 'px', height: r.height + 'px' });
      main.style.marginLeft = w + 'px';
    }
  }

  function startResize(e) {
    e.preventDefault();
    el.classList.add('dragging');
    const mv = ev => { width = narrow() ? ev.clientY - el.getBoundingClientRect().top : ev.clientX; layout(); };
    const up = () => { el.classList.remove('dragging'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.dispatchEvent(new Event('resize')); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  // opts: { show, main(문제 영역 요소), closeIcon, onClose }
  function sync(opts) {
    main = opts.main;
    if (!opts.show) { if (el) el.style.display = 'none'; return; }
    ensure(opts.closeIcon);
    el.style.display = '';
    el.querySelector('[data-calc-x]').onclick = opts.onClose;
    layout();
  }

  function destroy() { el && el.remove(); el = null; window.removeEventListener('resize', layout); }

  return { sync, destroy, get el() { return el; } };
})();
