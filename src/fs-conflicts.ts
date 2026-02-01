import * as fs from "fs";
import * as path from "path";
import * as fsExtra from "fs-extra";

type NodeErrorLike = { code?: string };

export type EnsureCopyTargetCompatibleResult =
  | { moved: true; from: string; to: string }
  | { moved: false };

async function lstatIfExists(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(filePath);
  } catch (error) {
    const err = error as NodeErrorLike;
    if (err && err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function safeRelative(baseDir: string, filePath: string): string {
  const rel = path.relative(baseDir, filePath);
  if (!rel || rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return path.basename(filePath);
  }
  return rel;
}

async function uniquePath(basePath: string): Promise<string> {
  const exists = await lstatIfExists(basePath);
  if (!exists) {
    return basePath;
  }

  const dir = path.dirname(basePath);
  const base = path.basename(basePath);
  for (let i = 1; i <= 100; i++) {
    const candidate = path.join(dir, `${base}.${i}`);
    const candidateExists = await lstatIfExists(candidate);
    if (!candidateExists) {
      return candidate;
    }
  }

  return path.join(dir, `${base}.${Date.now()}.${Math.random().toString(16).slice(2)}`);
}

export async function ensureCopyTargetCompatible(params: {
  src: string;
  dest: string;
  destBaseDir: string;
  trashSessionDir: string;
}): Promise<EnsureCopyTargetCompatibleResult> {
  const { src, dest, destBaseDir, trashSessionDir } = params;

  const destLstat = await lstatIfExists(dest);
  if (!destLstat) {
    return { moved: false };
  }

  const srcStat = await fs.promises.stat(src);
  const srcIsDir = srcStat.isDirectory();
  const srcIsFile = srcStat.isFile();

  const destIsDir = destLstat.isDirectory();
  const destIsSymlink = destLstat.isSymbolicLink();

  const mismatch =
    destIsSymlink ||
    (srcIsDir && !destIsDir) ||
    (srcIsFile && destIsDir);

  if (!mismatch) {
    return { moved: false };
  }

  const rel = safeRelative(destBaseDir, dest);
  const trashPathBase = path.join(trashSessionDir, rel);
  const trashPath = await uniquePath(trashPathBase);

  await fsExtra.ensureDir(path.dirname(trashPath));
  await fsExtra.move(dest, trashPath, { overwrite: false });

  return { moved: true, from: dest, to: trashPath };
}

