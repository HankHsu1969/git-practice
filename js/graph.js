/* ==========================================================================
 * Commit 歷史圖（SVG）
 * 時間由左到右；每條分支一個車道；分支標籤疊在節點上方；
 * 工作目錄有未提交的變更時，HEAD 後面會出現一個虛線的「尚未提交」節點。
 * 標籤、節點位置改變時會平滑滑動（FLIP 動畫）。
 * ========================================================================== */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const LANES = 6;
  const { esc } = global.GitUtil;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }

  // 依顯示寬度截斷（中日韓字元算 2）
  function trunc(s, max) {
    let w = 0, out = '';
    for (const ch of s) {
      const cw = /[⺀-￯]/.test(ch) ? 2 : 1;
      if (w + cw > max) return out + '…';
      out += ch; w += cw;
    }
    return out;
  }

  // 從舊位置滑到新位置
  function flip(node, from, to) {
    if (!from || (from.x === to.x && from.y === to.y)) return false;
    node.style.transform = `translate(${from.x - to.x}px, ${from.y - to.y}px)`;
    node.getBoundingClientRect();
    requestAnimationFrame(() => {
      node.style.transition = 'transform .55s cubic-bezier(.3,.9,.3,1)';
      node.style.transform = '';
    });
    return true;
  }

  /**
   * @param host 容器
   * @param eng  GitEngine
   * @param mem  { seen:Set, pos:Map, lpos:Map } 跨次繪製保存，用來做動畫
   */
  function render(host, eng, mem) {
    host.innerHTML = '';
    if (!eng.repo) {
      host.innerHTML = '<div class="graph-empty"><div class="ge-icon">📷</div><p>Git 還沒開始管理這個資料夾</p><p class="muted">輸入 <code>git init</code> 後，快照會一個個出現在這裡</p></div>';
      mem.seen = new Set(); mem.pos = new Map(); mem.lpos = new Map();
      return;
    }
    const r = eng.repo;
    const all = Object.values(r.commits).sort((a, b) => a.n - b.n);
    if (!all.length) {
      host.innerHTML = `<div class="graph-empty"><span class="pill pill-head">HEAD → ${esc(eng.branch || 'main')}</span><p>還沒有任何快照（commit）</p><p class="muted">用 <code>git add</code> 和 <code>git commit</code> 建立第一個</p></div>`;
      return;
    }

    /* ---- 可到達的 commit（其餘畫成虛線） ---- */
    const tips = Object.values(r.branches);
    if (eng.headId) tips.push(eng.headId);
    if (r.merge) tips.push(r.merge.theirs);
    const reach = new Set();
    tips.forEach((t) => eng.ancestors(t).forEach((x) => reach.add(x)));

    /* ---- 車道：main 優先，其他分支依建立順序，沿第一個父節點往回走 ---- */
    const names = Object.keys(r.branches).sort((a, b) => {
      if (a === 'main') return -1;
      if (b === 'main') return 1;
      return (r.branchSeq[a] || 0) - (r.branchSeq[b] || 0);
    });
    const order = names.map((n) => r.branches[n]);
    if (r.head.type === 'detached') order.push(r.head.id);
    if (r.merge) order.push(r.merge.theirs);
    all.slice().reverse().forEach((c) => order.push(c.id));
    const laneOf = {};
    let lanes = 0;
    order.forEach((tip) => {
      let c = tip, any = false;
      while (c && laneOf[c] === undefined) { laneOf[c] = lanes; any = true; c = r.commits[c].parents[0]; }
      if (any) lanes++;
    });

    /* ---- 標籤 ---- */
    const labels = {};
    const push = (id, lb, front) => { (labels[id] = labels[id] || [])[front ? 'unshift' : 'push'](lb); };
    names.forEach((n) => {
      const isHead = r.head.type === 'branch' && r.head.name === n;
      push(r.branches[n], { key: n, text: n, head: isHead, lane: laneOf[r.branches[n]] }, isHead);
    });
    if (r.head.type === 'detached') push(r.head.id, { key: 'HEAD', text: 'HEAD', cls: 'is-detached' }, true);
    if (r.merge) push(r.merge.theirs, { key: 'MERGE_HEAD', text: '合併中', cls: 'is-merge' }, false);
    if (r.head.type === 'branch' && !r.branches[r.head.name]) {
      push(all[all.length - 1].id, { key: 'HEAD', text: r.head.name + '（尚無 commit）', head: true }, true);
    }
    const maxLabels = Math.max(1, ...Object.values(labels).map((l) => l.length));

    /* ---- 尚未提交的變更 ---- */
    const st = eng.computeStatus();
    const dirty = st.staged.length + st.unstaged.length + st.untracked.length + st.conflicts.length;
    const headId = eng.headId;

    /* ---- 版面 ---- */
    const DX = 116, R = 18, LH = 28;
    const TOP = 14 + maxLabels * LH + R;
    const DY = R * 2 + 50 + maxLabels * LH;
    const LEFT = 70;
    const cols = all.length + (dirty && headId ? 1 : 0);
    const W = Math.max(LEFT * 2 + (cols - 1) * DX, 240);
    const H = TOP + (lanes - 1) * DY + R + 44;
    const pos = {};
    all.forEach((c, i) => { pos[c.id] = { x: LEFT + i * DX, y: TOP + laneOf[c.id] * DY }; });

    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'graph-svg', role: 'img', 'aria-label': 'Commit 歷史圖' });
    host.appendChild(svg);
    const gE = el('g', { class: 'edges' }, svg);
    const gN = el('g', { class: 'nodes' }, svg);
    const gL = el('g', { class: 'labels' }, svg);
    let moved = false;

    /* ---- 連線（父 → 子） ---- */
    const curve = (q, p, k) => {
      if (q.y === p.y) return `M${q.x},${q.y} L${p.x},${p.y}`;
      if (k === 0) return `M${q.x},${q.y} C${q.x + DX / 2},${q.y} ${q.x + DX / 2},${p.y} ${q.x + DX},${p.y} L${p.x},${p.y}`;
      return `M${q.x},${q.y} L${p.x - DX},${q.y} C${p.x - DX / 2},${q.y} ${p.x - DX / 2},${p.y} ${p.x},${p.y}`;
    };
    all.forEach((c) => {
      c.parents.forEach((pid, k) => {
        if (!pos[pid]) return;
        const lane = k === 0 ? laneOf[c.id] : laneOf[pid];
        el('path', { d: curve(pos[pid], pos[c.id], k), class: `edge ln${lane % LANES}${mem.seen.has(c.id) ? '' : ' draw'}${reach.has(c.id) ? '' : ' unreach'}`, pathLength: 1 }, gE);
      });
    });

    /* ---- 節點 ---- */
    all.forEach((c) => {
      const p = pos[c.id];
      const isHead = c.id === headId;
      const g = el('g', {
        class: `node ln${laneOf[c.id] % LANES}${isHead ? ' is-head' : ''}${reach.has(c.id) ? '' : ' unreach'}`,
        transform: `translate(${p.x},${p.y})`, tabindex: 0, 'data-id': c.id
      }, gN);
      const mover = el('g', null, g);
      const inner = el('g', { class: 'inner' + (mem.seen.has(c.id) ? '' : ' pop') }, mover);
      if (isHead) el('circle', { r: R + 7, class: 'head-ring' }, inner);
      el('circle', { r: R, class: 'dot' }, inner);
      if (c.parents.length > 1) el('circle', { r: 6, class: 'merge-dot' }, inner);
      el('text', { y: R + 18, class: 'cmsg' }, inner).textContent = trunc(c.msg.split('\n')[0], 14);
      el('text', { y: R + 34, class: 'cid' }, inner).textContent = c.id;
      el('title', null, g).textContent = `${c.msg}\nID：${c.id}${c.parents.length > 1 ? '\n（合併 commit，有兩個父節點）' : ''}${reach.has(c.id) ? '' : '\n⚠ 沒有任何分支指向這個 commit'}\n\n點一下把 ID 填入終端機`;
      const prev = mem.pos.get(c.id);
      if (prev && flip(mover, prev, p)) moved = true;
    });

    /* ---- 尚未提交（WIP）節點 ---- */
    if (dirty && headId) {
      const hp = pos[headId];
      const wp = { x: LEFT + all.length * DX, y: hp.y };
      el('path', { d: `M${hp.x},${hp.y} L${wp.x},${wp.y}`, class: 'edge wip-edge' }, gE);
      const g = el('g', { class: 'node wip', transform: `translate(${wp.x},${wp.y})` }, gN);
      el('circle', { r: R, class: 'dot' }, g);
      el('text', { y: 5, class: 'wip-count' }, g).textContent = dirty;
      el('text', { y: R + 18, class: 'cmsg' }, g).textContent = '尚未提交';
      el('text', { y: R + 34, class: 'cid' }, g).textContent = '的變更';
      el('title', null, g).textContent = `有 ${dirty} 個檔案變更還沒 commit\n用 git add + git commit 把它們存成快照`;
    }

    /* ---- 標籤 ---- */
    const lpos = new Map();
    Object.keys(labels).forEach((id) => {
      const p = pos[id];
      if (!p) return;
      labels[id].forEach((lb, k) => {
        const top = p.y - R - 14 - (k + 1) * LH + 4;
        const at = { x: p.x, y: top };
        lpos.set(lb.key, at);
        const laneCls = lb.lane !== undefined ? ' ln' + (lb.lane % LANES) : '';
        const g = el('g', { class: `label${lb.head ? ' is-head' : ''}${lb.cls ? ' ' + lb.cls : ''}${laneCls}` }, gL);
        if (lb.head) {
          // [ HEAD | main ] 兩段式標籤
          const t1 = el('text', { x: 0, y: top + 16, class: 'label-text head-part' }, g);
          t1.textContent = '📍HEAD';
          const t2 = el('text', { x: 0, y: top + 16, class: 'label-text' }, g);
          t2.textContent = lb.text;
          const w1 = t1.getComputedTextLength() + 14, w2 = t2.getComputedTextLength() + 16, w = w1 + w2;
          t1.setAttribute('x', p.x - w / 2 + w1 / 2);
          t2.setAttribute('x', p.x - w / 2 + w1 + w2 / 2);
          g.insertBefore(el('rect', { x: p.x - w / 2, y: top, width: w, height: 22, rx: 11, class: 'branch-bg' }), t1);
          g.insertBefore(el('rect', { x: p.x - w / 2, y: top, width: w1, height: 22, rx: 11, class: 'head-bg' }), t1);
        } else {
          const tx = el('text', { x: p.x, y: top + 16, class: 'label-text' }, g);
          tx.textContent = lb.text;
          const w = tx.getComputedTextLength() + 18;
          g.insertBefore(el('rect', { x: p.x - w / 2, y: top, width: w, height: 22, rx: 11 }), tx);
        }
        const prev = mem.lpos.get(lb.key);
        if (flip(g, prev, at)) { moved = true; g.classList.add('moved'); }
        else if (!prev && mem.lpos.size) g.classList.add('appear');
      });
      el('line', { x1: p.x, y1: p.y - R - 14 + 4, x2: p.x, y2: p.y - R - 3, class: 'label-stem' }, gL);
    });

    if (moved) gE.classList.add('fade-in');
    mem.seen = new Set(all.map((c) => c.id));
    mem.pos = new Map(Object.entries(pos));
    mem.lpos = lpos;

    // 捲到最新的 commit
    host.scrollLeft = host.scrollWidth;
  }

  global.GitGraph = { render };
})(window);
