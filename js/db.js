/* IndexedDB 저장소: questions(문제), attempts(풀이 기록) */
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('sat-practice-bank', 5);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('questions')) db.createObjectStore('questions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'aid', autoIncrement: true });
        // 진행 중인 업로드(PDF 원본) — 새로고침·업데이트로 끊겨도 이어서 진행
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        // 영단어장
        if (!db.objectStoreNames.contains('vocab')) db.createObjectStore('vocab', { keyPath: 'id' });
        // 질문노트
        if (!db.objectStoreNames.contains('qnotes')) db.createObjectStore('qnotes', { keyPath: 'id' });
        // 오답노트 (틀린 이유·다시 풀기 기록)
        if (!db.objectStoreNames.contains('wnotes')) db.createObjectStore('wnotes', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    all: store => run(store, 'readonly', s => s.getAll()),
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    put: (store, val) => run(store, 'readwrite', s => s.put(val)),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
    clear: store => run(store, 'readwrite', s => s.clear()),
  };
})();

/* 공용 유틸 */
const U = {
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  mmss(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  },
  korDur(sec) {
    sec = Math.round(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? (s ? `${m}분 ${s}초` : `${m}분`) : `${s}초`;
  },
  _urls: new WeakMap(),
  url(blob) {
    if (!blob) return '';
    let u = U._urls.get(blob);
    if (!u) { u = URL.createObjectURL(blob); U._urls.set(blob, u); }
    return u;
  },
  // PDF에서 잘라낸 이미지를 원래 글자 비율에 맞춰 표시 (qimg: 시험 화면, pimg: 미리보기)
  zoom() { try { return parseFloat(JSON.parse(localStorage.getItem('sat-settings') || '{}').zoom) || 0.85; } catch (e) { return 0.72; } },
  sizeImg(img) {
    const f = img.classList.contains('pimg') ? 0.85 : 1;
    const set = () => { if (img.naturalWidth) img.style.width = Math.round(img.naturalWidth * U.zoom() * f) + 'px'; };
    if (img.complete) set(); else img.addEventListener('load', set, { once: true });
  },
  watchImages() {
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('img.pimg')) U.sizeImg(n);
        n.querySelectorAll && n.querySelectorAll('img.pimg').forEach(U.sizeImg);
      }
    }).observe(document.body, { childList: true, subtree: true });
  },
  // 실제 SAT 기준: R&W 27문항 32분, Math 22문항 35분
  RATE: { RW: (32 * 60) / 27, MATH: (35 * 60) / 22 },
  timeFor(test, n) { return Math.round(U.RATE[test] * n); },
  TEST_NAME: { RW: 'Reading and Writing', MATH: 'Math' },
  // 학생 응답(SPR) 채점
  numVal(s) {
    s = String(s).trim().replace(/\s+/g, '');
    if (!s) return NaN;
    const f = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
    if (f) return parseFloat(f[1]) / parseFloat(f[2]);
    return /^-?\d*\.?\d+$/.test(s) ? parseFloat(s) : NaN;
  },
  isCorrect(q, resp) {
    if (resp == null || resp === '') return false;
    if (q.type === 'mcq') return String(resp).toUpperCase() === String(q.answer).toUpperCase();
    const list = (q.answers && q.answers.length ? q.answers : String(q.answer || '').split(/,|\bor\b/)).map(x => x.trim()).filter(Boolean);
    const rv = U.numVal(resp);
    return list.some(a => {
      const av = U.numVal(a);
      if (!isNaN(av) && !isNaN(rv)) return Math.abs(av - rv) < 1e-9;
      return a.replace(/\s/g, '').toLowerCase() === String(resp).replace(/\s/g, '').toLowerCase();
    });
  },
};

/* 저장소 — 세 가지 방식
 *  cloud : claude.ai 페이지의 주인 (claude db + assets)
 *  google: Google 로그인한 사용자 (Firebase Firestore, users/<uid>/...)
 *  local : 그 외 — 이 브라우저의 IndexedDB */
const Store = (() => {
  const IMG_KEYS = ['stemImg', 'passageImg', 'promptImg', 'rationaleImg'];
  let mode = 'local', cdb = null, assets = null, downloads = null;
  let fb = null, fbUser = null; // Firebase
  const hydrated = new Map(); // sprite key -> parts promise
  const authListeners = [];

  /* ---- Firebase (Google 로그인) ---- */
  const FB_VER = '10.12.2';
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  async function initFirebase() {
    if (!window.FIREBASE_CONFIG) return false;
    try {
      const base = 'js/vendor/firebase/'; // 사이트 폴더 안 파일 → 오프라인에서도 로그인 상태로 켜짐
      await loadScript(base + 'firebase-app-compat.js');
      await Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]);
      firebase.initializeApp(window.FIREBASE_CONFIG);
      const fs = firebase.firestore();
      try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      fb = { auth: firebase.auth(), fs };
      // 첫 로그인 상태를 기다림
      fbUser = await new Promise(res => { const off = fb.auth.onAuthStateChanged(u => { off(); res(u); }); });
      try { await fb.auth.getRedirectResult(); } catch (e) {}
      let first = true;
      fb.auth.onAuthStateChanged(u => {
        if (first) { first = false; return; }
        const changed = (u && u.uid) !== (fbUser && fbUser.uid);
        fbUser = u;
        if (changed) authListeners.forEach(f => f(u));
      });
      return true;
    } catch (e) { console.error('Firebase 초기화 실패', e); fb = null; return false; }
  }
  async function signIn() {
    if (!fb) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await fb.auth.signInWithPopup(provider); }
    catch (e) {
      if (/popup-blocked|operation-not-supported/.test(e.code || '')) return fb.auth.signInWithRedirect(provider);
      if (!/popup-closed|cancelled-popup/.test(e.code || '')) throw e;
    }
  }
  async function signOut() { if (fb) await fb.auth.signOut(); }
  const ucol = store => fb.fs.collection('users').doc(fbUser.uid).collection(store);
  // Firestore는 오프라인이면 '서버 저장 완료'를 끝없이 기다림 → 기기에 먼저 저장된 뒤 최대 3초만 기다리고 진행
  // (연결되면 Firestore가 알아서 서버에 올림)
  const localFirst = p => { p.catch(e => console.warn('나중에 다시 올립니다', e)); return navigator.onLine === false ? Promise.resolve() : Promise.race([p, new Promise(r => setTimeout(r, 3000))]); };

  async function init() {
    // 1) claude.ai 페이지 주인
    if (window.claude && window.claude.use) {
      try {
        const [d, a, dl, u] = await Promise.all([claude.use('db'), claude.use('assets'), claude.use('downloads'), claude.use('user')]);
        downloads = dl;
        // 페이지 주인(편집 권한)만 클라우드 저장소를 쓰고, 링크로 들어온 다른 사람은 각자 브라우저에 저장
        const editor = u ? await u.canEdit().catch(() => false) : false;
        if (d && editor) { cdb = d; assets = a; mode = 'cloud'; return mode; }
      } catch (e) {}
    }
    // 2) Google 로그인
    if (await initFirebase()) { if (fbUser) mode = 'google'; }
    return mode;
  }

  // 기본 문제(College Board 문제은행 텍스트)
  //  claude.ai: 주인만 읽을 수 있는 config/bank 문서가 가리키는 파일 · 로컬: data/bank.json
  let bankP = null;
  function loadBank() {
    if (bankP) return bankP;
    bankP = (async () => {
      try {
        let url = null;
        if (mode === 'google') {
          // Google 계정에 올려둔 기본 문제 (나만 읽을 수 있음, 오프라인이면 기기에 저장된 사본)
          const items = await bankFromAccount();
          if (items) return items;
        }
        if (mode === 'cloud') {
          const d = await retry(() => cdb.collection('config').doc('bank').get());
          if (d.exists && d.data().asset) url = '/_blob/' + d.data().asset;
        } else if (mode !== 'cloud' && !(window.claude && window.claude.use)) {
          // 컴퓨터 버전: data/bank.js가 이미 불러와져 있음 (파일을 바로 열어도·오프라인에서도 동작)
          if (window.SAT_BANK && window.SAT_BANK.items) return window.SAT_BANK.items.map(q => ({ ...q, bank: true }));
          if (/^https?:/.test(location.protocol)) url = 'data/bank.json';
        }
        if (!url) return [];
        const res = await fetch(url);
        if (!res.ok) return [];
        const j = await res.json();
        return (j.items || []).map(q => ({ ...q, bank: true }));
      } catch (e) { console.warn('기본 문제를 불러오지 못했습니다', e); return []; }
    })();
    return bankP;
  }

  // 기본 문제를 Google 계정에 나눠 저장 (Firestore 문서 1MB 제한 → 여러 조각)
  const BANK_CHUNK = 500000;
  async function bankFromAccount() {
    try {
      const snap = await ucol('bank').get();
      if (snap.empty) return null;
      const docs = snap.docs.map(d => d.data()).filter(d => typeof d.i === 'number').sort((a, b) => a.i - b.i);
      if (!docs.length || docs.length !== docs[0].n) return null;
      const j = JSON.parse(docs.map(d => d.s).join(''));
      return (j.items || []).map(q => ({ ...q, bank: true }));
    } catch (e) { console.warn('계정의 기본 문제를 읽지 못했습니다', e); return null; }
  }
  async function bankInAccount() { return mode === 'google' && !!(await bankFromAccount()); }
  async function uploadBank(onProgress) {
    if (mode !== 'google' || !window.SAT_BANK) throw new Error('이 컴퓨터 버전에서 Google 로그인한 상태여야 합니다');
    const str = JSON.stringify(window.SAT_BANK);
    const n = Math.ceil(str.length / BANK_CHUNK);
    for (let i = 0; i < n; i++) {
      await ucol('bank').doc('part-' + String(i).padStart(3, '0')).set({ i, n, s: str.slice(i * BANK_CHUNK, (i + 1) * BANK_CHUNK), at: Date.now() });
      onProgress && onProgress(i + 1, n);
    }
    bankP = null;
    return n;
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 서버 요청 제한·일시 오류는 잠시 기다렸다 다시 시도
  const RETRY = ['resource_exhausted', 'unavailable', 'rate_limited', 'store_unavailable', 'upstream_error', 'deadline-exceeded', 'resource-exhausted'];
  async function retry(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        if (i >= 7 || !RETRY.includes(e && e.code)) throw e;
        await sleep(Math.min(15000, 600 * 2 ** i) + Math.random() * 400);
      }
    }
  }

  // 문제 이미지 여러 장 → 세로로 이어 붙인 한 장(sprite) + 각 조각 위치
  async function buildSprite(q) {
    const list = [];
    IMG_KEYS.forEach(k => q[k] && list.push([k, q[k]]));
    (q.choiceImgs || []).forEach((b, i) => b && list.push(['c' + i, b]));
    if (!list.length) return null;
    const bms = await Promise.all(list.map(([, b]) => createImageBitmap(b)));
    const W = Math.max(...bms.map(b => b.width));
    const H = bms.reduce((s, b) => s + b.height, 0);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const parts = {};
    let y = 0;
    bms.forEach((b, i) => { ctx.drawImage(b, 0, y); parts[list[i][0]] = [0, y, b.width, b.height]; y += b.height; });
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return { blob, parts };
  }

  function meta(q) {
    const m = { ...q };
    IMG_KEYS.forEach(k => delete m[k]);
    delete m.choiceImgs;
    return JSON.parse(JSON.stringify(m));
  }

  const blobToB64 = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); });
  const b64ToBlob = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'image/png' }); };
  const CHUNK = 700000; // Firestore 문서 1MB 제한 아래로 나눠 저장

  async function spriteBlob(q) {
    if (q.spriteChunks) { // google
      const docs = await Promise.all([...Array(q.spriteChunks)].map((_, i) => ucol('sprites').doc(`${q.id}-${i}`).get()));
      if (docs.some(d => !d.exists)) throw new Error('이미지를 불러오지 못했습니다');
      return b64ToBlob(docs.map(d => d.data().d).join(''));
    }
    const res = await fetch('/_blob/' + q.sprite); // cloud
    if (!res.ok) throw new Error('이미지를 불러오지 못했습니다');
    return res.blob();
  }

  async function hydrate(q) {
    if (!q || !(q.sprite || q.spriteChunks) || q.stemImg) return q;
    const key = q.sprite || q.id;
    if (!hydrated.has(key)) {
      hydrated.set(key, (async () => {
        const bm = await createImageBitmap(await spriteBlob(q));
        const out = {};
        for (const [k, [x, y, w, h]] of Object.entries(q.parts || {})) {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(bm, x, y, w, h, 0, 0, w, h);
          out[k] = await new Promise(r => c.toBlob(r, 'image/png'));
        }
        return out;
      })().catch(e => { hydrated.delete(key); throw e; }));
    }
    const p = await hydrated.get(key);
    IMG_KEYS.forEach(k => { if (p[k]) q[k] = p[k]; });
    q.choiceImgs = [0, 1, 2, 3].map(i => p['c' + i]).filter(Boolean);
    return q;
  }

  async function hydrateAll(qs, onProgress) {
    let n = 0;
    const queue = [...qs];
    const worker = async () => { while (queue.length) { await hydrate(queue.shift()); onProgress && onProgress(++n, qs.length); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async function allCloud(store) {
    const out = [];
    let last = null;
    for (;;) {
      let q = cdb.collection(store).orderBy('_k');
      if (last !== null) q = q.where('_k', '>', last);
      const snap = await retry(() => q.limit(1000).get());
      snap.docs.forEach(d => out.push({ ...d.data() }));
      if (snap.size < 1000) break;
      last = snap.docs[snap.docs.length - 1].data()._k;
    }
    return out;
  }

  async function all(store) {
    if (mode === 'cloud') return allCloud(store);
    if (mode === 'google') return (await ucol(store).get()).docs.map(d => ({ ...d.data() }));
    return DB.all(store);
  }

  // 반환값: 저장된 키(id 또는 aid)
  async function put(store, val) {
    if (store === 'attempts' && !val.aid) val.aid = newId();
    const key = store === 'attempts' ? String(val.aid) : val.id;
    if (mode === 'local') { await DB.put(store, val); return key; }
    if (store === 'questions' && val.stemImg && !val.sprite && !val.spriteChunks) {
      const s = await buildSprite(val);
      if (s && mode === 'cloud') {
        if (!assets) throw new Error('이 계정에서는 이미지를 저장할 권한이 없습니다 (편집 권한 필요)');
        const r = await retry(() => assets.upload(s.blob, { type: 'image/png' }));
        val.sprite = r.id; val.parts = s.parts;
      } else if (s) {
        const b64 = await blobToB64(s.blob);
        const n = Math.max(1, Math.ceil(b64.length / CHUNK));
        for (let i = 0; i < n; i++) await localFirst(ucol('sprites').doc(`${key}-${i}`).set({ d: b64.slice(i * CHUNK, (i + 1) * CHUNK) }));
        val.spriteChunks = n; val.parts = s.parts;
      }
    }
    const body = store === 'questions' ? meta(val) : JSON.parse(JSON.stringify(val));
    if (store === 'attempts') body.aid = key;
    if (mode === 'cloud') await retry(() => cdb.collection(store).doc(key).set({ ...body, _k: key }));
    else await localFirst(ucol(store).doc(key).set(body));
    return key;
  }

  async function del(store, key, row) {
    key = String(key);
    if (mode === 'local') {
      if (store === 'attempts' && /^\d+$/.test(key)) await DB.del(store, Number(key));
      return DB.del(store, key);
    }
    if (mode === 'cloud') {
      if (store === 'questions' && assets) {
        let sp = row && row.sprite;
        if (!row) { const d = await retry(() => cdb.collection('questions').doc(key).get()); sp = d.exists && d.data().sprite; }
        if (sp) { try { await retry(() => assets.delete(sp)); } catch (e) {} }
      }
      return retry(() => cdb.collection(store).doc(key).delete());
    }
    if (store === 'questions') {
      const d = await ucol('questions').doc(key).get();
      const n = (d.exists && d.data().spriteChunks) || 0;
      for (let i = 0; i < n; i++) await localFirst(ucol('sprites').doc(`${key}-${i}`).delete());
    }
    return localFirst(ucol(store).doc(key).delete());
  }

  async function clear(store, onProgress) {
    if (mode === 'local') return DB.clear(store);
    // 남은 것이 없을 때까지 반복 (중간에 실패해도 다시 누르면 이어서 지워짐)
    for (let round = 0; round < 3; round++) {
      const rows = await all(store);
      if (!rows.length) return;
      let n = 0;
      const queue = [...rows];
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift();
          await del(store, store === 'attempts' ? r.aid : r.id, r);
          onProgress && onProgress(++n, rows.length);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
  }

  // 이 브라우저(로그인 전)에 저장된 문제·기록을 Google 계정으로 옮김
  async function importLocal(onProgress) {
    if (mode !== 'google') return { q: 0, a: 0 };
    const [lq, la] = [await DB.all('questions'), await DB.all('attempts')];
    const have = new Set((await all('questions')).map(q => q.id));
    const haveA = new Set((await all('attempts')).map(a => a.createdAt));
    let q = 0, a = 0, i = 0;
    for (const x of lq) { onProgress && onProgress(++i, lq.length); if (have.has(x.id)) continue; await put('questions', x); q++; }
    for (const x of la) { if (haveA.has(x.createdAt)) continue; x.aid = String(x.aid); await put('attempts', x); a++; }
    // 영단어(겹치면 건너뜀)·질문노트도 함께
    const lv = await DB.all('vocab').catch(() => []), lqn = await DB.all('qnotes').catch(() => []);
    const haveV = new Set((await all('vocab')).map(v => v.id)), haveN = new Set((await all('qnotes')).map(n => n.id));
    for (const v of lv) { if (!haveV.has(v.id)) await put('vocab', v); }
    for (const n of lqn) { if (!haveN.has(n.id)) await put('qnotes', n); }
    const lw = await DB.all('wnotes').catch(() => []), haveW = new Set((await all('wnotes')).map(w => w.id));
    for (const w of lw) { if (!haveW.has(w.id)) await put('wnotes', w); }
    return { q, a, v: lv.length, n: lqn.length };
  }
  const localCount = async () => (await DB.all('questions')).length + (await DB.all('attempts')).length
    + (await DB.all('vocab').catch(() => [])).length + (await DB.all('qnotes').catch(() => [])).length;

  // 오프라인일 때 끝낸 시험 결과 — 연결되면 올림
  const PKEY = 'sat-pending-attempts';
  const readPending = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch (e) { return []; } };
  function queueAttempt(a) {
    if (!a.aid) a.aid = newId();
    a.pending = true;
    const list = readPending(); list.push(a);
    try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch (e) {}
    return 'pending:' + a.aid;
  }
  async function flushPending() {
    const list = readPending();
    if (!list.length || navigator.onLine === false) return 0;
    let n = 0;
    const left = [];
    for (const a of list) {
      try { delete a.pending; await put('attempts', a); n++; } catch (e) { a.pending = true; left.push(a); }
    }
    try { left.length ? localStorage.setItem(PKEY, JSON.stringify(left)) : localStorage.removeItem(PKEY); } catch (e) {}
    return n;
  }

  // 백업 파일 저장
  async function saveFile(filename, blob) {
    if (downloads) { await downloads.save({ filename, data: blob }); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  return {
    init, all, put, del, clear, hydrate, loadBank, bankInAccount, uploadBank, hydrateAll, saveFile, queueAttempt, flushPending, pendingCount: () => readPending().length, signIn, signOut, importLocal, localCount,
    onAuthChange: f => authListeners.push(f),
    get mode() { return mode; },
    get canUpload() { return mode !== 'cloud' || !!assets; },
    get googleReady() { return !!fb && mode !== 'cloud'; },
    get user() { return fbUser ? { name: fbUser.displayName || '', email: fbUser.email || '', photo: fbUser.photoURL || '' } : null; },
  };
})();

/* 페이지 안 확인창 (artifact에서는 confirm()이 동작하지 않음) */
U.confirm = (title, body = '', ok = '확인') => new Promise(res => {
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.innerHTML = `<div class="modal"><h2>${U.esc(title)}</h2>${body ? `<p class="muted">${U.esc(body)}</p>` : ''}
    <div class="modal-btns"><button class="btn" data-v="0">취소</button><button class="btn primary danger-fill" data-v="1">${U.esc(ok)}</button></div></div>`;
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (e.target === m || b) { m.remove(); res(!!(b && b.dataset.v === '1')); }
  });
  document.body.appendChild(m);
});
