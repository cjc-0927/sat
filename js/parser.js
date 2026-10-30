/* College Board SAT Suite Question Bank PDF → 문제 데이터
 * 텍스트 위치(pdf.js)로 문제 경계를 찾고, 실제 내용은 페이지를 이미지로 잘라 저장한다.
 * (수식·그래프·표가 PDF 그대로 보존됨)
 */
const Parser = (() => {
  const SCALE = 2;

  // [test, domain, skill, 매칭 키(없으면 skill 전체)]
  const SKILLS = [
    ['RW', 'Information and Ideas', 'Central Ideas and Details'],
    ['RW', 'Information and Ideas', 'Inferences'],
    ['RW', 'Information and Ideas', 'Command of Evidence'],
    ['RW', 'Craft and Structure', 'Words in Context'],
    ['RW', 'Craft and Structure', 'Text Structure and Purpose'],
    ['RW', 'Craft and Structure', 'Cross-Text Connections'],
    ['RW', 'Expression of Ideas', 'Rhetorical Synthesis'],
    ['RW', 'Expression of Ideas', 'Transitions'],
    ['RW', 'Standard English Conventions', 'Boundaries'],
    ['RW', 'Standard English Conventions', 'Form, Structure, and Sense'],
    ['MATH', 'Algebra', 'Linear equations in one variable'],
    ['MATH', 'Algebra', 'Linear functions'],
    ['MATH', 'Algebra', 'Linear equations in two variables'],
    ['MATH', 'Algebra', 'Systems of two linear equations in two variables', 'Systems of two linear equations'],
    ['MATH', 'Algebra', 'Linear inequalities in one or two variables', 'Linear inequalities'],
    ['MATH', 'Advanced Math', 'Nonlinear functions'],
    ['MATH', 'Advanced Math', 'Nonlinear equations in one variable and systems of equations in two variables', 'Nonlinear equations in one variable'],
    ['MATH', 'Advanced Math', 'Equivalent expressions'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Ratios, rates, proportional relationships, and units', 'Ratios, rates, proportional'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Percentages'],
    ['MATH', 'Problem-Solving and Data Analysis', 'One-variable data: Distributions and measures of center and spread', 'One-variable data'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Two-variable data: Models and scatterplots', 'Two-variable data'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Probability and conditional probability', 'Probability and conditional'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Inference from sample statistics and margin of error', 'Inference from sample statistic'],
    ['MATH', 'Problem-Solving and Data Analysis', 'Evaluating statistical claims: Observational studies and experiments', 'Evaluating statistical claims'],
    ['MATH', 'Geometry and Trigonometry', 'Area and volume'],
    ['MATH', 'Geometry and Trigonometry', 'Lines, angles, and triangles'],
    ['MATH', 'Geometry and Trigonometry', 'Right triangles and trigonometry'],
    ['MATH', 'Geometry and Trigonometry', 'Circles'],
  ];
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const SKILL_KEYS = SKILLS
    .map(([t, d, s, k]) => ({ t, d, s, k: norm(k || s) }))
    .sort((a, b) => b.k.length - a.k.length);
  const DOMAIN_KEYS = [...new Set(SKILLS.map(s => s[0] + '|' + s[1]))]
    .map(x => { const [t, d] = x.split('|'); return { t, d, k: norm(d) }; })
    .sort((a, b) => b.k.length - a.k.length);

  function classify(header) {
    const n = norm(header);
    const sk = SKILL_KEYS.find(x => n.includes(x.k));
    if (sk) return { test: sk.t, domain: sk.d, skill: sk.s };
    const dm = DOMAIN_KEYS.find(x => n.includes(x.k));
    if (dm) return { test: dm.t, domain: dm.d, skill: '' };
    if (n.includes('readingandwriting')) return { test: 'RW', domain: '', skill: '' };
    if (n.includes('math')) return { test: 'MATH', domain: '', skill: '' };
    return { test: '', domain: '', skill: '' };
  }

  const ID_RE = /\bID\s*:\s*([0-9a-zA-Z]{5,12})\b(.*)$/;
  const QTITLE = /^Question ID\b/i;
  const PROMPT_START = /^(Which|What|Based on|According to|The student wants|As used in|How |In the context|The main purpose|The function)/;

  async function extractLines(pdf, p) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: SCALE });
    const tc = await page.getTextContent();
    const items = [];
    let sp = false; // 띄어쓰기가 따로 된 조각으로 들어 있는 PDF: 다음 글자 앞에 공백
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) { if (it.str) sp = true; continue; }
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(t[2], t[3]) || 10 * SCALE;
      items.push({ str: it.str, x: t[4], base: t[5], h, w: (it.width || 0) * SCALE, sp });
      sp = false;
    }
    items.sort((a, b) => a.base - b.base || a.x - b.x);
    // 새 형식 PDF는 글자 크기가 글꼴 안에 들어 있어 높이가 1pt처럼 나옴 → 줄 간격으로 실제 글자 높이를 짐작
    const hs = items.map(i => i.h).sort((a, b) => a - b), hMed = hs[hs.length >> 1] || 0;
    if (items.length && hMed < 3 * SCALE) {
      const bases = [...new Set(items.map(i => Math.round(i.base)))].sort((a, b) => a - b);
      const gaps = bases.slice(1).map((b, i) => b - bases[i]).filter(g => g > 4 * SCALE).sort((a, b) => a - b);
      const g = gaps[gaps.length >> 2] || 14 * SCALE; // 본문 줄 간격(짧은 쪽)
      items.forEach(i => (i.h = g * 0.72 * (i.h / hMed)));
    }
    const lines = [];
    for (const it of items) {
      let line = null;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
        const l = lines[i];
        if (Math.abs(l.base - it.base) < Math.min(l.h, it.h) * 0.45) { line = l; break; }
      }
      if (!line) { line = { base: it.base, h: it.h, items: [] }; lines.push(line); }
      line.items.push(it);
      line.h = Math.max(line.h, it.h);
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let text = '', prevEnd = null;
      for (const it of l.items) {
        if (prevEnd !== null && (it.sp || it.x - prevEnd > l.h * 0.15) && !text.endsWith(' ')) text += ' ';
        text += it.str;
        prevEnd = it.x + it.w;
      }
      l.text = text.replace(/\s+/g, ' ').trim();
      l.top = Math.min(...l.items.map(i => i.base - i.h));
      l.bottom = Math.max(...l.items.map(i => i.base + i.h * 0.28));
      l.x0 = l.items[0].x;
      l.page = p;
    }
    lines.sort((a, b) => a.top - b.top);
    return { lines, width: vp.width, height: vp.height };
  }

  async function parse(file, opts = {}, onProgress = () => {}) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const N = pdf.numPages;
    const pages = [];
    const all = [];
    for (let p = 1; p <= N; p++) {
      const pg = await extractLines(pdf, p);
      pages[p] = pg;
      all.push(...pg.lines);
      onProgress(`텍스트 분석 중 (${p}/${N} 페이지)`, (p / N) * 0.25);
    }

    // 1) 문제 시작(ID: xxx) / 정답부(ID: xxx Answer) 위치
    const starts = [], answers = [];
    all.forEach((l, i) => {
      const m = l.text.match(ID_RE);
      if (!m) return;
      const id = m[1].toLowerCase();
      if (/answer/i.test(m[2])) answers.push({ i, id });
      else if (!m[2].trim()) starts.push({ i, id });
    });
    if (!starts.length) {
      pdf.destroy();
      const e = new Error('College Board 문제은행 형식이 아니에요');
      e.code = 'NOT_CB';
      throw e;
    }

    if (opts.max) starts.length = Math.min(starts.length, opts.max); // 확인용: 앞의 몇 문제만

    // 2) 페이지 렌더링 캐시 + 이미지 자르기
    const cache = new Map();
    async function pageCanvas(p) {
      if (cache.has(p)) return cache.get(p);
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: SCALE });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise; // print: 다른 탭으로 가도 멈추지 않음
      cache.set(p, c);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
      return c;
    }

    function inkBounds(c, x, y, w, h) {
      x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
      w = Math.min(c.width - x, Math.ceil(w)); h = Math.min(c.height - y, Math.ceil(h));
      if (w < 2 || h < 2) return null;
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let yy = 0; yy < h; yy++) {
        let row = yy * w * 4;
        for (let xx = 0; xx < w; xx++) {
          const o = row + xx * 4;
          if (d[o] < 230 || d[o + 1] < 230 || d[o + 2] < 230) {
            if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
            if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
          }
        }
      }
      if (maxX < 0) return null;
      return { x: x + minX, y: y + minY, x2: x + maxX + 1, y2: y + maxY + 1 };
    }

    // from/to: {page, y}; xStart: 왼쪽 자르기 시작점(선택지 기호 제거용)
    async function crop(from, to, xStart = 0) {
      if (opts.noImages) return null; // 분류만 확인할 때
      // 다음 페이지 맨 위(다음 문제 제목)에서 끝나면 이전 페이지 끝까지만
      if (to.page > from.page && to.y < pages[to.page].height * 0.15) to = { page: to.page - 1, y: pages[to.page - 1].height };
      const segs = [];
      for (let p = from.page; p <= to.page; p++) {
        const c = await pageCanvas(p);
        const H = c.height;
        const y1 = Math.max(0, p === from.page ? from.y : H * 0.035);
        const y2 = Math.min(H, p === to.page ? to.y : H * 0.965);
        if (y2 - y1 < 4) continue;
        const b = inkBounds(c, xStart, y1, c.width - xStart, y2 - y1);
        if (b) segs.push({ c, ...b });
      }
      if (!segs.length) return null;
      const PAD = 8, GAP = 20;
      const x1 = Math.max(0, Math.min(...segs.map(s => s.x)) - PAD);
      const x2 = Math.max(...segs.map(s => s.x2)) + PAD;
      const W = x2 - x1;
      const Ht = segs.reduce((a, s) => a + (s.y2 - s.y + PAD * 2), 0) + GAP * (segs.length - 1);
      const out = document.createElement('canvas');
      out.width = W; out.height = Ht;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, Ht);
      let yy = 0;
      for (const s of segs) {
        const sy = Math.max(0, s.y - PAD), sh = Math.min(s.c.height - sy, s.y2 - s.y + PAD * 2);
        ctx.drawImage(s.c, x1, sy, Math.min(W, s.c.width - x1), sh, 0, yy, Math.min(W, s.c.width - x1), sh);
        yy += s.y2 - s.y + PAD * 2 + GAP;
      }
      return await new Promise(r => out.toBlob(r, 'image/png'));
    }

    // "ID: xxxx" 남색 박스의 아래쪽 끝(y) — 박스 영역의 진한 남색 줄이 끝나는 곳
    async function idBoxBottom(li) {
      const l = all[li];
      const c = await pageCanvas(l.page);
      const x0 = Math.max(0, Math.floor(l.x0 - 10)), w = Math.min(c.width - x0, 260);
      const y0 = Math.floor(l.top - 4), y1 = Math.min(c.height - 1, Math.floor(l.bottom + 60));
      if (w < 10 || y1 <= y0) return l.bottom + 3;
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, y1 - y0).data;
      let last = -1;
      for (let y = 0; y < y1 - y0; y++) {
        let navy = 0;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          if (d[o + 2] > 60 && d[o + 2] - d[o] > 35 && d[o] < 90) navy++;
        }
        if (navy > w * 0.3) last = y; else if (last >= 0 && y > l.bottom - y0) break;
      }
      return last >= 0 ? y0 + last + 4 : l.bottom + 3;
    }

    // 문제만 있는 PDF: 난이도는 막대 3개 중 채워진 개수 (1 쉬움 · 2 보통 · 3 어려움)
    async function difficultyBars(ai, idLine) {
      const head = all[ai];
      const dItem = head.items.find(it => /^Di/.test(it.str.trim()));
      if (!dItem) return '';
      const c = await pageCanvas(head.page);
      const x0 = Math.floor(dItem.x - 6), x1 = Math.min(c.width - 1, Math.floor(c.width * 0.98));
      const y0 = Math.floor(head.bottom + 2);
      const y1 = Math.floor(all[idLine].page === head.page ? all[idLine].top - 4 : head.bottom + 80);
      if (y1 <= y0 || x1 <= x0) return '';
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const W = x1 - x0, H = y1 - y0;
      let best = 0;
      for (let y = 0; y < H; y++) {
        let runs = 0, run = 0;
        for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 4, r = d[o], g = d[o + 1], b = d[o + 2];
          const blue = b > 90 && b - r > 40 && r < 140;
          if (blue) run++;
          else { if (run > 12) runs++; run = 0; }
        }
        if (run > 12) runs++;
        best = Math.max(best, runs);
      }
      return ['', 'Easy', 'Medium', 'Hard'][Math.min(best, 3)] || '';
    }

    // "ID:" 줄은 남색 박스 안에 있으므로 박스 위쪽까지 여유를 둠
    const posTop = i => (i < all.length ? { page: all[i].page, y: all[i].top - (ID_RE.test(all[i].text) || QTITLE.test(all[i].text) ? 26 : 6) } : { page: N, y: pages[N].height });
    const posAfter = i => ({ page: all[i].page, y: all[i].bottom + 3 });

    function markerRight(line) {
      const its = line.items;
      let txt = '', right = its[0].x;
      for (const it of its) {
        const t = it.str.replace(/\s/g, '');
        if ((txt + t).length <= 2) { txt += t; right = it.x + it.w; if (txt.length === 2) break; }
        else {
          if (txt.length < 2) {
            const need = 2 - txt.length;
            const s = it.str.trimStart();
            right = it.x + it.w * ((need + (it.str.length - s.length)) / Math.max(1, it.str.length));
          }
          break;
        }
      }
      return right + 9;
    }

    const results = [];
    for (let k = 0; k < starts.length; k++) {
      const s = starts[k];
      const prevStart = k ? starts[k - 1].i : -1;
      const nextStart = k + 1 < starts.length ? starts[k + 1].i : all.length;
      const ans = answers.find(a => a.i > s.i && a.i < nextStart);

      // 새 형식(2026~): "Question ID: x" 바로 다음에 표가 있고, Question / Answer / Correct Answer: / Rationale 제목으로 나뉨
      let nf = null;
      for (let x = s.i + 1; x < Math.min(nextStart, s.i + 4); x++) if (/^Assessment\b/i.test(all[x].text)) { nf = { assess: x }; break; }
      if (nf) {
        const find = (re, from) => { for (let x = from; x < nextStart; x++) if (re.test(all[x].text)) return x; return -1; };
        nf.q = find(/^Question$/i, nf.assess + 1);
        if (nf.q < 0) nf.q = nf.assess + 1;
        nf.ca = find(/^Correct Answer\s*:/i, nf.q + 1);
        nf.a = find(/^Answers?$/i, nf.q + 1); if (nf.ca >= 0 && nf.a > nf.ca) nf.a = -1;
        nf.r = find(/^Rationale$/i, Math.max(nf.q, nf.ca) + 1);
      }

      // 헤더(Assessment / Test / Domain / Skill / Difficulty)
      let hs = Math.max(prevStart + 1, s.i - 6), assess = -1, hEnd = s.i;
      if (nf) { hs = assess = nf.assess; hEnd = nf.q; }
      else for (let x = s.i - 1; x > prevStart; x--) if (/Assessment/i.test(all[x].text)) { hs = assess = x; break; }
      if (!nf && assess > 0 && QTITLE.test(all[assess - 1].text)) hs = assess - 1;
      let headerText = all.slice(hs, hEnd).map(l => l.text).join(' ');
      if (assess >= 0) {
        // 표 칸 안에서 줄바꿈된 글자를 칸(열)별로 이어 붙임 (예: "Lines, angles, and / triangles")
        const cols = all[assess].items.filter(it => /^(Assessment|Test|Domain|Skill|Di)/.test(it.str.trim())).map(it => it.x);
        if (cols.length >= 3) {
          const txt = cols.map(() => []);
          for (const l of all.slice(assess + 1, hEnd)) for (const it of l.items) {
            let k = 0;
            cols.forEach((x, j) => { if (it.x >= x - 8) k = j; });
            txt[k].push(it.str);
          }
          headerText = txt.map(t => t.join(' ')).join(' | ');
        }
      }

      // 다음 문제 헤더 시작(=해설 끝)
      let end = nextStart;
      if (k + 1 < starts.length && !nf) {
        const lo = ans ? ans.i : s.i;
        for (let x = nextStart - 1; x > lo; x--) if (/Assessment/i.test(all[x].text)) { end = x; break; }
        if (end > lo + 1 && end < nextStart && QTITLE.test(all[end - 1].text)) end = end - 1;
      }
      const stemStart = nf ? nf.q + 1 : s.i + 1;
      const stemEnd = nf ? [nf.a, nf.ca, nf.r, end].find(x => x >= 0) : ans ? ans.i : end;
      const chEnd = nf ? [nf.ca, nf.r, end].find(x => x >= 0) : stemEnd; // 선택지가 끝나는 곳
      const chFrom = nf ? (nf.a >= 0 ? nf.a : nf.q) : s.i;

      // 선택지 A~D
      let markers = null;
      for (let x = chEnd - 1; x > chFrom && !markers; x--) {
        if (!/^A\s?[.)](\s|$)/.test(all[x].text)) continue;
        const seq = [x];
        let want = 66; // 'B'
        for (let y = x + 1; y < chEnd && want <= 68; y++) {
          if (new RegExp('^' + String.fromCharCode(want) + '\\s?[.)](\\s|$)').test(all[y].text)) { seq.push(y); want++; }
        }
        if (seq.length === 4) markers = seq;
      }

      // 정답·난이도
      const ansLines = nf ? (nf.ca >= 0 ? all.slice(nf.ca, nf.r >= 0 ? nf.r : end).map(l => l.text) : []) : ans ? all.slice(ans.i + 1, end).map(l => l.text) : [];
      const ansText = ansLines.join('\n');
      const ca = ansText.match(/Correct Answer\s*:?\s*([^\n]+)/i);
      const df = (ansText + headerText).replace(/\s+/g, '').match(/QuestionDifficulty:?(Easy|Medium|Hard)/i);
      const cls = classify(headerText);
      const type = markers ? 'mcq' : 'spr';
      let answer = '', answers2 = [];
      if (ca) {
        if (type === 'mcq') answer = (ca[1].match(/\b([A-D])\b/) || [])[1] || '';
        else {
          answers2 = ca[1].split(/,|;|\bor\b/).map(x => x.trim()).filter(Boolean);
          answer = answers2.join(', ');
        }
      }
      const df2 = nf && headerText.match(/\b(Easy|Medium|Hard)\b(?!.*\b(Easy|Medium|Hard)\b)/i);
      let difficulty = df ? df[1][0].toUpperCase() + df[1].slice(1).toLowerCase() : df2 ? df2[1][0].toUpperCase() + df2[1].slice(1).toLowerCase() : '';
      if (!difficulty && assess >= 0 && !nf) difficulty = await difficultyBars(assess, s.i);
      if (!difficulty) difficulty = opts.difficulty || '';

      // 이미지
      // 문제는 남색 "ID:" 박스 바로 아래부터 (박스 위 첫 글자 줄보다 위에 있는 수식·그림도 포함)
      const stemFrom = nf ? posAfter(nf.q) : { page: all[s.i].page, y: await idBoxBottom(s.i) };
      const stemTo = posTop(markers && !nf ? markers[0] : stemEnd);
      const stemImg = await crop(stemFrom, stemTo);
      const choiceImgs = [];
      if (markers) {
        for (let c = 0; c < 4; c++) {
          const from = posTop(markers[c]);
          const to = posTop(c < 3 ? markers[c + 1] : chEnd);
          choiceImgs.push(await crop(from, to, markerRight(all[markers[c]])));
        }
      }

      // 독해(RW): 지문 / 질문 분리
      let passageImg = null, promptImg = null;
      const test = cls.test || opts.test || '';
      if (test === 'RW') {
        const sl = all.slice(stemStart, markers && !nf ? markers[0] : stemEnd).map((l, idx) => ({ l, idx: stemStart + idx }));
        if (sl.length >= 2) {
          const gaps = [];
          for (let q = 1; q < sl.length; q++) {
            gaps.push(sl[q].l.page !== sl[q - 1].l.page ? 999 : sl[q].l.top - sl[q - 1].l.bottom);
          }
          const sorted = gaps.filter(g => g < 999).sort((a, b) => a - b);
          const gMed = sorted.length ? sorted[sorted.length >> 1] : 0;
          const hMed = sl.map(x => x.l.bottom - x.l.top).sort((a, b) => a - b)[sl.length >> 1];
          let pIdx = -1;
          for (let q = sl.length - 1; q >= Math.max(1, sl.length - 6); q--) {
            const sentenceStart = /[.!?"”')\]]$/.test(sl[q - 1].l.text);
            if (PROMPT_START.test(sl[q].l.text) && (gaps[q - 1] > gMed + hMed * 0.15 || sentenceStart)) { pIdx = q; break; }
          }
          if (pIdx < 0) {
            for (let q = sl.length - 1; q >= Math.max(1, sl.length - 5); q--) {
              if (gaps[q - 1] > gMed + hMed * 0.35) { pIdx = q; break; }
            }
          }
          if (pIdx > 0) {
            passageImg = await crop(stemFrom, posTop(sl[pIdx].idx));
            promptImg = await crop(posTop(sl[pIdx].idx), stemTo);
          }
        }
      }

      const rationaleImg = nf ? (nf.r >= 0 ? await crop(posAfter(nf.r), posTop(end)) : null) : ans ? await crop(ans.i + 1 < end ? posTop(ans.i + 1) : posAfter(ans.i), posTop(end)) : null;
      const stemText = all.slice(stemStart, markers && !nf ? markers[0] : stemEnd).map(l => l.text).join(' ').slice(0, 400);

      results.push({
        id: s.id,
        test,
        domain: cls.domain,
        skill: cls.skill,
        difficulty,
        type,
        answer,
        answers: answers2,
        stemImg, passageImg, promptImg, choiceImgs, rationaleImg,
        stemText,
        source: file.name,
        addedAt: Date.now(),
      });
      onProgress(`문제 이미지 생성 중 (${k + 1}/${starts.length})`, 0.25 + ((k + 1) / starts.length) * 0.75);
    }
    pdf.destroy();
    return results;
  }

  const DOMAINS = {};
  for (const [t, d, s] of SKILLS) {
    DOMAINS[t] = DOMAINS[t] || {};
    (DOMAINS[t][d] = DOMAINS[t][d] || []).push(s);
  }

  /* ---------- 다른 형식의 PDF (모의고사·문제집·스캔본) ----------
   * 문제 번호(1. 2. 3. …)와 정답표를 찾아 문제 영역을 짐작 → 직접 자르기 화면에서 고침 */
  async function openAny(file, onProgress = () => {}) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pages[p] = await extractLines(pdf, p);
      onProgress(p, pdf.numPages);
    }
    return { pdf, pages, N: pdf.numPages };
  }

  const KEY_HEAD = /^(answer key|answers?\b|answer explanations?|정답|해설|답안)/i;
  const QSTART = /^(?:question\s*|q\.?\s*|문제\s*)?(\d{1,3})\s*(?:[.)]|번)(?:\s+|$)/i;
  const QNUM_ONLY = /^(\d{1,3})$/;
  function detect(pages, N) {
    // 1) 정답표가 시작되는 곳 (그 뒤는 문제가 아니라 답)
    let keyAt = null;
    for (let p = 1; p <= N && !keyAt; p++) {
      const l = pages[p].lines.find(l => KEY_HEAD.test(l.text) && l.text.length < 40);
      if (l && p > 1) keyAt = { page: p, y: l.top };
    }
    const inKey = (p, y) => keyAt && (p > keyAt.page || (p === keyAt.page && y >= keyAt.y));
    // 2) 정답: "1. B", "1 B", "Question 1 … Correct Answer: B"
    const key = {};
    if (keyAt) {
      const txt = [];
      for (let p = keyAt.page; p <= N; p++) pages[p].lines.forEach(l => { if (p > keyAt.page || l.top >= keyAt.y) txt.push(l.text); });
      const t = txt.join('\n');
      for (const m of t.matchAll(/(?:question\s*)?(\d{1,3})[\s\S]{0,60}?(?:correct answer|answer|정답)\s*[:：]?\s*(?:choice\s*)?([A-D]\b|-?[\d./]+)/gi)) key[+m[1]] = key[+m[1]] || m[2].toUpperCase();
      for (const m of t.matchAll(/(?:^|\s)(\d{1,3})\s*[.):\-]?\s*\(?([A-D])\)?(?=\s|$|,)/g)) key[+m[1]] = key[+m[1]] || m[2];
      for (const m of t.matchAll(/(?:^|\s)(\d{1,3})\s*[.):]\s*(-?\d+(?:[./]\d+)?)(?=\s|$|,)/g)) key[+m[1]] = key[+m[1]] || m[2]; // 주관식 숫자 답
    }
    // 3) 문제 시작 줄: 왼쪽 끝(단 시작)에 있는 번호, 번호가 1씩 늘어나는 것만
    const cands = [];
    for (let p = 1; p <= N; p++) {
      const pg = pages[p];
      const lines = pg.lines.filter(l => l.top > pg.height * 0.03 && l.bottom < pg.height * 0.97);
      if (!lines.length) continue;
      const cols = [0, pg.width / 2];
      lines.forEach(l => {
        const m = l.text.match(QSTART) || (QNUM_ONLY.test(l.text) ? [l.text, l.text] : null);
        if (!m || inKey(p, l.top)) return;
        const col = l.x0 >= pg.width * 0.5 ? 1 : 0;
        const minX = Math.min(...lines.filter(x => (x.x0 >= pg.width * 0.5 ? 1 : 0) === col).map(x => x.x0));
        if (l.x0 - minX > pg.width * 0.06) return;
        cands.push({ page: p, y: l.top, x: l.x0, col, num: +m[1], colX: cols[col] });
      });
    }
    const picked = [];
    let last = 0;
    for (const c of cands) {
      if (c.num === last + 1 || (c.num === 1 && last !== 0)) { picked.push(c); last = c.num; }
    }
    // 두 단으로 된 페이지인지 (오른쪽 단에 번호가 있으면)
    const twoCol = new Set(picked.filter(c => c.col === 1).map(c => c.page));
    // 4) 영역: 다음 번호까지 (같은 페이지·같은 단), 아니면 단 끝까지 + 다음 페이지 윗부분 이어 붙이기
    const qs = picked.map((c, i) => {
      const pg = pages[c.page];
      const two = twoCol.has(c.page);
      const x1 = two ? (c.col ? pg.width / 2 : 0) : 0, x2 = two ? (c.col ? pg.width : pg.width / 2) : pg.width;
      const nx = picked[i + 1];
      const segs = [];
      const bottomOf = (p, y0) => { const k = inKey(p, pages[p].height) && keyAt.page === p ? keyAt.y : pages[p].height * 0.97; return Math.max(y0 + 10, k); };
      if (nx && nx.page === c.page && nx.col === c.col) segs.push({ page: c.page, x1, x2, y1: c.y - 6, y2: nx.y - 6 });
      else {
        segs.push({ page: c.page, x1, x2, y1: c.y - 6, y2: bottomOf(c.page, c.y) });
        // 다음 문제가 다음 페이지 중간에서 시작하면 그 위 내용은 이 문제의 이어지는 부분
        if (nx && nx.page === c.page + 1 && nx.col === 0 && nx.y > pages[nx.page].height * 0.15 && !two) segs.push({ page: nx.page, x1: 0, x2: pages[nx.page].width, y1: pages[nx.page].height * 0.04, y2: nx.y - 6 });
      }
      return { num: c.num, segs };
    });
    return { qs, key, keyAt };
  }

  // 영역 안의 글자
  function textIn(pages, segs) {
    return segs.map(s => (pages[s.page] ? pages[s.page].lines : []).filter(l => (l.top + l.bottom) / 2 >= s.y1 && (l.top + l.bottom) / 2 <= s.y2 && l.x0 >= s.x1 - 20 && l.x0 < s.x2).map(l => l.text).join('\n')).join('\n');
  }

  // 문제 글을 보고 섹션·유형 짐작 (College Board 질문 문장은 유형마다 거의 정해져 있음)
  function guess(text) {
    const t = (text || '').replace(/\s+/g, ' ');
    const L = t.toLowerCase();
    const rw = s => { const x = SKILLS.find(k => k[2] === s); return { test: 'RW', domain: x[1], skill: s }; };
    const mt = s => { const x = SKILLS.find(k => k[2] === s); return { test: 'MATH', domain: x[1], skill: s }; };
    if (/conventions of standard english/.test(L)) {
      const ch = [...t.matchAll(/(?:^|\s)\(?([A-D])[.)]\s+(.+?)(?=\s\(?[A-D][.)]\s|$)/g)].map(m => m[2].toLowerCase().replace(/[^a-z0-9]/g, ''));
      return rw(ch.length >= 3 && ch.every(c => c === ch[0]) ? 'Boundaries' : 'Form, Structure, and Sense');
    }
    if (/most logical transition/.test(L)) return rw('Transitions');
    if (/student wants to|following notes|taken the following notes/.test(L)) return rw('Rhetorical Synthesis');
    if (/text 1[\s\S]*text 2/.test(L)) return rw('Cross-Text Connections');
    if (/logical and precise word|as used in the text|most nearly mean/.test(L)) return rw('Words in Context');
    if (/main purpose|overall structure|function of the underlined|best describes the function/.test(L)) return rw('Text Structure and Purpose');
    if (/most logically completes the text/.test(L)) return rw('Inferences');
    if (/quotation|illustrates the claim|data from the (table|graph)|most directly (support|weaken)|most strongly support|weaken the/.test(L)) return rw('Command of Evidence');
    if (/main idea|best states the main|according to the text|based on the text/.test(L)) return rw('Central Ideas and Details');
    const mathy = /[=<>≤≥^√π]|\bvalue of\b|\bequation\b|\bfunction\b|\bxy-plane\b|\bsolution\b|\bpercent\b|\bprobability\b|\bmean\b|\bmedian\b/.test(L);
    if (!mathy) return { test: /which choice/.test(L) ? 'RW' : '', domain: '', skill: '' };
    if (/circle|radius|diameter|\barc\b|π/.test(L)) return mt('Circles');
    if (/\bsin\b|\bcos\b|\btan\b|right triangle|hypotenuse/.test(L)) return mt('Right triangles and trigonometry');
    if (/triangle|angle|parallel|degrees|°/.test(L)) return mt('Lines, angles, and triangles');
    if (/\barea\b|volume|cube|cylinder|sphere|prism|surface/.test(L)) return mt('Area and volume');
    if (/probability|at random/.test(L)) return mt('Probability and conditional probability');
    if (/margin of error|random sample|survey/.test(L)) return mt('Inference from sample statistics and margin of error');
    if (/experiment|observational|study (was|is) conducted|conclusion/.test(L)) return mt('Evaluating statistical claims: Observational studies and experiments');
    if (/scatterplot|line of best fit/.test(L)) return mt('Two-variable data: Models and scatterplots');
    if (/\bmean\b|\bmedian\b|standard deviation|data set|dot plot|histogram/.test(L)) return mt('One-variable data: Distributions and measures of center and spread');
    if (/percent|%/.test(L)) return mt('Percentages');
    if (/\bratio\b|\brate\b|per hour|per minute|miles|proportional|\bunits?\b/.test(L)) return mt('Ratios, rates, proportional relationships, and units');
    if (/system of|two equations|\(x, ?y\)/.test(L)) return mt('Systems of two linear equations in two variables');
    if (/inequalit|≤|≥|at least|at most/.test(L)) return mt('Linear inequalities in one or two variables');
    if (/equivalent|rewritten/.test(L)) return mt('Equivalent expressions');
    if (/quadratic|exponential|parabola|vertex|polynomial|x\^?2|x²/.test(L)) return mt('Nonlinear functions');
    if (/slope|intercept|linear function|f\(x\)/.test(L)) return mt('Linear functions');
    if (/xy-plane|\bline\b/.test(L) || (/=/.test(L) && /\by\b/.test(L))) return mt('Linear equations in two variables');
    if (/=/.test(L) && /\d\s*[a-z]\b|\b[a-z]\s*[+\-]/.test(L)) return mt('Linear equations in one variable');
    return { test: 'MATH', domain: '', skill: '' };
  }

  return { parse, DOMAINS, classify, openAny, detect, textIn, guess, SKILLS, QSTART };
})();
