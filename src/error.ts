type NodeLikeError = {
  name?: string;
  message?: string;
  code?: string;
  errno?: number;
  path?: string;
  dest?: string;
  syscall?: string;
  cause?: unknown;
};

const ERROR_CODE_HINTS: Record<string, string> = {
  EACCES: "权限不足",
  EPERM: "权限不足",
  ENOENT: "路径不存在",
  EISDIR: "遇到目录（需要文件）",
  ENOTDIR: "遇到文件（需要目录）",
  ENOSPC: "磁盘空间不足",
  EROFS: "目标文件系统只读",
  ENOTEMPTY: "目录非空",
  EEXIST: "目标已存在",
  ENAMETOOLONG: "路径过长",
  EMFILE: "打开文件过多",
  ENFILE: "系统打开文件过多",
  EBUSY: "文件被占用",
  EXDEV: "跨设备操作不支持"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNodeLikeError(error: unknown): NodeLikeError | null {
  if (!isRecord(error)) {
    return null;
  }
  const nodeError: NodeLikeError = {};
  if (typeof error.name === "string") nodeError.name = error.name;
  if (typeof error.message === "string") nodeError.message = error.message;
  if (typeof error.code === "string") nodeError.code = error.code;
  if (typeof error.errno === "number") nodeError.errno = error.errno;
  if (typeof error.path === "string") nodeError.path = error.path;
  if (typeof error.dest === "string") nodeError.dest = error.dest;
  if (typeof error.syscall === "string") nodeError.syscall = error.syscall;
  if ("cause" in error) nodeError.cause = error.cause;
  return nodeError;
}

function stripLeadingCode(message: string, code: string | undefined): string {
  if (!code) {
    return message.trim();
  }
  const trimmed = message.trim();
  if (trimmed.startsWith(`${code}:`)) {
    return trimmed.slice(code.length + 1).trim();
  }
  return trimmed;
}

function truncate(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatErrorReasonInternal(error: unknown, depth: number): string {
  if (depth > 2) {
    return "（错误链过深，已截断）";
  }

  if (typeof error === "string") {
    return error.trim() || "未知错误";
  }

  const info = asNodeLikeError(error);
  if (!info) {
    return "未知错误";
  }

  const code = info.code;
  const hint = code ? ERROR_CODE_HINTS[code] : undefined;
  const message = info.message ? stripLeadingCode(info.message, code) : undefined;

  const header = hint && code ? `${hint}（${code}）` : code ? `错误码 ${code}` : undefined;
  const main = message || info.name;

  let reason = "";
  if (header && main) {
    reason = `${header}：${main}`;
  } else if (header) {
    reason = header;
  } else if (main) {
    reason = main;
  } else {
    reason = "未知错误";
  }

  if (info.cause) {
    const causeReason = formatErrorReasonInternal(info.cause, depth + 1);
    if (causeReason && causeReason !== "未知错误") {
      reason = `${reason}；原因：${causeReason}`;
    }
  }

  return reason;
}

export function formatErrorReason(error: unknown): string {
  return formatErrorReasonInternal(error, 0);
}

export function formatErrorReasonForNotice(error: unknown, maxLength = 120): string {
  return truncate(formatErrorReason(error), maxLength);
}
