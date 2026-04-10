#!/usr/bin/env node
/**
 * jojo-fingerprint — standalone repository fingerprint tool
 *
 * Scans a repository and outputs structured metadata about its tech stack.
 * Ported from the kaicho project's repo-context module.
 *
 * Usage:
 *   node fingerprint.mjs [path]           # Colorized display (TTY)
 *   node fingerprint.mjs [path] --json    # Raw JSON output
 *   node fingerprint.mjs [path] --plain   # Force plain text (no colors)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NO_COLOR = "NO_COLOR" in process.env;

const LANG_COLORS = {
  "TypeScript": "\x1b[34m", "JavaScript": "\x1b[33m", "Python": "\x1b[34m",
  "Rust": "\x1b[31m", "Go": "\x1b[36m", "Java": "\x1b[31m", "Kotlin": "\x1b[35m",
  "C#": "\x1b[32m", "F#": "\x1b[34m", "C++": "\x1b[31m", "C": "\x1b[90m",
  "C/C++": "\x1b[31m", "Swift": "\x1b[33m", "Ruby": "\x1b[31m", "PHP": "\x1b[35m",
  "Dart": "\x1b[36m", "Lua": "\x1b[34m", "Zig": "\x1b[33m",
  "Elixir": "\x1b[35m", "Scala": "\x1b[31m",
};

const SKIP_DIRS_SET = new Set([
  "node_modules", ".git", "vendor", "third_party", "thirdparty",
  "dist", "build", "out", ".pio", "__pycache__", ".next",
  "target", "Pods", ".gradle", "bin", "obj",
  "doc", "docs", "assets", "scripts", "tools",
]);

const SKIP_DIRS_DISTRIBUTION = new Set([
  "node_modules", ".git", "vendor", "third_party", "thirdparty",
  "dist", "build", "out", ".pio", "__pycache__", ".next",
  "target", "Pods", ".gradle", "bin", "obj",
]);

const EXT_TO_LANGUAGE = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".pyw": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin", ".kts": "Kotlin",
  ".cs": "C#",
  ".fs": "F#", ".fsx": "F#",
  ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".hpp": "C++", ".hxx": "C++", ".h": "C++",
  ".c": "C",
  ".m": "Objective-C", ".mm": "Objective-C++",
  ".swift": "Swift",
  ".rb": "Ruby", ".erb": "Ruby",
  ".php": "PHP",
  ".dart": "Dart",
  ".lua": "Lua",
  ".zig": "Zig",
  ".ex": "Elixir", ".exs": "Elixir",
  ".scala": "Scala",
  ".clj": "Clojure", ".cljs": "Clojure",
  ".ino": "Arduino",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

const MAX_FILES_SCANNED = 250_000;
const MAX_WORKSPACE_PACKAGES = 20;
const MAX_SUBDIRS = 10;

const LOCKFILE_TO_PM = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

const ARCH_DOCS = ["CLAUDE.md", "AGENTS.md", "ARCHITECTURE.md", "README.md"];

const MONOREPO_FILES = {
  "pnpm-workspace.yaml": "pnpm workspaces",
  "lerna.json": "lerna",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function readSafe(filePath) {
  try { return await fs.readFile(filePath, "utf-8"); }
  catch { return null; }
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; }
  catch { return false; }
}

function dedup(signals) {
  const seen = new Set();
  return signals.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

async function findDotNetProject(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.find((e) =>
      e.endsWith(".sln") || e.endsWith(".slnx") || e.endsWith(".csproj") || e.endsWith(".fsproj"),
    ) ?? null;
  } catch { return null; }
}

async function findXcodeproj(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.find((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace")) ?? null;
  } catch { return null; }
}

function emptyContext() {
  return {
    languages: [], frameworks: [], testRunners: [], linters: [],
    entryPoints: [], packageManager: null, monorepoTool: null,
    architectureDocs: [], workspacePackages: [], languageDistribution: [], components: [],
  };
}

function emptyComponent(componentPath) {
  return {
    path: componentPath, languages: [], frameworks: [], testRunners: [], linters: [],
    entryPoints: [], packageManager: null, languageDistribution: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ecosystem detectors
// ─────────────────────────────────────────────────────────────────────────────

function detectFromPackageJson(raw, ctx, source = "package.json") {
  let pkg;
  try { pkg = JSON.parse(raw); } catch { return; }

  const src = source;
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  ctx.languages.push({ name: "JavaScript", source: src });

  const frameworkMap = {
    next: "Next.js", react: "React", vue: "Vue", nuxt: "Nuxt",
    svelte: "Svelte", "@sveltejs/kit": "SvelteKit",
    express: "Express", fastify: "Fastify", hono: "Hono", koa: "Koa",
    "@nestjs/core": "NestJS", "@angular/core": "Angular",
    gatsby: "Gatsby", remix: "Remix", "@remix-run/node": "Remix",
  };
  const seenFrameworks = new Set();
  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (dep in allDeps && !seenFrameworks.has(name)) {
      seenFrameworks.add(name);
      ctx.frameworks.push({ name, source: src });
    }
  }

  const testRunnerMap = {
    vitest: "vitest", jest: "jest", mocha: "mocha", ava: "ava",
    "@playwright/test": "playwright", cypress: "cypress",
  };
  for (const [dep, name] of Object.entries(testRunnerMap)) {
    if (dep in allDeps) ctx.testRunners.push({ name, source: src });
  }

  const linterMap = {
    eslint: "eslint", "@biomejs/biome": "biome",
    prettier: "prettier", oxlint: "oxlint",
  };
  for (const [dep, name] of Object.entries(linterMap)) {
    if (dep in allDeps) ctx.linters.push({ name, source: src });
  }

  if (typeof pkg.main === "string") ctx.entryPoints.push(pkg.main);
  else if (typeof pkg.module === "string") ctx.entryPoints.push(pkg.module);
  if (pkg.bin) {
    if (typeof pkg.bin === "string") ctx.entryPoints.push(pkg.bin);
    else ctx.entryPoints.push(...Object.values(pkg.bin));
  }

  if (pkg.workspaces) ctx.monorepoTool = "npm workspaces";
}

function detectFromGoMod(raw, ctx) {
  ctx.languages.push({ name: "Go", source: "go.mod" });
  const modMatch = raw.match(/^module\s+(\S+)/m);
  if (modMatch?.[1]) ctx.entryPoints.push(modMatch[1]);
}

function detectFromCargoToml(raw, ctx, source = "Cargo.toml") {
  const src = source;
  ctx.languages.push({ name: "Rust", source: src });

  const binMatches = raw.matchAll(/\[\[bin]]\s*\n(?:.*\n)*?name\s*=\s*"([^"]+)"/gm);
  for (const m of binMatches) {
    if (m[1]) ctx.entryPoints.push(m[1]);
  }

  if (/^\[workspace]/m.test(raw)) ctx.monorepoTool = "cargo workspaces";
}

function detectFromPlatformioIni(raw, ctx, source = "platformio.ini") {
  const src = source;
  ctx.languages.push({ name: "C/C++", source: src });

  const fwMatch = raw.match(/^framework\s*=\s*(\S+)/m);
  if (fwMatch?.[1]) {
    const fw = fwMatch[1].toLowerCase();
    if (fw === "arduino") ctx.frameworks.push({ name: "Arduino", source: src });
    else if (fw === "espidf") ctx.frameworks.push({ name: "ESP-IDF", source: src });
    else ctx.frameworks.push({ name: fwMatch[1], source: src });
  }

  const platMatch = raw.match(/^platform\s*=\s*(\S+)/m);
  if (platMatch?.[1]) {
    const plat = platMatch[1].toLowerCase();
    if (plat.includes("espressif32")) ctx.frameworks.push({ name: "ESP32", source: src });
    else if (plat.includes("nordicnrf52")) ctx.frameworks.push({ name: "nRF52", source: src });
    else if (plat.includes("atmelavr")) ctx.frameworks.push({ name: "AVR", source: src });
    else if (plat.includes("ststm32")) ctx.frameworks.push({ name: "STM32", source: src });
  }
}

function detectFromSwiftProject(ctx, source) {
  ctx.languages.push({ name: "Swift", source });
  const basename = path.basename(source);
  if (source.endsWith(".xcodeproj") || source.endsWith(".xcworkspace") || basename === "project.yml") {
    ctx.frameworks.push({ name: "Xcode", source });
  }
  if (basename === "Package.swift") {
    ctx.frameworks.push({ name: "Swift Package Manager", source });
  }
}

function detectFromGradle(raw, ctx, source = "build.gradle") {
  const src = source;
  ctx.frameworks.push({ name: "Gradle", source: src });

  if (/com\.android\.tools\.build:gradle/m.test(raw) || /com\.android\.(application|library)/m.test(raw)) {
    ctx.languages.push({ name: "Java", source: src });
    ctx.frameworks.push({ name: "Android", source: src });
  }

  if (/kotlin|org\.jetbrains\.kotlin/m.test(raw)) {
    ctx.languages.push({ name: "Kotlin", source: src });
  }

  if (/plugin.*java|java-library|application/m.test(raw) && !ctx.languages.some((l) => l.name === "Java")) {
    ctx.languages.push({ name: "Java", source: src });
  }

  if (/org\.springframework\.boot/m.test(raw)) {
    ctx.frameworks.push({ name: "Spring Boot", source: src });
  }

  if (/junit/i.test(raw)) {
    ctx.testRunners.push({ name: "JUnit", source: src });
  }
}

function detectFromPomXml(raw, ctx, source = "pom.xml") {
  const src = source;
  ctx.languages.push({ name: "Java", source: src });
  ctx.frameworks.push({ name: "Maven", source: src });

  if (/spring-boot/m.test(raw)) ctx.frameworks.push({ name: "Spring Boot", source: src });
  if (/kotlin/m.test(raw)) ctx.languages.push({ name: "Kotlin", source: src });
  if (/junit/i.test(raw)) ctx.testRunners.push({ name: "JUnit", source: src });
}

function detectFromPyprojectToml(raw, ctx, source = "pyproject.toml") {
  const src = source;

  const isPythonProject = /^\s*\[(project|build-system)]/m.test(raw);
  if (isPythonProject) ctx.languages.push({ name: "Python", source: src });

  if (/^\s*\[\s*tool\s*\.\s*pytest/m.test(raw)) ctx.testRunners.push({ name: "pytest", source: src });
  if (/^\s*\[\s*tool\s*\.\s*ruff/m.test(raw)) ctx.linters.push({ name: "ruff", source: src });
  if (/^\s*\[\s*tool\s*\.\s*black/m.test(raw)) ctx.linters.push({ name: "black", source: src });
  if (/^\s*\[\s*tool\s*\.\s*mypy/m.test(raw)) ctx.linters.push({ name: "mypy", source: src });

  if (/django/i.test(raw)) ctx.frameworks.push({ name: "Django", source: src });
  if (/fastapi/i.test(raw)) ctx.frameworks.push({ name: "FastAPI", source: src });
  if (/flask/i.test(raw)) ctx.frameworks.push({ name: "Flask", source: src });
}

// ─────────────────────────────────────────────────────────────────────────────
// Config file presence checks
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_CHECKS = [
  {
    patterns: ["tsconfig.json"],
    signal: (ctx) => ctx.languages.push({ name: "TypeScript", source: "tsconfig.json" }),
  },
  {
    patterns: ["CMakeLists.txt"],
    signal: (ctx) => ctx.languages.push({ name: "C/C++", source: "CMakeLists.txt" }),
  },
  {
    patterns: ["Makefile", "GNUmakefile", "makefile"],
    signal: (ctx, f) => ctx.frameworks.push({ name: "Make", source: f }),
  },
  {
    patterns: ["Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props"],
    signal: (ctx, f) => {
      ctx.languages.push({ name: "C#", source: f });
      ctx.frameworks.push({ name: ".NET", source: f });
    },
  },
  {
    patterns: ["nuget.config", "NuGet.Config", "NuGet.config"],
    signal: (ctx, f) => {
      ctx.languages.push({ name: "C#", source: f });
      ctx.frameworks.push({ name: "NuGet", source: f });
    },
  },
  {
    patterns: ["SConstruct"],
    signal: (ctx) => {
      ctx.languages.push({ name: "C/C++", source: "SConstruct" });
      ctx.frameworks.push({ name: "SCons", source: "SConstruct" });
    },
  },
  {
    patterns: ["meson.build"],
    signal: (ctx) => {
      ctx.languages.push({ name: "C/C++", source: "meson.build" });
      ctx.frameworks.push({ name: "Meson", source: "meson.build" });
    },
  },
  {
    patterns: [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"],
    signal: (ctx, f) => ctx.linters.push({ name: "eslint", source: f }),
  },
  {
    patterns: ["biome.json", "biome.jsonc"],
    signal: (ctx, f) => ctx.linters.push({ name: "biome", source: f }),
  },
  {
    patterns: [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs", "prettier.config.js", "prettier.config.cjs"],
    signal: (ctx, f) => ctx.linters.push({ name: "prettier", source: f }),
  },
  {
    patterns: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"],
    signal: (ctx, f) => ctx.testRunners.push({ name: "jest", source: f }),
  },
  {
    patterns: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs"],
    signal: (ctx, f) => ctx.testRunners.push({ name: "vitest", source: f }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// File extension distribution
// ─────────────────────────────────────────────────────────────────────────────

async function countFilesByLanguage(root) {
  const counts = new Map();
  let total = 0;

  async function walk(dir, depth) {
    if (depth > 10 || total >= MAX_FILES_SCANNED) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (total >= MAX_FILES_SCANNED) return;
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS_DISTRIBUTION.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = EXT_TO_LANGUAGE[ext];
        if (lang) {
          counts.set(lang, (counts.get(lang) ?? 0) + 1);
          total++;
        }
      }
    }
  }

  await walk(root, 0);

  if (total === 0) return [];

  return [...counts.entries()]
    .map(([language, files]) => ({
      language, files,
      percentage: Math.round((files / total) * 1000) / 10,
    }))
    .sort((a, b) => b.files - a.files);
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace handling
// ─────────────────────────────────────────────────────────────────────────────

function extractWorkspacePatterns(monorepoTool, packageJsonRaw, cargoTomlRaw, pnpmWorkspaceRaw, lernaJsonRaw) {
  if (monorepoTool === "npm workspaces" && packageJsonRaw) {
    try {
      const pkg = JSON.parse(packageJsonRaw);
      if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
      if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
    } catch { /* skip */ }
  }

  if (monorepoTool === "pnpm workspaces" && pnpmWorkspaceRaw) {
    const lines = pnpmWorkspaceRaw.split("\n");
    const patterns = [];
    let inPackages = false;
    for (const line of lines) {
      if (/^packages\s*:/i.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*/);
        if (match?.[1]) patterns.push(match[1]);
        else if (/^\S/.test(line)) break;
      }
    }
    return patterns;
  }

  if (monorepoTool === "lerna" && lernaJsonRaw) {
    try {
      const lerna = JSON.parse(lernaJsonRaw);
      if (Array.isArray(lerna.packages)) return lerna.packages;
    } catch { /* skip */ }
    return ["packages/*"];
  }

  if (monorepoTool === "cargo workspaces" && cargoTomlRaw) {
    const membersMatch = cargoTomlRaw.match(/\[workspace]\s*\n[\s\S]*?members\s*=\s*\[([^\]]*)\]/m);
    if (membersMatch?.[1]) {
      return membersMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    }
  }

  return [];
}

async function resolveWorkspacePaths(root, patterns) {
  const results = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = path.join(root, pattern.slice(0, -2));
      try {
        const entries = await fs.readdir(parent, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          results.push(path.join(parent, entry.name));
          if (results.length >= MAX_WORKSPACE_PACKAGES) return results;
        }
      } catch { /* skip */ }
    } else {
      const dir = path.join(root, pattern);
      if (await exists(dir)) {
        results.push(dir);
        if (results.length >= MAX_WORKSPACE_PACKAGES) return results;
      }
    }
  }
  return results;
}

async function fingerprintPackage(pkgPath, root, ctx) {
  const rel = path.relative(root, pkgPath);
  const [pkgJson, cargoToml, pyproject] = await Promise.all([
    readSafe(path.join(pkgPath, "package.json")),
    readSafe(path.join(pkgPath, "Cargo.toml")),
    readSafe(path.join(pkgPath, "pyproject.toml")),
  ]);

  if (pkgJson) detectFromPackageJson(pkgJson, ctx, `${rel}/package.json`);
  if (cargoToml) detectFromCargoToml(cargoToml, ctx, `${rel}/Cargo.toml`);
  if (pyproject) detectFromPyprojectToml(pyproject, ctx, `${rel}/pyproject.toml`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Subdirectory scanning
// ─────────────────────────────────────────────────────────────────────────────

async function scanSubdirectories(root, ctx) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch { return; }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "build" && e.name !== "dist")
    .slice(0, MAX_SUBDIRS);

  for (const dir of dirs) {
    const dirPath = path.join(root, dir.name);
    const rel = dir.name;

    const [pkgJson, cargoToml, pyproject, platformioIni, goMod, gradle, gradleKts, pomXml] = await Promise.all([
      readSafe(path.join(dirPath, "package.json")),
      readSafe(path.join(dirPath, "Cargo.toml")),
      readSafe(path.join(dirPath, "pyproject.toml")),
      readSafe(path.join(dirPath, "platformio.ini")),
      readSafe(path.join(dirPath, "go.mod")),
      readSafe(path.join(dirPath, "build.gradle")),
      readSafe(path.join(dirPath, "build.gradle.kts")),
      readSafe(path.join(dirPath, "pom.xml")),
    ]);

    if (pkgJson) detectFromPackageJson(pkgJson, ctx, `${rel}/package.json`);
    if (cargoToml) detectFromCargoToml(cargoToml, ctx, `${rel}/Cargo.toml`);
    if (pyproject) detectFromPyprojectToml(pyproject, ctx, `${rel}/pyproject.toml`);
    if (platformioIni) detectFromPlatformioIni(platformioIni, ctx, `${rel}/platformio.ini`);
    if (goMod) detectFromGoMod(goMod, ctx);
    if (gradle) detectFromGradle(gradle, ctx, `${rel}/build.gradle`);
    else if (gradleKts) detectFromGradle(gradleKts, ctx, `${rel}/build.gradle.kts`);
    if (pomXml) detectFromPomXml(pomXml, ctx, `${rel}/pom.xml`);

    await detectSwiftInDir(dirPath, rel, ctx);
  }
}

async function detectSwiftInDir(dirPath, rel, ctx) {
  if (await exists(path.join(dirPath, "Package.swift"))) { detectFromSwiftProject(ctx, `${rel}/Package.swift`); return; }
  if (await exists(path.join(dirPath, "project.yml"))) { detectFromSwiftProject(ctx, `${rel}/project.yml`); return; }
  const xcodeproj = await findXcodeproj(dirPath);
  if (xcodeproj) { detectFromSwiftProject(ctx, `${rel}/${xcodeproj}`); return; }

  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    const childDirs = children.filter((e) => e.isDirectory() && !e.name.startsWith(".")).slice(0, 5);
    for (const child of childDirs) {
      const childPath = path.join(dirPath, child.name);
      const childRel = `${rel}/${child.name}`;

      if (await exists(path.join(childPath, "Package.swift"))) { detectFromSwiftProject(ctx, `${childRel}/Package.swift`); return; }
      if (await exists(path.join(childPath, "project.yml"))) { detectFromSwiftProject(ctx, `${childRel}/project.yml`); return; }
      const childXcodeproj = await findXcodeproj(childPath);
      if (childXcodeproj) { detectFromSwiftProject(ctx, `${childRel}/${childXcodeproj}`); return; }
    }
  } catch { /* skip */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component building
// ─────────────────────────────────────────────────────────────────────────────

function buildComponents(ctx) {
  const componentMap = new Map();

  function getOrCreate(componentPath) {
    let comp = componentMap.get(componentPath);
    if (!comp) {
      comp = emptyComponent(componentPath);
      componentMap.set(componentPath, comp);
    }
    return comp;
  }

  function componentPathFromSource(source) {
    if (source.includes("(")) return null;
    const idx = source.indexOf("/");
    if (idx === -1) return "";
    return source.slice(0, idx);
  }

  for (const sig of ctx.languages) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).languages.push(sig);
  }
  for (const sig of ctx.frameworks) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).frameworks.push(sig);
  }
  for (const sig of ctx.testRunners) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).testRunners.push(sig);
  }
  for (const sig of ctx.linters) {
    const cp = componentPathFromSource(sig.source);
    if (cp !== null) getOrCreate(cp).linters.push(sig);
  }

  const withLanguages = [...componentMap.values()].filter((c) => c.languages.length > 0);
  if (withLanguages.length < 2) return [];

  for (const comp of withLanguages) {
    comp.languages = dedup(comp.languages);
    comp.frameworks = dedup(comp.frameworks);
    comp.testRunners = dedup(comp.testRunners);
    comp.linters = dedup(comp.linters);
  }

  return withLanguages;
}

async function buildComponentsFromDistribution(root, ctx) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch { return []; }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS_SET.has(e.name))
    .slice(0, 10);

  const components = [];
  const primaryLangs = new Set();

  for (const dir of dirs) {
    const dist = await countFilesByLanguage(path.join(root, dir.name));
    if (dist.length === 0 || dist[0].files < 5) continue;

    const primary = dist[0].language;
    primaryLangs.add(primary);

    const comp = emptyComponent(dir.name);
    comp.languageDistribution = dist;
    comp.languages = [{ name: primary, source: `${dir.name}/ (${dist[0].percentage}% of files)` }];

    for (const fw of ctx.frameworks) {
      if (fw.source.startsWith(dir.name + "/")) comp.frameworks.push(fw);
    }
    for (const tr of ctx.testRunners) {
      if (tr.source.startsWith(dir.name + "/")) comp.testRunners.push(tr);
    }
    for (const lt of ctx.linters) {
      if (lt.source.startsWith(dir.name + "/")) comp.linters.push(lt);
    }

    components.push(comp);
  }

  if (primaryLangs.size < 2) return [];

  for (const comp of components) {
    comp.frameworks = dedup(comp.frameworks);
  }

  return components;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main fingerprint function
// ─────────────────────────────────────────────────────────────────────────────

async function fingerprint(repoPath) {
  const ctx = emptyContext();
  const root = path.resolve(repoPath);

  // Phase 1: Read ecosystem manifest files
  const [packageJsonRaw, goModRaw, cargoTomlRaw, pyprojectRaw, platformioIniRaw, gradleRaw, gradleKtsRaw, pomXmlRaw] =
    await Promise.all([
      readSafe(path.join(root, "package.json")),
      readSafe(path.join(root, "go.mod")),
      readSafe(path.join(root, "Cargo.toml")),
      readSafe(path.join(root, "pyproject.toml")),
      readSafe(path.join(root, "platformio.ini")),
      readSafe(path.join(root, "build.gradle")),
      readSafe(path.join(root, "build.gradle.kts")),
      readSafe(path.join(root, "pom.xml")),
    ]);

  if (packageJsonRaw) detectFromPackageJson(packageJsonRaw, ctx);
  if (goModRaw) detectFromGoMod(goModRaw, ctx);
  if (cargoTomlRaw) detectFromCargoToml(cargoTomlRaw, ctx);
  if (pyprojectRaw) detectFromPyprojectToml(pyprojectRaw, ctx);
  if (platformioIniRaw) detectFromPlatformioIni(platformioIniRaw, ctx);
  if (gradleRaw) detectFromGradle(gradleRaw, ctx);
  else if (gradleKtsRaw) detectFromGradle(gradleKtsRaw, ctx, "build.gradle.kts");
  if (pomXmlRaw) detectFromPomXml(pomXmlRaw, ctx);

  // Phase 2: Config files, lockfiles, docs, monorepo signals
  const allChecks = [];

  for (const check of CONFIG_CHECKS) {
    for (const pattern of check.patterns) {
      allChecks.push(
        exists(path.join(root, pattern)).then((found) => {
          if (found) check.signal(ctx, pattern);
        }),
      );
    }
  }

  for (const [lockfile, pm] of Object.entries(LOCKFILE_TO_PM)) {
    allChecks.push(
      exists(path.join(root, lockfile)).then((found) => {
        if (found && !ctx.packageManager) ctx.packageManager = pm;
      }),
    );
  }

  for (const doc of ARCH_DOCS) {
    allChecks.push(
      exists(path.join(root, doc)).then((found) => {
        if (found) ctx.architectureDocs.push(doc);
      }),
    );
  }

  for (const [file, tool] of Object.entries(MONOREPO_FILES)) {
    allChecks.push(
      exists(path.join(root, file)).then((found) => {
        if (found) ctx.monorepoTool = tool;
      }),
    );
  }

  allChecks.push(
    findDotNetProject(root).then((name) => {
      if (name) {
        ctx.languages.push({ name: name.endsWith(".fsproj") ? "F#" : "C#", source: name });
        ctx.frameworks.push({ name: ".NET", source: name });
      }
    }),
  );

  allChecks.push(
    exists(path.join(root, "Package.swift")).then((found) => {
      if (found) detectFromSwiftProject(ctx, "Package.swift");
    }),
  );
  allChecks.push(
    exists(path.join(root, "project.yml")).then((found) => {
      if (found) detectFromSwiftProject(ctx, "project.yml");
    }),
  );
  allChecks.push(
    findXcodeproj(root).then((name) => {
      if (name) detectFromSwiftProject(ctx, name);
    }),
  );

  await Promise.all(allChecks);

  // Phase 3: Workspace packages
  if (ctx.monorepoTool) {
    const pnpmWorkspaceRaw = ctx.monorepoTool === "pnpm workspaces"
      ? await readSafe(path.join(root, "pnpm-workspace.yaml"))
      : null;
    const lernaJsonRaw = ctx.monorepoTool === "lerna"
      ? await readSafe(path.join(root, "lerna.json"))
      : null;

    const patterns = extractWorkspacePatterns(
      ctx.monorepoTool, packageJsonRaw, cargoTomlRaw, pnpmWorkspaceRaw, lernaJsonRaw,
    );

    if (patterns.length > 0) {
      const pkgPaths = await resolveWorkspacePaths(root, patterns);
      ctx.workspacePackages = pkgPaths.map((p) => path.relative(root, p));
      await Promise.all(pkgPaths.map((p) => fingerprintPackage(p, root, ctx)));
    }
  }

  // Phase 4: Subdirectory scan
  await scanSubdirectories(root, ctx);

  // Phase 5: File extension distribution
  ctx.languageDistribution = await countFilesByLanguage(root);

  const knownLangs = new Set(ctx.languages.map((s) => s.name));
  for (const share of ctx.languageDistribution) {
    if (share.percentage >= 5 && !knownLangs.has(share.language)) {
      ctx.languages.push({ name: share.language, source: `file distribution (${share.percentage}%)` });
    }
  }

  // Dedup
  ctx.languages = dedup(ctx.languages);
  ctx.frameworks = dedup(ctx.frameworks);
  ctx.testRunners = dedup(ctx.testRunners);
  ctx.linters = dedup(ctx.linters);
  ctx.entryPoints = [...new Set(ctx.entryPoints)];
  ctx.architectureDocs = [...new Set(ctx.architectureDocs)];

  // Phase 6: Components
  ctx.components = buildComponents(ctx);

  if (ctx.components.length === 0 && ctx.languageDistribution.length > 1) {
    ctx.components = await buildComponentsFromDistribution(root, ctx);
  }

  if (ctx.components.length > 0) {
    await Promise.all(
      ctx.components.map(async (comp) => {
        if (comp.path && comp.languageDistribution.length === 0) {
          comp.languageDistribution = await countFilesByLanguage(path.join(root, comp.path));
        }
      }),
    );
  }

  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format for prompt output
// ─────────────────────────────────────────────────────────────────────────────

function formatRepoContext(ctx) {
  const lines = [];

  if (ctx.languageDistribution.length > 0) {
    const top = ctx.languageDistribution.slice(0, 5);
    lines.push(`- Languages: ${top.map((s) => `${s.language} (${s.percentage}%)`).join(", ")}`);
  } else if (ctx.languages.length > 0) {
    lines.push(`- Languages: ${ctx.languages.map((s) => s.name).join(", ")}`);
  }
  if (ctx.frameworks.length > 0) {
    lines.push(`- Frameworks: ${ctx.frameworks.map((s) => s.name).join(", ")}`);
  }
  if (ctx.testRunners.length > 0) {
    lines.push(`- Test runner: ${ctx.testRunners.map((s) => s.name).join(", ")}`);
  }
  if (ctx.linters.length > 0) {
    lines.push(`- Linters: ${ctx.linters.map((s) => s.name).join(", ")}`);
  }
  if (ctx.entryPoints.length > 0) {
    lines.push(`- Entry points: ${ctx.entryPoints.join(", ")}`);
  }
  if (ctx.packageManager) {
    lines.push(`- Package manager: ${ctx.packageManager}`);
  }
  if (ctx.monorepoTool) {
    lines.push(`- Monorepo: ${ctx.monorepoTool}`);
  }
  if (ctx.workspacePackages.length > 0) {
    const MAX_DISPLAY = 10;
    const shown = ctx.workspacePackages.slice(0, MAX_DISPLAY);
    const suffix = ctx.workspacePackages.length > MAX_DISPLAY
      ? ` (+${ctx.workspacePackages.length - MAX_DISPLAY} more)`
      : "";
    lines.push(`- Workspace packages: ${shown.join(", ")}${suffix}`);
  }
  if (ctx.architectureDocs.length > 0) {
    lines.push(`- Architecture docs: ${ctx.architectureDocs.join(", ")}`);
  }
  if (ctx.components.length > 0) {
    const map = ctx.components.map((c) => {
      const lang = c.languages[0]?.name ?? "unknown";
      const fws = c.frameworks.length > 0 ? ` (${c.frameworks.map((f) => f.name).join(", ")})` : "";
      return `${c.path || "(root)"}=${lang}${fws}`;
    });
    lines.push(`- Project structure: ${map.join(", ")}`);
  }

  if (lines.length === 0) return "";

  return `PROJECT CONTEXT (best-effort repo-level hints — may be incomplete or outdated):\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI display
// ─────────────────────────────────────────────────────────────────────────────

function color(text, code, noColor) {
  if (noColor) return text;
  return `${code}${text}\x1b[0m`;
}

function buildDistributionBar(shares, width, noColor) {
  if (noColor) {
    return shares.map((s) => `${s.language} ${s.percentage}%`).join(" | ");
  }
  let bar = "";
  for (const s of shares) {
    const chars = Math.max(1, Math.round((s.percentage / 100) * width));
    const c = LANG_COLORS[s.language] ?? "\x1b[90m";
    bar += `${c}${"█".repeat(chars)}\x1b[0m`;
  }
  return bar;
}

function renderDisplay(ctx, repoPath, noColor) {
  const out = process.stdout;
  const c = (text, code) => color(text, code, noColor);

  out.write(`\n  ${c("Fingerprint:", "\x1b[1m")} ${repoPath}\n\n`);

  const field = (label, values) => {
    if (values.length === 0) return;
    const items = values.map((v) =>
      `${c(v.name, "\x1b[1m")} ${c(`(${v.source})`, "\x1b[90m")}`,
    );
    out.write(`  ${label.padEnd(16)} ${items.join(", ")}\n`);
  };

  if (ctx.languageDistribution.length > 0) {
    const top = ctx.languageDistribution.slice(0, 8);
    const bar = buildDistributionBar(top, 40, noColor);
    out.write(`  ${c("Distribution", "\x1b[1m")}   ${bar}\n`);
    for (let i = 0; i < top.length; i += 2) {
      const left = `${c(top[i].language, "\x1b[1m")} ${top[i].percentage}%`;
      const right = top[i + 1]
        ? `${c(top[i + 1].language, "\x1b[1m")} ${top[i + 1].percentage}%`
        : "";
      out.write(`  ${" ".repeat(16)} ${left.padEnd(38)}${right}\n`);
    }
    out.write("\n");
  }

  field("Languages", ctx.languages);
  field("Frameworks", ctx.frameworks);
  field("Test runners", ctx.testRunners);
  field("Linters", ctx.linters);

  if (ctx.entryPoints.length > 0) {
    out.write(`  ${"Entry points".padEnd(16)} ${ctx.entryPoints.map((e) => c(e, "\x1b[1m")).join(", ")}\n`);
  }
  if (ctx.packageManager) {
    out.write(`  ${"Package mgr".padEnd(16)} ${c(ctx.packageManager, "\x1b[1m")}\n`);
  }
  if (ctx.monorepoTool) {
    out.write(`  ${"Monorepo".padEnd(16)} ${c(ctx.monorepoTool, "\x1b[1m")}\n`);
  }
  if (ctx.workspacePackages.length > 0) {
    out.write(`  ${"Workspaces".padEnd(16)} ${ctx.workspacePackages.map((w) => c(w, "\x1b[1m")).join(", ")}\n`);
  }
  if (ctx.architectureDocs.length > 0) {
    out.write(`  ${"Arch docs".padEnd(16)} ${ctx.architectureDocs.map((d) => c(d, "\x1b[90m")).join(", ")}\n`);
  }

  if (ctx.components.length > 0) {
    out.write(`\n  ${c("Components:", "\x1b[1m")}\n`);
    for (const comp of ctx.components) {
      const label = comp.path || "(root)";
      const langs = comp.languages.map((l) => l.name).join(", ");
      const fws = comp.frameworks.length > 0 ? ` + ${comp.frameworks.map((f) => f.name).join(", ")}` : "";
      out.write(`    ${c(label, "\x1b[1m")} — ${langs}${fws}\n`);
    }
  }

  const formatted = formatRepoContext(ctx);
  if (formatted) {
    out.write(`\n  ${c("Prompt block:", "\x1b[1m")}\n`);
    for (const line of formatted.split("\n")) {
      out.write(`  ${c(line, "\x1b[90m")}\n`);
    }
  } else {
    out.write(`\n  ${c("No signals detected.", "\x1b[33m")}\n`);
  }

  out.write("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// One-line colored bar (for Bash tool output — stays under the collapse threshold)
// ─────────────────────────────────────────────────────────────────────────────

function renderBarOnly(ctx, noColor) {
  if (ctx.languageDistribution.length === 0) {
    return (noColor ? "(no language distribution detected)" : "\x1b[90m(no language distribution detected)\x1b[0m") + "\n";
  }
  const top = ctx.languageDistribution.slice(0, 8);
  const width = 40;
  const wrap = (text, code) => noColor ? text : `${code}${text}\x1b[0m`;

  let bar = "";
  for (const s of top) {
    const chars = Math.max(1, Math.round((s.percentage / 100) * width));
    const code = LANG_COLORS[s.language] ?? "\x1b[90m";
    bar += wrap("█".repeat(chars), code);
  }

  const legend = top.map((s) => {
    const code = LANG_COLORS[s.language] ?? "\x1b[90m";
    return `${wrap(s.language, code)} ${s.percentage}%`;
  }).join("  ");

  return `${bar}  ${legend}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown rendering (for inline display in agent responses)
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(ctx, repoPath, includeBar = true) {
  const lines = [];
  lines.push(`### Fingerprint: \`${repoPath}\``);
  lines.push("");

  if (includeBar && ctx.languageDistribution.length > 0) {
    const top = ctx.languageDistribution.slice(0, 8);
    const maxLabel = Math.max(...top.map((s) => s.language.length));
    const barWidth = 40;
    lines.push("**Distribution**");
    lines.push("");
    for (const s of top) {
      const chars = Math.max(1, Math.round((s.percentage / 100) * barWidth));
      const bar = "█".repeat(chars) + "░".repeat(barWidth - chars);
      const label = s.language.padEnd(maxLabel);
      const pct = `${s.percentage}%`.padStart(6);
      lines.push(`\`${label}  ${bar}  ${pct}\``);
      lines.push("");
    }
  }

  const bullet = (label, values) => {
    if (!values || values.length === 0) return;
    const items = values.map((v) => (typeof v === "string" ? v : v.name)).join(", ");
    lines.push(`- **${label}:** ${items}`);
  };

  bullet("Languages", ctx.languages);
  bullet("Frameworks", ctx.frameworks);
  bullet("Test runners", ctx.testRunners);
  bullet("Linters", ctx.linters);

  if (ctx.entryPoints.length > 0) {
    lines.push(`- **Entry points:** ${ctx.entryPoints.map((e) => `\`${e}\``).join(", ")}`);
  }
  if (ctx.packageManager) {
    lines.push(`- **Package manager:** ${ctx.packageManager}`);
  }
  if (ctx.monorepoTool) {
    lines.push(`- **Monorepo:** ${ctx.monorepoTool}`);
  }
  if (ctx.workspacePackages.length > 0) {
    const MAX_DISPLAY = 10;
    const shown = ctx.workspacePackages.slice(0, MAX_DISPLAY).map((w) => `\`${w}\``);
    const suffix = ctx.workspacePackages.length > MAX_DISPLAY
      ? ` _(+${ctx.workspacePackages.length - MAX_DISPLAY} more)_`
      : "";
    lines.push(`- **Workspaces:** ${shown.join(", ")}${suffix}`);
  }
  if (ctx.architectureDocs.length > 0) {
    lines.push(`- **Architecture docs:** ${ctx.architectureDocs.map((d) => `\`${d}\``).join(", ")}`);
  }

  if (ctx.components.length > 0) {
    lines.push("");
    lines.push("**Components**");
    lines.push("");
    for (const comp of ctx.components) {
      const label = comp.path || "(root)";
      const langs = comp.languages.map((l) => l.name).join(", ");
      const fws = comp.frameworks.length > 0
        ? ` — ${comp.frameworks.map((f) => f.name).join(", ")}`
        : "";
      lines.push(`- \`${label}\`: ${langs}${fws}`);
    }
  }

  const promptBlock = formatRepoContext(ctx);
  if (promptBlock) {
    lines.push("");
    lines.push("**Prompt block** _(paste into agent prompts)_");
    lines.push("");
    lines.push("~~~");
    for (const line of promptBlock.split("\n")) {
      lines.push(line);
    }
    lines.push("~~~");
  }

  return lines.join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const plainMode = args.includes("--plain");
  const markdownMode = args.includes("--markdown") || args.includes("--md");
  const barOnlyMode = args.includes("--bar-only") || args.includes("--bar");
  const noBar = args.includes("--no-bar");
  const pathArg = args.find((a) => !a.startsWith("--")) ?? ".";

  const expanded = pathArg.startsWith("~")
    ? path.join(os.homedir(), pathArg.slice(1))
    : pathArg;
  const repoPath = path.resolve(expanded);

  try {
    const ctx = await fingerprint(repoPath);

    if (jsonMode) {
      process.stdout.write(JSON.stringify(ctx, null, 2) + "\n");
      return;
    }

    const forceColor = "FORCE_COLOR" in process.env && process.env.FORCE_COLOR !== "0";
    const noColor = NO_COLOR || plainMode || (!process.stdout.isTTY && !forceColor);

    if (barOnlyMode) {
      process.stdout.write(renderBarOnly(ctx, noColor));
      return;
    }

    if (markdownMode) {
      process.stdout.write(renderMarkdown(ctx, repoPath, !noBar));
      return;
    }

    renderDisplay(ctx, repoPath, noColor);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errColor = NO_COLOR ? "" : "\x1b[31m";
    const reset = NO_COLOR ? "" : "\x1b[0m";
    process.stderr.write(`  ${errColor}Error:${reset} ${msg}\n\n`);
    process.exit(1);
  }
}

main();
