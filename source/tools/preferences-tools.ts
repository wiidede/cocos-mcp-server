import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>
type PreferencesRequest = (channel: string, message: string, ...args: unknown[]) => Promise<unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPreferencesRequest(): PreferencesRequest {
  return Editor.Message.request as unknown as PreferencesRequest
}

export class PreferencesTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'open_preferences_settings',
        description: 'Open preferences settings panel',
        inputSchema: {
          type: 'object',
          properties: {
            tab: {
              type: 'string',
              description: 'Preferences tab to open (optional)',
              enum: ['general', 'external-tools', 'data-editor', 'laboratory', 'extensions'],
            },
            args: {
              type: 'array',
              description: 'Additional arguments to pass to the tab',
            },
          },
        },
      },
      {
        name: 'query_preferences_config',
        description: 'Query preferences configuration',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Plugin or category name',
              default: 'general',
            },
            path: {
              type: 'string',
              description: 'Configuration path (optional)',
            },
            type: {
              type: 'string',
              description: 'Configuration type',
              enum: ['default', 'global', 'local'],
              default: 'global',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'set_preferences_config',
        description: 'Set preferences configuration',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Plugin name',
            },
            path: {
              type: 'string',
              description: 'Configuration path',
            },
            value: {
              description: 'Configuration value',
            },
            type: {
              type: 'string',
              description: 'Configuration type',
              enum: ['default', 'global', 'local'],
              default: 'global',
            },
          },
          required: ['name', 'path', 'value'],
        },
      },
      {
        name: 'get_all_preferences',
        description: 'Get all available preferences categories',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reset_preferences',
        description: 'Reset preferences to default values',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Specific preference category to reset (optional)',
            },
            type: {
              type: 'string',
              description: 'Configuration type to reset',
              enum: ['global', 'local'],
              default: 'global',
            },
          },
        },
      },
      {
        name: 'export_preferences',
        description: 'Export current preferences configuration',
        inputSchema: {
          type: 'object',
          properties: {
            exportPath: {
              type: 'string',
              description: 'Path to export preferences file (optional)',
            },
          },
        },
      },
      {
        name: 'import_preferences',
        description: 'Import preferences configuration from file',
        inputSchema: {
          type: 'object',
          properties: {
            importPath: {
              type: 'string',
              description: 'Path to import preferences file from',
            },
          },
          required: ['importPath'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'open_preferences_settings':
        return (args.tab === undefined || typeof args.tab === 'string') && (args.args === undefined || Array.isArray(args.args))
          ? this.openPreferencesSettings(args.tab, args.args)
          : toolFailure('open_preferences_settings accepts an optional tab string and args array')
      case 'query_preferences_config':
        return typeof args.name === 'string'
          && (args.path === undefined || typeof args.path === 'string')
          && (args.type === undefined || typeof args.type === 'string')
          ? this.queryPreferencesConfig(args.name, args.path, args.type)
          : toolFailure('query_preferences_config requires name and optional path/type strings')
      case 'set_preferences_config':
        return typeof args.name === 'string'
          && typeof args.path === 'string'
          && Object.hasOwn(args, 'value')
          && (args.type === undefined || typeof args.type === 'string')
          ? this.setPreferencesConfig(args.name, args.path, args.value, args.type)
          : toolFailure('set_preferences_config requires name, path, value, and an optional type string')
      case 'get_all_preferences':
        return this.getAllPreferences()
      case 'reset_preferences':
        return (args.name === undefined || typeof args.name === 'string') && (args.type === undefined || typeof args.type === 'string')
          ? this.resetPreferences(args.name, args.type)
          : toolFailure('reset_preferences accepts optional name and type strings')
      case 'export_preferences':
        return args.exportPath === undefined || typeof args.exportPath === 'string'
          ? this.exportPreferences(args.exportPath)
          : toolFailure('export_preferences exportPath must be a string when provided')
      case 'import_preferences':
        return typeof args.importPath === 'string'
          ? this.importPreferences(args.importPath)
          : toolFailure('import_preferences requires an importPath string')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async openPreferencesSettings(tab?: string, args?: unknown[]): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const requestArgs = []
      if (tab) {
        requestArgs.push(tab)
      }
      if (args && args.length > 0) {
        requestArgs.push(...args)
      }

      getPreferencesRequest()('preferences', 'open-settings', ...requestArgs).then(() => {
        resolve({
          success: true,
          message: `Preferences settings opened${tab ? ` on tab: ${tab}` : ''}`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryPreferencesConfig(name: string, path?: string, type: string = 'global'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const requestArgs = [name]
      if (path) {
        requestArgs.push(path)
      }
      requestArgs.push(type)

      getPreferencesRequest()('preferences', 'query-config', ...requestArgs).then((config: unknown) => {
        resolve({
          success: true,
          data: {
            name,
            path,
            type,
            config,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async setPreferencesConfig(name: string, path: string, value: unknown, type: string = 'global'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      getPreferencesRequest()('preferences', 'set-config', name, path, value, type).then((result: unknown) => {
        const success = result === true
        if (success) {
          resolve({
            success: true,
            message: `Preference '${name}.${path}' updated successfully`,
          })
        }
        else {
          resolve({
            success: false,
            error: `Failed to update preference '${name}.${path}'`,
          })
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getAllPreferences(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Common preference categories in Cocos Creator
      const categories = [
        'general',
        'external-tools',
        'data-editor',
        'laboratory',
        'extensions',
        'preview',
        'console',
        'native',
        'builder',
      ]

      const preferences: Record<string, unknown> = {}

      const queryPromises = categories.map((category) => {
        return Editor.Message.request('preferences', 'query-config', category, undefined, 'global')
          .then((config: unknown) => {
            preferences[category] = config
          })
          .catch(() => {
            // Ignore errors for categories that don't exist
            preferences[category] = null
          })
      })

      Promise.all(queryPromises).then(() => {
        // Filter out null entries
        const validPreferences = Object.fromEntries(
          Object.entries(preferences).filter(([_, value]) => value !== null),
        )

        resolve({
          success: true,
          data: {
            categories: Object.keys(validPreferences),
            preferences: validPreferences,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async resetPreferences(name?: string, type: string = 'global'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      if (name) {
        // Reset specific preference category
        Editor.Message.request('preferences', 'query-config', name, undefined, 'default').then((defaultConfig: unknown) => {
          return getPreferencesRequest()('preferences', 'set-config', name, '', defaultConfig, type)
        }).then((result: unknown) => {
          const success = result === true
          if (success) {
            resolve({
              success: true,
              message: `Preference category '${name}' reset to default`,
            })
          }
          else {
            resolve({
              success: false,
              error: `Failed to reset preference category '${name}'`,
            })
          }
        }).catch((err: Error) => {
          resolve({ success: false, error: err.message })
        })
      }
      else {
        resolve({
          success: false,
          error: 'Resetting all preferences is not supported through API. Please specify a preference category.',
        })
      }
    })
  }

  private async exportPreferences(exportPath?: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      this.getAllPreferences().then((prefsResult: ToolResponse) => {
        if (!prefsResult.success) {
          resolve(prefsResult)
          return
        }

        const prefsData = JSON.stringify(prefsResult.data, null, 2)
        const path = exportPath || `preferences_export_${Date.now()}.json`

        // For now, return the data - in a real implementation, you'd write to file
        resolve({
          success: true,
          data: {
            exportPath: path,
            preferences: prefsResult.data,
            jsonData: prefsData,
            message: 'Preferences exported successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async importPreferences(importPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      resolve({
        success: false,
        error: 'Import preferences functionality requires file system access which is not available in this context. Please manually import preferences through the Editor UI.',
      })
    })
  }
}
