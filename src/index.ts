#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Request,
} from '@modelcontextprotocol/sdk/types.js';
import { ChunkedFigmaClient } from './client.js';
import { getFigmaAccessToken } from './config.js';

interface ListFilesArgs {
  project_id?: string;
  team_id?: string;
}

interface FileKeyArgs {
  file_key: string;
}

interface FileNodesArgs extends FileKeyArgs {
  ids: string[];
}

interface GetFileDataArgs {
  file_key: string;
  pageSize?: number;
  maxMemoryMB?: number;
  nodeTypes?: string[];
  cursor?: string;
  depth?: number;
}

class FigmaMCPServer {
  private server: Server;
  private figmaClient: ChunkedFigmaClient;

  constructor() {
    console.debug('[MCP Debug] Initializing Figma MCP server');
    this.server = new Server(
      {
        name: 'figma-mcp-chunked',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.figmaClient = new ChunkedFigmaClient(getFigmaAccessToken());
    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => {
      console.error('[MCP Error]', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    };
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    console.debug('[MCP Debug] Setting up tool handlers');
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_file_data',
          description: 'Get Figma file data with chunking and pagination',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              },
              pageSize: {
                type: 'number',
                description: 'Number of nodes per page',
                minimum: 1,
                maximum: 1000
              },
              maxMemoryMB: {
                type: 'number',
                description: 'Maximum memory usage in MB',
                minimum: 128,
                maximum: 2048
              },
              nodeTypes: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [
                    'FRAME',
                    'GROUP',
                    'VECTOR',
                    'BOOLEAN_OPERATION',
                    'STAR',
                    'LINE',
                    'TEXT',
                    'COMPONENT',
                    'INSTANCE'
                  ]
                },
                description: 'Filter nodes by type'
              },
              cursor: {
                type: 'string',
                description: 'Pagination cursor for continuing from a previous request'
              },
              depth: {
                type: 'number',
                description: 'Maximum depth to traverse in the node tree',
                minimum: 1
              }
            },
            required: ['file_key']
          }
        },
        {
          name: 'list_files',
          description: 'List files in a project or team',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'Project ID to list files from'
              },
              team_id: {
                type: 'string',
                description: 'Team ID to list files from'
              }
            }
          }
        },
        {
          name: 'get_file_versions',
          description: 'Get version history of a Figma file',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              }
            },
            required: ['file_key']
          }
        },
        {
          name: 'get_file_comments',
          description: 'Get comments on a Figma file',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              }
            },
            required: ['file_key']
          }
        },
        {
          name: 'get_components',
          description: 'Get components from a Figma file',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              }
            },
            required: ['file_key']
          }
        },
        {
          name: 'get_styles',
          description: 'Get styles from a Figma file',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              }
            },
            required: ['file_key']
          }
        },
        {
          name: 'get_file_nodes',
          description: 'Get specific nodes from a Figma file',
          inputSchema: {
            type: 'object',
            properties: {
              file_key: {
                type: 'string',
                description: 'Figma file key'
              },
              ids: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of node IDs to retrieve'
              }
            },
            required: ['file_key', 'ids']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.debug('[MCP Debug] Request', {
        tool: request.params.name,
        arguments: request.params.arguments,
      });

      try {
        switch (request.params.name) {
          case 'get_file_data': {
            const args = request.params.arguments as unknown as GetFileDataArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }

            console.debug('[MCP Debug] Fetching file data with chunking', {
              fileKey: args.file_key,
              pageSize: args.pageSize,
              maxMemoryMB: args.maxMemoryMB,
              nodeTypes: args.nodeTypes,
            });

            const result = await this.figmaClient.getFileInfoChunked(
              args.file_key,
              args.cursor,
              args.depth
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    nodes: result.nodes,
                    memoryUsage: result.memoryUsage,
                    nextCursor: result.nextCursor,
                    hasMore: result.hasMore
                  }, null, 2)
                }
              ]
            };
          }

          case 'list_files': {
            const args = request.params.arguments as unknown as ListFilesArgs;
            console.debug('[MCP Debug] Listing files', args);
            const data = await this.figmaClient.listFiles(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          case 'get_file_versions': {
            const args = request.params.arguments as unknown as FileKeyArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }
            console.debug('[MCP Debug] Fetching file versions', {
              fileKey: args.file_key,
            });
            const data = await this.figmaClient.getFileVersions(args.file_key);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          case 'get_file_comments': {
            const args = request.params.arguments as unknown as FileKeyArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }
            console.debug('[MCP Debug] Fetching file comments', {
              fileKey: args.file_key,
            });
            const data = await this.figmaClient.getFileComments(args.file_key);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          case 'get_components': {
            const args = request.params.arguments as unknown as FileKeyArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }
            console.debug('[MCP Debug] Fetching components', {
              fileKey: args.file_key,
            });
            const data = await this.figmaClient.getComponents(args.file_key);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          case 'get_styles': {
            const args = request.params.arguments as unknown as FileKeyArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }
            console.debug('[MCP Debug] Fetching styles', {
              fileKey: args.file_key,
            });
            const data = await this.figmaClient.getStyles(args.file_key);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          case 'get_file_nodes': {
            const args = request.params.arguments as unknown as FileNodesArgs;
            if (!args.file_key) {
              throw new McpError(ErrorCode.InvalidParams, 'file_key is required');
            }
            if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'ids array is required and must not be empty'
              );
            }
            console.debug('[MCP Debug] Fetching file nodes', {
              fileKey: args.file_key,
              ids: args.ids,
            });
            const data = await this.figmaClient.getFileNodes(args.file_key, args.ids);
            return {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        console.error('[MCP Error]', {
          tool: request.params.name,
          arguments: request.params.arguments,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        });

        if (error instanceof McpError) {
          throw error;
        }
        return {
          content: [
            {
              type: 'text',
              text: `Figma API error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.debug('[MCP Debug] Figma MCP server running on stdio');
  }
}

const server = new FigmaMCPServer();
server.run().catch((error) => {
  console.error('[MCP Fatal Error]', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
