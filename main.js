const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// Get FFmpeg/FFprobe paths - handle both development and packaged app
function getFFmpegPath() {
  if (app.isPackaged) {
    // In packaged app, ffmpeg-static binaries are in node_modules inside resources
    const ffmpegPath = require('ffmpeg-static');
    // Replace app.asar with app.asar.unpacked
    return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  } else {
    return require('ffmpeg-static');
  }
}

function getFFprobePath() {
  if (app.isPackaged) {
    const ffprobePath = require('ffprobe-static').path;
    return ffprobePath.replace('app.asar', 'app.asar.unpacked');
  } else {
    return require('ffprobe-static').path;
  }
}

// 安全解析 ffprobe 回傳的 fps 分數字串（如 "25/1"、"30000/1001"），
// 不使用 eval() 避免影片 metadata 注入風險。
function parseFraction(str) {
  if (!str) return NaN;
  const parts = str.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    return den !== 0 ? num / den : NaN;
  }
  return Number(str);
}

// Set FFmpeg paths after app is ready
let ffmpegPathResolved;
let ffprobePathResolved;


let mainWindow;
let currentProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f8f9fb',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Set FFmpeg paths
  ffmpegPathResolved = getFFmpegPath();
  ffprobePathResolved = getFFprobePath();
  ffmpeg.setFfmpegPath(ffmpegPathResolved);
  ffmpeg.setFfprobePath(ffprobePathResolved);

  console.log('FFmpeg path:', ffmpegPathResolved);
  console.log('FFprobe path:', ffprobePathResolved);

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video Files',
        extensions: ['mov', 'mp4', 'mpg', 'mpeg', 'wmv', 'webm', 'avi', 'mkv', 'flv', 'm4v', '3gp']
      }
    ]
  });
  return result.filePaths;
});

// Save file dialog
ipcMain.handle('save-file-dialog', async (event, defaultName, format) => {
  const extensions = {
    mp4: ['mp4'],
    webm: ['webm']
  };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: `${format.toUpperCase()} Video`, extensions: extensions[format] || ['mp4'] }
    ]
  });
  return result.filePath;
});

// Get video info
ipcMain.handle('get-video-info', async (event, filePath) => {
  // 驗證檔案存在後再呼叫 ffprobe，避免無意義的子行程 spawn + 難讀錯誤訊息
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`檔案不存在或路徑無效: ${filePath}`);
  }
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      const info = {
        duration: metadata.format.duration,
        size: metadata.format.size,
        bitrate: metadata.format.bit_rate,
        format: metadata.format.format_name,
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: parseFraction(videoStream.r_frame_rate) || 30,
          bitrate: videoStream.bit_rate
        } : null,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          channels: audioStream.channels,
          sampleRate: audioStream.sample_rate,
          bitrate: audioStream.bit_rate
        } : null
      };

      resolve(info);
    });
  });
});

// Convert video
ipcMain.handle('convert-video', async (event, options) => {
  const { inputPath, outputPath, settings } = options;

  // 驗證輸入檔案存在
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`輸入檔案不存在或路徑無效: ${inputPath}`);
  }

  // First, get video info to calculate target bitrate
  const videoInfo = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) reject(new Error(`無法讀取影片資訊: ${err.message}`));
      else resolve(metadata);
    });
  });

  const duration = videoInfo.format.duration;
  const videoStream = videoInfo.streams.find(s => s.codec_type === 'video');
  const audioStream = videoInfo.streams.find(s => s.codec_type === 'audio');

  // Get original video bitrate
  const originalVideoBitrate = videoStream?.bit_rate
    ? parseInt(videoStream.bit_rate)
    : (parseInt(videoInfo.format.bit_rate) - (audioStream?.bit_rate ? parseInt(audioStream.bit_rate) : 128000));

  const originalAudioBitrate = audioStream?.bit_rate ? parseInt(audioStream.bit_rate) : 128000;

  console.log(`Original video bitrate: ${(originalVideoBitrate / 1000).toFixed(0)} kbps`);
  console.log(`Original audio bitrate: ${(originalAudioBitrate / 1000).toFixed(0)} kbps`);

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);
    let targetVideoBitrate = 0;

    // ========================================
    // Calculate target video bitrate
    // ========================================

    if (settings.targetSize && settings.targetSize > 0 && duration > 0) {
      // TARGET SIZE MODE: Calculate from target file size
      const totalBitrate = (settings.targetSize * 8) / duration;

      let audioSafeBitrate = 0;
      let effectiveAudioMode = settings.audioMode;

      if (settings.audioMode === 'mute') {
        audioSafeBitrate = 0;
      } else if (settings.audioMode === 'compress') {
        audioSafeBitrate = 128000;
      } else {
        audioSafeBitrate = originalAudioBitrate || 128000;
      }

      targetVideoBitrate = Math.floor((totalBitrate - audioSafeBitrate) * 0.90);

      console.log(`Target size mode: ${(settings.targetSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Total bitrate needed: ${(totalBitrate / 1000).toFixed(0)} kbps`);
      console.log(`Calculated video bitrate: ${(targetVideoBitrate / 1000).toFixed(0)} kbps`);

      // Auto-adjust audio if video bitrate too low
      if (targetVideoBitrate < 50000 && settings.audioMode === 'copy') {
        console.log('Video bitrate too low, trying compressed audio...');
        audioSafeBitrate = 128000;
        effectiveAudioMode = 'compress';
        targetVideoBitrate = Math.floor((totalBitrate - audioSafeBitrate) * 0.90);
      }

      if (targetVideoBitrate < 50000 && effectiveAudioMode !== 'mute') {
        console.log('Still too low, trying mute audio...');
        audioSafeBitrate = 0;
        effectiveAudioMode = 'mute';
        targetVideoBitrate = Math.floor(totalBitrate * 0.90);
      }

      settings.audioMode = effectiveAudioMode;
      console.log(`Final: ${(targetVideoBitrate / 1000).toFixed(0)} kbps video, ${effectiveAudioMode} audio`);

    } else {
      // QUALITY PERCENTAGE MODE: Based on original bitrate
      // Quality 100 = keep original bitrate
      // Quality 50 = 50% of original bitrate
      // Quality 0 = minimum viable bitrate (50kbps)

      const qualityPercent = settings.quality; // 0-100
      const minBitrate = 50000; // 50kbps minimum

      // Calculate target bitrate as percentage of original
      targetVideoBitrate = Math.floor(originalVideoBitrate * (qualityPercent / 100));

      // Ensure minimum viable quality
      targetVideoBitrate = Math.max(targetVideoBitrate, minBitrate);

      console.log(`Quality mode: ${qualityPercent}%`);
      console.log(`Original bitrate: ${(originalVideoBitrate / 1000).toFixed(0)} kbps`);
      console.log(`Target bitrate: ${(targetVideoBitrate / 1000).toFixed(0)} kbps (${qualityPercent}% of original)`);
    }

    // ========================================
    // Video codec settings - Always use bitrate control
    // ========================================
    const maxRate = Math.floor(targetVideoBitrate * 1.1);
    const bufSize = targetVideoBitrate * 2;

    switch (settings.codec) {
      case 'h265_hw':
        command = command.videoCodec('hevc_videotoolbox');
        command = command.addOption('-tag:v', 'hvc1');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
        break;

      case 'h264_hw':
        command = command.videoCodec('h264_videotoolbox');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
        break;

      case 'h265':
        command = command.videoCodec('libx265');
        command = command.addOption('-tag:v', 'hvc1');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
        command = command.addOption('-preset', 'medium');
        break;

      case 'h264':
        command = command.videoCodec('libx264');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
        command = command.addOption('-preset', 'medium');
        break;

      case 'vp9':
        command = command.videoCodec('libvpx-vp9');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
        break;

      default:
        command = command.videoCodec('hevc_videotoolbox');
        command = command.addOption('-tag:v', 'hvc1');
        command = command.addOption('-b:v', targetVideoBitrate.toString());
        command = command.addOption('-maxrate', maxRate.toString());
        command = command.addOption('-bufsize', bufSize.toString());
    }

    // Audio settings
    switch (settings.audioMode) {
      case 'copy':
        command = command.audioCodec('copy');
        break;
      case 'compress':
        command = command.audioCodec('aac').audioBitrate('128k');
        break;
      case 'mute':
        command = command.noAudio();
        break;
      default:
        command = command.audioCodec('copy');
    }

    // Resize if requested
    if (settings.maxWidth || settings.maxHeight) {
      const scaleFilter = `scale='min(${settings.maxWidth || 'iw'},iw)':'min(${settings.maxHeight || 'ih'},ih)':force_original_aspect_ratio=decrease`;
      command = command.videoFilters(scaleFilter);
    }

    // Output format specific options
    const ext = path.extname(outputPath).toLowerCase();
    if (ext === '.mp4') {
      command = command.format('mp4').addOption('-movflags', '+faststart');
    } else if (ext === '.webm') {
      command = command.format('webm');
    }

    // Progress reporting
    command.on('start', (commandLine) => {
      console.log('FFmpeg command:', commandLine);
      mainWindow.webContents.send('conversion-started', { inputPath, outputPath });
    });

    command.on('progress', (progress) => {
      mainWindow.webContents.send('conversion-progress', {
        inputPath,
        percent: progress.percent || 0,
        currentTime: progress.timemark,
        speed: progress.currentFps
      });
    });

    command.on('end', () => {
      const stats = fs.statSync(outputPath);
      resolve({
        success: true,
        outputPath,
        outputSize: stats.size
      });
    });

    command.on('error', (err, stdout, stderr) => {
      console.error('FFmpeg error:', err);
      console.error('FFmpeg stderr:', stderr);
      reject(err);
    });

    currentProcess = command;
    command.save(outputPath);
  });
});

// Cancel conversion
ipcMain.handle('cancel-conversion', () => {
  if (currentProcess) {
    currentProcess.kill('SIGKILL');
    currentProcess = null;
    return true;
  }
  return false;
});

// Open file in finder
ipcMain.handle('show-in-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Open file
ipcMain.handle('open-file', (event, filePath) => {
  shell.openPath(filePath);
});
