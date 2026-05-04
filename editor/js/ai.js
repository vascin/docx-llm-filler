// ============================================
// AI Fill Logic: Prompt Building & Orchestration
// ============================================

// ============================================
// Prompt Building
// ============================================
async function loadPromptTemplate() {
  try {
    const response = await fetch('prompts/ai-fill.txt');
    if (response.ok) promptTemplate = await response.text();
  } catch (e) {
    console.log('Промпт не загружен, использую встроенный');
  }
}

function getEmptyCellsWithHeaders() {
  const result = [];
  forEachCellWithHeader((td, headerText) => {
    result.push(headerText);
  });
  return result;
}

function buildPrompt(docText, jsonContext) {
  const allFields = jsonContext.map(f => `${f.field}: ${f.value}`).join('\n');
  const emptyCells = getEmptyCellsWithHeaders();

  if (emptyCells.length === 0) {
    const lines = docText.split('\n').filter(l => l.trim()).slice(0, 20).join('\n');
    return promptTemplate.replace('{fields}', allFields).replace('{doc}', lines);
  }

  const cellsList = [...new Set(emptyCells)].map(h => `- ${h}`).join('\n');
  return promptTemplate.replace('{fields}', allFields).replace('{doc}', cellsList);
}

// ============================================
// Main AI Fill Flow
// ============================================
async function fillDocWithOllama() {
  debugLog('=== START FILL ===');
  updateOllamaStatus('Проверка...', 'working');

  if (!zip) {
    updateOllamaStatus('Ошибка: загрузите DOCX', 'error');
    showToast('❌ Загрузите DOCX', 'error');
    return;
  }
  if (!jsonData?.categories?.length) {
    updateOllamaStatus('Ошибка: загрузите JSON', 'error');
    showToast('❌ Загрузите JSON', 'error');
    return;
  }

  const btn = document.getElementById('fillOllamaBtn');
  btn.disabled = true;
  btn.textContent = '🤖 Работает...';

  if (responseEl) responseEl.style.display = 'block';
  if (debugEl) debugEl.style.display = 'block';

  let totalFilled = 0;

  try {
    const docText = await extractDocText();
    const jsonContext = flattenJsonForPrompt(jsonData);

    // Pass 0: fill from mapping memory
    const mappingCount = applyMapping();
    totalFilled += mappingCount;
    if (mappingCount > 0) {
      debugLog(`Память (mapping): заполнено ${mappingCount}`);
      showModelResponse(`--- Память: +${mappingCount} ---`, true);
    }

    // Pass 1: main AI request
    updateOllamaStatus('Проход 1...', 'working');
    const prompt = buildPrompt(docText, jsonContext);
    debugLog('=== ПРОХОД 1 ===');
    debugLog(prompt);
    showModelResponse('⏳ Проход 1: ожидание ответа...');

    const result = await aiRequest(prompt, docText);
    const responseText = result.response || '';

    if (!responseText) {
      debugLog('ПУСТОЙ ОТВЕТ');
      showModelResponse('❌ Модель вернула пустой ответ', true);
    } else {
      showModelResponse(responseText);
      const parsed = parseOllamaResponse(responseText);
      const keysCount = Object.keys(parsed).length;
      debugLog(`Распарсено ключей: ${keysCount}`);

      if (keysCount === 0) {
        debugLog('⚠ Не удалось распарсить JSON из ответа');
        showModelResponse('\n⚠ Не удалось распарсить ответ как JSON', true);
      } else {
        const pass1 = applyFilledValues(parsed);
        totalFilled += pass1;
        showModelResponse(`\n--- Проход 1: заполнено ${pass1} ---`, true);
        debugLog(`Проход 1: заполнено ${pass1}`);
      }
    }

    // Pass 2: direct JSON matching
    const directCount = applyJsonDirect();
    totalFilled += directCount;
    if (directCount > 0) {
      debugLog(`Прямой матчинг: заполнено ${directCount}`);
      showModelResponse(`--- Прямой матчинг: +${directCount} ---`, true);
    }

    // Summary
    const finalRemaining = getRemainingEmptyCells();
    showModelResponse(`\n=== ИТОГО: заполнено ${totalFilled}, осталось пустых: ${finalRemaining.length} ===`, true);
    if (finalRemaining.length > 0) debugLog('Незаполненные:', finalRemaining.join(', '));

    hasUnsavedDoc = true;
    updateStats();
    updateOllamaStatus(`Заполнено: ${totalFilled}`, 'success');
    showToast(`✅ Заполнено: ${totalFilled}`, 'success');
  } catch (err) {
    console.error('AI fill error:', err);
    updateOllamaStatus('Ошибка: ' + err.message, 'error');
    showToast('❌ Ошибка: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 AI';
  }
}
