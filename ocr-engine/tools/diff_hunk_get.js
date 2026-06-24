// tools/diff_hunk_get.js
// 获取指定文件中指定行范围的 diff 内容

import { getFileContent } from "../lib/git-runner.js";
import { parseDiffText, findHunkByLine } from "../lib/diff-parser.js";
import { readFileSync, existsSync } from "fs";

export const definition = {
  name: "diff_hunk_get",
  description: "获取指定文件的指定行范围 diff 内容，包含上下文代码。用于评论重定位阶段验证和精确行号修正。",
  inputSchema: {
    type: "object",
    properties: {
      repo_path: {
        type: "string",
        description: "Git 仓库路径",
      },
      diff_text: {
        type: "string",
        description: "完整的 git diff 原始文本（可选，如果不提供则从 repo_path 实时获取）",
      },
      file_path: {
        type: "string",
        description: "目标文件路径",
      },
      start_line: {
        type: "number",
        description: "起始行号（新文件行号）",
      },
      end_line: {
        type: "number",
        description: "结束行号（新文件行号）",
      },
      context_lines: {
        type: "number",
        description: "额外上下文行数（默认 3）",
        default: 3,
      },
      from_ref: {
        type: "string",
        description: "源引用（获取完整文件内容时使用）",
      },
      to_ref: {
        type: "string",
        description: "目标引用，默认 HEAD",
      },
    },
    required: ["file_path", "start_line", "end_line"],
  },
};

export async function handler(args = {}) {
  const {
    repo_path: repoPath,
    diff_text: diffText,
    file_path: filePath,
    start_line: startLine,
    end_line: endLine,
    context_lines: contextLines = 3,
    from_ref: fromRef,
    to_ref: toRef,
  } = args;

  try {
    let parsedDiff;
    if (diffText) {
      parsedDiff = parseDiffText(diffText);
    }

    // 如果提供了 repoPath，尝试获取完整文件内容
    let fullFileContent = null;
    let oldFileContent = null;

    if (repoPath) {
      // 新版本文件内容
      const ref = toRef || "HEAD";
      try {
        const result = await getFileContent(repoPath, filePath, ref);
        fullFileContent = result.stdout;
      } catch {
        // 文件可能在当前 ref 不存在
      }

      // 旧版本（用于删除行的上下文）
      if (fromRef) {
        try {
          const result = await getFileContent(repoPath, filePath, fromRef);
          oldFileContent = result.stdout;
        } catch {
          // 新文件，旧版本不存在
        }
      }
    }

    // 从 diff 中找到匹配的 hunk
    let hunkInfo = null;
    if (parsedDiff) {
      hunkInfo = findHunkByLine(parsedDiff, filePath, startLine, endLine);
    }

    // 提取上下文代码片段
    const contextBefore = fullFileContent
      ? extractContext(fullFileContent, startLine, contextLines, "before")
      : null;
    const contextAfter = fullFileContent
      ? extractContext(fullFileContent, endLine, contextLines, "after")
      : null;

    return {
      file_path: filePath,
      start_line: startLine,
      end_line: endLine,
      found_in_diff: hunkInfo !== null,
      hunk: hunkInfo
        ? {
            old_start: hunkInfo.oldStart,
            new_start: hunkInfo.newStart,
            relevant_lines: hunkInfo.relevantLines.map((l) => ({
              prefix: l.prefix,
              content: l.content,
            })),
            raw_text: hunkInfo.rawText,
          }
        : null,
      context: {
        before: contextBefore,
        after: contextAfter,
      },
      has_full_file: fullFileContent !== null,
      has_old_file: oldFileContent !== null,
    };
  } catch (error) {
    return {
      error: true,
      message: error.message,
      file_path: filePath,
    };
  }
}

/**
 * 从文件内容中提取上下文行
 */
function extractContext(content, lineNo, contextLines, direction) {
  if (!content) return null;
  const lines = content.split("\n");
  const result = [];

  if (direction === "before") {
    const start = Math.max(0, lineNo - 1 - contextLines);
    for (let i = start; i < lineNo - 1; i++) {
      result.push({ line: i + 1, content: lines[i] || "" });
    }
  } else {
    const end = Math.min(lines.length, lineNo + contextLines);
    for (let i = lineNo; i < end; i++) {
      result.push({ line: i + 1, content: lines[i] || "" });
    }
  }

  return result;
}
