import type { AssetInfo, ProjectInfo, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { filterAssetsByName } from './project-asset'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

interface BuildProjectInput extends ToolArguments {
  platform: string
  debug?: boolean
}

interface FindAssetInput extends ToolArguments {
  name: string
  exactMatch?: boolean
  assetType?: string
  folder?: string
  maxResults?: number
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssetContent(value: unknown): value is string | Record<string, unknown> | unknown[] | null {
  return value === null || typeof value === 'string' || (typeof value === 'object' && value !== null)
}

function summarizeAssetContent(value: unknown): Record<string, unknown> {
  if (value === null)
    return { type: 'null' }
  if (typeof value === 'string')
    return { type: 'string', chars: value.length }
  if (Array.isArray(value))
    return { type: 'array', items: value.length }
  if (typeof value === 'object' && value !== null)
    return { type: 'object', keys: Object.keys(value).length }
  return { type: typeof value }
}

function serializeAssetContent(value: string | Record<string, unknown> | unknown[] | null | undefined): string | null {
  if (value === undefined || value === null)
    return null
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export class ProjectTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'run_project',
        description: 'Run the project in preview mode',
        inputSchema: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              description: 'Target platform',
              enum: ['browser', 'simulator', 'preview'],
              default: 'browser',
            },
          },
        },
      },
      {
        name: 'build_project',
        description: 'Build the project',
        inputSchema: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              description: 'Build platform',
              enum: ['web-mobile', 'web-desktop', 'ios', 'android', 'windows', 'mac'],
            },
            debug: {
              type: 'boolean',
              description: 'Debug build',
              default: true,
            },
          },
          required: ['platform'],
        },
      },
      {
        name: 'get_project_info',
        description: 'Get project information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_project_settings',
        description: 'Get project settings',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Settings category',
              enum: ['general', 'physics', 'render', 'assets'],
              default: 'general',
            },
          },
        },
      },
      {
        name: 'refresh_assets',
        description: 'Refresh asset database',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Specific folder to refresh (optional)',
            },
          },
        },
      },
      {
        name: 'import_asset',
        description: 'Import an asset file',
        inputSchema: {
          type: 'object',
          properties: {
            sourcePath: {
              type: 'string',
              description: 'Source file path',
            },
            targetFolder: {
              type: 'string',
              description: 'Target folder in assets',
            },
            overwrite: {
              type: 'boolean',
              description: 'Replace an existing target asset; false rejects collisions',
              default: true,
            },
          },
          required: ['sourcePath', 'targetFolder'],
        },
      },
      {
        name: 'get_asset_info',
        description: 'Get asset information',
        inputSchema: {
          type: 'object',
          properties: {
            assetPath: {
              type: 'string',
              description: 'Asset path (db://assets/...)',
            },
          },
          required: ['assetPath'],
        },
      },
      {
        name: 'get_assets',
        description: 'Get assets by type',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Asset type filter',
              enum: ['all', 'scene', 'prefab', 'script', 'texture', 'material', 'mesh', 'audio', 'animation'],
              default: 'all',
            },
            folder: {
              type: 'string',
              description: 'Folder to search in',
              default: 'db://assets',
            },
          },
        },
      },
      {
        name: 'get_build_settings',
        description: 'Get build settings - shows current limitations',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'open_build_panel',
        description: 'Open the build panel in the editor',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'check_builder_status',
        description: 'Check if builder worker is ready',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'start_preview_server',
        description: 'Start preview server',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'number',
              description: 'Preview server port',
              default: 7456,
            },
          },
        },
      },
      {
        name: 'stop_preview_server',
        description: 'Stop preview server',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'create_asset',
        description: 'Create a new asset file or folder',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL (e.g., db://assets/newfile.json)',
            },
            content: {
              oneOf: [
                { type: 'string' },
                { type: 'object' },
                { type: 'array' },
                { type: 'null' },
              ],
              description: 'File content. JSON objects and arrays are serialized automatically; omit for a folder.',
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing file',
              default: false,
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'copy_asset',
        description: 'Copy an asset to another location',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source asset URL',
            },
            target: {
              type: 'string',
              description: 'Target location URL',
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing file',
              default: false,
            },
          },
          required: ['source', 'target'],
        },
      },
      {
        name: 'move_asset',
        description: 'Move an asset to another location',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source asset URL',
            },
            target: {
              type: 'string',
              description: 'Target location URL',
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing file',
              default: false,
            },
          },
          required: ['source', 'target'],
        },
      },
      {
        name: 'delete_asset',
        description: 'Delete an asset',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL to delete',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'save_asset',
        description: 'Save asset content',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL',
            },
            content: {
              type: 'string',
              description: 'Asset content',
            },
          },
          required: ['url', 'content'],
        },
      },
      {
        name: 'reimport_asset',
        description: 'Reimport an asset',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL to reimport',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'resolve_asset_identity',
        description: 'Resolve an asset URL or UUID to its URL, UUID, and filesystem path',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrUUID: {
              type: 'string',
              description: 'Asset URL or UUID',
            },
          },
          required: ['urlOrUUID'],
        },
      },
      {
        name: 'query_asset_path',
        description: 'Get asset disk path',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'query_asset_uuid',
        description: 'Get asset UUID from URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'query_asset_url',
        description: 'Get asset URL from UUID',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Asset UUID',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'find_asset_by_name',
        description: 'Find assets by name (supports partial matching and multiple results)',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Asset name to search for (supports partial matching)',
            },
            exactMatch: {
              type: 'boolean',
              description: 'Whether to use exact name matching',
              default: false,
            },
            assetType: {
              type: 'string',
              description: 'Filter by asset type',
              enum: ['all', 'scene', 'prefab', 'script', 'texture', 'material', 'mesh', 'audio', 'animation', 'spriteFrame'],
              default: 'all',
            },
            folder: {
              type: 'string',
              description: 'Folder to search in',
              default: 'db://assets',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 20,
              minimum: 1,
              maximum: 100,
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_asset_details',
        description: 'Get detailed asset information including spriteFrame sub-assets',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrUUID: {
              type: 'string',
              description: 'Asset URL or UUID',
            },
            includeSubAssets: {
              type: 'boolean',
              description: 'Include sub-assets like spriteFrame, texture',
              default: true,
            },
          },
          required: ['urlOrUUID'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'run_project':
        return args.platform === undefined || typeof args.platform === 'string'
          ? this.runProject(args.platform)
          : toolFailure('run_project platform must be a string when provided')
      case 'build_project':
        return typeof args.platform === 'string' && (args.debug === undefined || typeof args.debug === 'boolean')
          ? this.buildProject({ ...args, platform: args.platform, debug: args.debug })
          : toolFailure('build_project requires platform and an optional debug boolean')
      case 'get_project_info':
        return this.getProjectInfo()
      case 'get_project_settings':
        return args.category === undefined || typeof args.category === 'string'
          ? this.getProjectSettings(args.category)
          : toolFailure('get_project_settings category must be a string when provided')
      case 'refresh_assets':
        return args.folder === undefined || typeof args.folder === 'string'
          ? this.refreshAssets(args.folder)
          : toolFailure('refresh_assets folder must be a string when provided')
      case 'import_asset':
        return typeof args.sourcePath === 'string' && typeof args.targetFolder === 'string'
          && (args.overwrite === undefined || typeof args.overwrite === 'boolean')
          ? this.importAsset(args.sourcePath, args.targetFolder, args.overwrite)
          : toolFailure('import_asset requires sourcePath, targetFolder, and an optional overwrite boolean')
      case 'get_asset_info':
        return typeof args.assetPath === 'string' ? this.getAssetInfo(args.assetPath) : toolFailure('get_asset_info requires assetPath')
      case 'get_assets':
        return (args.type === undefined || typeof args.type === 'string') && (args.folder === undefined || typeof args.folder === 'string')
          ? this.getAssets(args.type, args.folder)
          : toolFailure('get_assets accepts optional type and folder strings')
      case 'get_build_settings':
        return this.getBuildSettings()
      case 'open_build_panel':
        return this.openBuildPanel()
      case 'check_builder_status':
        return this.checkBuilderStatus()
      case 'start_preview_server':
        return args.port === undefined || typeof args.port === 'number'
          ? this.startPreviewServer(args.port)
          : toolFailure('start_preview_server port must be a number when provided')
      case 'stop_preview_server':
        return this.stopPreviewServer()
      case 'create_asset': {
        if (typeof args.url !== 'string' || (args.content !== undefined && !isAssetContent(args.content))) {
          return toolFailure('create_asset requires a url string and string, object, array, or null content', {
            errorCode: 'TOOL_CONTRACT_ERROR',
            instruction: 'Pass JSON content as an object or array; it will be serialized before the asset is created.',
            metadata: {
              category: 'contract',
              retryable: true,
              attempted: { url: args.url, overwrite: args.overwrite, content: summarizeAssetContent(args.content) },
              allowed: ['url', 'content', 'overwrite'],
            },
          })
        }
        if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') {
          return toolFailure('create_asset overwrite must be a boolean when provided', {
            errorCode: 'TOOL_CONTRACT_ERROR',
            metadata: { category: 'contract', retryable: true, attempted: { url: args.url, overwrite: args.overwrite }, allowed: ['url', 'content', 'overwrite'] },
          })
        }
        return this.createAsset(args.url, serializeAssetContent(args.content), args.overwrite)
      }
      case 'copy_asset':
        return typeof args.source === 'string' && typeof args.target === 'string' && (args.overwrite === undefined || typeof args.overwrite === 'boolean')
          ? this.copyAsset(args.source, args.target, args.overwrite)
          : toolFailure('copy_asset requires source, target, and optional overwrite')
      case 'move_asset':
        return typeof args.source === 'string' && typeof args.target === 'string' && (args.overwrite === undefined || typeof args.overwrite === 'boolean')
          ? this.moveAsset(args.source, args.target, args.overwrite)
          : toolFailure('move_asset requires source, target, and optional overwrite')
      case 'delete_asset':
        return typeof args.url === 'string' ? this.deleteAsset(args.url) : toolFailure('delete_asset requires url')
      case 'save_asset':
        if (typeof args.url !== 'string' || args.content === undefined || args.content === null || !isAssetContent(args.content)) {
          return toolFailure('save_asset requires a url string and non-null string, object, or array content', {
            errorCode: 'TOOL_CONTRACT_ERROR',
            metadata: { category: 'contract', retryable: true, attempted: { url: args.url, content: summarizeAssetContent(args.content) }, allowed: ['url', 'content'] },
          })
        }
        return this.saveAsset(args.url, serializeAssetContent(args.content)!)
      case 'reimport_asset':
        return typeof args.url === 'string' ? this.reimportAsset(args.url) : toolFailure('reimport_asset requires url')
      case 'resolve_asset_identity':
        return typeof args.urlOrUUID === 'string'
          ? this.resolveAssetIdentity(args.urlOrUUID)
          : toolFailure('resolve_asset_identity requires urlOrUUID')
      case 'query_asset_path':
        return typeof args.url === 'string' ? this.queryAssetPath(args.url) : toolFailure('query_asset_path requires url')
      case 'query_asset_uuid':
        return typeof args.url === 'string' ? this.queryAssetUuid(args.url) : toolFailure('query_asset_uuid requires url')
      case 'query_asset_url':
        return typeof args.uuid === 'string' ? this.queryAssetUrl(args.uuid) : toolFailure('query_asset_url requires uuid')
      case 'find_asset_by_name':
        return typeof args.name === 'string'
          && (args.exactMatch === undefined || typeof args.exactMatch === 'boolean')
          && (args.assetType === undefined || typeof args.assetType === 'string')
          && (args.folder === undefined || typeof args.folder === 'string')
          && (args.maxResults === undefined || typeof args.maxResults === 'number')
          ? this.findAssetByName({ ...args, name: args.name, exactMatch: args.exactMatch, assetType: args.assetType, folder: args.folder, maxResults: args.maxResults })
          : toolFailure('find_asset_by_name requires name and optional matching filters')
      case 'get_asset_details':
        return typeof args.urlOrUUID === 'string' && (args.includeSubAssets === undefined || typeof args.includeSubAssets === 'boolean')
          ? this.getAssetDetails(args.urlOrUUID, args.includeSubAssets)
          : toolFailure('get_asset_details requires urlOrUUID and optional includeSubAssets')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async runProject(platform: string = 'browser'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const previewConfig = {
        platform,
        scenes: [], // Will use current scene
      }

      // Note: Preview module is not documented in official API
      // Using fallback approach - open build panel as alternative
      Editor.Message.request('builder', 'open', 'default').then(() => {
        resolve({
          success: true,
          message: `Build panel opened. Preview functionality requires manual setup.`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async buildProject(args: BuildProjectInput): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const buildOptions = {
        platform: args.platform,
        debug: args.debug !== false,
        sourceMaps: args.debug !== false,
        buildPath: `build/${args.platform}`,
      }

      // Note: Builder module only supports 'open' and 'query-worker-ready'
      // Building requires manual interaction through the build panel
      Editor.Message.request('builder', 'open', 'default').then(() => {
        resolve({
          success: true,
          message: `Build panel opened for ${args.platform}. Please configure and start build manually.`,
          data: {
            platform: args.platform,
            instruction: 'Use the build panel to configure and start the build process',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getProjectInfo(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const info: ProjectInfo = {
        name: Editor.Project.name,
        path: Editor.Project.path,
        uuid: Editor.Project.uuid,
        version: typeof (Editor.Project as unknown as Record<string, unknown>).version === 'string' ? (Editor.Project as unknown as Record<string, string>).version : '1.0.0',
        cocosVersion: typeof (Editor as unknown as { versions?: Record<string, unknown> }).versions?.cocos === 'string' ? (Editor as unknown as { versions: Record<string, string> }).versions.cocos : 'Unknown',
      }

      // Note: 'query-info' API doesn't exist, using 'query-config' instead
      Editor.Message.request('project', 'query-config', 'project').then((additionalInfo) => {
        if (additionalInfo) {
          Object.assign(info, { config: additionalInfo })
        }
        resolve({ success: true, data: info })
      }).catch(() => {
        // Return basic info even if detailed query fails
        resolve({ success: true, data: info })
      })
    })
  }

  private async getProjectSettings(category: string = 'general'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 使用正确的 project API 查询项目配置
      const configMap: Record<string, string> = {
        general: 'project',
        physics: 'physics',
        render: 'render',
        assets: 'asset-db',
      }

      const configName = configMap[category] || 'project'

      Editor.Message.request('project', 'query-config', configName).then((settings) => {
        resolve({
          success: true,
          data: {
            category,
            config: settings,
            message: `${category} settings retrieved successfully`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async refreshAssets(folder?: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 使用正确的 asset-db API 刷新资源
      const targetPath = folder || 'db://assets'

      Editor.Message.request('asset-db', 'refresh-asset', targetPath).then(() => {
        resolve({
          success: true,
          message: `Assets refreshed in: ${targetPath}`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async importAsset(sourcePath: string, targetFolder: string, overwrite: boolean = true): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      if (!fs.existsSync(sourcePath)) {
        resolve({ success: false, error: 'Source file not found' })
        return
      }

      const fileName = path.basename(sourcePath)
      const targetPath = targetFolder.startsWith('db://')
        ? targetFolder
        : `db://assets/${targetFolder}`
      const targetUrl = `${targetPath}/${fileName}`

      if (!overwrite) {
        try {
          const existing = await Editor.Message.request('asset-db', 'query-asset-info', targetUrl)
          if (existing) {
            resolve(toolFailure(`Target asset already exists: ${targetUrl}`, {
              instruction: 'Retry with overwrite=true to replace the existing asset, or call asset_query.generate_available_url and choose another target.',
              metadata: { category: 'asset', retryable: true, nextTool: 'asset_query', nextAction: 'generate_available_url', retryWith: { url: targetUrl } },
            }))
            return
          }
        }
        catch {
          // A missing asset may be reported as either null or a rejected query.
        }
      }

      Editor.Message.request('asset-db', 'import-asset', sourcePath, targetUrl).then((result) => {
        if (!result) {
          resolve({ success: false, error: 'Asset import returned no result' })
          return
        }
        resolve({
          success: true,
          data: {
            uuid: result.uuid,
            path: result.url,
            message: `Asset imported: ${fileName}`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getAssetInfo(assetPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-asset-info', assetPath).then((assetInfo) => {
        if (!assetInfo) {
          throw new Error('Asset not found')
        }

        const info: AssetInfo = {
          name: assetInfo.name,
          uuid: assetInfo.uuid,
          path: assetInfo.url,
          type: assetInfo.type,
          isDirectory: assetInfo.isDirectory,
        }

        if (assetInfo.meta) {
          info.meta = {
            ver: assetInfo.meta.ver,
            importer: assetInfo.meta.importer,
          }
        }

        resolve({ success: true, data: info })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getAssets(type: string = 'all', folder: string = 'db://assets'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      let pattern = `${folder}/**/*`

      // 添加类型过滤
      if (type !== 'all') {
        const typeExtensions: Record<string, string> = {
          scene: '.scene',
          prefab: '.prefab',
          script: '.{ts,js}',
          texture: '.{png,jpg,jpeg,gif,tga,bmp,psd}',
          material: '.mtl',
          mesh: '.{fbx,obj,dae}',
          audio: '.{mp3,ogg,wav,m4a}',
          animation: '.{anim,clip}',
        }

        const extension = typeExtensions[type]
        if (extension) {
          pattern = `${folder}/**/*${extension}`
        }
      }

      // Note: query-assets API parameters corrected based on documentation
      Editor.Message.request('asset-db', 'query-assets', { pattern }).then((results) => {
        const assets = results.map(asset => ({
          name: asset.name,
          uuid: asset.uuid,
          path: asset.url,
          type: asset.type,
          isDirectory: asset.isDirectory || false,
        }))

        resolve({
          success: true,
          data: {
            type,
            folder,
            count: assets.length,
            assets,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getBuildSettings(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 检查构建器是否准备就绪
      Editor.Message.request('builder', 'query-worker-ready').then((ready: boolean) => {
        resolve({
          success: true,
          data: {
            builderReady: ready,
            message: 'Build settings are limited in MCP plugin environment',
            availableActions: [
              'Open build panel with open_build_panel',
              'Check builder status with check_builder_status',
            ],
            unsupportedActions: [
              {
                action: 'project_runtime.start_preview_server',
                reason: 'Cocos exposes no supported MCP IPC for preview-server control. Start preview manually with Creator’s Project > Preview.',
              },
              {
                action: 'project_runtime.stop_preview_server',
                reason: 'Cocos exposes no supported MCP IPC for preview-server control.',
              },
            ],
            limitation: 'Full build configuration requires direct Editor UI access',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async openBuildPanel(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('builder', 'open', 'default').then(() => {
        resolve({
          success: true,
          message: 'Build panel opened successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async checkBuilderStatus(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('builder', 'query-worker-ready').then((ready: boolean) => {
        resolve({
          success: true,
          data: {
            ready,
            status: ready ? 'Builder worker is ready' : 'Builder worker is not ready',
            message: 'Builder status checked successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async startPreviewServer(port: number = 7456): Promise<ToolResponse> {
    return new Promise((resolve) => {
      resolve({
        success: false,
        error: 'Preview server control is not supported through MCP API',
        instruction: 'Please start the preview server manually using the editor menu: Project > Preview, or use the preview panel in the editor',
      })
    })
  }

  private async stopPreviewServer(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      resolve({
        success: false,
        error: 'Preview server control is not supported through MCP API',
        instruction: 'Please stop the preview server manually using the preview panel in the editor',
      })
    })
  }

  private async createAsset(url: string, content: string | null = null, overwrite: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const options = {
        overwrite,
        rename: !overwrite,
      }

      Editor.Message.request('asset-db', 'create-asset', url, content, options).then((result) => {
        if (result && result.uuid) {
          resolve({
            success: true,
            data: {
              uuid: result.uuid,
              url: result.url,
              message: content === null ? 'Folder created successfully' : 'File created successfully',
            },
          })
        }
        else {
          resolve({
            success: true,
            data: {
              url,
              message: content === null ? 'Folder created successfully' : 'File created successfully',
            },
          })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async copyAsset(source: string, target: string, overwrite: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const options = {
        overwrite,
        rename: !overwrite,
      }

      Editor.Message.request('asset-db', 'copy-asset', source, target, options).then((result) => {
        if (result && result.uuid) {
          resolve({
            success: true,
            data: {
              uuid: result.uuid,
              url: result.url,
              message: 'Asset copied successfully',
            },
          })
        }
        else {
          resolve({
            success: true,
            data: {
              source,
              target,
              message: 'Asset copied successfully',
            },
          })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async moveAsset(source: string, target: string, overwrite: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const options = {
        overwrite,
        rename: !overwrite,
      }

      Editor.Message.request('asset-db', 'move-asset', source, target, options).then((result) => {
        if (result && result.uuid) {
          resolve({
            success: true,
            data: {
              uuid: result.uuid,
              url: result.url,
              message: 'Asset moved successfully',
            },
          })
        }
        else {
          resolve({
            success: true,
            data: {
              source,
              target,
              message: 'Asset moved successfully',
            },
          })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async deleteAsset(url: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'delete-asset', url).then((result) => {
        resolve({
          success: true,
          data: {
            url,
            message: 'Asset deleted successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async saveAsset(url: string, content: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'save-asset', url, content).then((result) => {
        if (result && result.uuid) {
          resolve({
            success: true,
            data: {
              uuid: result.uuid,
              url: result.url,
              message: 'Asset saved successfully',
            },
          })
        }
        else {
          resolve({
            success: true,
            data: {
              url,
              message: 'Asset saved successfully',
            },
          })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async reimportAsset(url: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'reimport-asset', url).then(() => {
        resolve({
          success: true,
          data: {
            url,
            message: 'Asset reimported successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async resolveAssetIdentity(urlOrUUID: string): Promise<ToolResponse> {
    try {
      const url = urlOrUUID.startsWith('db://')
        ? urlOrUUID
        : await Editor.Message.request('asset-db', 'query-url', urlOrUUID)
      if (!url) {
        return toolFailure(`Asset URL not found for: ${urlOrUUID}`, {
          metadata: { category: 'asset', retryable: true, attempted: { urlOrUUID } },
        })
      }

      const [uuid, assetPath] = await Promise.all([
        Editor.Message.request('asset-db', 'query-uuid', url),
        Editor.Message.request('asset-db', 'query-path', url),
      ])
      if (!uuid) {
        return toolFailure(`Asset UUID not found for: ${url}`, {
          metadata: { category: 'asset', retryable: true, attempted: { urlOrUUID, url } },
        })
      }

      return {
        success: true,
        data: {
          input: urlOrUUID,
          url,
          uuid,
          path: assetPath ?? null,
        },
      }
    }
    catch (error: unknown) {
      return toolFailure(`Failed to resolve asset identity: ${error instanceof Error ? error.message : String(error)}`, {
        metadata: { category: 'ipc', retryable: true, attempted: { urlOrUUID } },
      })
    }
  }

  private async queryAssetPath(url: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-path', url).then((path: string | null) => {
        if (path) {
          resolve({
            success: true,
            data: {
              url,
              path,
              message: 'Asset path retrieved successfully',
            },
          })
        }
        else {
          resolve({ success: false, error: 'Asset path not found' })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryAssetUuid(url: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-uuid', url).then((uuid: string | null) => {
        if (uuid) {
          resolve({
            success: true,
            data: {
              url,
              uuid,
              message: 'Asset UUID retrieved successfully',
            },
          })
        }
        else {
          resolve({ success: false, error: 'Asset UUID not found' })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryAssetUrl(uuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-url', uuid).then((url: string | null) => {
        if (url) {
          resolve({
            success: true,
            data: {
              uuid,
              url,
              message: 'Asset URL retrieved successfully',
            },
          })
        }
        else {
          resolve({ success: false, error: 'Asset URL not found' })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async findAssetByName(args: FindAssetInput): Promise<ToolResponse> {
    const { name, exactMatch = false, assetType = 'all', folder = 'db://assets', maxResults = 20 } = args

    return new Promise(async (resolve) => {
      try {
        // Get all assets in the specified folder
        const allAssetsResponse = await this.getAssets(assetType, folder)
        if (!allAssetsResponse.success || !allAssetsResponse.data) {
          resolve({
            success: false,
            error: `Failed to get assets: ${allAssetsResponse.error}`,
          })
          return
        }

        const allAssets = allAssetsResponse.data.assets as Record<string, unknown>[]
        const matchedAssets: Record<string, unknown>[] = []

        for (const asset of filterAssetsByName(allAssets, name, exactMatch, maxResults)) {
          // Get detailed asset info if needed
          try {
            if (typeof asset.path !== 'string')
              continue
            const detailResponse = await this.getAssetInfo(asset.path)
            if (detailResponse.success) {
              matchedAssets.push({
                ...asset,
                details: detailResponse.data,
              })
            }
            else {
              matchedAssets.push(asset)
            }
          }
          catch {
            matchedAssets.push(asset)
          }
        }

        resolve({
          success: true,
          data: {
            searchTerm: name,
            exactMatch,
            assetType,
            folder,
            totalFound: matchedAssets.length,
            maxResults,
            assets: matchedAssets,
            message: `Found ${matchedAssets.length} assets matching '${name}'`,
          },
        })
      }
      catch (error: unknown) {
        resolve({
          success: false,
          error: `Asset search failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    })
  }

  private async getAssetDetails(urlOrUUID: string, includeSubAssets: boolean = true): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        const assetUrl = urlOrUUID.startsWith('db://')
          ? urlOrUUID
          : await Editor.Message.request('asset-db', 'query-url', urlOrUUID)
        if (!assetUrl) {
          resolve(toolFailure(`Asset URL not found for: ${urlOrUUID}`))
          return
        }

        // Get basic asset info
        const assetInfoResponse = await this.getAssetInfo(assetUrl)
        if (!assetInfoResponse.success) {
          resolve(assetInfoResponse)
          return
        }

        const assetInfo = assetInfoResponse.data
        const subAssets: Record<string, unknown>[] = []
        const detailedInfo: Record<string, unknown> = {
          ...assetInfo,
          subAssets,
        }

        if (includeSubAssets && assetInfo) {
          // For image assets, try to get spriteFrame and texture sub-assets
          if (assetInfo.type === 'cc.ImageAsset' || /\.(?:png|jpg|jpeg|gif|tga|bmp|psd)$/i.test(assetUrl)) {
            // Generate common sub-asset UUIDs
            const baseUuid = assetInfo.uuid
            const possibleSubAssets = [
              { type: 'spriteFrame', uuid: `${baseUuid}@f9941`, suffix: '@f9941' },
              { type: 'texture', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' },
              { type: 'texture2D', uuid: `${baseUuid}@6c48a`, suffix: '@6c48a' },
            ]

            for (const subAsset of possibleSubAssets) {
              try {
                // Try to get URL for the sub-asset to verify it exists
                const subAssetUrl = await Editor.Message.request('asset-db', 'query-url', subAsset.uuid)
                if (subAssetUrl) {
                  subAssets.push({
                    type: subAsset.type,
                    uuid: subAsset.uuid,
                    url: subAssetUrl,
                    suffix: subAsset.suffix,
                  })
                }
              }
              catch {
                // Sub-asset doesn't exist, skip it
              }
            }
          }
        }

        resolve({
          success: true,
          data: {
            urlOrUUID,
            assetUrl,
            includeSubAssets,
            ...detailedInfo,
            message: `Asset details retrieved. Found ${subAssets.length} sub-assets.`,
          },
        })
      }
      catch (error: unknown) {
        resolve({
          success: false,
          error: `Failed to get asset details: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    })
  }
}
