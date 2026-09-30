/* ==========================================================================
 * 課程內容（入門版）
 * 每一課只教一件事。每個任務可以是：
 *   cmd：要在終端機輸入的指令（畫面上會有「填入」按鈕）
 *   gui：要在右邊圖形介面操作的地方（'new' = ＋新檔案、'edit:檔名' = 編輯按鈕），會閃爍提示
 * check(g, ctx)：g 是 GitEngine；ctx.since 是「上一個任務完成之後」輸入的指令
 * ========================================================================== */
(function (global) {
  'use strict';

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const ran = (ctx, re) => ctx.since.some((c) => re.test(c));
  const onBranch = (g, name) => !!g.repo && g.branch === name;
  const br = (g, name) => (g.repo ? g.repo.branches[name] : undefined);
  const headMsg = (g) => (g.headId ? g.repo.commits[g.headId].msg : null);
  const headParents =(g) => (g.headId ? g.repo.commits[g.headId].parents.length : 0);
  const ahead = (g, a, base) => !!br(g, a) && br(g, a) !== br(g, base) && g.isAncestor(br(g, base), br(g, a));

  const START = ['echo "# 我的專案" > README.md', 'git init', 'git add README.md', 'git commit -m "第一次提交"'];

  global.GIT_LESSONS = [
    {
      id: 'init', short: 'init', title: '建立儲存庫',
      setup: ['echo "# 我的專案" > README.md'],
      intro: 'Git 會幫專案拍下一張張<b>快照</b>，讓你隨時回到過去。右邊資料夾裡已經有一個 README.md，但 Git 還沒開始管理它。',
      steps: [
        { text: '讓 Git 開始管理這個資料夾', cmd: 'git init', check: (g) => !!g.repo }
      ],
      done: '右邊出現了<b>暫存區</b>和<b>儲存庫</b>！儲存庫就是存放所有快照的地方。'
    },
    {
      id: 'add', short: 'add', title: '放進暫存區',
      setup: ['echo "# 我的專案" > README.md', 'git init'],
      intro: '存成快照前，要先把檔案放進<b>暫存區</b>，就像寄包裹前先把東西裝進箱子。',
      steps: [
        { text: '看看目前的狀態：README.md 是紅色的「新檔案」', cmd: 'git status', check: (g, c) => ran(c, /^git status/) },
        { text: '把 README.md 放進暫存區，看它飛過去！', cmd: 'git add README.md', check: (g) => !!g.repo && has(g.repo.index, 'README.md') }
      ],
      done: 'README.md 已經在暫存區了。下一步就是把它存成快照。'
    },
    {
      id: 'commit', short: 'commit', title: '存成快照',
      setup: ['echo "# 我的專案" > README.md', 'git init', 'git add README.md'],
      intro: '<code>git commit</code> 會把暫存區存成一張<b>快照</b>。<code>-m</code> 後面要寫一句話，說明這次做了什麼。',
      steps: [
        { text: '建立你的第一張快照', cmd: 'git commit -m "第一次提交"', check: (g) => g.commitCount() >= 1 }
      ],
      done: '歷史圖出現了第一個圓點，這就是一個 <b>commit</b>！<b>main</b> 是分支名稱，<b>HEAD</b> 代表「你現在在這裡」。'
    },
    {
      id: 'cycle', short: '修改', title: '修改 → add → commit',
      setup: START,
      intro: '日常工作就是不斷重複這三步：<b>修改檔案 → git add → git commit</b>。',
      steps: [
        { text: '點右邊 README.md 上的 ✏️，加一行文字後按「儲存」', gui: 'edit:README.md', check: (g) => !!g.repo && has(g.files, 'README.md') && g.files['README.md'] !== g.headTree()['README.md'] },
        { text: 'README.md 變成橘色「已修改」。把它放進暫存區', cmd: 'git add README.md', check: (g) => !!g.repo && g.repo.index['README.md'] === g.files['README.md'] && g.repo.index['README.md'] !== g.headTree()['README.md'] },
        { text: '存成第二張快照', cmd: 'git commit -m "更新 README"', check: (g) => g.commitCount() >= 2 },
        { text: '用文字看看歷史紀錄', cmd: 'git log --oneline', check: (g, c) => ran(c, /^git log/) }
      ],
      done: '歷史圖上有兩個點了，main 跟著往前走。每個 commit 都會連到它的上一個 commit。'
    },
    {
      id: 'restore', short: 'restore', title: '復原修改',
      setup: START.concat(['echo "@#$%&*!! 不小心亂改的內容" >> README.md']),
      intro: '檔案改壞了？<code>git restore 檔名</code> 會把它變回上一次存的樣子。<br>⚠ 被丟掉的修改<b>救不回來</b>喔！',
      steps: [
        { text: 'README.md 被改壞了（把滑鼠移到卡片上看看內容）。把它復原', cmd: 'git restore README.md', check: (g) => !!g.repo && g.files['README.md'] === g.headTree()['README.md'] }
      ],
      done: 'README.md 從儲存庫飛回來，恢復成最新快照的內容了！'
    },
    {
      id: 'reset', short: 'reset', title: '退回之前的 commit',
      setup: START.concat(['echo "第二行" >> README.md', 'git add README.md', 'git commit -m "新增內容"', 'echo "打錯的一行" >> README.md', 'git add README.md', 'git commit -m "寫錯的 commit"']),
      intro: 'commit 錯了？<code>git reset</code> 會把分支標籤<b>往回移</b>到之前的 commit。<code>HEAD~1</code> 代表「目前 commit 的上一個」。',
      steps: [
        { text: '取消最後一個 commit，但保留檔案的修改（看 main 標籤往回退）', cmd: 'git reset HEAD~1', check: (g) => headMsg(g) === '新增內容' && !!g.repo && g.files['README.md'] !== g.headTree()['README.md'] },
        { text: 'README.md 變成橘色「已修改」：修改還在。用 status 確認', cmd: 'git status', check: (g, c) => ran(c, /^git status/) },
        { text: '這次連修改一起丟掉，退回第一個 commit', cmd: 'git reset --hard HEAD~1', check: (g) => headMsg(g) === '第一次提交' && !!g.repo && g.files['README.md'] === g.headTree()['README.md'] }
      ],
      done: '<code>git reset</code> 會保留修改，<code>git reset --hard</code> 會連修改一起丟掉 ⚠。被退掉的 commit 在圖上變成虛線，因為已經沒有分支指向它們了。<br>💡 reset 只用在還沒分享給別人的 commit 上。'
    },
    {
      id: 'branch', short: 'branch', title: '建立分支',
      setup: START.concat(['echo "第二行" >> README.md', 'git add README.md', 'git commit -m "新增內容"']),
      intro: '<b>分支</b>就像開一條平行時空來開發新功能，不會影響主線 main。分支其實只是一張貼在 commit 上的<b>標籤</b>。',
      steps: [
        { text: '建立一個叫 feature 的分支', cmd: 'git branch feature', check: (g) => !!br(g, 'feature') },
        { text: '列出所有分支（* 是你目前所在的分支）', cmd: 'git branch', check: (g, c) => ran(c, /^git branch\s*$/) }
      ],
      done: 'feature 和 main 貼在同一個 commit 上，但 HEAD 還在 main。建立分支<b>不會</b>自動切換過去。'
    },
    {
      id: 'switch', short: 'switch', title: '切換分支',
      setup: START.concat(['echo "第二行" >> README.md', 'git add README.md', 'git commit -m "新增內容"', 'git branch feature']),
      intro: '<code>git switch 分支名稱</code> 會把 HEAD 移到那個分支。之後的 commit 只會讓<b>目前所在的分支</b>往前走。',
      steps: [
        { text: '切換到 feature（注意看 HEAD 移動）', cmd: 'git switch feature', check: (g) => onBranch(g, 'feature') },
        { text: '點「＋ 新檔案」建立 login.txt，內容隨意', gui: 'new', file: 'login.txt', check: (g) => has(g.files, 'login.txt') },
        { text: '把 login.txt 放進暫存區', cmd: 'git add login.txt', check: (g) => !!g.repo && has(g.repo.index, 'login.txt') },
        { text: '在 feature 上存成快照', cmd: 'git commit -m "新增登入功能"', check: (g) => ahead(g, 'feature', 'main') },
        { text: '切回 main，看看 login.txt 去哪了？', cmd: 'git switch main', check: (g) => onBranch(g, 'main') }
      ],
      done: 'login.txt 只存在 feature 分支，所以回到 main 時它消失了。別擔心，切回 feature 就會回來！'
    },
    {
      id: 'merge', short: 'merge', title: '合併分支',
      setup: START.concat(['git switch -c feature', 'echo "登入頁面" > login.txt', 'git add login.txt', 'git commit -m "新增登入功能"', 'git switch main', 'echo "關於我們" > about.txt', 'git add about.txt', 'git commit -m "新增關於頁面"']),
      intro: 'feature 開發完了，要把它<b>合併</b>回 main。先站在要接收的分支（main）上，再執行 <code>git merge</code>。',
      steps: [
        { text: '你現在在 main。把 feature 合併進來', cmd: 'git merge feature', check: (g) => onBranch(g, 'main') && headParents(g) === 2 },
        { text: 'feature 已經合併了，把這張分支標籤刪掉', cmd: 'git branch -d feature', check: (g) => !!g.repo && !br(g, 'feature') }
      ],
      done: '兩條線在<b>合併 commit</b> 匯合了！它同時包含 main 和 feature 的內容。你已經學會 Git 的基礎了 🎓'
    },
    {
      id: 'sandbox', short: '自由練習', title: '自由練習', anyOrder: true,
      setup: [],
      intro: '一個全新的空資料夾，自由練習吧！下面的挑戰可以用任何順序完成。忘記指令就輸入 <code>help</code>。',
      steps: [
        { text: '用 ＋ 新增檔案，並完成 3 個 commit', check: (g) => g.commitCount() >= 3 },
        { text: '建立一個分支，並在上面 commit', check: (g) => !!g.repo && Object.keys(g.repo.branches).some((b) => b !== 'main' && g.repo.branches[b] !== g.repo.branches.main) },
        { text: '把分支合併回 main', check: (g) => !!g.repo && Object.values(g.repo.commits).some((c) => c.parents.length > 1) },
        { text: '修改一個檔案，再用 git restore 復原', check: (g, c) => ran(c, /^git restore/) },
        { text: '用 git reset 取消一個 commit', check: (g, c) => ran(c, /^git reset (--(soft|mixed|hard) )?\S/) }
      ],
      done: '全部完成！接下來可以學習 GitHub 與遠端儲存庫（push / pull）。'
    }
  ];
})(window);
