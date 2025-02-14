import axios, { AxiosInstance } from 'axios';
import type { DocumentNode, SceneNode } from './types.js';

interface ChunkConfig {
  pageSize: number;
  maxMemoryMB: number;
  nodeTypes?: string[];
  maxDepth?: number;
  excludeProps?: string[];
  maxResponseSize?: number; // in MB
  summarizeNodes?: boolean;
}

class StreamingNodeProcessor {
  private processedNodes: Set<string>;
  private config: ChunkConfig;
  private currentSize: number;

  constructor(config: ChunkConfig) {
    this.processedNodes = new Set();
    this.config = config;
    this.currentSize = 0;
  }

  private estimateNodeSize(node: SceneNode): number {
    return Buffer.byteLength(JSON.stringify(node)) / 1024 / 1024; // Size in MB
  }

  private filterNodeProperties(node: SceneNode): SceneNode {
    if (!this.config.excludeProps?.length) return node;

    const filteredNode = { ...node };
    for (const prop of this.config.excludeProps) {
      if (prop !== 'id' && prop !== 'type') { // Preserve required properties
        delete (filteredNode as any)[prop];
      }
    }
    return filteredNode;
  }

  private summarizeNode(node: SceneNode): SceneNode {
    // Create a type-safe base object
    const base: Pick<SceneNode, 'id' | 'name' | 'visible'> & { type: SceneNode['type'] } = {
      id: node.id,
      name: node.name || '',
      visible: node.visible ?? true,
      type: node.type,
    };

    // Add type-specific required properties
    switch (node.type as SceneNode['type']) {
      case 'FRAME':
        return {
          ...base,
          type: 'FRAME' as const,
          children: 'children' in node ? node.children : [],
          background: [],
        };
      case 'GROUP':
        return {
          ...base,
          type: 'GROUP' as const,
          children: 'children' in node ? node.children : [],
        };
      case 'VECTOR':
        return {
          ...base,
          type: 'VECTOR' as const,
        };
      case 'BOOLEAN_OPERATION':
        return {
          ...base,
          type: 'BOOLEAN_OPERATION' as const,
          children: 'children' in node ? node.children : [],
          booleanOperation: 'UNION',
        };
      case 'STAR':
        return {
          ...base,
          type: 'STAR' as const,
          pointCount: 5,
          innerRadius: 0.5,
        };
      case 'LINE':
        return {
          ...base,
          type: 'LINE' as const,
        };
      case 'TEXT':
        return {
          ...base,
          type: 'TEXT' as const,
          characters: 'characters' in node ? node.characters : '',
          style: {
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: 16,
            textAlignHorizontal: 'LEFT',
            letterSpacing: 0,
            lineHeightUnit: 'PIXELS',
          },
        };
      case 'COMPONENT':
        return {
          ...base,
          type: 'COMPONENT' as const,
          children: 'children' in node ? node.children : [],
          componentId: 'componentId' in node ? node.componentId : '',
        };
      case 'INSTANCE':
        return {
          ...base,
          type: 'INSTANCE' as const,
          children: 'children' in node ? node.children : [],
          componentId: 'componentId' in node ? node.componentId : '',
        };
      case 'CANVAS':
        return {
          ...base,
          type: 'CANVAS' as const,
          children: 'children' in node ? node.children : [],
          backgroundColor: { r: 1, g: 1, b: 1, a: 1 }
        };
      default:
        // Instead of throwing error, return base node with minimal properties
        return {
          ...base,
          children: 'children' in node ? node.children : []
        } as SceneNode;
    }
  }

  shouldProcessNode(node: SceneNode, depth: number): boolean {
    if (this.processedNodes.has(node.id)) return false;
    if (this.config.nodeTypes && !this.config.nodeTypes.includes(node.type)) return false;
    if (this.config.maxDepth !== undefined && depth > this.config.maxDepth) return false;
    
    const nodeSize = this.estimateNodeSize(node);
    if (this.currentSize + nodeSize > (this.config.maxResponseSize || this.config.maxMemoryMB)) {
      return false;
    }

    return true;
  }

  processNode(node: SceneNode, depth: number): SceneNode | null {
    if (!this.shouldProcessNode(node, depth)) return null;

    this.processedNodes.add(node.id);
    let processedNode = this.filterNodeProperties(node);
    
    if (this.config.summarizeNodes) {
      processedNode = this.summarizeNode(processedNode);
    }

    this.currentSize += this.estimateNodeSize(processedNode);
    return processedNode;
  }

  hasReachedLimit(): boolean {
    return this.currentSize >= (this.config.maxResponseSize || this.config.maxMemoryMB);
  }

  getCurrentSize(): number {
    return this.currentSize;
  }

  getProcessedCount(): number {
    return this.processedNodes.size;
  }
}

interface ChunkResult {
  nodes: SceneNode[];
  memoryUsage: number;
  nextCursor?: string;
  hasMore: boolean;
}

export class ChunkedFigmaClient {
  private client: AxiosInstance;
  private config: ChunkConfig;
  private nodeProcessor: StreamingNodeProcessor;

  constructor(accessToken: string, config: Partial<ChunkConfig> = {}) {
    this.client = axios.create({
      baseURL: 'https://api.figma.com/v1',
      headers: {
        'X-Figma-Token': accessToken,
      },
    });

    this.config = {
      pageSize: config.pageSize || 100,
      maxMemoryMB: config.maxMemoryMB || 512,
      nodeTypes: config.nodeTypes,
      maxDepth: config.maxDepth,
      excludeProps: config.excludeProps,
      maxResponseSize: config.maxResponseSize || 50, // Default 50MB response size
      summarizeNodes: config.summarizeNodes,
    };

    this.nodeProcessor = new StreamingNodeProcessor(this.config);
  }

  private async streamNodes(
    document: DocumentNode,
    cursor?: string
  ): Promise<ChunkResult> {
    const result: SceneNode[] = [];
    const queue: Array<{ node: SceneNode; depth: number }> = document.children.map(node => ({ node, depth: 0 }));
    let currentIndex = cursor ? parseInt(cursor, 10) : 0;

    // Skip to cursor position
    while (currentIndex > 0 && queue.length > 0) {
      queue.shift();
      currentIndex--;
    }

    while (queue.length > 0 && result.length < this.config.pageSize) {
      const { node, depth } = queue.shift()!;
      
      const processedNode = this.nodeProcessor.processNode(node, depth);
      if (processedNode) {
        result.push(processedNode as SceneNode);
      }

      if ('children' in node) {
        queue.unshift(...node.children.map(child => ({ 
          node: child, 
          depth: depth + 1 
        })));
      }

      if (this.nodeProcessor.hasReachedLimit()) {
        break;
      }
    }

    return {
      nodes: result,
      memoryUsage: this.nodeProcessor.getCurrentSize(),
      nextCursor: queue.length > 0 ? this.nodeProcessor.getProcessedCount().toString() : undefined,
      hasMore: queue.length > 0
    };
  }

  async getFileInfoChunked(
    fileKey: string,
    cursor?: string,
    depth?: number,
    config?: Partial<ChunkConfig>
  ): Promise<ChunkResult> {
    // Update config with new options
    if (config) {
      this.config = {
        ...this.config,
        ...config
      };
      // Recreate node processor with new config
      this.nodeProcessor = new StreamingNodeProcessor(this.config);
    }
    try {
      const response = await this.client.get(`/files/${fileKey}`, {
        params: { depth: depth || this.config.maxDepth },
      });

      if (!response.data || !response.data.document) {
        throw new Error('Invalid response from Figma API');
      }

      return this.streamNodes(response.data.document, cursor);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Figma API error: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  async listFiles(params: { project_id?: string; team_id?: string }) {
    try {
      console.debug('[MCP Debug] Listing files with params:', params);
      const response = await this.client.get('/files', { params });
      return response.data;
    } catch (error) {
      console.error('[MCP Error] Failed to list files:', error);
      throw error;
    }
  }

  async getComponents(fileKey: string) {
    try {
      console.debug('[MCP Debug] Getting components for file:', fileKey);
      const response = await this.client.get(`/files/${fileKey}/components`);
      
      if (this.nodeProcessor.hasReachedLimit()) {
        console.debug('[MCP Debug] Memory limit reached while processing components');
        throw new Error('Memory limit exceeded while processing components');
      }

      return response.data;
    } catch (error) {
      console.error('[MCP Error] Failed to get components:', error);
      throw error;
    }
  }

  async getStyles(fileKey: string) {
    try {
      console.debug('[MCP Debug] Getting styles for file:', fileKey);
      const response = await this.client.get(`/files/${fileKey}/styles`);
      
      if (this.nodeProcessor.hasReachedLimit()) {
        console.debug('[MCP Debug] Memory limit reached while processing styles');
        throw new Error('Memory limit exceeded while processing styles');
      }

      return response.data;
    } catch (error) {
      console.error('[MCP Error] Failed to get styles:', error);
      throw error;
    }
  }

  async getFileVersions(fileKey: string) {
    try {
      console.debug('[MCP Debug] Getting versions for file:', fileKey);
      const response = await this.client.get(`/files/${fileKey}/versions`);
      
      if (this.nodeProcessor.hasReachedLimit()) {
        console.debug('[MCP Debug] Memory limit reached while processing versions');
        throw new Error('Memory limit exceeded while processing versions');
      }

      return response.data;
    } catch (error) {
      console.error('[MCP Error] Failed to get file versions:', error);
      throw error;
    }
  }

  async getFileComments(fileKey: string) {
    try {
      console.debug('[MCP Debug] Getting comments for file:', fileKey);
      const response = await this.client.get(`/files/${fileKey}/comments`);
      
      if (this.nodeProcessor.hasReachedLimit()) {
        console.debug('[MCP Debug] Memory limit reached while processing comments');
        throw new Error('Memory limit exceeded while processing comments');
      }

      return response.data;
    } catch (error) {
      console.error('[MCP Error] Failed to get file comments:', error);
      throw error;
    }
  }

  async getFileNodes(fileKey: string, ids: string[]) {
    try {
      console.debug('[MCP Debug] Getting nodes for file:', fileKey, 'IDs:', ids);
      
      // Process nodes in chunks to manage memory
      const chunkSize = 50; // Process 50 nodes at a time
      const chunks = [];
      
      for (let i = 0; i < ids.length; i += chunkSize) {
        if (this.nodeProcessor.hasReachedLimit()) {
          console.debug('[MCP Debug] Memory limit reached while processing nodes');
          throw new Error('Memory limit exceeded while processing nodes');
        }

        const chunkIds = ids.slice(i, i + chunkSize);
        const response = await this.client.get(`/files/${fileKey}/nodes`, {
          params: { ids: chunkIds.join(',') },
        });
        
        chunks.push(response.data);
      }

      // Merge chunks
      const mergedData = {
        nodes: chunks.reduce((acc, chunk) => ({ ...acc, ...chunk.nodes }), {})
      };

      return mergedData;
    } catch (error) {
      console.error('[MCP Error] Failed to get file nodes:', error);
      throw error;
    }
  }
}
