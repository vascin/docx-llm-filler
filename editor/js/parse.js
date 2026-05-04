// ============================================
// AI Response Parsing
// ============================================

/**
 * Extract first complete JSON object from text,
 * handling nested braces and string escaping.
 */
function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return text.substring(start) + '}';
}

/**
 * Parse a multi-field AI response into { header: value } map.
 * Tries JSON first, then line-by-line key:value fallback.
 * Filters garbage, validates against data.json values.
 */
function parseOllamaResponse(response) {
  if (!response) return {};

  const cleaned = response.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  let result = {};

  // Attempt 1: first complete JSON object
  try {
    const jsonStr = extractFirstJson(cleaned);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed;
    }
  } catch (e) {}

  // Attempt 2: JSON objects per line
  if (Object.keys(result).length === 0) {
    for (const line of cleaned.split('\n')) {
      const m = line.match(/\{.*\}/);
      if (m) {
        try {
          const obj = JSON.parse(m[0]);
          if (typeof obj === 'object') Object.assign(result, obj);
        } catch (e) {}
      }
    }
  }

  // Attempt 3: "key: value" per line
  if (Object.keys(result).length === 0) {
    for (const line of cleaned.split('\n')) {
      const m = line.match(/^\*?\s*([^:]+):\s*(.+)$/);
      if (m) result[m[1].trim()] = m[2].trim();
    }
  }

  // Filter garbage and validate
  const garbageKeys = ['заголовок ячейки', 'значение из данных', 'подпись', 'значение', 'заголовок'];
  const garbageValues = [
    'system', 'user', 'assistant', 'null', 'undefined', 'none', 'n/a',
    'значение из данных', 'не указано', 'не найдено', 'нет данных', 'да', 'нет',
    'организация', 'паспорт', 'огрн', 'true', 'false'
  ];

  const knownValues = new Set();
  const knownLabels = new Set();
  if (jsonData?.categories) {
    const collect = (obj) => {
      if (obj.values) obj.values.forEach(v => {
        if (v.value) knownValues.add(v.value.toLowerCase().trim());
        if (v.label) v.label.split(',').forEach(a => knownLabels.add(a.trim().toLowerCase()));
      });
      if (obj.categories) obj.categories.forEach(c => collect(c));
    };
    jsonData.categories.forEach(c => collect(c));
  }

  const filtered = {};
  for (const [key, value] of Object.entries(result)) {
    const keyLower = key.toLowerCase().trim();
    const valStr = ('' + value).trim();
    const valLower = valStr.toLowerCase();

    if (garbageKeys.includes(keyLower)) continue;
    if (garbageValues.includes(valLower)) continue;
    if (key === value || !valStr || valStr === '""') continue;
    if (typeof value === 'boolean') continue;

    // Type validation: phone vs email
    if (/телефон|phone|тел\b/i.test(key) && /@/.test(valStr)) continue;
    if (/email|почт|e-mail/i.test(key) && !/@/.test(valStr)) continue;

    // Reject if value is actually a label from data.json
    if (knownLabels.has(valLower)) {
      debugLog(`⚠ Отброшено (лейбл вместо значения): "${key}" → "${valStr}"`);
      continue;
    }

    // Value must exist in data.json
    if (knownValues.size > 0 && !knownValues.has(valLower)) {
      debugLog(`⚠ Отброшено (нет в данных): "${key}" → "${valStr}"`);
      continue;
    }

    filtered[key] = valStr.replace(/^["«»""]+|["«»""]+$/g, '').trim();
  }

  debugLog(`Парсинг: ${Object.keys(result).length} сырых → ${Object.keys(filtered).length} валидных`);
  return filtered;
}

/**
 * Parse a single-field AI response.
 * Returns the value string or null.
 */
function parseSingleFieldResponse(response, header) {
  if (!response) return null;
  const text = response.trim().replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      const val = obj[header] || Object.values(obj)[0];
      if (val && typeof val === 'string') return val.trim();
    }
  } catch (e) {}

  const cleaned = text.replace(/^["«»""]+|["«»""]+$/g, '').trim();
  if (/^нет$/i.test(cleaned) || /нет данных/i.test(cleaned) || !cleaned) return null;
  return cleaned;
}
