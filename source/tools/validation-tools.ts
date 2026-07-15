import type { JsonSchema, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { toolFailure, toolSuccess } from './tool-response'

type ToolArguments = Record<string, unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ValidationTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'validate_json_params',
        description: 'Validate and fix JSON parameters before sending to other tools',
        inputSchema: {
          type: 'object',
          properties: {
            jsonString: {
              type: 'string',
              description: 'JSON string to validate and fix',
            },
            expectedSchema: {
              type: 'object',
              description: 'Expected parameter schema (optional)',
            },
          },
          required: ['jsonString'],
        },
      },
      {
        name: 'safe_string_value',
        description: 'Create a safe string value that won\'t cause JSON parsing issues',
        inputSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description: 'String value to make safe',
            },
          },
          required: ['value'],
        },
      },
      {
        name: 'format_mcp_request',
        description: 'Format a complete MCP request with proper JSON escaping',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: {
              type: 'string',
              description: 'Tool name to call',
            },
            arguments: {
              type: 'object',
              description: 'Tool arguments',
            },
          },
          required: ['toolName', 'arguments'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'validate_json_params': {
        if (typeof args.jsonString !== 'string') {
          return toolFailure('validate_json_params requires a jsonString')
        }
        if (args.expectedSchema !== undefined && !isJsonSchema(args.expectedSchema)) {
          return toolFailure('expectedSchema must be an object when provided')
        }
        return this.validateJsonParams(args.jsonString, args.expectedSchema)
      }
      case 'safe_string_value':
        return typeof args.value === 'string'
          ? this.createSafeStringValue(args.value)
          : toolFailure('safe_string_value requires a string value')
      case 'format_mcp_request':
        return typeof args.toolName === 'string' && isToolArguments(args.arguments)
          ? this.formatMcpRequest(args.toolName, args.arguments)
          : toolFailure('format_mcp_request requires a toolName and an arguments object')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async validateJsonParams(jsonString: string, expectedSchema?: JsonSchema): Promise<ToolResponse> {
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonString)
      }
      catch (error: unknown) {
        const fixed = this.fixJsonString(jsonString)
        try {
          parsed = JSON.parse(fixed)
        }
        catch (secondError) {
          return toolFailure(`Cannot fix JSON: ${getErrorMessage(error)}`, {
            data: {
              originalJson: jsonString,
              fixedAttempt: fixed,
              suggestions: this.getJsonFixSuggestions(jsonString),
            },
          })
        }
      }

      if (expectedSchema) {
        const validation = this.validateAgainstSchema(parsed, expectedSchema)
        if (!validation.valid) {
          return toolFailure('Schema validation failed', {
            data: {
              parsedJson: parsed,
              validationErrors: validation.errors,
              suggestions: validation.suggestions,
            },
          })
        }
      }

      return toolSuccess({
        parsedJson: parsed,
        fixedJson: JSON.stringify(parsed, null, 2),
        isValid: true,
      })
    }
    catch (error: unknown) {
      return toolFailure(getErrorMessage(error))
    }
  }

  private async createSafeStringValue(value: string): Promise<ToolResponse> {
    const safeValue = this.escapJsonString(value)
    return toolSuccess({
      originalValue: value,
      safeValue,
      jsonReady: JSON.stringify(safeValue),
      usage: `Use "${safeValue}" in your JSON parameters`,
    })
  }

  private async formatMcpRequest(toolName: string, toolArgs: ToolArguments): Promise<ToolResponse> {
    try {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: toolArgs,
        },
      }

      const formattedJson = JSON.stringify(mcpRequest, null, 2)
      const compactJson = JSON.stringify(mcpRequest)

      return toolSuccess({
        request: mcpRequest,
        formattedJson,
        compactJson,
        curlCommand: this.generateCurlCommand(compactJson),
      })
    }
    catch (error: unknown) {
      return toolFailure(`Failed to format MCP request: ${getErrorMessage(error)}`)
    }
  }

  private fixJsonString(jsonStr: string): string {
    let fixed = jsonStr

    // Fix common escape character issues
    fixed = fixed
    // Fix unescaped quotes in string values
      .replace(/(\{[^}]*"[^"]*":\s*")([^"]*")([^"]*")([^}]*\})/g, (match, prefix, content, suffix, end) => {
        const escapedContent = content.replace(/"/g, '\\"')
        return prefix + escapedContent + suffix + end
      })
    // Fix unescaped backslashes
      .replace(/([^\\])\\([^"\\/bfnrtu])/g, '$1\\\\$2')
    // Fix trailing commas
      .replace(/,(\s*[}\]])/g, '$1')
    // Fix control characters
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    // Fix single quotes to double quotes
      .replace(/'/g, '"')

    return fixed
  }

  private escapJsonString(str: string): string {
    return str
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/"/g, '\\"') // Escape quotes
      .replace(/\n/g, '\\n') // Escape newlines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/\t/g, '\\t') // Escape tabs
      .replace(/\f/g, '\\f') // Escape form feeds
      .replaceAll('\b', '\\b') // Escape backspaces
  }

  private validateAgainstSchema(data: unknown, schema: JsonSchema): { valid: boolean, errors: string[], suggestions: string[] } {
    const errors: string[] = []
    const suggestions: string[] = []

    // Basic type checking
    if (schema.type) {
      const actualType = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data
      if (actualType !== schema.type) {
        errors.push(`Expected type ${schema.type}, got ${actualType}`)
        suggestions.push(`Convert value to ${schema.type}`)
      }
    }

    // Required fields checking
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) {
          errors.push(`Missing required field: ${field}`)
          suggestions.push(`Add required field "${field}"`)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      suggestions,
    }
  }

  private getJsonFixSuggestions(jsonStr: string): string[] {
    const suggestions: string[] = []

    if (jsonStr.includes('\\"')) {
      suggestions.push('Check for improperly escaped quotes')
    }
    if (jsonStr.includes('\'')) {
      suggestions.push('Replace single quotes with double quotes')
    }
    if (jsonStr.includes('\n') || jsonStr.includes('\t')) {
      suggestions.push('Escape newlines and tabs properly')
    }
    if (/,\s*[}\]]/.test(jsonStr)) {
      suggestions.push('Remove trailing commas')
    }

    return suggestions
  }

  private generateCurlCommand(jsonStr: string): string {
    const escapedJson = jsonStr.replace(/'/g, '\'"\'"\'')
    return `curl -X POST http://127.0.0.1:8585/mcp \\
  -H "Content-Type: application/json" \\
  -d '${escapedJson}'`
  }
}
