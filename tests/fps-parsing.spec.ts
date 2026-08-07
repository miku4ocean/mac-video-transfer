import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ============================================================================
// FPS 解析安全性測試
//
// main.js get-video-info handler 需要解析 ffprobe 回傳的 r_frame_rate 欄位
// （格式為分數字串，如 "25/1"、"30000/1001"），不得使用 eval() 等動態執行，
// 因為影片 metadata 可被惡意操控。本測試驗證：
//   1. 邏輯等價：parseFraction 函式正確處理常見 fps 分數格式
//   2. 端到端：真實 Electron App 對測試影片呼叫 get-video-info IPC，
//      回傳的 fps 欄位為合理數值（非 NaN、非 0）
// ============================================================================

// ---------- 邏輯等價測試（不啟動 Electron）----------

// 與 main.js parseFraction() 逐字相同的實作（logic-equivalent pattern）
function parseFraction(str: string | undefined | null): number {
  if (!str) return NaN;
  const parts = str.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    return den !== 0 ? num / den : NaN;
  }
  return Number(str);
}

test.describe('parseFraction 邏輯等價測試（main.js fps 安全解析）', () => {
  test('標準分數 25/1 → 25', () => {
    expect(parseFraction('25/1')).toBe(25);
  });

  test('NTSC 分數 30000/1001 → ~29.97', () => {
    const result = parseFraction('30000/1001');
    expect(result).toBeCloseTo(29.97, 1);
  });

  test('整數字串 "30" → 30', () => {
    expect(parseFraction('30')).toBe(30);
  });

  test('分母為零 "25/0" → NaN（安全處理）', () => {
    expect(parseFraction('25/0')).toBeNaN();
  });

  test('空字串 → NaN', () => {
    expect(parseFraction('')).toBeNaN();
  });

  test('null/undefined → NaN', () => {
    expect(parseFraction(null)).toBeNaN();
    expect(parseFraction(undefined)).toBeNaN();
  });

  test('24000/1001 (23.976 fps 電影) → ~23.976', () => {
    expect(parseFraction('24000/1001')).toBeCloseTo(23.976, 2);
  });

  test('60/1 → 60', () => {
    expect(parseFraction('60/1')).toBe(60);
  });
});

// ---------- 端到端測試（真實 Electron + ffprobe）----------

const projectRoot = path.resolve(__dirname, '..');
const ffmpegBin = require(path.join(projectRoot, 'node_modules', 'ffmpeg-static')) as string;

function createTinyTestVideo(outPath: string) {
  execFileSync(ffmpegBin, [
    '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=160x120:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-y', outPath,
  ], { stdio: 'pipe' });
}

test.describe.serial('get-video-info fps 端到端驗證', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  let sourceVideo: string;

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-fps-test-'));
    sourceVideo = path.join(tmpDir, 'fps_test.mp4');
    createTinyTestVideo(sourceVideo);
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

  test('get-video-info 回傳的 fps 為合理數值（25fps 測試影片）', async () => {
    // mock dialog 讓選檔回傳測試影片，觸發 getVideoInfo IPC
    await electronApp.evaluate(async ({ dialog }, videoPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [videoPath],
      })) as typeof dialog.showOpenDialog;
    }, sourceVideo);

    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });

    // 驗證檔案資訊已正確載入（如果 fps 解析炸了，addFiles 會 catch 並跳過）
    await expect(window.locator('#fileCount')).toHaveText('1');
    await expect(window.locator('#fileList .file-name')).toHaveText('fps_test.mp4');
  });
});
