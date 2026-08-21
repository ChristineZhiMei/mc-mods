import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gitmodulesPath = resolve(rootDir, '.gitmodules');
const command = process.argv[2];

function printUsage() {
  console.log(`用法：
  pnpm repos:init    克隆缺失的仓库，跳过已经存在的仓库
  pnpm repos:update  克隆缺失的仓库，并更新已经存在的仓库`);
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw new Error(`无法执行 Git：${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim();
    throw new Error(detail || `Git 命令执行失败：git ${args.join(' ')}`);
  }

  return result;
}

function readRepositories() {
  if (!existsSync(gitmodulesPath)) {
    throw new Error(`未找到配置文件：${gitmodulesPath}`);
  }

  const repositories = [];
  let current;

  for (const line of readFileSync(gitmodulesPath, 'utf8').split(/\r?\n/)) {
    const section = line.match(/^\s*\[submodule\s+"(.+)"\]\s*$/);
    if (section) {
      current = { name: section[1] };
      repositories.push(current);
      continue;
    }

    const property = line.match(/^\s*(path|url)\s*=\s*(.+?)\s*$/);
    if (current && property) {
      current[property[1]] = property[2];
    }
  }

  for (const repository of repositories) {
    if (!repository.path || !repository.url) {
      throw new Error(`子仓库 ${repository.name} 缺少 path 或 url 配置`);
    }

    const absolutePath = resolve(rootDir, repository.path);
    const pathFromRoot = relative(rootDir, absolutePath);
    if (pathFromRoot.startsWith('..') || pathFromRoot === '') {
      throw new Error(`子仓库路径必须位于根仓库内：${repository.path}`);
    }

    repository.absolutePath = absolutePath;
  }

  return repositories;
}

function isGitRepository(path) {
  const result = runGit(['-C', path, 'rev-parse', '--is-inside-work-tree'], {
    capture: true,
    allowFailure: true,
  });
  return result.status === 0;
}

function cloneRepository(repository) {
  if (existsSync(repository.absolutePath)) {
    if (!statSync(repository.absolutePath).isDirectory()) {
      throw new Error(`目标路径不是目录：${repository.path}`);
    }
    if (!isGitRepository(repository.absolutePath)) {
      throw new Error(`目标目录已存在但不是 Git 仓库：${repository.path}`);
    }

    console.log(`跳过 ${repository.path}：仓库已存在`);
    return false;
  }

  mkdirSync(dirname(repository.absolutePath), { recursive: true });
  console.log(`克隆 ${repository.path}`);
  runGit(['clone', '--recurse-submodules', repository.url, repository.absolutePath]);
  return true;
}

function updateRepository(repository) {
  if (!existsSync(repository.absolutePath)) {
    cloneRepository(repository);
    return;
  }

  if (!isGitRepository(repository.absolutePath)) {
    throw new Error(`目标目录已存在但不是 Git 仓库：${repository.path}`);
  }

  const status = runGit(['status', '--porcelain'], {
    cwd: repository.absolutePath,
    capture: true,
  }).stdout.trim();

  if (status) {
    throw new Error(`仓库存在未提交改动，已停止更新：${repository.path}`);
  }

  console.log(`更新 ${repository.path}`);
  runGit(['pull', '--ff-only'], { cwd: repository.absolutePath });
  runGit(['submodule', 'update', '--init', '--recursive'], {
    cwd: repository.absolutePath,
  });
}

if (!['init', 'update'].includes(command)) {
  printUsage();
  process.exitCode = 1;
} else {
  try {
    runGit(['--version'], { capture: true });
    const repositories = readRepositories();

    if (repositories.length === 0) {
      throw new Error('.gitmodules 中没有配置任何子仓库');
    }

    for (const repository of repositories) {
      if (command === 'init') {
        cloneRepository(repository);
      } else {
        updateRepository(repository);
      }
    }

    console.log(`完成：共处理 ${repositories.length} 个仓库`);
  } catch (error) {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  }
}
