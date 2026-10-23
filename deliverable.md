# 滑痕 - 交付报告

| 项 | 值 |
| --- | --- |
| **App 名称** | 滑痕 |
| 仓库 | z-biz-game-slide15-cos |
| 品类 | 益智 · 推盘（3×3 与 4×4） |
| 依赖 | 0（`dependencies` 为 `{}`，零构建、零二进制资产） |
| node 断言 | 94 条 / 7,394 断言 / 0 失败（10 个 suite） |
| 浏览器断言 | 138 条 / 0 失败（`@boot 21 @play 25 @routes 27 @save 17 @reloaded 7 @pointer 41`），脏 console `(none)` |
| 难度证据 | 3×3 穷举 BFS（可达 181,440、直径 31、距离直方图全表）+ 4×4 IDA* 每关复解 |

## 任务摘要

把 15 数字推盘做成"难度可被机器复算"的关卡包：7 档 × 8 关 = 56 关，每关随包发布
`par / path / nodes / ms / seed`。3×3 的最少步数不是搜出来的而是**查表**得来的（整张可达图被穷举过），
4×4 因为状态数是 16!/2 ≈ 10¹³，改用 IDA* 加可采纳启发，并对每一关在入库时重新求解验证。

## 真实文件清单

```
index.html  css/game.css  server.cjs  package.json  .gitignore  LICENSE
js/main.js  js/view.js
js/core/  puzzle.js game.js bfs3.js heur.js parity.js solve.js make.js library.js storage.js rng.js
js/data/lots.js                       56 关 + TIERS_META
test/     bfs3 game heur library make parity puzzle rng solve storage  （10 个 suite）
tools/    bake.mjs harness.mjs playtest.mjs verify.sh
.github/workflows/  ci.yml pages.yml
README.md DESIGN.md deliverable.md
```

## 改动表：一开始错在哪 → 现在为什么对

| # | 现象 | 处理 | 依据 |
| --- | --- | --- | --- |
| 1 | 仓库只有纯逻辑层（core + 10 个 suite），没有任何应用层 | 补 `package.json / index.html / css / js/view.js / js/main.js / server.cjs / workflows / verify.sh / playtest.mjs` | 本仓 mtime 与文件清单；`npm run check` rc=0 |
| 2 | 构建会话自述：`@pointer` 的拖拽向量写反、`@save` 段有一处引号不配对，改为离线 DOM/canvas 垫片台架跑绿后才修掉 | 我**未**逐条复现这两处（属于其过程描述），但两者的最终效果由浏览器门禁实跑覆盖：`@save`/`@pointer` 全段 `fail: []` 才算通过 | 主代理 `tools/verify.sh` 实跑输出 |
| 3 | 文档层缺失（README/DESIGN/deliverable 均无） | 本报告与前两份文档由主代理按**重新测量的数字**撰写 | 见下两节 |
| 4 | `hashSeed` 易被误标为 FNV-1a | 三份文档统一写"FNV-1a 派生的两轮 UTF-16 混合"，并给出 `hashSeed('a')=723832900` vs 教科书 `3826002220` | 契约已同步修订 |
| 5 | 首次门禁实跑：`@play` 红 1 条、`@pointer` 红 3 条 | 逐条按实测数字定性：**1 处产品 bug**（`el.share` 从未绑定，`shareLink()` 是死代码，分享按钮点下去不动）＋ **3 处断言自身写错**（`超` 字段的钳值算术、把"三分之一格以下"当前提从而连带让两行变成空断言、目标盘 `join('')` 的字面量多了逗号）。另加宽了门禁的 console grep 并让结尾的 log dump 参与判红。全过程记在 DESIGN §10 | `js/main.js` 的 `addEventListener` 清单、`js/view.js` 的 `up()`、`js/core/puzzle.js` 的目标盘定义、以及每行断言打印出来的实测值 |

## 构建验证结论

本机直接测量（不依赖任何子代理转述）：

```
npm run check                     rc=0  OK
bash tools/verify.sh              === ALL GREEN ===   exit 0
  node   94 rows / 7394 asserts / 0 fail   （10 个 suite 逐条相加）
  浏览器 138 rows / 0 fail
         @boot 21  @play 25  @routes 27  @save 17  @reloaded 7  @pointer 41
  console (none) —— 每段跑完判一次，结尾全量重放再判一次
bfs3.reachableCount()             181440
bfs3.diameter()                   31
bfs3.farthestBoards().length      2
bfs3.distanceHistogram()          32 档，和为 181440，末档 2
上述穷举耗时                     115 ms
```

浏览器层由本仓自带的门禁 `tools/verify.sh`（web :5192 / DevTools :9352，独立 `mktemp -d` profile，
真起 headless Chrome）实跑并已跑绿：**138 条 / 0 失败 / console (none)**，上面那组数字就是那一次的
原始输出。跑绿之前不发布；首跑的红是怎么变成绿的，逐条记在 DESIGN §10。

## 难度 / 唯一性的证据在哪

- **3×3 是定理**：整张可达图被穷举，`par` 是表上的一个读数；直径 31 与"只有 2 个最远盘"由同一张表给出。
- **4×4 是复算**：每关的 `par` 由 IDA* 从序列化局面重新解出，`test/library.test.mjs:38` 断言
  "重新解 == 印着的 par"，并断言 `path.length === par`、`par` 为 ≥2 的整数。
- **搜索超预算即不发布**：`solve.js` 在 `nodes > nodeLimit` 时返回 `Infinity`，`make.js` 的每档带
  `nodeLimit / timeLimitMs`，因此不存在"猜一个步数印上去"的路径。
- **不可解盘不会到玩家手里**：`parity.js` 以逆序数 + 空格行号判奇偶，3×3 可达集恰为 9!/2 即其体现。
- **每关自带成本数据**：`nodes` 与 `ms` 随包发布（如 `siege-01` par 38 / 80,629 节点 / 19 ms）。

## 未实现清单（不留空头承诺）

- **~~`siege` 档生成 acceptance 的百分比未实测~~（已实测，见 DESIGN §9.1）**：在**整仓副本**里跑
  `node tools/bake.mjs` 就够了，不必覆写 `js/data/lots.js`。七档 acceptance 为
  `60.0 / 61.5 / 80.0 / 25.8 / 72.7 / 53.3 / 15.7%`，`siege` 的 **15.7% 复现到小数位**。
  它的构成是同一行报告里的 `tooEasy 11 / truncated 32 / duplicate 17`（130 次尝试留 8 个），
  发布条件是七档各满 8 关而不是某个百分比；被丢弃的盘一个也没进包。
  所谓"契约要求 20% 下限"在本工作区检索不到出处（`z-biz-game-lead/` 没有本仓需求文档，也没有任何
  脚本写过这个数），因此这里把它记成**一句无源口径 + 一组实测数字**，不去改数字也不去编门槛。
  顺带一条更有用的结论：副本里重新烤出的 56 关与随包发布的那一份在 `id / band / n / par / state`
  上逐字段相同，`js/data/lots.js` 是可复现产物。
- **~~Electron 产物留待裁决~~（已裁决：不带，见 DESIGN §9.2）**：本仓**没有** `electron/main.cjs`。
  家族 84 个 `-cos` 仓里 48 个带、36 个不带；本工作区没有任何门禁要求它（唯一提到这个路径的代码是
  隔壁 slither 的 `tools/check.mjs`，那里它属于"存在就顺带 `node --check`"的可选清单）；本仓的
  `check` / CI / `verify.sh` 都没提过 electron；`dependencies` 是 `{}`，补壳只会被语法检查一遍、
  永远跑不起来。本报告仍然不为通过某个门禁塞一个永不启动的死文件。
- **浏览器内生成/搜索**：有意不做（4×4 单关搜索可达十万级节点展开，不适合放进交互帧）。
- **真机触摸手势**：仅以 CDP 合成事件验证。
- **多语言**：UI 只有中文。
- **美术资产**：0 个二进制文件，画面全部由 canvas 2D 程序化绘制。
- **成就 / 排行 / 云存档**：组织规范禁止；分享只有 `#/lot/<id>` 链接（同关不带分数）。

---

# 第二轮：有机并线（`b8a2ae8`）之后的修复

上一轮（上面那份）交付的是**这个游戏被造出来**的那一版。并线把两侧的同一批功能各接了
一遍、把一侧的整块裁掉了，于是下面这些是真缺陷，不是风格问题。

## 基线 → 本次提交

| | 提交 | 说明 |
|---|---|---|
| 基线 | `b8a2ae8` | 「merge: 有机并线（两侧内容合入；重叠块按最新权威裁，非重叠两侧都留）」。两侧 = 本地侧 `7355e16` 体系（最后提交 2026-10-02）与远端侧 `7b541c1` 体系（最后提交 2026-10-08） |
| 本次修复 | `75880a6` | 五处整局级缺陷 + 玩法说明整块失联 + 三段 CSS 丢失 + 文档钉重钉 + manifest 主题色对齐 |
| 本交付物 | 本文件所在提交 | 只改这一个文件（追加本节），上一轮那份报告原文保留 |

> 并线权威口径（`z-biz-game-lead/003_辅助能力/collapse/script/merge_organic.py` 的 `decide()`）：
> 按**该路径两侧最后一次提交时间戳**比较，新的一侧为胜方。本仓逐路径算下来：`index.html` /
> `js/main.js` / `js/view.js` / `js/core/storage.js` / `css/game.css` / `manifest.webmanifest` /
> `sw.js` / `tools/*` 归**远端侧**，`assets/` / `icons/` 的一部分 / `server.cjs` 只在**本地侧**有。
> 本轮只取并集不取单边的地方，已在下表逐条写明。

## 改动表：旧代码错在哪 → 新代码为什么对

| # | 旧代码错在哪 | 新代码为什么对 |
|---|---|---|
| 1 | **整局不可玩**：`js/view.js` 里 `reduceMotion` 出现**两遍**——远端侧是 `let reduceMotion = false`（一个由 `setReduceMotion` 翻的布尔量），本地侧是 `const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')`（一个 MediaQueryList）。**ES module 的顶层作用域里同名声明是 SyntaxError** ⇒ `view.js` 整份不加载 ⇒ `js/main.js` 的 import 失败 ⇒ 页面只剩空壳 | 只留远端侧那个布尔量。翻开关的动作本来就在 `js/main.js`（那边读 `matchMedia`、订阅系统偏好变化、再调 `view.setReduceMotion(on)`）；本地侧 `view.js` 里那份订阅是**第二个人读同一件事**，两边各记一份状态、迟早有一份过期——并线就是这么长出两个同名 `reduceMotion` 的 |
| 2 | **每帧抛 ReferenceError**：「减弱动效」这一个概念被并线写成了**两个名字**——391 行用的是本地侧的 `rm`，而 `let rm = ...` 与它的更新订阅被裁掉了 ⇒ 每渲染一帧抛一次 `ReferenceError: rm is not defined` ⇒ 画布不更新、指针事件不生效；浏览器闸的「console 干净」六段各红 5 条，`@pointer` 的像素断言与「撤销能把画面带回去」跟着红 | 391 行改用 `reduceMotion`：同一个概念、同一个名字、同一个状态。改完 console 干净，`@pointer` 41 rows / 0 fail |
| 3 | **读档恒为空档（刷新后进度全丢）**：`js/core/storage.js` 的 `load()` 写的是 `raw = ls ? globalThis.localStorage.getItem(KEY) : null`，而 `const ls = backing();` 那一行被并线裁掉了（远端侧有；本地侧那版直接写 `localStorage.getItem`，两版合到一起把声明丢了）⇒ ReferenceError 正好被紧跟着的 `catch` 接住 ⇒ **每次读档都读成空档** ⇒ 刷新后 `unlocked` 回到 1、`records` 空、每日那一条也不记得，而控制台一个字都不吭（错误被吞在 catch 里） | 把 `const ls = backing();` 补回 `load()`；顺手把 `persist()` 也收回 `backing()` 这条通道——文件头自己写的就是「every access here goes through `backing()`」，直接写 `globalThis.localStorage` 是**靠抛来表达"写不进去"** |
| 4 | **玩法说明整块失联**：`index.html` 里顶栏那颗「?」按钮与说明浮层**共用 `id="help"`** ⇒ `getElementById` 拿到的是文档里靠前的按钮 ⇒ `el.help.hidden = false` 改的是按钮、**浮层永远打不开**；`closeHelp()` 把按钮 `hidden = true` ⇒ 按一次 ? 图标就消失。而那颗按钮本来也**没有任何点击处理器**——「点按钮开说明」这条路从来没接过 | 按钮改 `id="help-btn"`，浮层保留 `id="help"`；`el` 表加 `helpBtn`，按钮接 `toggleHelp`（与 `?` 键同一条路）。页面 26 个 id 现在全部唯一，`main.js` 用 `$()` 取的 25 个 id 一个都不悬空 |
| 5 | **并线丢了三段 CSS**：`css/game.css` 里没有 `.hud`（顶栏三颗按钮的样式，≥44px 真命中区）、没有 `.help`（说明浮层的遮罩与卡片）、没有 `@media (prefers-reduced-motion: reduce)`（CSS 过渡/动画压制）——HTML 与 JS 里对应的功能都在，只有样式没了 | 按本地侧原文**逐字补回**这三段（不改一个数值）。说明浮层即使能打开也有遮罩与卡片了；减弱动效下 CSS 动画不再照播 |
| 6 | **文档行号钉指着更早一版文件**：README/DESIGN 里那批 `js/main.js:NN` / `js/view.js:NN` / `server.cjs:NN` 指的是更早一版文件的行号（并线与本地侧那次改动各挪过一次），文档腿 D2 点名「server.cjs 第 64 行那几行整段是空行」（旧钉值只作留痕，故意不写成 `路径:行号` 的活引用形状——那个形状会被当轮引用判） | 逐条按现在的文件重新定位并钉回去（`HINT_BUDGET` 41、`solve` 那句 346、`overPar` 139-141、`field()` 143-145、`commit()` 239-255、`parseHash` 63-70、键盘处理 513-539、`bfs3` 动态 import 588/649、拖拽与点击阈值 `view.js` 229/244、端口解析 `server.cjs:66`）。**钉的是实数，强度不变** |
| 7 | **manifest 主题色与页面实际配色对不上**：`manifest.webmanifest` 写 `background/theme = #0a0a12`，而 `css/game.css` 的 `--bg` 是 `#101217`、页面 `meta theme-color` 是 `#14161a` ⇒ 装到桌面后的壳色与页面本身不是一个色（这个 `#0a0a12` 在远端侧自己的 CSS 上就对不上，是那边的旧值） | 取本地侧那两个值（`#101217` / `#14161a`），与 CSS 和页面 meta 同源 |

### 改钉一览（钉的是实数，强度不变）

| 钉 | 旧 | 新 | 为什么变 |
|---|---|---|---|
| `tools/deploy-set.mjs` `EXPECT_CHECKS` | 32 | 34 | 并线把页面要取的东西凑到了 34 条（`index.html` 9 + `manifest.icons` 3 + `css/game.css` 1 + `js/main.js` 10 + 其余模块 11；另有 2 条外链不计入），钉停在旧值。**这是「引用条数」这一个实数**，引用多了是加严不是放水 |
| `tools/deploy-set.mjs` `EXPECT_ROWS` | 51 | 53 | 同上，这是「这一跑实际跑的断言条数」这一个实数 |

闸的**断言一条没改、强度一条没降**：部署集闸仍然逐条查「页面要去的东西在不在产物里且非 0 字节」
（R10）、仍然要求引用条数与断言条数**两个数一起**等于钉在文件里的值、仍然逐张核 PNG 容器与声明尺寸
（P1/P2）、仍然要求 `og:image` 是**本站**前缀下的绝对 URL 且那张图在产物里（R7）；文档腿
`tools/docs-test.mjs` 的**项数一项没动**（28 项），本次只**重钉位置**。

### 真实文件清单（本次改动的文件）

| 文件 | 改了什么 |
|---|---|
| `js/view.js` | 删本地侧那段 `matchMedia` + `rm`（保留远端侧的布尔量与 `setReduceMotion`）；391 行的 `rm` 改成 `reduceMotion` |
| `js/core/storage.js` | `load()` 补回 `const ls = backing();` 并改走 `ls.getItem`；`persist()` 改走 `backing()` |
| `index.html` | 顶栏「?」按钮 `id="help"` → `id="help-btn"`（浮层保留 `help`） |
| `js/main.js` | `el` 表加 `helpBtn`；给那颗按钮接 `toggleHelp` |
| `css/game.css` | 补回本地侧的 `.hud` / `.help` / `@media (prefers-reduced-motion: reduce)` 三段 |
| `manifest.webmanifest` | `background_color` → `#101217`、`theme_color` → `#14161a` |
| `tools/deploy-set.mjs` | `EXPECT_CHECKS` 32→34、`EXPECT_ROWS` 51→53（钉的是实数，强度不变） |
| `README.md` | 11 处行号钉重钉 |
| `DESIGN.md` | 1 处行号钉重钉 |

**没有新建 README / 总结类 md**（本文件 `deliverable.md` 除外），没有删任何关卡 / 规则 / 音效 /
动效 / 键位，`js/` 与 `css/` 之外的功能一件没少。

### 删行审计

| 删掉的东西 | 行数 | 为什么能删 |
|---|---|---|
| `js/view.js` 本地侧的 `matchMedia` + `let rm` + 订阅块 | 6 | 与远端侧的布尔量是**同一件事的两个人**；翻开关的动作在 `js/main.js`（权威侧、较新），view.js 里再读一次就是第二个读者 |
| `js/view.js` 391 行的 `rm` | 1（改名） | 同上：同一个概念留一个名字 |
| `index.html` 按钮上的 `id="help"` | 1（改名） | 与浮层撞 id 是缺陷本身，不是功能 |
| `js/core/storage.js` `persist()` 里直接写 `globalThis.localStorage` | 1 | 改走 `backing()`，语义相同且不再靠抛来表达"写不进去" |

净变化：`9 files changed, 70 insertions(+), 22 deletions(-)`。

## 验收（命令原样输出）

```bash
$ npm run check
OK

$ npm run unit        # 10 个 suite 逐条相加
rows: 9 fail: 0 asserts: 98        # bfs3
rows: 13 fail: 0 asserts: 4140     # game
rows: 8 fail: 0 asserts: 27        # heur
rows: 10 fail: 0 asserts: 987      # library
rows: 8 fail: 0 asserts: 358       # make
rows: 11 fail: 0 asserts: 154      # parity
rows: 10 fail: 0 asserts: 32       # puzzle
rows: 7 fail: 0 asserts: 1453      # rng
rows: 11 fail: 0 asserts: 110      # solve
rows: 7 fail: 0 asserts: 35        # storage
node assertions total: 7394

$ node tools/docs-test.mjs
rows: 28 fail: 0 asserts: 0

$ node tools/deploy-set.mjs
部署集：34 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 53 fail: 0

$ bash tools/verify.sh
=== node suites ===
node assertions total: 7394
opened http://127.0.0.1:5192/
(no console output)
boot lot: kerb-01
=== @boot ===
rows: 21 fail: 0
=== @play ===
rows: 25 fail: 0
=== @routes ===
rows: 27 fail: 0
=== @save ===
rows: 17 fail: 0
=== @reloaded ===
rows: 7 fail: 0
=== @pointer ===
rows: 41 fail: 0
=== deploy-set ===
rows: 53 fail: 0
=== ALL GREEN ===
```

浏览器闸的读数自证：`@reloaded` 那 7 条现在全绿（"刷新后从盘上读回进度"读到了 `unlocked` 与
`records`，"每日那一格还记得"读到了当天的 mark），`@pointer` 那 41 条里的"被拒的一按画面不留痕"
与"撤销把画面带回去"都拿到了读数（此前它们红是因为渲染循环每帧抛 `rm` 未定义）。

## 行为变化需知会

1. **玩法说明现在能打开了**：顶栏那颗「?」按钮第一次真的接上了线（此前它没有任何处理器，
   而浮层永远打不开）；`?` 键与 `Esc` 关闭照旧。
2. **刷新后进度保住了**：存档不再每次读成空档，`unlocked` / `records` / 每日那一条都记得。
3. **减弱动效现在真的统一**：系统偏好开着时，动画瞬时归位（画布侧）与 CSS 过渡压制（样式侧）
   由**同一个开关**控制，不再是画布听一份、样式听另一份。
4. **顶栏三颗按钮与说明浮层恢复样式**：`.hud` 的 ≥44px 命中区回来了，说明浮层是遮罩 + 卡片
   （此前那三段样式在并线后整段不见了，浮层即使能开也只是普通流里的一个块）。
5. **装到桌面后的壳色**从 `#0a0a12` 改成 `#14161a`（与页面 `meta theme-color` 一致）。

## 未实现 / 需人接手

1. **键盘覆盖仍不全**（DESIGN 已记）：只绑了 `u / h / r / d`、四个方向键、一个收起结算卡的
   `escape`，另有 `? / m / f` 三个全局键；没有无障碍标注体系，也没有多语言。
2. **方向键的命名与直觉相反**（按"这块数字自己往哪走"命名），代码注释里写明了这个口径，
   但那是产品取舍，不是 bug——要改得连文案与文档一起改。
3. **真机触摸手势**仅以 CDP 合成事件验证。
4. **并线留下的两处"两版实现并存"没有合并**：`sw.js` 取的是远端侧那份（网络优先 + 免手动 bump），
   本地侧那份（额外预缓存 `css/game.css` / `icons/*` / `assets/*`）被整块裁掉；两版都是完整实现，
   差别只在冷启动预缓存清单的宽窄——那是产品取舍，留给人定。
5. **`manifest.webmanifest` 取的是远端侧那份最简版**（3 枚图标，无 `description` / `scope` /
   `orientation` / `lang` / `categories` / `screenshots`）；本地侧那份更全。按并线权威口径该归远端侧，
   本次只对齐了它的主题色（那处是**与自己的 CSS 对不上**的旧值），没有替产品决定要不要补回
   那些元信息字段。
6. **`assets/` 目录（出图脚本 `assets/gen/make_art.py` + 清单）与 `assets/texture/`（运行时托盘纹理）
   一起进产物**：前者是源码、后者是运行时资源，两者在同一个目录下，拷贝清单按目录收。
   要把源码摘出去，得先把它挪出 `assets/`。

## 基线归因记录

| 现象 | 归因 | 证据 |
|---|---|---|
| 整局打不开（白屏） | 并线造成 ES module 同名顶层声明 ⇒ `view.js` 整份不加载 | `node --check` 报 `Identifier 'reduceMotion' has already been declared`；`b8a2ae8:js/view.js` 里 `reduceMotion` 两份声明（`let` 一份、`const matchMedia` 一份） |
| 每帧抛 `rm is not defined` | 并线把「减弱动效」这一个概念写成两个名字，其中一个的声明被裁掉 | 浏览器闸 console 段：`[EXCEPTION] ReferenceError: rm is not defined at step (http://127.0.0.1:5192/js/view.js:391:7)`，六段各 5 条 |
| 刷新后进度全丢 | 并线把 `load()` 里 `const ls = backing();` 裁掉，错误又被 catch 吞掉 | `@reloaded` 红 4 条：「a fresh page reads its progress off disk {"unlocked": 1, "records": []}」 |
| 说明浮层打不开、? 图标点一下就消失 | 按钮与浮层共用 `id="help"`（本地侧本来就撞，并线把它原样带了过来） | `b8a2ae8:index.html` 第 29 行与第 106 行都是 `id="help"`；`getElementById` 取文档里靠前的那个 |
| 顶栏按钮与浮层没样式 | 并线把本地侧三段 CSS 整块裁掉 | `b8a2ae8:css/game.css` 里没有 `.hud` / `.help` / `prefers-reduced-motion`；本地侧 `b8a2ae8^1:css/game.css` 第 106-136 行有 |
| 文档腿红 1 条 | README 的行号钉指着更早一版文件 | 合并基线跑 `node tools/docs-test.mjs`：`D2 边界 … 不在的 1 处：README.md · server.cjs 第 64 行那几行整段是空行` |
| 部署集闸红 2 条 | 钉停在并线前的实数 | 合并基线跑 `node tools/deploy-set.mjs`：`R12 实际 34 条` vs 钉 32、`R13 实际 53 条` vs 钉 51 |
| 上面这些**不是**本次改坏的 | 全部在并线提交 `b8a2ae8` 上就成立 | 基线复现：把 `js/view.js` / `js/core/storage.js` / `index.html` / `css/game.css` / `README.md` / `tools/deploy-set.mjs` 恢复到 `b8a2ae8` 的样子，上面每一条读数原样复现（`node --check` 直接报 `reduceMotion` 重复声明；浏览器闸的 console 段每段 5 条 `rm is not defined`；`@reloaded` 红 4 条） |

**环境提示（不是本仓缺陷）**：本机另有 3 个 headless Chrome 带着调试端口在跑（别的车道），
`tools/verify.sh` 在开头打印了这条提示并继续——它自己的两个端口（:5192 / :9352）是空的，
所以这一跑读的是本仓自己的页面。
