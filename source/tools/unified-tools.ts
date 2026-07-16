import type { JsonSchema, MCPServerSettings, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { requestScene } from '../editor-message'
import { AssetAdvancedTools } from './asset-advanced-tools'
import { BroadcastTools } from './broadcast-tools'
import { buildButtonClickEvent, getButtonEventFieldName, getButtonEvents } from './component-event'
import { componentMatchesType } from './component-query'
import { ComponentTools } from './component-tools'
import { DebugTools } from './debug-tools'
import { NodeTools } from './node-tools'
import { PrefabTools } from './prefab-tools'
import { PreferencesTools } from './preferences-tools'
import { ProjectTools } from './project-tools'
import { ReferenceImageTools } from './reference-image-tools'
import { SceneAdvancedTools } from './scene-advanced-tools'
import { SceneTools } from './scene-tools'
import { SceneViewTools } from './scene-view-tools'
import { ServerTools } from './server-tools'
import { toolFailure } from './tool-response'
import { ValidationTools } from './validation-tools'

interface ToolInfoProvider {
  getSettings?: () => MCPServerSettings
  getToolDefinitions?: () => ToolDefinition[]
}

type RegisteredTool = ToolDefinition & {
  execute: (args: ToolArguments) => Promise<ToolResponse>
}

type ToolArguments = Record<string, unknown>

type LegacyPrefix
  = | 'sceneAdvanced'
    | 'sceneView'
    | 'referenceImage'
    | 'assetAdvanced'
    | 'validation'
    | 'scene'
    | 'node'
    | 'component'
    | 'prefab'
    | 'project'
    | 'debug'
    | 'preferences'
    | 'server'
    | 'broadcast'

const LEGACY_PREFIXES: LegacyPrefix[] = [
  'sceneAdvanced',
  'sceneView',
  'referenceImage',
  'assetAdvanced',
  'validation',
  'scene',
  'node',
  'component',
  'prefab',
  'project',
  'debug',
  'preferences',
  'server',
  'broadcast',
]

const PROP = {
  string: (description: string, extra: Record<string, unknown> = {}): JsonSchema => ({ type: 'string', description, ...extra }),
  number: (description: string, extra: Record<string, unknown> = {}): JsonSchema => ({ type: 'number', description, ...extra }),
  boolean: (description: string, extra: Record<string, unknown> = {}): JsonSchema => ({ type: 'boolean', description, ...extra }),
  object: (description: string, extra: Record<string, unknown> = {}): JsonSchema => ({ type: 'object', description, ...extra }),
  array: (description: string, items: JsonSchema = { type: 'string' }, extra: Record<string, unknown> = {}): JsonSchema => ({
    type: 'array',
    items,
    description,
    ...extra,
  }),
}

const SHARED_PROPERTIES: Record<string, JsonSchema> = {
  uuid: PROP.string('UUID'),
  undoId: PROP.string('Undo recording ID returned by scene_undo_manage.begin'),
  uuids: {
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
    description: 'Single UUID or UUID list',
  },
  nodeUuid: PROP.string('Node UUID'),
  nodeUuids: PROP.array('Target node UUIDs', { type: 'string' }, { minItems: 1 }),
  parentUuid: PROP.string('Parent node UUID'),
  newParentUuid: PROP.string('New parent node UUID'),
  name: PROP.string('Name'),
  pattern: PROP.string('Search pattern'),
  exactMatch: PROP.boolean('Use exact match', { default: false }),
  includeComponents: PROP.boolean('Include component information', { default: false }),
  includeChildren: PROP.boolean('Include child nodes', { default: true }),
  includeSubAssets: PROP.boolean('Include sub-assets', { default: true }),
  keepWorldTransform: PROP.boolean('Keep world transform', { default: false }),
  unlinkPrefab: PROP.boolean('Unlink prefab after instantiation', { default: false }),
  scenePath: PROP.string('Scene path'),
  sceneName: PROP.string('Scene name'),
  savePath: PROP.string('Save path'),
  path: PROP.string('Path'),
  prefabPath: PROP.string('Prefab path'),
  sourcePrefabPath: PROP.string('Source prefab path'),
  targetPrefabPath: PROP.string('Target prefab path'),
  newPrefabName: PROP.string('New prefab name'),
  assetPath: PROP.string('Asset path'),
  assetUuid: PROP.string('Asset UUID'),
  assetType: PROP.string('Asset type'),
  folder: PROP.string('Folder path or URL'),
  url: PROP.string('Asset URL'),
  urlOrUUID: PROP.string('Asset URL or UUID'),
  content: { description: 'Text or serialized content' },
  source: PROP.string('Source URL'),
  target: PROP.string('Target URL or UUID'),
  sourcePath: PROP.string('Source file path'),
  targetFolder: PROP.string('Target folder'),
  sourceDirectory: PROP.string('Source directory'),
  targetDirectory: PROP.string('Target directory'),
  directory: PROP.string('Directory path or URL'),
  excludeDirectories: PROP.array('Directories to exclude', { type: 'string' }),
  property: PROP.string('Property name'),
  propertyType: PROP.string('Property value type'),
  value: { description: 'Action value' },
  values: PROP.object('Action values object'),
  events: PROP.array('Button click events', { type: 'object' }),
  handler: PROP.string('Handler function name'),
  component: PROP.string('Target component class name'),
  customEventData: PROP.string('Custom event payload'),
  componentType: PROP.string('Component type or cid'),
  scriptPath: PROP.string('Script path'),
  method: PROP.string('Method name'),
  label: PROP.string('User-visible operation label'),
  args: PROP.array('Method arguments', {}),
  tab: PROP.string('Preferences tab or panel tab'),
  category: PROP.string('Category'),
  debug: PROP.boolean('Debug mode', { default: true }),
  timeout: PROP.number('Timeout in milliseconds', { default: 5000 }),
  limit: PROP.number('Result limit', { default: 100 }),
  lines: PROP.number('Number of lines', { default: 100 }),
  filterKeyword: PROP.string('Filter keyword'),
  logLevel: PROP.string('Log level', { default: 'ALL' }),
  script: PROP.string('JavaScript snippet'),
  platform: PROP.string('Platform'),
  type: PROP.string('Type filter'),
  filter: PROP.string('Console or log filter'),
  direction: PROP.string('Dependency direction', { default: 'dependencies' }),
  recursive: PROP.boolean('Include subdirectories', { default: false }),
  overwrite: PROP.boolean('Overwrite existing files', { default: false }),
  format: PROP.string('Format'),
  quality: PROP.number('Quality'),
  maxResults: PROP.number('Maximum results', { default: 20 }),
  contextLines: PROP.number('Context lines', { default: 2 }),
  rootUuid: PROP.string('Root node UUID'),
  maxDepth: PROP.number('Maximum tree depth', { default: 10 }),
  port: PROP.number('Port'),
  visible: PROP.boolean('Visibility flag'),
  includeMetadata: PROP.boolean('Include metadata', { default: true }),
  includeProperties: PROP.boolean('Include full property tree', { default: false }),
  autoCreateCanvas: PROP.boolean('Auto-create a Canvas node after scene is created', { default: false }),
  is2D: PROP.boolean('Whether to use 2D view mode'),
  is3D: PROP.boolean('Whether to use 3D icon mode'),
  size: PROP.number('Size value'),
  opacity: PROP.number('Opacity value'),
  sx: PROP.number('Scale X'),
  sy: PROP.number('Scale Y'),
  x: PROP.number('X value'),
  y: PROP.number('Y value'),
  z: PROP.number('Z value'),
  position: PROP.object('Position object'),
  rotation: PROP.object('Rotation object'),
  scale: PROP.object('Scale object'),
  nodeType: PROP.string('Node type', { enum: ['Node', '2DNode', '3DNode'], default: 'Node' }),
  siblingIndex: PROP.number('Sibling index', { default: -1 }),
  targetNodeUuid: PROP.string('Target node UUID'),
  toolName: PROP.string('Tool name'),
  jsonString: PROP.string('JSON string'),
  expectedSchema: PROP.object('Expected schema'),
  arguments: PROP.object('Tool arguments object'),
  messageType: PROP.string('Broadcast message type'),
  fileFilter: PROP.array('File extension filter', { type: 'string' }),
  exportPath: PROP.string('Export path'),
  importPath: PROP.string('Import path'),
  extends: PROP.string('Base class filter'),
  className: PROP.string('Class name'),
  prefabName: PROP.string('Prefab name'),
  key: PROP.string('Property key'),
  isCurrentOnly: PROP.boolean('Operate on current selection only', { default: false }),
  paths: PROP.array('Path list', { type: 'string' }),
  urls: PROP.array('URL list', { type: 'string' }),
  sceneUUID: PROP.string('Scene UUID'),
  checkMissingAssets: PROP.boolean('Check missing assets', { default: true }),
  checkPerformance: PROP.boolean('Check performance', { default: true }),
}

function pickProps(keys: string[]): Record<string, JsonSchema> {
  const selected: Record<string, JsonSchema> = {}
  for (const key of keys) {
    selected[key] = SHARED_PROPERTIES[key]
  }
  return selected
}

export class UnifiedTools {
  private readonly legacy: Record<LegacyPrefix, ToolExecutor> = {
    scene: new SceneTools(),
    node: new NodeTools(),
    component: new ComponentTools(),
    prefab: new PrefabTools(),
    project: new ProjectTools(),
    debug: new DebugTools(),
    preferences: new PreferencesTools(),
    server: new ServerTools(),
    broadcast: new BroadcastTools(),
    sceneAdvanced: new SceneAdvancedTools(),
    sceneView: new SceneViewTools(),
    referenceImage: new ReferenceImageTools(),
    assetAdvanced: new AssetAdvancedTools(),
    validation: new ValidationTools(),
  }

  private readonly tools: RegisteredTool[]

  constructor(private readonly infoProvider: ToolInfoProvider = {}) {
    this.tools = this.buildTools()
  }

  public getTools(): ToolDefinition[] {
    return this.tools.map(({ execute, ...tool }) => tool)
  }

  public async execute(name: string, args: unknown): Promise<ToolResponse> {
    const tool = this.tools.find(item => item.name === name)
    if (!tool) {
      throw new Error(`Tool ${name} not found`)
    }
    if (!this.isToolArguments(args)) {
      return toolFailure(`Tool ${name} requires an object argument`, {
        instruction: 'Call tools/list or tool_registry.describe, then retry with a JSON object containing an action.',
      })
    }
    return tool.execute(args)
  }

  private buildTools(): RegisteredTool[] {
    return [
      this.createTool(
        'scene_management',
        'Manage scene files and lifecycle. Query current scene before writes; save after structural changes when persistence is required. Actions: get_current, list, open, save, create, save_as, close.',
        ['get_current', 'list', 'open', 'save', 'create', 'save_as', 'close'],
        ['scenePath', 'sceneName', 'savePath', 'path', 'autoCreateCanvas'],
        args => this.routeLegacyAction('scene_management', {
          get_current: 'scene_get_current_scene',
          list: 'scene_get_scene_list',
          open: 'scene_open_scene',
          save: 'scene_save_scene',
          create: 'scene_create_scene',
          save_as: 'scene_save_scene_as',
          close: 'scene_close_scene',
        }, args),
      ),
      this.createTool(
        'scene_hierarchy',
        'Read the editor scene hierarchy. Use this before node writes because node names are not unique. Actions: get.',
        ['get'],
        ['includeComponents'],
        args => this.routeLegacyAction('scene_hierarchy', {
          get: 'scene_get_scene_hierarchy',
        }, args),
      ),
      this.createTool(
        'scene_execution_control',
        'Run registered scene-side operations and readiness checks. execute_scene_script cannot evaluate JavaScript: name must identify an extension with a contributed scene script, and method must be exported from that scene script methods object. Actions: execute_component_method, execute_scene_script, restore_prefab, soft_reload, query_ready, query_dirty.',
        ['execute_component_method', 'execute_scene_script', 'restore_prefab', 'soft_reload', 'query_ready', 'query_dirty'],
        ['uuid', 'nodeUuid', 'assetUuid', 'name', 'method', 'args'],
        args => this.routeLegacyAction('scene_execution_control', {
          execute_component_method: 'sceneAdvanced_execute_component_method',
          execute_scene_script: 'sceneAdvanced_execute_scene_script',
          restore_prefab: 'sceneAdvanced_restore_prefab',
          soft_reload: 'sceneAdvanced_soft_reload_scene',
          query_ready: 'sceneAdvanced_query_scene_ready',
          query_dirty: 'sceneAdvanced_query_scene_dirty',
        }, args),
      ),
      this.createTool(
        'scene_snapshot',
        'Create or abort editor scene snapshots around risky multi-step edits. Pair create/abort deliberately; prefer undo records for normal edits. Actions: create, abort.',
        ['create', 'abort'],
        [],
        args => this.routeLegacyAction('scene_snapshot', {
          create: 'sceneAdvanced_scene_snapshot',
          abort: 'sceneAdvanced_scene_snapshot_abort',
        }, args),
      ),
      this.createTool(
        'scene_query',
        'Query scene-level classes, components, script usage, and asset references. Use before component or reference writes when exact types are unknown. Actions: classes, components, nodes_by_asset_uuid, component_has_script, get_info.',
        ['classes', 'components', 'nodes_by_asset_uuid', 'component_has_script', 'get_info'],
        ['extends', 'assetUuid', 'className'],
        args => this.routeLegacyAction('scene_query', {
          classes: 'sceneAdvanced_query_scene_classes',
          components: 'sceneAdvanced_query_scene_components',
          nodes_by_asset_uuid: 'sceneAdvanced_query_nodes_by_asset_uuid',
          component_has_script: 'sceneAdvanced_query_component_has_script',
          get_info: 'sceneAdvanced_query_scene_info',
        }, args),
      ),
      this.createTool(
        'scene_view_control',
        'Control the editor scene view and camera. Pass UUIDs from node_query/scene_hierarchy; use query tool first when current view state matters. Actions: change_gizmo_tool, change_gizmo_pivot, change_gizmo_coordinate, change_view_mode, set_grid_visible, set_icon_gizmo_3d, set_icon_gizmo_size, focus_camera_on_nodes, align_camera_with_view, align_view_with_node, reset.',
        ['change_gizmo_tool', 'change_gizmo_pivot', 'change_gizmo_coordinate', 'change_view_mode', 'set_grid_visible', 'set_icon_gizmo_3d', 'set_icon_gizmo_size', 'focus_camera_on_nodes', 'align_camera_with_view', 'align_view_with_node', 'reset'],
        ['name', 'type', 'visible', 'is3D', 'size', 'is2D', 'uuids'],
        args => this.routeLegacyAction('scene_view_control', {
          change_gizmo_tool: 'sceneView_change_gizmo_tool',
          change_gizmo_pivot: 'sceneView_change_gizmo_pivot',
          change_gizmo_coordinate: 'sceneView_change_gizmo_coordinate',
          change_view_mode: 'sceneView_change_view_mode_2d_3d',
          set_grid_visible: 'sceneView_set_grid_visible',
          set_icon_gizmo_3d: 'sceneView_set_icon_gizmo_3d',
          set_icon_gizmo_size: 'sceneView_set_icon_gizmo_size',
          focus_camera_on_nodes: 'sceneView_focus_camera_on_nodes',
          align_camera_with_view: 'sceneView_align_camera_with_view',
          align_view_with_node: 'sceneView_align_view_with_node',
          reset: 'sceneView_reset_scene_view',
        }, args),
      ),
      this.createTool(
        'scene_view_query',
        'Query editor scene view state before view or camera changes. Actions: get_status, gizmo_tool, gizmo_pivot, gizmo_view_mode, gizmo_coordinate, view_mode, grid_visible, icon_gizmo_3d, icon_gizmo_size.',
        ['get_status', 'gizmo_tool', 'gizmo_pivot', 'gizmo_view_mode', 'gizmo_coordinate', 'view_mode', 'grid_visible', 'icon_gizmo_3d', 'icon_gizmo_size'],
        [],
        args => this.routeLegacyAction('scene_view_query', {
          get_status: 'sceneView_get_scene_view_status',
          gizmo_tool: 'sceneView_query_gizmo_tool_name',
          gizmo_pivot: 'sceneView_query_gizmo_pivot',
          gizmo_view_mode: 'sceneView_query_gizmo_view_mode',
          gizmo_coordinate: 'sceneView_query_gizmo_coordinate',
          view_mode: 'sceneView_query_view_mode_2d_3d',
          grid_visible: 'sceneView_query_grid_visible',
          icon_gizmo_3d: 'sceneView_query_icon_gizmo_3d',
          icon_gizmo_size: 'sceneView_query_icon_gizmo_size',
        }, args),
      ),
      this.createTool(
        'scene_undo_manage',
        'Manage explicit editor undo records for multi-step scene edits. begin requires nodeUuid or nodeUuids containing every target whose state must be captured; label becomes the Undo menu tag. Save data.undoId and pass it to end or cancel. Actions: begin, end, cancel.',
        ['begin', 'end', 'cancel'],
        ['nodeUuid', 'nodeUuids', 'label', 'undoId'],
        args => this.routeLegacyAction('scene_undo_manage', {
          begin: 'sceneAdvanced_begin_undo_recording',
          end: 'sceneAdvanced_end_undo_recording',
          cancel: 'sceneAdvanced_cancel_undo_recording',
        }, args),
        [
          { action: 'begin', required: ['nodeUuid'] },
          { action: 'begin', required: ['nodeUuids'] },
          { action: 'end', required: ['undoId'] },
          { action: 'cancel', required: ['undoId'] },
        ],
      ),
      this.createTool(
        'node_query',
        'Query nodes by UUID, name, pattern, or list all nodes. Use before write operations because node names are not unique. Actions: get_info, find, find_by_name, get_all, detect_type.',
        ['get_info', 'find', 'find_by_name', 'get_all', 'detect_type'],
        ['uuid', 'pattern', 'name', 'exactMatch'],
        args => this.routeLegacyAction('node_query', {
          get_info: 'node_get_node_info',
          find: 'node_find_nodes',
          find_by_name: 'node_find_node_by_name',
          get_all: 'node_get_all_nodes',
          detect_type: 'node_detect_node_type',
        }, args),
      ),
      this.createTool(
        'node_lifecycle',
        'Create, delete, or duplicate nodes. Use node_query/scene_hierarchy first for target UUIDs; names are not stable identifiers. Actions: create, delete, duplicate.',
        ['create', 'delete', 'duplicate'],
        ['name', 'uuid', 'parentUuid', 'nodeType', 'siblingIndex', 'assetUuid', 'assetPath', 'unlinkPrefab', 'keepWorldTransform', 'includeChildren', 'position', 'rotation', 'scale'],
        args => this.routeLegacyAction('node_lifecycle', {
          create: 'node_create_node',
          delete: 'node_delete_node',
          duplicate: 'node_duplicate_node',
        }, args),
      ),
      this.createTool(
        'node_transform',
        'Set node transform or direct node property by UUID. Query the node first and prefer set_transform for position/rotation/scale. Actions: set_transform, set_property.',
        ['set_transform', 'set_property'],
        ['uuid', 'property', 'value', 'position', 'rotation', 'scale'],
        args => this.routeLegacyAction('node_transform', {
          set_transform: 'node_set_node_transform',
          set_property: 'node_set_node_property',
        }, args),
      ),
      this.createTool(
        'node_hierarchy',
        'Move nodes or use editor clipboard operations. Use UUIDs from node_query; keepWorldTransform controls whether visual placement is preserved. Actions: move, copy, paste, cut.',
        ['move', 'copy', 'paste', 'cut'],
        ['uuid', 'uuids', 'nodeUuid', 'newParentUuid', 'target', 'keepWorldTransform', 'siblingIndex'],
        args => this.routeLegacyAction('node_hierarchy', {
          move: 'node_move_node',
          copy: 'sceneAdvanced_copy_node',
          paste: 'sceneAdvanced_paste_node',
          cut: 'sceneAdvanced_cut_node',
        }, args),
      ),
      this.createTool(
        'node_clipboard',
        'Copy, paste, or cut nodes through the editor clipboard. Prefer node_hierarchy.move for pure reparenting. Actions: copy, paste, cut.',
        ['copy', 'paste', 'cut'],
        ['uuids', 'target', 'keepWorldTransform'],
        args => this.routeLegacyAction('node_clipboard', {
          copy: 'sceneAdvanced_copy_node',
          paste: 'sceneAdvanced_paste_node',
          cut: 'sceneAdvanced_cut_node',
        }, args),
      ),
      this.createTool(
        'node_property_management',
        'Reset node properties/transforms or edit array properties. Query node info first and pass exact property paths. Actions: reset_property, reset_transform, move_array_element, remove_array_element.',
        ['reset_property', 'reset_transform', 'move_array_element', 'remove_array_element'],
        ['uuid', 'path', 'target', 'offset', 'index'],
        args => this.routeLegacyAction('node_property_management', {
          reset_property: 'sceneAdvanced_reset_node_property',
          reset_transform: 'sceneAdvanced_reset_node_transform',
          move_array_element: 'sceneAdvanced_move_array_element',
          remove_array_element: 'sceneAdvanced_remove_array_element',
        }, args),
      ),
      this.createTool(
        'node_reference',
        'Find nodes that reference an asset or restore prefab linkage. Use asset_query to obtain assetUuid first. Actions: nodes_by_asset_uuid, restore_prefab.',
        ['nodes_by_asset_uuid', 'restore_prefab'],
        ['assetUuid', 'nodeUuid'],
        args => this.routeLegacyAction('node_reference', {
          nodes_by_asset_uuid: 'sceneAdvanced_query_nodes_by_asset_uuid',
          restore_prefab: 'sceneAdvanced_restore_prefab',
        }, args),
      ),
      this.createTool(
        'component_manage',
        'Add or remove components on a node. Before remove, call component_query.get_components and prefer the returned component instance uuid; type and cid are also accepted. Actions: add, remove.',
        ['add', 'remove'],
        ['nodeUuid', 'componentType'],
        args => this.routeLegacyAction('component_manage', {
          add: 'component_add_component',
          remove: 'component_remove_component',
        }, args),
      ),
      this.createTool(
        'component_script',
        'Attach script components or detach existing components. Query components first before detach; scriptPath should point to the project script asset. Actions: attach, detach.',
        ['attach', 'detach'],
        ['nodeUuid', 'scriptPath', 'componentType'],
        args => this.routeLegacyAction('component_script', {
          attach: 'component_attach_script',
          detach: 'component_remove_component',
        }, args),
      ),
      this.createTool(
        'component_query',
        'Query node components and component details. Use before component writes/removal to get actual componentType/cid and property names. Actions: get_components, get_info.',
        ['get_components', 'get_info'],
        ['nodeUuid', 'componentType', 'includeProperties'],
        args => this.routeLegacyAction('component_query', {
          get_components: 'component_get_components',
          get_info: 'component_get_component_info',
        }, args),
      ),
      this.createTool(
        'component_property',
        'Set a component property on a node. Query components first when componentType/cid or property names are unknown. Actions: set, set_property.',
        ['set', 'set_property'],
        ['nodeUuid', 'componentType', 'property', 'propertyType', 'value'],
        args => this.routeLegacyAction('component_property', {
          set: 'component_set_component_property',
          set_property: 'component_set_component_property',
        }, args),
      ),
      this.createTool(
        'component_event_binding',
        'Manage Button click event bindings. Query the Button component and target handler node first; set replaces all events, append preserves existing ones. Actions: get_button_events, clear_button_events, set_button_events, append_button_event.',
        ['get_button_events', 'clear_button_events', 'set_button_events', 'append_button_event'],
        ['nodeUuid', 'componentType', 'events', 'targetNodeUuid', 'component', 'handler', 'customEventData'],
        args => this.handleComponentEventBinding(args),
      ),
      this.createTool(
        'component_available',
        'List available component types for adding new components. Use component_query for components already on a node. Actions: list.',
        ['list'],
        ['category'],
        args => this.routeLegacyAction('component_available', {
          list: 'component_get_available_components',
        }, args),
      ),
      this.createTool(
        'prefab_browse',
        'Browse and inspect prefab assets. Use this before instantiate/update when prefabPath is unknown. Actions: list, load, info, validate.',
        ['list', 'load', 'info', 'validate'],
        ['folder', 'prefabPath'],
        args => this.routeLegacyAction('prefab_browse', {
          list: 'prefab_get_prefab_list',
          load: 'prefab_load_prefab',
          info: 'prefab_get_prefab_info',
          validate: 'prefab_validate_prefab',
        }, args),
      ),
      this.createTool(
        'prefab_lifecycle',
        'Create prefab assets from nodes or duplicate prefab assets. Query node UUIDs and target save paths first. Actions: create, duplicate.',
        ['create', 'duplicate'],
        ['nodeUuid', 'savePath', 'prefabName', 'sourcePrefabPath', 'targetPrefabPath', 'newPrefabName'],
        args => this.routeLegacyAction('prefab_lifecycle', {
          create: 'prefab_create_prefab',
          duplicate: 'prefab_duplicate_prefab',
        }, args),
      ),
      this.createTool(
        'prefab_instance',
        'Instantiate prefabs or revert/restore existing prefab instances. instantiate and restore only succeed after query-nodes-by-asset-uuid verifies the association. restore is not a generic conversion from an ordinary node. Actions: instantiate, revert, restore_node, restore.',
        ['instantiate', 'revert', 'restore_node', 'restore'],
        ['prefabPath', 'parentUuid', 'position', 'nodeUuid', 'assetUuid'],
        args => this.routeLegacyAction('prefab_instance', {
          instantiate: 'prefab_instantiate_prefab',
          revert: 'prefab_revert_prefab',
          restore_node: 'prefab_restore_prefab_node',
          restore: 'sceneAdvanced_restore_prefab',
        }, args),
      ),
      this.createTool(
        'prefab_edit',
        'Apply or discard prefab instance overrides. Use update to write instance changes back to the prefab asset; use revert to discard them. Actions: update, revert.',
        ['update', 'revert'],
        ['prefabPath', 'nodeUuid'],
        args => this.routeLegacyAction('prefab_edit', {
          update: 'prefab_update_prefab',
          revert: 'prefab_revert_prefab',
        }, args),
      ),
      this.createTool(
        'prefab_reference',
        'Restore prefab nodes or find scene nodes using a prefab/asset UUID. Query assetUuid first. Actions: restore_node, nodes_by_asset_uuid.',
        ['restore_node', 'nodes_by_asset_uuid'],
        ['nodeUuid', 'assetUuid'],
        args => this.routeLegacyAction('prefab_reference', {
          restore_node: 'prefab_restore_prefab_node',
          nodes_by_asset_uuid: 'sceneAdvanced_query_nodes_by_asset_uuid',
        }, args),
      ),
      this.createTool(
        'asset_manage',
        'Create, import, move, delete, save, or reimport assets. Query/generate URLs first and distinguish asset URL from filesystem path. Actions: import, create, copy, move, delete, save, reimport, open_external, create_default_spriteframe.',
        ['import', 'create', 'copy', 'move', 'delete', 'save', 'reimport', 'open_external', 'create_default_spriteframe'],
        ['sourcePath', 'targetFolder', 'url', 'content', 'overwrite', 'source', 'target', 'urlOrUUID', 'color', 'size', 'savePath'],
        args => this.routeLegacyAction('asset_manage', {
          import: 'project_import_asset',
          create: 'project_create_asset',
          copy: 'project_copy_asset',
          move: 'project_move_asset',
          delete: 'project_delete_asset',
          save: 'project_save_asset',
          reimport: 'project_reimport_asset',
          open_external: 'assetAdvanced_open_asset_external',
          create_default_spriteframe: 'assetAdvanced_create_default_spriteframe',
        }, args),
      ),
      this.createTool(
        'asset_query',
        'Query asset database records, URLs, UUIDs, and paths. Use before asset writes and when converting between filesystem paths, asset URLs, and UUIDs. Actions: get_info, list, query_path, query_uuid, query_url, find_by_name, details, generate_available_url, db_ready.',
        ['get_info', 'list', 'query_path', 'query_uuid', 'query_url', 'find_by_name', 'details', 'generate_available_url', 'db_ready'],
        ['assetPath', 'folder', 'type', 'url', 'uuid', 'name', 'exactMatch', 'assetType', 'maxResults', 'includeSubAssets'],
        args => this.routeLegacyAction('asset_query', {
          get_info: 'project_get_asset_info',
          list: 'project_get_assets',
          query_path: 'project_query_asset_path',
          query_uuid: 'project_query_asset_uuid',
          query_url: 'project_query_asset_url',
          find_by_name: 'project_find_asset_by_name',
          details: 'project_get_asset_details',
          generate_available_url: 'assetAdvanced_generate_available_url',
          db_ready: 'assetAdvanced_query_asset_db_ready',
        }, args),
      ),
      this.createTool(
        'asset_analyze',
        'Analyze asset references, dependencies, and unused assets. Query exact asset URL/UUID first for focused dependency checks. Actions: validate_references, dependencies, unused.',
        ['validate_references', 'dependencies', 'unused'],
        ['directory', 'excludeDirectories', 'urlOrUUID', 'direction'],
        args => this.routeLegacyAction('asset_analyze', {
          validate_references: 'assetAdvanced_validate_asset_references',
          dependencies: 'assetAdvanced_get_asset_dependencies',
          unused: 'assetAdvanced_get_unused_assets',
        }, args),
      ),
      this.createTool(
        'asset_batch',
        'Run batch asset operations. Prefer dry planning with asset_query first; batch_delete is destructive. Actions: batch_import, batch_delete, compress_textures, export_manifest.',
        ['batch_import', 'batch_delete', 'compress_textures', 'export_manifest'],
        ['sourceDirectory', 'targetDirectory', 'fileFilter', 'recursive', 'overwrite', 'urls', 'directory', 'format', 'quality', 'includeMetadata'],
        args => this.routeLegacyAction('asset_batch', {
          batch_import: 'assetAdvanced_batch_import_assets',
          batch_delete: 'assetAdvanced_batch_delete_assets',
          compress_textures: 'assetAdvanced_compress_textures',
          export_manifest: 'assetAdvanced_export_asset_manifest',
        }, args),
      ),
      this.createTool(
        'asset_meta',
        'Write asset meta content. Use only after querying the target asset URL/UUID and preserving required meta fields. Actions: save_meta.',
        ['save_meta'],
        ['urlOrUUID', 'content'],
        args => this.routeLegacyAction('asset_meta', {
          save_meta: 'assetAdvanced_save_asset_meta',
        }, args),
      ),
      this.createTool(
        'project_manage',
        'Query project information/settings or refresh the asset database. Refresh after external file changes before querying new assets. Actions: get_info, get_settings, refresh_assets.',
        ['get_info', 'get_settings', 'refresh_assets'],
        ['category', 'folder'],
        args => this.routeLegacyAction('project_manage', {
          get_info: 'project_get_project_info',
          get_settings: 'project_get_project_settings',
          refresh_assets: 'project_refresh_assets',
        }, args),
      ),
      this.createTool(
        'project_build_system',
        'Inspect or trigger Cocos build workflows. Prefer get_build_settings/check_builder_status before build; open panel when manual configuration is needed. Actions: build, get_build_settings, open_build_panel, check_builder_status.',
        ['build', 'get_build_settings', 'open_build_panel', 'check_builder_status'],
        ['platform', 'debug'],
        args => this.routeLegacyAction('project_build_system', {
          build: 'project_build_project',
          get_build_settings: 'project_get_build_settings',
          open_build_panel: 'project_open_build_panel',
          check_builder_status: 'project_check_builder_status',
        }, args),
      ),
      this.createTool(
        'project_runtime',
        'Run project preview or manage preview server. Check current project/build state first when launch fails. Actions: run, start_preview_server, stop_preview_server.',
        ['run', 'start_preview_server', 'stop_preview_server'],
        ['platform', 'port'],
        args => this.routeLegacyAction('project_runtime', {
          run: 'project_run_project',
          start_preview_server: 'project_start_preview_server',
          stop_preview_server: 'project_stop_preview_server',
        }, args),
      ),
      this.createTool(
        'project_asset_system',
        'Project asset CRUD wrapper. Prefer asset_manage/asset_query for new code; distinguish asset URL from filesystem path. Actions: import, create, copy, move, delete, save, reimport.',
        ['import', 'create', 'copy', 'move', 'delete', 'save', 'reimport'],
        ['sourcePath', 'targetFolder', 'url', 'content', 'overwrite', 'source', 'target'],
        args => this.routeLegacyAction('project_asset_system', {
          import: 'project_import_asset',
          create: 'project_create_asset',
          copy: 'project_copy_asset',
          move: 'project_move_asset',
          delete: 'project_delete_asset',
          save: 'project_save_asset',
          reimport: 'project_reimport_asset',
        }, args),
      ),
      this.createTool(
        'project_query',
        'Project asset query wrapper for assets, details, paths, UUIDs, and URLs. Prefer exact URL/UUID over names. Actions: assets, asset_info, asset_details, asset_path, asset_uuid, asset_url, find_asset_by_name.',
        ['assets', 'asset_info', 'asset_details', 'asset_path', 'asset_uuid', 'asset_url', 'find_asset_by_name'],
        ['type', 'folder', 'assetPath', 'includeSubAssets', 'url', 'uuid', 'name', 'exactMatch', 'assetType', 'maxResults'],
        args => this.routeLegacyAction('project_query', {
          assets: 'project_get_assets',
          asset_info: 'project_get_asset_info',
          asset_details: 'project_get_asset_details',
          asset_path: 'project_query_asset_path',
          asset_uuid: 'project_query_asset_uuid',
          asset_url: 'project_query_asset_url',
          find_asset_by_name: 'project_find_asset_by_name',
        }, args),
      ),
      this.createTool(
        'debug_console',
        'Read or clear editor console logs. Use after failed tool calls to inspect runtime errors. Actions: get, clear.',
        ['get', 'clear'],
        ['limit', 'filter'],
        args => this.routeLegacyAction('debug_console', {
          get: 'debug_get_console_logs',
          clear: 'debug_clear_console',
        }, args),
      ),
      this.createTool(
        'debug_logs',
        'Read and search Cocos project/editor log files. Use targeted search patterns to reduce returned log volume. Actions: get_project_logs, get_log_file_info, search.',
        ['get_project_logs', 'get_log_file_info', 'search'],
        ['lines', 'filterKeyword', 'logLevel', 'pattern', 'maxResults', 'contextLines'],
        args => this.routeLegacyAction('debug_logs', {
          get_project_logs: 'debug_get_project_logs',
          get_log_file_info: 'debug_get_log_file_info',
          search: 'debug_search_project_logs',
        }, args),
      ),
      this.createTool(
        'debug_execute',
        'Legacy compatibility endpoint. Arbitrary JavaScript execution is not supported; script returns a failure with guidance to use dedicated tools or a registered scene script method. Actions: script.',
        ['script'],
        ['script'],
        args => this.routeLegacyAction('debug_execute', {
          script: 'debug_execute_script',
        }, args),
      ),
      this.createTool(
        'debug_scene',
        'Debug scene tree, performance-oriented validation, and editor info. Use node_tree for hierarchy reads; validate does not replace missing asset checks. Actions: node_tree, validate, editor_info.',
        ['node_tree', 'validate', 'editor_info'],
        ['rootUuid', 'maxDepth', 'checkPerformance'],
        args => this.routeLegacyAction('debug_scene', {
          node_tree: 'debug_get_node_tree',
          validate: 'debug_validate_scene',
          editor_info: 'debug_get_editor_info',
        }, args),
      ),
      this.createTool(
        'debug_performance',
        'Get editor/game performance stats for diagnosis. Actions: stats.',
        ['stats'],
        [],
        args => this.routeLegacyAction('debug_performance', {
          stats: 'debug_get_performance_stats',
        }, args),
      ),
      this.createTool(
        'preferences_manage',
        'Open, query, set, reset, export, or import editor preferences. Query current values before set/reset. Actions: open, query, set, get_all, reset, export, import.',
        ['open', 'query', 'set', 'get_all', 'reset', 'export', 'import'],
        ['tab', 'args', 'name', 'path', 'value', 'type', 'exportPath', 'importPath'],
        args => this.routeLegacyAction('preferences_manage', {
          open: 'preferences_open_preferences_settings',
          query: 'preferences_query_preferences_config',
          set: 'preferences_set_preferences_config',
          get_all: 'preferences_get_all_preferences',
          reset: 'preferences_reset_preferences',
          export: 'preferences_export_preferences',
          import: 'preferences_import_preferences',
        }, args),
      ),
      this.createTool(
        'server_info',
        'Query MCP server address, port, and status metadata. Actions: ip_list, sorted_ip_list, port, status.',
        ['ip_list', 'sorted_ip_list', 'port', 'status'],
        [],
        args => this.routeLegacyAction('server_info', {
          ip_list: 'server_query_server_ip_list',
          sorted_ip_list: 'server_query_sorted_server_ip_list',
          port: 'server_query_server_port',
          status: 'server_get_server_status',
        }, args),
      ),
      this.createTool(
        'server_network',
        'Check local network interfaces and MCP connectivity. Use when clients cannot connect. Actions: connectivity, interfaces.',
        ['connectivity', 'interfaces'],
        ['timeout'],
        args => this.routeLegacyAction('server_network', {
          connectivity: 'server_check_server_connectivity',
          interfaces: 'server_get_network_interfaces',
        }, args),
      ),
      this.createTool(
        'server_control',
        'Query MCP server health, settings, and currently available tools. Use available_tools to see active filtered tool set. Actions: health, settings, available_tools.',
        ['health', 'settings', 'available_tools'],
        [],
        args => this.handleServerControl(args),
      ),
      this.createTool(
        'broadcast_message',
        'Inspect and manage Cocos editor broadcast listeners/logs. Stop listeners when no longer needed. Actions: get_log, listen, stop_listening, clear_log, active_listeners.',
        ['get_log', 'listen', 'stop_listening', 'clear_log', 'active_listeners'],
        ['limit', 'messageType'],
        args => this.routeLegacyAction('broadcast_message', {
          get_log: 'broadcast_get_broadcast_log',
          listen: 'broadcast_listen_broadcast',
          stop_listening: 'broadcast_stop_listening',
          clear_log: 'broadcast_clear_broadcast_log',
          active_listeners: 'broadcast_get_active_listeners',
        }, args),
      ),
      this.createTool(
        'reference_image_manage',
        'Manage scene reference images. Query current/config before modifying position, scale, opacity, or active image. Actions: add, remove, switch, set_data, query_config, query_current, refresh, set_position, set_scale, set_opacity, list, clear_all.',
        ['add', 'remove', 'switch', 'set_data', 'query_config', 'query_current', 'refresh', 'set_position', 'set_scale', 'set_opacity', 'list', 'clear_all'],
        ['paths', 'path', 'sceneUUID', 'key', 'value', 'x', 'y', 'sx', 'sy', 'opacity'],
        args => this.routeLegacyAction('reference_image_manage', {
          add: 'referenceImage_add_reference_image',
          remove: 'referenceImage_remove_reference_image',
          switch: 'referenceImage_switch_reference_image',
          set_data: 'referenceImage_set_reference_image_data',
          query_config: 'referenceImage_query_reference_image_config',
          query_current: 'referenceImage_query_current_reference_image',
          refresh: 'referenceImage_refresh_reference_image',
          set_position: 'referenceImage_set_reference_image_position',
          set_scale: 'referenceImage_set_reference_image_scale',
          set_opacity: 'referenceImage_set_reference_image_opacity',
          list: 'referenceImage_list_reference_images',
          clear_all: 'referenceImage_clear_all_reference_images',
        }, args),
      ),
      this.createTool(
        'validation_params',
        'Validate or format MCP parameters before risky calls. Useful when generating JSON arguments programmatically. Actions: validate_json, safe_string, format_mcp_request.',
        ['validate_json', 'safe_string', 'format_mcp_request'],
        ['jsonString', 'expectedSchema', 'value', 'toolName', 'arguments'],
        args => this.routeLegacyAction('validation_params', {
          validate_json: 'validation_validate_json_params',
          safe_string: 'validation_safe_string_value',
          format_mcp_request: 'validation_format_mcp_request',
        }, args),
      ),
      this.createTool(
        'resource_reference',
        'Cross-reference assets and scene nodes. Query asset UUID/URL first, then inspect dependent nodes or asset dependencies. Actions: nodes_by_asset_uuid, asset_dependencies, validate_asset_references.',
        ['nodes_by_asset_uuid', 'asset_dependencies', 'validate_asset_references'],
        ['assetUuid', 'urlOrUUID', 'direction', 'directory'],
        args => this.routeLegacyAction('resource_reference', {
          nodes_by_asset_uuid: 'sceneAdvanced_query_nodes_by_asset_uuid',
          asset_dependencies: 'assetAdvanced_get_asset_dependencies',
          validate_asset_references: 'assetAdvanced_validate_asset_references',
        }, args),
      ),
      this.createTool(
        'tool_registry',
        'Inspect available MCP tools and action names when uncertain. Use describe before guessing parameters. Actions: list, describe, actions.',
        ['list', 'describe', 'actions'],
        ['toolName'],
        args => this.handleToolRegistry(args),
      ),
    ]
  }

  private createTool(
    name: string,
    description: string,
    actions: string[],
    propertyKeys: string[],
    execute: (args: ToolArguments) => Promise<ToolResponse>,
    actionRequirements: Record<string, string[]> | Array<{ action: string, required: string[] }> = {},
  ): RegisteredTool {
    const requirements = Array.isArray(actionRequirements)
      ? actionRequirements
      : Object.entries(actionRequirements).map(([action, required]) => ({ action, required }))
    const anyOf = requirements.map(({ action, required }) => ({
      properties: {
        action: { type: 'string', enum: [action] },
      },
      required: ['action', ...required],
    }))
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: actions,
            description: `Operation code. Supported actions: ${actions.join(', ')}`,
          },
          ...pickProps(propertyKeys),
        },
        required: ['action'],
        ...(anyOf.length === 0 ? {} : { anyOf }),
      },
      execute,
    }
  }

  private async routeLegacyAction(toolName: string, actionMap: Record<string, string>, args: ToolArguments): Promise<ToolResponse> {
    const action = args?.action
    if (typeof action !== 'string' || !action) {
      return toolFailure(`${toolName} requires an action parameter`, {
        instruction: `Call tool_registry.actions or inspect tools/list, then retry with one of: ${Object.keys(actionMap).join(', ')}`,
      })
    }

    const target = actionMap[action]
    if (!target) {
      return toolFailure(`Unsupported action '${action}' for ${toolName}. Available actions: ${Object.keys(actionMap).join(', ')}`, {
        instruction: `Retry ${toolName} with action set to one of: ${Object.keys(actionMap).join(', ')}`,
      })
    }

    const payload = { ...args }
    delete payload.action
    try {
      const result = await this.callLegacy(target, payload)
      return this.withFailureInstruction(result, toolName, action, payload)
    }
    catch (error: unknown) {
      return this.withFailureInstruction(toolFailure(
        error instanceof Error ? error.message : String(error),
      ), toolName, action, payload)
    }
  }

  private withFailureInstruction(result: ToolResponse, toolName: string, action: string, args: ToolArguments): ToolResponse {
    if (result.success || result.instruction) {
      return result
    }

    const instruction = this.getFailureInstruction(toolName, action, result.error || '', args)
    if (!instruction) {
      return result
    }

    return {
      ...result,
      instruction,
    }
  }

  private getFailureInstruction(toolName: string, action: string, error: string, args: ToolArguments): string | undefined {
    const lowerError = error.toLowerCase()

    if (toolName === 'scene_execution_control' && action === 'execute_scene_script') {
      return 'execute_scene_script cannot run arbitrary JavaScript. Use name="cocos-mcp-server" with a method exported by source/scene.ts, call a dedicated MCP tool, or add and register a new scene method in the extension before calling it.'
    }

    if (toolName === 'debug_execute') {
      return 'Arbitrary Editor or scene JavaScript execution is not supported. Use asset_query/project_query for asset database reads, debug_console/debug_logs for diagnostics, or scene_execution_control.execute_scene_script for an already registered scene method.'
    }

    if (lowerError.includes('requires') && lowerError.includes('uuid')) {
      return 'Query the target first with node_query or scene_hierarchy, then retry with the returned UUID.'
    }

    if (lowerError.includes('node') && (lowerError.includes('not found') || lowerError.includes('invalid response') || lowerError.includes('failed to get node'))) {
      return 'Call node_query.get_all, node_query.find, or scene_hierarchy.get to confirm the node exists and use its exact UUID before retrying.'
    }

    if (toolName.startsWith('component') || lowerError.includes('component')) {
      if (lowerError.includes('not found') || lowerError.includes('type') || lowerError.includes('cid') || lowerError.includes('verify')) {
        return 'Call component_query.get_components with the nodeUuid, then retry using the returned component instance uuid, type, or cid. Prefer uuid for removal; use component_available.list only when adding a new component.'
      }
      return 'Call component_query.get_components first to confirm the nodeUuid, component instance uuid/type/cid, and property names before retrying.'
    }

    if (toolName.startsWith('prefab') || lowerError.includes('prefab') || lowerError.includes('预制体')) {
      if (action === 'update' || action === 'revert') {
        return 'Call node_query.get_info for the prefab instance nodeUuid. Use prefab_edit.update to apply overrides to the asset, or prefab_edit.revert to discard instance overrides.'
      }
      return 'Use prefab_browse.list/info or asset_query.find_by_name to confirm the prefabPath or assetUuid, then retry with the exact prefab identity.'
    }

    if (toolName.startsWith('asset') || toolName.startsWith('project_asset') || toolName.startsWith('project_query') || lowerError.includes('asset')) {
      return 'Use asset_query to convert between filesystem path, asset URL, and UUID. Retry with the exact field expected by this action.'
    }

    if (lowerError.includes('query-node-tree') || lowerError.includes('query-node') || lowerError.includes('editor.message') || lowerError.includes('message')) {
      return 'This looks like a Cocos Editor IPC failure. Use debug_console.get or debug_logs.search for details, and avoid guessing unsupported Editor message names.'
    }

    if (toolName.startsWith('scene')) {
      return 'Query scene readiness and hierarchy first with scene_execution_control.query_ready and scene_hierarchy.get, then retry the scene operation.'
    }

    if (toolName.startsWith('node')) {
      return 'Query the target with node_query or scene_hierarchy, verify the UUID and parent UUID, then retry the node operation.'
    }

    if (args && (args.url || args.urlOrUUID || args.assetPath || args.assetUuid)) {
      return 'Verify the asset identity with asset_query before retrying. Asset URL, UUID, and filesystem path are different identifiers.'
    }

    return `Inspect ${toolName} with tool_registry.describe, verify the required arguments for action '${action}', then retry.`
  }

  private async callLegacy(fullName: string, args: ToolArguments): Promise<ToolResponse> {
    for (const prefix of LEGACY_PREFIXES) {
      const prefixWithSeparator = `${prefix}_`
      if (fullName.startsWith(prefixWithSeparator)) {
        const executor = this.legacy[prefix]
        const toolName = fullName.slice(prefixWithSeparator.length)
        return executor.execute(toolName, args)
      }
    }

    throw new Error(`Legacy tool ${fullName} not found`)
  }

  private isToolArguments(args: unknown): args is ToolArguments {
    return typeof args === 'object' && args !== null && !Array.isArray(args)
  }

  private async handleServerControl(args: ToolArguments): Promise<ToolResponse> {
    switch (args.action) {
      case 'health':
        return {
          success: true,
          data: {
            status: 'ok',
            version: '1.5.0',
            tools: this.getTools().length,
            settings: this.infoProvider.getSettings ? this.infoProvider.getSettings() : null,
          },
        }
      case 'settings':
        return {
          success: true,
          data: this.infoProvider.getSettings ? this.infoProvider.getSettings() : null,
        }
      case 'available_tools':
        return {
          success: true,
          data: {
            count: this.getTools().length,
            tools: this.getTools().map(tool => ({
              name: tool.name,
              description: tool.description,
            })),
          },
        }
      default:
        return {
          success: false,
          error: `Unsupported action '${args.action}' for server_control. Available actions: health, settings, available_tools`,
          instruction: 'Retry server_control with action set to one of: health, settings, available_tools.',
        }
    }
  }

  private async handleToolRegistry(args: ToolArguments): Promise<ToolResponse> {
    const tools = this.getTools()
    switch (args.action) {
      case 'list':
        return {
          success: true,
          data: {
            count: tools.length,
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
            })),
          },
        }
      case 'describe': {
        const target = tools.find(tool => tool.name === args.toolName)
        if (!target) {
          return {
            success: false,
            error: `Tool ${args.toolName} not found`,
            instruction: 'Call tool_registry.list to see available tool names, then retry describe with an exact toolName.',
          }
        }
        return {
          success: true,
          data: target,
        }
      }
      case 'actions':
        return {
          success: true,
          data: tools.map(tool => ({
            name: tool.name,
            actions: tool.inputSchema?.properties?.action?.enum ?? [],
          })),
        }
      default:
        return {
          success: false,
          error: `Unsupported action '${args.action}' for tool_registry. Available actions: list, describe, actions`,
          instruction: 'Retry tool_registry with action set to one of: list, describe, actions.',
        }
    }
  }

  private async handleComponentEventBinding(args: ToolArguments): Promise<ToolResponse> {
    const nodeUuid = typeof args.nodeUuid === 'string' ? args.nodeUuid : ''
    const componentType = typeof args.componentType === 'string' ? args.componentType : 'cc.Button'

    if (!nodeUuid) {
      return {
        success: false,
        error: 'component_event_binding requires nodeUuid',
        instruction: 'Call node_query or scene_hierarchy to find the Button node UUID, then retry with nodeUuid.',
      }
    }

    try {
      const componentInfo = await this.getRawComponentInfo(nodeUuid, componentType)
      if (!componentInfo) {
        return {
          success: false,
          error: `Component ${componentType} not found on node ${nodeUuid}`,
          instruction: 'Call component_query.get_components with this nodeUuid to confirm the Button componentType/cid, then retry.',
        }
      }

      const fieldName = getButtonEventFieldName(componentInfo.component)
      const currentEvents = getButtonEvents(componentInfo.component, fieldName)

      switch (args.action) {
        case 'get_button_events':
          return {
            success: true,
            data: {
              nodeUuid,
              componentType,
              fieldName,
              events: currentEvents,
              count: currentEvents.length,
            },
          }
        case 'clear_button_events':
          await this.setRawComponentProperty(nodeUuid, componentInfo.index, fieldName, [])
          return {
            success: true,
            data: {
              nodeUuid,
              componentType,
              cleared: true,
              count: 0,
            },
          }
        case 'set_button_events': {
          const events = Array.isArray(args.events) ? args.events : []
          await this.setRawComponentProperty(nodeUuid, componentInfo.index, fieldName, events)
          return {
            success: true,
            data: {
              nodeUuid,
              componentType,
              fieldName,
              count: events.length,
              events,
            },
          }
        }
        case 'append_button_event': {
          const nextEvents = [
            ...currentEvents,
            buildButtonClickEvent(args),
          ]
          await this.setRawComponentProperty(nodeUuid, componentInfo.index, fieldName, nextEvents)
          return {
            success: true,
            data: {
              nodeUuid,
              componentType,
              fieldName,
              count: nextEvents.length,
              events: nextEvents,
            },
          }
        }
        default:
          return {
            success: false,
            error: `Unsupported action '${args.action}' for component_event_binding. Available actions: get_button_events, clear_button_events, set_button_events, append_button_event`,
            instruction: 'Retry component_event_binding with action set to one of: get_button_events, clear_button_events, set_button_events, append_button_event.',
          }
      }
    }
    catch (error: unknown) {
      return {
        success: false,
        error: `Failed to process component event binding: ${error instanceof Error ? error.message : String(error)}`,
        instruction: 'Confirm nodeUuid, Button componentType/cid, targetNodeUuid, component name, and handler name before retrying.',
      }
    }
  }

  private async getRawComponentInfo(nodeUuid: string, componentType: string): Promise<{ index: number, component: Record<string, unknown> } | null> {
    const nodeData = await requestScene('query-node', nodeUuid)
    if (!nodeData || !Array.isArray(nodeData.__comps__)) {
      return null
    }

    const exactIndex = nodeData.__comps__.findIndex(component => componentMatchesType(component, componentType))
    if (exactIndex >= 0) {
      return {
        index: exactIndex,
        component: nodeData.__comps__[exactIndex] as Record<string, unknown>,
      }
    }

    return null
  }

  private async setRawComponentProperty(nodeUuid: string, componentIndex: number, fieldName: string, value: unknown): Promise<void> {
    await requestScene('set-property', {
      uuid: nodeUuid,
      path: `__comps__.${componentIndex}.${fieldName}`,
      dump: { value },
    })
  }
}
