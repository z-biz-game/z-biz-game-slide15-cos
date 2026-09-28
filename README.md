# 滑痕 · SLIDE15

一个把"难"写成数字的 15 数字推盘。盘面只有两种尺寸（3×3 与 4×4），
但每一条关卡的 `par` 都不是估的：3×3 的全部可达状态被穷举过，4×4 的每一关都被 IDA* 从
序列化局面重新解一遍，解不出来就不入库。

## 玩法

点（或拖）与空格相邻的一块，把它滑进空格；把整盘按目标顺序复原。
`slide15` 的界面给了三条常驻信息：已走步数、这一关的最少步数 `par`、以及一条提示线。
- 数字与空格的换位只算一步；
- 走满 `par` 且不多一步 = 三星；
- 每一关都带一条被验证过的认证路径 `path`，可以用来复核"这个 par 真的能做到"。

## 难度是怎么被量出来的

这是本仓的核心主张：**难度是测量结果，不是形容词**。

- **3×3（`kerb` 起手 / `cross` 熟盘 / `deep` 深盘 / `abyss` 绝境）**
  以目标态为源做一次穷举 BFS，得到整张可达图：
  - 可达局面 **181,440**（恰为 9!/2，另一半是奇排列，永远推不到）；
  - 图的**直径 31**，即 3×3 上最难的盘也只要 31 步；
  - 距离直方图 `1,2,4,8,16,20,39,62,116,152,286,396,748,1024,1893,2512,4485,5638,9529,10878,16993,17110,23952,20224,24047,15578,14560,6274,3910,760,221,2`
    （下标 = 最少步数），末项 **2** 说明达到直径的盘恰好只有两个（互为镜像的"反装"局面）；
  - 上面这一整块在 115 ms 内跑完，是 `js/core/bfs3.js` 的 `reachableCount/diameter/distanceHistogram/farthestBoards`，
    由 `test/bfs3.test.mjs` 断言。
  所以 3×3 每一关的 `par` 是在这张表上**查**出来的，不是搜出来的。

- **4×4（`field` 方城 / `wall` 石墙 / `siege` 深渊）**
  这里 BFS 不可能：要装下 16!/2 ≈ 10¹³ 个状态不是"常量比较大"，而是根本做不到。
  于是改用 **IDA\***（`js/core/solve.js`），用 `manhattan + linearConflict` 作为可采纳启发
  （`js/core/heur.js`）：内存里只留一条路径，靠迭代加深把最优性拿回来。
  每关的 `par` 旁边还随包发了搜索代价 `nodes` 与 `ms`（例如 `siege-01`：par 38、80,629 个展开节点、19 ms），
  生成器的每条档位都带 `nodeLimit` / `timeLimitMs` 预算，超预算的盘直接不发布。

- **可解性**先于一切：`js/core/parity.js` 用逆序数 + 空格行号判定奇偶，
  不可解的局面在生成阶段就被拒绝，因此玩家永远不会遇到"推不开"的盘。

- **入库复解**：`test/library.test.mjs` 对 56 关里的每一关，从序列化数组重新求解，
  断言结果等于印在包里的 `par`；同时断言 `path.length === par`。也就是说，
  文档里任何一个步数如果与引擎不一致，测试就会红。

## 档位

`js/data/lots.js` 的 `TIERS_META`（每档 8 关，共 56 关）：

| 档位 | 名称 | 盘面 | par 区间 |
| --- | --- | --- | --- |
| kerb | 起手 | 3×3 | 4–8 |
| cross | 熟盘 | 3×3 | 9–16 |
| deep | 深盘 | 3×3 | 18–23 |
| abyss | 绝境 | 3×3 | 25–28 |
| field | 方城 | 4×4 | 16–23 |
| wall | 石墙 | 4×4 | 27–36 |
| siege | 深渊 | 4×4 | 38–45 |

## 本地运行

零依赖、零构建、零二进制资产（`package.json` 的 `dependencies` 是 `{}`）。

```
npm start      # node server.cjs 5192
npm run check  # 逐文件 node --check
npm test       # check + node --test test/
npm run unit   # 单独跑每个 suite
npm run bake   # 重新烤 js/data/lots.js（复解不过就不写盘）
npm run verify # headless Chrome 端到端（含真实鼠标点击与拖拽）
```

## 测试

一条命令跑完两层：`bash tools/verify.sh` —— node **94 条 / 7394 断言** + 浏览器 **138 条**
（真起 headless Chrome、真发鼠标事件），脏 console 计红。

* node 层：10 个 suite（`bfs3 / game / heur / library / make / parity / puzzle / rng / solve / storage`），
  条数 `9 / 13 / 8 / 10 / 8 / 11 / 10 / 7 / 11 / 7`，期望值全部手写死，不从实现读回。
* 浏览器层：`@boot 21 / @play 25 / @routes 27 / @save 17 / @reloaded 7 / @pointer 41`。`@pointer`
  用 `Input.dispatchMouseEvent` 走完认证解，并按 `elementFromPoint` 先确认控件的命中框再按下去
  （页面内改状态不算数，看不见的手指也不算数）。
* 存档退化、确定性、图几何都在 node 层有对应断言，而不是"看一眼觉得没问题"。

## 目录结构

```
js/core/     纯逻辑：puzzle game bfs3 heur parity solve make library storage rng
             （除 storage.js 外不出现 window/document；storage.js 也只在被守卫的环境里读写）
js/data/     lots.js：56 关 + 档位元数据 + 每关的 par/path/nodes/ms/seed
js/view.js   canvas 2D 程序化绘制（无图片素材），devicePixelRatio 感知
js/main.js   DOM 与路由：#/c/<n> #/daily #/random/<band>/<seed> #/lot/<id>，挂 window.slide15
tools/       bake.mjs 烤数据、verify.sh + playtest.mjs 无头浏览器验收、harness.mjs 断言台架
```

## 确定性

`js/core/rng.js` 提供 `hashSeed` + `mulberry32`。`hashSeed` 是 **FNV-1a 派生**的两轮混合：
对每个 UTF-16 code unit 先异或低字节乘一次素数、再异或高字节乘一次，
因此 ASCII 种子的结果**不等于**教科书 FNV-1a（`hashSeed('a')` = 723832900，教科书值为 3826002220）。
`#/daily` 由当天的 `YYYY-MM-DD` 派生，同一日期所有人拿到同一批盘。
