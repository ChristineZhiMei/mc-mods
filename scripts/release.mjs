import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gitmodulesPath = resolve(rootDir, '.gitmodules');
const workflowFile = 'release.yml';
const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');

function printUsage() {
  console.log(`用法：
  pnpm repo:release -- --list
  pnpm repo:release -- <子仓库名称> [--dry-run] [--no-wait]

选项：
  --list      列出可发布的子仓库
  --dry-run   校验仓库与工作流，但不触发发布
  --no-wait   触发后立即返回，不等待 Action 完成
  --help      显示帮助`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  });

  if (result.error) {
    throw new Error(`无法执行 ${command}：${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(detail || `${command} ${args.join(' ')} 执行失败`);
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

  return repositories.map((repository) => {
    if (!repository.path || !repository.url) {
      throw new Error(`子仓库 ${repository.name} 缺少 path 或 url 配置`);
    }

    const sshMatch = repository.url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
    const httpsMatch = repository.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    const slug = sshMatch?.[1] || httpsMatch?.[1];
    if (!slug) {
      throw new Error(`暂不支持非 GitHub 仓库地址：${repository.url}`);
    }

    return {
      ...repository,
      slug,
      shortName: basename(repository.path),
    };
  });
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function findTriggeredRun(repository, runTitle) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = run('gh', [
      'run',
      'list',
      '--repo',
      repository.slug,
      '--workflow',
      workflowFile,
      '--event',
      'workflow_dispatch',
      '--limit',
      '30',
      '--json',
      'databaseId,displayTitle,url,status,conclusion',
    ]);
    const runs = JSON.parse(result.stdout || '[]');
    const matchingRun = runs.find((item) => item.displayTitle === runTitle);
    if (matchingRun) {
      return matchingRun;
    }

    if (attempt < 30) {
      sleep(1000);
    }
  }

  throw new Error(`已触发工作流，但 30 秒内未找到对应运行：${runTitle}`);
}

try {
  const repositories = readRepositories();
  if (repositories.length === 0) {
    throw new Error('.gitmodules 中没有配置任何子仓库');
  }

  if (arguments_.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  if (arguments_.includes('--list')) {
    for (const repository of repositories) {
      console.log(`${repository.shortName}\t${repository.slug}`);
    }
    process.exit(0);
  }

  const supportedFlags = new Set(['--dry-run', '--no-wait']);
  const unknownFlags = arguments_.filter(
    (argument) => argument.startsWith('-') && !supportedFlags.has(argument),
  );
  if (unknownFlags.length > 0) {
    throw new Error(`未知选项：${unknownFlags.join(', ')}`);
  }

  const selectors = arguments_.filter((argument) => !argument.startsWith('-'));
  if (selectors.length !== 1) {
    printUsage();
    throw new Error('请指定一个子仓库名称');
  }

  const selector = selectors[0];
  const repository = repositories.find(
    (item) => item.shortName === selector || item.name === selector || item.slug === selector,
  );
  if (!repository) {
    throw new Error(`未配置子仓库：${selector}。请使用 --list 查看可选项`);
  }

  run('gh', ['--version']);
  run('gh', ['auth', 'status']);

  const defaultBranch = run('gh', [
    'repo',
    'view',
    repository.slug,
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]).stdout.trim();
  if (!defaultBranch) {
    throw new Error(`无法确定 ${repository.slug} 的默认分支`);
  }

  run('gh', [
    'workflow',
    'view',
    workflowFile,
    '--repo',
    repository.slug,
    '--ref',
    defaultBranch,
    '--yaml',
  ]);

  console.log(`仓库：${repository.slug}`);
  console.log(`默认分支：${defaultBranch}`);
  console.log(`工作流：${workflowFile}`);

  if (arguments_.includes('--dry-run')) {
    console.log('校验完成：dry-run 未触发发布');
    process.exit(0);
  }

  const requestId = `local-${Date.now()}`;
  const runTitle = `Release ${requestId}`;
  run('gh', [
    'workflow',
    'run',
    workflowFile,
    '--repo',
    repository.slug,
    '--ref',
    defaultBranch,
    '--field',
    `request_id=${requestId}`,
  ]);
  console.log(`已触发：${runTitle}`);

  if (arguments_.includes('--no-wait')) {
    console.log(`查看运行：https://github.com/${repository.slug}/actions`);
    process.exit(0);
  }

  const workflowRun = findTriggeredRun(repository, runTitle);
  console.log(`运行地址：${workflowRun.url}`);
  run('gh', ['run', 'watch', String(workflowRun.databaseId), '--repo', repository.slug, '--exit-status'], {
    inherit: true,
  });

  const release = run('gh', [
    'release',
    'list',
    '--repo',
    repository.slug,
    '--limit',
    '1',
    '--json',
    'tagName,name,publishedAt',
  ]).stdout.trim();
  const latestRelease = JSON.parse(release || '[]')[0];
  if (latestRelease) {
    const releaseUrl = run('gh', [
      'release',
      'view',
      latestRelease.tagName,
      '--repo',
      repository.slug,
      '--json',
      'url',
      '--jq',
      '.url',
    ]).stdout.trim();
    console.log(`发布完成：${latestRelease.tagName} ${releaseUrl}`);
  } else {
    console.log('Action 已完成，但没有查询到 Release，请打开运行地址检查日志');
  }
} catch (error) {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
}
