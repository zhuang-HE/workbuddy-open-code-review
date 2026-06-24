// tools/result_formatter.js
// 审查结果格式化器 — Markdown / JSON / Checkstyle 三种输出

const SEVERITY_EMOJI = {
  blocker: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const SEVERITY_LABEL = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const definition = {
  name: "result_formatter",
  description: "审查结果格式化器。将合并后的评论格式化为 Markdown 报告、JSON 数据或 Checkstyle XML。",
  inputSchema: {
    type: "object",
    properties: {
      merged_comments: {
        type: "array",
        items: { type: "object" },
        description: "合并后的评论数组（来自 comment_merger）",
      },
      format: {
        type: "string",
        enum: ["markdown", "json", "checkstyle"],
        description: "输出格式，默认 markdown",
        default: "markdown",
      },
      repo_name: {
        type: "string",
        description: "仓库名称（用于报告标题）",
      },
      from_ref: {
        type: "string",
        description: "源引用",
      },
      to_ref: {
        type: "string",
        description: "目标引用",
      },
      stats: {
        type: "object",
        description: "diff 统计信息（来自 git_diff_get 的 stats）",
      },
      token_usage: {
        type: "object",
        description: "Token 使用统计",
        properties: {
          input_tokens: { type: "number" },
          output_tokens: { type: "number" },
          total_tokens: { type: "number" },
        },
      },
    },
    required: ["merged_comments"],
  },
};

export async function handler(args = {}) {
  const {
    merged_comments: comments = [],
    format = "markdown",
    repo_name: repoName = "Unknown",
    from_ref: fromRef,
    to_ref: toRef,
    stats,
    token_usage: tokenUsage,
  } = args;

  switch (format) {
    case "json":
      return formatJson(comments, repoName, { fromRef, toRef, stats, tokenUsage });
    case "checkstyle":
      return formatCheckstyle(comments);
    case "markdown":
    default:
      return formatMarkdown(comments, repoName, { fromRef, toRef, stats, tokenUsage });
  }
}

function formatMarkdown(comments, repoName, meta) {
  const lines = [];
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  // Header
  lines.push(`# 🔍 代码审查报告`);
  lines.push("");
  lines.push(`## 审查概览`);
  lines.push("");
  lines.push(`| 项目 | 详情 |`);
  lines.push(`|------|------|`);
  lines.push(`| **仓库** | ${repoName} |`);
  if (meta.fromRef && meta.toRef) {
    lines.push(`| **范围** | ${meta.fromRef} → ${meta.toRef} |`);
  }
  lines.push(`| **审查时间** | ${now} |`);
  lines.push(`| **审查引擎** | OCR Engine (WorkBuddy) |`);
  if (meta.stats) {
    lines.push(`| **变更文件** | ${meta.stats.totalFiles} |`);
    lines.push(`| **新增行** | +${meta.stats.totalInsertions} |`);
    lines.push(`| **删除行** | -${meta.stats.totalDeletions} |`);
  }
  if (meta.tokenUsage) {
    lines.push(`| **输入 Tokens** | ${meta.tokenUsage.input_tokens?.toLocaleString() || "N/A"} |`);
    lines.push(`| **输出 Tokens** | ${meta.tokenUsage.output_tokens?.toLocaleString() || "N/A"} |`);
    lines.push(`| **总 Tokens** | ${meta.tokenUsage.total_tokens?.toLocaleString() || "N/A"} |`);
  }
  lines.push("");

  // 统计
  const bySeverity = {};
  const byCategory = {};
  for (const c of comments) {
    bySeverity[c.severity] = (bySeverity[c.severity] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
  }

  lines.push(`## 问题汇总`);
  lines.push("");
  lines.push(`| 级别 | 数量 | 说明 |`);
  lines.push(`|------|------|------|`);
  for (const [sev, label] of Object.entries(SEVERITY_LABEL)) {
    const count = bySeverity[sev] || 0;
    if (count > 0) {
      const emoji = SEVERITY_EMOJI[sev] || "⚪";
      lines.push(`| ${emoji} ${label} | ${count} | ${getSeverityDesc(sev)} |`);
    }
  }
  if (comments.length === 0) {
    lines.push(`| ✅ 无问题 | 0 | 审查未发现需要注意的问题 |`);
  }
  lines.push("");

  if (Object.keys(byCategory).length > 0) {
    lines.push(`| 类别 | 数量 |`);
    lines.push(`|------|------|`);
    for (const [cat, count] of Object.entries(byCategory)) {
      lines.push(`| ${cat} | ${count} |`);
    }
    lines.push("");
  }

  // 详细问题
  if (comments.length > 0) {
    lines.push(`## 详细问题`);
    lines.push("");
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const emoji = SEVERITY_EMOJI[c.severity] || "⚪";
      const label = SEVERITY_LABEL[c.severity] || c.severity;

      lines.push(`### ${i + 1}. ${emoji} [${c.title || "Untitled"}] — ${label}`);
      lines.push("");
      lines.push(`**位置**: \`${c.path || "unknown"}:${c.start_line || "?"}-${c.end_line || "?"}\``);
      lines.push("");
      lines.push(`**类别**: ${c.category || "N/A"}`);
      lines.push("");

      if (c.description) {
        lines.push(`**描述**:`);
        lines.push("");
        lines.push(`${c.description}`);
        lines.push("");
      }

      if (c.existing_code) {
        lines.push(`**当前代码**:`);
        lines.push("```");
        lines.push(c.existing_code);
        lines.push("```");
        lines.push("");
      }

      if (c.suggestion_code) {
        lines.push(`**建议修复**:`);
        lines.push("```");
        lines.push(c.suggestion_code);
        lines.push("```");
        lines.push("");
      }

      if (c._deduplicated) {
        lines.push(`> ℹ️ 此问题在 ${c._duplicate_count} 个子Agent中重复出现`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  // 评分
  if (comments.length > 0) {
    lines.push(`## 总体评分`);
    lines.push("");
    const blockerCount = bySeverity["blocker"] || 0;
    const highCount = bySeverity["high"] || 0;
    const mediumCount = bySeverity["medium"] || 0;
    const lowCount = bySeverity["low"] || 0;

    lines.push(`| 维度 | 评分 | 说明 |`);
    lines.push(`|------|------|------|`);
    lines.push(`| 安全性 | ${starScore(blockerCount, "security")} | ${blockerCount} 个阻塞问题 |`);
    lines.push(`| 代码质量 | ${starScore(highCount, "quality")} | ${highCount} 个高优问题 |`);
    lines.push(`| 性能 | ${starScore(Math.max(0, 5 - mediumCount), "perf")} | ${mediumCount + lowCount} 个中低优问题 |`);
    lines.push(`| 可维护性 | ${starScore(Math.max(0, 5 - comments.length / 3), "maint")} | ${comments.length} 个总问题 |`);
    lines.push("");

    // 行动项
    lines.push(`## 优先行动项`);
    lines.push("");
    if (blockerCount > 0) lines.push(`- [ ] 🔴 立即修复 ${blockerCount} 个 Blocker 问题`);
    if (highCount > 0) lines.push(`- [ ] 🟠 24小时内修复 ${highCount} 个 High 问题`);
    if (mediumCount > 0) lines.push(`- [ ] 🟡 下次迭代处理 ${mediumCount} 个 Medium 问题`);
    if (lowCount > 0) lines.push(`- [ ] 🟢 排期优化 ${lowCount} 个 Low 建议`);
  }

  return {
    format: "markdown",
    title: `代码审查报告 — ${repoName}`,
    report: lines.join("\n"),
    comment_count: comments.length,
  };
}

function formatJson(comments, repoName, meta) {
  return {
    format: "json",
    data: {
      repo: repoName,
      from_ref: meta.fromRef || null,
      to_ref: meta.toRef || null,
      timestamp: new Date().toISOString(),
      stats: meta.stats || null,
      token_usage: meta.tokenUsage || null,
      comment_count: comments.length,
      comments: comments.map((c) => ({
        path: c.path,
        start_line: c.start_line,
        end_line: c.end_line,
        severity: c.severity,
        category: c.category,
        title: c.title,
        description: c.description || "",
        suggestion_code: c.suggestion_code || "",
        existing_code: c.existing_code || "",
        confidence: c.confidence,
        deduplicated: c._deduplicated || false,
        duplicate_count: c._duplicate_count || 0,
      })),
    },
  };
}

function formatCheckstyle(comments) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<checkstyle version="8.0">');

  const byFile = {};
  for (const c of comments) {
    if (!byFile[c.path]) byFile[c.path] = [];
    byFile[c.path].push(c);
  }

  for (const [file, fileComments] of Object.entries(byFile)) {
    lines.push(`  <file name="${escapeXml(file)}">`);
    for (const c of fileComments) {
      lines.push(
        `    <error line="${c.start_line || 0}" ` +
        `column="0" ` +
        `severity="${mapCheckstyleSeverity(c.severity)}" ` +
        `message="${escapeXml(c.title || "")}" ` +
        `source="${c.category || "code-review"}.${c.severity || "info"}"/>`
      );
    }
    lines.push("  </file>");
  }

  lines.push("</checkstyle>");
  return {
    format: "checkstyle",
    report: lines.join("\n"),
    comment_count: comments.length,
  };
}

function getSeverityDesc(severity) {
  const map = {
    blocker: "必须立即修复",
    high: "应尽快修复",
    medium: "建议修复",
    low: "可选优化",
  };
  return map[severity] || "";
}

function starScore(n, category) {
  // 根据 blocker 数量计算星级（反向）
  let stars = 5;
  if (n >= 3) stars = 2;
  else if (n >= 2) stars = 3;
  else if (n >= 1) stars = 4;
  return "⭐".repeat(stars) + "☆".repeat(5 - stars) + ` (${stars}/5)`;
}

function mapCheckstyleSeverity(severity) {
  const map = { blocker: "error", high: "error", medium: "warning", low: "info" };
  return map[severity] || "info";
}

function escapeXml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
