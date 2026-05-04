// ============================================
// DOCX Parsing, Rendering & Saving
// ============================================

async function extractDocText() {
  const xmlStr = await zip.file('word/document.xml').async('string');
  const xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const body = xmlDoc.getElementsByTagNameNS(NS, 'body')[0];
  if (!body) return '';

  let text = '';
  for (const p of Array.from(body.getElementsByTagNameNS(NS, 'p'))) {
    for (const r of Array.from(p.getElementsByTagNameNS(NS, 'r'))) {
      for (const t of Array.from(r.getElementsByTagNameNS(NS, 't'))) {
        text += t.textContent + ' ';
      }
    }
    text += '\n';
  }

  let tableIdx = 0;
  for (const tbl of Array.from(body.getElementsByTagNameNS(NS, 'tbl'))) {
    text += `\n[Таблица ${tableIdx + 1}]\n`;
    for (const row of Array.from(tbl.getElementsByTagNameNS(NS, 'tr'))) {
      let rowText = '';
      for (const cell of Array.from(row.getElementsByTagNameNS(NS, 'tc'))) {
        let cellText = '';
        for (const p of Array.from(cell.getElementsByTagNameNS(NS, 'p'))) {
          for (const r of Array.from(p.getElementsByTagNameNS(NS, 'r'))) {
            for (const t of Array.from(r.getElementsByTagNameNS(NS, 't'))) {
              cellText += t.textContent + ' ';
            }
          }
        }
        rowText += cellText.trim() + ' | ';
      }
      text += rowText + '\n';
    }
    tableIdx++;
  }
  return text;
}

// ============================================
// Build Editor View
// ============================================
async function buildEditor() {
  const editorDiv = document.getElementById('editor');
  editorDiv.innerHTML = '';
  filledCells.clear();
  updateStats();

  const xmlStr = await zip.file('word/document.xml').async('string');
  const xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const body = xmlDoc.getElementsByTagNameNS(NS, 'body')[0];
  if (!body) throw new Error('w:body not found in document.xml');

  const pageDiv = document.createElement('div');
  pageDiv.className = 'page';
  editorDiv.innerHTML = '<div class="page-container"></div>';
  editorDiv.firstChild.appendChild(pageDiv);

  // Parse page size
  const pageWidthEl = xmlDoc.getElementsByTagNameNS(NS, 'pgSz')[0];
  const pageWidthTwips = pageWidthEl ? parseInt(pageWidthEl.getAttribute('w:w')) || 0 : 0;
  const fullPageWidth = pageWidthTwips
    ? pageWidthTwips / TWIPS_PER_POINT * POINTS_TO_PX
    : A4_WIDTH_POINTS * POINTS_TO_PX;

  // Parse page margins from w:pgMar
  const pgMar = xmlDoc.getElementsByTagNameNS(NS, 'pgMar')[0];
  let marginTop = 20, marginRight = 30, marginBottom = 20, marginLeft = 30;
  if (pgMar) {
    const mt = parseInt(pgMar.getAttribute('w:top')) || 0;
    const mr = parseInt(pgMar.getAttribute('w:right')) || 0;
    const mb = parseInt(pgMar.getAttribute('w:bottom')) || 0;
    const ml = parseInt(pgMar.getAttribute('w:left')) || 0;
    marginTop = mt / TWIPS_PER_POINT * POINTS_TO_PX;
    marginRight = mr / TWIPS_PER_POINT * POINTS_TO_PX;
    marginBottom = mb / TWIPS_PER_POINT * POINTS_TO_PX;
    marginLeft = ml / TWIPS_PER_POINT * POINTS_TO_PX;
  }

  contentWidth = fullPageWidth - marginLeft - marginRight;

  pageDiv.style.width = fullPageWidth + 'px';
  pageDiv.style.paddingTop = marginTop + 'px';
  pageDiv.style.paddingRight = marginRight + 'px';
  pageDiv.style.paddingBottom = marginBottom + 'px';
  pageDiv.style.paddingLeft = marginLeft + 'px';
  pageDiv.style.boxSizing = 'border-box';

  renderBodyContent(body, pageDiv, contentWidth);

  const outerPad = 48;
  const applyScale = () => {
    const availableWidth = editorDiv.clientWidth - outerPad * 2;
    const scale = Math.min(availableWidth / fullPageWidth, 1);
    pageDiv.style.transform = 'scale(' + scale + ')';
    pageDiv.style.transformOrigin = 'top center';
    pageDiv.style.margin = '0 auto';
  };
  applyScale();
  new ResizeObserver(applyScale).observe(editorDiv);
}

// ============================================
// Render Document Content
// ============================================
function renderBodyContent(body, pageDiv, contentWidth) {
  const contentDiv = document.createElement('div');
  contentDiv.className = 'doc-content';
  pageDiv.appendChild(contentDiv);

  let tableIdx = 0;
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeName === 'w:tbl') {
      contentDiv.appendChild(renderTable(child, tableIdx, contentWidth));
      tableIdx++;
    } else if (child.nodeName === 'w:p') {
      contentDiv.appendChild(renderParagraph(child));
    }
  }
}

function getDirectChildrenByTag(parent, localName) {
  return Array.from(parent.children).filter(el => el.localName === localName);
}

function getRowGridOffsets(row) {
  const trPr = getDirectChildrenByTag(row, 'trPr')[0];
  if (!trPr) return { gridBefore: 0, gridAfter: 0 };
  const before = getDirectChildrenByTag(trPr, 'gridBefore')[0];
  const after = getDirectChildrenByTag(trPr, 'gridAfter')[0];
  return {
    gridBefore: before ? (parseInt(before.getAttribute('w:val')) || 0) : 0,
    gridAfter: after ? (parseInt(after.getAttribute('w:val')) || 0) : 0
  };
}

function extractGridBeforeFromTrXml(trXml) {
  const trPrMatch = trXml.match(/<w:trPr\b[\s\S]*?<\/w:trPr>/);
  if (!trPrMatch) return 0;
  const gridBeforeMatch = trPrMatch[0].match(/<w:gridBefore\b[^>]*w:val="(\d+)"/);
  return gridBeforeMatch ? (parseInt(gridBeforeMatch[1], 10) || 0) : 0;
}

function ensureFixedTableLayout(tblXml) {
  const hasFixedLayout = /<w:tblLayout\b[^>]*w:type="fixed"/.test(tblXml);
  if (hasFixedLayout) return tblXml;

  const tblPrStart = tblXml.indexOf('<w:tblPr');
  if (tblPrStart >= 0) {
    const tblPrEnd = findClosingTag(tblXml, tblPrStart, 'w:tblPr');
    const tblPrXml = tblXml.substring(tblPrStart, tblPrEnd);
    if (/<w:tblLayout\b/.test(tblPrXml)) {
      const updatedTblPr = tblPrXml.replace(
        /<w:tblLayout\b[^>]*\/>/,
        '<w:tblLayout w:type="fixed"/>'
      );
      return tblXml.substring(0, tblPrStart) + updatedTblPr + tblXml.substring(tblPrEnd);
    }
    const insertPos = tblPrEnd - '</w:tblPr>'.length;
    return tblXml.substring(0, insertPos) + '<w:tblLayout w:type="fixed"/>' + tblXml.substring(insertPos);
  }

  const tblOpenEnd = tblXml.indexOf('>');
  if (tblOpenEnd > 0) {
    return (
      tblXml.substring(0, tblOpenEnd + 1) +
      '<w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
      tblXml.substring(tblOpenEnd + 1)
    );
  }
  return tblXml;
}

function renderTable(tbl, tableIdx, pctWidth) {
  const htmlTable = document.createElement('table');
  htmlTable.className = 'preview';
  htmlTable.dataset.tableIdx = tableIdx;
  htmlTable.style.tableLayout = 'fixed';

  // Parse table indent from left margin (w:tblInd)
  const tblPr = getDirectChildrenByTag(tbl, 'tblPr')[0];
  let tblIndentPx = 0;
  if (tblPr) {
    const tblInd = getDirectChildrenByTag(tblPr, 'tblInd')[0];
    if (tblInd) {
      const indW = parseInt(tblInd.getAttribute('w:w')) || 0;
      const indType = tblInd.getAttribute('w:type');
      if (indType !== 'pct' && indW > 0) {
        tblIndentPx = indW / TWIPS_PER_POINT * POINTS_TO_PX;
      }
    }
  }

  // Parse grid column widths
  const grid = getDirectChildrenByTag(tbl, 'tblGrid')[0];
  const gridColWidths = [];
  const gridColTypes = [];
  if (grid) {
    for (const col of getDirectChildrenByTag(grid, 'gridCol')) {
      const w = col.getAttribute('w:w');
      const type = col.getAttribute('w:type');
      if (w) {
        if (type === 'pct') {
          gridColWidths.push(parseInt(w) / 100);
          gridColTypes.push('pct');
        } else {
          gridColWidths.push(parseInt(w) / TWIPS_PER_POINT * POINTS_TO_PX);
          gridColTypes.push('dxa');
        }
      }
    }
  }

  // Compute scale factor to fit columns within content width
  const allDxa = gridColTypes.every(t => t === 'dxa');
  const availableWidth = pctWidth - tblIndentPx;
  let colScale = 1;
  if (allDxa && gridColWidths.length > 0) {
    const totalPx = gridColWidths.reduce((a, b) => a + b, 0);
    if (totalPx > availableWidth && availableWidth > 0) {
      colScale = availableWidth / totalPx;
      for (let i = 0; i < gridColWidths.length; i++) {
        gridColWidths[i] = gridColWidths[i] * colScale;
      }
    }
  }

  if (allDxa && gridColWidths.length > 0) {
    const totalPx = gridColWidths.reduce((a, b) => a + b, 0);
    htmlTable.style.width = totalPx + 'px';
  } else {
    htmlTable.style.width = '100%';
  }

  if (tblIndentPx > 0) {
    htmlTable.style.marginLeft = tblIndentPx + 'px';
  }

  if (gridColWidths.length > 0) {
    const colgroup = document.createElement('colgroup');
    gridColWidths.forEach((w, idx) => {
      const col = document.createElement('col');
      col.style.width = gridColTypes[idx] === 'pct' ? `${w * 100}%` : `${w}px`;
      colgroup.appendChild(col);
    });
    htmlTable.appendChild(colgroup);
  }

  // Parse rows and cells
  const rows = getDirectChildrenByTag(tbl, 'tr');
  const rowInfos = [];
  const cellWidths = [];
  const cellWidthTypes = [];

  const parsedRows = rows.map(row => {
    const cells = getDirectChildrenByTag(row, 'tc');
    const offsets = getRowGridOffsets(row);
    const parsedCells = [];
    let gridPos = offsets.gridBefore;

    cells.forEach(cell => {
      const tcPr = getDirectChildrenByTag(cell, 'tcPr')[0];
      let colspan = 1;
      let vMergeVal = null;

      if (tcPr) {
        const gridSpan = getDirectChildrenByTag(tcPr, 'gridSpan')[0];
        if (gridSpan) colspan = parseInt(gridSpan.getAttribute('w:val')) || 1;

        const tcW = getDirectChildrenByTag(tcPr, 'tcW')[0];
        if (tcW && !cellWidths[gridPos]) {
          const w = tcW.getAttribute('w:w');
          const type = tcW.getAttribute('w:type');
          if (w) {
            if (type === 'pct') {
              cellWidths[gridPos] = parseInt(w) / 5000;
              cellWidthTypes[gridPos] = 'pct';
            } else {
              cellWidths[gridPos] = parseInt(w) / TWIPS_PER_POINT * POINTS_TO_PX;
              cellWidthTypes[gridPos] = 'dxa';
            }
          }
        }

        const vMerge = getDirectChildrenByTag(tcPr, 'vMerge')[0];
        if (vMerge) vMergeVal = vMerge.getAttribute('w:val') || '';
      }

      if (!cellWidths[gridPos] && gridColWidths[gridPos] !== undefined) {
        cellWidths[gridPos] = gridColWidths[gridPos];
        cellWidthTypes[gridPos] = gridColTypes[gridPos];
      }

      parsedCells.push({
        element: cell,
        startCol: gridPos,
        colspan,
        vMergeVal,
        text: extractDomCellText(cell)
      });
      gridPos += colspan;
    });

    return { cells: parsedCells, gridBefore: offsets.gridBefore, gridAfter: offsets.gridAfter };
  });

  // Apply same scale factor to cell widths
  if (colScale < 1) {
    for (let i = 0; i < cellWidths.length; i++) {
      if (cellWidths[i] !== undefined && cellWidthTypes[i] === 'dxa') {
        cellWidths[i] = cellWidths[i] * colScale;
      }
    }
  }

  parsedRows.forEach((rowData, rIdx) => {
    const rowInfo = { cells: [] };
    rowData.cells.forEach(cellInfo => {
      let rowspan = 1;

      const isVMergeContinuation = cellInfo.vMergeVal !== null && cellInfo.vMergeVal !== 'restart';
      if (isVMergeContinuation) {
        rowspan = 0;
      } else if (cellInfo.vMergeVal === 'restart') {
        let count = 1;
        for (let checkRow = rIdx + 1; checkRow < parsedRows.length; checkRow++) {
          const overlapping = parsedRows[checkRow].cells.find(c =>
            c.startCol <= cellInfo.startCol && cellInfo.startCol < c.startCol + c.colspan
          );
          if (!overlapping || overlapping.vMergeVal === null || overlapping.vMergeVal === 'restart') break;
          count++;
        }
        rowspan = count;
      }

      rowInfo.cells.push({
        element: cellInfo.element,
        colspan: cellInfo.colspan,
        rowspan,
        text: cellInfo.text
      });
    });

    if (rowData.gridBefore > 0) {
      rowInfo.cells.unshift({
        element: null,
        colspan: rowData.gridBefore,
        rowspan: 1,
        text: '',
        isOffset: true
      });
    }
    if (rowData.gridAfter > 0) {
      rowInfo.cells.push({
        element: null,
        colspan: rowData.gridAfter,
        rowspan: 1,
        text: '',
        isOffset: true
      });
    }
    rowInfos.push(rowInfo);
  });

  // Render HTML rows
  rowInfos.forEach((rowInfo, rIdx) => {
    const tr = htmlTable.insertRow();
    let colIdx = 0;

    rowInfo.cells.forEach(cellInfo => {
      if (cellInfo.rowspan === 0) {
        colIdx += cellInfo.colspan;
        return;
      }

      const td = tr.insertCell();
      if (cellInfo.colspan > 1) td.colSpan = cellInfo.colspan;
      if (cellInfo.rowspan > 1) td.rowSpan = cellInfo.rowspan;

      if (cellInfo.isOffset) {
        td.className = 'table-offset-cell';
        td.contentEditable = false;
        colIdx += cellInfo.colspan;
        return;
      }

      td.contentEditable = true;
      td.dataset.coords = `${tableIdx},${rIdx},${colIdx}`;
      td.textContent = cellInfo.text;

      td.addEventListener('dragover', e => { e.preventDefault(); td.classList.add('drop-active'); });
      td.addEventListener('dragleave', () => td.classList.remove('drop-active'));
      td.addEventListener('drop', e => {
        e.preventDefault();
        td.classList.remove('drop-active');
        const val = e.dataTransfer.getData('text/plain');
        if (val) {
          td.textContent = val;
          filledCells.add(td.dataset.coords);
          hasUnsavedDoc = true;
          updateStats();
        }
      });
      td.addEventListener('input', () => {
        filledCells.add(td.dataset.coords);
        hasUnsavedDoc = true;
      });
      td.addEventListener('blur', () => {
        filledCells.add(td.dataset.coords);
        hasUnsavedDoc = true;
        updateStats();
      });

      colIdx += cellInfo.colspan;
    });
  });

  // Apply column widths
  if (gridColWidths.length === 0 && cellWidths.length > 0 && htmlTable.rows[0]) {
    let gp = 0;
    for (const cell of htmlTable.rows[0].cells) {
      const span = cell.colSpan || 1;
      let totalW = 0;
      let hasWidth = false;
      for (let s = 0; s < span; s++) {
        if (cellWidths[gp + s] !== undefined) {
          totalW += cellWidths[gp + s];
          hasWidth = true;
        }
      }
      if (hasWidth) {
        cell.style.width = cellWidthTypes[gp] === 'pct' ? (totalW * 100) + '%' : totalW + 'px';
      }
      gp += span;
    }
  }

  return htmlTable;
}

/** Extract text from a DOM cell element */
function extractDomCellText(cell) {
  let text = '';
  for (const p of Array.from(cell.getElementsByTagNameNS(NS, 'p'))) {
    for (const r of Array.from(p.getElementsByTagNameNS(NS, 'r'))) {
      for (const t of Array.from(r.getElementsByTagNameNS(NS, 't'))) {
        text += t.textContent;
      }
    }
  }
  return text;
}

function renderParagraph(p) {
  const para = document.createElement('p');
  para.style.margin = '0';
  para.style.minHeight = '1em';

  for (const run of Array.from(p.getElementsByTagNameNS(NS, 'r'))) {
    for (const t of Array.from(run.getElementsByTagNameNS(NS, 't'))) {
      const span = document.createElement('span');
      span.textContent = t.textContent;

      const rPr = run.getElementsByTagNameNS(NS, 'rPr')[0];
      if (rPr) {
        if (rPr.getElementsByTagNameNS(NS, 'b')[0]) span.style.fontWeight = 'bold';
        if (rPr.getElementsByTagNameNS(NS, 'i')[0]) span.style.fontStyle = 'italic';
        if (rPr.getElementsByTagNameNS(NS, 'u')[0]) span.style.textDecoration = 'underline';
        const color = rPr.getElementsByTagNameNS(NS, 'color')[0];
        if (color) span.style.color = convertDocxColor(color.getAttribute('w:val'));
        const sz = rPr.getElementsByTagNameNS(NS, 'sz')[0];
        if (sz) span.style.fontSize = (parseInt(sz.getAttribute('w:val')) / 2) + 'pt';
      }
      para.appendChild(span);
    }
  }
  return para;
}

// ============================================
// Save DOCX (string-based XML replacement)
// ============================================
async function saveDocx() {
  if (!zip) return;

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = ' Сохранение...';

  try {
    let xmlStr = await zip.file('word/document.xml').async('string');

    // Collect only changed cell updates from HTML.
    // Rewriting untouched cells can alter Word layout/line wrapping.
    const updates = new Map();
    for (const coords of filledCells) {
      const td = document.querySelector(`table.preview td[data-coords="${coords}"]`);
      if (td) updates.set(coords, td.textContent);
    }

    // Walk through XML, replacing cell text
    let tableIdx = 0;
    let pos = 0;
    let newXml = '';
    let totalUpdated = 0;

    while (pos < xmlStr.length) {
      const tblStart = xmlStr.indexOf('<w:tbl', pos);
      if (tblStart < 0) {
        newXml += xmlStr.substring(pos);
        break;
      }

      newXml += xmlStr.substring(pos, tblStart);
      const tblEnd = findClosingTag(xmlStr, tblStart, 'w:tbl');
      const tblXml = xmlStr.substring(tblStart, tblEnd);
      const tblXmlFixed = ensureFixedTableLayout(tblXml);

      // Process rows
      let rowIdx = 0;
      let tblPos = 0;
      let newTbl = '';

      while (tblPos < tblXmlFixed.length) {
        const trStart = tblXmlFixed.indexOf('<w:tr', tblPos);
        if (trStart < 0) {
          newTbl += tblXmlFixed.substring(tblPos);
          break;
        }

        newTbl += tblXmlFixed.substring(tblPos, trStart);
        const trEnd = findClosingTag(tblXmlFixed, trStart, 'w:tr');
        const trXml = tblXmlFixed.substring(trStart, trEnd);

        // Process cells
        let htmlColIdx = extractGridBeforeFromTrXml(trXml);
        let trPos = 0;
        let newTr = '';

        while (trPos < trXml.length) {
          const tcStart = trXml.indexOf('<w:tc', trPos);
          if (tcStart < 0) {
            newTr += trXml.substring(trPos);
            break;
          }

          newTr += trXml.substring(trPos, tcStart);
          const tcEnd = findClosingTag(trXml, tcStart, 'w:tc');
          let tcXml = trXml.substring(tcStart, tcEnd);

          const gridSpanMatch = tcXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
          const colspan = gridSpanMatch ? parseInt(gridSpanMatch[1]) : 1;

          const isVMergeCont = /<w:vMerge\s*\/>/.test(tcXml) ||
            (/<w:vMerge\b/.test(tcXml) && !/<w:vMerge\b[^>]*w:val\s*=\s*"restart"/.test(tcXml));

          if (!isVMergeCont) {
            const coords = `${tableIdx},${rowIdx},${htmlColIdx}`;
            const newText = updates.get(coords);
            if (newText !== undefined) {
              const origText = extractXmlCellText(tcXml);
              if (newText !== origText) {
                tcXml = replaceCellText(tcXml, newText);
                totalUpdated++;
              }
            }
          }
          htmlColIdx += colspan;

          newTr += tcXml;
          trPos = tcEnd;
        }

        newTbl += newTr;
        tblPos = trEnd;
        rowIdx++;
      }

      newXml += newTbl;
      pos = tblEnd;
      tableIdx++;
    }

    zip.file('word/document.xml', newXml);
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    saveAs(blob, `filled_${Date.now()}.docx`);

    hasUnsavedDoc = false;
    showToast(`✅ Документ сохранён! Обновлено ячеек: ${totalUpdated}`, 'success');

    // Save new mappings after manual review
    if (filledCells.size > 0) {
      const newMappings = collectNewMappings();
      if (Object.keys(newMappings).length > 0) {
        await saveMapping(newMappings);
        debugLog(`💾 Запомнено ${Object.keys(newMappings).length} сопоставлений:`, newMappings);
      }
    }
  } catch (err) {
    console.error(err);
    showToast('❌ Ошибка сохранения: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Скачать';
  }
}

// collectNewMappings is defined in matching.js
