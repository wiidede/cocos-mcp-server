import type { JsonSchema, MCPServerSettings, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import packageMetadata from '../../package.json'
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
import { errorCodeForCategory, toolFailure } from './tool-response'
import { ValidationTools } from './validation-tools'

interface ToolInfoProvider {
  getSettings?: () => MCPServerSettings
  getToolDefinitions?: () => ToolDefinition[]
}

type ToolArguments = Record<string, unknown>

interface ActionSpec {
  name: string
  description: string
  properties?: string[]
  required?: string[]
  requiredAnyOf?: string[][]
  example?: Record<string, unknown>
  status?: 'supported' | 'deprecated' | 'unsupported'
  unsupportedReason?: string
}

type RegisteredTool = ToolDefinition & {
  execute: (args: ToolArguments) => Promise<ToolResponse>
  actionSpecs?: ActionSpec[]
}

export type LegacyPrefix
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

export type LegacyExecutorOverrides = Partial<Record<LegacyPrefix, ToolExecutor>>

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
  undoId: PROP.string('Undo recording ID returned by scene_undo.begin'),
  uuids: {
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      { type: 'null' },
    ],
    description: 'Single UUID, UUID list, or null when the action supports an all-targets operation',
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
  components: PROP.array('Component type names to add when creating the node', { type: 'string' }),
  initialTransform: PROP.object('Initial position, rotation, and scale to apply after node creation'),
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
  private readonly legacy: Record<LegacyPrefix, ToolExecutor>

  private readonly tools: RegisteredTool[]

  constructor(
    private readonly infoProvider: ToolInfoProvider = {},
    legacyOverrides: LegacyExecutorOverrides = {},
  ) {
    this.legacy = {
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
      ...legacyOverrides,
    }
    this.tools = this.buildTools()
  }

  public getTools(): ToolDefinition[] {
    return this.tools.map(({ execute, actionSpecs: _actionSpecs, ...tool }) => tool)
  }

  public async execute(name: string, args: unknown): Promise<ToolResponse> {
    const tool = this.tools.find(item => item.name === name)
    if (!tool) {
      throw new Error(`Tool ${name} not found`)
    }
    if (!this.isToolArguments(args)) {
      return toolFailure(`Tool ${name} requires an object argument`, {
        data: { toolName: name, attempted: args, allowedProperties: ['action'] },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName: name }, allowed: ['action'] },
        instruction: 'Call tools/list or tool_registry.describe, then retry with a JSON object containing an action.',
      })
    }
    const contractFailure = this.getActionContractFailure(name, tool.actionSpecs, args)
    return contractFailure ?? tool.execute(args)
  }

  private buildTools(): RegisteredTool[] {
    return [
      this.createTool(
        'scene_lifecycle',
        'Manage scene files and lifecycle. Query current scene before writes; save after structural changes when persistence is required. `open` requires `scenePath` (for example `db://assets/scenes/Main.scene`); `path` is not accepted by this action. Opening the already-current scene is a Cocos no-op and does not reload externally edited files; use soft_reload instead. Actions: get_current, list, open, save, create, save_as, close, soft_reload.',
        ['get_current', 'list', 'open', 'save', 'create', 'save_as', 'close', 'soft_reload'],
        ['scenePath', 'sceneName', 'savePath', 'autoCreateCanvas'],
        args => this.routeLegacyAction('scene_lifecycle', {
          get_current: 'scene_get_current_scene',
          list: 'scene_get_scene_list',
          open: 'scene_open_scene',
          save: 'scene_save_scene',
          create: 'scene_create_scene',
          save_as: 'scene_save_scene_as',
          close: 'scene_close_scene',
          soft_reload: 'sceneAdvanced_soft_reload_scene',
        }, args),
        {},
        [
          { name: 'get_current', description: 'Get the currently open scene.' },
          { name: 'list', description: 'List project scenes.' },
          { name: 'open', description: 'Open a scene by asset URL.', properties: ['scenePath'], required: ['scenePath'], example: { action: 'open', scenePath: 'db://assets/scenes/Main.scene' } },
          { name: 'save', description: 'Save the current scene.' },
          { name: 'create', description: 'Create a scene at savePath. sceneName is optional and defaults to the filename in savePath.', properties: ['sceneName', 'savePath', 'autoCreateCanvas'], required: ['savePath'], example: { action: 'create', savePath: 'db://assets/scenes/Main.scene', sceneName: 'Main', autoCreateCanvas: true } },
          { name: 'save_as', description: 'Save the current scene at a new path.', properties: ['savePath'], required: ['savePath'] },
          { name: 'close', description: 'Close the current scene.' },
          { name: 'soft_reload', description: 'Soft-reload the current scene.' },
        ],
      ),
      this.createTool(
        'scene_hierarchy',
        'Read the editor scene hierarchy or a bounded subtree. Use this before node writes because node names are not unique. Actions: get_tree.',
        ['get_tree'],
        ['includeComponents', 'rootUuid', 'maxDepth'],
        args => this.routeLegacyAction('scene_hierarchy', {
          get_tree: 'scene_get_scene_hierarchy',
        }, args),
        {},
        [
          { name: 'get_tree', description: 'Read the scene hierarchy or a subtree with optional component details and depth limit.', properties: ['includeComponents', 'rootUuid', 'maxDepth'], example: { action: 'get_tree', includeComponents: true, maxDepth: 3 } },
        ],
      ),
      this.createTool(
        'scene_execution',
        'Run registered scene-side operations. For execute_component_method, `uuid` (the component instance UUID) and `name` (the component method name) are required. execute_scene_script requires the extension package name and exported method. execute_scene_script cannot evaluate arbitrary JavaScript. Actions: execute_component_method, execute_scene_script.',
        ['execute_component_method', 'execute_scene_script'],
        ['uuid', 'name', 'method', 'args'],
        args => this.routeLegacyAction('scene_execution', {
          execute_component_method: 'sceneAdvanced_execute_component_method',
          execute_scene_script: 'sceneAdvanced_execute_scene_script',
        }, args),
        {},
        [
          { name: 'execute_component_method', description: 'Run a registered method on a component instance.', properties: ['uuid', 'name', 'args'], required: ['uuid', 'name'] },
          { name: 'execute_scene_script', description: 'Run a registered extension scene method; arbitrary JavaScript is not allowed.', properties: ['name', 'method', 'args'], required: ['name', 'method'] },
        ],
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
        {},
        [
          { name: 'create', description: 'Create a scene snapshot before a risky edit.' },
          { name: 'abort', description: 'Abort and restore the active scene snapshot.' },
        ],
      ),
      this.createTool(
        'scene_query',
        'Query scene-level classes, components, script usage, readiness, and dirty state. Use before component writes when exact types are unknown. Actions: list_classes, list_components, check_component_has_script, get_info, check_ready, check_dirty.',
        ['list_classes', 'list_components', 'check_component_has_script', 'get_info', 'check_ready', 'check_dirty'],
        ['extends', 'className'],
        args => this.routeLegacyAction('scene_query', {
          list_classes: 'sceneAdvanced_query_scene_classes',
          list_components: 'sceneAdvanced_query_scene_components',
          check_component_has_script: 'sceneAdvanced_query_component_has_script',
          get_info: 'sceneAdvanced_query_scene_info',
          check_ready: 'sceneAdvanced_query_scene_ready',
          check_dirty: 'sceneAdvanced_query_scene_dirty',
        }, args),
        {},
        [
          { name: 'list_classes', description: 'List scene classes, optionally filtered by base class.', properties: ['extends'] },
          { name: 'list_components', description: 'List scene components.' },
          { name: 'check_component_has_script', description: 'Check whether a component has a script class.', properties: ['className'], required: ['className'] },
          { name: 'get_info', description: 'Get scene information.' },
          { name: 'check_ready', description: 'Check whether the scene is ready for operations.' },
          { name: 'check_dirty', description: 'Check whether the scene has unsaved changes.' },
        ],
      ),
      this.createTool(
        'scene_view_control',
        'Control the editor scene view and camera. Pass UUIDs from node_query/scene_hierarchy; use query tool first when current view state matters. Actions: set_gizmo_tool, set_gizmo_pivot, set_gizmo_coordinate, set_view_mode, set_grid_visible, set_icon_gizmo_3d, set_icon_gizmo_size, focus_nodes, align_camera_with_view, align_view_with_node, reset.',
        ['set_gizmo_tool', 'set_gizmo_pivot', 'set_gizmo_coordinate', 'set_view_mode', 'set_grid_visible', 'set_icon_gizmo_3d', 'set_icon_gizmo_size', 'focus_nodes', 'align_camera_with_view', 'align_view_with_node', 'reset'],
        ['name', 'type', 'visible', 'is3D', 'size', 'is2D', 'uuids'],
        args => this.routeLegacyAction('scene_view_control', {
          set_gizmo_tool: 'sceneView_change_gizmo_tool',
          set_gizmo_pivot: 'sceneView_change_gizmo_pivot',
          set_gizmo_coordinate: 'sceneView_change_gizmo_coordinate',
          set_view_mode: 'sceneView_change_view_mode_2d_3d',
          set_grid_visible: 'sceneView_set_grid_visible',
          set_icon_gizmo_3d: 'sceneView_set_icon_gizmo_3d',
          set_icon_gizmo_size: 'sceneView_set_icon_gizmo_size',
          focus_nodes: 'sceneView_focus_camera_on_nodes',
          align_camera_with_view: 'sceneView_align_camera_with_view',
          align_view_with_node: 'sceneView_align_view_with_node',
          reset: 'sceneView_reset_scene_view',
        }, args),
        {},
        [
          { name: 'set_gizmo_tool', description: 'Change the active gizmo tool.', properties: ['name'], required: ['name'], example: { action: 'set_gizmo_tool', name: 'position' } },
          { name: 'set_gizmo_pivot', description: 'Change the gizmo pivot mode.', properties: ['name'], required: ['name'] },
          { name: 'set_gizmo_coordinate', description: 'Change gizmo coordinates.', properties: ['type'], required: ['type'] },
          { name: 'set_view_mode', description: 'Switch the scene view between 2D and 3D.', properties: ['is2D'], required: ['is2D'] },
          { name: 'set_grid_visible', description: 'Show or hide the scene grid.', properties: ['visible'], required: ['visible'] },
          { name: 'set_icon_gizmo_3d', description: 'Set IconGizmo 3D mode.', properties: ['is3D'], required: ['is3D'] },
          { name: 'set_icon_gizmo_size', description: 'Set IconGizmo size.', properties: ['size'], required: ['size'] },
          { name: 'focus_nodes', description: 'Focus the scene camera on node UUIDs, or null for all.', properties: ['uuids'], required: ['uuids'] },
          { name: 'align_camera_with_view', description: 'Apply the scene view camera pose to the selected node.' },
          { name: 'align_view_with_node', description: 'Align the scene view to the selected node.' },
          { name: 'reset', description: 'Reset the scene view.' },
        ],
      ),
      this.createTool(
        'scene_view_query',
        'Query editor scene view state before view or camera changes. Actions: get_status, get_gizmo_tool, get_gizmo_pivot, get_gizmo_view_mode, get_gizmo_coordinate, get_view_mode, get_grid_visible, get_icon_gizmo_3d, get_icon_gizmo_size.',
        ['get_status', 'get_gizmo_tool', 'get_gizmo_pivot', 'get_gizmo_view_mode', 'get_gizmo_coordinate', 'get_view_mode', 'get_grid_visible', 'get_icon_gizmo_3d', 'get_icon_gizmo_size'],
        [],
        args => this.routeLegacyAction('scene_view_query', {
          get_status: 'sceneView_get_scene_view_status',
          get_gizmo_tool: 'sceneView_query_gizmo_tool_name',
          get_gizmo_pivot: 'sceneView_query_gizmo_pivot',
          get_gizmo_view_mode: 'sceneView_query_gizmo_view_mode',
          get_gizmo_coordinate: 'sceneView_query_gizmo_coordinate',
          get_view_mode: 'sceneView_query_view_mode_2d_3d',
          get_grid_visible: 'sceneView_query_grid_visible',
          get_icon_gizmo_3d: 'sceneView_query_icon_gizmo_3d',
          get_icon_gizmo_size: 'sceneView_query_icon_gizmo_size',
        }, args),
        {},
        [
          { name: 'get_status', description: 'Get complete scene-view status.' },
          { name: 'get_gizmo_tool', description: 'Get the active gizmo tool.' },
          { name: 'get_gizmo_pivot', description: 'Get the gizmo pivot mode.' },
          { name: 'get_gizmo_view_mode', description: 'Get the gizmo view/select mode.' },
          { name: 'get_gizmo_coordinate', description: 'Get the gizmo coordinate system.' },
          { name: 'get_view_mode', description: 'Get whether the scene view is 2D or 3D.' },
          { name: 'get_grid_visible', description: 'Get grid visibility.' },
          { name: 'get_icon_gizmo_3d', description: 'Get IconGizmo 3D mode.' },
          { name: 'get_icon_gizmo_size', description: 'Get IconGizmo size.' },
        ],
      ),
      this.createTool(
        'scene_undo',
        'Manage explicit editor undo records for multi-step scene edits. begin requires nodeUuid or nodeUuids containing every target whose state must be captured; label becomes the Undo menu tag. Save data.undoId and pass it to end or cancel. Actions: begin, end, cancel.',
        ['begin', 'end', 'cancel'],
        ['nodeUuid', 'nodeUuids', 'label', 'undoId'],
        args => this.routeLegacyAction('scene_undo', {
          begin: 'sceneAdvanced_begin_undo_recording',
          end: 'sceneAdvanced_end_undo_recording',
          cancel: 'sceneAdvanced_cancel_undo_recording',
        }, args),
        {},
        [
          { name: 'begin', description: 'Start an undo record for one node or a list of nodes. Exactly one of nodeUuid or nodeUuids is required.', properties: ['nodeUuid', 'nodeUuids', 'label'], requiredAnyOf: [['nodeUuid'], ['nodeUuids']], example: { action: 'begin', nodeUuid: '<node-uuid>', label: 'Move Player' } },
          { name: 'end', description: 'Commit an undo record.', properties: ['undoId'], required: ['undoId'] },
          { name: 'cancel', description: 'Cancel and discard an undo record.', properties: ['undoId'], required: ['undoId'] },
        ],
      ),
      this.createTool(
        'node_query',
        'Query nodes by UUID, name, pattern, or list all nodes. Use before write operations because node names are not unique. Actions: get, find, find_by_name, list, check_type.',
        ['get', 'find', 'find_by_name', 'list', 'check_type'],
        ['uuid', 'pattern', 'name', 'exactMatch'],
        args => this.routeLegacyAction('node_query', {
          get: 'node_get_node_info',
          find: 'node_find_nodes',
          find_by_name: 'node_find_node_by_name',
          list: 'node_get_all_nodes',
          check_type: 'node_detect_node_type',
        }, args),
        {},
        [
          { name: 'get', description: 'Get a node by UUID.', properties: ['uuid'], required: ['uuid'], example: { action: 'get', uuid: '<node-uuid>' } },
          { name: 'find', description: 'Find nodes by name pattern.', properties: ['pattern'], required: ['pattern'], example: { action: 'find', pattern: 'Player' } },
          { name: 'find_by_name', description: 'Find nodes by name.', properties: ['name', 'exactMatch'], required: ['name'], example: { action: 'find_by_name', name: 'Player', exactMatch: true } },
          { name: 'list', description: 'List all scene nodes.' },
          { name: 'check_type', description: 'Detect whether a node is 2D or 3D.', properties: ['uuid'], required: ['uuid'] },
        ],
      ),
      this.createTool(
        'node_lifecycle',
        'Create, delete, or duplicate nodes. Use node_query/scene_hierarchy first for target UUIDs; names are not stable identifiers. Actions: create, delete, duplicate.',
        ['create', 'delete', 'duplicate'],
        ['name', 'uuid', 'parentUuid', 'nodeType', 'siblingIndex', 'assetUuid', 'assetPath', 'components', 'unlinkPrefab', 'keepWorldTransform', 'includeChildren', 'initialTransform', 'position', 'rotation', 'scale'],
        args => this.routeLegacyAction('node_lifecycle', {
          create: 'node_create_node',
          delete: 'node_delete_node',
          duplicate: 'node_duplicate_node',
        }, args),
        {},
        [
          { name: 'create', description: 'Create an empty node, optionally add components, instantiate an asset, and apply an initial transform.', properties: ['name', 'parentUuid', 'nodeType', 'siblingIndex', 'components', 'assetUuid', 'assetPath', 'unlinkPrefab', 'keepWorldTransform', 'initialTransform', 'position', 'rotation', 'scale'], required: ['name'], example: { action: 'create', name: 'Player', nodeType: '3DNode', components: ['cc.MeshRenderer'] } },
          { name: 'delete', description: 'Delete a node.', properties: ['uuid', 'includeChildren'], required: ['uuid'] },
          { name: 'duplicate', description: 'Duplicate a node or prefab instance.', properties: ['uuid', 'parentUuid', 'assetUuid', 'assetPath', 'unlinkPrefab', 'keepWorldTransform'], required: ['uuid'] },
        ],
      ),
      this.createTool(
        'node_transform',
        'Set node position, rotation, or scale by UUID. Query the node first. Actions: set.',
        ['set'],
        ['uuid', 'position', 'rotation', 'scale'],
        args => this.routeLegacyAction('node_transform', {
          set: 'node_set_node_transform',
        }, args),
        {},
        [
          { name: 'set', description: 'Set one or more transform values.', properties: ['uuid', 'position', 'rotation', 'scale'], required: ['uuid'], example: { action: 'set', uuid: '<node-uuid>', position: { x: 0, y: 1, z: 0 } } },
        ],
      ),
      this.createTool(
        'node_hierarchy',
        'Move nodes to a new parent. Use UUIDs from node_query; keepWorldTransform controls whether visual placement is preserved. Actions: move.',
        ['move'],
        ['nodeUuid', 'newParentUuid', 'keepWorldTransform', 'siblingIndex'],
        args => this.routeLegacyAction('node_hierarchy', {
          move: 'node_move_node',
        }, args),
        {},
        [
          { name: 'move', description: 'Move a node to a new parent.', properties: ['nodeUuid', 'newParentUuid', 'keepWorldTransform', 'siblingIndex'], required: ['nodeUuid', 'newParentUuid'], example: { action: 'move', nodeUuid: '<node-uuid>', newParentUuid: '<parent-uuid>' } },
        ],
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
        {},
        [
          { name: 'copy', description: 'Copy one or more nodes to the editor clipboard.', properties: ['uuids'], required: ['uuids'] },
          { name: 'paste', description: 'Paste clipboard nodes under a target node.', properties: ['target', 'keepWorldTransform'], required: ['target'] },
          { name: 'cut', description: 'Cut one or more nodes to the editor clipboard.', properties: ['uuids'], required: ['uuids'] },
        ],
      ),
      this.createTool(
        'node_property',
        'Set or reset node properties/transforms, or edit array properties. Query node info first and pass exact property paths. Actions: set, reset, reset_transform, move_array_element, remove_array_element.',
        ['set', 'reset', 'reset_transform', 'move_array_element', 'remove_array_element'],
        ['uuid', 'property', 'value', 'path', 'target', 'offset', 'index'],
        args => this.routeLegacyAction('node_property', {
          set: 'node_set_node_property',
          reset: 'sceneAdvanced_reset_node_property',
          reset_transform: 'sceneAdvanced_reset_node_transform',
          move_array_element: 'sceneAdvanced_move_array_element',
          remove_array_element: 'sceneAdvanced_remove_array_element',
        }, args),
        {},
        [
          { name: 'set', description: 'Set a direct node property.', properties: ['uuid', 'property', 'value'], required: ['uuid', 'property', 'value'] },
          { name: 'reset', description: 'Reset one node property to its default.', properties: ['uuid', 'path'], required: ['uuid', 'path'], example: { action: 'reset', uuid: '<node-uuid>', path: 'position' } },
          { name: 'reset_transform', description: 'Reset node position, rotation, and scale.', properties: ['uuid'], required: ['uuid'] },
          { name: 'move_array_element', description: 'Move an array element by index offset.', properties: ['uuid', 'path', 'target', 'offset'], required: ['uuid', 'path', 'target', 'offset'] },
          { name: 'remove_array_element', description: 'Remove an array element by index.', properties: ['uuid', 'path', 'index'], required: ['uuid', 'path', 'index'] },
        ],
      ),
      this.createTool(
        'component_lifecycle',
        'Add or remove components on a node. Before remove, call component_query.list and prefer the returned component instance uuid; type and cid are also accepted. Actions: add, remove.',
        ['add', 'remove'],
        ['nodeUuid', 'componentType'],
        args => this.routeLegacyAction('component_lifecycle', {
          add: 'component_add_component',
          remove: 'component_remove_component',
        }, args),
        {},
        [
          { name: 'add', description: 'Add a component to a node.', properties: ['nodeUuid', 'componentType'], required: ['nodeUuid', 'componentType'], example: { action: 'add', nodeUuid: '<node-uuid>', componentType: 'cc.Camera' } },
          { name: 'remove', description: 'Remove a component from a node. First call component_query.list. Pass the component instance `uuid` returned there when available; `type`/`cid` are fallback identities only.', properties: ['nodeUuid', 'componentType'], required: ['nodeUuid', 'componentType'], example: { action: 'remove', nodeUuid: '<node-uuid>', componentType: '<component-instance-uuid>' } },
        ],
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
        {},
        [
          { name: 'attach', description: 'Attach a script component to a node.', properties: ['nodeUuid', 'scriptPath'], required: ['nodeUuid', 'scriptPath'], example: { action: 'attach', nodeUuid: '<node-uuid>', scriptPath: 'db://assets/scripts/Player.ts' } },
          { name: 'detach', description: 'Detach a script component from a node. First call component_query.list and pass the script component instance `uuid` as componentType; do not pass the script asset UUID.', properties: ['nodeUuid', 'componentType'], required: ['nodeUuid', 'componentType'], example: { action: 'detach', nodeUuid: '<node-uuid>', componentType: '<script-component-instance-uuid>' } },
        ],
      ),
      this.createTool(
        'component_query',
        'Query node components and component details. Use before component writes/removal to get actual componentType/cid and property names. Actions: list, get.',
        ['list', 'get'],
        ['nodeUuid', 'componentType', 'includeProperties'],
        args => this.routeLegacyAction('component_query', {
          list: 'component_get_components',
          get: 'component_get_component_info',
        }, args),
        {},
        [
          { name: 'list', description: 'List components attached to a node.', properties: ['nodeUuid', 'includeProperties'], required: ['nodeUuid'], example: { action: 'list', nodeUuid: '<node-uuid>' } },
          { name: 'get', description: 'Get one component’s details.', properties: ['nodeUuid', 'componentType', 'includeProperties'], required: ['nodeUuid', 'componentType'], example: { action: 'get', nodeUuid: '<node-uuid>', componentType: 'cc.Camera' } },
        ],
      ),
      this.createTool(
        'component_property',
        'Set a component property on a node. Query components first when componentType/cid or property names are unknown. `propertyType` is optional and is inferred from the Inspector declaration when omitted. For `propertyType: "component"`, pass either the target component instance UUID or a node UUID; a node UUID is resolved to the matching component instance (for example, a cc.Camera-typed property accepts the Camera node UUID). For cc.MeshRenderer, use `sharedMaterials` (or alias `materials`) with `propertyType: "assetArray"` and an array of material UUIDs. Vec3 declarations such as cc.BoxCollider.size require `{x,y,z}` and are written as Vec3 even if a caller supplies the ambiguous `size` type. Example: {"action":"set","nodeUuid":"<node-uuid>","componentType":"MyScript","property":"camera","propertyType":"component","value":"<camera-node-or-component-uuid>"}. Actions: set.',
        ['set'],
        ['nodeUuid', 'componentType', 'property', 'propertyType', 'value'],
        args => this.routeLegacyAction('component_property', {
          set: 'component_set_component_property',
        }, args),
        {},
        [
          { name: 'set', description: 'Set a component property.', properties: ['nodeUuid', 'componentType', 'property', 'propertyType', 'value'], required: ['nodeUuid', 'componentType', 'property', 'value'], example: { action: 'set', nodeUuid: '<node-uuid>', componentType: 'MyScript', property: 'camera', propertyType: 'component', value: '<camera-node-or-component-uuid>' } },
        ],
      ),
      this.createTool(
        'component_event',
        'Manage Button click event bindings. Query the Button component and target handler node first; set replaces all events, append preserves existing ones. Actions: list, clear, set, append.',
        ['list', 'clear', 'set', 'append'],
        ['nodeUuid', 'componentType', 'events', 'targetNodeUuid', 'component', 'handler', 'customEventData'],
        args => this.handleComponentEventBinding(args),
        {},
        [
          { name: 'list', description: 'Get Button click event bindings.', properties: ['nodeUuid', 'componentType'], required: ['nodeUuid'] },
          { name: 'clear', description: 'Remove all Button click event bindings.', properties: ['nodeUuid', 'componentType'], required: ['nodeUuid'] },
          { name: 'set', description: 'Replace all Button click event bindings.', properties: ['nodeUuid', 'componentType', 'events'], required: ['nodeUuid', 'events'] },
          { name: 'append', description: 'Append one Button click event binding.', properties: ['nodeUuid', 'componentType', 'targetNodeUuid', 'component', 'handler', 'customEventData'], required: ['nodeUuid', 'targetNodeUuid', 'component', 'handler'], example: { action: 'append', nodeUuid: '<button-node-uuid>', targetNodeUuid: '<handler-node-uuid>', component: 'GameController', handler: 'onStart' } },
        ],
      ),
      this.createTool(
        'component_catalog',
        'List available component types for adding new components. Use component_query for components already on a node. Actions: list.',
        ['list'],
        ['category'],
        args => this.routeLegacyAction('component_catalog', {
          list: 'component_get_available_components',
        }, args),
        {},
        [
          { name: 'list', description: 'List components available to add, optionally by category.', properties: ['category'] },
        ],
      ),
      this.createTool(
        'prefab_query',
        'Browse and inspect prefab assets. Use this before instantiate/update when prefabPath is unknown. Actions: list, load, get, validate.',
        ['list', 'load', 'get', 'validate'],
        ['folder', 'prefabPath'],
        args => this.routeLegacyAction('prefab_query', {
          list: 'prefab_get_prefab_list',
          load: 'prefab_load_prefab',
          get: 'prefab_get_prefab_info',
          validate: 'prefab_validate_prefab',
        }, args),
        {},
        [
          { name: 'list', description: 'List prefabs, optionally within a folder.', properties: ['folder'], example: { action: 'list', folder: 'db://assets/prefabs' } },
          { name: 'load', description: 'Load a prefab by asset path.', properties: ['prefabPath'], required: ['prefabPath'] },
          { name: 'get', description: 'Get detailed prefab information.', properties: ['prefabPath'], required: ['prefabPath'] },
          { name: 'validate', description: 'Validate a prefab file.', properties: ['prefabPath'], required: ['prefabPath'] },
        ],
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
        {},
        [
          { name: 'create', description: 'Create a prefab asset from a node.', properties: ['nodeUuid', 'savePath', 'prefabName'], required: ['nodeUuid', 'savePath', 'prefabName'], example: { action: 'create', nodeUuid: '<node-uuid>', savePath: 'db://assets/prefabs/Player.prefab', prefabName: 'Player' } },
          { name: 'duplicate', description: 'Duplicate a prefab asset.', properties: ['sourcePrefabPath', 'targetPrefabPath', 'newPrefabName'], required: ['sourcePrefabPath', 'targetPrefabPath'] },
        ],
      ),
      this.createTool(
        'prefab_instance',
        'Instantiate prefabs or revert/restore existing prefab instances. instantiate and restore only succeed after asset_reference.nodes_by_asset_uuid verifies the association. restore is not a generic conversion from an ordinary node. Actions: instantiate, revert, restore.',
        ['instantiate', 'revert', 'restore'],
        ['prefabPath', 'parentUuid', 'position', 'nodeUuid', 'assetUuid'],
        args => this.routeLegacyAction('prefab_instance', {
          instantiate: 'prefab_instantiate_prefab',
          revert: 'prefab_revert_prefab',
          restore: 'sceneAdvanced_restore_prefab',
        }, args),
        {},
        [
          { name: 'instantiate', description: 'Instantiate a prefab in the scene.', properties: ['prefabPath', 'parentUuid', 'position'], required: ['prefabPath'], example: { action: 'instantiate', prefabPath: 'db://assets/prefabs/Player.prefab', parentUuid: '<parent-uuid>' } },
          { name: 'revert', description: 'Discard overrides on a prefab instance.', properties: ['nodeUuid'], required: ['nodeUuid'] },
          { name: 'restore', description: 'Restore and verify a prefab instance association through scene IPC.', properties: ['nodeUuid', 'assetUuid'], required: ['nodeUuid', 'assetUuid'] },
        ],
      ),
      this.createTool(
        'prefab_edit',
        'Apply or discard prefab instance overrides. Use apply to write instance changes back to the prefab asset; use revert to discard them. Actions: apply, revert.',
        ['apply', 'revert'],
        ['prefabPath', 'nodeUuid'],
        args => this.routeLegacyAction('prefab_edit', {
          apply: 'prefab_update_prefab',
          revert: 'prefab_revert_prefab',
        }, args),
        {},
        [
          { name: 'apply', description: 'Apply an instance’s overrides to its prefab asset.', properties: ['prefabPath', 'nodeUuid'], required: ['prefabPath', 'nodeUuid'] },
          { name: 'revert', description: 'Discard prefab instance overrides.', properties: ['nodeUuid'], required: ['nodeUuid'] },
        ],
      ),
      this.createTool(
        'asset_lifecycle',
        'Create, import, move, delete, save, reimport, or refresh assets. Query/generate URLs first and distinguish asset URL from filesystem path. Actions: import, create, copy, move, delete, save, reimport, refresh, open_external, create_default_spriteframe.',
        ['import', 'create', 'copy', 'move', 'delete', 'save', 'reimport', 'refresh', 'open_external', 'create_default_spriteframe'],
        ['sourcePath', 'targetFolder', 'url', 'content', 'overwrite', 'source', 'target', 'urlOrUUID', 'color', 'size', 'savePath', 'folder'],
        args => this.routeLegacyAction('asset_lifecycle', {
          import: 'project_import_asset',
          create: 'project_create_asset',
          copy: 'project_copy_asset',
          move: 'project_move_asset',
          delete: 'project_delete_asset',
          save: 'project_save_asset',
          reimport: 'project_reimport_asset',
          refresh: 'project_refresh_assets',
          open_external: 'assetAdvanced_open_asset_external',
          create_default_spriteframe: 'assetAdvanced_create_default_spriteframe',
        }, args),
        {},
        [
          { name: 'import', description: 'Import a filesystem asset into a project folder. Existing target files are replaced by default; set overwrite=false to reject collisions.', properties: ['sourcePath', 'targetFolder', 'overwrite'], required: ['sourcePath', 'targetFolder'], example: { action: 'import', sourcePath: '/absolute/path/to/Player.png', targetFolder: 'db://assets/textures', overwrite: true } },
          { name: 'create', description: 'Create an asset at an asset URL.', properties: ['url', 'content', 'overwrite'], required: ['url'] },
          { name: 'copy', description: 'Copy an asset URL.', properties: ['source', 'target', 'overwrite'], required: ['source', 'target'] },
          { name: 'move', description: 'Move an asset URL.', properties: ['source', 'target', 'overwrite'], required: ['source', 'target'] },
          { name: 'delete', description: 'Delete an asset by URL.', properties: ['url'], required: ['url'] },
          { name: 'save', description: 'Save text content to an asset URL.', properties: ['url', 'content'], required: ['url', 'content'] },
          { name: 'reimport', description: 'Reimport an asset by URL.', properties: ['url'], required: ['url'] },
          { name: 'refresh', description: 'Refresh the asset database after external file changes.', properties: ['folder'], example: { action: 'refresh', folder: 'db://assets/scripts/core' } },
          { name: 'open_external', description: 'Open an asset in its external application.', properties: ['urlOrUUID'], required: ['urlOrUUID'] },
          { name: 'create_default_spriteframe', description: 'Create a solid-color SpriteFrame asset.', properties: ['savePath', 'color', 'size'], example: { action: 'create_default_spriteframe', savePath: 'db://assets/mcp/default-sprite.png', color: '#ffffff', size: 8 } },
        ],
      ),
      this.createTool(
        'asset_query',
        'Query asset identities and database records. Use resolve_identity before asset writes; it accepts either an asset URL or UUID and returns URL, UUID, and filesystem path. Actions: resolve_identity, get, list, find_by_name, get_details, generate_available_url, check_database_ready.',
        ['resolve_identity', 'get', 'list', 'find_by_name', 'get_details', 'generate_available_url', 'check_database_ready'],
        ['assetPath', 'folder', 'type', 'url', 'uuid', 'name', 'exactMatch', 'assetType', 'maxResults', 'includeSubAssets'],
        args => this.routeLegacyAction('asset_query', {
          resolve_identity: 'project_resolve_asset_identity',
          get: 'project_get_asset_info',
          list: 'project_get_assets',
          find_by_name: 'project_find_asset_by_name',
          get_details: 'project_get_asset_details',
          generate_available_url: 'assetAdvanced_generate_available_url',
          check_database_ready: 'assetAdvanced_query_asset_db_ready',
        }, args),
        {},
        [
          { name: 'resolve_identity', description: 'Resolve an asset URL or UUID to its canonical URL, UUID, and filesystem path.', properties: ['urlOrUUID'], required: ['urlOrUUID'], example: { action: 'resolve_identity', urlOrUUID: 'db://assets/prefabs/Player.prefab' } },
          { name: 'get', description: 'Get asset information by asset path.', properties: ['assetPath'], required: ['assetPath'] },
          { name: 'list', description: 'List assets, optionally filtered by type or folder.', properties: ['type', 'folder'] },
          { name: 'find_by_name', description: 'Find assets by name.', properties: ['name', 'assetType', 'maxResults'], required: ['name'] },
          { name: 'get_details', description: 'Get detailed asset information by URL or UUID.', properties: ['urlOrUUID', 'includeSubAssets'], required: ['urlOrUUID'] },
          { name: 'generate_available_url', description: 'Generate an unused asset URL based on a requested URL.', properties: ['url'], required: ['url'], example: { action: 'generate_available_url', url: 'db://assets/NewScript.ts' } },
          { name: 'check_database_ready', description: 'Check whether the Cocos asset database is ready.' },
        ],
      ),
      this.createTool(
        'asset_analyze',
        'Validate asset references, optionally in one directory. Actions: validate_references.',
        ['validate_references'],
        ['directory'],
        args => this.routeLegacyAction('asset_analyze', {
          validate_references: 'assetAdvanced_validate_asset_references',
        }, args),
        {},
        [
          { name: 'validate_references', description: 'Validate asset references, optionally under one directory.', properties: ['directory'] },
        ],
      ),
      this.createTool(
        'asset_batch',
        'Run batch asset operations. Prefer dry planning with asset_query first; delete is destructive. Actions: import, delete, export_manifest.',
        ['import', 'delete', 'export_manifest'],
        ['sourceDirectory', 'targetDirectory', 'fileFilter', 'recursive', 'overwrite', 'urls', 'directory', 'format', 'includeMetadata'],
        args => this.routeLegacyAction('asset_batch', {
          import: 'assetAdvanced_batch_import_assets',
          delete: 'assetAdvanced_batch_delete_assets',
          export_manifest: 'assetAdvanced_export_asset_manifest',
        }, args),
        {},
        [
          { name: 'import', description: 'Import files from a filesystem directory.', properties: ['sourceDirectory', 'targetDirectory', 'fileFilter', 'recursive', 'overwrite'], required: ['sourceDirectory', 'targetDirectory'] },
          { name: 'delete', description: 'Delete multiple asset URLs. This is destructive.', properties: ['urls'], required: ['urls'] },
          { name: 'export_manifest', description: 'Export an asset manifest.', properties: ['directory', 'format', 'includeMetadata'] },
        ],
      ),
      this.createTool(
        'asset_meta',
        'Write asset meta content. Use only after querying the target asset URL/UUID and preserving required meta fields. Actions: save.',
        ['save'],
        ['urlOrUUID', 'content'],
        args => this.routeLegacyAction('asset_meta', {
          save: 'assetAdvanced_save_asset_meta',
        }, args),
        {},
        [
          { name: 'save', description: 'Save serialized meta content for an asset.', properties: ['urlOrUUID', 'content'], required: ['urlOrUUID', 'content'] },
        ],
      ),
      this.createTool(
        'project_query',
        'Query project information and settings. Actions: get_info, get_settings.',
        ['get_info', 'get_settings'],
        ['category'],
        args => this.routeLegacyAction('project_query', {
          get_info: 'project_get_project_info',
          get_settings: 'project_get_project_settings',
        }, args),
        {},
        [
          { name: 'get_info', description: 'Get project information.' },
          { name: 'get_settings', description: 'Get project settings, optionally for one category.', properties: ['category'] },
        ],
      ),
      this.createTool(
        'project_build',
        'Inspect or trigger Cocos build workflows. Supported actions are only build, get_build_settings, open_build_panel, and check_builder_status; there is no get_config action. get_build_settings reports builder readiness and MCP limitations, not the complete per-platform configuration. Builds open the Editor Build panel for manual configuration. Example: {"action":"build","platform":"web-mobile","debug":true}. Actions: build, get_settings, open_panel, check_status.',
        ['build', 'get_settings', 'open_panel', 'check_status'],
        ['platform', 'debug'],
        args => this.routeLegacyAction('project_build', {
          build: 'project_build_project',
          get_settings: 'project_get_build_settings',
          open_panel: 'project_open_build_panel',
          check_status: 'project_check_builder_status',
        }, args),
        {},
        [
          { name: 'build', description: 'Open the Build panel for a platform.', properties: ['platform', 'debug'], required: ['platform'], example: { action: 'build', platform: 'web-mobile', debug: true } },
          { name: 'get_settings', description: 'Report builder readiness and MCP limitations.' },
          { name: 'open_panel', description: 'Open Creator’s Build panel.' },
          { name: 'check_status', description: 'Check whether the Builder service is ready.' },
        ],
      ),
      this.createTool(
        'project_runtime',
        'Preview entry points only. run opens the Build panel. Preview-server start/stop and status/URL queries are not exposed as supported MCP actions because Cocos provides no server-control IPC; start preview manually with Creator’s Project > Preview. Actions: run.',
        ['run'],
        ['platform'],
        args => this.routeLegacyAction('project_runtime', {
          run: 'project_run_project',
        }, args),
        {},
        [
          { name: 'run', description: 'Open the Build panel to run or preview a platform.', properties: ['platform'], example: { action: 'run', platform: 'web-mobile' } },
        ],
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
        {},
        [
          { name: 'get', description: 'Read recent editor console messages.', properties: ['limit', 'filter'] },
          { name: 'clear', description: 'Clear captured editor console messages.' },
        ],
      ),
      this.createTool(
        'debug_logs',
        'Read and search Cocos project/editor log files. Use targeted search patterns to reduce returned log volume. Actions: get, get_file_info, search.',
        ['get', 'get_file_info', 'search'],
        ['lines', 'filterKeyword', 'logLevel', 'pattern', 'maxResults', 'contextLines'],
        args => this.routeLegacyAction('debug_logs', {
          get: 'debug_get_project_logs',
          get_file_info: 'debug_get_log_file_info',
          search: 'debug_search_project_logs',
        }, args),
        {},
        [
          { name: 'get', description: 'Read recent project log lines.', properties: ['lines', 'filterKeyword', 'logLevel'] },
          { name: 'get_file_info', description: 'Get project log-file information.' },
          { name: 'search', description: 'Search project logs by pattern.', properties: ['pattern', 'maxResults', 'contextLines'], required: ['pattern'] },
        ],
      ),
      this.createTool(
        'debug_scene',
        'Validate scene performance and query editor environment information. Asset reference validation belongs to asset_analyze. Actions: validate, get_editor_info.',
        ['validate', 'get_editor_info'],
        ['checkPerformance'],
        args => this.routeLegacyAction('debug_scene', {
          validate: 'debug_validate_scene',
          get_editor_info: 'debug_get_editor_info',
        }, args),
        {},
        [
          { name: 'validate', description: 'Validate current scene performance.', properties: ['checkPerformance'] },
          { name: 'get_editor_info', description: 'Get editor and environment information.' },
        ],
      ),
      this.createTool(
        'debug_performance',
        'Get editor/game performance stats for diagnosis. The only action is `get_stats`. In edit mode it may return `{ available: false, reason, recommendedCollectionMethod }` because Cocos does not expose runtime counters there. Actions: get_stats.',
        ['get_stats'],
        [],
        args => this.routeLegacyAction('debug_performance', {
          get_stats: 'debug_get_performance_stats',
        }, args),
        {},
        [
          { name: 'get_stats', description: 'Get available editor/game performance statistics.' },
        ],
      ),
      this.createTool(
        'preferences',
        'Open, get, set, list, reset, or export editor preferences. Read current values before set/reset. Actions: open, get, set, list, reset, export.',
        ['open', 'get', 'set', 'list', 'reset', 'export'],
        ['tab', 'args', 'name', 'path', 'value', 'type', 'exportPath'],
        args => this.routeLegacyAction('preferences', {
          open: 'preferences_open_preferences_settings',
          get: 'preferences_query_preferences_config',
          set: 'preferences_set_preferences_config',
          list: 'preferences_get_all_preferences',
          reset: 'preferences_reset_preferences',
          export: 'preferences_export_preferences',
        }, args),
        {},
        [
          { name: 'open', description: 'Open the preferences settings panel.', properties: ['tab', 'args'] },
          { name: 'get', description: 'Query one preferences configuration value.', properties: ['name', 'path', 'type'], required: ['name'] },
          { name: 'set', description: 'Set one preferences configuration value.', properties: ['name', 'path', 'value', 'type'], required: ['name', 'path', 'value'] },
          { name: 'list', description: 'Get all available preference categories.' },
          { name: 'reset', description: 'Reset a preference category or all preferences.', properties: ['name', 'type'] },
          { name: 'export', description: 'Export preferences to a file.', properties: ['exportPath'] },
        ],
      ),
      this.createTool(
        'server_status',
        'Query MCP server address, port, and status metadata. Actions: list_ips, get_port, get_status.',
        ['list_ips', 'get_port', 'get_status'],
        [],
        args => this.routeLegacyAction('server_status', {
          list_ips: 'server_query_server_ip_list',
          get_port: 'server_query_server_port',
          get_status: 'server_get_server_status',
        }, args),
        {},
        [
          { name: 'list_ips', description: 'List server IP addresses.' },
          { name: 'get_port', description: 'Get the editor server port.' },
          { name: 'get_status', description: 'Get server status metadata.' },
        ],
      ),
      this.createTool(
        'server_network',
        'Check local network interfaces and MCP connectivity. Use when clients cannot connect. Actions: check_connectivity, list_interfaces.',
        ['check_connectivity', 'list_interfaces'],
        ['timeout'],
        args => this.routeLegacyAction('server_network', {
          check_connectivity: 'server_check_server_connectivity',
          list_interfaces: 'server_get_network_interfaces',
        }, args),
        {},
        [
          { name: 'check_connectivity', description: 'Check MCP server connectivity.', properties: ['timeout'] },
          { name: 'list_interfaces', description: 'List local network interfaces.' },
        ],
      ),
      this.createTool(
        'server_control',
        'Query MCP server health, settings, and currently available tools. Use list_available_tools to see the active filtered tool set. Actions: get_health, get_settings, list_available_tools.',
        ['get_health', 'get_settings', 'list_available_tools'],
        [],
        args => this.handleServerControl(args),
        {},
        [
          { name: 'get_health', description: 'Get MCP server health.' },
          { name: 'get_settings', description: 'Get active MCP server settings.' },
          { name: 'list_available_tools', description: 'List tools currently available through this MCP server.' },
        ],
      ),
      this.createTool(
        'broadcast',
        'Inspect and manage Cocos editor broadcast listeners/logs. Stop listeners when no longer needed. Actions: get_log, listen, stop, clear_log, list_active_listeners.',
        ['get_log', 'listen', 'stop', 'clear_log', 'list_active_listeners'],
        ['limit', 'messageType'],
        args => this.routeLegacyAction('broadcast', {
          get_log: 'broadcast_get_broadcast_log',
          listen: 'broadcast_listen_broadcast',
          stop: 'broadcast_stop_listening',
          clear_log: 'broadcast_clear_broadcast_log',
          list_active_listeners: 'broadcast_get_active_listeners',
        }, args),
        {},
        [
          { name: 'get_log', description: 'Read captured broadcast messages.', properties: ['limit', 'messageType'] },
          { name: 'listen', description: 'Start listening for a broadcast message type.', properties: ['messageType'], required: ['messageType'] },
          { name: 'stop', description: 'Stop listening for a broadcast message type.', properties: ['messageType'], required: ['messageType'] },
          { name: 'clear_log', description: 'Clear captured broadcast messages.' },
          { name: 'list_active_listeners', description: 'List active broadcast listeners.' },
        ],
      ),
      this.createTool(
        'reference_image',
        'Manage scene reference images. Query current/config before modifying position, scale, opacity, or active image. Actions: add, remove, switch, set_data, get_config, get_current, refresh, set_position, set_scale, set_opacity, list, clear.',
        ['add', 'remove', 'switch', 'set_data', 'get_config', 'get_current', 'refresh', 'set_position', 'set_scale', 'set_opacity', 'list', 'clear'],
        ['paths', 'path', 'sceneUUID', 'key', 'value', 'x', 'y', 'sx', 'sy', 'opacity'],
        args => this.routeLegacyAction('reference_image', {
          add: 'referenceImage_add_reference_image',
          remove: 'referenceImage_remove_reference_image',
          switch: 'referenceImage_switch_reference_image',
          set_data: 'referenceImage_set_reference_image_data',
          get_config: 'referenceImage_query_reference_image_config',
          get_current: 'referenceImage_query_current_reference_image',
          refresh: 'referenceImage_refresh_reference_image',
          set_position: 'referenceImage_set_reference_image_position',
          set_scale: 'referenceImage_set_reference_image_scale',
          set_opacity: 'referenceImage_set_reference_image_opacity',
          list: 'referenceImage_list_reference_images',
          clear: 'referenceImage_clear_all_reference_images',
        }, args),
        {},
        [
          { name: 'add', description: 'Add reference images from absolute paths.', properties: ['paths'], required: ['paths'] },
          { name: 'remove', description: 'Remove reference images, or the current image when paths is omitted.', properties: ['paths'] },
          { name: 'switch', description: 'Switch to a reference image.', properties: ['path', 'sceneUUID'], required: ['path'] },
          { name: 'set_data', description: 'Set one reference-image data property.', properties: ['key', 'value'], required: ['key', 'value'] },
          { name: 'get_config', description: 'Get reference-image configuration.' },
          { name: 'get_current', description: 'Get the current reference image.' },
          { name: 'refresh', description: 'Refresh reference-image display.' },
          { name: 'set_position', description: 'Set reference-image position.', properties: ['x', 'y'], required: ['x', 'y'] },
          { name: 'set_scale', description: 'Set reference-image scale.', properties: ['sx', 'sy'], required: ['sx', 'sy'] },
          { name: 'set_opacity', description: 'Set reference-image opacity.', properties: ['opacity'], required: ['opacity'] },
          { name: 'list', description: 'List reference images.' },
          { name: 'clear', description: 'Clear all reference images.' },
        ],
      ),
      this.createTool(
        'validation_params',
        'Validate or format MCP parameters before risky calls. Useful when generating JSON arguments programmatically. Actions: validate_json, sanitize_string, format_request.',
        ['validate_json', 'sanitize_string', 'format_request'],
        ['jsonString', 'expectedSchema', 'value', 'toolName', 'arguments'],
        args => this.routeLegacyAction('validation_params', {
          validate_json: 'validation_validate_json_params',
          sanitize_string: 'validation_safe_string_value',
          format_request: 'validation_format_mcp_request',
        }, args),
        {},
        [
          { name: 'validate_json', description: 'Validate and repair JSON parameters.', properties: ['jsonString', 'expectedSchema'], required: ['jsonString'] },
          { name: 'sanitize_string', description: 'Create a JSON-safe string value.', properties: ['value'], required: ['value'] },
          { name: 'format_request', description: 'Format a complete MCP request.', properties: ['toolName', 'arguments'], required: ['toolName', 'arguments'] },
        ],
      ),
      this.createTool(
        'asset_reference',
        'Cross-reference assets and scene nodes. Query the asset UUID first, then find dependent scene nodes. Actions: nodes_by_asset_uuid.',
        ['nodes_by_asset_uuid'],
        ['assetUuid'],
        args => this.routeLegacyAction('asset_reference', {
          nodes_by_asset_uuid: 'sceneAdvanced_query_nodes_by_asset_uuid',
        }, args),
        {},
        [
          { name: 'nodes_by_asset_uuid', description: 'Find scene nodes that reference an asset.', properties: ['assetUuid'], required: ['assetUuid'] },
        ],
      ),
      this.createTool(
        'tool_registry',
        'Inspect available MCP tools and action names when uncertain. Use describe before guessing parameters. Actions: list, describe, list_actions.',
        ['list', 'describe', 'list_actions'],
        ['toolName'],
        args => this.handleToolRegistry(args),
        {},
        [
          { name: 'list', description: 'List public MCP tools.' },
          { name: 'describe', description: 'Get an action-specific contract for one tool.', properties: ['toolName'], required: ['toolName'], example: { action: 'describe', toolName: 'node_lifecycle' } },
          { name: 'list_actions', description: 'List action names and statuses for all tools.' },
        ],
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
    actionSpecs?: ActionSpec[],
  ): RegisteredTool {
    const requirements = Array.isArray(actionRequirements)
      ? actionRequirements
      : Object.entries(actionRequirements).map(([action, required]) => ({ action, required }))
    const specs = actionSpecs?.map(spec => ({ status: 'supported' as const, properties: [], required: [], ...spec }))
    const supportedSpecs = specs?.filter(spec => spec.status !== 'unsupported')
    const actionNames = supportedSpecs?.map(spec => spec.name) ?? actions
    const actionPropertyKeys = supportedSpecs
      ? [...new Set(supportedSpecs.flatMap(spec => spec.properties))]
      : propertyKeys
    const schemaActions = supportedSpecs?.map(({ name: action, properties, required, requiredAnyOf }) => ({
      type: 'object',
      properties: {
        action: { type: 'string', enum: [action] },
        ...pickProps(properties),
      },
      required: ['action', ...required],
      additionalProperties: false,
      ...(requiredAnyOf && requiredAnyOf.length > 0
        ? { anyOf: requiredAnyOf.map(fields => ({ required: fields })) }
        : {}),
    }))
    const anyOf = specs
      ? undefined
      : requirements.map(({ action, required }) => ({
          properties: {
            action: { type: 'string', enum: [action] },
          },
          required: ['action', ...required],
        }))
    return {
      name,
      description: this.createPublicDescription(description, actionNames),
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: actionNames,
            description: `Operation code. Available actions: ${actionNames.join(', ')}`,
          },
          ...pickProps(actionPropertyKeys),
        },
        required: ['action'],
        ...(schemaActions ? { oneOf: schemaActions } : {}),
        ...(anyOf && anyOf.length > 0 ? { anyOf } : {}),
      },
      execute,
      actionSpecs: specs,
    }
  }

  private createPublicDescription(description: string, actions: string[]): string {
    const overview = description.replace(/\s*Actions:[^.]+\.\s*$/, '').trim()
    return `${overview} Actions: ${actions.length > 0 ? actions.join(', ') : 'none (inspect tool_registry.describe for legacy compatibility metadata)'}.`
  }

  private getActionContractFailure(toolName: string, specs: ActionSpec[] | undefined, args: ToolArguments): ToolResponse | undefined {
    if (!specs) {
      return undefined
    }

    const supportedActions = specs.filter(spec => spec.status !== 'unsupported').map(spec => spec.name)
    const action = args.action
    if (typeof action !== 'string' || !action) {
      return toolFailure(`${toolName} requires an action parameter`, {
        data: { toolName, attempted: args, allowedActions: supportedActions },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName }, attempted: args, allowed: ['action'] },
        instruction: `Call tool_registry.describe with toolName="${toolName}", then retry with one of: ${supportedActions.join(', ')}.`,
      })
    }

    const spec = specs.find(item => item.name === action)
    if (!spec) {
      return toolFailure(`Unsupported action '${action}' for ${toolName}`, {
        data: { toolName, action, attempted: args, allowedActions: supportedActions },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName }, attempted: args, allowed: ['action'] },
        instruction: `Call tool_registry.describe with toolName="${toolName}", then retry with one of: ${supportedActions.join(', ')}.`,
      })
    }

    const allowed = ['action', ...(spec.properties ?? [])]
    if (spec.status === 'unsupported') {
      return toolFailure(`Action '${action}' is unsupported for ${toolName}`, {
        data: { toolName, action, status: spec.status, reason: spec.unsupportedReason, attempted: args, allowedProperties: allowed },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName }, attempted: args, allowed },
        instruction: spec.unsupportedReason || `Call tool_registry.describe with toolName="${toolName}" to choose a supported action.`,
      })
    }

    const allowedSet = new Set(allowed)
    const unexpected = Object.keys(args).filter(key => !allowedSet.has(key))
    if (unexpected.length > 0) {
      return toolFailure(`Action '${action}' for ${toolName} does not accept: ${unexpected.join(', ')}`, {
        data: { toolName, action, attempted: args, allowedProperties: allowed },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName, action }, attempted: args, allowed },
        instruction: `Remove ${unexpected.join(', ')}. Allowed fields: ${allowed.join(', ')}. Call tool_registry.describe with toolName="${toolName}" for the complete contract.`,
      })
    }

    const missing = (spec.required ?? []).filter(key => !Object.hasOwn(args, key))
    if (missing.length > 0) {
      return toolFailure(`Action '${action}' for ${toolName} requires: ${missing.join(', ')}`, {
        data: { toolName, action, attempted: args, allowedProperties: allowed, missing, required: spec.required },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName, action }, attempted: args, allowed },
        instruction: `Add ${missing.join(', ')} and retry. Call tool_registry.describe with toolName="${toolName}" for an example.`,
      })
    }

    if (spec.requiredAnyOf && !spec.requiredAnyOf.some(group => group.every(key => Object.hasOwn(args, key)))) {
      const alternatives = spec.requiredAnyOf.map(group => group.join(' + ')).join(' or ')
      return toolFailure(`Action '${action}' for ${toolName} requires one of: ${alternatives}`, {
        data: { toolName, action, attempted: args, allowedProperties: allowed, requiredAnyOf: spec.requiredAnyOf },
        metadata: { category: 'contract', retryable: true, nextTool: 'tool_registry', nextAction: 'describe', retryWith: { toolName, action }, attempted: args, allowed },
        instruction: `Add ${alternatives} and retry. Call tool_registry.describe with toolName="${toolName}" for an example.`,
      })
    }

    return undefined
  }

  private async routeLegacyAction(toolName: string, actionMap: Record<string, string>, args: ToolArguments): Promise<ToolResponse> {
    const action = args?.action
    if (typeof action !== 'string' || !action) {
      return toolFailure(`${toolName} requires an action parameter`, {
        instruction: `Call tool_registry.list_actions or inspect tools/list, then retry with one of: ${Object.keys(actionMap).join(', ')}`,
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
    if (result.success) {
      return result
    }

    const error = result.error || ''
    const metadata = result.metadata ?? this.getFailureMetadata(toolName, action, error, args)
    const errorCode = result.errorCode && result.errorCode !== 'TOOL_EXECUTION_ERROR'
      ? result.errorCode
      : errorCodeForCategory(metadata?.category)
    return {
      ...result,
      errorCode,
      instruction: result.instruction || this.getFailureInstruction(toolName, action, error, args),
      metadata: metadata
        ? { ...metadata, attempted: metadata.attempted ?? { action, ...args } }
        : undefined,
    }
  }

  private getFailureMetadata(toolName: string, action: string, error: string, args: ToolArguments): import('../types').ToolResponse['metadata'] {
    const lowerError = error.toLowerCase()
    const attempted = { action, ...args }

    if (lowerError.includes('not found') && (toolName.startsWith('component') || lowerError.includes('component'))) {
      return { category: 'component', retryable: true, nextTool: 'component_query', nextAction: 'list', retryWith: { nodeUuid: args.nodeUuid }, attempted }
    }
    if (lowerError.includes('node') && (lowerError.includes('not found') || lowerError.includes('failed'))) {
      return { category: 'target', retryable: true, nextTool: 'node_query', nextAction: 'get_info', retryWith: { uuid: args.nodeUuid ?? args.uuid }, attempted }
    }
    if (toolName.startsWith('asset') || toolName.startsWith('project_asset') || toolName.startsWith('project_query') || lowerError.includes('asset')) {
      return { category: 'asset', retryable: true, nextTool: 'asset_query', nextAction: 'details', retryWith: { urlOrUUID: args.urlOrUUID ?? args.url ?? args.assetPath ?? args.uuid }, attempted }
    }
    if (lowerError.includes('editor.message') || lowerError.includes('ipc') || lowerError.includes('message')) {
      return { category: 'ipc', retryable: true, nextTool: 'debug_logs', nextAction: 'search', attempted }
    }
    return { category: 'unknown', retryable: false, attempted }
  }

  private getFailureInstruction(toolName: string, action: string, error: string, args: ToolArguments): string | undefined {
    const lowerError = error.toLowerCase()

    if (toolName === 'scene_execution' && action === 'execute_scene_script') {
      return 'execute_scene_script cannot run arbitrary JavaScript. Use name="cocos-mcp-server" with a method exported by source/scene.ts, call a dedicated MCP tool, or add and register a new scene method in the extension before calling it.'
    }

    if (lowerError.includes('requires') && lowerError.includes('uuid')) {
      return 'Query the target first with node_query or scene_hierarchy, then retry with the returned UUID.'
    }

    if (lowerError.includes('node') && (lowerError.includes('not found') || lowerError.includes('invalid response') || lowerError.includes('failed to get node'))) {
      return 'Call node_query.get_all, node_query.find, or scene_hierarchy.get to confirm the node exists and use its exact UUID before retrying.'
    }

    if (toolName.startsWith('component') || lowerError.includes('component')) {
      if (lowerError.includes('not found') || lowerError.includes('type') || lowerError.includes('cid') || lowerError.includes('verify')) {
        return 'Call component_query.list with the nodeUuid, then retry using the returned component instance uuid, type, or cid. Prefer uuid for removal; use component_catalog.list only when adding a new component.'
      }
      return 'Call component_query.list first to confirm the nodeUuid, component instance uuid/type/cid, and property names before retrying.'
    }

    if (toolName.startsWith('prefab') || lowerError.includes('prefab') || lowerError.includes('预制体')) {
      if (action === 'update' || action === 'revert') {
        return 'Call node_query.get_info for the prefab instance nodeUuid. Use prefab_edit.update to apply overrides to the asset, or prefab_edit.revert to discard instance overrides.'
      }
      return 'Use prefab_query.list/info or asset_query.find_by_name to confirm the prefabPath or assetUuid, then retry with the exact prefab identity.'
    }

    if (toolName.startsWith('asset') || toolName.startsWith('project_asset') || toolName.startsWith('project_query') || lowerError.includes('asset')) {
      return 'Use asset_query to convert between filesystem path, asset URL, and UUID. Retry with the exact field expected by this action.'
    }

    if (lowerError.includes('query-node-tree') || lowerError.includes('query-node') || lowerError.includes('editor.message') || lowerError.includes('message')) {
      return 'This looks like a Cocos Editor IPC failure. Use debug_console.get or debug_logs.search for details, and avoid guessing unsupported Editor message names.'
    }

    if (toolName.startsWith('scene')) {
      return 'Query scene readiness and hierarchy first with scene_query.check_ready and scene_hierarchy.get_tree, then retry the scene operation.'
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
      case 'get_health':
        return {
          success: true,
          data: {
            status: 'ok',
            version: packageMetadata.version,
            tools: this.getTools().length,
            settings: this.infoProvider.getSettings ? this.infoProvider.getSettings() : null,
          },
        }
      case 'get_settings':
        return {
          success: true,
          data: this.infoProvider.getSettings ? this.infoProvider.getSettings() : null,
        }
      case 'list_available_tools':
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
          error: `Unsupported action '${args.action}' for server_control. Available actions: get_health, get_settings, list_available_tools`,
          instruction: 'Retry server_control with action set to one of: get_health, get_settings, list_available_tools.',
        }
    }
  }

  private async handleToolRegistry(args: ToolArguments): Promise<ToolResponse> {
    const tools = this.tools
    const publicTools = tools
    switch (args.action) {
      case 'list':
        return {
          success: true,
          data: {
            count: publicTools.length,
            tools: publicTools.map(tool => ({
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
          data: {
            name: target.name,
            description: target.description,
            inputSchema: target.inputSchema,
            actions: target.actionSpecs?.map(spec => ({
              name: spec.name,
              description: spec.description,
              required: spec.required,
              requiredAnyOf: spec.requiredAnyOf,
              properties: spec.properties,
              example: spec.example,
              status: spec.status,
              unsupportedReason: spec.unsupportedReason,
            })),
          },
        }
      }
      case 'list_actions':
        return {
          success: true,
          data: publicTools.map(tool => ({
            name: tool.name,
            actions: tool.actionSpecs?.map(spec => ({
              name: spec.name,
              status: spec.status,
            })) ?? tool.inputSchema?.properties?.action?.enum ?? [],
          })),
        }
      default:
        return {
          success: false,
          error: `Unsupported action '${args.action}' for tool_registry. Available actions: list, describe, list_actions`,
          instruction: 'Retry tool_registry with action set to one of: list, describe, list_actions.',
        }
    }
  }

  private async handleComponentEventBinding(args: ToolArguments): Promise<ToolResponse> {
    const nodeUuid = typeof args.nodeUuid === 'string' ? args.nodeUuid : ''
    const componentType = typeof args.componentType === 'string' ? args.componentType : 'cc.Button'

    if (!nodeUuid) {
      return {
        success: false,
        error: 'component_event requires nodeUuid',
        instruction: 'Call node_query or scene_hierarchy to find the Button node UUID, then retry with nodeUuid.',
      }
    }

    try {
      const componentInfo = await this.getRawComponentInfo(nodeUuid, componentType)
      if (!componentInfo) {
        return {
          success: false,
          error: `Component ${componentType} not found on node ${nodeUuid}`,
          instruction: 'Call component_query.list with this nodeUuid to confirm the Button componentType/cid, then retry.',
        }
      }

      const fieldName = getButtonEventFieldName(componentInfo.component)
      const currentEvents = getButtonEvents(componentInfo.component, fieldName)

      switch (args.action) {
        case 'list':
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
        case 'clear':
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
        case 'set': {
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
        case 'append': {
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
            error: `Unsupported action '${args.action}' for component_event. Available actions: list, clear, set, append`,
            instruction: 'Retry component_event with action set to one of: list, clear, set, append.',
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
