# MCP 会话可靠性评估规范

本文规定如何采集、分析和比较 Cocos Creator MCP 的真实调用会话。目标是用稳定口径回答以下问题：

- 模型第一次调用工具时是否使用了正确的 tool、action 和参数；
- 调用失败后，模型是否根据结构化错误完成恢复；
- 哪些错误来自模型或客户端，哪些来自公开契约或服务端实现；
- 一次优化是否真实降低失败率和重复调用，而不只是改进错误文案。

当前基线为 [2026-07-28 会话错误报告](session-error-report-2026-07-28.md)：104 次失败，其中 89 次参数契约错误、11 次资产错误、4 次组件错误。

## 1. 评估原则

1. 使用全新客户端会话，避免客户端缓存旧版 `tools/list`。
2. 重启或重新加载 Cocos MCP 扩展，确认测试版本与预期一致。
3. 尽量使用与基线相近的真实任务复杂度，不只测试单个成功调用。
4. 保存完整 JSONL；不能只保存模型最后回复或人工摘录的错误文本。
5. 通过 `toolCallId` 关联调用参数与结果，不根据相邻行猜测。
6. 将工具契约错误、目标状态错误和服务端缺陷分开统计。
7. 不以“最终任务完成”替代可靠性指标。一个任务可能在大量无效重试后完成。
8. 优化后使用同一统计程序和分类规则复测，避免改变口径制造改善。

## 2. 运行前记录

每次评估先记录以下信息：

| 字段 | 内容 |
| --- | --- |
| 评估编号 | 例如 `mcp-eval-2026-08-01-01` |
| 日期和时间 | 包含时区 |
| Git commit | `git rev-parse HEAD`；有未提交修改时另记 `git diff --stat` |
| 扩展版本 | `server_control.health` 返回的 `version` |
| Cocos Creator 版本 | 例如 `3.8.7` |
| MCP 客户端及版本 | Claude CLI、Pi、IDE 插件等 |
| MCP 协议 | legacy `2024-11-05` 或 modern `2026-07-28` |
| 模型 | 完整模型标识 |
| 会话文件 | JSONL 绝对路径 |
| 项目初始状态 | 当前 scene、关键资产和是否有未保存修改 |
| 任务说明 | 原始提示词或其脱敏版本 |
| `tools/list` 新鲜度 | 是否在扩展重载后开启了全新会话 |

协议版本应根据实际请求判断，而不是根据服务端支持版本判断：

- 调用 `initialize` 且没有 modern metadata：legacy；
- 请求含 `MCP-Protocol-Version: 2026-07-28` 和每请求 `_meta`：modern；
- modern 响应通常包含 `resultType` 和 `structuredContent`。

## 3. 必采数据

### 3.1 调用总量

至少采集：

- MCP 调用总数；
- `cocos-creator` MCP 调用数；
- 成功数；
- 失败数；
- 唯一错误信息数；
- 涉及的 tool 数和 action 数；
- 读操作与写操作数量，如能可靠分类。

推荐主指标：

```text
调用失败率 = 失败调用数 / MCP 调用总数
契约错误率 = TOOL_CONTRACT_ERROR 数 / MCP 调用总数
首次调用成功率 = 首次尝试即成功的操作意图数 / 操作意图总数
```

“操作意图”指模型为完成一个明确步骤发起的一组调用，例如“导入一个资源”或“给节点添加组件”。不能简单把每次 tool call 都视为独立意图。

### 3.2 失败恢复

每次失败还要记录后续发生了什么：

- 是否原参数完全不变地重复调用；
- 是否只修改了无关字段；
- 是否使用 `allowedActions`、`allowedProperties`、`missing` 或 `required` 修正；
- 是否调用了 `metadata.nextTool` / `nextAction`；
- 是否在一次修正后成功；
- 是否经过多次猜测后成功；
- 是否放弃该操作；
- 是否在没有状态变化时反复执行写操作。

推荐指标：

```text
相同失败重复率 = 无状态变化且参数相同的重复失败数 / 失败调用数
一次恢复率 = 失败后下一次相关调用成功的数量 / 可恢复失败数
平均恢复调用数 = 从首次失败到成功所需的后续相关调用数平均值
registry 采用率 = 契约错误后调用 tool_registry 的次数 / 契约错误数
结构化修正率 = 按 attempted/allowed/missing 修正的次数 / 契约错误数
```

### 3.3 工具选择质量

记录以下问题：

- tool 选错；
- action 缺失；
- action 不存在；
- 使用其他 action 的字段；
- 必填字段缺失；
- UUID、URL、文件路径或节点名称身份混淆；
- deprecated action 被继续使用；
- 尝试调用未出现在 `tools/list` 的 tool/action。

按 `tool + action + errorCode` 汇总频次，避免只按错误文本汇总。

### 3.4 服务端质量

重点寻找以下证据：

- 符合公开 schema 的调用仍被执行器判定参数错误；
- supported action 必然返回“未实现”或“不支持”；
- 错误码与真实类别不符；
- `attempted`、`allowedProperties` 或 `allowedActions` 缺失/错误；
- `metadata.nextTool` 指向不存在或不适用的工具；
- 工具报告成功，但场景或资产状态没有改变；
- 工具失败后实际产生了部分写入；
- Editor IPC method 不存在、参数形状错误或超时；
- modern header/body、`structuredContent` 或 HTTP status 不符合协议。

## 4. 错误分类

每个失败只能有一个主要类别，可以额外记录次要原因。

| 类别 | 判断标准 | 典型例子 |
| --- | --- | --- |
| `model_contract` | schema 正确，模型没有按契约调用 | 缺少 action、猜错字段 |
| `client_schema` | 客户端丢失、简化或错误解释 schema | 未向模型呈现 `oneOf` 或 required |
| `server_contract` | tools/list、registry、validator 和 executor 不一致 | schema 要求 `urlOrUUID`，执行器要求 `assetPath` |
| `server_implementation` | 合法调用进入实现后发生代码或 IPC 缺陷 | 使用不存在的 Editor message |
| `target_state` | 节点、组件、场景或资产目标不存在/状态不满足 | 组件没有挂载到目标节点 |
| `asset_readiness` | 资产尚未导入、刷新、编译或注册 | 脚本刚创建但 asset-db 尚不可查 |
| `runtime` | Cocos 编辑器或预览运行时真实错误 | 场景脚本运行异常 |
| `protocol` | MCP transport 或 JSON-RPC 契约错误 | modern header/body 不一致 |
| `unknown` | 证据不足 | 无法关联调用或结果被截断 |

归因顺序：

1. 先检查调用是否符合该次会话实际收到的 `tools/list`。
2. 再检查 registry、validator 与 executor 是否一致。
3. 参数合法时再检查目标状态和 Editor IPC。
4. 不要因为模型最终修正成功，就把第一次服务端契约缺陷归为模型错误。
5. 不要因为错误发生在服务端，就自动归为服务端缺陷；合法的目标不存在仍属于 `target_state`。

## 5. JSONL 提取流程

### 5.1 确认文件

```bash
wc -l /absolute/path/to/session.jsonl
wc -c /absolute/path/to/session.jsonl
```

记录行数和字节数，便于确认后续分析使用的是同一文件。

### 5.2 筛选 Cocos MCP 错误

文本初筛可以使用：

```text
^.*"server":"cocos-creator".*"isError":true.*$
```

正式统计必须解析 JSON，并检查结构化字段，例如：

```text
details.server == "cocos-creator"
details.mcpResult.isError == true
```

字段路径可能随客户端版本变化。分析脚本应先抽样检查真实记录，不应在路径不匹配时静默返回 0。

### 5.3 关联调用

使用错误结果中的 `toolCallId` 找到对应调用，提取：

- tool name；
- arguments；
- result；
- `isError`；
- `errorCode`；
- `data`；
- `metadata`；
- 时间戳或消息顺序；
- 后续相关调用及结果。

关联失败的记录单独列入 `unknown`，不要丢弃。

### 5.4 规范化与去重

建立两种键：

```text
精确调用键 = tool + 规范化 JSON arguments
错误模式键 = tool + action + errorCode + 主要错误类别
```

规范化 JSON 时只排序对象键，不改变数组顺序，不删除 UUID、路径等影响行为的参数。公开报告需要脱敏时，可以额外生成展示副本，但原始统计应保留精确值。

## 6. 报告模板

每轮评估在 `docs/` 下建立报告，例如：

```text
docs/session-evaluation-2026-08-01.md
```

建议结构：

```markdown
# Cocos MCP 会话评估（日期）

## 环境
- commit：
- 扩展版本：
- Cocos Creator：
- MCP 客户端：
- 协议：
- 模型：
- session：
- 任务：

## 摘要
| 指标 | 本轮 | 基线 | 变化 |
| --- | ---: | ---: | ---: |
| Cocos MCP 调用数 | | | |
| 失败数 | | 104 | |
| 失败率 | | | |
| TOOL_CONTRACT_ERROR | | | |
| 相同失败重复数 | | | |
| 一次恢复率 | | | |
| 平均恢复调用数 | | | |

## 错误分类
| 类别 | 数量 | 占比 | 判断 |
| --- | ---: | ---: | --- |

## 按工具统计
| tool | action | 调用数 | 失败数 | 重复失败 | 一次恢复 | 主要原因 |
| --- | --- | ---: | ---: | ---: | ---: | --- |

## 高频错误链路
### 1. 标题
- 首次调用：
- 返回：
- 后续调用：
- 最终结果：
- 归因：
- 是否需要修改代码：

## 服务端缺陷

## 模型或客户端问题

## 与基线对比

## 建议与优先级

## 验收结论
```

## 7. 与基线比较

比较时至少保留三类结论：

### 已消除

满足以下条件之一：

- 原代表调用现在首次成功；
- 原 action 已从 `tools/list` 移除，并且模型没有再尝试调用；
- 原 schema/executor 矛盾有自动化测试覆盖且会话中未复现。

### 已改善但未消除

例如：

- 第一次仍失败，但能根据结构化错误一次修正；
- 重复失败从 12 次下降到 1 次；
- 错误归类正确，但真实目标状态仍导致操作失败。

### 未改善或回归

例如：

- 同一非法参数仍连续重复；
- 模型仍然反复猜 action；
- 新描述增加了 token，但首次成功率没有提高；
- previously supported 调用现在失败；
- 工具数量变化造成新的选择混淆。

不要只比较失败绝对数。任务规模不同时，还应比较失败率、每 100 次调用错误数和每个操作意图的平均调用数。

## 8. 优化准入条件

发现错误后，不应立即增加 alias 或兼容字段。按以下条件决定修改：

### 应修复服务端

- 公开 schema 与执行器不一致；
- supported action 无法完成声明能力；
- 错误码、allowed 或恢复建议不准确；
- 相同错误在多个独立会话中出现；
- 一个安全、自然且无歧义的参数可以明显减少调用步骤。

### 考虑调整工具契约

- 同一 tool/action 猜错在多个会话持续高频出现；
- 客户端明确无法正确呈现当前 `oneOf`；
- 某个高频 action 拆成独立 tool 后能显著简化 schema；
- 重命名或合并不会造成更大的兼容成本。

### 不应通过兼容层掩盖

- 节点、组件或资产真实不存在；
- 模型忽略明确 required 字段；
- 猜测字段只有一次且没有重复证据；
- 兼容会导致多个字段表达同一含义，增加执行歧义；
- 写操作可能因此命中错误目标。

## 9. 验收门槛

一次可靠性优化至少满足：

- `tools/list`、`tool_registry.describe`、validator 与 executor 零已知矛盾；
- supported action example 全部通过公开 dispatcher；
- unsupported action 不出现在公开 schema；
- 同一非法调用在无状态变化时不应重复超过一次；
- 契约错误应包含稳定 `errorCode`、`attempted` 和 allowed/required 信息；
- 原报告中的目标错误链路有代表性 fixture 或 Dev Test regression；
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和 `git diff --check` 通过；
- 真实新会话的失败率、重复率或恢复率至少有一项可量化改善，且没有关键回归。

## 10. 数据安全

会话可能包含：

- 本地绝对路径；
- 项目名称和资产名称；
- 用户提示词；
- 源代码片段；
- token、URL 或环境信息。

原始 JSONL 保留在本地，不直接提交仓库。提交报告前应脱敏用户名、私有项目路径、凭据和非必要业务内容。用于复现的调用参数应保留字段形状，但可以替换 UUID、文件名和目录。

## 11. 下一轮执行清单

- [ ] 重载 `2.0.0` 扩展并确认 `server_control.health.version`。
- [ ] 创建全新 MCP 客户端会话。
- [ ] 记录客户端、模型、协议、commit 和初始场景状态。
- [ ] 执行真实任务，不在运行中人工纠正工具参数，除非任务本身要求。
- [ ] 保存完整 JSONL 路径。
- [ ] 解析全部 Cocos MCP 调用并通过 `toolCallId` 关联。
- [ ] 计算失败率、契约错误率、重复率、一次恢复率和平均恢复调用数。
- [ ] 对照 104 次错误基线标记已消除、已改善和未改善。
- [ ] 为确认的服务端缺陷增加自动化 fixture 或 Dev Test regression。
- [ ] 优化后使用新会话复测，不使用原会话继续追加。
