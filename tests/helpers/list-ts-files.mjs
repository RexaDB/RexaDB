import { readdirSync, statSync } from "node:fs";
import path from "node:path";

function listTsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listTsFiles(fullPath);
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}
