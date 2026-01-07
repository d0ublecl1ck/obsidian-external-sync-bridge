# External Sync Bridge (Obsidian Plugin)

将 Vault 外的文件/文件夹同步到 Vault 内指定目录，配合 Git 做统一备份与版本管理。

> 最佳搭配：与 Obsidian Git 插件一起使用（自动提交/推送），实现「外部 → Vault → Git」的闭环。

## 适用场景

- 备份系统配置文件、脚本、项目配置等
- 把散落在系统中的文件收口到 Obsidian
- 需要单向同步（外部 → Vault）并交给 Git 管理历史

## 功能一览

- 多任务配置（源路径 → 目标路径）
- 单任务立即同步 / 一键同步全部
- 定时同步：间隔分钟 / 每天固定时间
- 排除规则（glob）+ 排除规则测试
- 增量判断：mtime 或 hash（SHA-256）
- 导入/导出配置 JSON
- 任务删除二次确认
- Vault 内目标文件夹选择器（支持模糊搜索 & 新建文件夹）

## 使用方式

1. 在设置中添加同步任务（源路径、目标路径）
2. 点击「立即同步」或「同步全部」
3. 若启用定时同步，将按配置自动执行

## 与 Obsidian Git 联动（推荐）

搭配 Obsidian Git 插件可实现自动提交/推送，形成完整备份链路。

- Obsidian Git 仓库：
  `https://github.com/Vinzent03/obsidian-git`

## 安装（本地测试）

1. 将插件文件放到：`.obsidian/plugins/external-sync-bridge/`
2. 文件包含：`manifest.json`、`main.js`、`styles.css`
3. 在 Obsidian 中启用插件

## 注意事项

- 仅支持桌面端（依赖 Node.js 文件系统能力）
- 默认是“外部 → Vault 内”的单向同步
- 目标路径建议规划到独立备份文件夹，便于 Git 管理

## 开发

```bash
npm install
npm run dev
```

Build output: `main.js`

## License

MIT
