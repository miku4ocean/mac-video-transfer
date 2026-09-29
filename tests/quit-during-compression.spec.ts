import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync, execSync } from 'child_process';

// ============================================================================
// 「關窗即退出」對 FFmpeg 子程序的驗證（HANDOFF.md 2026-09-29 交辦重點）
//
// 過去只有 cancel-conversion 這條 IPC 會漸進式（SIGTERM→SIGKILL）終止 ffmpeg，
// 但直接關視窗（window-all-closed）或 Cmd+Q（before-quit）並不會清掉壓縮中的
// ffmpeg 子行程——本測試真的啟動一次會花數秒的壓縮，在壓縮進行中把視窗關掉，
// 用作業系統層級（pgrep 找 Electron 主行程底下的 ffmpeg 子行程）驗證：
//   1. 壓縮進行中，ffmpeg 子行程確實存在（不是還沒開始就先關窗誤判過關）
//   2. 關窗後，該 ffmpeg 子行程真的被殺掉，不是繼續背景跑完
// ============================================================================

const projectRoot = path.resolve(__dirname, '..');
const ffmpegBin = require(path.join(projectRoot, 'node_modules', 'ffmpeg-static')) as string;

function makeSource(outPath: string, args: string[]) {
  execFileSync(ffmpegBin, ['-y', ...args, outPath], { stdio: 'pipe' });
}

async function mockOpenDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, filePath);
}

async function mockSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: p,
    })) as typeof dialog.showSaveDialog;
  }, filePath);
}

// 找出某個父行程底下、command 包含 ffmpeg 的子行程 pid。
function childFfmpegPids(parentPid: number): number[] {
  let out = '';
  try {
    out = execSync(`pgrep -P ${parentPid}`, { encoding: 'utf8' }).trim();
  } catch {
    return [];
  }
  if (!out) return [];
  return out
    .split('\n')
    .map((s) => parseInt(s, 10))
    .filter((pid) => {
      try {
        const comm = execSync(`ps -o comm= -p ${pid}`, { encoding: 'utf8' }).trim();
        return /ffmpeg/i.test(comm);
      } catch {
        return false;
      }
    });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('壓縮進行中關閉視窗：FFmpeg 子行程確實被 kill，不殘留背景行程', async () => {
  // 這個測試檔排在整批 e2e 最後跑，前面已經跑過大量真實 ffmpeg 壓縮（見
  // HANDOFF.md「本機這次跑測試時系統負載異常高」），系統負載偏高時 Electron
  // debugger（playwright 用的 --inspect）中止 + 行程真正 exit 需要的時間會拉長，
  // 給寬一點的 timeout 避免單純因為機器忙就誤判成「沒有真的退出」。
  test.setTimeout(90_000);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-quit-compress-'));
  const src = path.join(tmpDir, 'source_1080p_slow.mp4');
  // 1080p 8 秒素材，App 端用軟體 h265（libx265）壓縮，確保有數秒可攔截的視窗。
  makeSource(src, [
    '-f', 'lavfi', '-i', 'testsrc2=duration=8:size=1920x1080:rate=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  ]);
  const outputPath = path.join(tmpDir, 'out.mp4');

  // 比照其他 spec 檔的慣例用獨立 --user-data-dir（見 electron-app.spec.ts 等），
  // 避免跟同一批次裡其他測試共用預設 userData 目錄，減少互相干擾的變因。
  const userDataDir = path.join(tmpDir, 'user-data');
  const electronApp = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
  });
  const window: Page = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const mainPid = electronApp.process().pid!;
  expect(mainPid).toBeTruthy();

  await mockOpenDialog(electronApp, src);
  await window.locator('#selectFilesBtn').click();
  await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });

  await mockSaveDialog(electronApp, outputPath);
  // 軟體 h265 編碼比較慢，確保視窗關掉前壓縮還沒跑完。
  await window.locator('#videoCodec').selectOption('h265');

  await window.locator('#startConvertBtn').click();
  await expect(window.locator('#progressPanel')).toBeVisible({ timeout: 10_000 });

  // 等 ffmpeg 子行程真的出現（壓縮確實在跑，不是誤判空跑過關）。
  let pids: number[] = [];
  for (let i = 0; i < 20 && pids.length === 0; i++) {
    pids = childFfmpegPids(mainPid);
    if (pids.length === 0) await new Promise((r) => setTimeout(r, 250));
  }
  expect(pids.length, '應該要能在 Electron 主行程底下找到 ffmpeg 子行程').toBeGreaterThan(0);

  // 模擬使用者在壓縮進行中直接關視窗（紅色關閉鈕），觸發 window-all-closed。
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((w) => w.close());
  });

  // 等 Electron App 行程整個結束。
  const proc = electronApp.process();
  await new Promise<void>((resolve, reject) => {
    if (proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('App 行程在 30 秒內沒有結束')), 30_000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  // 核心驗證：先前抓到的 ffmpeg pid 全部都已經不存在了。
  const stillAlive = pids.filter(pidAlive);
  expect(stillAlive, `殘留 ffmpeg pid：${stillAlive.join(',')}`).toEqual([]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
