/* 그래프 계산기: Bluebook과 같은 Desmos(College Board 시험용)를 iframe으로 띄움
   iframe은 다시 그리면 초기화되므로 시험 화면 밖(body)에 한 번만 만들고 보이기/숨기기만 함 */
const Calc = (() => {
  const SRC = 'https://www.desmos.com/testing/collegeboard/graphing';
  let el = null;

  function ensure(closeIcon) {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'bb-float bb-calc bb-calc-fixed';
    el.style.left = '24px'; el.style.top = '90px';
    el.innerHTML = `<div class="bb-float-head" data-drag="calc"><span>Calculator</span><button class="bb-x" type="button" data-calc-x>${closeIcon || '×'}</button></div>
      <div class="bb-desmos"><iframe src="${SRC}" title="Desmos 그래프 계산기" allow="clipboard-read; clipboard-write"></iframe></div>`;
    document.body.appendChild(el);
    return el;
  }

  // opts: { show, closeIcon, onClose, onDrag(e) }
  function sync(opts) {
    if (!opts.show && !el) return;
    ensure(opts.closeIcon);
    el.style.display = opts.show ? '' : 'none';
    el.onpointerdown = e => { if (e.target.closest('[data-drag]') && !e.target.closest('[data-calc-x]')) opts.onDrag(e); };
    el.querySelector('[data-calc-x]').onclick = opts.onClose;
  }

  function destroy() { el && el.remove(); el = null; }

  return { sync, destroy, get el() { return el; } };
})();
