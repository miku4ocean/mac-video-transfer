// ========================================
// State Management
// ========================================
const state = {
    files: [],          // Array of file objects with info
    isConverting: false,
    isLoading: false,
    currentFileIndex: 0,
    results: []
};

// ========================================
// DOM Elements
// ========================================
const elements = {
    // Drop zone
    dropZone: document.getElementById('dropZone'),
    selectFilesBtn: document.getElementById('selectFilesBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),

    // File list
    fileListContainer: document.getElementById('fileListContainer'),
    fileList: document.getElementById('fileList'),
    fileCount: document.getElementById('fileCount'),
    clearAllBtn: document.getElementById('clearAllBtn'),
    startConvertBtn: document.getElementById('startConvertBtn'),

    // Settings
    outputFormat: document.getElementById('outputFormat'),
    videoCodec: document.getElementById('videoCodec'),
    crfSlider: document.getElementById('crfSlider'),
    crfValue: document.getElementById('crfValue'),
    audioMode: document.getElementById('audioMode'),

    // Resize settings
    enableResize: document.getElementById('enableResize'),
    resizeOptions: document.getElementById('resizeOptions'),
    resizeWidth: document.getElementById('resizeWidth'),
    resizeHeight: document.getElementById('resizeHeight'),

    // Target size settings
    enableTargetSize: document.getElementById('enableTargetSize'),
    targetSizeOptions: document.getElementById('targetSizeOptions'),
    targetSizeValue: document.getElementById('targetSizeValue'),
    targetSizeUnit: document.getElementById('targetSizeUnit'),

    // Progress
    progressPanel: document.getElementById('progressPanel'),
    currentFileInfo: document.getElementById('currentFileInfo'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    progressSpeed: document.getElementById('progressSpeed'),
    progressTime: document.getElementById('progressTime'),
    cancelBtn: document.getElementById('cancelBtn'),

    // Results
    resultsPanel: document.getElementById('resultsPanel'),
    resultsList: document.getElementById('resultsList'),
    newConversionBtn: document.getElementById('newConversionBtn'),

    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// ========================================
// Utility Functions
// ========================================
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getFileIcon(extension) {
    const icons = {
        'mov': '🎬',
        'mp4': '🎬',
        'mpg': '📼',
        'mpeg': '📼',
        'wmv': '🎞️',
        'webm': '🌐',
        'avi': '📹',
        'mkv': '🎥',
        'flv': '📺',
        'm4v': '🍎',
        '3gp': '📱'
    };
    return icons[extension.toLowerCase()] || '🎬';
}

function getFileName(filePath) {
    return filePath.split('/').pop();
}

function getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
}

function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}${hours}${mins}`;
}

function showToast(message, type = 'info') {
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Get current settings
function getCurrentSettings() {
    return {
        quality: parseInt(elements.crfSlider.value),
        codec: elements.videoCodec.value,
        audioMode: elements.audioMode.value,
        enableResize: elements.enableResize.checked,
        resizeWidth: parseInt(elements.resizeWidth.value) || null,
        resizeHeight: parseInt(elements.resizeHeight.value) || null,
        enableTargetSize: elements.enableTargetSize.checked,
        targetSize: parseFloat(elements.targetSizeValue.value) || null,
        targetSizeUnit: elements.targetSizeUnit.value
    };
}

// Estimate compressed size based on quality and codec
// VideoToolbox uses quality scale 1-100, higher = better quality = larger file
function estimateCompressedSize(originalSize, videoWidth, videoHeight, settings) {
    const { quality, codec, audioMode, enableResize, resizeWidth, resizeHeight, enableTargetSize, targetSize, targetSizeUnit } = settings;

    // If target size is set, use that
    if (enableTargetSize && targetSize) {
        let targetBytes = targetSize;
        if (targetSizeUnit === 'KB') targetBytes *= 1024;
        else if (targetSizeUnit === 'MB') targetBytes *= 1024 * 1024;
        else if (targetSizeUnit === 'GB') targetBytes *= 1024 * 1024 * 1024;
        return Math.min(targetBytes, originalSize);
    }

    // Calculate resolution factor if resize is enabled
    let resizeFactor = 1;
    if (enableResize && (resizeWidth || resizeHeight)) {
        const originalPixels = videoWidth * videoHeight;
        const newWidth = resizeWidth || (videoWidth * (resizeHeight / videoHeight));
        const newHeight = resizeHeight || (videoHeight * (resizeWidth / videoWidth));
        const newPixels = newWidth * newHeight;
        resizeFactor = Math.min(1, newPixels / originalPixels);
    }

    // Base compression ratio based on quality (30-90 scale)
    // Quality 30 = ~95% compression, Quality 90 = ~30% compression
    let baseCompression;
    if (codec.includes('h265') || codec === 'vp9') {
        // H.265/VP9 is more efficient
        // Quality 30 -> 95% reduction, Quality 60 -> 70% reduction, Quality 90 -> 25% reduction
        baseCompression = 0.95 - ((quality - 30) / 60) * 0.70;
    } else {
        // H.264
        // Quality 30 -> 90% reduction, Quality 60 -> 60% reduction, Quality 90 -> 20% reduction
        baseCompression = 0.90 - ((quality - 30) / 60) * 0.70;
    }

    // Clamp compression ratio
    baseCompression = Math.max(0.15, Math.min(0.95, baseCompression));

    // Audio factor
    let audioFactor = 1;
    if (audioMode === 'mute') {
        audioFactor = 0.9; // Assume audio is ~10% of file
    } else if (audioMode === 'compress') {
        audioFactor = 0.95; // Slight reduction
    }

    const estimatedSize = originalSize * (1 - baseCompression) * resizeFactor * audioFactor;
    return Math.max(estimatedSize, originalSize * 0.05); // Minimum 5% of original
}

function showLoading(show) {
    state.isLoading = show;
    if (show) {
        elements.loadingOverlay.classList.remove('hidden');
    } else {
        elements.loadingOverlay.classList.add('hidden');
    }
}

// ========================================
// File Handling
// ========================================
async function addFiles(filePaths) {
    showLoading(true);

    for (const filePath of filePaths) {
        // Check if already added
        if (state.files.find(f => f.path === filePath)) {
            showToast(`已跳過重複檔案: ${getFileName(filePath)}`, 'warning');
            continue;
        }

        try {
            const info = await window.api.getVideoInfo(filePath);
            state.files.push({
                path: filePath,
                name: getFileName(filePath),
                extension: getFileExtension(filePath),
                info: info
            });
        } catch (error) {
            console.error('Error getting video info:', error);
            showToast(`無法讀取檔案: ${getFileName(filePath)}`, 'error');
        }
    }

    showLoading(false);
    updateFileList();
}

function removeFile(index) {
    state.files.splice(index, 1);
    updateFileList();
}

function clearAllFiles() {
    state.files = [];
    updateFileList();
}

function updateFileList() {
    const count = state.files.length;
    elements.fileCount.textContent = count;
    elements.startConvertBtn.disabled = count === 0;

    if (count === 0) {
        elements.fileListContainer.classList.add('hidden');
        elements.dropZone.style.display = 'flex';
        return;
    }

    elements.fileListContainer.classList.remove('hidden');
    elements.dropZone.style.display = 'none';

    const settings = getCurrentSettings();

    elements.fileList.innerHTML = state.files.map((file, index) => {
        const videoWidth = file.info.video?.width || 1920;
        const videoHeight = file.info.video?.height || 1080;
        const estimatedSize = estimateCompressedSize(file.info.size, videoWidth, videoHeight, settings);
        const compressionPercent = ((1 - estimatedSize / file.info.size) * 100).toFixed(0);

        return `
    <div class="file-item" data-index="${index}">
      <div class="file-icon">${getFileIcon(file.extension)}</div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-meta">
          <span>📐 ${videoWidth}×${videoHeight}</span>
          <span>📦 ${formatBytes(file.info.size)}</span>
          <span>⏱️ ${formatDuration(file.info.duration)}</span>
        </div>
        <div class="file-estimate">
          <span class="estimate-label">預估壓縮後:</span>
          <span class="estimate-value">${formatBytes(estimatedSize)}</span>
          <span class="estimate-percent">(節省 ${compressionPercent}%)</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-action-btn remove" title="移除" onclick="removeFile(${index})">🗑️</button>
      </div>
    </div>
  `;
    }).join('');
}

// ========================================
// Conversion
// ========================================
async function startConversion() {
    if (state.files.length === 0) return;

    state.isConverting = true;
    state.currentFileIndex = 0;
    state.results = [];

    // Show progress panel
    elements.progressPanel.classList.remove('hidden');
    elements.fileListContainer.classList.add('hidden');
    elements.resultsPanel.classList.add('hidden');

    // Get settings
    const settings = {
        codec: elements.videoCodec.value,
        quality: parseInt(elements.crfSlider.value),
        audioMode: elements.audioMode.value
    };

    // Resize settings
    if (elements.enableResize.checked) {
        const width = parseInt(elements.resizeWidth.value);
        const height = parseInt(elements.resizeHeight.value);
        if (width) settings.maxWidth = width;
        if (height) settings.maxHeight = height;
    }

    // Target size settings
    if (elements.enableTargetSize.checked) {
        const sizeValue = parseFloat(elements.targetSizeValue.value);
        const sizeUnit = elements.targetSizeUnit.value;
        if (sizeValue) {
            let targetBytes = sizeValue;
            if (sizeUnit === 'KB') targetBytes *= 1024;
            else if (sizeUnit === 'MB') targetBytes *= 1024 * 1024;
            else if (sizeUnit === 'GB') targetBytes *= 1024 * 1024 * 1024;
            settings.targetSize = targetBytes;
        }
    }

    const outputFormat = elements.outputFormat.value;

    // Process each file
    for (let i = 0; i < state.files.length; i++) {
        if (!state.isConverting) break;

        state.currentFileIndex = i;
        const file = state.files[i];

        // Update UI
        elements.currentFileInfo.innerHTML = `
      <div class="file-name">正在處理: ${file.name} (${i + 1}/${state.files.length})</div>
    `;

        // Generate output filename with timestamp
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const timestamp = getTimestamp();
        const outputFileName = `${baseName}_${timestamp}.${outputFormat}`;

        const outputPath = await window.api.saveFileDialog(
            outputFileName,
            outputFormat
        );

        if (!outputPath) {
            showToast(`已跳過: ${file.name}`, 'warning');
            continue;
        }

        try {
            const result = await window.api.convertVideo({
                inputPath: file.path,
                outputPath: outputPath,
                settings: settings
            });

            state.results.push({
                inputPath: file.path,
                inputName: file.name,
                inputSize: file.info.size,
                outputPath: result.outputPath,
                outputName: getFileName(result.outputPath),
                outputSize: result.outputSize,
                success: true
            });

        } catch (error) {
            console.error('Conversion error:', error);
            state.results.push({
                inputPath: file.path,
                inputName: file.name,
                success: false,
                error: error.message
            });
            showToast(`轉檔失敗: ${file.name}`, 'error');
        }
    }

    state.isConverting = false;
    showResults();
}

function cancelConversion() {
    state.isConverting = false;
    window.api.cancelConversion();
    showToast('已取消轉檔', 'warning');

    elements.progressPanel.classList.add('hidden');
    elements.fileListContainer.classList.remove('hidden');
}

function showResults() {
    elements.progressPanel.classList.add('hidden');
    elements.resultsPanel.classList.remove('hidden');

    const successCount = state.results.filter(r => r.success).length;
    showToast(`完成! ${successCount}/${state.results.length} 個檔案成功轉換`, 'success');

    elements.resultsList.innerHTML = state.results.map((result, index) => {
        if (!result.success) {
            return `
        <div class="result-item error">
          <div class="result-icon" style="background: linear-gradient(135deg, var(--danger), #dc2626)">❌</div>
          <div class="result-info">
            <div class="result-name">${result.inputName}</div>
            <div class="result-stats">
              <span class="stat-item" style="color: var(--danger)">${result.error || '轉檔失敗'}</span>
            </div>
          </div>
        </div>
      `;
        }

        const compressionRatio = ((1 - result.outputSize / result.inputSize) * 100).toFixed(1);

        return `
      <div class="result-item">
        <div class="result-icon">✓</div>
        <div class="result-info">
          <div class="result-name">${result.outputName}</div>
          <div class="result-stats">
            <span class="stat-item">
              <span class="stat-label">原始:</span>
              <span class="stat-value">${formatBytes(result.inputSize)}</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">壓縮後:</span>
              <span class="stat-value success">${formatBytes(result.outputSize)}</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">節省:</span>
              <span class="stat-value success">${compressionRatio}%</span>
            </span>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-sm btn-secondary" data-action="play" data-path="${result.outputPath}">
            <span class="btn-icon">▶️</span>
            播放
          </button>
          <button class="btn btn-sm btn-secondary" data-action="folder" data-path="${result.outputPath}">
            <span class="btn-icon">📁</span>
            開啟資料夾
          </button>
        </div>
      </div>
    `;
    }).join('');

    // Attach event listeners to result buttons
    document.querySelectorAll('.result-actions button').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const action = btn.dataset.action;
            const path = btn.dataset.path;
            if (action === 'play') {
                await window.api.openFile(path);
            } else if (action === 'folder') {
                await window.api.showInFolder(path);
            }
        });
    });
}

function startNewConversion() {
    state.files = [];
    state.results = [];
    elements.resultsPanel.classList.add('hidden');
    elements.dropZone.style.display = 'flex';
    updateFileList();
}

// ========================================
// Event Listeners
// ========================================

// File selection
elements.selectFilesBtn.addEventListener('click', async () => {
    const filePaths = await window.api.openFileDialog();
    if (filePaths && filePaths.length > 0) {
        await addFiles(filePaths);
    }
});

// Drag and drop
elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.add('drag-over');
});

elements.dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.remove('drag-over');
});

elements.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['mov', 'mp4', 'mpg', 'mpeg', 'wmv', 'webm', 'avi', 'mkv', 'flv', 'm4v', '3gp'];
    const filePaths = files
        .filter(f => validExtensions.includes(getFileExtension(f.name)))
        .map(f => f.path);

    if (filePaths.length > 0) {
        await addFiles(filePaths);
    } else {
        showToast('請選擇有效的影片檔案', 'warning');
    }
});

// Also allow drop on the whole document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', async (e) => {
    e.preventDefault();

    if (state.isConverting || state.isLoading) return;

    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['mov', 'mp4', 'mpg', 'mpeg', 'wmv', 'webm', 'avi', 'mkv', 'flv', 'm4v', '3gp'];
    const filePaths = files
        .filter(f => validExtensions.includes(getFileExtension(f.name)))
        .map(f => f.path);

    if (filePaths.length > 0) {
        await addFiles(filePaths);
    }
});

// ========================================
// Settings change listeners - Update estimates on ANY change
// ========================================

// Quality slider
elements.crfSlider.addEventListener('input', (e) => {
    elements.crfValue.textContent = e.target.value;
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Codec change
elements.videoCodec.addEventListener('change', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Audio mode change
elements.audioMode.addEventListener('change', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Resize toggle
elements.enableResize.addEventListener('change', () => {
    if (elements.enableResize.checked) {
        elements.resizeOptions.classList.remove('hidden');
    } else {
        elements.resizeOptions.classList.add('hidden');
    }
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Resize width/height change
elements.resizeWidth.addEventListener('input', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

elements.resizeHeight.addEventListener('input', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Target size toggle
elements.enableTargetSize.addEventListener('change', () => {
    if (elements.enableTargetSize.checked) {
        elements.targetSizeOptions.classList.remove('hidden');
    } else {
        elements.targetSizeOptions.classList.add('hidden');
    }
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Target size value/unit change
elements.targetSizeValue.addEventListener('input', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

elements.targetSizeUnit.addEventListener('change', () => {
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const quality = btn.dataset.quality;
        const codec = btn.dataset.codec;

        elements.crfSlider.value = quality;
        elements.crfValue.textContent = quality;
        elements.videoCodec.value = codec;

        if (state.files.length > 0) {
            updateFileList();
        }
    });
});

// Format/codec relationship
elements.outputFormat.addEventListener('change', () => {
    const format = elements.outputFormat.value;
    if (format === 'webm') {
        elements.videoCodec.value = 'vp9';
    } else if (elements.videoCodec.value === 'vp9') {
        elements.videoCodec.value = 'h265_hw';
    }
    if (state.files.length > 0) {
        updateFileList();
    }
});

// Buttons
elements.clearAllBtn.addEventListener('click', clearAllFiles);
elements.startConvertBtn.addEventListener('click', startConversion);
elements.cancelBtn.addEventListener('click', cancelConversion);
elements.newConversionBtn.addEventListener('click', startNewConversion);

// IPC event listeners
window.api.onConversionProgress((data) => {
    const percent = Math.round(data.percent || 0);
    elements.progressBar.querySelector('.progress-fill').style.width = `${percent}%`;
    elements.progressText.textContent = `${percent}%`;
    elements.progressTime.textContent = data.currentTime || '--:--';
    elements.progressSpeed.textContent = data.speed ? `${data.speed} fps` : '--';
});

// Make removeFile available globally
window.removeFile = removeFile;

// ========================================
// Initialization
// ========================================
console.log('Video Compressor loaded with hardware acceleration support');
