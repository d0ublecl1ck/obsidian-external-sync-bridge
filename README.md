# External Sync Bridge (Obsidian Plugin)

Backup external files or folders into a vault folder so they can be tracked by Git.

## Goal and Purpose

This project aims to provide a simple, desktop-only Obsidian plugin that pulls selected files or folders from outside a vault into a designated vault path. The purpose is to make those external files part of the vault, so they can be versioned and synced via existing Git workflows.

## What it does

- Configure one or more sync tasks.
- Each task copies a file or folder from outside the vault into a target folder inside the vault.
- Designed for desktop only (requires Node.js filesystem access).

## TODO（功能清单）

- [x] 插件入口与最小加载逻辑
- [x] 设置面板：任务列表、新增/编辑/删除、自动同步开关
- [x] 同步核心逻辑（外部 → Vault 内）
- [x] 路径选择器：文件/文件夹选择、Vault 内目标选择
- [x] 排除规则（glob）与默认规则
- [x] 排除规则测试/预览按钮
- [x] 增量判断（时间戳/哈希）减少无效复制
- [x] 设置页样式优化（styles.css）

## Development

```bash
npm install
npm run dev
```

Build output: `main.js`

## License

MIT
