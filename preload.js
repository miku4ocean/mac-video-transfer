const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // File dialogs
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    saveFileDialog: (defaultName, format) => ipcRenderer.invoke('save-file-dialog', defaultName, format),

    // Video operations
    getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info', filePath),
    convertVideo: (options) => ipcRenderer.invoke('convert-video', options),
    cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),

    // File operations
    showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

    // Event listeners — 每次註冊前先移除同 channel 舊 listener，
    // 避免重複呼叫時 listener 累積（memory leak）
    onConversionStarted: (callback) => {
        ipcRenderer.removeAllListeners('conversion-started');
        ipcRenderer.on('conversion-started', (event, data) => callback(data));
    },
    onConversionProgress: (callback) => {
        ipcRenderer.removeAllListeners('conversion-progress');
        ipcRenderer.on('conversion-progress', (event, data) => callback(data));
    },

    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    }
});
