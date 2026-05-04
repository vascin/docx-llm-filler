// ============================================
// UI Helpers
// ============================================

const debugEl = document.getElementById('debugLog');
const responseEl = document.getElementById('ollamaResponse');
const responseTextEl = document.getElementById('ollamaResponseText');
let logsVisible = false;

function toggleLogs() {
  logsVisible = !logsVisible;
  const btn = document.getElementById('toggleLogsBtn');
  if (btn) btn.textContent = logsVisible ? '📋 Скрыть логи' : '📋 Логи';
  if (debugEl) debugEl.style.display = logsVisible && debugEl.innerHTML.trim() ? 'block' : 'none';
  if (responseEl) responseEl.style.display = logsVisible && responseTextEl?.textContent.trim() ? 'block' : 'none';
}

function debugLog(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
  if (debugEl) {
    if (logsVisible) debugEl.style.display = 'block';
    debugEl.innerHTML += msg + '\n\n';
    debugEl.scrollTop = debugEl.scrollHeight;
  }
  console.log(...args);
}

function showModelResponse(text, append = false) {
  if (responseEl && logsVisible) responseEl.style.display = 'block';
  if (responseTextEl) {
    responseTextEl.textContent = append
      ? responseTextEl.textContent + '\n' + text
      : text;
    responseEl.scrollTop = responseEl.scrollHeight;
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function updateStats() {
  document.getElementById('stats').textContent = `Заполнено: ${filledCells.size}`;
}

function updateOllamaStatus(msg, type = '') {
  const el = document.getElementById('ollamaStatus');
  if (el) {
    el.textContent = msg;
    el.className = 'ollama-status ' + type;
  }
}

function setSaveButtonState() {
  const btn = document.querySelector('.sidebar .btn-success');
  if (btn) btn.disabled = !hasUnsavedChanges;
}

function showHelp() {
  document.getElementById('helpModal').classList.add('show');
}

function closeHelp() {
  document.getElementById('helpModal').classList.remove('show');
}

// ============================================
// Theme
// ============================================
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const theme = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeToggle').textContent = isDark ? '🌙' : '☀️';
  try { localStorage.setItem('theme', theme); } catch (e) {}
}

function applyStoredTheme() {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.getElementById('themeToggle').textContent = '☀️';
    }
  } catch (e) {}
}

// ============================================
// Edit Mode Toggle
// ============================================
function setEditMode(enabled) {
  document.querySelectorAll('.editable').forEach(el => {
    if (enabled) el.setAttribute('contenteditable', 'true');
    else el.removeAttribute('contenteditable');
  });

  document.querySelectorAll('.group-actions button, .item-del').forEach(el => {
    el.style.display = enabled ? '' : 'none';
  });

  document.querySelectorAll('.group-handle, .item-handle').forEach(el => {
    el.style.pointerEvents = enabled ? '' : 'none';
    el.style.opacity = enabled ? '' : '0.3';
  });

  document.querySelectorAll('.item-drag').forEach(el => {
    el.style.opacity = enabled ? '' : '0.6';
  });

  const toggle = document.getElementById('editToggle');
  if (toggle) toggle.checked = enabled;
}

function hideEditControls() {
  document.querySelectorAll('.group-actions button, .item-del').forEach(el => {
    el.style.display = 'none';
  });
  document.querySelectorAll('.group-handle, .item-handle').forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.3';
  });
}

// ============================================
// Resizable Panel
// ============================================
function initResizer() {
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const pageWidth = window.innerWidth;
    const minWidth = pageWidth * 0.1;
    const maxWidth = pageWidth * 0.9;
    const width = pageWidth - e.clientX;
    if (width >= minWidth && width <= maxWidth) {
      sidebar.style.width = width + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}
