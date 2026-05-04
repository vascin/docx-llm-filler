// ============================================
// Utility Functions
// ============================================

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(str) {
  return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function normalizeStr(s) {
  return s.toLowerCase()
    .replace(/[«»""„\(\)\[\]]/g, '')
    .replace(/[^\wа-яёА-ЯЁ0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertDocxColor(hex) {
  if (!hex || hex.length !== 6) return 'black';
  return '#' + hex;
}

function flattenJsonForPrompt(data) {
  const result = [];
  const flatten = (obj, path = '') => {
    if (obj.values && Array.isArray(obj.values)) {
      for (const v of obj.values) {
        result.push({ field: v.label, value: v.value, path: path + obj.name });
      }
    }
    if (obj.categories && Array.isArray(obj.categories)) {
      for (const cat of obj.categories) {
        flatten(cat, path + obj.name + ' > ');
      }
    }
  };
  if (data.categories) {
    for (const cat of data.categories) {
      flatten(cat);
    }
  }
  return result;
}

/**
 * Iterate all table cells, yielding { td, headerText } for each cell
 * that has a non-empty header in the previous column.
 * @param {object} opts
 * @param {boolean} opts.emptyOnly - if true (default), skip cells that already have text
 * @param {boolean} opts.filledOnly - if true, skip cells that are empty
 */
function forEachCellWithHeader(callback, { emptyOnly = true, filledOnly = false } = {}) {
  for (const td of document.querySelectorAll('table.preview td')) {
    const text = td.textContent.trim();
    if (emptyOnly && text) continue;
    if (filledOnly && !text) continue;
    const row = td.parentElement;
    const idx = Array.from(row.children).indexOf(td);
    const headerCell = idx > 0 ? row.children[idx - 1] : null;
    const headerText = headerCell ? headerCell.textContent.trim() : '';
    if (!headerText) continue;
    callback(td, headerText);
  }
}

/**
 * Find the position right after the closing tag for a given open tag.
 * Handles nested tags of the same name.
 */
function findClosingTag(xml, startPos, tagName) {
  const openTag = '<' + tagName;
  const closeTag = '</' + tagName + '>';
  let depth = 0;
  let i = startPos;

  while (i < xml.length) {
    const nextOpen = xml.indexOf(openTag, i);
    const nextClose = xml.indexOf(closeTag, i);

    if (nextClose < 0) return xml.length;

    if (nextOpen >= 0 && nextOpen < nextClose) {
      const charAfter = xml[nextOpen + openTag.length];
      if (charAfter === ' ' || charAfter === '>' || charAfter === '/') {
        depth++;
      }
      i = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth <= 0) return nextClose + closeTag.length;
      i = nextClose + closeTag.length;
    }
  }
  return xml.length;
}

/** Extract all text from <w:t> elements inside a cell XML string */
function extractXmlCellText(cellXml) {
  let text = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(cellXml)) !== null) {
    text += unescapeXml(m[1]);
  }
  return text;
}

function getCellInheritedRunProperties(cellXml) {
  const paragraphMarkProps = cellXml.match(
    /<w:pPr\b[^>]*>[\s\S]*?(<w:rPr[\s>][\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/
  );
  if (paragraphMarkProps) return paragraphMarkProps[1];

  const textRunProps = cellXml.match(
    /<w:r\b[^>]*>[\s\S]*?(<w:rPr[\s>][\s\S]*?<\/w:rPr>)[\s\S]*?<w:t[\s>][\s\S]*?<\/w:t>[\s\S]*?<\/w:r>/
  );
  if (textRunProps) return textRunProps[1];

  const anyRunProps = cellXml.match(
    /<w:r\b[^>]*>[\s\S]*?(<w:rPr[\s>][\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:r>/
  );
  return anyRunProps ? anyRunProps[1] : '';
}

/**
 * Replace text in a <w:tc> block while keeping all formatting intact.
 *
 * Strategy:
 * 1. If there are runs with <w:t>, put text in the first one, clear the rest.
 * 2. If no <w:t> exists but runs exist (style-only runs), create a NEW run
 *    after the last run in the first paragraph, copying rPr from pPr or
 *    an existing run. NEVER insert <w:t> into a run that didn't have one.
 * 3. If no runs at all, create a new run with rPr from pPr.
 */
function replaceCellText(cellXml, newText) {
  const escaped = escapeXml(newText);
  const needsPreserve = /^\s|\s$/.test(newText);
  const inheritedRpr = getCellInheritedRunProperties(cellXml);
  let firstRunDone = false;

  const result = cellXml.replace(
    /(<w:r\b[^>]*>)([\s\S]*?)(<\/w:r>)/g,
    (wholeRun, rOpen, rBody, rClose) => {
      if (!/<w:t[\s>]/.test(rBody)) return wholeRun;

      if (!firstRunDone) {
        firstRunDone = true;
        let isFirst = true;
        const hasRunProps = /<w:rPr[\s>]/.test(rBody);
        const newBody = rBody.replace(
          /(<w:t)(\s[^>]*)?(>[^<]*<\/w:t>)/g,
          (_, tOpen, tAttrs) => {
            if (isFirst) {
              isFirst = false;
              const attrs = tAttrs || '';
              const preserveAttr = needsPreserve && !/xml:space=/.test(attrs) ? ' xml:space="preserve"' : '';
              return `${tOpen}${attrs}${preserveAttr}>${escaped}</w:t>`;
            }
            return `${tOpen}${tAttrs || ''}></w:t>`;
          }
        );
        return rOpen + (hasRunProps ? '' : inheritedRpr) + newBody + rClose;
      } else {
        const clearedBody = rBody.replace(
          /(<w:t)(\s[^>]*)?(>[^<]*<\/w:t>)/g,
          (_, tOpen, tAttrs) => `${tOpen}${tAttrs || ''}></w:t>`
        );
        return rOpen + clearedBody + rClose;
      }
    }
  );

  if (!firstRunDone) {
    const tNode = `<w:t xml:space="preserve">${escaped}</w:t>`;
    const rPrBlock = inheritedRpr;
    const newRun = `<w:r>${rPrBlock}${tNode}</w:r>`;

    const firstPStart = result.indexOf('<w:p ');
    const firstPStartAlt = result.indexOf('<w:p>');
    const pStart = (firstPStart >= 0 && (firstPStartAlt < 0 || firstPStart <= firstPStartAlt))
      ? firstPStart : firstPStartAlt;

    if (pStart >= 0) {
      const pEnd = result.indexOf('</w:p>', pStart);
      if (pEnd >= 0) {
        const pContent = result.substring(pStart, pEnd);
        const lastRClose = pContent.lastIndexOf('</w:r>');
        if (lastRClose >= 0) {
          const insertPos = pStart + lastRClose + '</w:r>'.length;
          return result.substring(0, insertPos) + newRun + result.substring(insertPos);
        }
        return result.substring(0, pEnd) + newRun + result.substring(pEnd);
      }
    }

    const pClose = result.indexOf('</w:p>');
    if (pClose >= 0) {
      return result.substring(0, pClose) + newRun + result.substring(pClose);
    }
    const tcClose = result.lastIndexOf('</w:tc>');
    if (tcClose >= 0) {
      return result.substring(0, tcClose) + `<w:p>${newRun}</w:p>` + result.substring(tcClose);
    }
  }

  return result;
}
