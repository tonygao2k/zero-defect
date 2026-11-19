#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const packageFile = 'package.json';
const lockFile = 'package-lock.json';
const configFile = 'src-tauri/tauri.conf.json';
const cargoFile = 'src-tauri/Cargo.toml';
const cargoLockFile = 'src-tauri/Cargo.lock';
const files = [packageFile, lockFile, configFile, cargoFile, cargoLockFile];
const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const jsonVersionField = /^( {2}"version":[ \t]*")[^"\r\n]+(?=")/gm;
const lockRootVersionField =
  /^( {4}"": \{\r?\n(?: {6}[^\r\n]*\r?\n)*? {6}"version":[ \t]*")[^"\r\n]+(?=")/gm;
const cargoVersionField = /^(version[ \t]*=[ \t]*["'])[^"'\r\n]+(?=["'])/gm;

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败`);
  }
  return capture ? result.stdout.trim() : undefined;
}

function git(...args) {
  return run('git', args, true);
}

function versionParts(tag) {
  const match = versionPattern.exec(tag);
  return match && match[0] === tag ? match.slice(1).map(BigInt) : null;
}

function updateVersion(source, field, version, file) {
  if ([...source.matchAll(field)].length !== 1) {
    throw new Error(`${file} 中找不到唯一的项目版本字段`);
  }
  return source.replace(field, (_, prefix) => `${prefix}${version}`);
}

function updateCargoVersion(source, isPackage, version, file) {
  const sections = source.split(/^(?=\[)/m);
  const matches = sections.filter(isPackage);
  if (matches.length !== 1) {
    throw new Error(`${file} 中找不到唯一的项目包条目`);
  }
  return sections
    .map((section) =>
      section === matches[0]
        ? updateVersion(section, cargoVersionField, version, file)
        : section,
    )
    .join('');
}

function release(args) {
  const [tag] = args;
  const targetParts = versionParts(tag);
  if (args.length !== 1 || !targetParts) {
    throw new Error('用法：scripts/push-to-release-sh v1.0.3');
  }
  if (git('branch', '--show-current') !== 'main') {
    throw new Error('请切换到 main 分支后再发布');
  }
  if (git('status', '--porcelain=v1', '--untracked-files=all')) {
    throw new Error('工作区或暂存区有未提交内容，请处理后再发布');
  }

  const tagRef = `refs/tags/${tag}`;
  if (
    git('tag', '--list', tag) ||
    git('ls-remote', '--refs', 'origin', tagRef)
  ) {
    throw new Error(`本地或 origin 已有标签 ${tag}，不能重复发布`);
  }
  run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/main']);
  if (git('rev-list', '--count', 'HEAD..FETCH_HEAD') !== '0') {
    throw new Error('本地 main 未包含 origin/main 的最新提交，请先同步');
  }

  const version = tag.slice(1);
  const original = Object.fromEntries(
    files.map((file) => [file, readFileSync(resolve(root, file), 'utf8')]),
  );
  const { name, version: current } = JSON.parse(original[packageFile]);
  const currentParts = versionParts(`v${current}`);
  const firstDifference = currentParts?.findIndex(
    (part, index) => part !== targetParts[index],
  );
  if (
    firstDifference == null ||
    firstDifference === -1 ||
    targetParts[firstDifference] < currentParts[firstDifference]
  ) {
    throw new Error(`目标版本 ${version} 必须高于当前版本 ${current}`);
  }

  const updated = {
    [packageFile]: updateVersion(
      original[packageFile],
      jsonVersionField,
      version,
      packageFile,
    ),
    [lockFile]: updateVersion(
      updateVersion(original[lockFile], jsonVersionField, version, lockFile),
      lockRootVersionField,
      version,
      lockFile,
    ),
    [configFile]: updateVersion(
      original[configFile],
      jsonVersionField,
      version,
      configFile,
    ),
    [cargoFile]: updateCargoVersion(
      original[cargoFile],
      (section) => /^\[package\]\r?\n/.test(section),
      version,
      cargoFile,
    ),
    [cargoLockFile]: updateCargoVersion(
      original[cargoLockFile],
      (section) =>
        /^\[\[package\]\]\r?\n/.test(section) &&
        section.match(/^name[ \t]*=[ \t]*"([^"]+)"/m)?.[1] === name,
      version,
      cargoLockFile,
    ),
  };

  const written = [];
  try {
    for (const file of files) {
      written.push(file);
      writeFileSync(resolve(root, file), updated[file]);
    }
    run(process.execPath, ['scripts/check-release-version.mjs', tag]);
  } catch (error) {
    for (const file of written)
      writeFileSync(resolve(root, file), original[file]);
    throw error;
  }

  run('git', ['add', '--', ...files]);
  run('git', ['commit', '--only', '-m', `发布 ${tag}`, '--', ...files]);
  const releaseCommit = git('rev-parse', 'HEAD');
  const releaseSteps = [
    ['push', '--no-follow-tags', 'origin', `${releaseCommit}:refs/heads/main`],
    ['tag', tag, releaseCommit],
    ['push', '--no-follow-tags', 'origin', tagRef],
  ];
  for (const step of releaseSteps) {
    try {
      run('git', step);
    } catch (error) {
      console.error(
        `发布提交 ${releaseCommit} 已创建。请核对远端分支和标签后，从失败步骤继续，不要重跑整个脚本。`,
      );
      throw error;
    }
  }
  console.log(
    `${tag} 已推送，安装包和 Release 的状态请到 GitHub Actions 查看。`,
  );
}

try {
  release(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
