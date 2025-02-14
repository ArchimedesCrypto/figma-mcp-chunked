import axios, { AxiosInstance } from 'axios';
import type { DocumentNode, SceneNode } from './types.js';

interface ChunkConfig {
  pageSize: number;
  maxMemoryMB: number;
  nodeTypes?: string[];
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
  private processedNodes: Set<string>;

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
    };

    this.processedNodes = new Set();
  }

  private checkMemoryUsage(): boolean {
    const used = process.memoryUsage();
    const heapUsed = used.heapUsed / 1024 / 1024; // Convert to MB
    return heapUsed < this.config.maxMemoryMB;
  }

  private shouldProcessNode(node: SceneNode): boolean {
    if (this.processedNodes.has(node.id)) {
      return false;
    }

    if (this.config.nodeTypes && !this.config.nodeTypes.includes(node.type)) {
      return false;
    }

    return true;
  }

  private async processNodeChunk(
    nodes: SceneNode[],
    startIndex: number
  ): Promise<ChunkResult> {
    const result: SceneNode[] = [];
    let currentIndex = startIndex;
    let hasMore = false;

    while (
      currentIndex < nodes.length &&
      result.length < this.config.pageSize &&
      this.checkMemoryUsage()
    ) {
      const node = nodes[currentIndex];
      
      if (this.shouldProcessNode(node)) {
        result.push(node);
        this.processedNodes.add(node.id);
      }

      currentIndex++;
    }

    hasMore = currentIndex < nodes.length;

    return {
      nodes: result,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      nextCursor: hasMore ? currentIndex.toString() : undefined,
      hasMore
    };
  }

  private async getAllNodes(document: DocumentNode): Promise<SceneNode[]> {
    const allNodes: SceneNode[] = [];
    const queue: SceneNode[] = [...document.children];

    while (queue.length > 0) {
      const node = queue.shift()!;

      if ('children' in node) {
        queue.push(...node.children);
      }

      allNodes.push(node);
    }

    return allNodes;
  }

  async getFileInfoChunked(
    fileKey: string,
    cursor?: string,
    depth?: number
  ): Promise<ChunkResult> {
    try {
      const response = await this.client.get(`/files/${fileKey}`, {
        params: { depth },
      });

      if (!response.data || !response.data.document) {
        throw new Error('Invalid response from Figma API');
      }

      const allNodes = await this.getAllNodes(response.data.document);
      const startIndex = cursor ? parseInt(cursor, 10) : 0;

      return this.processNodeChunk(allNodes, startIndex);
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
      
      if (!this.checkMemoryUsage()) {
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
      
      if (!this.checkMemoryUsage()) {
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
      
      if (!this.checkMemoryUsage()) {
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
      
      if (!this.checkMemoryUsage()) {
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
        if (!this.checkMemoryUsage()) {
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
