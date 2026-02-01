import * as path from "path";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function buildSettingsJsonFileName(prefix: string, date: Date): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${prefix}-${stamp}.json`;
}

export function buildSettingsExportFileName(date: Date): string {
  return buildSettingsJsonFileName("external-sync-bridge-settings", date);
}

export function buildSettingsBackupFileName(date: Date): string {
  return buildSettingsJsonFileName("external-sync-bridge-settings-backup", date);
}

export function resolveUniqueFilePath(
  directory: string,
  fileName: string,
  exists: (candidate: string) => boolean
): string {
  const base = path.basename(fileName, path.extname(fileName));
  const ext = path.extname(fileName) || ".json";

  let candidate = path.join(directory, `${base}${ext}`);
  if (!exists(candidate)) return candidate;

  for (let i = 2; i < 10_000; i++) {
    candidate = path.join(directory, `${base}-${i}${ext}`);
    if (!exists(candidate)) return candidate;
  }

  throw new Error("Unable to create unique export file name.");
}
