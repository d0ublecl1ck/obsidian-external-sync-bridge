import { App, FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import * as fsExtra from "fs-extra";
import { createHash } from "crypto";
import micromatch from "micromatch";

type SyncTask = {
  id: string;
  name: string;
  sourcePath: string;
  targetPath: string;
  enabled: boolean;
};

type ExternalSyncSettings = {
  tasks: SyncTask[];
  autoSyncOnLoad: boolean;
  excludePatterns: string[];
  compareMode: "mtime" | "hash";
  scheduleEnabled: boolean;
  scheduleMode: "interval" | "daily";
  intervalMinutes: number;
  dailyTime: string;
};

const DEFAULT_SETTINGS: ExternalSyncSettings = {
  tasks: [],
  autoSyncOnLoad: false,
  excludePatterns: ["**/node_modules/**", "**/.DS_Store"],
  compareMode: "mtime",
  scheduleEnabled: false,
  scheduleMode: "interval",
  intervalMinutes: 60,
  dailyTime: "09:00"
};

export default class ExternalSyncBridgePlugin extends Plugin {
  settings: ExternalSyncSettings;
  private styleEl: HTMLStyleElement | null = null;
  private scheduleIntervalId: number | null = null;
  private scheduleTimeoutId: number | null = null;

  async onload() {
    await this.loadSettings();
    this.injectStyles();

    this.addRibbonIcon("sheets-in-box", "同步外部文件到 Vault", () => {
      this.syncAllTasks();
    });

    this.addCommand({
      id: "external-sync-bridge-sync-now",
      name: "立即同步外部文件",
      callback: () => {
        this.syncAllTasks();
      }
    });

    this.addSettingTab(new ExternalSyncSettingTab(this.app, this));

    this.setupSchedule();

    if (this.settings.autoSyncOnLoad) {
      this.syncAllTasks();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.setupSchedule();
  }

  exportSettings(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  async importSettings(json: string) {
    const parsed = JSON.parse(json) as ExternalSyncSettings;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
    this.normalizeSettings();
    await this.saveSettings();
  }

  private normalizeSettings() {
    const settings = this.settings;
    settings.tasks = Array.isArray(settings.tasks) ? settings.tasks : [];
    settings.excludePatterns = Array.isArray(settings.excludePatterns) ? settings.excludePatterns : [];
    settings.compareMode = settings.compareMode === "hash" ? "hash" : "mtime";
    settings.scheduleEnabled = Boolean(settings.scheduleEnabled);
    settings.scheduleMode = settings.scheduleMode === "daily" ? "daily" : "interval";
    settings.intervalMinutes = Number.isFinite(settings.intervalMinutes) ? settings.intervalMinutes : 60;
    settings.dailyTime = typeof settings.dailyTime === "string" ? settings.dailyTime : "09:00";
  }

  onunload() {
    this.clearSchedule();
    if (this.styleEl && this.styleEl.parentElement) {
      this.styleEl.parentElement.removeChild(this.styleEl);
      this.styleEl = null;
    }
  }

  private injectStyles() {
    const style = document.createElement("style");
    style.id = "external-sync-bridge-styles";
    style.textContent = this.loadStylesFromFile() ?? this.getDefaultStyles();
    document.head.appendChild(style);
    this.styleEl = style;
  }

  private loadStylesFromFile(): string | null {
    const vaultBasePath = this.getVaultBasePath();
    if (!vaultBasePath) {
      return null;
    }
    const pluginDir = path.join(vaultBasePath, this.app.vault.configDir, "plugins", this.manifest.id);
    const cssPath = path.join(pluginDir, "styles.css");
    if (!fs.existsSync(cssPath)) {
      return null;
    }
    try {
      return fs.readFileSync(cssPath, "utf8");
    } catch (error) {
      console.warn("[External Sync Bridge] 读取 styles.css 失败", error);
      return null;
    }
  }

  private getDefaultStyles(): string {
    return `
.external-sync-task-editor {
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--background-secondary);
}

.external-sync-inline-note {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
}

.external-sync-test-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.external-sync-test-row input {
  flex: 1;
}
`;
  }

  private clearSchedule() {
    if (this.scheduleIntervalId !== null) {
      window.clearInterval(this.scheduleIntervalId);
      this.scheduleIntervalId = null;
    }
    if (this.scheduleTimeoutId !== null) {
      window.clearTimeout(this.scheduleTimeoutId);
      this.scheduleTimeoutId = null;
    }
  }

  private setupSchedule() {
    this.clearSchedule();
    if (!this.settings.scheduleEnabled) {
      return;
    }

    if (this.settings.scheduleMode === "interval") {
      const minutes = Math.max(1, Number(this.settings.intervalMinutes) || 1);
      const intervalMs = minutes * 60 * 1000;
      this.scheduleIntervalId = window.setInterval(() => {
        this.syncAllTasks();
      }, intervalMs);
      return;
    }

    const dailyTime = this.settings.dailyTime || "09:00";
    const [hourStr, minuteStr] = dailyTime.split(":");
    const hour = Math.min(23, Math.max(0, Number(hourStr) || 0));
    const minute = Math.min(59, Math.max(0, Number(minuteStr) || 0));
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    this.scheduleTimeoutId = window.setTimeout(() => {
      this.syncAllTasks();
      this.scheduleIntervalId = window.setInterval(() => {
        this.syncAllTasks();
      }, 24 * 60 * 60 * 1000);
    }, delay);
  }

  getVaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getBasePath();
  }

  private validateTask(
    task: SyncTask,
    vaultBasePath: string
  ): { ok: true; source: string; target: string } | { ok: false; reason: string } {
    if (!task.sourcePath.trim()) {
      return { ok: false, reason: "源路径为空" };
    }
    if (!task.targetPath.trim()) {
      return { ok: false, reason: "目标路径为空" };
    }

    const source = path.normalize(task.sourcePath);
    if (!fs.existsSync(source)) {
      return { ok: false, reason: "源路径不存在" };
    }

    if (path.isAbsolute(task.targetPath)) {
      return { ok: false, reason: "目标路径必须是 Vault 内相对路径" };
    }

    const targetBase = path.normalize(task.targetPath);
    const targetAbs = path.join(vaultBasePath, targetBase);
    const rel = path.relative(vaultBasePath, targetAbs);
    if (rel.startsWith("..")) {
      return { ok: false, reason: "目标路径必须在 Vault 内" };
    }

    const sourceStat = fs.statSync(source);
    let finalTarget = targetAbs;
    if (sourceStat.isFile()) {
      const targetEndsWithSlash = task.targetPath.endsWith("/") || task.targetPath.endsWith(path.sep);
      if (targetEndsWithSlash || (fs.existsSync(targetAbs) && fs.statSync(targetAbs).isDirectory())) {
        finalTarget = path.join(targetAbs, path.basename(source));
      }
    } else if (sourceStat.isDirectory()) {
      if (fs.existsSync(targetAbs) && fs.statSync(targetAbs).isFile()) {
        return { ok: false, reason: "源为目录时目标不能是文件" };
      }
    }

    return { ok: true, source, target: finalTarget };
  }

  private async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("error", (error) => reject(error));
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async syncAllTasks() {
    const vaultBasePath = this.getVaultBasePath();
    if (!vaultBasePath) {
      new Notice("此插件仅支持桌面端文件系统适配器。");
      return;
    }

    const enabledTasks = this.settings.tasks.filter((task) => task.enabled);
    if (enabledTasks.length === 0) {
      new Notice("没有启用的同步任务。");
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const failures: string[] = [];

    for (const task of enabledTasks) {
      const result = await this.syncTaskInternal(task, vaultBasePath);
      if (result.ok) {
        successCount++;
      } else {
        failCount++;
        failures.push(`${task.name || task.id}: ${result.reason}`);
      }
    }

    if (successCount > 0) {
      new Notice(`同步完成：成功 ${successCount} 项，失败 ${failCount} 项。`);
    } else {
      new Notice(`同步失败：失败 ${failCount} 项。`);
    }

    if (failures.length > 0) {
      console.warn("[External Sync Bridge] 失败详情", failures);
      this.showFailureModal(failures);
    }
  }

  async syncSingleTask(task: SyncTask) {
    const vaultBasePath = this.getVaultBasePath();
    if (!vaultBasePath) {
      new Notice("此插件仅支持桌面端文件系统适配器。");
      return;
    }
    const result = await this.syncTaskInternal(task, vaultBasePath);
    if (result.ok) {
      new Notice(`任务同步成功：${task.name || task.id}`);
    } else {
      new Notice(`任务同步失败：${task.name || task.id}`);
      this.showFailureModal([`${task.name || task.id}: ${result.reason}`]);
    }
  }

  private async syncTaskInternal(
    task: SyncTask,
    vaultBasePath: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const validation = this.validateTask(task, vaultBasePath);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    const source = validation.source;
    const target = validation.target;

    try {
      const targetDir = path.dirname(target);
      await fsExtra.ensureDir(targetDir);
      const excludePatterns = this.settings.excludePatterns;
      const sourceRoot = source;
      const compareMode = this.settings.compareMode;

      await fsExtra.copy(source, target, {
        overwrite: true,
        preserveTimestamps: true,
        filter: async (src, dest) => {
          const rel = path.relative(sourceRoot, src);
          if (!rel || rel === "") return true;

          const relPosix = rel.split(path.sep).join("/");
          if (excludePatterns.length > 0 && micromatch.isMatch(relPosix, excludePatterns, { dot: true })) {
            return false;
          }

          try {
            const srcStat = await fs.promises.stat(src);
            if (srcStat.isDirectory()) {
              return true;
            }
            if (fs.existsSync(dest)) {
              const destStat = await fs.promises.stat(dest);
              if (destStat.isFile()) {
                if (compareMode === "hash") {
                  const [srcHash, destHash] = await Promise.all([
                    this.hashFile(src),
                    this.hashFile(dest)
                  ]);
                  if (srcHash === destHash) {
                    return false;
                  }
                } else {
                  const sameSize = destStat.size === srcStat.size;
                  const sameMtime = Math.floor(destStat.mtimeMs) === Math.floor(srcStat.mtimeMs);
                  if (sameSize && sameMtime) {
                    return false;
                  }
                }
              }
            }
          } catch (error) {
            console.warn(`[External Sync Bridge] 过滤判断失败: ${src}`, error);
          }
          return true;
        }
      });
      return { ok: true };
    } catch (error) {
      console.error(`[External Sync Bridge] 同步失败: ${task.name}`, error);
      return { ok: false, reason: "同步失败" };
    }
  }

  private showFailureModal(failures: string[]) {
    class FailureModal extends Modal {
      private items: string[];
      constructor(app: App, items: string[]) {
        super(app);
        this.items = items;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "同步失败详情" });
        const list = contentEl.createEl("ul");
        for (const item of this.items) {
          const li = list.createEl("li");
          li.setText(item);
        }
        const copyButton = contentEl.createEl("button", { text: "复制到剪贴板" });
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(this.items.join("\n"));
            new Notice("已复制失败详情");
          } catch (error) {
            new Notice("复制失败");
          }
        });
      }
      onClose() {
        const { contentEl } = this;
        contentEl.empty();
      }
    }
    new FailureModal(this.app, failures).open();
  }

  showExportModal() {
    class ExportModal extends Modal {
      private value: string;
      constructor(app: App, value: string) {
        super(app);
        this.value = value;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "导出配置 JSON" });
        const textarea = contentEl.createEl("textarea");
        textarea.value = this.value;
        textarea.rows = 16;
        textarea.style.width = "100%";
        const actions = contentEl.createEl("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        const copyButton = actions.createEl("button", { text: "复制到剪贴板" });
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(this.value);
            new Notice("已复制配置 JSON");
          } catch {
            new Notice("复制失败");
          }
        });
        const closeButton = actions.createEl("button", { text: "关闭" });
        closeButton.addEventListener("click", () => this.close());
      }
      onClose() {
        this.contentEl.empty();
      }
    }
    new ExportModal(this.app, this.exportSettings()).open();
  }

  showImportModal() {
    const plugin = this;
    class ImportModal extends Modal {
      private textarea?: HTMLTextAreaElement;
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "导入配置 JSON" });
        const textarea = contentEl.createEl("textarea");
        textarea.rows = 16;
        textarea.style.width = "100%";
        textarea.placeholder = "粘贴导出的 JSON 配置...";
        this.textarea = textarea;
        const actions = contentEl.createEl("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        const importButton = actions.createEl("button", { text: "导入并覆盖" });
        importButton.addEventListener("click", async () => {
          const value = this.textarea?.value?.trim() ?? "";
          if (!value) {
            new Notice("请先粘贴 JSON");
            return;
          }
          this.close();
          plugin.showImportConfirmModal(value);
        });
        const closeButton = actions.createEl("button", { text: "取消" });
        closeButton.addEventListener("click", () => this.close());
      }
      onClose() {
        this.contentEl.empty();
      }
    }
    new ImportModal(this.app).open();
  }

  private showImportConfirmModal(json: string) {
    const plugin = this;
    class ConfirmModal extends Modal {
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "确认导入并覆盖现有配置？" });
        contentEl.createEl("p", { text: "当前配置将被导入配置强制覆盖，且无法撤销。" });
        const actions = contentEl.createEl("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        const confirmButton = actions.createEl("button", { text: "确认覆盖" });
        confirmButton.addEventListener("click", async () => {
          try {
            await plugin.importSettings(json);
            new Notice("配置导入成功");
            this.close();
          } catch (error) {
            console.error("[External Sync Bridge] 导入失败", error);
            new Notice("导入失败，请检查 JSON 格式");
          }
        });
        const cancelButton = actions.createEl("button", { text: "取消" });
        cancelButton.addEventListener("click", () => this.close());
      }
      onClose() {
        this.contentEl.empty();
      }
    }
    new ConfirmModal(this.app).open();
  }
}

class ExternalSyncSettingTab extends PluginSettingTab {
  plugin: ExternalSyncBridgePlugin;

  constructor(app: App, plugin: ExternalSyncBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "External Sync Bridge" });

    new Setting(containerEl)
      .setName("启动时自动同步")
      .setDesc("打开 Obsidian 时自动执行所有启用的同步任务")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncOnLoad)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncOnLoad = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("一键同步")
      .setDesc("立即执行所有启用的同步任务")
      .addButton((button) =>
        button.setButtonText("同步全部").setCta().onClick(() => {
          this.plugin.syncAllTasks();
        })
      );

    new Setting(containerEl)
      .setName("配置导入/导出")
      .setDesc("导出当前配置或导入 JSON 覆盖配置")
      .addButton((button) =>
        button.setButtonText("导出").onClick(() => {
          this.plugin.showExportModal();
        })
      )
      .addButton((button) =>
        button.setButtonText("导入").onClick(() => {
          this.plugin.showImportModal();
        })
      );

    new Setting(containerEl)
      .setName("定时同步")
      .setDesc("启用后按指定时间自动同步")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.scheduleEnabled).onChange(async (value) => {
          this.plugin.settings.scheduleEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.scheduleEnabled) {
      new Setting(containerEl)
        .setName("同步方式")
        .setDesc("间隔同步或每天固定时间同步")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("interval", "间隔")
            .addOption("daily", "每天固定时间")
            .setValue(this.plugin.settings.scheduleMode)
            .onChange(async (value) => {
              this.plugin.settings.scheduleMode = value as "interval" | "daily";
              await this.plugin.saveSettings();
              this.display();
            })
        );

      if (this.plugin.settings.scheduleMode === "interval") {
        new Setting(containerEl)
          .setName("间隔（分钟）")
          .setDesc("至少 1 分钟")
          .addText((text) =>
            text.setValue(String(this.plugin.settings.intervalMinutes)).onChange(async (value) => {
              const minutes = Number(value);
              this.plugin.settings.intervalMinutes = Number.isFinite(minutes) ? minutes : 1;
              await this.plugin.saveSettings();
            })
          );
      } else {
        new Setting(containerEl)
          .setName("每日时间")
          .setDesc("24 小时制，例如 09:00 或 21:30")
          .addText((text) =>
            text.setValue(this.plugin.settings.dailyTime).onChange(async (value) => {
              this.plugin.settings.dailyTime = value;
              await this.plugin.saveSettings();
            })
          );
      }
    }

    new Setting(containerEl)
      .setName("增量判断方式")
      .setDesc("mtime 表示按修改时间与大小跳过，hash 更准确但更慢")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mtime", "mtime（大小 + 修改时间）")
          .addOption("hash", "hash（SHA-256）")
          .setValue(this.plugin.settings.compareMode)
          .onChange(async (value) => {
            this.plugin.settings.compareMode = value as "mtime" | "hash";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("排除规则")
      .setDesc("每行一个 glob 规则，如 **/node_modules/** 或 **/.DS_Store")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.excludePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.saveSettings();
          })
      );

    const testWrapper = containerEl.createDiv();
    testWrapper.addClass("external-sync-test-row");
    const testInput = testWrapper.createEl("input", {
      type: "text",
      placeholder: "输入要测试的路径（相对源目录）"
    });
    const testSelect = testWrapper.createEl("select");
    const emptyOption = testSelect.createEl("option", { text: "选择源任务（可选）" });
    emptyOption.value = "";
    this.plugin.settings.tasks.forEach((task) => {
      const option = testSelect.createEl("option", { text: task.name || task.id });
      option.value = task.id;
    });
    const testButton = testWrapper.createEl("button", { text: "测试排除规则" });
    const pickFileButton = testWrapper.createEl("button", { text: "选择文件" });
    const pickFolderButton = testWrapper.createEl("button", { text: "选择文件夹" });
    const testNote = containerEl.createDiv();
    testNote.addClass("external-sync-inline-note");
    testNote.setText("示例：node_modules/react/index.js");

    testButton.addEventListener("click", () => {
      const value = testInput.value.trim();
      if (!value) {
        new Notice("请先输入要测试的路径。");
        return;
      }
      const relPosix = value.split(path.sep).join("/");
      const matched = micromatch.isMatch(relPosix, this.plugin.settings.excludePatterns, { dot: true });
      if (matched) {
        new Notice("该路径会被排除。");
      } else {
        new Notice("该路径不会被排除。");
      }
    });

    const resolveRelative = (absolute: string) => {
      const selectedTaskId = testSelect.value;
      const task = this.plugin.settings.tasks.find((t) => t.id === selectedTaskId);
      if (!task || !task.sourcePath) {
        return absolute;
      }
      const source = path.normalize(task.sourcePath);
      let base = source;
      try {
        const stat = fs.statSync(source);
        if (stat.isFile()) {
          base = path.dirname(source);
        }
      } catch {
        return absolute;
      }
      const rel = path.relative(base, absolute);
      if (rel.startsWith("..")) {
        return absolute;
      }
      return rel.split(path.sep).join("/");
    };

    pickFileButton.addEventListener("click", async () => {
      const selected = await this.pickExternalPath("file");
      if (selected) {
        testInput.value = resolveRelative(selected);
      }
    });

    pickFolderButton.addEventListener("click", async () => {
      const selected = await this.pickExternalPath("folder");
      if (selected) {
        testInput.value = resolveRelative(selected);
      }
    });

    containerEl.createEl("h3", { text: "同步任务" });

    const tasksContainer = containerEl.createDiv();
    if (this.plugin.settings.tasks.length === 0) {
      tasksContainer.createEl("p", { text: "暂无任务，请点击下方添加。" });
    }

    this.plugin.settings.tasks.forEach((task, index) => {
      const setting = new Setting(tasksContainer)
        .setName(task.name || `任务 ${index + 1}`)
        .setDesc(`源: ${task.sourcePath || "(未填写)"} → 目标: ${task.targetPath || "(未填写)"}`);

      setting.addButton((button) => {
        button.setButtonText("立即同步");
        button.onClick(() => {
          this.plugin.syncSingleTask(task);
        });
      });

      setting.addToggle((toggle) =>
        toggle.setValue(task.enabled).onChange(async (value) => {
          task.enabled = value;
          await this.plugin.saveSettings();
        })
      );

      setting.addExtraButton((button) => {
        button.setIcon("pencil");
        button.setTooltip("编辑");
        button.onClick(() => {
          this.openTaskEditorModal(task);
        });
      });

      setting.addExtraButton((button) => {
        button.setIcon("trash");
        button.setTooltip("删除");
        button.onClick(async () => {
          this.openDeleteConfirmModal(task, index);
        });
      });
    });

    new Setting(containerEl)
      .setName("添加任务")
      .setDesc("创建一个新的同步任务")
      .addButton((button) =>
        button.setButtonText("新增").onClick(async () => {
          const task: SyncTask = {
            id: crypto.randomUUID(),
            name: "",
            sourcePath: "",
            targetPath: "",
            enabled: true
          };
          this.plugin.settings.tasks.push(task);
          await this.plugin.saveSettings();
          this.openTaskEditorModal(task, true);
          this.display();
        })
      );
  }

  private openTaskEditorModal(task: SyncTask, isNew = false) {
    const plugin = this.plugin;
    const tab = this;
    class TaskEditorModal extends Modal {
      private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: isNew ? "新建同步任务" : "编辑同步任务" });

        new Setting(contentEl)
          .setName("任务名称")
          .addText((text) =>
            text.setValue(task.name).onChange(async (value) => {
              task.name = value;
              await plugin.saveSettings();
            })
          );

        new Setting(contentEl)
          .setName("源路径")
          .setDesc("电脑上的文件或文件夹绝对路径")
          .addText((text) =>
            text.setValue(task.sourcePath).onChange(async (value) => {
              task.sourcePath = value;
              await plugin.saveSettings();
            })
          )
          .addExtraButton((button) => {
            button.setIcon("file-plus");
            button.setTooltip("选择文件");
            button.onClick(async () => {
              const selected = await tab.pickExternalPath("file");
              if (selected) {
                task.sourcePath = selected;
                await plugin.saveSettings();
                this.render();
              }
            });
          })
          .addExtraButton((button) => {
            button.setIcon("folder-plus");
            button.setTooltip("选择文件夹");
            button.onClick(async () => {
              const selected = await tab.pickExternalPath("folder");
              if (selected) {
                task.sourcePath = selected;
                await plugin.saveSettings();
                this.render();
              }
            });
          });

        new Setting(contentEl)
          .setName("目标路径")
          .setDesc("Vault 内相对路径，例如 Backups/VSCode/settings.json")
          .addText((text) =>
            text.setValue(task.targetPath).onChange(async (value) => {
              task.targetPath = value;
              await plugin.saveSettings();
            })
          )
          .addExtraButton((button) => {
            button.setIcon("folder-plus");
            button.setTooltip("选择 Vault 内目标文件夹");
            button.onClick(async () => {
              const selected = await tab.pickVaultPath("folder");
              if (selected) {
                task.targetPath = selected;
                await plugin.saveSettings();
                this.render();
              }
            });
          })
          .addExtraButton((button) => {
            button.setIcon("file-plus");
            button.setTooltip("选择 Vault 内目标文件");
            button.onClick(async () => {
              const selected = await tab.pickVaultPath("file");
              if (selected) {
                task.targetPath = selected;
                await plugin.saveSettings();
                this.render();
              }
            });
          });

        new Setting(contentEl)
          .setName("启用")
          .addToggle((toggle) =>
            toggle.setValue(task.enabled).onChange(async (value) => {
              task.enabled = value;
              await plugin.saveSettings();
            })
          );

        new Setting(contentEl)
          .setName("完成")
          .addButton((button) =>
            button.setButtonText("关闭").setCta().onClick(() => {
              this.close();
            })
          );
      }

      onOpen() {
        this.render();
      }

      onClose() {
        const { contentEl } = this;
        contentEl.empty();
        tab.display();
      }
    }

    new TaskEditorModal(this.app).open();
  }

  private getElectronDialog(): { showOpenDialog: Function } | null {
    try {
      const electron = (window as any).require?.("electron");
      if (!electron) return null;
      return electron.dialog || electron.remote?.dialog || null;
    } catch (error) {
      console.error("[External Sync Bridge] 无法访问 electron dialog", error);
      return null;
    }
  }

  private async pickExternalPath(kind: "file" | "folder"): Promise<string | null> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("无法打开系统选择器。");
      return null;
    }

    const properties = kind === "file" ? ["openFile"] : ["openDirectory"];
    const result = await dialog.showOpenDialog({ properties });
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    return result.filePaths[0];
  }

  private async pickVaultPath(kind: "file" | "folder"): Promise<string | null> {
    if (kind === "folder") {
      return this.pickVaultFolderModal();
    }

    const dialog = this.getElectronDialog();
    const vaultBasePath = this.plugin.getVaultBasePath();
    if (!dialog || !vaultBasePath) {
      new Notice("无法打开 Vault 目录选择器。");
      return null;
    }

    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      defaultPath: vaultBasePath
    });
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }

    const selected = result.filePaths[0];
    const rel = path.relative(vaultBasePath, selected);
    if (rel.startsWith("..")) {
      new Notice("请选择 Vault 内的文件。");
      return null;
    }
    return rel.split(path.sep).join("/");
  }

  private async pickVaultFolderModal(): Promise<string | null> {
    const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder) as TFolder[];
    const sorted = folders.sort((a, b) => a.path.localeCompare(b.path));
    return new Promise((resolve) => {
      class VaultFolderModal extends Modal {
        private selected: string | null = null;
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: "选择 Vault 内文件夹" });

          const searchInput = contentEl.createEl("input", { type: "text" });
          searchInput.placeholder = "搜索文件夹（模糊匹配）";

          const list = contentEl.createEl("div");
          list.addClass("external-sync-vault-list");
          list.style.maxHeight = "240px";
          list.style.overflowY = "auto";
          list.style.border = "1px solid var(--background-modifier-border)";
          list.style.borderRadius = "6px";
          list.style.padding = "6px";

          const renderList = (query: string) => {
            list.empty();
            const q = query.trim().toLowerCase();
            const items = q
              ? sorted.filter((folder) => folder.path.toLowerCase().includes(q))
              : sorted;
            items.forEach((folder) => {
              const row = list.createEl("div");
              row.style.padding = "6px";
              row.style.cursor = "pointer";
              row.setText(folder.path || "/");
              if (this.selected === folder.path) {
                row.style.background = "var(--background-modifier-hover)";
              }
              row.addEventListener("click", () => {
                this.selected = folder.path;
                const nodes = list.querySelectorAll("div");
                nodes.forEach((el) => (el as HTMLElement).style.background = "");
                row.style.background = "var(--background-modifier-hover)";
              });
            });
          };

          renderList("");
          searchInput.addEventListener("input", () => {
            renderList(searchInput.value);
          });

          const createWrapper = contentEl.createEl("div");
          createWrapper.style.display = "flex";
          createWrapper.style.gap = "8px";
          createWrapper.style.marginTop = "12px";
          const input = createWrapper.createEl("input", { type: "text" });
          input.placeholder = "新建文件夹路径，如 Backups/Configs";
          const createButton = createWrapper.createEl("button", { text: "创建并选择" });
          createButton.addEventListener("click", async () => {
            const value = input.value.trim();
            if (!value) {
              new Notice("请输入文件夹路径");
              return;
            }
            try {
              await this.app.vault.createFolder(value);
              this.selected = value;
              this.close();
            } catch (error) {
              new Notice("创建失败，请检查路径是否有效");
            }
          });

          const actions = contentEl.createEl("div");
          actions.style.display = "flex";
          actions.style.gap = "8px";
          actions.style.marginTop = "12px";
          const confirmButton = actions.createEl("button", { text: "确认选择" });
          confirmButton.addEventListener("click", () => {
            if (!this.selected) {
              new Notice("请先选择一个文件夹");
              return;
            }
            this.close();
          });
          const cancelButton = actions.createEl("button", { text: "取消" });
          cancelButton.addEventListener("click", () => {
            this.selected = null;
            this.close();
          });
        }
        onClose() {
          resolve(this.selected);
          this.contentEl.empty();
        }
      }
      new VaultFolderModal(this.app).open();
    });
  }

  private openDeleteConfirmModal(task: SyncTask, index: number) {
    const plugin = this.plugin;
    const tab = this;
    class DeleteConfirmModal extends Modal {
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "确认删除任务？" });
        contentEl.createEl("p", { text: `将删除任务：${task.name || task.id}` });
        const actions = contentEl.createEl("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        const confirmButton = actions.createEl("button", { text: "确认删除" });
        confirmButton.addEventListener("click", async () => {
          plugin.settings.tasks.splice(index, 1);
          await plugin.saveSettings();
          this.close();
        });
        const cancelButton = actions.createEl("button", { text: "取消" });
        cancelButton.addEventListener("click", () => this.close());
      }
      onClose() {
        this.contentEl.empty();
        tab.display();
      }
    }
    new DeleteConfirmModal(this.app).open();
  }
}
