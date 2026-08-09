import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { listTsFiles } from "./list-ts-files.mjs";

const cwd = process.cwd();
const cache = new Map();

function getSourceFiles(sourceDir, files) {
  if (Array.isArray(files) && files.length > 0) return files;
  const sourcePath = path.join(cwd, sourceDir);
  return listTsFiles(sourcePath).map((file) => path.relative(cwd, file));
}

/**
 * @param {{
 *  sourceDir: string;
 *  files?: string[];
 *  entryFile: string;
 *  outDir: string;
 *  extraFiles?: string[];
 * }} params
 */
export async function loadTsModule({ sourceDir, files, entryFile, outDir, extraFiles = [] }) {
  const cacheKey = JSON.stringify({ sourceDir, files, entryFile, outDir, extraFiles });
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const outputDir = path.join(cwd, outDir);
      const sourceFiles = [
        ...getSourceFiles(sourceDir, files),
        ...extraFiles,
      ];
      rmSync(outputDir, { recursive: true, force: true });
      mkdirSync(outputDir, { recursive: true });
      execFileSync("./node_modules/.bin/tsc", [
        ...sourceFiles,
        "--module", "nodenext",
        "--target", "es2020",
        "--moduleResolution", "nodenext",
        "--outDir", outputDir,
        "--esModuleInterop",
        "--skipLibCheck",
      ], { cwd, stdio: "pipe" });
      return await import(path.join(outputDir, entryFile));
    })());
  }
  return await cache.get(cacheKey);
}
