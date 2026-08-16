import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ============================================================================
// 版面可用性驗收（北歐設計系統在不同視窗尺寸下的可用性）
//
// main.js 的 BrowserWindow 設定：預設 1200×800，minWidth 900 / minHeight 600
// （見 main.js createWindow()）。上幾輪修過 1400×600 觸發的 grid min-content
// 陷阱（.preset-buttons 的 grid-template-columns: repeat(3, 1fr) 那類固定欄
// 數 grid，在窄視窗+長文字時可能撐開造成水平捲軸）。
//
// 涵蓋三種尺寸 × 三種畫面狀態（空 dropZone／有檔案的 fileList／壓縮中的
// progressPanel）：
//   - 最小尺寸 900×600（BrowserWindow 的下限）
//   - 預設尺寸 1200×800
//   - 大尺寸 1920×1080
// 驗證：不出現水平捲軸（scrollWidth 不超過 clientWidth）、進度條不溢出容器。
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

async function setWindowSize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
  }, { width, height });
}

// 檢查目前畫面沒有水平捲軸；容許 1px 誤差（次像素縮放常見的浮點誤差）。
async function assertNoHorizontalScroll(window: Page, label: string) {
  const overflow = await window.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}（出現水平捲軸）`
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(
    overflow.bodyScrollWidth,
    `${label}: body.scrollWidth=${overflow.bodyScrollWidth} clientWidth=${overflow.clientWidth}（body 也溢出）`
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

// 檢查 .progress-fill 沒有溢出它的 .progress-bar 容器。
async function assertProgressBarNotOverflow(window: Page, label: string) {
  const rects = await window.evaluate(() => {
    const bar = document.getElementById('progressBar')!.getBoundingClientRect();
    const fillEl = document.querySelector('.progress-fill') as HTMLElement;
    const fill = fillEl.getBoundingClientRect();
    return { bar: { left: bar.left, right: bar.right, width: bar.width }, fill: { left: fill.left, right: fill.right, width: fill.width } };
  });
  expect(rects.fill.width, `${label}: progress-fill 寬度為負值`).toBeGreaterThanOrEqual(0);
  expect(
    rects.fill.right,
    `${label}: progress-fill 右緣 ${rects.fill.right} 超出 progress-bar 容器右緣 ${rects.bar.right}`
  ).toBeLessThanOrEqual(rects.bar.right + 1);
  expect(
    rects.fill.left,
    `${label}: progress-fill 左緣 ${rects.fill.left} 在 progress-bar 容器左緣 ${rects.bar.left} 之前`
  ).toBeGreaterThanOrEqual(rects.bar.left - 1);
}

const SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: '最小尺寸 900×600', width: 900, height: 600 },
  { label: '預設尺寸 1200×800', width: 1200, height: 800 },
  { label: '大尺寸 1920×1080', width: 1920, height: 1080 },
];

test.describe.serial('版面可用性驗收', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  let srcVideo: string;

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-layout-test-'));
    srcVideo = path.join(tmpDir, 'layout_test_video.mp4');
    makeSource(srcVideo, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k',
    ]);

    const userDataDir = path.join(tmpDir, 'user-data');
    electronApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const size of SIZES) {
    test(`${size.label}：空 dropZone 畫面不出現水平捲軸`, async () => {
      await setWindowSize(electronApp, size.width, size.height);
      // 等一個 resize 週期讓 layout 穩定
      await window.waitForTimeout(150);
      await expect(window.locator('#dropZone')).toBeVisible();
      await assertNoHorizontalScroll(window, size.label);
    });
  }

  test('加入一個檔案（fileListContainer 顯示）', async () => {
    await mockOpenDialog(electronApp, srcVideo);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });
  });

  for (const size of SIZES) {
    test(`${size.label}：有檔案的 fileList 畫面不出現水平捲軸`, async () => {
      await setWindowSize(electronApp, size.width, size.height);
      await window.waitForTimeout(150);
      await assertNoHorizontalScroll(window, size.label);
      // preset-buttons 是 repeat(3, 1fr) 固定欄數 grid，過去在窄視窗撐開過，
      // 額外確認它沒有把 sidebar 撐寬到超出視窗。
      const presetOverflow = await window.evaluate(() => {
        const grid = document.querySelector('.preset-buttons');
        if (!grid) return null;
        const gridRect = grid.getBoundingClientRect();
        return { right: gridRect.right, viewportWidth: window.innerWidth };
      });
      if (presetOverflow) {
        expect(
          presetOverflow.right,
          `${size.label}: .preset-buttons 右緣 ${presetOverflow.right} 超出視窗寬度 ${presetOverflow.viewportWidth}`
        ).toBeLessThanOrEqual(presetOverflow.viewportWidth + 1);
      }
    });
  }

  test('模擬壓縮中畫面（直接切換 progressPanel 顯示，設定不同進度值）', async () => {
    // 不需要真的跑 ffmpeg——這裡純粹驗證 CSS 版面，直接操作 DOM 狀態切到
    // 「壓縮中」畫面，並把進度條設在一個中間值，用來檢查各尺寸下的溢出情形。
    await window.evaluate(() => {
      document.getElementById('progressPanel')!.classList.remove('hidden');
      document.getElementById('fileListContainer')!.classList.add('hidden');
      const fill = document.querySelector('.progress-fill') as HTMLElement;
      fill.style.width = '42%';
      document.getElementById('progressText')!.textContent = '42%';
    });
    await expect(window.locator('#progressPanel')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`${size.label}：壓縮中畫面（42% 進度）不出現水平捲軸，進度條不溢出容器`, async () => {
      await setWindowSize(electronApp, size.width, size.height);
      await window.waitForTimeout(150);
      await assertNoHorizontalScroll(window, size.label);
      await assertProgressBarNotOverflow(window, size.label);
    });
  }

  for (const percent of [0, 100]) {
    test(`進度條邊界值 ${percent}% 不溢出容器（預設視窗尺寸）`, async () => {
      await setWindowSize(electronApp, 1200, 800);
      await window.evaluate((p) => {
        const fill = document.querySelector('.progress-fill') as HTMLElement;
        fill.style.width = `${p}%`;
      }, percent);
      await window.waitForTimeout(50);
      await assertProgressBarNotOverflow(window, `${percent}% 進度`);
    });
  }
});
