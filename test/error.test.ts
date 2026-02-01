import { describe, expect, it } from "vitest";
import { formatErrorReason, formatErrorReasonForNotice } from "../src/error";

describe("formatErrorReason", () => {
  it("humanizes common errno codes and strips leading code from message", () => {
    const err = Object.assign(
      new Error("EACCES: permission denied, copyfile '/a' -> '/b'"),
      { code: "EACCES" }
    );

    const reason = formatErrorReason(err);
    expect(reason).toMatch(/^权限不足（EACCES）/);
    expect(reason).toContain("permission denied");
    expect(reason).not.toContain("EACCES:");
  });

  it("returns a reasonable message when code exists but message has no leading code", () => {
    const err = Object.assign(new Error("no such file or directory, open '/a'"), { code: "ENOENT" });

    const reason = formatErrorReason(err);
    expect(reason).toMatch(/^路径不存在（ENOENT）/);
    expect(reason).toContain("no such file or directory");
  });

  it("handles nested causes", () => {
    const cause = Object.assign(new Error("ENOENT: no such file or directory, open '/a'"), { code: "ENOENT" });
    const err = Object.assign(new Error("EACCES: permission denied, open '/b'"), { code: "EACCES", cause });

    const reason = formatErrorReason(err);
    expect(reason).toContain("原因：路径不存在（ENOENT）");
  });

  it("handles string errors", () => {
    expect(formatErrorReason("  boom  ")).toBe("boom");
  });
});

describe("formatErrorReasonForNotice", () => {
  it("truncates long text for toast notices", () => {
    const long = "x".repeat(200);
    const reason = formatErrorReasonForNotice(long, 20);
    expect(reason.length).toBeLessThanOrEqual(20);
    expect(reason.endsWith("…")).toBe(true);
  });
});
