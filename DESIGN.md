# 滑痕 · SLIDE15 — 设计说明

本文件只写**已经在本机复算过**的东西。任何没有跑过的数字都不出现在这里。

## 1. 模型

局面是一个长度为 `n*n` 的整数数组，`0` 表示空格，其余是块号，目标态是 `[1,2,…,n*n-1,0]`。
一次移动由"被滑动的块的下标"唯一确定（`legalTaps` 返回当前可滑的下标集合），
因此认证路径 `path` 就是一串下标，`path.length === par` 是硬性断言。

`blankCell / blankAt / blankRowFromBottom` 把空格位置换成行号，是因为奇偶判定需要它（见 §5）。

## 2. 两种求解器，各自对应一种不可能

3×3 用**穷举 BFS**（`js/core/bfs3.js`）：以目标态为源把 181,440 个可达局面全部展开一次，
存成距离表，配 `rank/unrank` 做排列↔序号的双向映射。
本机实测（`node -e` 直接调用导出函数）：

```
reachableCount()        = 181440
diameter()              = 31
farthestBoards().length = 2
distanceHistogram()     = 1,2,4,8,16,20,39,62,116,152,286,396,748,1024,1893,2512,
                          4485,5638,9529,10878,16993,17110,23952,20224,24047,
                          15578,14560,6274,3910,760,221,2
耗时 115 ms
```

直方图下标即最少步数，末项 2 与 `farthestBoards()` 的 2 个盘互为佐证：直径不是估计值。

4×4 用 **IDA\***（`js/core/solve.js`）。注释里写明了理由：BFS 需要驻留 16!/2 ≈ 10¹³ 个状态，
这不是"常量更大"，而是不可行。IDA* 只在内存里保留当前路径，靠迭代加深的单调性保证最优。
启发函数在 `js/core/heur.js`：`manhattan` 加上 `linearConflict`，两者都可采纳，
因此 f 值不会高估，第一次到达目标 f 的阈值就是最优解长度。

搜索预算是显式的：`solve.js` 有 `nodeLimit`，超限即 `abort='nodes'` 并返回 `Infinity`，
调用方据此**拒绝发布**这一关，而不是把未证实的步数印出去。每关随包发布 `nodes` 与 `ms`
（如 `siege-01`：par 38 / 80,629 节点 / 19 ms），所以"这一关有多贵"也是数据而不是形容词。

## 3. 可解性判定先于生成

`js/core/parity.js` 用逆序数 + 空格所在行号给出奇偶（`inversions / solvable / parityLine`）。
3×3 的可达集恰为 9!/2 正是这条判定的直接体现；不可解的局面根本不会被生成，
玩家不可能拿到推不开的盘。

## 4. 入库即复验

`js/data/lots.js` 的每一关带 `seed`（如 `bake-siege-5#4`）与序列化 `state`。
`test/library.test.mjs` 第 38 行的断言是："重新解每一个已发布局面，结果必须等于印着的 par"，
并且 `par` 必须是 ≥2 的整数、`path` 长度必须等于 `par`。
`tools/bake.mjs` 重新烤数据时走同一套判定——**烤不出来的档位不会写进包里**。
这条链条的意义：README/DESIGN 里任何步数一旦与引擎不一致，测试层立刻变红。

## 5. 视图与交互

`js/view.js` 负责 canvas 2D 的程序化绘制（无图片素材，devicePixelRatio 感知），
对外暴露 `measure / geometry / cellPoint / tilePoint / pointAt / pixels / painted / settled`。
坐标系契约与 lightsout 那次教训一致：`pointAt()` 与 `main.js` 的 `clientX - rect.left`
必须处在同一空间，否则 CDP 点击会命中隔壁格。

`js/main.js` 的路由：`#/c/<n>`、`#/daily`、`#/random/<band>/<seed>`、`#/lot/<id>`，
并挂出 `window.slide15`（含 `window.slide` 别名，按规格要求）。

## 6. 确定性

`hashSeed` + `mulberry32`。`hashSeed` 是 FNV-1a **派生**的两轮 UTF-16 混合，不是教科书 FNV-1a：
`hashSeed('a')` = 723832900，而教科书 FNV-1a 为 3826002220。
测试因此只做自洽断言（同种子两次相等、`>>>0` 落在 32 位内、不同种子分散），不断言任何公开向量。

## 7. 验收台架

`tools/verify.sh` + `tools/playtest.mjs`：原生 CDP，独立 `mktemp -d` profile，
web :5192 / DevTools :9352，启动前检查端口占用与残留 Chrome，
`trap cleanup EXIT` 等待所有后台 PID，导航后用 `waitShell()` 轮询而不是固定 sleep
（固定 sleep 会让 canvas 停在 300×150 造成假故障），结果 JSON 按花括号计数从 console 截取，
支持 `SKIP_UNIT=1`。`@pointer` 段用 `Input.dispatchMouseEvent` 走真实点击与拖拽。
**脏 console 计红**：每段跑完先按 `[EXCEPTION] / [log:*] / [error] / [warning]` 判一次，
结尾把全量重放的 `logs` 打印出来后再判第二次——只看条数会放过一条渲染告警（见 §10）。

图标沿用本仓构建时的**内联 SVG data-URI**写法（不是家族里另一些仓用的 `href="data:,`）；
两种写法都能避免 `/favicon.ico` 请求污染"console 必须干净"的断言，本文件按 index.html 的实际写法记录。

## 8. 已知未验证项（不留空头）

- **真机触摸**：手势经 CDP 合成事件验证，未在真实 touch 设备上验证 `touch-action`。

## 9. 两处曾经的"待裁决"，现在已经落定

### 9.1 档位生成的 acceptance：实测了，15.7% 是真的

以前这里写的是"未实测，上一次会话留下 15.7%，低于契约 20% 下限"。实测的办法不需要冒覆写
`js/data/lots.js` 的风险：把整仓拷到临时目录，在**副本**里跑 `node tools/bake.mjs`。结果（本机，
`PER_BAND=8` 默认值）：

```
band       n  range  got  pars    accept  tooEasy tooHard unsolv trunc  dup  msMed msMax nodesMax
kerb       3  2-8    8    4-8     60.0%    0       6       0      0     1    0     0     23
cross      3  9-16   8    9-16    61.5%    0       5       0      0     0    0     0     405
deep       3  17-24  8    18-23   80.0%    0       2       0      0     0    0     2     4144
abyss      3  25-31  8    25-28   25.8%   23       0       0      0     0    1     2     10253
field      4  12-24  8    16-23   72.7%    0       3       0      0     0    0     1     375
wall       4  25-36  8    27-36   53.3%    0       6       0      1     0    5     90    315864
siege      4  37-50  8    38-45   15.7%   11       0       0     32     0   17     99    350549
```

三点结论：

1. **15.7% 复现到小数位**，它不是转述错误。它的构成写在同一行里：130 次尝试里 tooEasy 11、
   搜索超预算被丢弃 32、重复盘 17，留下 8 个 —— 顶层档本来就稀有，这是设计代价而不是缺陷。
2. **发布条件是 `got == 8`，七档全满**，acceptance 是诊断量不是门槛；`truncated` 的盘一个都没进包
   （`solve.js` 超预算返回 `Infinity`，`make.js` 直接丢弃）。
3. **所谓"20% 契约下限"在本工作区里找不到出处**：`z-biz-game-lead/` 全量检索没有 slide15 的需求
   文档，也没有任何脚本或规范写过这个数（家族里唯一关于接受率的文字是 gridlock 描述自己顶档的
   "三成"）。所以这不是"改门槛凑数"，而是把一句无源的口径换成实测数字。若那条契约确实存在于本仓
   之外，现在对比用的数字已经在账上了。

同一轮还测了一件更要紧的事：**副本里重新烤出来的 56 关与随包发布的那一份逐字段相同**
（`id / band / n / par / state` 全部一致，只有 `ms` 计时不同），即 `js/data/lots.js` 是可复现产物，
不是手改出来的。

### 9.2 Electron：不带，理由写在账上

本仓没有 `electron/main.cjs`，这是决定而不是遗漏：

* 家族 84 个 `-cos` 仓里 48 个带、36 个不带 —— 它是常见做法，不是统一规范；
* 本工作区没有任何门禁要求它。唯一在代码里出现这个路径的是 `z-biz-game-slither-cos/tools/check.mjs`，
  那里它属于 `EXTRA_JS`——"如果存在就顺带 `node --check`"的可选清单，缺文件不报错；
* 本仓的 `npm run check`、`.github/workflows/*`、`tools/verify.sh` 都没提过 electron；
* `dependencies` / `devDependencies` 都是 `{}`，所以补一个壳只会被语法检查一遍、永远跑不起来。

第三条 deliverable 的原则没有变：不为通过某个门禁塞一个永不启动的死文件。要真做桌面端，那是一次
带依赖、带打包配置、带冒烟运行的独立改动，不是上线前的顺手补票。

## 10. 2026-09-28 首次跑绿的事后账（一处产品 bug、三处断言自己写错、两处门禁漏洞）

浏览器门禁第一次全跑时 `@play` 红 1 条、`@pointer` 红 3 条。逐条按实测数字处理后，
node 94 条 / 7394 断言、浏览器 138 条全绿。

**产品 bug（改应用，不是改测试）：分享按钮是死的。** `shareLink()` 写好了、`el.share` 也在
`index.html` 里，但 `js/main.js` 一整串 `addEventListener` 里没有它 —— 点下去什么也没有，
测试只能读到 `toastHidden: true`。补上 `el.share.addEventListener('click', shareLink);`。

**断言写错之一：`超` 字段的算术。** 那条断言写着"两步之后玩家超最少 2 步"，并断言 `over === 2`。
可是 kerb-02 的 par 是 4，而 `overPar()` 是 `Math.max(0, moves - par)`（`js/main.js:125-127`）：
2 滑对 par 4 是**少于**最少，钳在 0。改成断言那个钳值 `over === 0`，同时把"超 2"这件事挪到它
真正成立的地方 —— 6 滑对 par 4 的那一行，并且那里顺手加了 `over === moves - par` 的交叉检查。
这不是放宽：同一条性质还在，只是钉在了算术支持的位置。

**断言写错之二：短拖拽的前提，以及被它连累的两行。** 测试把 0.2 格的位移叫做"不到三分之一格，
所以不该算一步"。但 `js/view.js` 的 `up()` 里，一个按下—松开如果没走过阈值、也没走远，就按
**点击**计费（`// a click: same gate, same cost`），而点击和拖拽同价。所以实测 `moves: 1`。
更糟的是紧随其后的两行："过了三分之一格恰好一步"和"推的是手指下那块"当时是**绿的但什么也没测**：
短拖拽已经把那块推进了空格，第二次拖拽按在同一格上其实是按在空格上，于是计数停在 1、盘面正好
等于短拖拽的结果。现在这三行是：短推按一次计费（并给出 `pushed 38 / threshold 65` 让读者看得见
为什么没触发），然后**真的重开盘**再测长拖拽，且长拖拽的基线盘面、计数、空格位置都从新盘面重读。

**断言写错之三：目标盘的字面量。** `stateArray().join('')` 产出 `"123456780"`，断言里写的却是
`'1,2,3,4,5,6,7,8,0'`（数组的源码形式，`join('')` 永远给不出逗号）。3×3 的目标盘是 1..8 加末尾
空格（`js/core/puzzle.js:22`），照此改正。

**门禁漏洞之一：脏 console 看不见。** 每段的 grep 是 `\[log:error\]|\[error\]|\[warning\]`，
而 `playtest.mjs` 把 `Log.entryAdded` 打成 `[log:warning] …`（渲染类告警走的就是这条路，
Canvas2D 回读提示是家族里踩过的一个）——前缀不同，于是一条页面告警可以一路绿到底。这条 grep 现在
加宽成 `[EXCEPTION]|[log:[a-z]+]|[error]|[warning]`。

**门禁漏洞之二：结尾的 console dump 只印不判。** `node tools/playtest.mjs logs` 是全量重放
`Log.entryAdded` 的地方，恰恰最容易看见东西，但它只是被打印出来。现在它先打印、再用同一条 grep
判定，命中就 `FAILED=1`。（应用侧本来就没这个问题：`js/view.js` 早带了 `willReadFrequently`。）


