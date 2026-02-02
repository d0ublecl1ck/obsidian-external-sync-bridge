import * as fs from "fs";
import * as path from "path";
import { formatErrorReason } from "./error";

export type SyncTaskValidationInput = {
  sourcePath: string;
  targetPath: string;
  ignoreMissingSource?: boolean;
};

export type SyncTaskValidationResult =
  | { ok: true; action: "sync"; source: string; target: string }
  | { ok: true; action: "skip"; reason: string }
  | { ok: false; reason: string };

export function validateSyncTask(
  task: SyncTaskValidationInput,
  vaultBasePath: string
): SyncTaskValidationResult {
  if (!task.sourcePath.trim()) {
    return { ok: false, reason: "源路径为空" };
  }
  if (!task.targetPath.trim()) {
    return { ok: false, reason: "目标路径为空" };
  }

  const source = path.normalize(task.sourcePath);

  const targetBase = path.normalize(task.targetPath);
  const targetAbs = path.join(vaultBasePath, targetBase);
  const rel = path.relative(vaultBasePath, targetAbs);
  if (rel.startsWith("..")) {
    return { ok: false, reason: "目标路径必须在 Vault 内" };
  }

  if (!fs.existsSync(source)) {
    if (task.ignoreMissingSource) {
      return { ok: true, action: "skip", reason: "源路径不存在（已按配置忽略）" };
    }
    return { ok: false, reason: "源路径不存在" };
  }

  let targetAbsStat: fs.Stats | null = null;
  if (fs.existsSync(targetAbs)) {
    try {
      targetAbsStat = fs.statSync(targetAbs);
    } catch (error) {
      return { ok: false, reason: `无法访问目标路径：${formatErrorReason(error)}` };
    }
  }

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(source);
  } catch (error) {
    return { ok: false, reason: `无法访问源路径：${formatErrorReason(error)}` };
  }

  let finalTarget = targetAbs;
  if (sourceStat.isFile()) {
    const targetEndsWithSlash = task.targetPath.endsWith("/") || task.targetPath.endsWith(path.sep);
    if (targetEndsWithSlash || (targetAbsStat && targetAbsStat.isDirectory())) {
      finalTarget = path.join(targetAbs, path.basename(source));
    }
  } else if (sourceStat.isDirectory()) {
    if (targetAbsStat && targetAbsStat.isFile()) {
      return { ok: false, reason: "源为目录时目标不能是文件" };
    }
  }

  return { ok: true, action: "sync", source, target: finalTarget };
}

