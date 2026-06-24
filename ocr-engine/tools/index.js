// tools/index.js
// OCR Engine MCP Server — 所有工具统一导出

import { definition as gitDiffGetDef, handler as gitDiffGetHandler } from "./git_diff_get.js";
import { definition as fileSelectorDef, handler as fileSelectorHandler } from "./file_selector.js";
import { definition as fileBundlerDef, handler as fileBundlerHandler } from "./file_bundler.js";
import { definition as ruleEngineDef, handler as ruleEngineHandler } from "./rule_engine.js";
import { definition as diffHunkGetDef, handler as diffHunkGetHandler } from "./diff_hunk_get.js";
import { definition as commentMergerDef, handler as commentMergerHandler } from "./comment_merger.js";
import { definition as resultFormatterDef, handler as resultFormatterHandler } from "./result_formatter.js";
import { definition as tokenEstimatorDef, handler as tokenEstimatorHandler } from "./token_estimator.js";

export const tools = [
  // Phase 1: Diff & Filter
  { definition: gitDiffGetDef, handler: gitDiffGetHandler },
  { definition: fileSelectorDef, handler: fileSelectorHandler },
  { definition: fileBundlerDef, handler: fileBundlerHandler },

  // Phase 2: Rules & Context
  { definition: ruleEngineDef, handler: ruleEngineHandler },
  { definition: diffHunkGetDef, handler: diffHunkGetHandler },
  { definition: tokenEstimatorDef, handler: tokenEstimatorHandler },

  // Phase 3: Post-processing
  { definition: commentMergerDef, handler: commentMergerHandler },
  { definition: resultFormatterDef, handler: resultFormatterHandler },
];
