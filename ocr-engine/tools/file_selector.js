// tools/file_selector.js
// 智能文件选择器 — 决定哪些文件需要审查

// 内置测试文件模式（零外部依赖，纯正则实现）
const BUILTIN_TEST_PATTERNS = [
  /[._-]test[._-]/i,     // foo_test.py, foo.test.js, test-helper.js
  /\/test[._-]/i,         // /test_foo.py (path component start)
  /[._-]spec[._-]/i,     // foo_spec.rb
  /^test[._-]/i,          // test_main.py (filename starts with test_)
  /\/test\//i,            // test/ directory
  /\/tests\//i,           // tests/ directory
  /\/__tests__\//i,       // __tests__/ directory
  /\/spec\//i,            // spec/ directory
  /\/__mocks__\//i,       // __mocks__/ directory
  /\/fixtures?\//i,       // fixtures/ directory
  /Test\.\w+$/,           // FooTest.java
  /Tests\.\w+$/,          // FooTests.java
  /Spec\.\w+$/,           // FooSpec.java
];

const BUILTIN_EXCLUDE_PATTERNS = [
  /\/node_modules\//i,
  /^node_modules\//i,
  /\/vendor\//i,
  /^vendor\//i,
  /\/dist\//i,
  /^dist\//i,
  /\/build\//i,
  /^build\//i,
  /\/\.git\//i,
  /^\.git\//i,
  /\/__pycache__\//i,
  /\/\.next\//i,
  /\/\.nuxt\//i,
  /\/coverage\//i,
  /\.min\.\w+$/i,
  /\.bundle\.\w+$/i,
  /\.generated\.\w+$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
];

/**
 * 检测文件语言
 */
function detectLanguage(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap = {
    js: "JavaScript",
    jsx: "JavaScript (React)",
    ts: "TypeScript",
    tsx: "TypeScript (React)",
    py: "Python",
    java: "Java",
    go: "Go",
    rs: "Rust",
    rb: "Ruby",
    php: "PHP",
    c: "C",
    cpp: "C++",
    h: "C/C++ Header",
    cs: "C#",
    swift: "Swift",
    kt: "Kotlin",
    scala: "Scala",
    sh: "Shell",
    bash: "Bash",
    yml: "YAML",
    yaml: "YAML",
    json: "JSON",
    xml: "XML",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    sql: "SQL",
    md: "Markdown",
    tf: "Terraform",
    dockerfile: "Dockerfile",
    toml: "TOML",
    proto: "Protobuf",
    graphql: "GraphQL",
  };
  const baseName = filePath.split("/").pop()?.toLowerCase();
  if (baseName === "dockerfile") return "Dockerfile";
  if (baseName === "makefile") return "Makefile";
  return langMap[ext] || "Unknown";
}

/**
 * 简单的 glob 匹配（支持 **, *, ?）
 */
function globMatch(pattern, filePath) {
  // 转义 regex 特殊字符但保留 glob 通配符
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/\?/g, "[^/]");
  regexStr = `^${regexStr}$`;
  try {
    return new RegExp(regexStr, "i").test(filePath);
  } catch {
    return false;
  }
}

/**
 * 检查文件是否匹配任一模式
 */
function matchesAnyPattern(filePath, patterns) {
  return patterns.some((p) => {
    if (p instanceof RegExp) return p.test(filePath);
    return globMatch(p, filePath);
  });
}

export const definition = {
  name: "file_selector",
  description: "智能文件选择器。基于内置规则和用户配置，过滤出需要审查的文件，排除测试文件、构建产物等。",
  inputSchema: {
    type: "object",
    properties: {
      file_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            old_path: { type: "string" },
            is_binary: { type: "boolean" },
            is_deleted: { type: "boolean" },
            is_new: { type: "boolean" },
            is_renamed: { type: "boolean" },
            insertions: { type: "number" },
            deletions: { type: "number" },
          },
        },
        description: "文件列表（来自 git_diff_get 的 files 输出）",
      },
      include_patterns: {
        type: "array",
        items: { type: "string" },
        description: "白名单模式（glob），匹配才审查",
      },
      exclude_patterns: {
        type: "array",
        items: { type: "string" },
        description: "黑名单模式（glob），匹配则跳过（叠加内置排除）",
      },
      include_tests: {
        type: "boolean",
        description: "是否包含测试文件，默认 false",
        default: false,
      },
      min_change_lines: {
        type: "number",
        description: "最小变更行数阈值，低于此值跳过（默认 0）",
        default: 0,
      },
    },
    required: ["file_list"],
  },
};

export async function handler(args = {}) {
  const {
    file_list: fileList = [],
    include_patterns: includePatterns = [],
    exclude_patterns: excludePatterns = [],
    include_tests: includeTests = false,
    min_change_lines: minChangeLines = 0,
  } = args;

  let selected = [];
  let rejected = [];

  for (const file of fileList) {
    const filePath = file.path || file.new_path || file.old_path || "";
    const reason = [];

    // 1. 跳过二进制文件
    if (file.is_binary) {
      reason.push("binary file");
      rejected.push({ ...file, path: filePath, reason: reason.join("; "), language: "Binary" });
      continue;
    }

    // 2. 跳过删除的文件
    if (file.is_deleted) {
      reason.push("deleted file");
      rejected.push({ ...file, path: filePath, reason: reason.join("; "), language: detectLanguage(filePath) });
      continue;
    }

    // 3. 检查内置排除模式
    const builtinExcluded = matchesAnyPattern(filePath, BUILTIN_EXCLUDE_PATTERNS);
    if (builtinExcluded) {
      reason.push("builtin exclude");
      rejected.push({
        ...file,
        path: filePath,
        reason: reason.join("; "),
        language: detectLanguage(filePath),
      });
      continue;
    }

    // 4. 检查测试文件
    const isTestFile = matchesAnyPattern(filePath, BUILTIN_TEST_PATTERNS);
    if (isTestFile && !includeTests) {
      reason.push("test file");
      rejected.push({
        ...file,
        path: filePath,
        reason: reason.join("; "),
        language: detectLanguage(filePath),
      });
      continue;
    }

    // 5. 检查最小变更行数
    const changeLines = (file.insertions || 0) + (file.deletions || 0);
    if (changeLines < minChangeLines) {
      reason.push(`below threshold (${changeLines} < ${minChangeLines})`);
      rejected.push({
        ...file,
        path: filePath,
        reason: reason.join("; "),
        language: detectLanguage(filePath),
      });
      continue;
    }

    // 6. 检查用户白名单
    if (includePatterns.length > 0) {
      const included = matchesAnyPattern(filePath, includePatterns);
      if (!included) {
        reason.push("not in include patterns");
        rejected.push({
          ...file,
          path: filePath,
          reason: reason.join("; "),
          language: detectLanguage(filePath),
        });
        continue;
      }
    }

    // 7. 检查用户黑名单
    if (excludePatterns.length > 0) {
      const excluded = matchesAnyPattern(filePath, excludePatterns);
      if (excluded) {
        reason.push("user exclude pattern");
        rejected.push({
          ...file,
          path: filePath,
          reason: reason.join("; "),
          language: detectLanguage(filePath),
        });
        continue;
      }
    }

    // 通过所有过滤
    selected.push({
      ...file,
      path: filePath,
      language: detectLanguage(filePath),
      is_test: isTestFile,
    });
  }

  return {
    selected_count: selected.length,
    rejected_count: rejected.length,
    total_count: fileList.length,
    selected: selected.map((f) => ({
      path: f.path,
      language: f.language,
      is_new: f.is_new || false,
      is_renamed: f.is_renamed || false,
      is_test: f.is_test || false,
      insertions: f.insertions || 0,
      deletions: f.deletions || 0,
      change_lines: (f.insertions || 0) + (f.deletions || 0),
      hunks_count: f.hunks_count || 0,
    })),
    rejected: rejected.map((f) => ({
      path: f.path,
      language: f.language,
      reason: f.reason,
    })),
  };
}
