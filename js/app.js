/* ==========================================================================
 * 介面：課程進度列、任務卡、終端機、三個區域（含檔案飛行動畫）、快照歷史圖、解說泡泡
 * ========================================================================== */
(function () {
  'use strict';

  const { esc, GIT_CMDS, validFile } = window.GitUtil;
  const LESSONS = window.GIT_LESSONS;
  const KEY = 'git-lab-progress-v2';
  const $ = (s) => document.querySelector(s);

  const els = {
    stepper: $('#stepper'), lesson: $('#lesson'), termOut: $('#termOut'), termBody: $('#termBody'),
    input: $('#termInput'), prompt: $('#prompt'), graph: $('#graph'), areas: $('#areas'), explain: $('#explain'),
    editor: $('#editor'), editorForm: $('#editorForm'), editorTitle: $('#editorTitle'), editorName: $('#editorName'),
    nameField: $('#nameField'), editorText: $('#editorText'), editorErr: $('#editorErr')
  };

  const eng = new GitEngine();
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式等情況下略過 */ } }
  };

  let progress = store.get(KEY, {});
  if (!Array.isArray(progress.done)) progress.done = [];
  let cur = 0, cmds = [], doneAt = [];
  let graphMem = { seen: new Set(), pos: new Map(), lpos: new Map() };
  let cardState = new Map();
  const history = [];
  let hpos = 0, draft = '';

  /* ================= 課程 ================= */
  function loadLesson(i) {
    cur = Math.max(0, Math.min(LESSONS.length - 1, i));
    const L = LESSONS[cur];
    eng.reset();
    L.setup.forEach((c) => eng.exec(c));
    cmds = []; doneAt = [];
    graphMem = { seen: new Set(Object.keys(eng.repo ? eng.repo.commits : {})), pos: new Map(), lpos: new Map() };
    cardState = new Map();
    els.termOut.innerHTML = '';
    printLine([['第 ' + (cur + 1) + ' 課：' + L.title, 'title']]);
    printLine([['輸入 ', 'dim'], ['help', 'ok'], [' 看所有指令，按 Tab 可以自動補全', 'dim']]);
    printLine([['', '']]);
    setExplain(null, L.setup.length
      ? '練習環境已經準備好了。照著左邊的任務輸入指令，我會在這裡用白話解釋發生了什麼事。'
      : '照著左邊的任務輸入指令，我會在這裡用白話解釋發生了什麼事。');
    progress.current = cur;
    store.set(KEY, progress);
    renderAll();
    els.input.focus({ preventScroll: true });
  }

  function evaluate() {
    const L = LESSONS[cur];
    const ok = (fn, ctx) => { try { return !!fn(eng, ctx); } catch (e) { console.warn(e); return false; } };
    if (L.anyOrder) {
      L.steps.forEach((s, i) => { if (doneAt[i] === undefined && ok(s.check, { since: cmds, all: cmds })) doneAt[i] = cmds.length - 1; });
    } else {
      for (let i = 0; i < L.steps.length; i++) {
        if (doneAt[i] !== undefined) continue;
        const from = i === 0 ? 0 : doneAt[i - 1] + 1;
        if (ok(L.steps[i].check, { since: cmds.slice(from), all: cmds })) doneAt[i] = cmds.length - 1;
        else break;
      }
    }
    const complete = L.steps.every((_, i) => doneAt[i] !== undefined);
    if (complete && !progress.done.includes(L.id)) {
      progress.done.push(L.id);
      store.set(KEY, progress);
      return true;
    }
    return false;
  }

  // 執行完指令（或圖形介面操作）後的共同流程
  function afterAction(res, label, before) {
    if (res.explain) setExplain(label, res.explain);
    let completed = false;
    res.executed.forEach((e) => { cmds.push(e.cmd); if (evaluate()) completed = true; });
    const committing = (res.events || []).some((e) => e.type === 'commit');
    els.graph.style.setProperty('--pop-delay', committing ? '.6s' : '0s');
    renderAll();
    flyCards(res.events || [], before);
    if (completed) {
      printLine([['🎉 完成「' + LESSONS[cur].title + '」！', 'celebrate']]);
      celebrate();
    }
    scrollTerm();
  }

  /* ================= 終端機 ================= */
  function printLine(parts) {
    const div = document.createElement('div');
    div.className = 'tl';
    parts.forEach(([t, c]) => {
      const s = document.createElement('span');
      if (c) s.className = c.startsWith('p-') ? c : 't-' + c;
      s.textContent = t;
      div.appendChild(s);
    });
    els.termOut.appendChild(div);
  }

  function promptParts() {
    const p = [['~/project', 'p-path']];
    if (eng.repo) p.push([' (' + (eng.branch || eng.headId || '?') + (eng.repo.merge ? '|合併中' : '') + ')', eng.repo.merge ? 'p-merge' : 'p-branch']);
    p.push([' $ ', 'p-sep']);
    return p;
  }

  function renderPrompt() {
    els.prompt.innerHTML = '';
    promptParts().forEach(([t, c]) => {
      const s = document.createElement('span');
      s.className = c;
      s.textContent = t;
      els.prompt.appendChild(s);
    });
  }

  function scrollTerm() { els.termBody.scrollTop = els.termBody.scrollHeight; }

  function run(line) {
    printLine(promptParts().concat([[line, 'cmd']]));
    if (!line.trim()) { scrollTerm(); return; }
    if (history[history.length - 1] !== line) history.push(line);
    hpos = history.length; draft = '';
    const before = snapshotCards();
    const res = eng.exec(line);
    if (res.clear) els.termOut.innerHTML = '';
    else res.lines.forEach(printLine);
    afterAction(res, line, before);
  }

  function complete() {
    const input = els.input;
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret), after = input.value.slice(caret);
    const word = /(\S*)$/.exec(before)[1];
    const parts = before.split(/\s+/);
    const idx = parts.length - 1;
    let cands;
    if (idx === 0) cands = ['git', 'ls', 'cat', 'clear', 'help'];
    else if (parts[0] === 'git' && idx === 1) cands = Object.keys(GIT_CMDS);
    else {
      const s = new Set(Object.keys(eng.files));
      if (eng.repo) {
        Object.keys(eng.repo.branches).forEach((b) => s.add(b));
        Object.keys(eng.repo.index).forEach((f) => s.add(f));
        if (parts[1] === 'reset') ['HEAD~1', '--hard'].forEach((x) => s.add(x));
      }
      cands = [...s];
    }
    const hits = cands.filter((c) => c.startsWith(word)).sort();
    if (!hits.length) return;
    let ins;
    if (hits.length === 1) ins = hits[0].slice(word.length) + ' ';
    else {
      let pre = hits[0];
      hits.forEach((h) => { while (!h.startsWith(pre)) pre = pre.slice(0, -1); });
      ins = pre.slice(word.length);
      if (!ins) { printLine([[hits.join('   '), 'dim']]); scrollTerm(); return; }
    }
    input.value = before + ins + after;
    const pos = (before + ins).length;
    input.setSelectionRange(pos, pos);
  }

  function fillInput(text, append) {
    const v = els.input.value;
    els.input.value = append ? (v && !v.endsWith(' ') ? v + ' ' : v) + text : text;
    els.input.focus();
    const pos = els.input.value.length;
    els.input.setSelectionRange(pos, pos);
    els.input.closest('.terminal').classList.remove('nudge');
    void els.input.offsetWidth;
    els.input.closest('.terminal').classList.add('nudge');
  }

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = els.input.value;
      els.input.value = '';
      run(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hpos === history.length) draft = els.input.value;
      if (hpos > 0) { hpos--; els.input.value = history[hpos]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hpos < history.length) { hpos++; els.input.value = hpos === history.length ? draft : history[hpos]; }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    }
  });
  els.termBody.addEventListener('mouseup', () => {
    if (!window.getSelection().toString()) els.input.focus({ preventScroll: true });
  });

  /* ================= 繪製 ================= */
  function renderAll() {
    renderStepper();
    renderLesson();
    renderPrompt();
    renderAreas();
    GitGraph.render(els.graph, eng, graphMem);
    applyAttention();
  }

  function renderStepper() {
    els.stepper.innerHTML = LESSONS.map((L, i) => {
      const done = progress.done.includes(L.id);
      return `<button class="stp${i === cur ? ' active' : ''}${done ? ' done' : ''}" data-i="${i}" title="第 ${i + 1} 課：${esc(L.title)}" ${i === cur ? 'aria-current="step"' : ''}>
        <span class="stp-dot">${done ? '✓' : i + 1}</span><span class="stp-label">${esc(L.short)}</span></button>`;
    }).join('');
    const a = els.stepper.querySelector('.active');
    if (a) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function currentStep() {
    const L = LESSONS[cur];
    if (L.anyOrder) return null;
    const i = L.steps.findIndex((_, k) => doneAt[k] === undefined);
    return i < 0 ? null : L.steps[i];
  }

  function renderLesson() {
    const L = LESSONS[cur];
    const total = L.steps.length;
    const doneCount = L.steps.filter((_, i) => doneAt[i] !== undefined).length;
    const complete = doneCount === total;
    const now = currentStep();
    const last = cmds.length - 1;
    const items = L.steps.map((s, i) => {
      const d = doneAt[i] !== undefined;
      // 只有剛剛完成的任務才播放動畫，避免每次重畫都閃一下
      const just = d && last >= 0 && doneAt[i] === last;
      if (d) return `<li class="task done${just ? ' just' : ''}"><span class="tk">✓</span><span>${s.text}</span></li>`;
      if (s === now) {
        const fresh = i > 0 && doneAt[i - 1] === last;
        const action = s.cmd
          ? `<div class="cmd"><code>${esc(s.cmd)}</code><button class="btn fill" data-fill="${esc(s.cmd)}">填入 ⏎</button></div>`
          : `<div class="gui-hint">👉 請在右邊的圖形上操作</div>`;
        return `<li class="task now${fresh ? ' fresh' : ''}"><div class="task-label">任務 ${i + 1} / ${total}</div><div class="task-text">${s.text}</div>${action}</li>`;
      }
      return `<li class="task ${L.anyOrder ? 'challenge' : 'todo'}"><span class="tk">${L.anyOrder ? '☆' : i + 1}</span><span>${s.text}</span></li>`;
    }).join('');
    const next = LESSONS[cur + 1];
    els.lesson.innerHTML = `
      <div class="lesson-title"><span class="lesson-no">${cur + 1}</span><h2>${esc(L.title)}</h2></div>
      <p class="intro">${L.intro}</p>
      <ol class="tasks">${items}</ol>
      ${complete ? `<div class="lesson-done${doneAt.includes(last) ? ' fresh' : ''}"><div class="done-title">🎉 完成了！</div><p>${L.done}</p>
        ${next ? `<button class="btn primary" data-go="${cur + 1}">下一課：${esc(next.title)} →</button>` : ''}</div>` : ''}`;
    // 讓目前的任務（或完成訊息）一定看得到
    const focus = els.lesson.querySelector('.task.now, .lesson-done');
    if (focus) {
      const over = focus.offsetTop + focus.offsetHeight - (els.lesson.scrollTop + els.lesson.clientHeight);
      if (over > 0) els.lesson.scrollTop += over + 12;
    }
  }

  els.lesson.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { loadLesson(+go.dataset.go); return; }
    const fill = e.target.closest('[data-fill]');
    if (fill) fillInput(fill.dataset.fill);
  });
  els.stepper.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) loadLesson(+b.dataset.i);
  });

  /* ---------- 三個區域 ---------- */
  const BADGE = {
    wd: { untracked: '新檔案', modified: '已修改', deleted: '已刪除', conflict: '衝突', clean: '', plain: '' },
    idx: { added: '新增', modified: '已修改', deleted: '將刪除', conflict: '衝突', clean: '' },
    head: { clean: '' }
  };

  function card(area, name, cell) {
    const tip = cell.c === undefined ? '（檔案不在這裡了）' : '檔案內容：\n' + (cell.c === '' ? '（空白）' : cell.c);
    const badge = BADGE[area][cell.s];
    const edit = area === 'wd' && cell.s !== 'deleted'
      ? `<button class="fc-edit" data-edit="${esc(name)}" title="編輯 ${esc(name)}" aria-label="編輯 ${esc(name)}">✏️</button>` : '';
    return `<div class="fcard s-${cell.s}" data-card="${area}:${esc(name)}" title="${esc(tip)}">
      <div class="fc-top"><span class="fc-icon">📄</span><span class="fc-name">${esc(name)}</span>${edit}</div>
      ${badge ? `<span class="fc-badge">${badge}</span>` : ''}</div>`;
  }

  function renderAreas() {
    const rows = eng.fileRows();
    const r = eng.repo;
    const list = (area) => rows.filter((x) => x[area]).map((x) => card(area, x.name, x[area])).join('');
    const headSub = !r ? '' : eng.headId ? `最新快照 <code>${eng.headId}</code>` : '還沒有快照';
    const locked = !r ? ' locked' : '';
    const box = (area, icon, name, sub, body, extra) => `
      <div class="box area-${area}${area !== 'wd' ? locked : ''}">
        <div class="box-head"><span class="box-icon">${icon}</span><div><div class="box-name">${name}</div><div class="box-sub">${sub}</div></div></div>
        <div class="box-body">${body || (area !== 'wd' && !r ? '' : '<div class="box-empty">（空的）</div>')}</div>
        ${extra || ''}
        ${area !== 'wd' && !r ? '<div class="lock-msg">🔒 輸入 <code>git init</code><br>之後才會出現</div>' : ''}
      </div>`;
    const flow = (fwd, back) => `<div class="flow${locked}"><div class="flow-fwd"><code>${fwd}</code><span class="arrow">➜</span></div><div class="flow-back"><span class="arrow">➜</span><code>${back}</code></div></div>`;
    els.areas.innerHTML =
      box('wd', '📁', '工作目錄', '你編輯檔案的地方', list('wd'), '<button class="new-file" data-new data-focus="new">＋ 新檔案</button>') +
      flow('git add', 'git restore') +
      box('idx', '📦', '暫存區', '準備存成快照的內容', r ? list('idx') : '') +
      flow('git commit', '') +
      box('head', '🗄️', '儲存庫', headSub, r ? list('head') : '');

    // 新出現 / 內容改變的卡片給一點動畫
    const next = new Map();
    els.areas.querySelectorAll('[data-card]').forEach((el) => {
      const k = el.dataset.card;
      const row = rows.find((x) => x.name === k.slice(k.indexOf(':') + 1));
      const cell = row && row[k.slice(0, k.indexOf(':'))];
      const sig = cell ? cell.s + '|' + cell.c : '';
      next.set(k, sig);
      if (cardState.size && !cardState.has(k)) el.classList.add('appear');
      else if (cardState.size && cardState.get(k) !== sig) el.classList.add('changed');
    });
    cardState = next;
  }

  function snapshotCards() {
    const m = new Map();
    els.areas.querySelectorAll('[data-card]').forEach((e) => m.set(e.dataset.card, { rect: e.getBoundingClientRect(), html: e.outerHTML }));
    return m;
  }

  // 檔案卡片從一個區域「飛」到另一個區域
  function flyCards(events, before) {
    if (!before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const route = { add: ['wd', 'idx'], commit: ['idx', 'head'] };
    const pairs = [];
    events.forEach((ev) => {
      const [a, b] = ev.type === 'restore' ? [ev.from, ev.to] : route[ev.type] || [];
      if (a) ev.files.forEach((f) => pairs.push([a + ':' + f, b + ':' + f]));
    });
    pairs.forEach(([a, b], i) => {
      const src = before.get(a);
      const dst = els.areas.querySelector(`[data-card="${CSS.escape(b)}"]`);
      if (!src || !dst) return;
      const to = dst.getBoundingClientRect();
      const wrap = document.createElement('div');
      wrap.innerHTML = src.html;
      const g = wrap.firstElementChild;
      g.classList.remove('appear', 'changed');
      g.classList.add('ghost');
      Object.assign(g.style, { left: src.rect.left + 'px', top: src.rect.top + 'px', width: src.rect.width + 'px', height: src.rect.height + 'px' });
      document.body.appendChild(g);
      dst.classList.remove('appear', 'changed');
      dst.style.opacity = '0';
      const dx = to.left - src.rect.left, dy = to.top - src.rect.top;
      const anim = g.animate([
        { transform: 'translate(0,0) rotate(0) scale(1)' },
        { transform: `translate(${dx / 2}px, ${dy / 2 - 46}px) rotate(${dx > 0 ? 6 : -6}deg) scale(1.1)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0) scale(1)` }
      ], { duration: 750, delay: i * 140, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' });
      anim.onfinish = () => { g.remove(); dst.style.opacity = ''; dst.classList.add('landed'); };
    });
  }

  function applyAttention() {
    document.querySelectorAll('.attention').forEach((e) => e.classList.remove('attention'));
    const s = currentStep();
    if (!s || !s.gui) return;
    const target = s.gui === 'new' ? els.areas.querySelector('[data-new]') : els.areas.querySelector(`[data-edit="${CSS.escape(s.gui.slice(5))}"]`);
    if (target) target.classList.add('attention');
  }

  function setExplain(cmd, html) {
    els.explain.innerHTML = `<div class="bubble-icon" aria-hidden="true">💬</div><div class="bubble-text">${cmd ? `<div class="ex-cmd">${esc(cmd)}</div>` : ''}<div class="ex-body">${html}</div></div>`;
    els.explain.classList.remove('flash');
    void els.explain.offsetWidth;
    els.explain.classList.add('flash');
  }

  els.graph.addEventListener('click', (e) => {
    const n = e.target.closest('.node[data-id]');
    if (n) fillInput(n.dataset.id, true);
  });
  els.graph.addEventListener('keydown', (e) => {
    const n = e.target.closest('.node[data-id]');
    if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fillInput(n.dataset.id, true); }
  });
  els.explain.addEventListener('click', (e) => {
    const c = e.target.closest('.ex-body code');
    if (c && /^git /.test(c.textContent)) fillInput(c.textContent);
  });

  /* ================= 檔案編輯器 ================= */
  let editing = null;
  function openEditor(name) {
    editing = name;
    const isNew = name === null;
    els.editorTitle.textContent = isNew ? '＋ 新增檔案' : '✏️ 編輯 ' + name;
    els.nameField.hidden = !isNew;
    const s = currentStep();
    els.editorName.value = isNew && s && s.file ? s.file : '';
    els.editorText.value = isNew ? '' : eng.files[name];
    els.editorErr.textContent = '';
    els.editor.hidden = false;
    const f = isNew && !els.editorName.value ? els.editorName : els.editorText;
    f.focus();
    if (!isNew) f.setSelectionRange(f.value.length, f.value.length);
  }
  function closeEditor() { els.editor.hidden = true; els.input.focus({ preventScroll: true }); }

  els.editorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = editing === null ? els.editorName.value.trim() : editing;
    const text = els.editorText.value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (editing === null) {
      if (!validFile(name)) { els.editorErr.textContent = '請輸入檔名，不能有空白、斜線或特殊符號，例如 notes.txt'; els.editorName.focus(); return; }
      if (Object.prototype.hasOwnProperty.call(eng.files, name)) { els.editorErr.textContent = '已經有同名的檔案了，請換一個名字，或直接點它的 ✏️ 編輯'; els.editorName.focus(); return; }
    }
    closeEditor();
    const before = snapshotCards();
    const res = eng.editFile(name, text);
    printLine([[(editing === null ? '＋ 你建立了 ' : '✏️ 你修改了 ') + name, 'gui']]);
    afterAction(res, (editing === null ? '＋ 新增 ' : '✏️ 編輯 ') + name, before);
  });
  $('#editorCancel').addEventListener('click', closeEditor);
  els.editor.addEventListener('click', (e) => { if (e.target === els.editor) closeEditor(); });
  els.editorText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); els.editorForm.requestSubmit(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.editor.hidden) closeEditor(); });
  els.areas.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openEditor(ed.dataset.edit); return; }
    if (e.target.closest('[data-new]')) openEditor(null);
  });

  /* ================= 慶祝 ================= */
  function celebrate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = els.lesson.getBoundingClientRect();
    const colors = ['#e8553a', '#2563eb', '#16a34a', '#9333ea', '#db2777', '#ca8a04'];
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.background = colors[i % colors.length];
      p.style.left = box.left + box.width / 2 + 'px';
      p.style.top = box.top + 60 + 'px';
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 160;
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 140}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
    }
    requestAnimationFrame(() => { els.lesson.scrollTop = els.lesson.scrollHeight; });
  }

  /* ================= 練習人數 ================= */
  // 使用免費的 Abacus 計數服務。每個瀏覽器只計一次（localStorage 記號）；
  // 本機開發伺服器只讀取不計數；服務連不上時就不顯示。
  function showVisitors() {
    const el = $('#visitors');
    const COUNTED = 'git-lab-counted';
    const isDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    let canRemember = false;
    try { localStorage.setItem('git-lab-probe', '1'); localStorage.removeItem('git-lab-probe'); canRemember = true; } catch (e) { /* 無法記住就只讀取，避免重複計數 */ }
    const hit = canRemember && !isDev && !store.get(COUNTED, false);
    fetch(`https://abacus.jasoncameron.dev/${hit ? 'hit' : 'get'}/${el.dataset.counter}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (typeof d.value !== 'number' || d.value < 0) return;
        if (hit) store.set(COUNTED, true);
        $('#visitorCount').textContent = d.value.toLocaleString('zh-TW');
        el.hidden = false;
      })
      .catch(() => { /* 計數服務失敗不影響練習 */ });
  }

  /* ================= 開始 ================= */
  $('#btnReset').addEventListener('click', () => loadLesson(cur));
  loadLesson(typeof progress.current === 'number' ? progress.current : 0);
  showVisitors();
})();
