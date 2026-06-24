#!/usr/bin/env node
// ocr-engine MCP Server
// OCR 确定性工程层 — 代码审查预处理/后处理
// 遵循 @modelcontextprotocol/sdk 标准

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { tools } from "./tools/index.js";

const SERVER_VERSION = "0.1.0";

// 创建 Server 实例
const server = new Server(
  {
    name: "ocr-engine",
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 初始化 handler
server.setRequestHandler(InitializeRequestSchema, (request) => {
  console.error(`[ocr-engine] Initialized (protocol ${request.params?.protocolVersion})`);
  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "ocr-engine",
      version: SERVER_VERSION,
    },
  };
});

// 工具列表 handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error(`[ocr-engine] Listing ${tools.length} tools`);
  return {
    tools: tools.map((t) => t.definition),
  };
});

// 工具调用 handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const startTime = Date.now();

  console.error(`[ocr-engine] Tool call: ${toolName}`);

  const tool = tools.find((t) => t.definition.name === toolName);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Error: Tool not found: ${toolName}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(request.params.arguments || {});
    const elapsed = Date.now() - startTime;

    console.error(`[ocr-engine] ${toolName} completed in ${elapsed}ms`);

    // 如果 result 已经包含 content 字段（MCP Response 格式），直接返回
    if (result && result.content && Array.isArray(result.content)) {
      return {
        content: result.content,
        isError: result.isError || false,
      };
    }

    // 否则序列化为 JSON
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[ocr-engine] ${toolName} failed in ${elapsed}ms: ${error.message}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: true,
              tool: toolName,
              message: error.message,
              stack: error.stack,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// 启动
async function main() {
  const transport = new StdioServerTransport();

  process.on("SIGTERM", async () => {
    console.error("[ocr-engine] SIGTERM received, shutting down...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.error("[ocr-engine] SIGINT received, shutting down...");
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error(`[ocr-engine] Server started (v${SERVER_VERSION})`);
}

main().catch((error) => {
  console.error("[ocr-engine] Failed to start:", error);
  process.exit(1);
});
