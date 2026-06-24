// lib/diff-parser.js
// Unified Diff 格式解析器
// 将 git diff 的原始文本解析为结构化数据

/**
 * 解析完整的 git diff 输出
 * @param {string} diffText - git diff 的原始输出
 * @returns {Object} 结构化的 diff 数据
 */
export function parseDiffText(diffText) {
  if (!diffText || diffText.trim() === "") {
    return { files: [], stats: { totalFiles: 0, totalInsertions: 0, totalDeletions: 0 } };
  }

  const files = [];
  const lines = diffText.split("\n");

  let currentFile = null;
  let currentHunk = null;
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 文件头: diff --git a/path b/path
    const fileHeaderMatch = line.match(/^diff --git a\/(.*?) b\/(.*?)$/);
    if (fileHeaderMatch) {
      if (currentFile) {
        finalizeHunk(currentFile, currentHunk);
        files.push(currentFile);
      }
      currentFile = {
        oldPath: fileHeaderMatch[1],
        newPath: fileHeaderMatch[2],
        isBinary: false,
        isDeleted: false,
        isNew: false,
        isRenamed: false,
        oldMode: null,
        newMode: null,
        hunks: [],
        insertions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    // 模式变更
    const modeMatch = line.match(/^(old|new) mode (\d+)$/);
    if (modeMatch) {
      if (modeMatch[1] === "old") currentFile.oldMode = modeMatch[2];
      if (modeMatch[1] === "new") currentFile.newMode = modeMatch[2];
      continue;
    }

    // 重命名
    const renameMatch = line.match(/^rename (from|to) (.*)$/);
    if (renameMatch) {
      currentFile.isRenamed = true;
      continue;
    }

    // 二进制文件
    if (line.startsWith("Binary files")) {
      currentFile.isBinary = true;
      continue;
    }

    // 删除文件
    const deletedMatch = line.match(/^deleted file mode \d+$/);
    if (deletedMatch) {
      currentFile.isDeleted = true;
      continue;
    }

    // 新文件
    const newFileMatch = line.match(/^new file mode \d+$/);
    if (newFileMatch) {
      currentFile.isNew = true;
      continue;
    }

    // --- a/path 和 +++ b/path（可能包含时间戳）
    if (line.startsWith("--- a/") || line.startsWith("--- /dev/null")) {
      if (line.startsWith("--- /dev/null")) {
        currentFile.isNew = true;
      }
      continue;
    }
    if (line.startsWith("+++ b/") || line.startsWith("+++ /dev/null")) {
      if (line.startsWith("+++ /dev/null")) {
        currentFile.isDeleted = true;
      }
      continue;
    }

    // Hunk 头: @@ -start,len +start,len @@ context
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        finalizeHunk(currentFile, currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2] || "1"),
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4] || "1"),
        context: (hunkMatch[5] || "").trim(),
        lines: [],
        rawText: line + "\n",
      };
      continue;
    }

    // Hunk 行
    if (currentHunk) {
      const prefix = line.charAt(0);
      if (prefix === " " || prefix === "+" || prefix === "-") {
        const lineContent = line.substring(1);
        currentHunk.lines.push({ prefix, content: lineContent });
        currentHunk.rawText += line + "\n";

        // 文件级统计
        if (prefix === "+" && !line.startsWith("+++")) {
          currentFile.insertions++;
          totalInsertions++;
        } else if (prefix === "-" && !line.startsWith("---")) {
          currentFile.deletions++;
          totalDeletions++;
        }
      } else if (line === "\\ No newline at end of file") {
        currentHunk.lines.push({ prefix: "\\", content: "No newline at end of file" });
        currentHunk.rawText += line + "\n";
      }
    }
  }

  // 处理最后一个文件
  if (currentFile) {
    finalizeHunk(currentFile, currentHunk);
    files.push(currentFile);
  }

  return {
    files,
    stats: {
      totalFiles: files.length,
      totalInsertions,
      totalDeletions,
    },
  };
}

/**
 * 完成一个 hunk 的处理
 */
function finalizeHunk(file, hunk) {
  if (hunk && hunk.lines.length > 0) {
    file.hunks.push(hunk);
  }
}

/**
 * 解析 git diff --name-status 输出
 * @param {string} nameStatusText
 * @returns {Array<{status: string, oldPath: string, newPath?: string}>}
 */
export function parseNameStatus(nameStatusText) {
  if (!nameStatusText || nameStatusText.trim() === "") {
    return [];
  }

  return nameStatusText
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0];
      if (parts.length === 2) {
        return { status, path: parts[1], oldPath: parts[1], newPath: parts[1] };
      }
      if (parts.length === 3) {
        return { status, oldPath: parts[1], newPath: parts[2], path: parts[2] };
      }
      return { status, path: "", raw: line };
    })
    .filter((f) => f.path !== null);
}

/**
 * 从解析后的 diff 中提取指定文件指定行范围的内容
 * @param {Object} parsedDiff - parseDiffText 的输出
 * @param {string} filePath - 文件路径（newPath）
 * @param {number} startLine - 起始行号（新文件行号）
 * @param {number} endLine - 结束行号（新文件行号）
 * @returns {Object|null} 匹配的 hunk 和具体行
 */
export function findHunkByLine(parsedDiff, filePath, startLine, endLine) {
  const file = parsedDiff.files.find(
    (f) => f.newPath === filePath || f.oldPath === filePath
  );
  if (!file || file.isBinary) return null;

  for (const hunk of file.hunks) {
    const hunkEnd = hunk.newStart + hunk.newLines - 1;
    if (startLine <= hunkEnd && endLine >= hunk.newStart) {
      // 这个 hunk 与目标行范围有交集
      const relevantLines = hunk.lines.filter((l, idx) => {
        if (l.prefix === "-") return true; // 包含删除行
        const lineNum = calculateNewLine(hunk, idx);
        return lineNum >= startLine && lineNum <= endLine;
      });

      return {
        filePath,
        hunk,
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        relevantLines,
        rawText: hunk.rawText,
      };
    }
  }
  return null;
}

/**
 * 计算 hunk 中某行的新文件行号
 */
function calculateNewLine(hunk, lineIndex) {
  let newLine = hunk.newStart;
  for (let i = 0; i < lineIndex; i++) {
    if (hunk.lines[i].prefix !== "-") {
      newLine++;
    }
  }
  return newLine;
}

/**
 * 计算有效的审查代码行数（排除纯格式变更、注释等）
 */
export function countReviewableLines(hunks) {
  let count = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.prefix === "+" || line.prefix === "-") {
        const trimmed = line.content.trim();
        // 排除纯空行、纯注释行、纯花括号
        if (trimmed === "" || trimmed === "{" || trimmed === "}" || trimmed === "};") {
          continue;
        }
        if (/^\s*\/\/.*$/i.test(trimmed) || /^\s*#.*$/i.test(trimmed)) {
          continue;
        }
        count++;
      }
    }
  }
  return count;
}
