# mc-mods

Minecraft 模组集合。各模组仓库统一存放在 `packages/` 目录，并通过根目录的
`.gitmodules` 维护仓库地址。

## 环境要求

- Node.js 18 或更高版本
- pnpm 9
- Git
- GitHub CLI（仅自动发布需要）
- 已配置可访问 GitHub 的 SSH Key

## 拉取仓库

首次克隆根仓库后，安装 pnpm（如本机尚未安装），然后执行：

```bash
pnpm repos:init
```

该命令读取 `.gitmodules`，克隆 `packages/` 下缺失的仓库；已经存在的仓库会被跳过。

## 更新仓库

```bash
pnpm repos:update
```

该命令会：

1. 克隆本地缺失的仓库；
2. 对已有仓库的当前分支执行 `git pull --ff-only`；
3. 初始化并更新各仓库自身的递归子模块。

为避免覆盖本地工作，仓库存在未提交改动时会停止更新。请先提交、还原或妥善处理
相关改动，再重新运行命令。

## 添加新仓库

在 `.gitmodules` 中增加子仓库的 `path` 和 `url` 配置后，重新运行
`pnpm repos:init` 即可，无需修改 Node.js 脚本。

## 自动发布模组

每个子仓库通过 GitHub Actions 独立构建并发布自己的 GitHub Release，根仓库只负责
选择目标仓库和触发工作流。这样无需在根仓库配置可访问所有子仓库的发布令牌。

首次使用前，通过 GitHub CLI 登录：

```bash
gh auth login
```

查看可发布的子仓库：

```bash
pnpm repo:release -- --list
```

选择一个子仓库并等待构建、发布完成：

```bash
pnpm repo:release -- mc-better-experience
```

调度脚本会动态查询子仓库的默认分支，校验其中存在 `release.yml`，然后触发 Action。
还可以使用以下选项：

```bash
# 只校验仓库和工作流，不触发发布
pnpm repo:release -- mc-better-experience --dry-run

# 触发后立即返回，不等待 Action 完成
pnpm repo:release -- mc-better-experience --no-wait
```

发布前需要先在目标子仓库的 `gradle.properties` 中更新 `mod_version`，并将变更合并到
该子仓库默认分支。Action 会使用 Java 21 执行 Gradle 构建，以 `v<mod_version>` 创建
Tag 和 GitHub Release，并上传主 JAR；版本对应的 Release 已存在时会直接失败，避免
覆盖历史产物。如果 Tag 已由此前失败的发布创建且仍指向同一提交，重新运行可以继续
完成 Release。

GitHub Actions 的 `GITHUB_TOKEN` 只作用于当前子仓库，因此发布完成后不会自动修改
根仓库记录的子仓库提交。需要同步引用时，请执行 `pnpm repos:update`，检查变更后再
单独提交根仓库。
