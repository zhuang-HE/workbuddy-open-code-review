// lib/git-runner.js
// Git 子进程封装，提供统一的 git 调用接口

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * 在指定仓库目录执行 git 命令
 * @param {string} repoPath - 仓库路径
 * @param {string[]} args - git 命令参数
 * @param {Object} options - 额外选项
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function gitExec(repoPath, args, options = {}) {
  const timeout = options.timeout || 30000;
  try {
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      ...options,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    // git diff 在无差异时返回 exit code 1，这是正常情况
    if (error.code === 1 && args[0] === "diff") {
      return { stdout: error.stdout || "", stderr: error.stderr || "No differences found" };
    }
    // git merge-base 在无共同祖先时返回错误，可能正常
    if (args[0] === "merge-base") {
      return { stdout: "", stderr: error.stderr || error.message };
    }
    throw new Error(`Git command failed: git ${args.join(" ")}\n${error.stderr || error.message}`);
  }
}

/**
 * 获取两个 ref 之间的 diff
 */
export async function getDiff(repoPath, fromRef, toRef, filePatterns = []) {
  const args = ["diff", "--unified=3"];
  if (fromRef && toRef) {
    args.push(fromRef, toRef);
  } else if (toRef) {
    args.push(toRef);
  }
  args.push("--");
  if (filePatterns.length > 0) {
    args.push(...filePatterns);
  } else {
    args.push(".");
  }
  return gitExec(repoPath, args);
}

/**
 * 获取工作区变更
 */
export async function getWorkingDiff(repoPath) {
  return gitExec(repoPath, ["diff", "HEAD", "--unified=3", "--", "."]);
}

/**
 * 获取暂存区变更
 */
export async function getStagedDiff(repoPath) {
  return gitExec(repoPath, ["diff", "--cached", "--unified=3", "--", "."]);
}

/**
 * 获取单次提交的变更
 */
export async function getCommitDiff(repoPath, commitSha) {
  return gitExec(repoPath, ["diff", `${commitSha}^`, commitSha, "--unified=3", "--", "."]);
}

/**
 * 获取 diff 统计信息
 */
export async function getDiffStats(repoPath, fromRef, toRef) {
  const args = ["diff", "--stat"];
  if (fromRef && toRef) {
    args.push(fromRef, toRef);
  } else if (toRef) {
    args.push(toRef);
  }
  return gitExec(repoPath, args);
}

/**
 * 获取变更文件列表
 */
export async function getChangedFiles(repoPath, fromRef, toRef) {
  const args = ["diff", "--name-status"];
  if (fromRef && toRef) {
    args.push(fromRef, toRef);
  } else if (toRef) {
    args.push(toRef);
  }
  return gitExec(repoPath, args);
}

/**
 * 获取文件当前内容
 */
export async function getFileContent(repoPath, filePath, ref = "HEAD") {
  return gitExec(repoPath, ["show", `${ref}:${filePath}`]);
}

/**
 * 获取 merge-base
 */
export async function getMergeBase(repoPath, ref1, ref2) {
  return gitExec(repoPath, ["merge-base", ref1, ref2]);
}
