/* ==========================================================================
 * Git 模擬引擎
 * 在記憶體中模擬一個簡化版的 Git：工作目錄、暫存區、commit、分支、HEAD、合併。
 * 檔案只有一層（不支援資料夾），檔案內容以字串儲存，每一行以 \n 分隔。
 * ========================================================================== */
(function (global) {
  'use strict';

  const HOME = '/home/you/project';

  // 入門只教這幾個指令
  const GIT_CMDS = {
    init: '建立儲存庫',
    status: '查看目前狀態',
    add: '把檔案放進暫存區',
    commit: '把暫存區存成快照',
    log: '查看歷史紀錄',
    restore: '復原檔案的修改',
    reset: '把分支退回之前的 commit',
    branch: '列出 / 建立分支',
    switch: '切換分支',
    merge: '合併分支',
    help: '顯示說明'
  };

  // 真實存在但不在入門範圍的指令：給出替代建議
  const OUT_OF_SCOPE = {
    checkout: '請改用 git switch（切換分支）或 git restore（復原檔案），這是新版 Git 推薦的寫法。',
    diff: '這個練習用右邊的圖形來看差異：把滑鼠移到檔案卡片上就能看到內容。',
    rm: '要刪除檔案，這個練習裡不需要用到它。',
    config: '這個練習已經幫你設定好作者資訊了。',
    stash: '這是進階指令，入門階段先用 commit 保存工作就好。',
    rebase: '這是進階指令，入門階段先學 git merge。',
    push: '這是和遠端（例如 GitHub）有關的指令，本練習只在你的電腦上操作。',
    pull: '這是和遠端（例如 GitHub）有關的指令，本練習只在你的電腦上操作。',
    clone: '這是和遠端（例如 GitHub）有關的指令，本練習只在你的電腦上操作。',
    fetch: '這是和遠端（例如 GitHub）有關的指令，本練習只在你的電腦上操作。',
    remote: '這是和遠端（例如 GitHub）有關的指令，本練習只在你的電腦上操作。'
  };

  const SHELL_CMDS = {
    'ls': '列出檔案',
    'cat <file>': '顯示檔案內容',
    'clear': '清空畫面',
    'help': '顯示這份說明'
  };

  /* ---------------- 小工具 ---------------- */
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (o) => Object.assign({}, o);
  const splitLines = (s) => (s === undefined || s === null || s === '' ? [] : String(s).split('\n'));
  const union = (...objs) => {
    const s = new Set();
    objs.forEach((o) => o && Object.keys(o).forEach((k) => s.add(k)));
    return [...s].sort();
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const code = (s) => '<code>' + esc(s) + '</code>';
  const b = (s) => '<b>' + esc(s) + '</b>';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const listNames = (arr) => arr.map(code).join('、');
  const sameTree = (a, b2) => {
    const ka = Object.keys(a), kb = Object.keys(b2);
    return ka.length === kb.length && ka.every((k) => hasOwn(b2, k) && a[k] === b2[k]);
  };
  const validFile = (n) => !!n && !/[\/\\\s<>|:*?"]/.test(n) && n !== '.' && n !== '..' && n !== '.git';
  const validBranch = (n) => !!n && /^[^\s~^:?*\[\\\-][^\s~^:?*\[\\]*$/.test(n) && n !== 'HEAD' && !n.includes('..') && !n.endsWith('/') && !n.endsWith('.');

  function lineDiff(a, c) {
    const n = a.length, m = c.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === c[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === c[j]) { ops.push([' ', a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; }
      else { ops.push(['+', c[j]]); j++; }
    }
    while (i < n) ops.push(['-', a[i++]]);
    while (j < m) ops.push(['+', c[j++]]);
    return ops;
  }

  function lev(a, c) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= c.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= c.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === c[j - 1] ? 0 : 1));
    return d[a.length][c.length];
  }

  function fmtDate(d) {
    const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = (x) => String(x).padStart(2, '0');
    const off = -d.getTimezoneOffset(), a = Math.abs(off);
    const tz = (off >= 0 ? '+' : '-') + p(Math.floor(a / 60)) + p(a % 60);
    return `${W[d.getDay()]} ${M[d.getMonth()]} ${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()} ${tz}`;
  }

  /* ---------------- 指令列解析：支援引號、>、>>、&&、; ---------------- */
  function parse(line) {
    const segs = [];
    let args = [], redir = null, pending = null, cur = '', has = false, q = null;
    const pushWord = () => {
      if (!has) return;
      if (pending) { redir = { op: pending, file: cur }; pending = null; }
      else args.push(cur);
      cur = ''; has = false;
    };
    const endSeg = (op) => {
      pushWord();
      if (pending) throw new Error("syntax error near unexpected token `newline'");
      if (args.length) segs.push({ args, redir, op });
      else if (redir || op) throw new Error('syntax error: 缺少指令');
      args = []; redir = null;
    };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (ch === ' ' || ch === '\t') { pushWord(); continue; }
      if (ch === '>') {
        pushWord();
        if (pending) throw new Error("syntax error near unexpected token `>'");
        if (line[i + 1] === '>') { pending = '>>'; i++; } else pending = '>';
        continue;
      }
      if (ch === '&' && line[i + 1] === '&') { i++; endSeg('&&'); continue; }
      if (ch === ';') { endSeg(';'); continue; }
      cur += ch; has = true;
    }
    if (q) throw new Error('unexpected EOF while looking for matching `' + q + "'（引號沒有成對）");
    pushWord();
    if (pending) throw new Error("syntax error near unexpected token `newline'");
    if (args.length) segs.push({ args, redir, op: null });
    else if (redir) throw new Error('syntax error: 缺少指令');
    return segs;
  }

  const quoteArg = (a) => (a === '' || /[\s"'<>;&]/.test(a) ? '"' + a + '"' : a);
  const segText = (seg) => seg.args.map(quoteArg).join(' ') + (seg.redir ? ' ' + seg.redir.op + ' ' + quoteArg(seg.redir.file) : '');

  /* ======================================================================== */
  class GitEngine {
    constructor() { this.reset(); }

    reset() {
      this.files = {};          // 工作目錄：檔名 -> 內容
      this.repo = null;         // git init 之後才存在
      this.config = { 'user.name': 'You', 'user.email': 'you@example.com' };
      this.stats = { conflictMerges: 0 };
      this.events = [];
      this.lines = [];
      this.stdout = this.lines;
    }

    /* ---------- 輸出 ---------- */
    print(text, cls) { this.stdout.push([[String(text), cls || '']]); }
    printParts(parts) { this.stdout.push(parts.map((p) => (Array.isArray(p) ? p : [p, '']))); }
    err(text) { String(text).split('\n').forEach((t) => this.lines.push([[t, 'err']])); return false; }
    hint(text) { String(text).split('\n').forEach((t) => this.lines.push([[t, 'warn']])); }
    say(html) { this.explain = html; }

    /* ---------- 執行一整行 ---------- */
    exec(line) {
      this.lines = []; this.stdout = this.lines; this.explain = null; this.clear = false; this.events = [];
      const executed = [];
      let segs;
      try { segs = parse(String(line)); }
      catch (e) {
        this.err('bash: ' + e.message);
        this.say('指令格式有誤。含有空白的文字請用成對的引號包起來，例如 ' + code('git commit -m "我的訊息"') + '。');
        return this.result(executed);
      }
      for (const seg of segs) {
        const ok = this.runSegment(seg);
        executed.push({ cmd: segText(seg), ok });
        if (!ok && seg.op === '&&') break;
      }
      return this.result(executed);
    }
    result(executed) { return { lines: this.lines, explain: this.explain, executed, clear: this.clear, events: this.events }; }

    /* 圖形介面的「編輯檔案」：直接修改工作目錄 */
    editFile(name, content) {
      this.lines = []; this.stdout = this.lines; this.explain = null; this.clear = false; this.events = [];
      const existed = hasOwn(this.files, name);
      const before = this.files[name];
      this.files[name] = content;
      if (!existed) this.say(`建立了新檔案 ${code(name)}。` + this.trackNote(name));
      else if (before === content) this.say(`${code(name)} 的內容沒有改變。`);
      else this.say(`修改了 ${code(name)} 的內容。` + this.trackNote(name));
      return this.result([{ cmd: (existed ? '#edit ' : '#new ') + name, ok: true }]);
    }

    runSegment(seg) {
      const r = seg.redir;
      if (r && !validFile(r.file)) return this.err(`bash: ${r.file}: 無效的檔名（此模擬器不支援資料夾、空白與特殊字元）`);
      const buf = [];
      if (r) this.stdout = buf;
      let ok;
      try { ok = this.dispatch(seg.args) !== false; }
      catch (e) { console.error(e); this.stdout = this.lines; ok = this.err('模擬器內部錯誤：' + e.message); }
      this.stdout = this.lines;
      if (r && ok) {
        const text = buf.map((l) => l.map((p) => p[0]).join('')).join('\n');
        const existed = hasOwn(this.files, r.file);
        if (r.op === '>' || !this.files[r.file]) this.files[r.file] = text;
        else this.files[r.file] += '\n' + text;
        if (seg.args[0] === 'echo') {
          this.say((r.op === '>'
            ? `把文字寫入 ${code(r.file)}（${existed ? '覆蓋了原本的內容' : '建立了新檔案'}）。`
            : `在 ${code(r.file)} 的最後${existed ? '加上一行' : '建立檔案並寫入一行'}。`) + this.trackNote(r.file));
        }
      }
      return ok;
    }

    trackNote(f) {
      if (!this.repo) return '';
      if (this.repo.merge && this.repo.merge.conflicts.has(f))
        return `<br>內容改好之後，用 ${code('git add ' + f)} 標記衝突已解決。`;
      if (hasOwn(this.repo.index, f) || hasOwn(this.headTree(), f))
        return `<br>Git 已經在追蹤這個檔案，所以它變成<b>已修改</b>（橘色）。用 ${code('git add ' + f)} 把修改放進暫存區。`;
      return `<br>這是 Git 還沒追蹤的<b>新檔案</b>（紅色）。用 ${code('git add ' + f)} 把它放進暫存區。`;
    }

    dispatch(args) {
      const cmd = args[0], rest = args.slice(1);
      switch (cmd) {
        case 'git': return this.git(rest);
        case 'ls': case 'dir': return this.sh_ls(rest);
        case 'cat': case 'type': return this.sh_cat(rest);
        case 'touch': return this.sh_touch(rest);
        case 'echo':
          this.print(rest.filter((a) => a !== '-e' && a !== '-n').join(' '));
          if (!this.explain) this.say('echo 會把文字印到畫面上。加上 ' + code('> 檔名') + ' 可以寫入檔案，' + code('>> 檔名') + ' 則是加在檔案最後。');
          return true;
        case 'rm': case 'del': return this.sh_rm(rest);
        case 'pwd': this.print(HOME); this.say('你現在位於專案資料夾 ' + code(HOME) + '。'); return true;
        case 'clear': case 'cls': this.clear = true; return true;
        case 'help': return this.sh_help();
        case 'cd':
          if (!rest.length || rest[0] === '.' || rest[0] === '~' || rest[0] === HOME) return true;
          this.err(`bash: cd: ${rest[0]}: No such file or directory`);
          this.say('這個模擬器只有一個專案資料夾，不需要切換目錄。');
          return false;
        case 'mkdir':
          this.err('mkdir: 此模擬器不支援資料夾');
          this.say('為了讓練習單純，這個模擬器只支援單層檔案。');
          return false;
        case 'vim': case 'vi': case 'nano': case 'code': case 'notepad': case 'emacs':
          this.err(`${cmd}: 此模擬器沒有文字編輯器`);
          this.hint('提示：請點右邊檔案卡片上的 ✏️ 來編輯檔案');
          return false;
        default:
          this.err(`bash: ${cmd}: command not found`);
          if (hasOwn(GIT_CMDS, cmd)) {
            this.hint(`提示：你是不是想輸入 git ${cmd}？Git 指令前面要加上 git`);
            this.say(`Git 的指令都要以 ${code('git')} 開頭，例如 ${code('git ' + cmd)}。`);
          } else {
            this.say('找不到這個指令。輸入 ' + code('help') + ' 查看模擬器支援哪些指令。');
          }
          return false;
      }
    }

    /* ---------------- Shell 指令 ---------------- */
    sh_ls(args) {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const paths = args.filter((a) => !a.startsWith('-'));
      if (paths.length) {
        let ok = true;
        paths.forEach((p) => {
          if (hasOwn(this.files, p)) this.print(p);
          else if (p === '.git' && this.repo) this.print('HEAD  config  index  objects  refs', 'info');
          else ok = this.err(`ls: cannot access '${p}': No such file or directory`);
        });
        return ok;
      }
      const all = flags.includes('a'), long = flags.includes('l');
      const names = Object.keys(this.files).sort();
      const items = names.map((n) => [n, '']);
      if (all) items.unshift(['.', 'info'], ['..', 'info'], ...(this.repo ? [['.git', 'info']] : []));
      if (long) items.forEach(([n, c]) => this.printParts([[(c ? 'd' : '-') + 'rw-r--r--  ', 'dim'], [n, c]]));
      else if (items.length) {
        const parts = [];
        items.forEach(([n, c], i) => { if (i) parts.push(['  ', '']); parts.push([n, c]); });
        this.printParts(parts);
      }
      let msg = names.length ? `工作目錄中有 ${names.length} 個檔案。` : '工作目錄中沒有任何檔案。';
      if (all) msg += this.repo
        ? `<br>藍色的 ${code('.git')} 就是 Git <b>儲存庫</b>本體，所有 commit、分支等版本資料都存放在這個隱藏資料夾裡。請不要手動修改它！`
        : `<br>這裡沒有 ${code('.git')} 資料夾，代表它還不是 Git 儲存庫。`;
      this.say(msg);
      return true;
    }

    sh_cat(args) {
      if (!args.length) return this.err('cat: 請指定檔名，例如 cat README.md');
      let ok = true, markers = false;
      args.forEach((f) => {
        if (!hasOwn(this.files, f)) { ok = this.err(`cat: ${f}: No such file or directory`); return; }
        splitLines(this.files[f]).forEach((l) => {
          const m = /^(<<<<<<<|=======|>>>>>>>)/.test(l);
          if (m) markers = true;
          this.print(l, m ? 'warn' : '');
        });
      });
      if (ok) {
        let msg = `顯示 ${listNames(args)} 的內容。`;
        if (markers) msg += `<br>檔案裡有<b>衝突標記</b>：${code('<<<<<<< HEAD')} 到 ${code('=======')} 之間是<b>目前分支</b>的內容，${code('=======')} 到 ${code('>>>>>>>')} 之間是<b>要合併進來的分支</b>的內容。請改成你要的最終內容，並刪掉這些標記。`;
        this.say(msg);
      } else {
        this.say('找不到這個檔案。用 ' + code('ls') + ' 看看工作目錄裡有哪些檔案。');
      }
      return ok;
    }

    sh_touch(args) {
      if (!args.length) return this.err('touch: missing file operand');
      for (const f of args) if (!validFile(f)) return this.err(`touch: ${f}: 無效的檔名（此模擬器不支援資料夾、空白與特殊字元）`);
      const created = args.filter((f) => !hasOwn(this.files, f));
      created.forEach((f) => { this.files[f] = ''; });
      this.say(created.length
        ? `建立了空檔案 ${listNames(created)}。` + (this.repo ? '它目前是<b>未追蹤（untracked）</b>狀態：Git 知道它存在，但還沒開始管理它。' : '')
        : '檔案已經存在，touch 不會改變它的內容。');
      return true;
    }

    sh_rm(args) {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const paths = args.filter((a) => !a.startsWith('-'));
      if (!paths.length) return this.err('rm: missing operand');
      const removed = [];
      for (const f of paths) {
        if (f === '.git') {
          if (!this.repo) { if (!flags.includes('f')) return this.err("rm: cannot remove '.git': No such file or directory"); continue; }
          if (!flags.includes('r')) return this.err("rm: cannot remove '.git': Is a directory");
          this.repo = null;
          this.say(`你刪除了 ${code('.git')} 資料夾，<b>整個版本歷史都消失了</b>！工作目錄的檔案還在，但 Git 已經不再管理它們。可以用 ${code('git init')} 重新開始，或按「重置本課」。`);
          continue;
        }
        if (!hasOwn(this.files, f)) {
          if (flags.includes('f')) continue;
          return this.err(`rm: cannot remove '${f}': No such file or directory`);
        }
        delete this.files[f];
        removed.push(f);
      }
      if (removed.length) {
        const tracked = this.repo ? removed.filter((f) => hasOwn(this.repo.index, f)) : [];
        let msg = `從工作目錄刪除了 ${listNames(removed)}。`;
        if (tracked.length) msg += `<br>${listNames(tracked)} 是已追蹤的檔案，${code('git status')} 會顯示 <b>deleted</b>。後悔了可以用 ${code('git restore ' + tracked[0])} 救回來；確定要刪除則用 ${code('git add')} 暫存這個刪除。`;
        this.say(msg);
      }
      return true;
    }

    sh_help() {
      this.print('Git 指令', 'info');
      Object.entries(GIT_CMDS).forEach(([k, v]) => this.printParts([['  git ' + k.padEnd(9), 'ok'], [v, '']]));
      this.print('');
      this.print('其他', 'info');
      Object.entries(SHELL_CMDS).forEach(([k, v]) => this.printParts([['  ' + k.padEnd(13), 'ok'], [v, '']]));
      this.print('');
      this.print('新增、修改檔案：用右邊工作目錄的 ＋ 與 ✏️ 按鈕', 'dim');
      this.say('這些就是入門需要的全部指令！按 Tab 可以自動補全。');
      return true;
    }

    /* ---------------- 儲存庫狀態小工具 ---------------- */
    get headId() {
      if (!this.repo) return null;
      const h = this.repo.head;
      return h.type === 'branch' ? (this.repo.branches[h.name] || null) : h.id;
    }
    get branch() { return this.repo && this.repo.head.type === 'branch' ? this.repo.head.name : null; }
    commit(id) { return this.repo.commits[id]; }
    tree(id) { return id ? this.repo.commits[id].tree : {}; }
    headTree() { return this.tree(this.headId); }
    commitCount() { return this.repo ? Object.keys(this.repo.commits).length : 0; }
    newId() {
      let id;
      do { id = Array.from({ length: 7 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''); }
      while (this.repo.commits[id] || /^\d+$/.test(id));
      return id;
    }
    ancestors(id) {
      const s = new Set(), stack = id ? [id] : [];
      while (stack.length) {
        const c = stack.pop();
        if (s.has(c)) continue;
        s.add(c);
        stack.push(...this.commit(c).parents);
      }
      return s;
    }
    isAncestor(a, c) { return !!a && !!c && this.ancestors(c).has(a); }
    mergeBase(a, c) {
      const A = this.ancestors(a);
      let best = null;
      this.ancestors(c).forEach((id) => { if (A.has(id) && (!best || this.commit(id).n > this.commit(best).n)) best = id; });
      return best;
    }
    resolve(ref) {
      if (!this.repo || !ref) return null;
      const m = /^(.*?)((?:[~^]\d*)*)$/.exec(ref);
      const base = m[1];
      let id = null;
      if (base === 'HEAD' || base === '@') id = this.headId;
      else if (hasOwn(this.repo.branches, base)) id = this.repo.branches[base];
      else if (/^[0-9a-f]{4,40}$/.test(base)) {
        const hits = Object.keys(this.repo.commits).filter((k) => k.startsWith(base) || base.startsWith(k));
        if (hits.length === 1) id = hits[0];
      }
      if (!id) return null;
      for (const op of m[2].match(/[~^]\d*/g) || []) {
        const n = op.length > 1 ? parseInt(op.slice(1), 10) : 1;
        if (op[0] === '~') {
          for (let i = 0; i < n; i++) { id = this.commit(id).parents[0]; if (!id) return null; }
        } else if (n > 0) {
          id = this.commit(id).parents[n - 1];
          if (!id) return null;
        }
      }
      return id;
    }
    matchPaths(p, candidates) {
      if (p === '.' || p === '*' || p === ':/') return candidates.slice();
      if (/[*?]/.test(p)) {
        const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        return candidates.filter((f) => re.test(f));
      }
      return candidates.includes(p) ? [p] : [];
    }
    moveHead(id) {
      const h = this.repo.head;
      if (h.type === 'branch') {
        if (!hasOwn(this.repo.branches, h.name) && !hasOwn(this.repo.branchSeq, h.name)) this.repo.branchSeq[h.name] = ++this.repo.bseq;
        this.repo.branches[h.name] = id;
      } else h.id = id;
    }
    decoParts(id) {
      const r = this.repo, h = r.head;
      const names = Object.keys(r.branches).filter((n) => r.branches[n] === id).sort();
      const items = [];
      if (h.type === 'detached' && h.id === id) items.push([['HEAD', 'head']]);
      if (h.type === 'branch' && names.includes(h.name)) items.push([['HEAD -> ', 'head'], [h.name, 'branch']]);
      names.filter((n) => !(h.type === 'branch' && n === h.name)).forEach((n) => items.push([[n, 'branch']]));
      if (!items.length) return [];
      const parts = [['(', 'warn']];
      items.forEach((it, i) => { if (i) parts.push([', ', 'warn']); parts.push(...it); });
      parts.push([')', 'warn']);
      return parts;
    }
    computeStatus() {
      const head = this.headTree(), idx = this.repo.index, wd = this.files;
      const cset = this.repo.merge ? this.repo.merge.conflicts : new Set();
      const staged = [], unstaged = [], untracked = [];
      union(head, idx).forEach((f) => {
        if (cset.has(f)) return;
        if (!hasOwn(head, f)) staged.push(['new file', f]);
        else if (!hasOwn(idx, f)) staged.push(['deleted', f]);
        else if (head[f] !== idx[f]) staged.push(['modified', f]);
      });
      Object.keys(idx).sort().forEach((f) => {
        if (cset.has(f)) return;
        if (!hasOwn(wd, f)) unstaged.push(['deleted', f]);
        else if (wd[f] !== idx[f]) unstaged.push(['modified', f]);
      });
      Object.keys(wd).sort().forEach((f) => { if (!hasOwn(idx, f) && !cset.has(f)) untracked.push(f); });
      return { staged, unstaged, untracked, conflicts: [...cset].sort() };
    }
    diffStat(a, c) {
      const per = [];
      let ins = 0, del = 0;
      union(a, c).filter((f) => a[f] !== c[f]).forEach((f) => {
        const ops = lineDiff(splitLines(a[f]), splitLines(c[f]));
        const i = ops.filter((o) => o[0] === '+').length, d = ops.filter((o) => o[0] === '-').length;
        ins += i; del += d;
        per.push({ f, i, d, created: !hasOwn(a, f), deleted: !hasOwn(c, f) });
      });
      return { files: per, ins, del };
    }
    printStat(a, c, modes, perFile) {
      const s = this.diffStat(a, c);
      if (!s.files.length) return s;
      if (perFile) {
        const w = Math.max(...s.files.map((x) => x.f.length));
        s.files.forEach((x) => this.printParts([[' ' + x.f.padEnd(w) + ' | ' + (x.i + x.d) + ' ', ''], ['+'.repeat(Math.min(x.i, 30)), 'ok'], ['-'.repeat(Math.min(x.d, 30)), 'err']]));
      }
      let line = ' ' + plural(s.files.length, 'file') + ' changed';
      if (s.ins || !s.del) line += ', ' + plural(s.ins, 'insertion') + '(+)';
      if (s.del || !s.ins) line += ', ' + plural(s.del, 'deletion') + '(-)';
      this.print(line);
      if (modes) s.files.forEach((x) => {
        if (x.created) this.print(' create mode 100644 ' + x.f);
        if (x.deleted) this.print(' delete mode 100644 ' + x.f);
      });
      return s;
    }
    reachableFromBranches() {
      const s = new Set();
      Object.values(this.repo.branches).forEach((id) => this.ancestors(id).forEach((x) => s.add(x)));
      return s;
    }
    warnLeavingDetached(targetId) {
      const r = this.repo;
      if (r.head.type !== 'detached' || !r.head.id || r.head.id === targetId) return;
      const keep = this.reachableFromBranches();
      if (targetId) this.ancestors(targetId).forEach((x) => keep.add(x));
      const lost = [...this.ancestors(r.head.id)].filter((x) => !keep.has(x));
      if (!lost.length) return;
      const c = this.commit(r.head.id);
      this.hint(`Warning: you are leaving ${plural(lost.length, 'commit')} behind, not connected to\nany of your branches:\n\n  ${c.id} ${c.msg.split('\n')[0]}\n\nIf you want to keep it by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${c.id}\n`);
      this.leftBehind = c.id;
    }
    printCarried() {
      const st = this.computeStatus();
      const L = { 'new file': 'A', modified: 'M', deleted: 'D' };
      const m = {};
      st.staged.forEach(([k, f]) => { m[f] = L[k]; });
      st.unstaged.forEach(([k, f]) => { if (!m[f]) m[f] = L[k]; });
      Object.keys(m).sort().forEach((f) => this.print(m[f] + '\t' + f));
      return Object.keys(m);
    }

    /* 把工作目錄與暫存區從目前的 HEAD 版本換成 target 版本；未提交的修改若不衝突就一起帶過去 */
    switchTree(target, verb) {
      const head = this.headTree(), idx = this.repo.index, wd = this.files;
      const files = union(head, idx, wd, target);
      const blocked = [], untrackedBlocked = [];
      for (const f of files) {
        const h = head[f], t = target[f];
        if (h === t) continue;
        const tracked = hasOwn(idx, f) || hasOwn(head, f);
        if (!tracked) {
          if (hasOwn(wd, f) && wd[f] !== t) untrackedBlocked.push(f);
          continue;
        }
        const dirty = idx[f] !== h || wd[f] !== idx[f];
        if (dirty && !(idx[f] === t && wd[f] === t)) blocked.push(f);
      }
      if (blocked.length || untrackedBlocked.length) {
        const action = verb === 'merge' ? 'merge' : 'switch branches';
        if (blocked.length) {
          this.err(`error: Your local changes to the following files would be overwritten by ${verb}:`);
          blocked.forEach((f) => this.err('\t' + f));
          this.err(`Please commit your changes or stash them before you ${action}.`);
        }
        if (untrackedBlocked.length) {
          this.err(`error: The following untracked working tree files would be overwritten by ${verb}:`);
          untrackedBlocked.forEach((f) => this.err('\t' + f));
          this.err(`Please move or remove them before you ${action}.`);
        }
        this.err('Aborting');
        const all = blocked.concat(untrackedBlocked);
        this.say(`${verb === 'merge' ? '合併' : '切換'}被拒絕了：你對 ${listNames(all)} 的修改還沒有 commit，而目標版本中這些檔案的內容不同，繼續下去會<b>蓋掉你的修改</b>。<br>請先用 ${code('git add')} + ${code('git commit')} 保存，或用 ${code('git restore')} 丟棄修改，再試一次。`);
        return false;
      }
      for (const f of files) {
        const h = head[f], t = target[f];
        if (h === t) continue;
        if (t === undefined) { delete idx[f]; delete wd[f]; }
        else { idx[f] = t; wd[f] = t; }
      }
      return true;
    }

    /* ======================= Git 指令 ======================= */
    git(args) {
      if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return this.git_help();
      if (args[0] === '--version' || args[0] === 'version') { this.print('git version 2.46.0 (Git 練功房模擬器)'); return true; }
      const sub = args[0], rest = args.slice(1);
      if (hasOwn(OUT_OF_SCOPE, sub)) {
        this.err(`git ${sub}：這個指令不在入門練習的範圍內`);
        this.say(`${code('git ' + sub)} 是真實存在的指令，但不在這個入門練習裡。${esc(OUT_OF_SCOPE[sub])}<br>輸入 ${code('help')} 查看可以用的指令。`);
        return false;
      }
      if (!hasOwn(GIT_CMDS, sub)) {
        this.err(`git: '${sub}' is not a git command. See 'git --help'.`);
        const near = Object.keys(GIT_CMDS).filter((c) => lev(c, sub) <= 2);
        if (near.length) { this.print(''); this.print('The most similar command is'); near.forEach((n) => this.print('\t' + n)); }
        this.say(`模擬器不認得 ${code('git ' + sub)}。` + (near.length ? `你是不是想輸入 ${code('git ' + near[0])}？` : `輸入 ${code('git help')} 查看支援的指令。`));
        return false;
      }
      if (!['init', 'help'].includes(sub) && !this.repo) {
        this.err('fatal: not a git repository (or any of the parent directories): .git');
        this.say(`這個資料夾還不是 Git 儲存庫，所以 Git 不知道要管理什麼。請先執行 ${code('git init')}。`);
        return false;
      }
      return this['git_' + sub](rest);
    }

    git_help() {
      this.print('usage: git <command> [<args>]');
      this.print('');
      this.print('這個模擬器支援的 Git 指令：', 'info');
      Object.entries(GIT_CMDS).forEach(([k, v]) => this.printParts([['   ' + k.padEnd(10), 'ok'], [v, '']]));
      this.say('上面是模擬器支援的 Git 指令。真正的 Git 還有更多指令，但這些已經足夠應付日常工作的大部分情況！');
      return true;
    }

    git_init() {
      if (this.repo) {
        this.print(`Reinitialized existing Git repository in ${HOME}/.git/`);
        this.say('這裡已經是 Git 儲存庫了，重新初始化不會影響現有的 commit。');
        return true;
      }
      this.repo = { index: {}, commits: {}, branches: {}, head: { type: 'branch', name: 'main' }, merge: null, branchSeq: { main: 0 }, bseq: 0, seq: 0, prev: null };
      this.print(`Initialized empty Git repository in ${HOME}/.git/`);
      let msg = `建立了隱藏的 ${code('.git')} 資料夾，這就是<b>儲存庫（Repository）</b>，之後所有的版本紀錄都存放在裡面。<br>預設分支叫做 <b>main</b>，HEAD 指向它。不過在第一個 commit 之前，main 還沒有指向任何東西。`;
      if (Object.keys(this.files).length) msg += '<br>資料夾中已經存在的檔案目前都是<b>未追蹤</b>狀態。';
      this.say(msg);
      return true;
    }

    git_status(args) {
      const r = this.repo, st = this.computeStatus();
      if (args.includes('-s') || args.includes('--short')) {
        const L = { 'new file': 'A', modified: 'M', deleted: 'D' };
        const m = {};
        st.staged.forEach(([k, f]) => { (m[f] = m[f] || [' ', ' '])[0] = L[k]; });
        st.unstaged.forEach(([k, f]) => { (m[f] = m[f] || [' ', ' '])[1] = L[k]; });
        st.conflicts.forEach((f) => { m[f] = ['U', 'U']; });
        Object.keys(m).sort().forEach((f) => this.printParts([[m[f][0], m[f][0] === 'U' ? 'err' : 'ok'], [m[f][1], 'err'], [' ' + f, '']]));
        st.untracked.forEach((f) => this.printParts([['??', 'err'], [' ' + f, '']]));
        this.say(this.statusExplain(st) + `<br>短格式：左欄是暫存區狀態（綠），右欄是工作目錄狀態（紅），${code('??')} 表示未追蹤。`);
        return true;
      }
      if (r.head.type === 'branch') this.print('On branch ' + r.head.name);
      else this.print('HEAD detached at ' + r.head.id, 'err');
      if (!this.headId) { this.print(''); this.print('No commits yet'); }
      if (r.merge) {
        this.print('');
        if (st.conflicts.length) {
          this.print('You have unmerged paths.');
          this.print('  (fix conflicts and run "git commit")');
          this.print('  (use "git merge --abort" to abort the merge)');
        } else {
          this.print('All conflicts fixed but you are still merging.');
          this.print('  (use "git commit" to conclude merge)');
        }
      }
      if (st.staged.length) {
        this.print('');
        this.print('Changes to be committed:');
        this.print('  (use "git restore --staged <file>..." to unstage)');
        st.staged.forEach(([k, f]) => this.print('\t' + (k + ':').padEnd(12) + f, 'ok'));
      }
      if (st.conflicts.length) {
        this.print('');
        this.print('Unmerged paths:');
        this.print('  (use "git add <file>..." to mark resolution)');
        st.conflicts.forEach((f) => this.print('\tboth modified:   ' + f, 'err'));
      }
      if (st.unstaged.length) {
        this.print('');
        this.print('Changes not staged for commit:');
        this.print('  (use "git add <file>..." to update what will be committed)');
        this.print('  (use "git restore <file>..." to discard changes in working directory)');
        st.unstaged.forEach(([k, f]) => this.print('\t' + (k + ':').padEnd(12) + f, 'err'));
      }
      if (st.untracked.length) {
        this.print('');
        this.print('Untracked files:');
        this.print('  (use "git add <file>..." to include in what will be committed)');
        st.untracked.forEach((f) => this.print('\t' + f, 'err'));
      }
      if (!st.staged.length && !r.merge) {
        this.print('');
        if (st.unstaged.length) this.print('no changes added to commit (use "git add" and/or "git commit -a")');
        else if (st.untracked.length) this.print('nothing added to commit but untracked files present (use "git add" to track)');
        else if (!this.headId) this.print('nothing to commit (create/copy files and use "git add" to track)');
        else this.print('nothing to commit, working tree clean');
      }
      this.say(this.statusExplain(st));
      return true;
    }

    statusExplain(st) {
      const p = [];
      p.push(this.branch ? `你目前在 <b>${esc(this.branch)}</b> 分支。` : `你目前處於 <b>detached HEAD</b> 狀態（沒有在任何分支上）。`);
      if (this.repo.merge) p.push('正在<b>合併中</b>。');
      if (st.conflicts.length) p.push(`<span class="x-red">${st.conflicts.length} 個檔案有衝突</span>，編輯好之後用 ${code('git add')} 標記為已解決。`);
      if (st.staged.length) p.push(`<span class="x-green">${st.staged.length} 個變更已暫存</span>（綠色），會被放進下一個 commit。`);
      if (st.unstaged.length) p.push(`<span class="x-orange">${st.unstaged.length} 個已追蹤檔案有修改但還沒暫存</span>（紅色 modified/deleted）。`);
      if (st.untracked.length) p.push(`<span class="x-red">${st.untracked.length} 個未追蹤檔案</span>：Git 還沒開始管理它們。`);
      if (p.length === 1) p.push(this.headId ? '工作目錄很乾淨，所有內容都已經提交了。' : '目前還沒有任何檔案，先建立一個吧！');
      return p.join(' ');
    }

    git_add(args) {
      const r = this.repo, idx = r.index, wd = this.files;
      const all = args.some((a) => a === '-A' || a === '--all');
      const update = args.some((a) => a === '-u' || a === '--update');
      const bad = args.find((a) => a.startsWith('-') && !['-A', '--all', '-u', '--update', '-v', '--'].includes(a));
      if (bad) return this.err(`error: unknown option '${bad.replace(/^-+/, '')}'`);
      const paths = args.filter((a) => !a.startsWith('-'));
      if (!paths.length && !all && !update) {
        this.err('Nothing specified, nothing added.');
        this.hint("hint: Maybe you wanted to say 'git add .'?");
        this.say(`請告訴 Git 要加入哪些檔案，例如 ${code('git add README.md')}，或用 ${code('git add .')} 加入全部變更。`);
        return false;
      }
      const cands = union(wd, idx, r.merge ? Object.fromEntries([...r.merge.conflicts].map((f) => [f, 1])) : null);
      const targets = new Set();
      if (all) cands.forEach((f) => targets.add(f));
      if (update) Object.keys(idx).forEach((f) => targets.add(f));
      for (const p of paths) {
        const m = this.matchPaths(p, cands);
        if (!m.length) {
          this.err(`fatal: pathspec '${p}' did not match any files`);
          this.say(`找不到 ${code(p)} 這個檔案。檔名要完全一致（包含大小寫與副檔名），用 ${code('ls')} 確認一下。`);
          return false;
        }
        m.forEach((f) => targets.add(f));
      }
      const changed = [], resolved = [];
      targets.forEach((f) => {
        const before = hasOwn(idx, f) ? idx[f] : undefined;
        if (hasOwn(wd, f)) idx[f] = wd[f]; else delete idx[f];
        if (r.merge && r.merge.conflicts.delete(f)) resolved.push(f);
        else if (before !== idx[f]) changed.push(f);
      });
      if (changed.length || resolved.length) this.events.push({ type: 'add', files: changed.concat(resolved) });
      if (!changed.length && !resolved.length) {
        this.say(`沒有任何變化：${listNames([...targets])} 的內容和暫存區裡的一樣。`);
        return true;
      }
      const msg = [];
      if (changed.length) {
        const dels = changed.filter((f) => !hasOwn(idx, f));
        const adds = changed.filter((f) => hasOwn(idx, f));
        if (adds.length) msg.push(`把 ${listNames(adds)} 目前的內容複製一份放進<b>暫存區</b>。`);
        if (dels.length) msg.push(`把「刪除 ${listNames(dels)}」這個變更放進暫存區。`);
      }
      if (resolved.length) msg.push(`把 ${listNames(resolved)} 標記為<b>衝突已解決</b>。`);
      if (r.merge) msg.push(r.merge.conflicts.size ? `還有 ${r.merge.conflicts.size} 個衝突檔案待解決。` : `所有衝突都解決了！用 ${code('git commit')} 完成合併。`);
      else msg.push(`下一步：用 ${code('git commit -m "訊息"')} 把暫存區存成一個快照。`);
      this.say(msg.join(''));
      return true;
    }

    git_commit(args) {
      const r = this.repo;
      const msgs = [];
      let all = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-m' || a === '--message') {
          if (i + 1 >= args.length) return this.err("error: switch `m' requires a value");
          msgs.push(args[++i]);
        } else if (a.startsWith('--message=')) msgs.push(a.slice(10));
        else if (a === '-a' || a === '--all') all = true;
        else if (a === '--amend') {
          this.err('error: 此模擬器不支援 --amend');
          this.say('這個模擬器專注在入門指令，暫時不支援修改上一個 commit。');
          return false;
        } else if (/^-[a-zA-Z]+$/.test(a)) {
          const fl = a.slice(1);
          for (let j = 0; j < fl.length; j++) {
            if (fl[j] === 'a') all = true;
            else if (fl[j] === 'm') {
              const restStr = fl.slice(j + 1);
              if (restStr) msgs.push(restStr);
              else { if (i + 1 >= args.length) return this.err("error: switch `m' requires a value"); msgs.push(args[++i]); }
              break;
            } else return this.err(`error: unknown switch \`${fl[j]}'`);
          }
        } else if (a.startsWith('-')) {
          return this.err(`error: unknown option \`${a.replace(/^-+/, '')}'`);
        } else {
          this.err(`error: pathspec '${a}' did not match any file(s) known to git`);
          this.say(`多出了一個參數 ${code(a)}。如果 commit 訊息中有空白，一定要用引號包起來，例如 ${code('git commit -m "新增 README 檔案"')}。`);
          return false;
        }
      }
      if (r.merge && r.merge.conflicts.size) {
        this.err('error: Committing is not possible because you have unmerged files.');
        this.hint("hint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.");
        this.err('fatal: Exiting because of an unresolved conflict.');
        this.say(`還有衝突沒解決：${listNames([...r.merge.conflicts])}。先編輯檔案，再用 ${code('git add')} 標記為已解決。`);
        return false;
      }
      const idx = clone(r.index);
      if (all) Object.keys(idx).forEach((f) => { if (hasOwn(this.files, f)) idx[f] = this.files[f]; else delete idx[f]; });
      const headT = this.headTree();
      if (!r.merge && sameTree(idx, headT)) { this.nothingToCommit(); return false; }
      let msg = msgs.join('\n\n').trim();
      if (!msg && r.merge) msg = r.merge.msg;
      if (!msg) {
        this.err('Aborting commit due to empty commit message.');
        this.say(`每個 commit 都需要一段說明訊息。真正的 Git 會打開文字編輯器讓你輸入，但這個模擬器沒有編輯器，請用 ${code('git commit -m "你的訊息"')}。`);
        return false;
      }
      r.index = idx;
      const parent = this.headId;
      const id = this.newId();
      const parents = parent ? [parent] : [];
      const merge = r.merge;
      if (merge) parents.push(merge.theirs);
      r.commits[id] = { id, parents, msg, tree: clone(idx), n: ++r.seq, date: new Date(), author: `${this.config['user.name']} <${this.config['user.email']}>` };
      r.merge = null;
      if (merge && merge.hadConflicts) this.stats.conflictMerges++;
      this.moveHead(id);
      const where = r.head.type === 'branch' ? r.head.name : 'detached HEAD';
      this.print(`[${where}${parent ? '' : ' (root-commit)'} ${id}] ${msg.split('\n')[0]}`);
      const st = this.printStat(headT, idx, true, false);
      this.events.push({ type: 'commit', id, files: st.files.map((x) => x.f) });
      let ex = `建立了新的 commit ${code(id)}：把暫存區的內容存成一份<b>快照</b>。`;
      if (merge) ex += `<br>這是一個<b>合併 commit</b>，它有兩個父節點：${code(parent)}（${esc(where)}）和 ${code(merge.theirs)}（${esc(merge.name)}）。合併完成！`;
      else ex += parent ? `它的父節點是上一個 commit ${code(parent)}。` : '這是儲存庫的<b>第一個 commit</b>（root commit），所以沒有父節點。';
      ex += r.head.type === 'branch'
        ? `<br><b>${esc(r.head.name)}</b> 分支標籤往前移到了新的 commit，HEAD 也跟著它。`
        : `<br>⚠ 你在 detached HEAD 狀態，這個 commit 不屬於任何分支，切換走之後就很難找到它了！可以用 ${code('git switch -c 新分支名')} 把它保存下來。`;
      this.say(ex);
      return true;
    }

    nothingToCommit() {
      const st = this.computeStatus();
      this.print(this.branch ? 'On branch ' + this.branch : 'HEAD detached at ' + this.headId);
      if (st.unstaged.length) {
        this.print('Changes not staged for commit:');
        this.print('  (use "git add <file>..." to update what will be committed)');
        this.print('  (use "git restore <file>..." to discard changes in working directory)');
        st.unstaged.forEach(([k, f]) => this.print('\t' + (k + ':').padEnd(12) + f, 'err'));
      }
      if (st.untracked.length) {
        this.print('');
        this.print('Untracked files:');
        this.print('  (use "git add <file>..." to include in what will be committed)');
        st.untracked.forEach((f) => this.print('\t' + f, 'err'));
      }
      this.print('');
      if (st.unstaged.length) this.print('no changes added to commit (use "git add" and/or "git commit -a")');
      else if (st.untracked.length) this.print('nothing added to commit but untracked files present (use "git add" to track)');
      else this.print(this.headId ? 'nothing to commit, working tree clean' : 'nothing to commit (create/copy files and use "git add" to track)');
      this.say(st.unstaged.length || st.untracked.length
        ? `暫存區是空的，沒有東西可以提交！commit 只會提交<b>暫存區</b>的內容，記得先用 ${code('git add')} 把變更放進暫存區。`
        : '沒有任何變更需要提交，工作目錄很乾淨。');
    }

    git_log(args) {
      const r = this.repo;
      let oneline = false, all = false, graph = false, limit = Infinity;
      const refs = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--oneline') oneline = true;
        else if (a === '--all') all = true;
        else if (a === '--graph') graph = true;
        else if (a === '--decorate' || a.startsWith('--pretty') || a.startsWith('--format')) { /* 接受但忽略 */ }
        else if (/^-\d+$/.test(a)) limit = +a.slice(1);
        else if (a === '-n') limit = +args[++i] || Infinity;
        else if (a.startsWith('-')) return this.err(`fatal: unrecognized argument: ${a}`);
        else refs.push(a);
      }
      const starts = [];
      if (all) { Object.values(r.branches).forEach((id) => starts.push(id)); if (this.headId) starts.push(this.headId); }
      for (const ref of refs) {
        const id = this.resolve(ref);
        if (!id) {
          this.err(`fatal: ambiguous argument '${ref}': unknown revision or path not in the working tree.`);
          this.say(`找不到 ${code(ref)} 這個分支或 commit。`);
          return false;
        }
        starts.push(id);
      }
      if (!all && !refs.length) {
        if (!this.headId) {
          this.err(`fatal: your current branch '${this.branch}' does not have any commits yet`);
          this.say(`目前還沒有任何 commit，所以沒有歷史可以顯示。先用 ${code('git add')} 和 ${code('git commit')} 建立第一個 commit 吧！`);
          return false;
        }
        starts.push(this.headId);
      }
      const seen = new Set();
      starts.forEach((s) => this.ancestors(s).forEach((x) => seen.add(x)));
      const list = [...seen].map((id) => this.commit(id)).sort((x, y) => y.n - x.n).slice(0, limit);
      const g = graph ? [['* ', 'warn']] : [];
      list.forEach((c, i) => {
        const deco = this.decoParts(c.id);
        const dp = deco.length ? [[' ', '']].concat(deco) : [];
        if (oneline) {
          this.printParts([...g, [c.id, 'warn'], ...dp, [' ' + c.msg.split('\n')[0], '']]);
        } else {
          if (i) this.print('');
          this.printParts([...g, ['commit ' + c.id, 'warn'], ...dp]);
          if (c.parents.length > 1) this.print('Merge: ' + c.parents.join(' '));
          this.print('Author: ' + c.author);
          this.print('Date:   ' + fmtDate(c.date));
          this.print('');
          c.msg.split('\n').forEach((l) => this.print('    ' + l));
        }
      });
      let ex = `由新到舊列出 ${list.length} 個 commit${all ? '（包含所有分支）' : '（從 HEAD 往回追溯）'}。`;
      if (!oneline) ex += '每個 commit 都有唯一的 ID、作者、時間與說明訊息。';
      ex += `括號中的 ${code('HEAD -> ' + (this.branch || '...'))} 表示你目前所在的位置。`;
      if (graph) ex += '<br>右邊的「Commit 歷史圖」就是圖形化的版本，看起來更清楚！';
      this.say(ex);
      return true;
    }

    git_branch(args) {
      const r = this.repo;
      const flags = args.filter((a) => a.startsWith('-'));
      const names = args.filter((a) => !a.startsWith('-'));
      const has = (f) => flags.includes(f);
      if (has('-d') || has('-D') || has('--delete')) return this.branchDelete(names, has('-D') || has('--force'));
      if (has('-m') || has('-M') || has('--move')) return this.branchRename(names);
      const bad = flags.find((f) => !['-v', '-vv', '-a', '--all', '--list', '-l'].includes(f));
      if (bad) return this.err(`error: unknown option \`${bad.replace(/^-+/, '')}'`);
      if (!names.length || has('--list') || has('-l')) {
        const verbose = has('-v') || has('-vv');
        const list = Object.keys(r.branches).sort();
        const w = Math.max(0, ...list.map((n) => n.length));
        if (r.head.type === 'detached') this.printParts([['* ', 'ok'], [`(HEAD detached at ${r.head.id})`, 'ok']]);
        list.forEach((n) => {
          const cur = r.head.type === 'branch' && r.head.name === n;
          const c = this.commit(r.branches[n]);
          this.printParts([[cur ? '* ' : '  ', cur ? 'ok' : ''], [verbose ? n.padEnd(w) : n, cur ? 'ok' : ''], ...(verbose ? [[' ' + c.id, 'warn'], [' ' + c.msg.split('\n')[0], '']] : [])]);
        });
        if (!list.length) this.say(`目前還沒有任何分支可以列出：${b(this.branch || 'main')} 要等到第一個 commit 之後才真正存在（分支必須指向某個 commit）。`);
        else this.say(`共有 ${list.length} 個分支，前面有 ${code('*')}（綠色）的是你目前所在的分支，也就是 HEAD 指向的分支。`);
        return true;
      }
      return this.branchCreate(names[0], names[1]);
    }

    branchCreate(name, start) {
      const r = this.repo;
      if (!validBranch(name)) {
        this.err(`fatal: '${name}' is not a valid branch name`);
        this.say('分支名稱不能有空白或 ~ ^ : ? * [ \\ 等特殊字元，也不能以 - 開頭。常見的命名像 ' + code('feature') + '、' + code('bugfix-login') + '。');
        return false;
      }
      if (hasOwn(r.branches, name)) {
        this.err(`fatal: a branch named '${name}' already exists`);
        this.say(`已經有叫 ${b(name)} 的分支了。要切換過去請用 ${code('git switch ' + name)}。`);
        return false;
      }
      const id = start ? this.resolve(start) : this.headId;
      if (!id) {
        this.err(`fatal: not a valid object name: '${start || this.branch || 'HEAD'}'`);
        this.say(start ? `找不到 ${code(start)}。` : '分支必須指向一個 commit，但目前還沒有任何 commit。請先完成第一次 commit，再建立分支。');
        return false;
      }
      r.branches[name] = id;
      r.branchSeq[name] = ++r.bseq;
      this.say(`建立了新分支 ${b(name)}，它指向 commit ${code(id)}。分支其實只是一個指向 commit 的<b>標籤</b>，所以建立得非常快。<br>⚠ 注意：建立分支<b>不會</b>自動切換過去，HEAD 仍在 ${b(this.branch || 'detached HEAD')}。要切換請用 ${code('git switch ' + name)}。`);
      return true;
    }

    branchDelete(names, force) {
      const r = this.repo;
      if (!names.length) return this.err('fatal: branch name required');
      const deleted = [];
      for (const n of names) {
        if (!hasOwn(r.branches, n)) {
          this.err(`error: branch '${n}' not found`);
          this.say(`找不到叫 ${b(n)} 的分支。用 ${code('git branch')} 看看有哪些分支。`);
          return false;
        }
        if (r.head.type === 'branch' && r.head.name === n) {
          this.err(`error: cannot delete branch '${n}' used by worktree at '${HOME}'`);
          this.say(`不能刪除<b>目前所在</b>的分支。請先用 ${code('git switch')} 切換到其他分支。`);
          return false;
        }
        const id = r.branches[n];
        if (!force && !this.isAncestor(id, this.headId)) {
          this.err(`error: the branch '${n}' is not fully merged.`);
          this.hint(`hint: If you are sure you want to delete it, run 'git branch -D ${n}'`);
          this.say(`${b(n)} 上有還沒合併到目前分支的 commit，刪掉分支後那些 commit 就很難找回來了，所以 Git 阻止了你。<br>先合併它，或確定不要了再用 ${code('git branch -D ' + n)} 強制刪除。`);
          return false;
        }
        delete r.branches[n];
        delete r.branchSeq[n];
        deleted.push(n);
        this.print(`Deleted branch ${n} (was ${id}).`);
      }
      this.say(`刪除了分支 ${deleted.map(b).join('、')}。刪掉的只是指向 commit 的「標籤」，${force ? '沒有被其他分支包含的 commit 會變成孤兒（圖上變成虛線）。' : '裡面的 commit 已經合併到目前分支，仍然保留在歷史中。'}`);
      return true;
    }

    branchRename(names) {
      const r = this.repo;
      let from, to;
      if (names.length === 1) { from = this.branch; to = names[0]; if (!from) return this.err('fatal: cannot rename the current branch while not on any.'); }
      else { from = names[0]; to = names[1]; }
      if (!to) return this.err('fatal: branch name required');
      if (!validBranch(to)) return this.err(`fatal: '${to}' is not a valid branch name`);
      if (hasOwn(r.branches, to)) return this.err(`fatal: a branch named '${to}' already exists`);
      const unbornCurrent = r.head.type === 'branch' && r.head.name === from && !hasOwn(r.branches, from);
      if (!hasOwn(r.branches, from) && !unbornCurrent) return this.err(`error: refname refs/heads/${from} not found`);
      if (hasOwn(r.branches, from)) { r.branches[to] = r.branches[from]; delete r.branches[from]; }
      r.branchSeq[to] = hasOwn(r.branchSeq, from) ? r.branchSeq[from] : ++r.bseq;
      delete r.branchSeq[from];
      if (r.head.type === 'branch' && r.head.name === from) r.head.name = to;
      this.say(`把分支 ${b(from)} 重新命名為 ${b(to)}。它指向的 commit 沒有改變。`);
      return true;
    }

    git_switch(args) {
      const r = this.repo;
      if (r.merge) {
        this.err('fatal: cannot switch branch while merging');
        this.hint('Consider "git merge --quit" or "git worktree add".');
        this.say(`你正在合併中，不能切換分支。請先完成合併（解決衝突後 ${code('git add')} + ${code('git commit')}），或用 ${code('git merge --abort')} 放棄合併。`);
        return false;
      }
      let create = null, detach = false;
      const pos = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-c' || a === '-C' || a === '--create') { create = args[++i]; if (!create) return this.err("error: switch `c' requires a value"); }
        else if (a === '-d' || a === '--detach') detach = true;
        else if (a.startsWith('-') && a !== '-') return this.err(`error: unknown option \`${a.replace(/^-+/, '')}'`);
        else pos.push(a);
      }
      if (create) return this.createAndSwitch(create, pos[0]);
      if (!pos.length) {
        this.err('fatal: missing branch or commit argument');
        this.say(`請告訴 Git 要切換到哪個分支，例如 ${code('git switch main')}。用 ${code('git branch')} 查看有哪些分支。`);
        return false;
      }
      let target = pos[0];
      if (target === '-') {
        target = r.prev;
        if (!target) return this.err('fatal: invalid reference: @{-1}');
      }
      if (detach) {
        const id = this.resolve(target);
        if (!id) return this.err(`fatal: invalid reference: ${target}`);
        return this.detachTo(id, 'switch');
      }
      return this.switchBranch(target, 'switch');
    }

    switchBranch(name, via) {
      const r = this.repo;
      if (r.head.type === 'branch' && r.head.name === name) {
        this.print(`Already on '${name}'`);
        this.say(`你本來就在 ${b(name)} 分支上了。`);
        return true;
      }
      if (!hasOwn(r.branches, name)) {
        if (via === 'switch' && this.resolve(name)) {
          this.err(`fatal: a branch is expected, got commit '${name}'`);
          this.hint('hint: If you want to detach HEAD at the commit, try again with the --detach option.');
          this.say(`${code('git switch')} 只能切換到<b>分支</b>。想切到某個 commit 看看舊版本，請用 ${code('git switch --detach ' + name)}。`);
          return false;
        }
        this.err(`fatal: invalid reference: ${name}`);
        this.say(`找不到名為 ${b(name)} 的分支。用 ${code('git branch')} 查看有哪些分支，或用 ${code('git switch -c ' + name)} 建立一個新分支並切換過去。`);
        return false;
      }
      const id = r.branches[name];
      const oldHead = r.head.type === 'detached' ? r.head.id : null;
      if (!this.switchTree(this.tree(id), 'checkout')) return false;
      this.leftBehind = null;
      if (oldHead) this.warnLeavingDetached(id);
      if (this.branch) r.prev = this.branch;
      r.head = { type: 'branch', name };
      const carried = this.printCarried();
      this.print(`Switched to branch '${name}'`);
      let ex = `HEAD 現在指向 ${b(name)} 分支（commit ${code(id)}）。工作目錄的檔案已經換成這個 commit 的內容，之後的新 commit 會讓 ${b(name)} 往前移動。`;
      if (carried.length) ex += `<br>你還沒提交的修改（${listNames(carried)}）被一起帶了過來。`;
      if (this.leftBehind) ex += `<br>⚠ 你離開 detached HEAD 時留下了沒有分支指向的 commit（圖上的虛線節點）。如果想保留，可以用 ${code('git branch 新名稱 ' + this.leftBehind)}。`;
      this.say(ex);
      return true;
    }

    createAndSwitch(name, start) {
      const r = this.repo;
      if (!validBranch(name)) return this.err(`fatal: '${name}' is not a valid branch name`);
      if (hasOwn(r.branches, name)) {
        this.err(`fatal: a branch named '${name}' already exists`);
        this.say(`已經有 ${b(name)} 分支了，直接用 ${code('git switch ' + name)} 切換過去就好。`);
        return false;
      }
      const id = start ? this.resolve(start) : this.headId;
      if (start && !id) return this.err(`fatal: invalid reference: ${start}`);
      if (!id) {
        r.head = { type: 'branch', name };
        r.branchSeq[name] = ++r.bseq;
        this.print(`Switched to a new branch '${name}'`);
        this.say(`切換到新分支 ${b(name)}。目前還沒有任何 commit，所以這個分支要等第一個 commit 之後才會真正出現。`);
        return true;
      }
      if (id !== this.headId && !this.switchTree(this.tree(id), 'checkout')) return false;
      if (this.branch) r.prev = this.branch;
      r.branches[name] = id;
      r.branchSeq[name] = ++r.bseq;
      r.head = { type: 'branch', name };
      this.printCarried();
      this.print(`Switched to a new branch '${name}'`);
      this.say(`一次完成兩件事：建立新分支 ${b(name)}（指向 ${code(id)}），並把 HEAD 切換過去。<br>等同於 ${code('git branch ' + name)} 再加上 ${code('git switch ' + name)}。`);
      return true;
    }

    detachTo(id, via) {
      const r = this.repo;
      if (!this.switchTree(this.tree(id), 'checkout')) return false;
      this.leftBehind = null;
      this.warnLeavingDetached(id);
      if (this.branch) r.prev = this.branch;
      r.head = { type: 'detached', id };
      const c = this.commit(id);
      if (via === 'checkout') {
        this.hint(`Note: switching to '${id}'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n`);
      }
      this.print(`HEAD is now at ${id} ${c.msg.split('\n')[0]}`);
      this.say(`你進入了 <b>detached HEAD</b> 狀態：HEAD 直接指向 commit ${code(id)}，而不是指向某個分支。工作目錄現在是這個舊版本的樣子，可以四處看看。<br>回到正常狀態：${code('git switch main')}（或其他分支）。想從這裡開始新工作：${code('git switch -c 新分支名')}。`);
      return true;
    }

    git_restore(args) {
      let staged = false, worktree = false, source = null;
      const paths = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--staged' || a === '-S') staged = true;
        else if (a === '--worktree' || a === '-W') worktree = true;
        else if (a === '-SW' || a === '-WS') { staged = true; worktree = true; }
        else if (a === '--source' || a === '-s') { source = args[++i]; if (!source) return this.err('error: option `source\' requires a value'); }
        else if (a.startsWith('--source=')) source = a.slice(9);
        else if (a === '--') continue;
        else if (a.startsWith('-')) return this.err(`error: unknown option \`${a.replace(/^-+/, '')}'`);
        else paths.push(a);
      }
      if (!staged && !worktree) worktree = true;
      if (!paths.length) {
        this.err('fatal: you must specify path(s) to restore');
        this.say(`請指定要還原的檔案，例如 ${code('git restore README.md')}，或用 ${code('git restore .')} 還原全部。`);
        return false;
      }
      return this.restorePaths(paths, { staged, worktree, source }, 'restore');
    }

    restorePaths(paths, opt, via) {
      const r = this.repo, idx = r.index, wd = this.files;
      let src = null;
      if (opt.source) {
        const id = this.resolve(opt.source);
        if (!id) { this.err(`fatal: could not resolve ${opt.source}`); this.say(`找不到 ${code(opt.source)} 這個 commit 或分支。`); return false; }
        src = this.tree(id);
      }
      const head = this.headTree();
      const stagedSrc = src || head;
      const cands = opt.staged ? union(idx, stagedSrc) : union(idx, src || {}, r.merge ? Object.fromEntries([...r.merge.conflicts].map((f) => [f, 1])) : null);
      const targets = new Set();
      for (const p of paths) {
        const m = this.matchPaths(p, cands);
        if (!m.length) {
          this.err(`error: pathspec '${p}' did not match any file(s) known to git`);
          this.say(hasOwn(wd, p)
            ? `${code(p)} 是 Git 還沒追蹤的<b>新檔案</b>，Git 沒有它的任何舊版本可以復原。`
            : `找不到 ${code(p)} 這個 Git 已追蹤的檔案。`);
          return false;
        }
        m.forEach((f) => targets.add(f));
      }
      if (opt.worktree && !opt.staged && !src && r.merge) {
        const un = [...targets].filter((f) => r.merge.conflicts.has(f));
        if (un.length) {
          un.forEach((f) => this.err(`error: path '${f}' is unmerged`));
          this.say(`${listNames(un)} 還在衝突狀態。請直接編輯它的內容後用 ${code('git add')} 標記解決，或用 ${code('git merge --abort')} 放棄合併。`);
          return false;
        }
      }
      const chIdx = [], chWd = [];
      targets.forEach((f) => {
        if (opt.staged) {
          const before = idx[f];
          if (hasOwn(stagedSrc, f)) idx[f] = stagedSrc[f]; else delete idx[f];
          if (before !== idx[f]) chIdx.push(f);
        }
        if (opt.worktree) {
          const from = src || idx;
          const before = wd[f];
          if (hasOwn(from, f)) wd[f] = from[f]; else delete wd[f];
          if (before !== wd[f]) chWd.push(f);
        }
      });
      if (chIdx.length) this.events.push({ type: 'restore', files: chIdx, from: 'head', to: 'idx' });
      if (chWd.length) this.events.push({ type: 'restore', files: chWd, from: src || opt.staged ? 'head' : 'idx', to: 'wd' });
      const names = [...targets];
      const msg = [];
      if (opt.staged) {
        msg.push(chIdx.length
          ? `把 ${listNames(chIdx)} 從暫存區移出（暫存區恢復成${src ? ' ' + code(opt.source) + ' ' : ' HEAD '}的版本）。工作目錄中的檔案內容<b>沒有改變</b>，你的修改還在，只是變回「未暫存」。`
          : `${listNames(names)} 在暫存區中沒有變更，所以沒有任何變化。`);
      }
      if (opt.worktree) {
        const from = src ? `commit ${code(opt.source)} ` : opt.staged ? 'HEAD ' : '<b>暫存區</b>（也就是上次 add 或 commit）';
        msg.push(chWd.length
          ? `用${from}的版本覆蓋了工作目錄中的 ${listNames(chWd)}。你在工作目錄的修改已經被<b>丟棄</b>，這個動作無法復原！`
          : `${listNames(names)} 在工作目錄中沒有修改，所以沒有任何變化。`);
      }
      this.say(msg.join('<br>'));
      return true;
    }

    git_reset(args) {
      const r = this.repo;
      let mode = 'mixed';
      const pos = [];
      for (const a of args) {
        if (a === '--soft' || a === '--mixed' || a === '--hard') mode = a.slice(2);
        else if (a === '--') continue;
        else if (a.startsWith('-')) return this.err(`error: unknown option \`${a.replace(/^-+/, '')}'`);
        else pos.push(a);
      }
      if (!this.headId) {
        this.err("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.");
        this.say('還沒有任何 commit，所以沒有地方可以退回。先完成第一次 commit 吧！');
        return false;
      }
      // git reset <檔名>：取消暫存（等同 git restore --staged）
      if (pos.length && !this.resolve(pos[0])) {
        const known = union(r.index, this.headTree());
        if (pos.every((p) => this.matchPaths(p, known).length)) {
          if (mode !== 'mixed') return this.err(`fatal: Cannot do ${mode} reset with paths.`);
          const ok = this.restorePaths(pos, { staged: true }, 'reset');
          if (ok) this.explain += `<br><span class="x-muted">💡 取消暫存比較建議用 ${code('git restore --staged ' + pos[0])}，意思更清楚。</span>`;
          return ok;
        }
        this.err(`fatal: ambiguous argument '${pos[0]}': unknown revision or path not in the working tree.`);
        this.say(/^(HEAD|@)[~^]/.test(pos[0])
          ? `找不到 ${code(pos[0])}：你已經在最早的 commit 了，沒有更早的 commit 可以退回。`
          : `找不到 ${code(pos[0])}。常見的寫法是 ${code('git reset HEAD~1')}（退回上一個 commit），或填入圖上某個 commit 的 ID。`);
        return false;
      }
      if (r.merge && mode === 'soft') return this.err('fatal: Cannot do a soft reset in the middle of a merge.');
      const target = pos.length ? this.resolve(pos[0]) : this.headId;
      const oldHead = this.headId, oldTree = this.headTree(), oldIdx = clone(r.index);
      const T = this.tree(target);
      const where = this.branch || 'HEAD';

      this.moveHead(target);
      if (mode !== 'soft') {
        const chIdx = union(oldIdx, T).filter((f) => oldIdx[f] !== T[f]);
        r.index = clone(T);
        if (chIdx.length) this.events.push({ type: 'restore', files: chIdx, from: 'head', to: 'idx' });
        r.merge = null;
      }
      if (mode === 'hard') {
        const chWd = [];
        union(oldIdx, oldTree, T).forEach((f) => {
          const before = this.files[f];
          if (hasOwn(T, f)) this.files[f] = T[f]; else delete this.files[f];
          if (before !== this.files[f]) chWd.push(f);
        });
        if (chWd.length) this.events.push({ type: 'restore', files: chWd, from: 'head', to: 'wd' });
        this.print(`HEAD is now at ${target} ${this.commit(target).msg.split('\n')[0]}`);
      } else if (mode === 'mixed') {
        const st = this.computeStatus();
        if (st.unstaged.length) {
          this.print('Unstaged changes after reset:');
          st.unstaged.forEach(([k, f]) => this.print((k === 'deleted' ? 'D' : 'M') + '\t' + f));
        }
      }

      // 退回後沒有任何分支指向的 commit 數
      const keep = this.reachableFromBranches();
      if (this.headId) this.ancestors(this.headId).forEach((x) => keep.add(x));
      const dropped = oldHead === target ? 0 : [...this.ancestors(oldHead)].filter((x) => !keep.has(x)).length;
      const moved = oldHead === target
        ? `${b(where)} 還是指向 ${code(target)}。`
        : `${b(where)} 分支標籤從 ${code(oldHead)} <b>往回</b>移到 ${code(target)}。`;
      const lost = dropped ? `<br>後面的 ${dropped} 個 commit 沒有分支指向了（圖上變成虛線）。` : '';
      if (mode === 'soft') {
        this.say(`<b>reset --soft</b>：${moved}暫存區和工作目錄都<b>沒變</b>，所以被取消的 commit 內容變成「已暫存」，可以直接重新 commit。${lost}`);
      } else if (mode === 'mixed') {
        this.say(oldHead === target
          ? `把暫存區恢復成 ${code(target)} 的內容（取消所有暫存）。工作目錄的修改還在。`
          : `<b>reset</b>（預設模式）：${moved}被取消的 commit 內容<b>還留在工作目錄</b>（變成「已修改」），你可以改一改再重新 add + commit。${lost}`);
      } else {
        this.say(`⚠ <b>reset --hard</b>：${moved}而且暫存區和工作目錄也<b>全部</b>變回那個 commit 的樣子，之後的修改都被丟掉了！${lost}<br>💡 reset 只適合用在還沒分享給別人（還沒 push）的 commit 上。`);
      }
      return true;
    }

    git_merge(args) {
      const r = this.repo;
      if (args.includes('--abort')) {
        if (!r.merge) { this.err('fatal: There is no merge to abort (MERGE_HEAD missing).'); this.say('目前沒有進行中的合併。'); return false; }
        const O = this.headTree();
        union(r.index, O, Object.fromEntries([...r.merge.conflicts].map((f) => [f, 1]))).forEach((f) => {
          if (hasOwn(O, f)) { r.index[f] = O[f]; this.files[f] = O[f]; }
          else { delete r.index[f]; delete this.files[f]; }
        });
        r.merge = null;
        this.say('已放棄合併，工作目錄與暫存區恢復成合併前的狀態，就像什麼都沒發生過。');
        return true;
      }
      if (r.merge) {
        if (r.merge.conflicts.size) {
          this.err('error: Merging is not possible because you have unmerged files.');
          this.hint("hint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.");
          this.err('fatal: Exiting because of an unresolved conflict.');
        } else {
          this.err('fatal: You have not concluded your merge (MERGE_HEAD exists).');
          this.hint('Please, commit your changes before you merge.');
        }
        this.say(`上一次合併還沒完成。請先解決衝突並 ${code('git commit')}，或用 ${code('git merge --abort')} 放棄。`);
        return false;
      }
      let noff = false, msg = null;
      const names = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--no-ff') noff = true;
        else if (a === '--ff') noff = false;
        else if (a === '-m') msg = args[++i];
        else if (a.startsWith('-')) return this.err(`error: unknown option \`${a.replace(/^-+/, '')}'`);
        else names.push(a);
      }
      if (!names.length) {
        this.err('fatal: No remote for the current branch.');
        this.say(`請指定要合併進來的分支，例如 ${code('git merge feature')}：意思是「把 feature 合併到我目前所在的分支」。`);
        return false;
      }
      const name = names[0];
      const theirs = this.resolve(name);
      if (!theirs) {
        this.err(`merge: ${name} - not something we can merge`);
        this.say(`找不到叫 ${b(name)} 的分支或 commit。用 ${code('git branch')} 確認一下名稱。`);
        return false;
      }
      const ours = this.headId;
      const here = this.branch || 'HEAD';
      if (ours === theirs || this.isAncestor(theirs, ours)) {
        this.print('Already up to date.');
        this.say(`${b(name)} 的所有 commit 都已經包含在 ${b(here)} 裡了，不需要合併。` + (hasOwn(r.branches, name) && name === this.branch ? '（你正在合併自己！要先切換到接收修改的分支。）' : ''));
        return true;
      }
      const label = hasOwn(r.branches, name) ? `branch '${name}'` : `commit '${theirs}'`;
      const oldTree = this.headTree();

      if (!ours || (!noff && this.isAncestor(ours, theirs))) {
        if (!this.switchTree(this.tree(theirs), 'merge')) return false;
        this.print(`Updating ${ours || '0000000'}..${theirs}`);
        this.print('Fast-forward');
        this.moveHead(theirs);
        this.printStat(oldTree, this.tree(theirs), true, true);
        this.say(`<b>快轉合併（Fast-forward）</b>：${b(here)} 從分岔之後沒有新的 commit，所以 Git 只需要把 ${b(here)} 標籤直接往前移到 ${code(theirs)}（${esc(name)} 所在的位置）就完成了，<b>不需要</b>建立新的合併 commit，歷史維持一直線。`);
        return true;
      }

      const base = this.mergeBase(ours, theirs);
      const B = this.tree(base), O = oldTree, T = this.tree(theirs);
      const result = {}, conflicts = [], kinds = {}, markers = {};
      union(B, O, T).forEach((f) => {
        const bb = B[f], o = O[f], t = T[f];
        if (o === t) { if (o !== undefined) result[f] = o; return; }
        if (bb === o) { if (t !== undefined) result[f] = t; return; }
        if (bb === t) { if (o !== undefined) result[f] = o; return; }
        conflicts.push(f);
        kinds[f] = (o === undefined || t === undefined) ? 'modify/delete' : (bb === undefined ? 'add/add' : 'content');
        markers[f] = ['<<<<<<< HEAD', ...splitLines(o), '=======', ...splitLines(t), '>>>>>>> ' + name].join('\n');
        if (o !== undefined) result[f] = o;
      });
      const target = Object.assign({}, result);
      conflicts.forEach((f) => { target[f] = markers[f]; });
      if (!this.switchTree(target, 'merge')) return false;
      const mergeMsg = msg || `Merge ${label}`;

      if (conflicts.length) {
        conflicts.forEach((f) => { if (hasOwn(O, f)) r.index[f] = O[f]; else delete r.index[f]; });
        conflicts.forEach((f) => {
          if (kinds[f] !== 'modify/delete') this.print('Auto-merging ' + f);
          if (kinds[f] === 'content') this.print(`CONFLICT (content): Merge conflict in ${f}`, 'err');
          else if (kinds[f] === 'add/add') this.print(`CONFLICT (add/add): Merge conflict in ${f}`, 'err');
          else this.print(`CONFLICT (modify/delete): ${f} deleted in ${O[f] === undefined ? 'HEAD' : name} and modified in ${O[f] === undefined ? name : 'HEAD'}.`, 'err');
        });
        this.print('Automatic merge failed; fix conflicts and then commit the result.', 'err');
        r.merge = { theirs, name, conflicts: new Set(conflicts), msg: mergeMsg, hadConflicts: true };
        const f0 = conflicts[0];
        this.say(`<b>發生合併衝突！</b>${listNames(conflicts)} 在兩個分支中都被修改成不同的內容，Git 無法自動決定要用哪一個版本。<br>解決步驟：① 把滑鼠移到檔案卡片上（或 ${code('cat ' + f0)}）查看衝突標記 ② 點 ✏️ 改成你要的最終內容 ③ ${code('git add ' + f0)} 標記已解決 ④ ${code('git commit')} 完成合併。<br>不想處理了？${code('git merge --abort')} 可以放棄合併。`);
        return false;
      }

      const id = this.newId();
      r.commits[id] = { id, parents: [ours, theirs], msg: mergeMsg, tree: clone(result), n: ++r.seq, date: new Date(), author: `${this.config['user.name']} <${this.config['user.email']}>` };
      this.moveHead(id);
      this.print("Merge made by the 'ort' strategy.");
      this.printStat(O, result, true, true);
      this.say(`<b>三方合併（3-way merge）</b>：${b(here)} 和 ${b(name)} 在分岔後各自有新的 commit，無法快轉。Git 以兩者的<b>共同祖先</b> ${code(base)} 為基準，自動結合雙方的修改，建立了一個新的<b>合併 commit</b> ${code(id)}。<br>它有<b>兩個父節點</b>，右邊的圖可以看到兩條線在這裡匯合。`);
      return true;
    }

    /* ---------------- 給視覺化使用 ---------------- */
    fileRows() {
      const wd = this.files;
      if (!this.repo) return Object.keys(wd).sort().map((f) => ({ name: f, wd: { s: 'plain', c: wd[f] }, idx: null, head: null }));
      const idx = this.repo.index, head = this.headTree();
      const cset = this.repo.merge ? this.repo.merge.conflicts : new Set();
      return union(wd, idx, head, Object.fromEntries([...cset].map((f) => [f, 1]))).map((f) => {
        const inW = hasOwn(wd, f), inI = hasOwn(idx, f), inH = hasOwn(head, f);
        let w = null, i = null, h = null;
        if (cset.has(f)) {
          w = inW ? { s: 'conflict', c: wd[f] } : null;
          i = inI ? { s: 'conflict', c: idx[f] } : null;
        } else {
          if (inW) w = { s: !inI ? 'untracked' : wd[f] !== idx[f] ? 'modified' : 'clean', c: wd[f] };
          else if (inI) w = { s: 'deleted' };
          if (inI) i = { s: !inH ? 'added' : idx[f] !== head[f] ? 'modified' : 'clean', c: idx[f] };
          else if (inH) i = { s: 'deleted' };
        }
        if (inH) h = { s: 'clean', c: head[f] };
        return { name: f, wd: w, idx: i, head: h };
      });
    }
  }

  global.GitEngine = GitEngine;
  global.GitUtil = { esc, code, splitLines, GIT_CMDS, hasOwn, validFile };
})(window);
