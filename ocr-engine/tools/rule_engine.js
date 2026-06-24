// tools/rule_engine.js
// 审查规则引擎 — 四级优先级链匹配

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";

let _defaultRules = null;

function getDefaultRules() {
  if (_defaultRules) return _defaultRules;
  try {
    const baseDir = import.meta.dirname;
    const configPath = resolve(baseDir, "..", "config", "default-rules.json");
    const content = readFileSync(configPath, "utf-8");
    _defaultRules = JSON.parse(content);
    return _defaultRules;
  } catch (e) {
    console.error("[rule_engine] Failed to load default rules:", e.message);
    return { rules: [], default_exclude: [], test_patterns: [] };
  }
}

/**
 * 加载规则配置
 */
function loadRulesConfig(configPath) {
  if (!configPath || !existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * glob 转正则
 */
function globToRegex(pattern) {
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * 检查文件是否匹配规则的 path
 */
function matchRulePath(filePath, rule) {
  // 多路径模式（大括号展开）
  let patterns = [rule.path];
  if (rule.path.includes("{")) {
    patterns = expandBraces(rule.path);
  } else if (rule.path.includes(",")) {
    // 仅当没有大括号时才按逗号拆分（防止覆盖 brace expansion 结果）
    patterns = rule.path.split(",").map((p) => p.trim());
  }

  return patterns.some((pattern) => globToRegex(pattern).test(filePath));
}

/**
 * 简单的大括号展开
 */
function expandBraces(pattern) {
  const match = pattern.match(/^(.+)\{([^}]+)\}(.*)$/);
  if (!match) return [pattern];
  const prefix = match[1];
  const options = match[2].split(",").map((o) => o.trim());
  const suffix = match[3];
  return options.map((opt) => prefix + opt + suffix);
}

/**
 * 检查文件是否匹配规则的 exclude
 */
function matchExcludePath(filePath, rule) {
  if (!rule.exclude || rule.exclude.length === 0) return false;
  return rule.exclude.some((pattern) => globToRegex(pattern).test(filePath));
}

export const definition = {
  name: "rule_engine",
  description: "审查规则引擎。按照四级优先级链匹配审查规则：用户指定 > 项目规则 > 全局规则 > 系统默认规则。首次匹配即获胜。",
  inputSchema: {
    type: "object",
    properties: {
      file_paths: {
        type: "array",
        items: { type: "string" },
        description: "文件路径列表（捆绑包中的文件）",
      },
      language: {
        type: "string",
        description: "主要语言（可选，辅助过滤）",
      },
      user_rule_path: {
        type: "string",
        description: "用户显式指定的规则文件路径（最高优先级）",
      },
      project_rule_path: {
        type: "string",
        description: "项目级规则文件路径（如 .opencodereview/rule.json）",
      },
      global_rule_path: {
        type: "string",
        description: "全局规则文件路径（如 ~/.opencodereview/rule.json）",
      },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: ["security", "quality", "performance", "maintainability"],
        },
        description: "只返回指定类别的规则",
      },
      severities: {
        type: "array",
        items: {
          type: "string",
          enum: ["blocker", "high", "medium", "low"],
        },
        description: "只返回指定严重级别的规则",
      },
    },
    required: ["file_paths"],
  },
};

export async function handler(args = {}) {
  const {
    file_paths: filePaths = [],
    language,
    user_rule_path: userRulePath,
    project_rule_path: projectRulePath,
    global_rule_path: globalRulePath,
    categories,
    severities,
  } = args;

  // 四级优先级链
  const priorityChain = [
    { level: 1, source: "user", path: userRulePath },
    { level: 2, source: "project", path: projectRulePath },
    { level: 3, source: "global", path: globalRulePath || join(homedir(), ".opencodereview", "rule.json") },
    { level: 4, source: "system", path: null }, // 使用内嵌默认规则
  ];

  // 按文件收集匹配的规则
  const results = {};

  for (const filePath of filePaths) {
    results[filePath] = { matched_rules: [], source_level: null, source_name: null };
    let matched = false;

    // 遍历优先级链
    for (const level of priorityChain) {
      const rulesConfig = level.source === "system"
        ? getDefaultRules()
        : loadRulesConfig(level.path);

      if (!rulesConfig || !rulesConfig.rules) continue;

      for (const rule of rulesConfig.rules) {
        // 检查语言过滤
        if (language && rule.path && !rule.path.includes(`*.${language.toLowerCase()}`)) {
          const extMatch = rule.path.match(/\*\.\{?([a-zA-Z0-9,]+)\}?/);
          if (extMatch) {
            const exts = extMatch[1].split(",").map((e) => e.trim().toLowerCase());
            if (!exts.some((e) => filePath.toLowerCase().endsWith(`.${e}`))) {
              continue;
            }
          }
        }

        // 检查 path 匹配
        if (!matchRulePath(filePath, rule)) continue;

        // 检查 exclude 匹配
        if (matchExcludePath(filePath, rule)) continue;

        // 类别过滤
        if (categories && categories.length > 0 && !categories.includes(rule.category)) continue;

        // 严重度过滤
        if (severities && severities.length > 0 && !severities.includes(rule.severity)) continue;

        results[filePath].matched_rules.push({
          id: rule.id,
          name: rule.name,
          category: rule.category,
          severity: rule.severity,
          description: rule.description,
          check_patterns: rule.check_patterns || [],
        });
        matched = true;
      }

      // 首次匹配即获胜
      if (matched && results[filePath].matched_rules.length > 0) {
        results[filePath].source_level = level.level;
        results[filePath].source_name = level.source;
        break;
      }
    }
  }

  // 汇总统计
  const allRules = [];
  for (const [filePath, data] of Object.entries(results)) {
    for (const rule of data.matched_rules) {
      allRules.push({ ...rule, file: filePath });
    }
  }

  const byCategory = {};
  const bySeverity = {};
  for (const rule of allRules) {
    byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    bySeverity[rule.severity] = (bySeverity[rule.severity] || 0) + 1;
  }

  return {
    total_rules_matched: allRules.length,
    files_matched: Object.values(results).filter((r) => r.matched_rules.length > 0).length,
    total_files: filePaths.length,
    by_category: byCategory,
    by_severity: bySeverity,
    per_file: results,
    all_rules: allRules,
  };
}
