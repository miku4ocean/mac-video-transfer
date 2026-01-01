# Nordic Design System 使用指南

## 📁 檔案位置
```
nordic-design-system.css
```

## 🚀 快速開始

### 1. 引入 CSS 檔案

在你的 HTML 中加入：

```html
<link rel="stylesheet" href="nordic-design-system.css">
```

或是複製到你的專案中使用。

### 2. 使用 CSS 變數

這個設計系統定義了完整的 CSS 變數，你可以在自己的 CSS 中直接使用：

```css
.my-component {
    background: var(--nordic-bg-secondary);
    color: var(--nordic-text-primary);
    border-radius: var(--nordic-radius-md);
    box-shadow: var(--nordic-shadow-sm);
    padding: var(--nordic-spacing-md);
}
```

---

## 🎨 設計標記（Design Tokens）

### 顏色系統

| 變數 | 用途 | 值 |
|------|------|-----|
| `--nordic-bg-primary` | 主要背景 | #f8f9fb |
| `--nordic-bg-secondary` | 卡片背景 | #ffffff |
| `--nordic-bg-tertiary` | 輸入框背景 | #f0f2f5 |
| `--nordic-accent-primary` | 主要強調色 | #5a6a7a |
| `--nordic-success` | 成功/綠色 | #4a9a7c |
| `--nordic-warning` | 警告/黃色 | #c89a4a |
| `--nordic-danger` | 危險/紅色 | #c45a5a |
| `--nordic-text-primary` | 主要文字 | #2a3a4a |
| `--nordic-text-muted` | 淡色文字 | #8a9aaa |

### 間距系統

| 變數 | 值 |
|------|-----|
| `--nordic-spacing-xs` | 4px |
| `--nordic-spacing-sm` | 8px |
| `--nordic-spacing-md` | 16px |
| `--nordic-spacing-lg` | 24px |
| `--nordic-spacing-xl` | 32px |

### 圓角系統

| 變數 | 值 |
|------|-----|
| `--nordic-radius-sm` | 6px |
| `--nordic-radius-md` | 10px |
| `--nordic-radius-lg` | 14px |
| `--nordic-radius-xl` | 20px |

### 陰影系統

| 變數 | 用途 |
|------|------|
| `--nordic-shadow-sm` | 小陰影（按鈕、輸入框） |
| `--nordic-shadow-md` | 中陰影（卡片） |
| `--nordic-shadow-lg` | 大陰影（懸浮面板） |

---

## 🧱 元件類別

### 按鈕

```html
<button class="nordic-btn nordic-btn-primary">主要按鈕</button>
<button class="nordic-btn nordic-btn-secondary">次要按鈕</button>
<button class="nordic-btn nordic-btn-success">成功按鈕</button>
<button class="nordic-btn nordic-btn-danger">危險按鈕</button>
<button class="nordic-btn nordic-btn-primary nordic-btn-sm">小按鈕</button>
<button class="nordic-btn nordic-btn-primary nordic-btn-lg">大按鈕</button>
```

### 卡片

```html
<div class="nordic-card">
    <div class="nordic-card-header">標題</div>
    <div class="nordic-card-body">內容</div>
    <div class="nordic-card-footer">頁腳</div>
</div>
```

### 輸入框

```html
<input type="text" class="nordic-input" placeholder="輸入...">
```

### 下拉選單

```html
<div class="nordic-select-wrapper">
    <select class="nordic-select">
        <option>選項 1</option>
        <option>選項 2</option>
    </select>
</div>
```

### 核取方塊

```html
<label class="nordic-checkbox">
    <input type="checkbox">
    <span class="nordic-checkbox-box"></span>
    <span>選項文字</span>
</label>
```

### 滑桿

```html
<input type="range" class="nordic-slider" min="0" max="100">
```

### 標籤

```html
<span class="nordic-badge nordic-badge-success">成功</span>
<span class="nordic-badge nordic-badge-warning">警告</span>
<span class="nordic-badge nordic-badge-danger">錯誤</span>
```

### 進度條

```html
<div class="nordic-progress">
    <div class="nordic-progress-fill" style="width: 60%"></div>
</div>
```

### 載入動畫

```html
<div class="nordic-spinner"></div>
<div class="nordic-spinner nordic-spinner-lg"></div>
```

### Toast 通知

```html
<div class="nordic-toast-container">
    <div class="nordic-toast nordic-toast-success">
        ✓ 操作成功！
    </div>
</div>
```

---

## 🛠️ 工具類別

### 文字顏色
- `.nordic-text-primary` - 主要文字
- `.nordic-text-secondary` - 次要文字
- `.nordic-text-muted` - 淡色文字
- `.nordic-text-success` - 成功色
- `.nordic-text-danger` - 危險色

### 背景顏色
- `.nordic-bg-primary` - 主要背景
- `.nordic-bg-secondary` - 次要背景
- `.nordic-bg-tertiary` - 第三層背景

### 間距
- `.nordic-m-sm/md/lg` - 外邊距
- `.nordic-p-sm/md/lg` - 內邊距

### Flexbox
- `.nordic-flex` - display: flex
- `.nordic-flex-col` - 垂直排列
- `.nordic-items-center` - 垂直居中
- `.nordic-justify-center` - 水平居中
- `.nordic-justify-between` - 兩端對齊
- `.nordic-gap-sm/md/lg` - 間隙

### 圓角
- `.nordic-rounded-sm/md/lg/full`

### 陰影
- `.nordic-shadow-sm/md/lg`

### 隱藏
- `.nordic-hidden` - 隱藏元素

### 捲軸
- `.nordic-scrollbar` - 美化捲軸

---

## 📋 完整範例

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="nordic-design-system.css">
</head>
<body class="nordic-app">
    <div class="nordic-card nordic-m-lg">
        <div class="nordic-card-header nordic-flex nordic-justify-between nordic-items-center">
            <h2>設定</h2>
            <span class="nordic-badge nordic-badge-success">已儲存</span>
        </div>
        <div class="nordic-card-body nordic-flex nordic-flex-col nordic-gap-md">
            <div>
                <label class="nordic-text-secondary">名稱</label>
                <input type="text" class="nordic-input" placeholder="輸入名稱...">
            </div>
            <div>
                <label class="nordic-text-secondary">選項</label>
                <div class="nordic-select-wrapper">
                    <select class="nordic-select">
                        <option>選項 1</option>
                        <option>選項 2</option>
                    </select>
                </div>
            </div>
            <label class="nordic-checkbox">
                <input type="checkbox" checked>
                <span class="nordic-checkbox-box"></span>
                <span>啟用功能</span>
            </label>
        </div>
        <div class="nordic-card-footer nordic-flex nordic-justify-between">
            <button class="nordic-btn nordic-btn-secondary">取消</button>
            <button class="nordic-btn nordic-btn-primary">儲存</button>
        </div>
    </div>
</body>
</html>
```

---

## 🔧 自訂主題

如果要調整整體風格，只需覆蓋 `:root` 變數：

```css
:root {
    /* 改為深色主題 */
    --nordic-bg-primary: #1a1a2e;
    --nordic-bg-secondary: #16213e;
    --nordic-text-primary: #eaeaea;
    
    /* 改為藍色強調 */
    --nordic-accent-primary: #4a90d9;
}
```

---

## 📝 注意事項

1. **字型**：預設使用 Inter 字型，建議在 HTML 中加入 Google Fonts：
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
   ```

2. **前綴**：所有類別都以 `nordic-` 為前綴，避免與其他 CSS 衝突。

3. **變數前綴**：CSS 變數也都以 `--nordic-` 為前綴。

4. **相容性**：需要支援 CSS 變數的現代瀏覽器。

---

**作者**：miku4ocean  
**版本**：1.0.0  
**授權**：MIT
