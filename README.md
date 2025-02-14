# Figma MCP Server with Chunking

A Model Context Protocol (MCP) server for interacting with the Figma API, featuring memory-efficient chunking and pagination capabilities for handling large Figma files.

## Overview

This MCP server provides a robust interface to the Figma API with built-in memory management features. It's designed to handle large Figma files efficiently by breaking down operations into manageable chunks and implementing pagination where necessary.

### Key Features

- Memory-aware processing with configurable limits
- Chunked data retrieval for large files
- Pagination support for all listing operations
- Node type filtering
- Progress tracking
- Configurable chunk sizes
- Resume capability for interrupted operations
- Debug logging
- Config file support

## Installation

```bash
# Clone the repository
git clone [repository-url]
cd figma-mcp-chunked

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

### Environment Variables

- `FIGMA_ACCESS_TOKEN`: Your Figma API access token

### Config File

You can provide configuration via a JSON file using the `--config` flag:

```json
{
  "mcpServers": {
    "figma": {
      "env": {
        "FIGMA_ACCESS_TOKEN": "your-access-token"
      }
    }
  }
}
```

Usage:
```bash
node build/index.js --config=path/to/config.json
```

## Tools

### get_file_data (New)

Retrieves Figma file data with memory-efficient chunking and pagination.

```typescript
{
  "name": "get_file_data",
  "arguments": {
    "fileKey": "your-file-key",
    "accessToken": "your-access-token",
    "pageSize": 100,          // Optional: nodes per chunk
    "maxMemoryMB": 512,       // Optional: memory limit
    "nodeTypes": ["FRAME", "COMPONENT"],  // Optional: filter by type
    "cursor": "next-page-token",  // Optional: resume from last position
    "depth": 2                // Optional: traversal depth
  }
}
```

Response:
```json
{
  "nodes": [...],
  "memoryUsage": 256.5,
  "nextCursor": "next-page-token",
  "hasMore": true
}
```

### list_files

Lists files with pagination support.

```typescript
{
  "name": "list_files",
  "arguments": {
    "project_id": "optional-project-id",
    "team_id": "optional-team-id"
  }
}
```

### get_file_versions

Retrieves version history in chunks.

```typescript
{
  "name": "get_file_versions",
  "arguments": {
    "file_key": "your-file-key"
  }
}
```

### get_file_comments

Retrieves comments with pagination.

```typescript
{
  "name": "get_file_comments",
  "arguments": {
    "file_key": "your-file-key"
  }
}
```

### get_file_info

Retrieves file information with chunked node traversal.

```typescript
{
  "name": "get_file_info",
  "arguments": {
    "file_key": "your-file-key",
    "depth": 2,               // Optional: traversal depth
    "node_id": "specific-node-id"  // Optional: start from specific node
  }
}
```

### get_components

Retrieves components with chunking support.

```typescript
{
  "name": "get_components",
  "arguments": {
    "file_key": "your-file-key"
  }
}
```

### get_styles

Retrieves styles with chunking support.

```typescript
{
  "name": "get_styles",
  "arguments": {
    "file_key": "your-file-key"
  }
}
```

### get_file_nodes

Retrieves specific nodes with chunking support.

```typescript
{
  "name": "get_file_nodes",
  "arguments": {
    "file_key": "your-file-key",
    "ids": ["node-id-1", "node-id-2"]
  }
}
```

## Memory Management

The server implements several strategies to manage memory efficiently:

### Chunking Strategy

- Configurable chunk sizes via `pageSize`
- Memory usage monitoring
- Automatic chunk size adjustment based on memory pressure
- Progress tracking per chunk
- Resume capability using cursors

### Best Practices

1. Start with smaller chunk sizes (50-100 nodes) and adjust based on performance
2. Monitor memory usage through the response metadata
3. Use node type filtering when possible to reduce data load
4. Implement pagination for large datasets
5. Use the resume capability for very large files

### Configuration Options

- `pageSize`: Number of nodes per chunk (default: 100)
- `maxMemoryMB`: Maximum memory usage in MB (default: 512)
- `nodeTypes`: Filter specific node types
- `depth`: Control traversal depth for nested structures

## Debug Logging

The server includes comprehensive debug logging:

```typescript
// Debug log examples
[MCP Debug] Loading config from config.json
[MCP Debug] Access token found xxxxxxxx...
[MCP Debug] Request { tool: 'get_file_data', arguments: {...} }
[MCP Debug] Response size 2.5 MB
```

## Error Handling

The server provides detailed error messages and suggestions:

```typescript
// Memory limit error
"Response size too large. Try using a smaller depth value or specifying a node_id."

// Invalid parameters
"Missing required parameters: fileKey and accessToken"

// API errors
"Figma API error: [detailed message]"
```

## Troubleshooting

### Common Issues

1. Memory Errors
   - Reduce chunk size
   - Use node type filtering
   - Implement pagination
   - Specify smaller depth values

2. Performance Issues
   - Monitor memory usage
   - Adjust chunk sizes
   - Use appropriate node type filters
   - Implement caching for frequently accessed data

3. API Limits
   - Implement rate limiting
   - Use pagination
   - Cache responses when possible

### Debug Mode

Enable debug logging for detailed information:

```bash
# Set debug environment variable
export DEBUG=true
```

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
