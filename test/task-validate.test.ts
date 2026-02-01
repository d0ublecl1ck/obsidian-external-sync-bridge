import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { validateSyncTask } from "../src/task-validate";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("validateSyncTask", () => {
  it("skips when source is missing and ignoreMissingSource=true", () => {
    const vault = mkTmpDir("esb-vault-");
    const missingSource = path.join(vault, "does-not-exist");
    const result = validateSyncTask(
      { sourcePath: missingSource, targetPath: "Backups/any", ignoreMissingSource: true },
      vault
    );
    expect(result).toEqual({ ok: true, action: "skip", reason: "源路径不存在（已按配置忽略）" });
  });

  it("fails when source is missing and ignoreMissingSource is not enabled", () => {
    const vault = mkTmpDir("esb-vault-");
    const missingSource = path.join(vault, "does-not-exist");
    const result = validateSyncTask({ sourcePath: missingSource, targetPath: "Backups/any" }, vault);
    expect(result).toEqual({ ok: false, reason: "源路径不存在" });
  });

  it("still fails when target is outside vault even if ignoreMissingSource=true", () => {
    const vault = mkTmpDir("esb-vault-");
    const missingSource = path.join(vault, "does-not-exist");
    const result = validateSyncTask(
      { sourcePath: missingSource, targetPath: "../outside", ignoreMissingSource: true },
      vault
    );
    expect(result).toEqual({ ok: false, reason: "目标路径必须在 Vault 内" });
  });

  it("appends basename when source is file and target ends with slash", () => {
    const vault = mkTmpDir("esb-vault-");
    const sourceDir = mkTmpDir("esb-src-");
    const sourceFile = path.join(sourceDir, "a.txt");
    fs.writeFileSync(sourceFile, "hello", "utf8");

    const result = validateSyncTask({ sourcePath: sourceFile, targetPath: "Backup/" }, vault);
    expect(result.ok).toBe(true);
    if (result.ok && result.action === "sync") {
      expect(result.target).toBe(path.join(vault, "Backup", "a.txt"));
    }
  });

  it("fails when source is directory but target is an existing file", () => {
    const vault = mkTmpDir("esb-vault-");
    const sourceDir = mkTmpDir("esb-src-");

    const targetRel = "Target/file.txt";
    const targetAbs = path.join(vault, targetRel);
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.writeFileSync(targetAbs, "x", "utf8");

    const result = validateSyncTask({ sourcePath: sourceDir, targetPath: targetRel }, vault);
    expect(result).toEqual({ ok: false, reason: "源为目录时目标不能是文件" });
  });
});

