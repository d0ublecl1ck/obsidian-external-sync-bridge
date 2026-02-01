import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { ensureCopyTargetCompatible } from "../src/fs-conflicts";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("ensureCopyTargetCompatible", () => {
  it("moves a symlink destination out of the way when source is a directory", async () => {
    const tmp = makeTempDir("external-sync-bridge-");
    try {
      const srcRoot = path.join(tmp, "src");
      const destRoot = path.join(tmp, "dest");
      fs.mkdirSync(srcRoot, { recursive: true });
      fs.mkdirSync(destRoot, { recursive: true });

      const srcDir = path.join(srcRoot, "agent-browser");
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, "SKILL.md"), "hello", "utf8");

      const destLink = path.join(destRoot, "agent-browser");
      fs.symlinkSync("../../.agents/skills/agent-browser", destLink);

      const result = await ensureCopyTargetCompatible({
        src: srcDir,
        dest: destLink,
        destBaseDir: destRoot,
        trashSessionDir: path.join(destRoot, ".trash", "external-sync-bridge", "test")
      });

      expect(result.moved).toBe(true);
      expect(fs.existsSync(destLink)).toBe(false);
      if (result.moved) {
        const movedStat = fs.lstatSync(result.to);
        expect(movedStat.isSymbolicLink()).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("moves a directory destination out of the way when source is a file", async () => {
    const tmp = makeTempDir("external-sync-bridge-");
    try {
      const srcRoot = path.join(tmp, "src");
      const destRoot = path.join(tmp, "dest");
      fs.mkdirSync(srcRoot, { recursive: true });
      fs.mkdirSync(destRoot, { recursive: true });

      const srcFile = path.join(srcRoot, "AGENTS.md");
      fs.writeFileSync(srcFile, "rules", "utf8");

      const destDir = path.join(destRoot, "AGENTS.md");
      fs.mkdirSync(destDir);

      const result = await ensureCopyTargetCompatible({
        src: srcFile,
        dest: destDir,
        destBaseDir: destRoot,
        trashSessionDir: path.join(destRoot, ".trash", "external-sync-bridge", "test")
      });

      expect(result.moved).toBe(true);
      expect(fs.existsSync(destDir)).toBe(false);
      if (result.moved) {
        const movedStat = fs.lstatSync(result.to);
        expect(movedStat.isDirectory()).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
