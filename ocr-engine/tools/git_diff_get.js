// tools/git_diff_get.js
// 获取并解析 Git Diff

import { getDiff, getWorkingDiff, getStagedDiff, getCommitDiff, getDiffStats, getMergeBase } from "../lib/git-runner.js";
import { parseDiffText } from "../lib/diff-parser.js";

export const definition = {
  name: "git_diff_get",
  description: "获取 Git 仓库的结构化 diff 数据。支持分支对比、工作区、暂存区、单次提交四种模式。",
  inputSchema: {
    type: "object",
    properties: {
      repo_path: {
        type: "string",
        description: "Git 仓库路径（绝对路径）",
      },
      mode: {
        type: "string",
        enum: ["branch", "working", "staged", "commit"],
        description: "Diff 模式：branch=分支对比, working=工作区变更, staged=暂存区, commit=单次提交",
        default: "branch",
      },
      from_ref: {
        type: "string",
        description: "源引用（如 main、origin/main、HEAD~3），branch 模式使用",
      },
      to_ref: {
        type: "string",
        description: "目标引用（如 feature-branch、HEAD），branch 模式使用",
      },
      commit_sha: {
        type: "string",
        description: "提交 SHA，commit 模式使用",
      },
      file_patterns: {
        type: "array",
        items: { type: "string" },
        description: "文件过滤模式列表（如 ['src/**/*.js']）",
      },
    },
    required: ["repo_path"],
  },
};

export async function handler(args = {}) {
  const { repo_path: repoPath, mode = "branch", from_ref, to_ref, commit_sha, file_patterns = [] } = args;

  try {
    let diffResult;
    let statsResult;

    switch (mode) {
      case "working":
        diffResult = await getWorkingDiff(repoPath);
        break;
      case "staged":
        diffResult = await getStagedDiff(repoPath);
        break;
      case "commit":
        if (!commit_sha) throw new Error("commit mode requires commit_sha parameter");
        diffResult = await getCommitDiff(repoPath, commit_sha);
        break;
      case "branch":
      default:
        if (from_ref && to_ref) {
          diffResult = await getDiff(repoPath, from_ref, to_ref, file_patterns);
          statsResult = await getDiffStats(repoPath, from_ref, to_ref);
        } else if (to_ref) {
          diffResult = await getDiff(repoPath, null, to_ref, file_patterns);
          statsResult = await getDiffStats(repoPath, null, to_ref);
        } else {
          diffResult = await getWorkingDiff(repoPath);
        }
        break;
    }

    const parsed = parseDiffText(diffResult.stdout);

    // 尝试获取 merge-base（仅 branch 模式）
    let mergeBase = null;
    if (mode === "branch" && from_ref && to_ref) {
      try {
        const mbResult = await getMergeBase(repoPath, from_ref, to_ref);
        if (mbResult.stdout.trim()) {
          mergeBase = mbResult.stdout.trim();
        }
      } catch {
        // merge-base 获取失败不影响主流程
      }
    }

    return {
      mode,
      repo_path: repoPath,
      from_ref: from_ref || null,
      to_ref: to_ref || null,
      merge_base: mergeBase,
      stats: parsed.stats,
      files: parsed.files.map((f) => ({
        old_path: f.oldPath,
        new_path: f.newPath,
        is_binary: f.isBinary,
        is_deleted: f.isDeleted,
        is_new: f.isNew,
        is_renamed: f.isRenamed,
        insertions: f.insertions,
        deletions: f.deletions,
        hunks_count: f.hunks.length,
        hunks: f.hunks.map((h) => ({
          old_start: h.oldStart,
          old_lines: h.oldLines,
          new_start: h.newStart,
          new_lines: h.newLines,
          context: h.context,
          lines_count: h.lines.length,
          raw_text: h.rawText,
        })),
      })),
    };
  } catch (error) {
    return {
      error: true,
      message: error.message,
      repo_path: repoPath,
    };
  }
}
