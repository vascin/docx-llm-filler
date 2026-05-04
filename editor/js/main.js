// ============================================
// Initialization & Event Listeners
// ============================================

async function loadProviderSecrets() {
  try {
    const response = await fetch('ai-keys.local.json?t=' + Date.now());
    if (!response.ok) return;
    const data = await response.json();
    if (data && typeof data === 'object') {
      providerSecrets = data;
      debugLog('🔐 Загружен локальный файл ключей ai-keys.local.json');
    }
  } catch (e) {
    // Silent by design: file is optional and may be deleted by user.
  }
}

async function initApp() {
  applyStoredTheme();
  const revisionBadge = document.getElementById('revisionBadge');
  const revisionInline = document.getElementById('revisionInline');
  if (revisionBadge && typeof APP_REVISION === 'string') {
    revisionBadge.textContent = `Редакция: ${APP_REVISION}`;
  }
  if (revisionInline && typeof APP_REVISION === 'string') {
    revisionInline.textContent = APP_REVISION;
  }
  await loadProviderSecrets();
  await loadPromptTemplate();
  await loadJsonData();
  await loadMapping();
  buildTreeFromJson();
  hasUnsavedChanges = false;
  setSaveButtonState();
  initResizer();
  hideEditControls();

  if (debugEl) {
    debugEl.innerHTML = '✅ JSON загружен\n';
  }
  if (responseTextEl) {
    responseTextEl.textContent = 'Готово к работе. Выберите модель, загрузите DOCX и нажмите AI.';
  }

  checkOllama();

  // Sync UI visibility with the default provider selection
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) {
    modelSelect.dispatchEvent(new Event('change'));
  }
}

// ============================================
// DOCX File Input
// ============================================
document.getElementById('fileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    currentFileData = await file.arrayBuffer();
    zip = await JSZip.loadAsync(file);
    await buildEditor();
    document.getElementById('saveBtn').disabled = false;
    document.getElementById('fillOllamaBtn').disabled = false;
    document.getElementById('status').textContent = `Файл: ${file.name}`;
    showToast('✅ Файл загружен!', 'success');
  } catch (err) {
    console.error(err);
    document.getElementById('status').textContent = 'Ошибка: ' + err.message;
    alert('Ошибка: ' + err.message + '\n\nСмотрите консоль (F12) для деталей');
  }
});

// ============================================
// JSON File Input
// ============================================
document.getElementById('jsonFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    jsonData = JSON.parse(text);
    buildTreeFromJson();
    hasUnsavedChanges = false;
    setSaveButtonState();
    hideEditControls();
    showToast('✅ JSON загружен!', 'success');
  } catch (err) {
    showToast('❌ Ошибка JSON: ' + err.message, 'error');
  }
});

// ============================================
// Save DOCX Button
// ============================================
document.getElementById('saveBtn').addEventListener('click', saveDocx);

// ============================================
// AI Fill Button
// ============================================
document.getElementById('fillOllamaBtn').addEventListener('click', fillDocWithOllama);

// ============================================
// Edit Mode Toggle
// ============================================
document.getElementById('editToggle')?.addEventListener('change', e => {
  setEditMode(e.target.checked);
});

// ============================================
// Model Select
// ============================================
document.getElementById('modelSelect')?.addEventListener('change', e => {
  const apiKeyInput = document.getElementById('apiKey');
  const ollamaModelInput = document.getElementById('ollamaModelName');
  const wormsoftModelInput = document.getElementById('wormsoftModelName');
  const geminiModelInput = document.getElementById('geminiModelName');
  const isOllama = e.target.value === 'ollama';
  const isWormsoft = e.target.value === 'wormsoft';
  const isGemini = e.target.value === 'gemini';

  if (ollamaModelInput) ollamaModelInput.style.display = isOllama ? '' : 'none';
  if (wormsoftModelInput) wormsoftModelInput.style.display = isWormsoft ? '' : 'none';
  if (geminiModelInput) geminiModelInput.style.display = isGemini ? '' : 'none';
  if (apiKeyInput) {
    apiKeyInput.style.display = isOllama ? 'none' : '';
    const placeholders = {
      gemini: 'Gemini API Key',
      wormsoft: 'Wormsoft API Key',
      gigachat: 'GigaChat Authorization Key (Base64)',
      yandex: 'folder_id:api_key'
    };
    apiKeyInput.placeholder = placeholders[e.target.value] || 'API Key';
  }
});

// ============================================
// Help Modal
// ============================================
document.getElementById('helpModal').addEventListener('click', e => {
  if (e.target.id === 'helpModal') closeHelp();
});

// ============================================
// Keyboard Shortcuts
// ============================================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHelp();
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    document.getElementById('saveBtn').click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    document.getElementById('fileInput').click();
  }
});

// ============================================
// Unsaved Changes Warning
// ============================================
window.addEventListener('beforeunload', e => {
  if (hasUnsavedChanges || hasUnsavedDoc) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ============================================
// Start
// ============================================
initApp();
