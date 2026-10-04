# 十五数字盘 SLIDE15 · z-biz-game-slide15-cos

一个零依赖、零构建、可以整目录扔进任何静态托管的数字滑块拼图（15-puzzle 一族，3×3 到 4×4，七档难度、共 56 关）。它跟同类小游戏最大的区别是：屏幕上报给你的那个"最少 N 滑"不是估算，是 IDA\* 搜出来的、并且被 3×3 的全空间穷举表逐一对账过的可证最优值；而这一句话本身又有一条会红的命令在底下撑着。

`package.json` 的 `dependencies` 与 `devDependencies` 都是空对象（第 30-31 行），`type` 是 `module`、`main` 是 `server.cjs`（第 5-6 行），全部闸门加起来就是一个 `node` 加一个本机 Chrome，没有安装步骤、没有打包步骤、没有测试框架。

---

## 一、规则，以及代码真的在判的数学根据

盘面是一枚 `width × width` 的行优先排列，`0` 代表空位。一次操作只有一种：把与空位正交相邻的一块数字滑进空位。邻接顺序在 `js/core/puzzle.js:46-62` 里写死为上、下、左、右，`applySlide`（同文件 `90-94`）对越界或非相邻的输入直接 `throw`，不存在"滑不动就当没发生"的第三条路。目标态是 `1 2 … n²-1, 0`，见 `goalState`（`puzzle.js:23-31`，第 22 行的注释把 3×3 的目标画了出来）。

可解性判定在 `js/core/parity.js`：`inversions`（12-20）数逆序对，`blankRowFromBottom`（25-28）数空位距第几行，`solvable`（33-37）合起来就是教科书结论——奇数边长要求逆序数为偶，偶数边长要求两者奇偶相反。这条判定不是装饰：`js/core/make.js:39-44` 的整盘洗牌路线会造出真实死盘，`js/core/solve.js:38-40` 遇到不可解盘面返回 `{ok:false, moves:-1, reason:'unsolvable'}`（宁可交回 -1，不交回一个假的最少滑数），`test/library.test.mjs:58-63` 拿它逐行核对出厂池子。

3×3 是这仓里唯一被穷举到底的空间。`js/core/bfs3.js` 用 Lehmer 秩把 9! 个排列压进 `Int16Array`，从目标态做单向 BFS 建全深度表（`table()`，55-111），然后 `reachableCount / diameter / distanceHistogram`（118-128）、`boardsAtDepth`（133-145）、`farthestBoards`（149-151）都只是读表。文件头第 6-9 行的注释写明"只在构建期与测试期使用，出厂页面不 import 它"——这一点本轮静态核过：全仓只有 `js/main.js:507` 与 `:568` 两处 `await import('./core/bfs3.js')`，都在 `window.slide15` 调试钩子内部。同一段注释（第 8-9 行）还写明了 4×4 为什么没有表：`16!/2 = 10^13` 个状态装不下。

最优滑数用 IDA\*（`js/core/solve.js:27`）配 `manhattan + linearConflict`（`js/core/heur.js:97-99`）；线性冲突按"最少要移开几块"计费并乘二，那段最小移除数在 `heur.js:55-67` 用类 LIS 的动实现。可采纳性不是嘴上说的：`test/heur.test.mjs:74-91` 把 181440 个可达 3×3 全扫一遍，断言没有一个盘面的下界超过真实深度（`over === 0`），并且至少有一个盘面下界与真值相切（`minSlack === 0`）。

`js/core/make.js`、`js/core/bfs3.js`、`tools/bake.mjs` 属于烤制期，出厂页面只读 `js/data/lots.js` 再查表（`js/core/library.js`），所以玩家点开的每一关都是离线可用的纯查找。存档是单一版本化键 `slide15.save.v1`（`js/core/storage.js:11`），`localStorage` 抛错时退到内存后备（同文件 `13-21`）。

---

## 二、承诺表：每条承诺都对应一条真的会红的命令

| 承诺 | 判它的命令 | 条数来源与验红方式 |
| --- | --- | --- |
| 出厂 56 关每行的 `par` 是真的最少滑数 | `npm run unit` | `test/library.test.mjs:38-49` 逐行重解全部 56 行，本轮交回 `rows: 10 fail: 0 asserts: 987`；那条注脚点名的最慢一关是 `siege-05`（毫秒数是读数，本文不记）。破坏试验：把工作副本里某行 `par` 改成 `par+1`，该套件交回 `rows: 10 fail: 4` |
| 3×3 的全空间事实（可达 181440、直径 31、最远恰 2 个）成立 | `npm run unit` | `test/bfs3.test.mjs:25-38` 手抄锚点 + `test/parity.test.mjs:167-190` 扫完 362880 个排列；本轮实测 `9! = 362880 arrangements scanned, 181440 judged solvable, 181440 reachable in the table` |
| 4×4 及以上不会被冒充成"有穷举真值" | `npm run unit` | `js/core/bfs3.js:22` 的 `MAX_SIDE = 3`；`test/bfs3.test.mjs:65-70` 断言 4×4 的全量请求被拒 |
| IDA\* 交回的滑数与穷举表逐板相等 | `npm run unit` | `test/solve.test.mjs:99-118` 深度 0..18 全量对账（`checked === 26931`）与 `:120-140` 深盘 stride-41 抽样；本轮注脚 `26931 boards reconciled`、最深一次搜索展开 `1674 nodes`、深盘抽样 `3779 deep boards reconciled`（三个都是整数，秒数不记） |
| 预算不够时明说"算不动"，不给假数字 | `npm run unit` | `test/solve.test.mjs:70-82` 用 `nodeLimit: 40` 逼出 `reason:'nodes'`、`:83-97` 用 `timeLimitMs: 1` 在一块深 4×4 上逼出 `truncated`，两处都断言 `moves` 交回 `-1`、`path` 为空、且绝不是把启发值当答案印出去；页面侧 `js/main.js:342` 同口径 |
| 每一关的 par 落在它所属档的实测区间内，且档与档不重叠 | `npm run unit` | `test/library.test.mjs:65-79`，区间是从实际落盘行量出来的，不是生成器的愿望清单 |
| 手改 `js/data/lots.js` 里任何一个数字都会被抓 | `node test/library.test.mjs` | `:128-136` 断言"被手改过的 par 不该被接受"；破坏试验：把 `wall-03` 的 13/14 两块对调后 `fail: 3`（含"parity agrees with the pool"一条） |
| 一次滑动只计一次，非法按压不计费，只在最后一块归位时判胜 | `npm run unit` | `test/game.test.mjs:100-115`：拿每条被认证过的路径走一遍，必须恰好在 `par` 步获胜且只有最后一滑能触发 `done`（`js/core/game.js:43-52` 的非法按压返回原状态、成本 0） |
| 星级只给足真正打到 par 的解 | `npm run unit` | `test/game.test.mjs:166-192` 三个切点，对应 `game.js:73-78` 的 `over<=0` / `over<=max(4,ceil(par*0.2))` 分档 |
| 日关、随机关、hash 路由同种子必同盘 | `npm run unit` | `test/rng.test.mjs:65-67` 锁死 `hashSeed` 的四个取值（输入 `'a' / 'hello' / '2026-09-27' / 'bake-abyss-3'` → `723832900 / 3276111607 / 1753841231 / 1923062945`，同文件 43-50 行先与公开的 FNV-1a 测试向量对照过）；`test/library.test.mjs:99-113` 断言这些路由是纯查表 |
| 每个 js / mjs / cjs 文件语法上可被 node 载入 | `npm run check` | 逐文件 `node --check`，本轮实测 27 个 glob 命中文件，末行打印 `OK` |
| 真浏览器里能开局、能玩、能换路由、能刷新保档、能用鼠标拖拽 | `bash tools/verify.sh`（CI 的 browser job 在 push 到 main、pull_request 与手动触发时跑，`ci.yml:3-7`） | 场景与断言在 `tools/playtest.mjs:602-867`；**本轮未执行**（见第七节），能给的是源码里的 `rec()` 书写点条数 |

烤制这一步还有自己的硬闸：`tools/bake.mjs:55-62` 会把即将落盘的每一行反序列化后重新求解、重新走一遍路径，两者不一致就直接 `throw`，所以"落盘的数字"和"重算的数字"在生成期就被焊在一起。

---

## 三、怎么跑

`package.json:8-15` 的 scripts 原文如下（逐条核对存在）：

```
start / serve   node server.cjs 5192
dev             node server.cjs 5193
check           for f in js/*.js js/*/*.js server.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
unit            for f in test/*.test.mjs; do node "$f" || exit 1; done
test            npm run check && node --test test/
bake            node tools/bake.mjs
verify          bash tools/verify.sh
```

`npm test` 是日常总闸（本轮跑过，见第四节）。`npm run unit` 是同一个套件集合换一种跑法，`tools/verify.sh:105` 用的就是这条循环。`npm start` 起本地静态服务在 5192，`npm run dev` 在 5193，`server.cjs:64` 的取值顺序是命令行参数、环境变量 `PORT`、然后 5192，起服务后打印 `十五数字盘 SLIDE15 served at http://127.0.0.1:<port>/`。`npm run bake` 重写 `js/data/lots.js`（本轮在仓库外的副本里跑过，见第六节）。`npm run verify` 起 Chrome、起服务、跑完 6 个场景后打印 `=== ALL GREEN ===`；本轮没有执行它——这台机器上另有一个仓的 headless Chrome 带着 `--remote-debugging-port=9373` 在听，浏览器台架同一时刻只留一个。

烤制量可调：`PER_BAND=2 node tools/bake.mjs`（`tools/bake.mjs:32` 读这个环境变量，缺省 8）。

---

## 四、门禁清单与本轮实测交回的条数

节点层一共 10 个套件，本轮 `npm test` 全绿。每套件的尾行由 `tools/harness.mjs` 打印，格式固定为 `rows: N fail: M asserts: K`；下表左到右是"文件名 / 判什么 / 本轮实测 rows、asserts、fail"：

| 套件 | 判什么 | rows | asserts | fail |
| --- | --- | --- | --- | --- |
| `test/bfs3.test.mjs` | 3×3 全深度表、直方图、最远板、4×4 拒答 | 9 | 98 | 0 |
| `test/game.test.mjs` | 计费、撤销、复位、星级切点、路径恰在 par 取胜 | 13 | 4140 | 0 |
| `test/heur.test.mjs` | 下界可采纳且相切（181440 全扫 + stride-37 抽样）、纯函数 | 8 | 27 | 0 |
| `test/library.test.mjs` | 56 行逐行重解、路由合法、档区间实测、campaign 曲线、手改检出 | 10 | 987 | 0 |
| `test/make.test.mjs` | 拒绝分类计数、种子可复现 | 8 | 358 | 0 |
| `test/parity.test.mjs` | 全 9! 扫描下判定与可达集一致 | 11 | 154 | 0 |
| `test/puzzle.test.mjs` | 邻接顺序、`applySlide` 抛错、目标态形状 | 10 | 32 | 0 |
| `test/rng.test.mjs` | 与公开 FNV-1a 向量对照、`hashSeed` 锁值、`mulberry32` | 7 | 1453 | 0 |
| `test/solve.test.mjs` | IDA\* 与 BFS 表逐板对账、不可解与截断的诚实返回 | 11 | 110 | 0 |
| `test/storage.test.mjs` | 最佳值单调下降、`localStorage` 不可用时的内存后备 | 7 | 35 | 0 |
| 合计 |  | **94** | **7394** | **0** |

两种跑法交回同一份总数：`node --test test/` 的尾统计是 `ℹ tests 10 / ℹ pass 10 / ℹ fail 0`（它数的是**文件级**的 10 条，不是断言条数），把 `verify.sh:105-113` 那段循环连同它的 `sed` 原样搬出来跑（不含任何浏览器步骤）则交回 `node assertions total: 7394`。表里 rows 与 asserts 的每一格在这两条路径上逐位相同；**唯一会漂的是耗时**，所以本文不写 `duration_ms`。

浏览器层这一轮没跑，所以只给得出静态计数：`tools/playtest.mjs` 里六个场景的 `rec()` **书写点**分别是 boot 21（602-661）、play 25（663-738）、routes 21（740-799）、save 17（801-849）、reloaded 7（853-867）、pointer 44（287-575），合计 **135** 个书写点（与整文件 `grep -c "rec("` 的 135 相符）。执行行数不会等于这个数：routes 里有一条 `rec()` 写在 `for (const band of g.bands)` 循环内（`playtest.mjs:762-771`，`g.bands` 是七个档），展开后正好是 21 - 1 + 7 = 27 行；pointer 里也有按认证路径逐步展开的循环，同时存在某几条书写点在某次运行的分支上走不到。`deliverable.md` 第 10 行记的那次实跑是 `138 条 / 0 失败`，分区 `@boot 21 @play 25 @routes 27 @save 17 @reloaded 7 @pointer 41`——routes 27 与上面的展开算式吻合，pointer 41 比书写点 44 少 3 条；本轮没执行这一层，所以对那两个数既不复现也不反驳，只把它们当作文档记录列在此处。可以确定的是 `verify.sh:141-167` 只解析 `rows: / fail:` 并让 `fail` 决定成败，**没有任何对行数的断言**。

boot 场景把上面几个数学锚点在真页面上再钉一遍（`tools/playtest.mjs:632,643,644,653`）：`gr.states === 181440 && gr.size === 362880 && gr.diameter === 31`、`gr.atDiameter === 2 && gr.histogram[31] === 2 && gr.histogram[30] === 221`、"IDA\*, the exhaustive BFS table and the baked par agree on all 32 3×3 boards"（同一条还断言 `lots3.length === 32`）。日关锚点写在 routes 场景里（`:759`）：`g.daily('2026-09-27').id === 'kerb-03' && ...par === 4`——本轮直接调 `js/core/library.js` 复现了 `2026-09-27 → kerb-03 par 4`，另两天是 `2026-09-28 → deep-06 par 21`、`2026-09-29 → deep-05 par 21`。

破坏试验（本轮把整仓拷到仓库外的副本里做，真仓一行未改；副本用完即删。这个"只在副本里烤、只读不改出厂文件"的手法是 `DESIGN.md` §9.1 定的）：把 `kerb-01` 的 `par` 加一 → library `rows: 10 fail: 4`（红的是 re-solving every shipped board / every stored route is legal / the pool has rows at both widths / the campaign is a curve）并且 game 也 `rows: 13 fail: 4`；对调 `wall-03` 的 13/14 两块 → library `fail: 3`，其中一条正是"parity agrees with the pool"，game 另红 1 条；把 `kerb-01` 的 `path` 截掉一步 → library `fail: 2` 且 game `rows: 13 fail: 4`。承诺表第一、六、八行的"会红"是这么验出来的，第六节的接受率表也是这么量出来的。

---

## 五、目录结构

本轮 `find` / `ls` 的真实结果，无虚构：

```
.github/workflows/ci.yml        .github/workflows/pages.yml
.gitignore                      DESIGN.md          LICENSE
README.md                       css/game.css       deliverable.md
index.html                      js/main.js         js/view.js
js/core/bfs3.js                 js/core/game.js    js/core/heur.js
js/core/library.js              js/core/make.js    js/core/parity.js
js/core/puzzle.js               js/core/rng.js     js/core/solve.js
js/core/storage.js              js/data/lots.js    package.json
server.cjs                      test/bfs3.test.mjs     test/game.test.mjs
test/heur.test.mjs              test/library.test.mjs  test/make.test.mjs
test/parity.test.mjs            test/puzzle.test.mjs   test/rng.test.mjs
test/solve.test.mjs             test/storage.test.mjs
tools/bake.mjs                  tools/harness.mjs / tools/assemble-site / tools/deploy-set / tools/deploy-set-selftest
tools/playtest.mjs              tools/verify.sh
```

出厂产物只有 `index.html`、`css/`、`js/` 三样：`.github/workflows/pages.yml:29-31` 的构建步就写死了 `mkdir _site; cp index.html _site/; cp -r css js _site/`。`index.html` 的图标是内联 SVG data URI（第 10 行，注释解释是为了不给控制台添 404），样式与脚本都用相对路径引（第 12、68 行），所以整目录搬到任何子路径下都能跑。

---

## 六、难度与量纲是怎么量出来的

3×3 的量纲来自穷举，不来自调参。本轮重建全表读数：可达态 **181440**（= 9!/2）、直径 **31**、深度 31 的板恰 **2** 个、深度 30 的板 **221** 个，建表本身没有任何断言钉着耗时，`DESIGN.md` §2 记过一次读数，本文不记毫秒；机器是 `Darwin 25.6.0 arm64`、node v26.8.1。完整直方图（深度 0..31）本轮实测与 `test/bfs3.test.mjs:11-15` 手抄的那 32 个数逐位相同：

```
1 2 4 8 16 20 39 62 116 152 286 396 748 1024 1893 2512
4485 5638 9529 10878 16993 17110 23952 20224 24047 15578 14560 6274 3910 760 221 2
```

最远的两块也在测试里点名钉住（`bfs3.test.mjs:82-89`）：`6,4,7,8,5,0,3,2,1` 与 `8,6,7,2,5,4,3,0,1`。本轮用 `js/core/solve.js` 对这两块各求一次解，两次都返回 `moves = 31`、`ok = true`，展开节点 14450 与 12226——即"直径 31 不只是个约数，就是这两块到"。

生成器有两条路线（`js/core/make.js`）：`walkScramble`（21-37）从目标态做随机游走打乱，永远留在可达分量内；`permScramble`（39-44）是整盘洗牌，一半会掉进死空间。每档给出两个夹逼窗口（`BANDS`，54-62）：游走步数带与实测 par 带，另有各自的节点/时间预算；`makeAttempt`（74-102）把每次失败归类计数。烤制时每条落盘前还要反序列化重解重放一遍（`tools/bake.mjs:55-62`）。

本轮把整仓拷到仓库外的副本、按缺省 `PER_BAND=8` 重跑了一次烤制（真仓的 `js/data/lots.js` 一个字节未动），下表七个整数列 `got / pars / accept / tooEasy / tooHard / unsolv / trunc / dup / nodesMax` 与打印逐格相同（`node tools/bake.mjs` 的原样尾行是 `wrote 56 boards (3x3:32 4x4:24) -> js/data/lots.js` 与 `parity check on the shipped file: 0 unsolvable rows (inversions of the first row: 2)`），交回的接受率账目见下表。口径说明：`accept` 是 `bake.mjs:94` 的 `keep/attempts`，`attempts` 取 `bake.mjs:86`；bake 自己打印的那张表不带 `attempts` 列，所以下表这一列是本轮按同一账目（同样的种子串 `bake-<band>-<s>`、同样的 `tries: 60`、同样的去重闸）复刻计数得到的，它与打印列自洽（kerb 是 9/15 = 60.0%，siege 是 8/51 = 15.7%）。注意 `kerb` 的 `keep` 记到 9 而实际落盘 8 行，因为第 9 条被上一行的去重闸拦下，表里的 `dup` 就是它：

| 档 | 边长 | par 窗口 | 落盘 | 实测 par 区间 | attempts | 接受率 | 拒绝分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kerb | 3 | 2-8 | 8 | 4-8 | 15 | 60.0% | tooHard 6, dup 1 |
| cross | 3 | 9-16 | 8 | 9-16 | 13 | 61.5% | tooHard 5 |
| deep | 3 | 17-24 | 8 | 18-23 | 10 | 80.0% | tooHard 2 |
| abyss | 3 | 25-31 | 8 | 25-28 | 31 | 25.8% | tooEasy 23 |
| field | 4 | 12-24 | 8 | 16-23 | 11 | 72.7% | tooHard 3 |
| wall | 4 | 25-36 | 8 | 27-36 | 15 | 53.3% | tooHard 6, truncated 1 |
| siege | 4 | 37-50 | 8 | 38-45 | 51 | 15.7% | tooEasy 11, truncated 32 |

同一次烤制还带一份纯洗牌的普查（200 次尝试，`bake.mjs:111-122`）：落进 cross 窗口的只有 **6** 个（接受率 3.0%），`unsolvable` **95**，`tooHard` **99**（6 + 95 + 99 = 200，账是平的）。这就是主力路线选随机游走、洗牌只当反例的可量化理由。

这份账目与 `DESIGN.md` §9.1 里那张表逐项对得上：七个档的 `got / pars / accept / tooEasy / tooHard / unsolv / trunc / dup` 全同（siege 是 `11 / 0 / 0 / 32 / 0`，abyss 是 `23 / 0 / 0 / 0 / 0`），只有 `msMed / msMax` 两列随机器漂移（DESIGN 记的是 siege 17/99、wall 5/90，本轮这次烤出来是 siege 10/56、wall 2/52）。也就是说难度账目是可复现的，耗时账目不是——这也是第八节不把 `ms` 当承诺的原因。

但同节**结论 1 的那句散文与它自己那张表对不上**：它写"130 次尝试里 tooEasy 11、搜索超预算被丢弃 32、重复盘 17"，而表里 siege 的 `dup` 是 0、账目也只闭合到 51（11 + 32 + 8 = 51，与 `accept 15.7% = 8/51` 同一条等式）。本轮实测支持那张表，不支持这句散文；本仓因此只在上面那张表里记 siege 的尝试数。

出厂池子的实测口径（本轮直接调 `js/core/library.js` 的 `stats()`）：56 行、每档 8 行，`3x3:32 4x4:24`；par 区间与上表"实测 par 区间"一列一致；各档求解节点峰值 `kerb 23 / cross 405 / deep 4144 / abyss 10253 / field 375 / wall 315864 / siege 350549`。

可重复性用差分验过（本轮重烤的那一份）：把每行的 `ms` 归一化之后，重烤文件与出厂 `js/data/lots.js` **逐字节相同**；不归一化时有 20 行不同，且差异全部落在 `ms` 上。也就是 `id / band / n / state / par / path / nodes / seed` 与 `TIERS_META` 一个都没动。也就是说盘面与解路径由种子完全决定（`js/core/rng.js` 的 `hashSeed` + `mulberry32`），只有耗时不决定——所以 `ms` 是构建期读数，不该被当成性能承诺。

页面给玩家的量纲只有一个：`js/main.js:140-147` 的读盘显示"已滑 / 最少 / 超出 / 最佳 / 在位 / 盘面"，其中 `overPar = Math.max(0, moves - par)`（`main.js:125-127`）。计费只发生在 `commit()` 一处（`main.js:225-240`），鼠标拖拽与点击走同一阈值 `cell * 0.34`（`js/view.js:216, 231-232`）。

---

## 七、端口与 URL 形态

`tools/verify.sh:24-27` 定死了这一仓的端口：`CDP_PORT=${CDP_PORT:-9352}`、`WEB_PORT=${WEB_PORT:-5192}`、`BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}`、截图目录默认 `/tmp/slide15`。选这两个号是避让同族仓的：脚本头 14-17 行列出兄弟仓占位（gridlock :5180/:9340、nine-rings :5181/:9341、批量闸 :5185-5191 / :9345-9351），并解释了撞端口会读出假判定，所以 42-52 行先做端口预检，CDP 被占 `exit 5`（第 46 行）、WEB 被占 `exit 6`（第 51 行），53-58 行还会警告残留 Chrome。开发端口 `5193` 只出现在 `npm run dev`，与闸门的 5192 分开。

浏览器闸实际跑的 URL 形状只有一种：本地根 `http://127.0.0.1:5192/`。`verify.sh:26` 允许用 `BASE_URL` 覆盖，但 `.github/workflows/ci.yml:35-46` 的 browser job 只在 `env` 里设了 `SKIP_UNIT: 1` 与 `WD_TIMEOUT: 240`（第 44-45 行），没设 `BASE_URL`，所以 **CI 覆盖的是"本机根路径"这一种形状**。页面内部的 hash 形态是另一回事：`js/main.js:57-64` 认四条路由（`#/daily`、`#/random/<band>/<key>`、`#/lot/<id>`、`#/c/<n>`），routes 场景把这四条都走了一遍并带边界——`#/c/99999` 夹到最后一关、`#/c/0` 夹到第一关、裸 `#/random` 要自己造 token、`#/lot/not-a-real-board` 与 `#/nonsense` 是非法输入（`tools/playtest.mjs:740-799`）。这些走的都是同一个本地根文档，跟部署前缀无关。

子路径前缀形态（GitHub Pages 上的 `/…/` 前缀）不由本仓任何闸门覆盖，本仓文档里也没有写出发布 URL 的那一行，所以线上那一侧留空。仓内这一侧本轮可复算：`shasum -a 256 js/data/lots.js` 交出 `7c074d2b492aa9f37d09bc1909faecc8b82748399844dc333419742e1172b4bc`；`pages.yml:29-31` 只拷 `index.html css/ js/`，因此部署产物里不可能有 `tools/` 与 `test/`。上一轮曾对线上抓过一次同样的哈希并读到 `tools/verify.sh` 404，那是 curl 观察、URL 没记进文档，**本轮无法复算，别当测试读**。

---

## 八、不承诺什么

- **不承诺浏览器闸的断言条数。** `verify.sh:141-167` 只解析 `rows: / fail:` 两数并让 `fail` 决定成败，没有任何行数或断数下限；第四节里 135 那个数是源码里 `rec()` 书写点静态数出来的（本轮逐段重数过：boot 21 / play 25 / routes 21 / save 17 / reloaded 7 / pointer 44），本轮没执行 `tools/verify.sh`——这台机器的浏览器台架被另一个仓的 headless Chrome 占着。要说清差别：本仓脚本**会警告**残留 Chrome（`verify.sh:53-58` 的 `pgrep -f remote-debugging-port`），但那只是一条警告，`IGNORE_ORPHANS=1` 还能整段跳过，挡不住的是台架纪律而不是一道红闸。因此本轮没有任何浏览器层实测读数可以交给你，`deliverable.md` 里那个 138 也没被复现或反驳。
- **不承诺任何计时数字。** 求解预算是 `js/core/solve.js:21-22` 的 `NODE_LIMIT = 400000` / `TIME_LIMIT_MS = 2000`，`ms` 字段只在烤制期产生，重烤一次就只有它变；建表耗时与套件耗时都是本机单次读数，没有任何断言钉着，机器负载高时会飘，所以本文一处都不引它们的原值。
- **不承诺 4×4 以上的 par 有独立真值来源。** 只有 3×3 被穷举全量对账过（`bfs3.js:22` 的 `MAX_SIDE = 3`，且 `bfs3.test.mjs:65-70` 主动断言 4×4 全量请求被拒）；`field / wall / siege` 三档的 24 关靠 IDA\* 自证加烤制期重解复现，没有第二套算法交叉验证。
- **不承诺 IDA\* 永远给得出答案。** 超预算返回 `{ok:false, moves:-1, truncated:true}`，出厂池子里 `wall` 与 `siege` 的节点峰值已达 315864 / 350549（本轮实测），离 400000 的上限很近；烤制账目里 `siege` 的 51 次尝试有 32 次是被 `truncated` 拒掉的。页面提示用的预算更窄（`js/main.js:35` 的 150000 节点 / 600 ms），拿不到答案时按 `main.js:342` 明说拿不到。
- **不承诺刷新后存档一定还在。** `localStorage` 抛错时整套状态退到内存后备（`js/core/storage.js:13-21`），刷新即丢；`test/storage.test.mjs` 测的正是这条退化路径。不承诺跨设备/云同步，也不承诺别人的存档能被本仓读取——键名写死为单一版本 `slide15.save.v1`（同文件 11 行）。
- **不承诺真机触屏行为。** 指针场景（`playtest.mjs:287-575`）是桌面 Chrome 上用 `Input.dispatchMouseEvent` 模拟的（同文件 55-57 行），只有 `css/game.css:43` 的 `touch-action: none` 与 `user-select: none`（26 行）是为触屏准备的；没有移动设备闸门。
- **不承诺键盘覆盖了全部操作。** `js/main.js:445-465` 只绑了 `u / h / r / d`、四个方向键与一个收起结算卡的 `escape`，且方向键是按"这块数字自己往哪走"命名的（与玩家"把空位挪过去"的直觉相反，这是代码注释里写明的口径）；没有无障碍标注体系，也没有多语言。
- **不承诺控制台干净到任意噪声都能检出。** `verify.sh:174-177` 的 grep 是枚举式的（`[EXCEPTION]`、`[log:*]`、`[error]`、`[warning]`），没被这几个标签包起来的异常不会被这一条抓到；`verify.sh:185-188` 那段收尾的 `logs` 全量转储是先打印再判定。
- **不承诺部署后仍可跑测试。** `pages.yml` 没有测试步（构建步只有 29-31 行的 `mkdir` + 两次 `cp`），产物也不含 `test/` 与 `tools/`；线上子路径前缀形态没有任何本仓闸门（见第七节）。
- **不承诺"零依赖"这件事在任意 node 版本上都免费。** CI 两个 job 都把 `node-version` 钉在 22（`ci.yml:26` 与 `:41`），本轮本机跑在 v26.8.1（`Darwin 25.6.0 arm64`）上全绿；更低的版本没测过，而 `tools/playtest.mjs` 直接用了 node 的全局 `WebSocket` 与 `fetch`，缺这两样的运行时跑不了浏览器闸。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可能住在清单里而不是盘上的 `.png`
  （有的仓另有一条"零二进制文件"的承诺，那条只约束"有没有 .png 这个文件"）；如果 P 段只筛文件名，
  声明写 512 而真图 192 就一路放行。
- **钉住两个数**：R 段实际检查的路径条数（`32`）与这一次跑的断言条数（`50`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字，也不写别仓文档闸的编号：有的仓的文档闸会拿"文档里出现过的同名标识号"回数它
  自己的条数，还有的会把文档里点到的每个组编号逐个核对"这一轮真的发过"——两道闸共用一个名字，
  或者在本仓的文档里出现一个本仓没有的组编号，打红的都是不相干的那一边。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`32`、断言仍然 `50`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；把它们接进本仓
那条浏览器 one-shot（`tools/verify.sh`）还欠着——那道脚本的腿名单与条数钉是每个仓自己的形状。

