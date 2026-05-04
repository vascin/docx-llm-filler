// ============================================
// AI Provider Implementations
// ============================================

function getSecret(path, fallback = '') {
  try {
    const parts = path.split('.');
    let cur = providerSecrets;
    for (const part of parts) {
      cur = cur?.[part];
      if (cur === undefined || cur === null) return fallback;
    }
    return String(cur).trim();
  } catch (e) {
    return fallback;
  }
}

function getModel() {
  return document.getElementById('modelSelect')?.value || 'gemini';
}

async function aiRequest(prompt, docContext) {
  const model = getModel();
  debugLog('=== MODEL:', model);

  switch (model) {
    case 'gemini': return geminiRequest(prompt);
    case 'wormsoft': return wormsoftRequest(prompt);
    case 'gigachat': return gigachatRequest(prompt);
    case 'yandex': return yandexRequest(prompt);
    default: return ollamaRequest(prompt);
  }
}

// ============================================
// Gemini
// ============================================
let geminiWorkingVersion = null;

async function geminiRequest(prompt) {
  const apiKey = document.getElementById('apiKey')?.value?.trim() || getSecret('gemini.apiKey');
  if (!apiKey) throw new Error('Введите Gemini API Key');

  const selectedModel = document.getElementById('geminiModelName')?.value || 'gemini-2.5-flash';
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const host = isLocal ? 'https://generativelanguage.googleapis.com' : `${location.origin}/api/gemini`;
  const versions = geminiWorkingVersion
    ? [geminiWorkingVersion, ...['v1beta', 'v1'].filter(v => v !== geminiWorkingVersion)]
    : ['v1beta', 'v1'];

  try {
    const errors = [];
    let all429 = true;

    for (const version of versions) {
      const url = `${host}/${version}/models/${selectedModel}:generateContent?key=${apiKey}`;
      debugLog(`GEMINI TRY: ${version}/${selectedModel}`);

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
          })
        });
      } catch (networkErr) {
        const msg = `${version}/${selectedModel}: network error (${networkErr.message})`;
        errors.push(msg);
        debugLog('GEMINI FAIL:', msg);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const shortErr = errText ? errText.slice(0, 220) : 'no body';
        const msg = `${version}/${selectedModel}: HTTP ${response.status} (${shortErr})`;
        errors.push(msg);
        if (response.status !== 429) all429 = false;
        debugLog('GEMINI FAIL:', msg);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        const msg = `${version}/${selectedModel}: empty response`;
        errors.push(msg);
        debugLog('GEMINI FAIL:', msg);
        continue;
      }

      geminiWorkingVersion = version;
      debugLog(`GEMINI OK: ${version}/${selectedModel}`);
      return { response: text };
    }

    if (errors.length > 0 && all429) {
      throw new Error('Gemini: превышена квота или лимит запросов (HTTP 429). Проверьте Billing/Plan или попробуйте позже.');
    }

    throw new Error(`Gemini недоступен на всех маршрутах. ${errors.join(' | ')}`);
  } catch (e) {
    debugLog('GEMINI ERR:', e.message);
    showModelResponse('❌ Ошибка: ' + e.message);
    throw e;
  }
}

// ============================================
// Wormsoft (OpenAI-compatible)
// ============================================
const WORMSOFT_DEFAULT_MODEL = 'openai/gpt-5.3-codex';
const WORMSOFT_BASE_URL = 'https://ai.wormsoft.ru/api/gpt';

function parseWormsoftKey(raw) {
  const parts = (raw || '').split('|').map(s => s.trim()).filter(Boolean);
  const selectedModel = document.getElementById('wormsoftModelName')?.value?.trim();
  const secretModel = getSecret('wormsoft.model');
  return {
    token: parts[0] || '',
    model: selectedModel || parts[1] || secretModel || WORMSOFT_DEFAULT_MODEL
  };
}

async function wormsoftRequest(prompt) {
  const raw = document.getElementById('apiKey')?.value?.trim();
  const cfg = parseWormsoftKey(raw || '');
  if (!cfg.token) {
    cfg.token = getSecret('wormsoft.apiKey');
    if (cfg.token) debugLog('WORMSOFT: используется ключ из ai-keys.local.json');
  }
  if (!cfg.token) throw new Error('Введите Wormsoft API Key');

  const endpoints = [
    `${WORMSOFT_BASE_URL}/chat/completions`,
    `${WORMSOFT_BASE_URL}/v1/chat/completions`,
    'https://ai.wormsoft.ru/api/gpt/chat/completions',
    'https://ai.wormsoft.ru/api/gpt/v1/chat/completions',
    'https://ai.wormsoft.ru/v1/chat/completions',
    'https://ai.wormsoft.ru/api/v1/chat/completions',
    'https://ai.wormsoft.ru/api/llm/v1/chat/completions'
  ];

  const errors = [];
  for (const url of endpoints) {
    debugLog(`WORMSOFT TRY: ${url} | model=${cfg.model}`);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.token}`
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 8192
        })
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        errors.push(`${url}: HTTP ${response.status} (${errText.slice(0, 180) || 'no body'})`);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content ||
        data.result?.alternatives?.[0]?.message?.text ||
        data.response || '';
      if (!text) {
        errors.push(`${url}: empty response`);
        continue;
      }

      debugLog(`WORMSOFT OK: ${url}`);
      return { response: text };
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }

  throw new Error(`Wormsoft недоступен. ${errors.join(' | ')}`);
}

// ============================================
// GigaChat
// ============================================
async function gigachatRequest(prompt) {
  const apiKey = document.getElementById('apiKey')?.value?.trim() || getSecret('gigachat.apiKey');
  if (!apiKey) throw new Error('Введите GigaChat Authorization Key');

  try {
    const response = await fetch('gigachat-proxy.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_key: apiKey, prompt })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`GigaChat: ${response.status} - ${err.error || 'Unknown error'}`);
    }
    return await response.json();
  } catch (e) {
    debugLog('GIGACHAT ERR:', e.message);
    showModelResponse('❌ Ошибка: ' + e.message);
    throw e;
  }
}

// ============================================
// Yandex
// ============================================
async function yandexRequest(prompt) {
  const apiKey = document.getElementById('apiKey')?.value?.trim() || getSecret('yandex.apiKey');
  if (!apiKey) throw new Error('Введите Yandex API Key');

  const parts = apiKey.split(':');
  if (parts.length < 2) throw new Error('Формат: folder_id:api_key');

  const folderId = parts[0];
  const yandexApiKey = parts.slice(1).join(':');
  const url = `https://llm.api.cloud.yandex.net/v1/folders/${folderId}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${yandexApiKey}`
      },
      body: JSON.stringify({
        model: 'yandexgpt/rc',
        generationOptions: { temperature: 0.3, maxTokens: 8192 },
        messages: [{ role: 'user', text: prompt }]
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Yandex: ${response.status} - ${err}`);
    }
    const data = await response.json();
    return { response: data.result?.alternatives?.[0]?.message?.text || '' };
  } catch (e) {
    debugLog('YANDEX ERR:', e.message);
    showModelResponse('❌ Ошибка: ' + e.message);
    throw e;
  }
}

// ============================================
// Ollama
// ============================================
async function ollamaRequest(prompt) {
  const ollamaModel = document.getElementById('ollamaModelName')?.value?.trim() || 'gemma3:1b';
  debugLog('OLLAMA REQUEST... model:', ollamaModel);

  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: true,
        options: { temperature: 0, num_ctx: 2048, num_predict: 2048 }
      })
    });
    debugLog('OLLAMA STATUS:', response.status);
    if (!response.ok) throw new Error(`Ollama: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let loopDetected = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        try {
          const obj = JSON.parse(line);
          if (obj.response) {
            fullResponse += obj.response;
            showModelResponse(fullResponse);
          }
        } catch (e) {}
      }
      // Loop detection
      if (fullResponse.length > 1000) {
        const tail = fullResponse.slice(-500);
        const sample = tail.slice(0, 100);
        if (tail.split(sample).length - 1 >= 3) {
          debugLog('⚠ Обнаружено зацикливание модели, обрезаю ответ');
          reader.cancel();
          loopDetected = true;
          break;
        }
      }
    }

    if (loopDetected) {
      const firstClose = fullResponse.indexOf('\n}');
      if (firstClose > 0) fullResponse = fullResponse.substring(0, firstClose + 2);
    }

    debugLog('OLLAMA OK:', fullResponse.substring(0, 100));
    return { response: fullResponse };
  } catch (e) {
    debugLog('OLLAMA ERR:', e.message);
    throw e;
  }
}

// ============================================
// Ollama Status Check
// ============================================
async function checkOllama() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).sort((a, b) => (a.size || 0) - (b.size || 0));
      const names = models.map(m => m.name);
      updateOllamaStatus(`Ollama: ${names.length} моделей`, 'success');

      const select = document.getElementById('ollamaModelName');
      if (select && names.length > 0) {
        select.innerHTML = names.map(name => {
          const m = models.find(x => x.name === name);
          const sizeGB = m ? (m.size / 1e9).toFixed(1) : '';
          const label = sizeGB ? `${name} (${sizeGB}GB)` : name;
          return `<option value="${name}">${label}</option>`;
        }).join('');
      } else if (select) {
        select.innerHTML = '<option value="">Нет моделей</option>';
      }
    } else {
      updateOllamaStatus('Ollama: ERROR', 'error');
    }
  } catch (e) {
    console.error('Ollama check:', e);
    updateOllamaStatus('Ollama: OFF (CORS?)', 'error');
  }
}
