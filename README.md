# mc-mods

Minecraft 模组集合。各模组仓库统一存放在 `packages/` 目录，并通过根目录的
`.gitmodules` 维护仓库地址。

## 环境要求

- Node.js 18 或更高版本
- pnpm 9
- Git
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
