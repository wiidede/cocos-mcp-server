# MCP 公开工具与 Action 整理计划

## 目标

本计划用于整理 `tools/list` 暴露给模型的公开 API。目标不是机械重命名，而是降低首次工具选择和首次参数调用的歧义：

1. 每项能力只有一个主要公开入口。
2. 不可用、仅兼容或必然失败的工具不进入 `tools/list`。
3. 工具名统一表达“领域 + 职责”，不暴露 Cocos Editor IPC 命名。
4. Action 使用稳定的语义词汇，使模型在未记住完整枚举时仍能合理推断。
5. 公开 schema、ActionSpec、路由、实现、错误提示、示例和测试始终一致。

当前版本没有外部兼容负担。本轮允许直接删除或重命名公开工具和 action，不长期保留别名。底层 legacy executor 名称可以保持不变，由 `UnifiedTools` 完成映射。

## 执行状态

截至本次规范化实现：

- Phase 1、Phase 2、Phase 3 和 Phase 4 已完成。
- 公开工具共 45 个；工具数不是硬指标，本轮未为降低数量强行合并职责清晰的工具。
- `scene_view_control` 与 `scene_view_query` 保留为两个工具，避免单个 schema 包含 20 个 action；两者的 action 已统一为 `get_*` / `set_*`。
- `project_manage.refresh_assets` 已迁移为 `asset_lifecycle.refresh`，规范化后的 `project_query` 只负责项目信息和设置。
- 节点树读取已统一到 `scene_hierarchy.get_tree`，支持 `rootUuid`、`maxDepth` 和 `includeComponents`；`debug_scene.get_node_tree` 已删除。
- Prefab 恢复已统一到 `prefab_instance.restore`；语义和实现重复的 `restore_node` 已删除。
- `query_path`、`query_uuid`、`query_url` 已删除，`asset_query.resolve_identity` 是唯一身份转换入口。
- 公开 registry 中已不存在 unsupported ActionSpec；内部 legacy executor 名称保持不变。

## 范围

涉及：

- `source/tools/unified-tools.ts` 中的公开工具注册、ActionSpec、schema 和路由。
- `source/tools/*.ts` 中确实需要同步的执行接口。
- `source/tools/unified-tools.test.ts`、MCP 协议测试和 Dev Test regressions。
- `TOOLS.md` 中稳定调用原则和工作流示例。
- `tools/list`、`tool_registry.list/list_actions/describe` 和契约错误中的公开名称。

不涉及：

- 为保持内部实现可读性而无必要地重命名底层 Cocos IPC method。
- 兼容未发布或无人使用的旧公开 action。
- 将所有工具合并成少数超大工具。

## 命名规范

### Tool 名称

统一采用：

```text
<domain>_<capability>
```

`domain` 使用稳定业务名：

```text
scene, node, component, prefab, asset, project, debug, preferences,
server, broadcast, reference_image, validation, tool
```

`capability` 使用明确职责：

```text
query, lifecycle, hierarchy, transform, property, clipboard, reference,
execution, snapshot, undo, view, event, catalog, instance, edit, batch,
meta, analyze, build, runtime, console, logs, performance, network,
control, registry
```

约束：

- 不新增 `manage`、`management`、`advanced`、`available`、`browse` 等宽泛职责词。
- 工具名不描述底层实现方式，例如 Editor Message 名称。
- 同一能力不得因为路由方便而出现在多个公开工具中。
- 没有 supported action 的工具不得进入 `tools/list`。
- 工具 description 必须列出 action，但不能依赖 description 弥补含糊命名。

### Action 名称

Action 使用 `snake_case`，按语义统一：

| 语义                   | 规范              | 示例                                  |
| ---------------------- | ----------------- | ------------------------------------- |
| 获取单个对象或完整状态 | `get` / `get_*`   | `get`, `get_status`, `get_settings`   |
| 获取集合               | `list` / `list_*` | `list`, `list_ips`, `list_components` |
| 条件搜索               | `find` / `find_*` | `find`, `find_by_name`                |
| 布尔检查               | `check_*`         | `check_ready`, `check_dirty`          |
| 写入属性               | `set` / `set_*`   | `set`, `set_position`                 |
| 生命周期               | 明确动词          | `create`, `delete`, `open`, `close`   |
| 流程控制               | 明确动词          | `start`, `stop`, `refresh`, `abort`   |
| 关系查询               | 明确关系          | `nodes_by_asset_uuid`, `dependencies` |

约束：

- Action 不重复 tool 已表达的 domain/capability：`node_lifecycle.create`，不是 `create_node`。
- 禁止名词和动词混用来表达同类读取，例如同一 API 同时出现 `status`、`get_status`、`query_status`。
- `query_*` 不用于简单读取或布尔检查；分别改为 `get_*`、`list_*`、`find_*` 或 `check_*`。
- `*_list` 改为 `list_*`。
- 输入到输出方向必须明确；禁止 `query_url` 这类无法判断按 URL 查询还是返回 URL 的名称。
- 同一工具中的同义 action 只保留一个，例如 `component_property.set` 与 `set_property` 只保留 `set`。

## 重复能力归属

### 节点剪贴板

目标归属：

```text
node_hierarchy.move
node_clipboard.copy
node_clipboard.paste
node_clipboard.cut
```

从 `node_hierarchy` 移除 `copy/paste/cut`。`node_hierarchy` 只负责父子关系和顺序。

### 根据资源 UUID 查找节点

目标唯一入口：

```text
resource_reference.nodes_by_asset_uuid
```

从以下工具移除重复入口：

```text
scene_query.nodes_by_asset_uuid
node_reference.nodes_by_asset_uuid
prefab_reference.nodes_by_asset_uuid
```

如果 `node_reference` 和 `prefab_reference` 清理后没有独有 supported action，则删除对应公开工具。

### Prefab 恢复

目标归属：

```text
prefab_instance.restore
```

实现核对确认两个旧 action 的参数、底层 `scene/restore-prefab` IPC 和关联验证逻辑相同，因此统一为 `restore`。

从以下公开工具移除重复恢复入口：

```text
scene_execution_control.restore_prefab
node_reference.restore_prefab
prefab_reference.restore_node
```

### 资产引用校验

目标归属：

```text
asset_analyze.validate_references
```

`resource_reference` 只保留跨资源与场景节点的关系查询，不承担校验职责。

### Component 属性写入

目标唯一 action：

```text
component_property.set
```

删除 `set_property`。保留现有参数推断、component UUID 解析和 Inspector 类型处理能力。

## 不可用与兼容工具

### 删除 `debug_execute`

当前工具没有 supported action，调用只会返回任意 JavaScript 不受支持。应从公开注册表和 `tools/list` 删除。安全指导保留在 `TOOLS.md` 和相关错误提示中，引导使用专用工具或已注册 scene script。

### 清理 legacy wrapper

逐项检查只为旧调用保留的公开 wrapper。满足以下任一条件时从 `tools/list` 移除：

- 与新的领域工具完全重复。
- schema 与底层实现需要额外兼容参数才能工作。
- description 明确表示 legacy compatibility。
- 没有独立工作流价值。

底层 executor 可以继续存在，不代表必须公开。

## Tool 迁移表

### Scene

| 当前                      | 目标                                   | 处置                                          |
| ------------------------- | -------------------------------------- | --------------------------------------------- |
| `scene_management`        | `scene_lifecycle`                      | 重命名；保留场景文件生命周期 action           |
| `scene_hierarchy`         | `scene_hierarchy`                      | 保留                                          |
| `scene_execution_control` | `scene_execution`                      | 重命名；迁出 prefab 恢复和状态查询            |
| `scene_snapshot`          | `scene_snapshot`                       | 保留                                          |
| `scene_query`             | `scene_query`                          | 保留；迁出资源引用查询                        |
| `scene_view_control`      | `scene_view`                           | 与 query 工具是否合并在实施时验证             |
| `scene_view_query`        | `scene_view` 或保留 `scene_view_query` | 优先合并为一个 view 工具，action 区分 get/set |
| `scene_undo_manage`       | `scene_undo`                           | 重命名                                        |

目标 action：

```text
scene_lifecycle.get_current/list/open/save/create/save_as/close/soft_reload
scene_execution.execute_component_method/execute_scene_script
scene_query.list_classes/list_components/get_info/check_ready/check_dirty
scene_snapshot.create/abort
scene_undo.begin/end/cancel
scene_view.get_status/get_gizmo_tool/get_gizmo_pivot/get_gizmo_view_mode/
  get_gizmo_coordinate/get_view_mode/get_grid_visible/get_icon_gizmo_3d/
  get_icon_gizmo_size/set_gizmo_tool/set_gizmo_pivot/set_gizmo_coordinate/
  set_view_mode/set_grid_visible/set_icon_gizmo_3d/set_icon_gizmo_size/
  focus_nodes/align_camera_with_view/align_view_with_node/reset
```

合并 `scene_view_control` 与 `scene_view_query` 前检查单工具 action 数和 schema 可读性。如果合并明显增加 discriminator 负担，则保留两个工具，但统一为 `scene_view_query` 和 `scene_view_control`，并统一 get/set action。

### Node

| 当前                       | 目标             | 处置                    |
| -------------------------- | ---------------- | ----------------------- |
| `node_query`               | `node_query`     | 保留                    |
| `node_lifecycle`           | `node_lifecycle` | 保留                    |
| `node_transform`           | `node_transform` | 保留                    |
| `node_hierarchy`           | `node_hierarchy` | 只保留 move/层级能力    |
| `node_clipboard`           | `node_clipboard` | copy/paste/cut 唯一入口 |
| `node_property_management` | `node_property`  | 重命名                  |
| `node_reference`           | 删除             | 能力迁移后删除          |

目标 action：

```text
node_query.get/find/find_by_name/list/check_type
node_lifecycle.create/delete/duplicate
node_transform.set
node_property.set/reset/reset_transform/move_array_element/remove_array_element
node_hierarchy.move
node_clipboard.copy/paste/cut
```

实施时确认 `node_query.get_info -> get`、`get_all -> list`、`detect_type -> check_type` 是否与返回语义一致。

### Component

| 当前                      | 目标                  | 处置                  |
| ------------------------- | --------------------- | --------------------- |
| `component_manage`        | `component_lifecycle` | 重命名                |
| `component_script`        | `component_script`    | 保留                  |
| `component_query`         | `component_query`     | 保留                  |
| `component_property`      | `component_property`  | 保留；合并重复 action |
| `component_event_binding` | `component_event`     | 缩短名称              |
| `component_available`     | `component_catalog`   | 重命名                |

目标 action：

```text
component_lifecycle.add/remove
component_script.attach/detach
component_query.list/get
component_property.set
component_event.list/clear/set/append
component_catalog.list
```

### Prefab

| 当前               | 目标               | 处置                           |
| ------------------ | ------------------ | ------------------------------ |
| `prefab_browse`    | `prefab_query`     | 重命名                         |
| `prefab_lifecycle` | `prefab_lifecycle` | 保留                           |
| `prefab_instance`  | `prefab_instance`  | 作为实例化、撤销和恢复唯一入口 |
| `prefab_edit`      | `prefab_edit`      | 保留                           |
| `prefab_reference` | 删除               | 重复能力迁移后删除             |

目标 action：

```text
prefab_query.list/load/get/validate
prefab_lifecycle.create/duplicate
prefab_instance.instantiate/revert/restore/restore_node
prefab_edit.apply/revert
```

确认 `prefab_edit.update` 的实际语义；若是将实例覆盖应用到资源，改为 `apply` 比 `update` 更明确。

### Asset

| 当前                 | 目标              | 处置                      |
| -------------------- | ----------------- | ------------------------- |
| `asset_manage`       | `asset_lifecycle` | 重命名                    |
| `asset_query`        | `asset_query`     | 保留；删除方向含糊 action |
| `asset_analyze`      | `asset_analyze`   | 保留并接管引用校验        |
| `asset_batch`        | `asset_batch`     | 保留                      |
| `asset_meta`         | `asset_meta`      | 保留                      |
| `resource_reference` | `asset_reference` | 重命名；只负责关系查询    |

目标 action：

```text
asset_lifecycle.import/create/copy/move/delete/save/reimport/open_external/
  create_default_spriteframe
asset_query.resolve_identity/get/list/find_by_name/get_details/
  generate_available_url/check_database_ready
asset_analyze.validate_references
asset_batch.import/delete/export_manifest
asset_meta.save
asset_reference.nodes_by_asset_uuid
```

优先删除：

```text
query_path
query_uuid
query_url
```

`resolve_identity` 应成为 URL、UUID、文件系统路径转换的唯一入口。若确有单向查询性能需求，使用明确名称：

```text
get_path_by_uuid
get_uuid_by_url
get_url_by_uuid
```

### Project、Debug 与 Server

| 当前                   | 目标                | 处置                                                                 |
| ---------------------- | ------------------- | -------------------------------------------------------------------- |
| `project_manage`       | `project_query`     | 只保留 info/settings；refresh 迁入 asset lifecycle 或保留明确 action |
| `project_build_system` | `project_build`     | 缩短名称                                                             |
| `project_runtime`      | `project_runtime`   | 保留                                                                 |
| `debug_console`        | `debug_console`     | 保留                                                                 |
| `debug_logs`           | `debug_logs`        | 保留                                                                 |
| `debug_execute`        | 删除                | 无 supported action                                                  |
| `debug_scene`          | `debug_scene`       | 保留；评估 node tree 是否应迁到 scene hierarchy                      |
| `debug_performance`    | `debug_performance` | 保留                                                                 |
| `server_info`          | `server_status`     | 重命名                                                               |
| `server_network`       | `server_network`    | 保留                                                                 |
| `server_control`       | `server_control`    | 保留                                                                 |

目标 action：

```text
project_query.get_info/get_settings
project_build.build/get_settings/open_panel/check_status
project_runtime.run
debug_console.get/clear
debug_logs.get/get_file_info/search
debug_scene.validate/get_editor_info
debug_performance.get_stats
server_status.get_status/get_port/list_ips
server_network.check_connectivity/list_interfaces
server_control.get_health/get_settings/list_available_tools
```

`project_manage.refresh_assets` 已确认调用 AssetDB refresh，并迁为：

```text
asset_lifecycle.refresh
```

### 其他工具

| 当前                     | 目标                | 处置     |
| ------------------------ | ------------------- | -------- |
| `preferences_manage`     | `preferences`       | 重命名   |
| `broadcast_message`      | `broadcast`         | 缩短名称 |
| `reference_image_manage` | `reference_image`   | 重命名   |
| `validation_params`      | `validation_params` | 保留     |
| `tool_registry`          | `tool_registry`     | 保留     |

目标 action：

```text
preferences.open/get/set/list/reset/export
broadcast.get_log/listen/stop/clear_log/list_active_listeners
reference_image.add/remove/switch/set_data/get_config/get_current/refresh/
  set_position/set_scale/set_opacity/list/clear
validation_params.validate_json/sanitize_string/format_request
tool_registry.list/describe/list_actions
```

实施时确认 `safe_string` 是校验、转义还是清理，再决定是否改为 `sanitize_string`；不得只根据名字修改语义。

## 目标规模

当前公开工具数为 48。完成重复能力合并和不可用工具移除后，预计减少到约 38-42 个。

工具数量不是硬指标。验收重点是：

- 无重复公开入口。
- 每个工具职责可由名称和一句 description 解释。
- 单工具 action 数量仍能被 schema 清晰表达。
- 不为了减少数量而制造新的超大工具。

## 实施阶段

### Phase 0：建立基线

1. 从 `UnifiedTools.getTools()` 生成机器可读的 tool/action 清单。
2. 保存当前 48 个工具、supported action、required properties 和 example。
3. 为每个 supported action 建立 schema 与 dispatch 一致性测试。
4. 将 `docs/session-error-report-2026-07-28.md` 中的代表错误整理为重放 fixture。

验收：可以自动比较改名前后的公开契约，不依赖人工阅读长文件。

### Phase 1：删除噪声与重复能力

1. 删除 `debug_execute` 公开工具。
2. 将剪贴板操作唯一归属到 `node_clipboard`。
3. 将 `nodes_by_asset_uuid` 唯一归属到资源引用工具。
4. 将 prefab 恢复唯一归属到 `prefab_instance`。
5. 将引用校验唯一归属到 `asset_analyze`。
6. 删除清空后没有独有 action 的 `node_reference`、`prefab_reference`。

验收：registry 中不存在重复能力；删除的工具和 action 调用返回稳定契约错误，并指向新的唯一入口。

### Phase 2：统一 Action

1. 先修改查询类 action：`get/list/find/check`。
2. 删除同义 action 和含糊方向 action。
3. 再统一写操作与流程 action。
4. 同步 ActionSpec、schema、route map、example、error metadata 和 `TOOLS.md`。
5. 不保留旧 action alias。

验收：

- 公开 action 不再使用简单读取含义的 `query_*`。
- 不存在 `*_list`。
- 不存在同工具内的同义 action。
- 每个 action example 均通过公开 contract guard 并到达正确 executor。

### Phase 3：重命名 Tool

1. 按迁移表修改公开 tool name。
2. 底层 legacy executor 名保持不变。
3. 同步工具描述、路由、错误提示、测试和文档。
4. 检查 Cocos Dev Test Panel 是否硬编码旧公开名称。

验收：所有工具符合 `<domain>_<capability>`，且 registry、`tools/list` 和实际 dispatcher 使用同一名称。

### Phase 4：职责调整与可选合并

1. `scene_view_control` 与 `scene_view_query` 保持拆分，避免制造约 20 个 action 的超大工具。
2. 资源刷新归属 `asset_lifecycle.refresh`。
3. 节点树读取归属 `scene_hierarchy.get_tree`；删除重复的 `debug_scene.get_node_tree`。
4. Prefab 恢复只保留 `prefab_instance.restore`；删除参数、IPC 和成功判定均重复的 `restore_node`。

这些决定以 schema 清晰度和实际 Cocos 能力为依据，不以减少工具数量为唯一目的。

### Phase 5：集成验证

每个 phase 完成后运行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

扩展重载后通过 MCP extension 验证：

1. `tools/list` 能返回目标工具集。
2. `tool_registry.list/actions/describe` 与 `tools/list` 一致。
3. 对每个领域至少执行一次只读调用。
4. 执行节点、组件、Prefab、资产各一个完整“先查询再写入”工作流。
5. 重放 session error report 的代表调用，记录首次调用成功率和一次纠错成功率。

## 自动约束

新增公开 API lint/contract 测试：

- tool name 必须匹配 `^[a-z]+(?:_[a-z]+)*$`。
- action 必须匹配 `^[a-z]+(?:_[a-z]+)*$`。
- 禁止清单：`management`、`advanced`、`available` 作为 capability；简单读取 action 使用 `query_*`；action 使用 `*_list`。
- 每个公开工具至少有一个 supported action。
- 每个 ActionSpec 名称在路由中恰好存在一次。
- 每个路由 action 在 ActionSpec 中恰好存在一次。
- 每个 example 只能包含该 action 允许的字段，并包含所有 required 字段。
- `tool_registry` 输出与实际公开定义一致。
- 重复能力清单为空。

对确有合理例外的名称使用显式 allowlist，并在测试旁说明语义原因，不能静默放宽规则。

## 文档更新原则

`TOOLS.md` 继续只记录稳定调用规则和常见工作流，不复制完整参数表。完整 action 和参数以 `tools/list` 与 `tool_registry.describe` 为准。

工具重命名完成后更新：

- 常用入口。
- 工作流中的 tool/action 名称。
- 错误恢复示例。
- “不要猜 action”的指导。

历史错误报告保留原始名称，避免破坏审计证据；在报告顶部链接本计划和最终迁移结果。

## 完成标准

全部满足后视为完成：

1. 不可用公开工具为零。
2. 重复公开能力为零。
3. 公开 tool/action 符合统一命名规范，例外均有说明。
4. schema、ActionSpec、route、executor 参数和示例无矛盾。
5. 所有 supported action 都有 contract 测试。
6. MCP extension 新会话可以发现并调用重命名后的工具。
7. 代表性工作流首次调用不再依赖猜测 `status/get_status/query_status` 等同义词。
8. 同一错误参数最多经过一次服务器提示即可修正，不重复提交相同非法调用。
