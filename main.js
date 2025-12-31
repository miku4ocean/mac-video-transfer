const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

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

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

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
    webm: ['webm'],
    mkv: ['mkv'],
    avi: ['avi']
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
          fps: eval(videoStream.r_frame_rate) || 30,
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

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    // Video codec settings
    if (settings.codec === 'h265') {
      command = command.videoCodec('libx265');
      command = command.addOption('-tag:v', 'hvc1'); // For better compatibility
    } else if (settings.codec === 'h264') {
      command = command.videoCodec('libx264');
    } else if (settings.codec === 'vp9') {
      command = command.videoCodec('libvpx-vp9');
      command = command.addOption('-b:v', '0'); // Required for CRF mode in VP9
    }

    // Quality (CRF)
    command = command.addOption('-crf', settings.crf.toString());

    // Preset (encoding speed vs compression)
    if (settings.codec !== 'vp9') {
      command = command.addOption('-preset', settings.preset || 'medium');
    }

    // Audio settings
    if (settings.copyAudio) {
      command = command.audioCodec('copy');
    } else {
      command = command.audioCodec('aac').audioBitrate('192k');
    }

    // Maintain resolution (no scaling)
    // Only add scale filter if explicitly requested
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
    } else if (ext === '.mkv') {
      command = command.format('matroska');
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
      // Get output file size
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
