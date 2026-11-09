/* 계산기: Bluebook과 같은 Desmos(College Board 시험용) 그래프/공학용 계산기를 iframe으로 띄움
   iframe은 다시 그리면 초기화되므로 시험 화면 밖(body)에 한 번만 만들고 보이기/숨기기만 함
   Bluebook처럼 왼쪽 위에 떠 있고, 문제 영역은 계산기 오른쪽 끝만큼 부드럽게 밀려남 */
const Calc = (() => {
  const SRC = { graphing: 'https://www.desmos.com/testing/collegeboard/graphing', scientific: 'https://www.desmos.com/testing/collegeboard/scientific' };
  let el = null, main = null, shown = false, mode = 'graphing';
  const box = { x: 0, y: 0, w: 0, h: 0 };

  function ensure(closeIcon) {
    if (el) return el;
    box.w = Math.round(Math.min(560, Math.max(360, window.innerWidth * 0.36)));
    box.h = Math.round(Math.min(900, Math.max(360, window.innerHeight * 0.74)));
    el = document.createElement('div');
    el.className = 'bb-calcwin';
    el.innerHTML = `<div class="cw-head">
        <div class="cw-tabs"><button type="button" data-m="graphing" class="on">∿ Graphing</button><button type="button" data-m="scientific">▦ Scientific</button></div>
        <div class="cw-grip" title="끌어서 옮기기">⠿</div>
        <button type="button" class="cw-x" title="닫기">${closeIcon || '×'}</button>
      </div>
      <div class="cw-body">
        <iframe data-m="graphing" src="${SRC.graphing}" title="Desmos 그래프 계산기"></iframe>
        <iframe data-m="scientific" title="Desmos 공학용 계산기" hidden></iframe>
      </div>
      <div class="cw-size" title="끌어서 크기 조절">⤡</div>`;
    document.body.appendChild(el);
    el.querySelector('.cw-tabs').onclick = e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.dataset.m;
      el.querySelectorAll('.cw-tabs [data-m]').forEach(x => x.classList.toggle('on', x === b));
      el.querySelectorAll('iframe').forEach(f => {
        const on = f.dataset.m === mode;
        if (on && !f.src) f.src = SRC[mode];
        f.hidden = !on;
      });
    };
    el.querySelector('.cw-grip').addEventListener('pointerdown', e => drag(e, (dx, dy, s) => { box.x = s.x + dx; box.y = s.y + dy; }));
    el.querySelector('.cw-size').addEventListener('pointerdown', e => drag(e, (dx, dy, s) => { box.w = s.w + dx; box.h = s.h + dy; }));
    window.addEventListener('resize', place);
    return el;
  }

  function drag(e, apply) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, s = { ...box };
    el.classList.add('dragging');
    const mv = ev => { apply(ev.clientX - sx, ev.clientY - sy, s); place(); };
    const up = () => { el.classList.remove('dragging'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.dispatchEvent(new Event('resize')); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  // 문제 영역을 밀어낼 거리 = 계산기 오른쪽 끝
  const shift = () => Math.max(0, Math.min(box.x + box.w, window.innerWidth - 160));

  function place() {
    if (!el) return;
    const W = window.innerWidth, H = window.innerHeight;
    box.w = Math.max(300, Math.min(box.w, W - 40));
    box.h = Math.max(300, Math.min(box.h, H - 20));
    box.x = Math.max(0, Math.min(box.x, W - box.w));
    box.y = Math.max(0, Math.min(box.y, H - 60));
    Object.assign(el.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    if (shown && main && main.isConnected) main.style.marginLeft = shift() + 'px';
  }

  // 열고 닫을 때만 문제 영역이 미끄러지듯 움직이게 (문제를 넘길 때는 그대로)
  function slide(from, to) {
    if (!main || !main.isConnected) return;
    main.style.transition = 'none';
    main.style.marginLeft = from + 'px';
    void main.offsetWidth;
    main.style.transition = 'margin-left .28s ease';
    main.style.marginLeft = to + 'px';
    setTimeout(() => { if (main) main.style.transition = ''; window.dispatchEvent(new Event('resize')); }, 300);
  }

  // opts: { show, main(문제 영역 요소), closeIcon, onClose }
  function sync(opts) {
    main = opts.main;
    if (main) main.classList.toggle('calc-shift', !!opts.show);
    if (!opts.show) {
      if (el) el.style.display = 'none';
      if (shown) slide(shift(), 0);
      shown = false;
      return;
    }
    ensure(opts.closeIcon);
    el.querySelector('.cw-x').onclick = opts.onClose;
    el.style.display = '';
    const was = shown;
    shown = true;
    place();
    if (!was) { el.classList.remove('cw-in'); void el.offsetWidth; el.classList.add('cw-in'); slide(0, shift()); }
  }

  function destroy() { el && el.remove(); el = null; shown = false; window.removeEventListener('resize', place); }

  return { sync, destroy, get el() { return el; } };
})();
