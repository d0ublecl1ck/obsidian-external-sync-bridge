import { describe, expect, it } from "vitest";
import { buildSettingsBackupFileName, buildSettingsExportFileName, resolveUniqueFilePath } from "../src/export";

describe("buildSettingsExportFileName", () => {
  it("generates a stable, filesystem-safe json file name", () => {
    const date = new Date(2026, 1, 1, 3, 4, 5);
    const name = buildSettingsExportFileName(date);
    expect(name).toBe("external-sync-bridge-settings-20260201-030405.json");
    expect(name.includes(":")).toBe(false);
    expect(name.includes("/")).toBe(false);
  });
});

describe("buildSettingsBackupFileName", () => {
  it("generates a stable json file name with backup prefix", () => {
    const date = new Date(2026, 1, 1, 3, 4, 5);
    const name = buildSettingsBackupFileName(date);
    expect(name).toBe("external-sync-bridge-settings-backup-20260201-030405.json");
  });
});

describe("resolveUniqueFilePath", () => {
  it("returns the first non-existing candidate", () => {
    const existing = new Set<string>(["/export/a.json", "/export/a-2.json"]);
    const resolved = resolveUniqueFilePath("/export", "a.json", (p) => existing.has(p));
    expect(resolved).toBe("/export/a-3.json");
  });

  it("adds .json when extension is missing", () => {
    const existing = new Set<string>();
    const resolved = resolveUniqueFilePath("/export", "config", (p) => existing.has(p));
    expect(resolved).toBe("/export/config.json");
  });
});
