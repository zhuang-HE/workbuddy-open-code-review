// tools/token_estimator.js
// Token 估算器 — 计算文本的预估 token 数量

// token 估算系数（基于经验数据）
const TOKEN_RATIOS = {
  // 英文/代码：约 4 字符 ≈ 1 token
  english: 4.0,
  // 中文：约 1.5 字符 ≈  1 token（Claude tokenizer 中中文约 2-3 字符/token）
  chinese: 1.5,
  // 混合文本：约 2.5 字符 ≈ 1 token
  mixed: 2.5,
};

/**
 * 检测文本中中文比例
 */
function detectChineseRatio(text) {
  if (!text || text.length === 0) return 0;
  let chineseChars = 0;
  let totalChars = 0;
  for (const char of text) {
    totalChars++;
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      chineseChars++;
    }
  }
  return totalChars > 0 ? chineseChars / totalChars : 0;
}

/**
 * 估算 token 数
 */
function estimateTokens(text, model) {
  if (!text) return 0;
  const chineseRatio = detectChineseRatio(text);
  let ratio;
  if (chineseRatio > 0.5) {
    ratio = TOKEN_RATIOS.chinese;
  } else if (chineseRatio > 0.2) {
    ratio = TOKEN_RATIOS.mixed;
  } else {
    ratio = TOKEN_RATIOS.english;
  }
  return Math.ceil(text.length / ratio);
}

/**
 * 估算整批内容的 tokens（传入 items 数组）
 */
function estimateBatchTokens(items) {
  let total = 0;
  const breakdown = {};
  for (const item of items) {
    const tokens = estimateTokens(item.content, item.model);
    total += tokens;
    breakdown[item.label || "unknown"] = tokens;
  }
  return { total, breakdown };
}

export const definition = {
  name: "token_estimator",
  description: "Token 估算器。估算文本或批量内容的 token 消耗，用于子Agent预算管理和文件拆分决策。",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "要估算的文本内容（与 items 二选一）",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "内容标签" },
            content: { type: "string", description: "文本内容" },
            model: { type: "string", description: "模型名称（可选）" },
          },
        },
        description: "批量估算内容（与 content 二选一）",
      },
      model: {
        type: "string",
        description: "模型名称（仅供参考，不影响估算）",
      },
      budget: {
        type: "number",
        description: "Token 预算上限，提供后返回是否超预算及建议",
      },
    },
    required: [],
  },
};

export async function handler(args = {}) {
  const { content, items, model = "default", budget } = args;

  let result;

  if (items && items.length > 0) {
    // 批量估算
    const batchResult = estimateBatchTokens(items);
    result = {
      mode: "batch",
      total_tokens: batchResult.total,
      item_count: items.length,
      breakdown: batchResult.breakdown,
      avg_per_item: Math.round(batchResult.total / items.length),
    };
  } else if (content) {
    // 单文本估算
    const tokens = estimateTokens(content, model);
    const chineseRatio = detectChineseRatio(content);
    result = {
      mode: "single",
      estimated_tokens: tokens,
      character_count: content.length,
      chinese_ratio: Math.round(chineseRatio * 100) / 100,
      text_type: chineseRatio > 0.5 ? "chinese_dominant" : chineseRatio > 0.2 ? "mixed" : "english_dominant",
    };
  } else {
    return { error: "请提供 content 或 items 参数" };
  }

  // 预算检查
  if (budget) {
    const totalTokens = result.mode === "batch" ? result.total_tokens : result.estimated_tokens;
    const remaining = budget - totalTokens;
    result.budget = {
      total: budget,
      used: totalTokens,
      remaining,
      within_budget: remaining >= 0,
    };

    if (remaining < 0) {
      result.budget.recommendation = `超出预算 ${Math.abs(remaining)} tokens。建议：1) 拆分为更小的捆绑包 2) 减少上下文行数 3) 排除低变更文件`;
      result.budget.suggested_splits = Math.ceil(totalTokens / budget);
    } else if (remaining < budget * 0.2) {
      result.budget.recommendation = `接近预算上限，剩余 ${remaining} tokens（${Math.round((remaining / budget) * 100)}%）`;
    }
  }

  // 添加关系参考
  result._note = "估算基于启发式算法（英文 ~4 chars/token, 中文 ~1.5 chars/token），实际值可能因 tokenizer 实现而异";

  return result;
}
