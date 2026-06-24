---
name: code-review-v2
version: 2.0.0
description: '确定性工程+Agent混合代码审查 Skill。基于OCR架构理念重建，6阶段编排+8个MCP工具+并发子Agent。使用WorkBuddy内置模型，零外部API依赖。'
triggers:
- 代码审查
- code review
- 审查代码
- 代码审计
- 审查PR
- 审查diff
- code audit
- review code
- review PR
- review diff
- 帮我审查
- 审查一下
- cr
metadata:
  source: user
  emoji: 🔍
  harness_version: "2.0"
  mcp_server: ocr-engine
allowed-tools: Bash, Edit, Skill, Read, Write, Agent, mcp__harness, mcp__ocr_engine
---

# Code Review v2.0 — 确定性工程 × Agent 混合架构

> 基于阿里巴巴 OpenCodeReview 架构理念在原 WorkBuddy 平台重新实现。
> 核心原则：**确定性工作进 MCP，动态决策进 Skill**。

## 架构

```
初始化阶段          审查阶段（并发）         后处理阶段
┌──────────┐      ┌──────────────┐      ┌──────────────┐
│ MCP Tools │      │  WorkBuddy   │      │  MCP Tools   │
│ git_diff  │ ──▶  │  Agent×N     │ ──▶  │ comment_merge│
│ file_sel  │      │  (per-bundle)│      │ result_format│
│ file_bund │      └──────────────┘      └──────────────┘
│ rule_eng  │           ▲
│ token_est │           │
└──────────┘      WorkBuddy 内置模型
```

## 6 阶段工作流

### Phase 1: 获取 Diff
1. 确认仓库路径（用户提供或当前目录）
2. 确认审查范围（branch/commit/working）
3. 调用 `mcp__ocr_engine__git_diff_get` 获取结构化 diff
4. 记录 `stats`（文件数、增删行数）

### Phase 2: 过滤与分组
1. 调用 `mcp__ocr_engine__file_selector` 过滤文件
   - 排除测试文件（默认）
   - 排除构建产物
   - 排除二进制
2. 调用 `mcp__ocr_engine__file_bundler` 智能分组
   - 同源文件+测试捆绑
   - 接口+实现捆绑
   - 多语言属性文件捆绑
3. 输出捆绑包列表，每个包有：{id, files[], languages[], total_change_lines}

### Phase 3: 规则匹配与预算
1. 对每个捆绑包调用 `mcp__ocr_engine__rule_engine`
   - 传入 file_paths
   - 获取 applicable_rules（按四级优先级）
2. 调用 `mcp__ocr_engine__token_estimator` 估算 token
   - 传入每个捆绑包的 diff 内容
   - 如果超出预算（建议：简单 bundle 10000 tokens，规则匹配≥5条的复杂 bundle 15000-20000 tokens），拆分捆绑包

### Phase 4: 并发审查（核心）
**对每个捆绑包启动一个子 Agent**，所有子 Agent 并行运行：

#### 子 Agent 审查模板

```
## 代码审查子任务 — Bundle: {bundle_id}

### 审查文件
{files_with_diffs}

### 适用规则（逐条检查）
{matched_rules_summary}

### 审查要求
你是一个专业代码审查员。严格按以下规则审查，只报告**真实存在的**问题。

输出格式（每条发现一个 JSON 对象，最终输出 JSON 数组）：
```json
[
  {
    "path": "文件路径",
    "start_line": 起始行号,
    "end_line": 结束行号,
    "severity": "blocker|high|medium|low",
    "category": "security|quality|performance|maintainability",
    "title": "简短问题标题",
    "description": "详细问题说明",
    "existing_code": "当前有问题的代码",
    "suggestion_code": "建议修复后的代码",
    "confidence": 0.0-1.0
  }
]
```

### 严重度定义
- **blocker**: 安全漏洞、数据丢失、崩溃风险
- **high**: 功能缺陷、严重性能问题、资源泄漏
- **medium**: 代码质量、可维护性问题、潜在风险
- **low**: 风格建议、小优化、命名改进

### 禁止行为
1. 不要报告测试文件的格式问题
2. 不要对 import 排序提建议（除非循环依赖）
3. 不要报告"可以添加注释"类建议（除非代码逻辑确实难以理解）
4. 不要报告"函数可以拆分"除非函数超过 200 行
5. 如果没有发现任何问题，返回空数组 []
6. 不要编造不存在的问题
7. 每条建议必须有 existing_code 和 suggestion_code
```

#### 并发执行
- 使用 Agent 工具，每个捆绑包一个子 Agent
- 所有子 Agent 同时启动（parallel）
- 等待所有子 Agent 完成
- 收集所有 JSON 输出

### Phase 5: 评论重定位与反思
1. 对每条评论（跨所有子 Agent），调用 `mcp__ocr_engine__diff_hunk_get` 验证行号
   - 如果行号不匹配，修正行号
2. 对每条评论进行反思检查：
   - 是否真实存在于 diff 中？（真实性问题）
   - 是否与适用规则相关？（相关性问题）
   - 严重度是否合理？（分级问题）
3. 过滤掉不通过反思的评论

### Phase 6: 合并、格式化、报告
1. 调用 `mcp__ocr_engine__comment_merger` 去重合并
2. 调用 `mcp__ocr_engine__result_formatter` 格式化报告
   - 默认 markdown 格式
   - 支持 json / checkstyle
3. 展示最终审查报告

## 使用方式

### 基础审查
```
"帮我审查这个项目的代码"
"审查当前分支相对于 main 的变更"
"审查 commit abc123"
"review this PR"
```

### 指定范围
```
"审查 src/ 目录下的所有 Python 文件"
"只审查安全相关的问题"
"对 auth 模块做安全审计"
```

### 指定输出
```
"审查并输出 JSON 格式"
"生成 Checkstyle 格式的审查报告"
"审查后自动修复 high-confidence 问题"
```

## 配置

### 项目规则（推荐）
在仓库根目录创建 `.opencodereview/rule.json`：
```json
{
  "rules": [
    {
      "id": "custom-no-raw-sql",
      "name": "禁止原生SQL",
      "category": "security",
      "severity": "blocker",
      "path": "src/**/*.java",
      "description": "必须使用ORM，禁止手写SQL"
    }
  ]
}
```

### 全局规则
创建 `~/.opencodereview/rule.json`（作用于所有项目）。

## 性能优化

1. **增量审查**: 只审查变更文件（默认行为，通过 git diff 获取）
2. **并发审查**: 捆绑包并行审查，N 个捆绑包 = N 个子 Agent 并发
3. **Token 预算**: 超过 10000 tokens 的捆绑包自动拆分
4. **文件过滤**: 自动排除测试、构建产物、vendor 等
5. **缓存**: 未变更文件的审查结果可复用

## 与 v1.0 对比

| 维度 | v1.0 | v2.0 |
|------|------|------|
| 架构 | 纯 LLM Prompt | 确定性工程 + Agent 混合 |
| 文件过滤 | 无 | 四层过滤（二进制/测试/构建/用户自定义） |
| 规则系统 | 无（都在 prompt 里） | 四级优先级链 + 模板匹配 |
| 并发 | 串行 | 捆绑包级并发（N 子 Agent） |
| 行号精度 | 依赖 LLM | 独立重定位模块 |
| 去重 | 无 | 相似度检测合并 |
| 规则可配置 | 无 | JSON/YAML 规则文件 |
| 输出格式 | Markdown | Markdown / JSON / Checkstyle |
| Token 管理 | 无 | 预算估算 + 超预算拆分 |

## Notes

- 大型 PR（>50 文件）建议设置 `max_bundle_size: 3`
- 并发子 Agent 数量 = 捆绑包数量，注意 WorkBuddy 的并发限制
- 审查质量依赖于 WorkBuddy 内置模型能力
- 项目特定规则优先于全局规则

---

## 💬 使用示例

```
# 全量审查
"帮我审查这份代码"
"对当前仓库做 code review"

# 分支对比
"审查 feature/login 分支相对于 main 的变更"
"review this PR against main"

# 单次提交
"审查 commit abc1234"

# 专项审查
"只检查安全漏洞"
"检查 SQL 注入和 XSS 风险"
"审查性能问题"

# 指定输出
"审查并输出 JSON，我要给 CI 用"
"生成 markdown 审查报告"
```
