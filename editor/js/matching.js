// ============================================
// Cell Matching & Filling Logic
// ============================================

/**
 * Word-overlap score between two normalized strings.
 * Returns 0-100. Ignores words shorter than 3 chars.
 */
function wordOverlapScore(a, b) {
  const wordsA = a.split(/\s+/).filter(w => w.length > 2);
  const wordsB = b.split(/\s+/).filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  let matches = 0;
  for (const wa of wordsA) {
    for (const wb of wordsB) {
      if (wa === wb || (wa.length > 3 && wb.length > 3 && (wa.includes(wb) || wb.includes(wa)))) {
        matches++;
        break;
      }
    }
  }
  const maxLen = Math.max(wordsA.length, wordsB.length);
  return Math.round((matches / maxLen) * 100);
}

/**
 * Apply AI-parsed { header: value } map to empty cells.
 * Matches by normalized header text, then by alias groups.
 */
function applyFilledValues(filledValues) {
  let count = 0;
  const aliasMap = buildAliasMap();

  forEachCellWithHeader((td, headerText) => {
    const headerNorm = normalizeStr(headerText);

    // Direct key match (exact or high word-overlap)
    for (const [key, value] of Object.entries(filledValues)) {
      if (!value) continue;
      const keyNorm = normalizeStr(key);
      if (headerNorm === keyNorm) {
        td.textContent = value;
        filledCells.add(td.dataset.coords);
        count++;
        debugLog('\u2713', key, '\u2192', value);
        return;
      }
      const overlap = wordOverlapScore(headerNorm, keyNorm);
      if (overlap >= 70) {
        td.textContent = value;
        filledCells.add(td.dataset.coords);
        count++;
        debugLog(`\u2713 overlap(${overlap}):`, key, '\u2192', value);
        return;
      }
    }

    // Alias-based match (exact only)
    const headerGroup = aliasMap.get(headerNorm);
    if (headerGroup !== undefined) {
      for (const [key, value] of Object.entries(filledValues)) {
        if (!value) continue;
        const keyGroup = aliasMap.get(normalizeStr(key));
        if (keyGroup !== undefined && keyGroup === headerGroup) {
          td.textContent = value;
          filledCells.add(td.dataset.coords);
          count++;
          debugLog('\u2713 alias:', key, '\u2192', headerText, '=', value);
          return;
        }
      }
    }
  });

  return count;
}

/**
 * Build a map: normalizedAlias -> groupId from data.json labels.
 * Labels with commas are split into multiple aliases sharing one group.
 */
function buildAliasMap() {
  const map = new Map();
  if (!jsonData?.categories) return map;
  let groupId = 0;
  const walk = (obj) => {
    if (obj.values) {
      for (const v of obj.values) {
        const aliases = v.label.split(',').map(a => normalizeStr(a.trim())).filter(a => a);
        const id = groupId++;
        for (const a of aliases) map.set(a, id);
      }
    }
    if (obj.categories) obj.categories.forEach(c => walk(c));
  };
  jsonData.categories.forEach(c => walk(c));
  return map;
}

/**
 * Fill empty cells from saved mapping memory.
 * Uses strict exact matching only.
 */
function applyMapping() {
  let count = 0;
  if (Object.keys(mappingData).length === 0) return count;

  const jsonFields = flattenJsonForPrompt(jsonData);

  forEachCellWithHeader((td, headerText) => {
    // Exact match first
    let mappedLabel = mappingData[headerText];
    if (!mappedLabel) {
      // Try normalized exact match
      const headerNorm = normalizeStr(headerText);
      for (const [k, v] of Object.entries(mappingData)) {
        if (normalizeStr(k) === headerNorm) {
          mappedLabel = v;
          break;
        }
      }
    }
    if (!mappedLabel) return;

    // Find value by mapped label (exact alias match)
    const mappedNorm = normalizeStr(mappedLabel);
    for (const f of jsonFields) {
      const aliases = f.field.split(',').map(a => normalizeStr(a.trim())).filter(a => a);
      if (aliases.some(a => a === mappedNorm)) {
        td.textContent = f.value;
        filledCells.add(td.dataset.coords);
        count++;
        debugLog(`\u2713 mapping: "${headerText}" \u2192 "${mappedLabel}" = ${f.value}`);
        return;
      }
    }
  });

  return count;
}

/**
 * Fill empty cells by fuzzy-matching headers to data.json labels directly.
 * Uses word-overlap scoring with a higher threshold.
 */
function applyJsonDirect() {
  let count = 0;
  const jsonFields = flattenJsonForPrompt(jsonData);

  forEachCellWithHeader((td, headerText) => {
    const headerNorm = normalizeStr(headerText);
    let bestMatch = null;
    let bestScore = 0;

    for (const f of jsonFields) {
      const aliases = f.field.split(',').map(a => normalizeStr(a.trim())).filter(a => a);
      for (const labelNorm of aliases) {
        let score = 0;
        if (headerNorm === labelNorm) {
          score = 100;
        } else {
          score = wordOverlapScore(headerNorm, labelNorm);
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = f;
        }
      }
    }
    if (bestMatch && bestScore >= 50) {
      td.textContent = bestMatch.value;
      filledCells.add(td.dataset.coords);
      count++;
      debugLog(`\u2713 JSON (score ${bestScore}):`, bestMatch.field, '\u2192', bestMatch.value);
    }
  });

  return count;
}

/**
 * Get unique headers of remaining empty cells.
 */
function getRemainingEmptyCells() {
  const result = [];
  forEachCellWithHeader((td, headerText) => {
    result.push(headerText);
  });
  return [...new Set(result)];
}

/**
 * Collect new mappings: document header -> data.json label
 * (for cells that were filled during this session).
 */
function collectNewMappings() {
  const newPairs = {};
  const jsonFields = flattenJsonForPrompt(jsonData);

  forEachCellWithHeader((td, headerText) => {
    const val = td.textContent.trim();
    if (!val || !filledCells.has(td.dataset.coords)) return;
    if (headerText.length < 3 || mappingData[headerText]) return;

    for (const f of jsonFields) {
      if (f.value === val) {
        const firstAlias = f.field.split(',')[0].trim();
        const headerNorm = normalizeStr(headerText);
        const aliases = f.field.split(',').map(a => normalizeStr(a.trim()));
        if (aliases.includes(headerNorm)) return;
        const headerWords = headerNorm.split(/\s+/).filter(w => w.length > 2);
        const labelWords = aliases.flatMap(a => a.split(/\s+/).filter(w => w.length > 2));
        const commonWords = headerWords.filter(w => labelWords.some(lw => lw.includes(w) || w.includes(lw)));
        if (commonWords.length === 0) {
          debugLog(`\u26a0 \u041c\u0430\u043f\u043f\u0438\u043d\u0433 \u043e\u0442\u0431\u0440\u043e\u0448\u0435\u043d (\u043d\u0435\u0442 \u043e\u0431\u0449\u0438\u0445 \u0441\u043b\u043e\u0432): "${headerText}" \u2192 "${firstAlias}"`);
          return;
        }
        newPairs[headerText] = firstAlias;
        return;
      }
    }
  }, { emptyOnly: false });

  return newPairs;
}
