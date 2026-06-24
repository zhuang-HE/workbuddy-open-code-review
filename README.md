# WorkBuddy Open Code Review

> 确定性工程 × Agent 混合架构的代码审查系统，基于阿里巴巴 OpenCodeReview 理念在 WorkBuddy 平台原生重新实现。

## 架构

```
┌──────────────────────────────────────────┐
│           WorkBuddy 平台                  │
│  ┌────────────────────────────────────┐  │
│  │      code-review-v2 Skill          │  │
│  │  6 阶段编排 + 子Agent 并发调度      │  │
│  └──────────────┬─────────────────────┘  │
│                 │ MCP 调用                │
│  ┌──────────────▼─────────────────────┐  │
│  │    ocr-engine MCP Server           │  │
│  │  8 个确定性工程工具                  │  │
│  │  Diff → Filter → Bundle → Rules    │  │
│  │  → Token → Hunk → Merge → Format   │  │
│  └────────────────────────────────────┘  │
│                 │                         │
│          WorkBuddy 内置模型（审查引擎）     │
└──────────────────────────────────────────┘
```

## 项目结构

```
workbuddy-open-code-review/
├── ocr-engine/                  # MCP Server（确定性工程层）
│   ├── index.js                 # 主入口
│   ├── package.json             # Node.js 配置
│   ├── tools/                   # 8 个 MCP 工具
│   │   ├── git_diff_get.js      # 结构化 Git diff 获取
│   │   ├── file_selector.js     # 智能文件过滤
│   │   ├── file_bundler.js      # 智能文件捆绑
│   │   ├── rule_engine.js       # 四级优先级链规则匹配
│   │   ├── diff_hunk_get.js     # Diff hunk 上下文提取
│   │   ├── token_estimator.js   # Token 消耗估算
│   │   ├── comment_merger.js    # 评论去重合并
│   │   └── result_formatter.js  # 多格式报告生成
│   ├── lib/                     # 核心库
│   │   ├── git-runner.js        # Git 子进程封装
│   │   └── diff-parser.js       # Unified diff 解析器
│   ├── config/
│   │   └── default-rules.json   # 20 条默认审查规则
│   └── test/
│       └── smoke-test.js        # 集成测试（12/12 通过）
│
└── code-review-v2/              # Skill（Agent 编排层）
    ├── SKILL.md                 # 6 阶段工作流定义
    └── templates/
        └── sub-agent-review.md  # 子 Agent 审查模板
```

## 快速开始

### 安装 ocr-engine MCP Server

```bash
cd ocr-engine
npm install
```

### 注册到 WorkBuddy

在 `~/.workbuddy/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "ocr-engine": {
      "command": "node",
      "args": ["<path-to>/ocr-engine/index.js"],
      "disabled": false
    }
  }
}
```

### 安装 code-review-v2 Skill

将 `code-review-v2/` 目录复制到 `~/.workbuddy/skills/code-review-v2/`

### 使用

在 WorkBuddy 中输入：

```
帮我审查当前仓库的代码
审查 feature/login 相对于 main 的变更
review this PR
```

## MCP 工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `git_diff_get` | 获取结构化 Git diff | repo_path, mode, from_ref, to_ref | 结构化 Diff（文件+hunks+行号） |
| `file_selector` | 智能文件过滤 | file_list, patterns | 过滤后文件 + 排除原因 |
| `file_bundler` | 智能文件捆绑 | selected_files | 审查捆绑包（相关文件分组） |
| `rule_engine` | 审查规则匹配 | file_paths, categories | 适用规则列表（四级优先级） |
| `diff_hunk_get` | Diff 上下文提取 | file_path, line_range | hunk 内容 + 前后文 |
| `token_estimator` | Token 估算 | content, budget | 消耗估算 + 预算检查 |
| `comment_merger` | 评论去重合并 | comments[] | 去重合并后评论 |
| `result_formatter` | 报告格式化 | merged_comments, format | Markdown/JSON/Checkstyle |

## 6 阶段审查流程

| 阶段 | 工具 | 说明 |
|------|------|------|
| Phase 1: Diff | `git_diff_get` | 获取结构化差异数据 |
| Phase 2: Filter | `file_selector` → `file_bundler` | 过滤文件 + 智能捆绑 |
| Phase 3: Rules | `rule_engine` → `token_estimator` | 规则匹配 + Token 预算 |
| Phase 4: Review | Agent × N (concurrent) | 并发子 Agent 审查 |
| Phase 5: Relocate | `diff_hunk_get` + LLM | 评论行号修正 + 反思 |
| Phase 6: Report | `comment_merger` → `result_formatter` | 去重合并 + 格式化输出 |

## 默认审查规则

内置 20 条规则覆盖 4 个类别：

| 类别 | 规则示例 |
|------|---------|
| Security | SQL注入、XSS、硬编码密钥、路径遍历、不安全的反序列化 |
| Quality | 空指针风险、异常吞没、资源泄漏、竞态条件、输入校验 |
| Performance | N+1查询、低效集合、内存泄漏、冗余对象创建 |
| Maintainability | 函数长度、重复代码、魔法数字、参数过多、依赖混乱 |

## Benchmark

与 OpenCodeReview v1.5.0 在相同仓库上的对比：

| 指标 | ocr-engine | OpenCodeReview |
|------|-----------|----------------|
| 审查粒度 | 智能捆绑（相关文件分组） | 逐文件 |
| 规则系统 | 四级优先级链 | 单一 --rule flag |
| 评论去重 | bigram Jaccard 相似度 | 无 |
| 输出格式 | Markdown / JSON / Checkstyle | text / json |
| 模型依赖 | WorkBuddy 内置（零外部 API） | 需要 LLM API Key |
| Token 管理 | 捆绑包级预算检查 | 无 |

## 许可证

MIT

## 作者

（zhuang-HE）— WorkBuddy AI 平台

## 致谢

- 架构理念源自 [Alibaba OpenCodeReview](https://github.com/alibaba/open-code-review)
- 构建于 [WorkBuddy](https://www.codebuddy.cn) 平台
- MCP 协议: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
