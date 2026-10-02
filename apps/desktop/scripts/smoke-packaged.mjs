// 启动打包后的应用，确认主进程与后台服务都能正常启动（数据库与示例书库初始化完成）。
// 开发模式下的测试无法覆盖打包产物特有的问题，例如 fuse 与签名、asar 路径、环境变量传递。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const release = join(import.meta.dirname, '..', 'release');
const version = readdirSync(release).find((name) => /^\d/.test(name));
if (!version) throw new Error('release 目录中没有打包产物');
const root = join(release, version);

const candidates = {
  darwin: readdirSync(root)
    .filter((d) => d.startsWith('mac'))
    .map((d) => join(root, d, 'YiyeShuzhan.app', 'Contents', 'MacOS', 'YiyeShuzhan')),
  win32: [join(root, 'win-unpacked', 'YiyeShuzhan.exe'), join(root, 'win-arm64-unpacked', 'YiyeShuzhan.exe')],
  linux: [join(root, 'linux-unpacked', 'YiyeShuzhan')],
}[process.platform];
const binary = candidates?.find((path) => existsSync(path));
if (!binary) throw new Error(`没有找到可执行文件：${candidates?.join(', ')}`);

const dataDir = mkdtempSync(join(tmpdir(), 'yys-packaged-'));
const child = spawn(binary, [], { env: { ...process.env, YYS_USER_DATA_DIR: dataDir }, stdio: 'ignore' });
const log = join(dataDir, 'logs', 'main.log');

const deadline = Date.now() + 30_000;
let ok = false;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  if (existsSync(log) && readFileSync(log, 'utf8').includes('示例书库已就绪')) {
    ok = true;
    break;
  }
}
child.kill();
const output = existsSync(log) ? readFileSync(log, 'utf8') : '（没有日志）';
rmSync(dataDir, { recursive: true, force: true });
if (!ok) {
  console.error(output);
  throw new Error('打包后的应用未能在 30 秒内完成启动');
}
console.log(`打包产物启动正常：${binary}`);
