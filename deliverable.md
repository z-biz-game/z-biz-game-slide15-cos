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
