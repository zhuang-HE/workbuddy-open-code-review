// tools/comment_merger.js
// 评论合并器 — 去重、合并、排序多个子Agent的审查评论

/**
 * 计算两条评论的相似度（0-1）
 */
function commentSimilarity(a, b) {
  let score = 0;
  let total = 0;

  // 同文件同行号（高权重）
  if (a.path === b.path) {
    total += 3;
    if (a.start_line === b.start_line && a.end_line === b.end_line) {
      score += 3;
    } else if (
      Math.abs((a.start_line || 0) - (b.start_line || 0)) <= 3
    ) {
      score += 1.5;
    }
  }

  // 同类别
  if (a.category === b.category) {
    total += 1;
    score += 1;
  }

  // 标题相似度（bigram Jaccard，兼容中英文）
  if (a.title && b.title) {
    total += 2;
    score += (2 * bigramJaccard(a.title.toLowerCase(), b.title.toLowerCase()));
  }

  // 内容相似度（bigram Jaccard，兼容中英文）
  if (a.description && b.description) {
    total += 1;
    score += bigramJaccard(a.description.toLowerCase(), b.description.toLowerCase());
  }

  return total > 0 ? score / total : 0;
}

const SEVERITY_ORDER = { blocker: 0, high: 1, medium: 2, low: 3 };

/**
 * Bigram Jaccard 相似度（兼容中英文）
 * 对中文使用字符级 bigram，对英文使用词级（空格分割后转 bigram）
 */
function bigramJaccard(a, b) {
  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  const intersection = new Set([...bigramsA].filter((bg) => bigramsB.has(bg)));
  const union = new Set([...bigramsA, ...bigramsB]);
  return intersection.size / (union.size || 1);
}

function getBigrams(text) {
  const bigrams = new Set();
  // 检测是否主要是中文
  const chineseRatio = (text.match(/[\u4e00-\u9fff]/g) || []).length / (text.length || 1);
  if (chineseRatio > 0.3) {
    // 中文：字符级 bigram
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2));
    }
  } else {
    // 英文：空格分割后 bigram
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word.length < 2) {
        bigrams.add(word);
      } else {
        for (let i = 0; i < word.length - 1; i++) {
          bigrams.add(word.substring(i, i + 2));
        }
      }
    }
  }
  return bigrams;
}

export const definition = {
  name: "comment_merger",
  description: "评论合并器。对多个子Agent产生的并行审查评论进行去重、合并和严重度排序。",
  inputSchema: {
    type: "object",
    properties: {
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "number" },
            end_line: { type: "number" },
            severity: { type: "string" },
            category: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            suggestion_code: { type: "string" },
            existing_code: { type: "string" },
            confidence: { type: "number" },
            source_agent: { type: "string" },
          },
        },
        description: "审查评论数组",
      },
      similarity_threshold: {
        type: "number",
        description: "相似度阈值（0-1），超过视为重复，默认 0.6",
        default: 0.6,
      },
      min_confidence: {
        type: "number",
        description: "最低置信度，低于此值过滤掉（0-1），默认 0",
        default: 0,
      },
      sort_by: {
        type: "string",
        enum: ["severity", "file", "category"],
        description: "排序方式，默认 severity",
        default: "severity",
      },
    },
    required: ["comments"],
  },
};

export async function handler(args = {}) {
  const {
    comments = [],
    similarity_threshold: similarityThreshold = 0.6,
    min_confidence: minConfidence = 0,
    sort_by: sortBy = "severity",
  } = args;

  if (comments.length === 0) {
    return {
      merged_count: 0,
      duplicate_count: 0,
      filtered_count: 0,
      merged: [],
      duplicates: [],
      filtered: [],
      stats: { by_severity: {}, by_category: {}, by_file: {} },
    };
  }

  // 1. 按置信度过滤
  const goodComments = [];
  const filtered = [];
  for (const c of comments) {
    if (c.confidence !== undefined && c.confidence < minConfidence) {
      filtered.push(c);
    } else {
      goodComments.push(c);
    }
  }

  // 2. 去重合并
  const merged = [];
  const duplicates = [];
  const processed = new Set();

  for (let i = 0; i < goodComments.length; i++) {
    if (processed.has(i)) continue;

    let best = { ...goodComments[i] };
    const duplicateList = [];

    for (let j = i + 1; j < goodComments.length; j++) {
      if (processed.has(j)) continue;
      const sim = commentSimilarity(goodComments[i], goodComments[j]);
      if (sim >= similarityThreshold) {
        duplicateList.push({ comment: goodComments[j], similarity: sim });
        processed.add(j);

        // 保留置信度更高、描述更详细的版本
        if (
          (goodComments[j].confidence || 0) > (best.confidence || 0) ||
          (goodComments[j].description?.length || 0) > (best.description?.length || 0)
        ) {
          best = { ...goodComments[j] };
        }
      }
    }

    if (duplicateList.length > 0) {
      best._deduplicated = true;
      best._duplicate_count = duplicateList.length;
      best._duplicates = duplicateList.map((d) => ({
        title: d.comment.title,
        similarity: Math.round(d.similarity * 100) / 100,
      }));
    }

    merged.push(best);
    processed.add(i);
  }

  // 3. 排序
  if (sortBy === "severity") {
    merged.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99;
      const sb = SEVERITY_ORDER[b.severity] ?? 99;
      if (sa !== sb) return sa - sb;
      // 同严重度按文件路径
      return (a.path || "").localeCompare(b.path || "");
    });
  } else if (sortBy === "file") {
    merged.sort((a, b) => {
      const pc = (a.path || "").localeCompare(b.path || "");
      if (pc !== 0) return pc;
      return (a.start_line || 0) - (b.start_line || 0);
    });
  } else if (sortBy === "category") {
    merged.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
  }

  // 4. 统计
  const bySeverity = {};
  const byCategory = {};
  const byFile = {};
  for (const c of merged) {
    bySeverity[c.severity] = (bySeverity[c.severity] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    byFile[c.path] = (byFile[c.path] || 0) + 1;
  }

  return {
    original_count: comments.length,
    filtered_count: filtered.length,
    duplicate_count: comments.length - merged.length - filtered.length,
    merged_count: merged.length,
    merged,
    filtered,
    stats: { by_severity: bySeverity, by_category: byCategory, by_file: byFile },
  };
}
