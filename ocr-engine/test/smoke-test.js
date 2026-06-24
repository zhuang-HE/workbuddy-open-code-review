// test/smoke-test.js
// Quick smoke test for ocr-engine MCP server
// Tests: token_estimator, comment_merger, result_formatter (no git needed)

import { tools } from "../tools/index.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

async function main() {
  console.log("\n🔍 OCR Engine Smoke Tests\n");

  // Test 1: token_estimator - single content
  await test("token_estimator (single)", async () => {
    const t = tools.find(t => t.definition.name === "token_estimator");
    const result = await t.handler({
      content: "def hello_world():\n    print('Hello, World!')\n    return True",
      budget: 100,
    });
    if (!result.estimated_tokens) throw new Error("Missing estimated_tokens");
    if (typeof result.estimated_tokens !== "number") throw new Error("tokens not a number");
    if (!result.budget || !result.budget.within_budget) throw new Error("Budget check failed");
    console.log(`     Tokens: ${result.estimated_tokens} (chars: ${result.character_count}, budget: ${result.budget.used}/${result.budget.total})`);
  });

  // Test 2: token_estimator - Chinese content
  await test("token_estimator (Chinese)", async () => {
    const t = tools.find(t => t.definition.name === "token_estimator");
    const result = await t.handler({
      content: "这是一个中文测试文本，用于检查中文token估算的准确性。包含一些常用词汇和技术术语。",
      budget: 100,
    });
    if (result.text_type !== "chinese_dominant") throw new Error(`Expected chinese_dominant, got ${result.text_type}`);
    console.log(`     Tokens: ${result.estimated_tokens} (chars: ${result.character_count}, ratio: ${result.chinese_ratio})`);
  });

  // Test 3: token_estimator - batch mode
  await test("token_estimator (batch)", async () => {
    const t = tools.find(t => t.definition.name === "token_estimator");
    const result = await t.handler({
      items: [
        { label: "diff1", content: "def a(): pass\ndef b(): pass", model: "gpt-4" },
        { label: "diff2", content: "class Foo:\n    pass", model: "gpt-4" },
        { label: "readme", content: "中文本文本文本测试内容", model: "gpt-4" },
      ],
      budget: 50,
    });
    if (!result.total_tokens) throw new Error("Missing total_tokens");
    if (Object.keys(result.breakdown).length !== 3) throw new Error("Wrong breakdown count");
    console.log(`     Total: ${result.total_tokens}, Items: ${result.item_count}, Within budget: ${result.budget.within_budget}`);
  });

  // Test 4: token_estimator - over budget
  await test("token_estimator (over budget)", async () => {
    const t = tools.find(t => t.definition.name === "token_estimator");
    const result = await t.handler({
      content: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      budget: 10,
    });
    if (result.budget.within_budget) throw new Error("Should be over budget");
    if (!result.budget.recommendation) throw new Error("Missing recommendation");
  });

  // Test 5: comment_merger - deduplication
  await test("comment_merger (dedup)", async () => {
    const t = tools.find(t => t.definition.name === "comment_merger");
    const result = await t.handler({
      comments: [
        { path: "src/auth.py", start_line: 42, end_line: 45, severity: "blocker", category: "security", title: "SQL注入", description: "发现SQL注入漏洞", confidence: 0.9 },
        { path: "src/auth.py", start_line: 42, end_line: 45, severity: "blocker", category: "security", title: "SQL注入风险", description: "SQL注入问题", confidence: 0.8 },
        { path: "src/main.py", start_line: 10, end_line: 12, severity: "medium", category: "quality", title: "重复代码", description: "发现重复代码", confidence: 0.7 },
      ],
    });
    if (result.merged_count >= 3) throw new Error(`Expected < 3, got ${result.merged_count}`);
    if (result.duplicate_count === 0) throw new Error("Should have found duplicates");
    console.log(`     Original: ${result.original_count}, Merged: ${result.merged_count}, Dupes: ${result.duplicate_count}`);
  });

  // Test 6: comment_merger - empty
  await test("comment_merger (empty)", async () => {
    const t = tools.find(t => t.definition.name === "comment_merger");
    const result = await t.handler({ comments: [] });
    if (result.merged_count !== 0) throw new Error("Should be 0");
  });

  // Test 7: result_formatter - markdown
  await test("result_formatter (markdown)", async () => {
    const t = tools.find(t => t.definition.name === "result_formatter");
    const result = await t.handler({
      merged_comments: [
        { path: "src/auth.py", start_line: 42, end_line: 45, severity: "blocker", category: "security", title: "SQL注入", description: "发现SQL注入", existing_code: "q = 'SELECT * FROM t'", suggestion_code: "cursor.execute(query, params)" },
      ],
      repo_name: "TestRepo",
      from_ref: "main",
      to_ref: "feature",
    });
    if (!result.report) throw new Error("Missing report");
    if (!result.report.includes("SQL注入")) throw new Error("Report missing content");
  });

  // Test 8: result_formatter - JSON
  await test("result_formatter (JSON)", async () => {
    const t = tools.find(t => t.definition.name === "result_formatter");
    const result = await t.handler({
      merged_comments: [
        { path: "src/a.py", start_line: 1, end_line: 3, severity: "medium", category: "quality", title: "Test" },
      ],
      format: "json",
      repo_name: "Test",
    });
    if (result.format !== "json") throw new Error("Wrong format");
    if (!result.data) throw new Error("Missing data");
  });

  // Test 9: result_formatter - Checkstyle
  await test("result_formatter (Checkstyle)", async () => {
    const t = tools.find(t => t.definition.name === "result_formatter");
    const result = await t.handler({
      merged_comments: [
        { path: "src/a.java", start_line: 10, end_line: 10, severity: "blocker", category: "security", title: "Vuln" },
      ],
      format: "checkstyle",
    });
    if (!result.report.includes("checkstyle")) throw new Error("Missing checkstyle tag");
    if (!result.report.includes('<error ')) throw new Error("Missing error element");
  });

  // Test 10: file_selector with synthetic data
  await test("file_selector (basic)", async () => {
    const t = tools.find(t => t.definition.name === "file_selector");
    const result = await t.handler({
      file_list: [
        { path: "src/main.py", insertions: 20, deletions: 5 },
        { path: "src/test_main.py", insertions: 10, deletions: 2 },
        { path: "src/auth.py", insertions: 50, deletions: 30, is_new: true },
        { path: "dist/bundle.js", insertions: 100, deletions: 0 },
      ],
    });
    if (result.selected_count < 2) throw new Error("Should select at least 2 files");
    const testFileSelected = result.selected.find(f => f.path === "src/test_main.py");
    if (testFileSelected) throw new Error("Test file should be rejected by default");
    const distSelected = result.selected.find(f => f.path === "dist/bundle.js");
    if (distSelected) throw new Error("Dist file should be rejected");
    console.log(`     Selected: ${result.selected_count}, Rejected: ${result.rejected_count}`);
  });

  // Test 11: file_bundler with synthetic data
  await test("file_bundler (auto)", async () => {
    const t = tools.find(t => t.definition.name === "file_bundler");
    const result = await t.handler({
      selected_files: [
        { path: "src/UserService.java", language: "Java", insertions: 30, deletions: 10 },
        { path: "src/UserServiceTest.java", language: "Java", insertions: 5, deletions: 2 },
        { path: "src/IUserService.java", language: "Java", insertions: 0, deletions: 0 },
        { path: "src/auth.py", language: "Python", insertions: 40, deletions: 20 },
      ],
    });
    if (result.bundle_count === 0) throw new Error("Should have bundles");
    // UserService + UserServiceTest + IUserService should be in same bundle
    const bigBundle = result.bundles.find(b => b.files.length >= 3);
    if (!bigBundle) throw new Error("Related files should be bundled together");
    console.log(`     Bundles: ${result.bundle_count}, Max files in bundle: ${result.stats.max_files_in_bundle}`);
  });

  // Test 12: rule_engine with synthetic data
  await test("rule_engine (default rules)", async () => {
    const t = tools.find(t => t.definition.name === "rule_engine");
    const result = await t.handler({
      file_paths: ["src/main.py", "src/auth.py"],
      categories: ["security"],
    });
    if (!result.total_rules_matched) throw new Error("No rules matched for Python files");
    console.log(`     Rules matched: ${result.total_rules_matched}, Files: ${result.files_matched}/${result.total_files}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error("Test suite error:", e);
  process.exit(1);
});
