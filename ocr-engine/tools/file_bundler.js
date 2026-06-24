// tools/file_bundler.js
// 智能文件捆绑器 — 将相关文件分组为审查单元

/**
 * 提取文件的基础名（不含扩展名和 Test/Spec 后缀）
 */
function getBaseName(filePath) {
  const fileName = filePath.split("/").pop();
  const parts = fileName.split(".");
  // 处理多扩展名 (.test.ts, .spec.jsx)
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join(".").toLowerCase();
    if (["test.ts", "test.js", "test.tsx", "test.jsx", "spec.ts", "spec.js", "spec.tsx", "spec.jsx",
         "test.py", "spec.py", "test.go", "test.java", "test.kt"].includes(lastTwo)) {
      return parts.slice(0, -2).join(".");
    }
  }
  // 单扩展名
  return parts.slice(0, -1).join(".");
}

/**
 * 获取文件目录
 */
function getDir(filePath) {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

/**
 * 提取接口名（I-prefix, abstract, interface 文件夹等）
 */
function getInterfaceName(filePath) {
  const baseName = getBaseName(filePath);
  if (baseName.startsWith("I") && baseName.length > 1 && baseName[1] === baseName[1].toUpperCase()) {
    return baseName.substring(1);
  }
  return baseName.replace(/^Abstract/, "").replace(/^Base/, "").replace(/Impl$/, "");
}

export const definition = {
  name: "file_bundler",
  description: "智能文件捆绑器。将相关文件（如源文件+测试、接口+实现、多语言属性文件）分组为审查捆绑包，支持并发审查。",
  inputSchema: {
    type: "object",
    properties: {
      selected_files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            language: { type: "string" },
            is_new: { type: "boolean" },
            is_renamed: { type: "boolean" },
          },
        },
        description: "已过滤的文件列表（来自 file_selector 的 selected 输出）",
      },
      bundle_mode: {
        type: "string",
        enum: ["auto", "single", "directory"],
        description: "捆绑模式：auto=智能分组, single=每文件独立, directory=按目录分组",
        default: "auto",
      },
      max_bundle_size: {
        type: "number",
        description: "每个捆绑包最大文件数（默认 5）",
        default: 5,
      },
    },
    required: ["selected_files"],
  },
};

export async function handler(args = {}) {
  const {
    selected_files: selectedFiles = [],
    bundle_mode: bundleMode = "auto",
    max_bundle_size: maxBundleSize = 5,
  } = args;

  if (selectedFiles.length === 0) {
    return { bundle_count: 0, bundles: [], ungrouped: [] };
  }

  // single mode: 每个文件独立
  if (bundleMode === "single") {
    const bundles = selectedFiles.map((f, i) => ({
      id: `bundle_${i + 1}`,
      main_file: f.path,
      files: [f.path],
      languages: [f.language],
      total_change_lines: (f.insertions || 0) + (f.deletions || 0),
    }));
    return { bundle_count: bundles.length, bundles, ungrouped: [] };
  }

  // directory mode: 按目录分组
  if (bundleMode === "directory") {
    const dirMap = {};
    for (const f of selectedFiles) {
      const dir = getDir(f.path);
      if (!dirMap[dir]) dirMap[dir] = [];
      dirMap[dir].push(f);
    }
    // 大目录拆分
    const bundles = [];
    const ungrouped = [];
    for (const [dir, files] of Object.entries(dirMap)) {
      if (files.length <= maxBundleSize) {
        bundles.push(makeBundle(dir, files));
      } else {
        // 按语言再拆
        const langMap = {};
        for (const f of files) {
          const lang = f.language || "Unknown";
          if (!langMap[lang]) langMap[lang] = [];
          langMap[lang].push(f);
        }
        for (const [lang, langFiles] of Object.entries(langMap)) {
          if (langFiles.length <= maxBundleSize) {
            bundles.push(makeBundle(`${dir}/${lang}`, langFiles));
          } else {
            // 拆分超出大小的组
            for (let i = 0; i < langFiles.length; i += maxBundleSize) {
              const chunk = langFiles.slice(i, i + maxBundleSize);
              bundles.push(makeBundle(`${dir}/${lang}/${i + 1}`, chunk));
            }
          }
        }
      }
    }
    return { bundle_count: bundles.length, bundles, ungrouped: [] };
  }

  // auto mode: 智能分组
  const assigned = new Set();
  const bundles = [];
  const ungrouped = [];

  for (let i = 0; i < selectedFiles.length; i++) {
    if (assigned.has(i)) continue;

    const file = selectedFiles[i];
    const baseName = getBaseName(file.path);
    const dir = getDir(file.path);
    const ifaceName = getInterfaceName(file.path);

    // 查找相关文件
    const group = [file];
    assigned.add(i);

    for (let j = i + 1; j < selectedFiles.length; j++) {
      if (assigned.has(j)) continue;
      if (group.length >= maxBundleSize) break;

      const otherFile = selectedFiles[j];
      const otherBase = getBaseName(otherFile.path);
      const otherDir = getDir(otherFile.path);
      const otherIface = getInterfaceName(otherFile.path);

      let related = false;

      // 1. 同目录 + 同基础名（UserService.java & UserServiceTest.java）
      if (dir === otherDir && (baseName === otherBase || 
          baseName.startsWith(otherBase) || otherBase.startsWith(baseName))) {
        related = true;
      }

      // 2. 接口-实现关系（IUserService & UserService）
      if (dir === otherDir && (ifaceName === otherBase || getBaseName(file.path) === otherIface)) {
        related = true;
      }

      // 3. 多语言属性文件（messages_en.properties & messages_zh.properties）
      if (dir === otherDir) {
        const pattern = /^(.+?)[._](en|zh|ja|ko|fr|de|es)[._]?(.*)$/i;
        const m1 = file.path.split("/").pop().match(pattern);
        const m2 = otherFile.path.split("/").pop().match(pattern);
        if (m1 && m2 && m1[1] === m2[1]) {
          related = true;
        }
      }

      // 4. 配置文件变体（config.dev.yaml & config.prod.yaml）
      if (dir === otherDir) {
        const configPattern = /^(.+?)[._](dev|prod|test|staging|local|production|development)[._]?(.*)$/i;
        const c1 = file.path.split("/").pop().match(configPattern);
        const c2 = otherFile.path.split("/").pop().match(configPattern);
        if (c1 && c2 && c1[1] === c2[1]) {
          related = true;
        }
      }

      if (related) {
        group.push(otherFile);
        assigned.add(j);
      }
    }

    if (group.length > 1) {
      bundles.push({
        id: `bundle_${bundles.length + 1}`,
        main_file: file.path,
        files: group.map((f) => f.path),
        languages: [...new Set(group.map((f) => f.language))],
        total_change_lines: group.reduce((sum, f) => sum + (f.insertions || 0) + (f.deletions || 0), 0),
      });
    } else {
      ungrouped.push(file);
    }
  }

  // 将未分组的文件打包
  for (let i = 0; i < ungrouped.length; i += maxBundleSize) {
    const chunk = ungrouped.slice(i, i + maxBundleSize);
    bundles.push({
      id: `bundle_${bundles.length + 1}`,
      main_file: chunk[0].path,
      files: chunk.map((f) => f.path),
      languages: [...new Set(chunk.map((f) => f.language))],
      total_change_lines: chunk.reduce((sum, f) => sum + (f.insertions || 0) + (f.deletions || 0), 0),
    });
  }

  return {
    bundle_count: bundles.length,
    bundles,
    stats: {
      total_files: selectedFiles.length,
      avg_files_per_bundle: (selectedFiles.length / bundles.length).toFixed(1),
      max_files_in_bundle: Math.max(...bundles.map((b) => b.files.length)),
    },
  };
}

function makeBundle(id, files) {
  return {
    id,
    main_file: files[0].path,
    files: files.map((f) => f.path),
    languages: [...new Set(files.map((f) => f.language))],
    total_change_lines: files.reduce((sum, f) => sum + (f.insertions || 0) + (f.deletions || 0), 0),
  };
}
