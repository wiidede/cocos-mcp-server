# Cocos MCP 输出质量与结果预算优化计划

> 状态：第一批已完成
>
> 目标：减少 MCP 返回对模型上下文的突发占用，保证工具 schema、运行时校验和错误元数据一致，并保留“先查询再修改”的现有工作流。

## 一、当前判断

当前版本已经具备一部分输出控制能力：

- `debug_logs.search` 默认最多返回 20 个匹配。
- `scene_hierarchy.get_tree` 支持 `rootUuid`、`maxDepth`，并且组件默认只返回类型摘要。
- 公开工具使用 action-specific schema，并对未知字段、缺失字段做运行时校验。
- 资源创建已经支持 `overwrite`。

仍然存在的高风险缺口：

- 日志搜索没有字符预算、分页和去重上下文，`totalMatches` 不是完整匹配总数。
- 场景树 schema 中的默认深度没有自动注入执行层，实际调用可能继续返回完整树，也没有节点数上限。
- 资源 `content` 的公开 schema 没有限定类型，模型可以传对象，但底层 IPC 只接受字符串或 `null`。
- MCP 外层直接序列化工具结果，没有最后一道超大结果保护。
- 错误元数据可能完整回显大对象，并且部分资源错误的推荐 action 已经过时。

## 二、实施范围

### P0：日志结果预算

文件：`source/tools/debug-tools.ts`、`source/tools/unified-tools.ts`

- `debug_logs.search` 增加：
  - `maxChars`，默认 12000；
  - `startLine`，从 1 开始；
  - `contextLines` 默认 1；
  - `maxResults` 默认 20，并保留合理上限。
- 合并相邻或重叠的上下文区间，新增去重后的 `contextBlocks`。
- `matches` 保留为匹配行索引，兼容现有调用；上下文以 `contextBlocks` 为主。
- 区分 `matchedTotal`、`returned`、`truncated`、`scanComplete`、`nextStartLine` 和 `chars`。
- 达到输出预算后停止构造返回内容；为得到准确的 `matchedTotal`，继续进行轻量匹配计数。
- 对参数做整数、范围和有限数校验。
- `debug_logs.get` 增加 `maxChars`（默认 12000），按完整行优先保留最新的匹配日志。
- `debug_logs.get` 返回 `returnedLines`、`omittedLines`、`truncated`、`lineTruncated` 和原始 `logFilePath`；完整日志直接在源文件中过滤，不生成重复导出。

### P0：场景树硬限制

文件：`source/tools/scene-hierarchy.ts`、`source/tools/scene-tools.ts`、相关 schema 和测试

- `scene_hierarchy.get_tree` 实际默认 `maxDepth=3`。
- 增加 `maxNodes`，默认 200。
- 在摘要构建期间停止展开超出节点预算的子树，并返回 `truncated: true` 与原始 `childCount`。
- 保留 `rootUuid` 作为定位后下钻的主要方式，不引入复杂分页。
- `includeComponents` 继续只返回组件类型和 enabled；完整属性仍由 `component_query` 单独读取。

### P0：资源内容契约一致性

文件：`source/tools/project-tools.ts`、`source/tools/unified-tools.ts`

- `asset_lifecycle.create` 的 `content` schema 明确支持 `string | object | array | null`。
- 对象和数组进入 Cocos IPC 前统一使用 `JSON.stringify(content, null, 2)`。
- 非法内容类型返回 `TOOL_CONTRACT_ERROR`，而不是 `TOOL_ASSET_ERROR`。
- 错误摘要只回显内容类型和长度，不回显完整大对象。
- 修正资源错误元数据中已经不存在的 action 名称。
- 保留 `overwrite` 语义，不在本轮增加领域专用的关卡写入工具。

### P1：MCP 外层内联预算与自动导出

文件：`source/mcp-server.ts`、测试

- 成功工具结果默认最多内联 64000 个字符。
- 超限时把完整 `ToolResponse` 以格式化 JSON 写入当前项目的 `temp/cocos-mcp-server/exports/`。
- MCP 返回短小的成功摘要，包含绝对路径、项目相对路径、原结果字符数和格式；超限本身不视为工具执行失败。
- 只有序列化、目录创建或文件写入失败时才返回 `TOOL_EXECUTION_ERROR`。
- text content 和 modern `structuredContent` 使用同一个导出摘要，`/api/...` 入口复用相同行为。
- 工具级预算优先于外层预算；外层不对任意数组或对象做盲目截断。
- 暂不增加 `allowLargeResult`；确有内联超大结果需求后再评估。

### P1：会话体积与回归观测

- 单独调查 Pi `pi-dcp-state` 持久化体积；它不属于 Cocos MCP 工具返回，不能靠 MCP 截断解决。
- 为日志预算、场景节点预算、资源序列化和 MCP 超限保护补单元测试。
- 对 Cocos IPC 行为补充 Dev Test regression，确保使用已注册的消息名。
- 在真实项目中观察典型搜索、层级读取和资产写入的返回字符数。

## 三、验收标准

- 日志搜索默认返回不超过约 12000 字符的工具数据，并且相邻命中不重复返回同一上下文行。
- 日志分页可以通过 `nextStartLine` 继续，`matchedTotal` 和 `returned` 不再混淆。
- 未传限制的场景树最多展开 3 层、200 个节点，并明确标记截断。
- JSON 对象可以直接通过 `asset_lifecycle.create` 创建为格式化 JSON 文件；字符串行为保持不变。
- 成功工具结果超过 64000 个字符时，完整 JSON 写入项目 `temp/cocos-mcp-server/exports/`，客户端收到成功摘要和可读取的文件路径。
- 导出文件可以被本地 agent 使用 `rg`、`jq` 或分段读取继续过滤，不进入 `assets/`，也不触发 AssetDB 导入。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `pnpm lint` 通过。

## 四、暂不做的事项

- 不增加面向 `liquid-ray-game` 的 `level_asset_write` 等领域专用工具。
- 不把所有工具统一改造成新的分页协议。
- 不删除现有 `matches`、`rootUuid` 或 `includeComponents` 字段。
- 不在 MCP 外层对任意成功对象做无差别字段截断。
- 不为突破内联预算增加 `allowLargeResult` 参数；超限完整结果通过临时文件交付。
- 不把会话文件中 Pi 的 DCP 状态膨胀归因于 Cocos MCP。

## 五、本轮实施记录

- [x] `debug_logs.search` 增加 `maxChars`、`startLine`、准确匹配统计和去重上下文块。
- [x] `scene_hierarchy.get_tree` 增加实际默认深度和 `maxNodes` 节点预算。
- [x] `asset_lifecycle.create/save` 支持 JSON 对象与数组自动序列化。
- [x] MCP `tools/call` 和 `/api/...` 增加 64000 字符内联预算，超限完整结果自动导出到项目临时目录。
- [x] 更新公共调用规则、单元测试和场景 Dev Test regression。
- [x] `debug_logs.get` 增加工具级字符预算、截断元数据和运行时边界校验。
