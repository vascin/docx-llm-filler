// ============================================
// JSON Tree Editor
// ============================================

let expandTimer = null;

function createGroupElement(name = "Новый уровень") {
  const div = document.createElement('div');
  div.className = 'group';
  div.innerHTML = `
    <div class="group-header">
      <span class="group-handle" draggable="true">⠿</span>
      <span class="group-toggle">▼</span>
      <span class="group-title editable"></span>
      <div class="group-actions">
        <button class="btn btn-muted btn-sm" onclick="addItemToGroup(this)">＋ Поле</button>
        <button class="btn btn-muted btn-sm" onclick="addGroupToGroup(this)">＋ Уровень</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGroup(this)">✕</button>
      </div>
    </div>
    <div class="group-content"></div>
  `;

  const titleEl = div.querySelector('.group-title');
  titleEl.textContent = name;
  titleEl.addEventListener('blur', () => updateJsonFromTree());

  const handle = div.querySelector('.group-handle');
  const toggle = div.querySelector('.group-toggle');
  const content = div.querySelector('.group-content');

  toggle.onclick = (e) => {
    e.stopPropagation();
    const isHidden = content.classList.toggle('hidden');
    toggle.innerText = isHidden ? '▶' : '▼';
  };

  handle.ondragstart = (e) => { e.stopPropagation(); div.classList.add('dragging'); };
  handle.ondragend = () => { div.classList.remove('dragging'); updateJsonFromTree(); };

  initDragContainer(content, div);
  return div;
}

function createItemElement(label = "Название", value = "Значение") {
  const div = document.createElement('div');
  div.className = 'item';
  div.dataset.value = value;
  div.innerHTML = `
    <span class="item-handle" draggable="true">⠿</span>
    <button class="item-drag" draggable="true" title="Перетащить в документ">📋</button>
    <span class="item-label editable"></span>
    <span class="item-value editable"></span>
    <button class="item-del" onclick="this.parentElement.remove(); updateJsonFromTree()">✕</button>
  `;

  const labelEl = div.querySelector('.item-label');
  labelEl.textContent = label;
  labelEl.addEventListener('blur', () => updateJsonFromTree());

  const valueEl = div.querySelector('.item-value');
  valueEl.textContent = value;
  valueEl.addEventListener('blur', () => updateJsonFromTree());

  const handle = div.querySelector('.item-handle');
  handle.ondragstart = (e) => { e.stopPropagation(); div.classList.add('dragging'); };
  handle.ondragend = () => { div.classList.remove('dragging'); updateJsonFromTree(); };

  const dragBtn = div.querySelector('.item-drag');
  dragBtn.ondragstart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', div.dataset.value || div.querySelector('.item-value').innerText);
  };

  return div;
}

// ============================================
// Tree CRUD
// ============================================
function addRootGroup() {
  document.getElementById('treeContainer').appendChild(createGroupElement());
}

function addItemToGroup(btn) {
  const content = btn.closest('.group').querySelector('.group-content');
  content.appendChild(createItemElement());
  content.classList.remove('hidden');
  content.closest('.group').querySelector('.group-toggle').innerText = '▼';
  updateJsonFromTree();
}

function addGroupToGroup(btn) {
  const content = btn.closest('.group').querySelector('.group-content');
  content.appendChild(createGroupElement());
  content.classList.remove('hidden');
  content.closest('.group').querySelector('.group-toggle').innerText = '▼';
  updateJsonFromTree();
}

function deleteGroup(btn) {
  if (confirm('Удалить уровень?')) {
    btn.closest('.group').remove();
    updateJsonFromTree();
  }
}

// ============================================
// Drag & Drop
// ============================================
function initDragContainer(container, parentGroup = null) {
  container.ondragover = (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.add('drag-over');

    const dragging = document.querySelector('.dragging');
    if (!dragging || dragging === parentGroup) return;

    if (parentGroup && container.classList.contains('hidden')) {
      if (!expandTimer) {
        expandTimer = setTimeout(() => {
          container.classList.remove('hidden');
          parentGroup.querySelector('.group-toggle').innerText = '▼';
          expandTimer = null;
        }, 600);
      }
    }

    const afterElement = getDragAfterElement(container, e.clientY);
    if (!afterElement) container.appendChild(dragging);
    else container.insertBefore(dragging, afterElement);
  };
  container.ondragleave = () => {
    container.classList.remove('drag-over');
    clearTimeout(expandTimer);
    expandTimer = null;
  };
  container.ondrop = () => container.classList.remove('drag-over');
}

function getDragAfterElement(container, y) {
  const elements = [...container.querySelectorAll(':scope > .item:not(.dragging), :scope > .group:not(.dragging)')];
  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ============================================
// Build / Serialize
// ============================================
function buildTreeFromJson() {
  const container = document.getElementById('treeContainer');
  container.innerHTML = '';

  if (!jsonData || !jsonData.categories || jsonData.categories.length === 0) {
    container.innerHTML = '<div class="empty-tree">Нет данных</div>';
    return;
  }

  jsonData.categories.forEach(cat => buildGroupRecursive(cat, container));
  initDragContainer(container);
}

function buildGroupRecursive(node, target) {
  const group = createGroupElement(node.name || "Уровень");
  const content = group.querySelector('.group-content');

  content.classList.add('hidden');
  group.querySelector('.group-toggle').innerText = '▶';

  target.appendChild(group);

  if (node.values && Array.isArray(node.values)) {
    node.values.forEach(v => content.appendChild(createItemElement(v.label, v.value)));
  }
  if (node.categories && Array.isArray(node.categories)) {
    node.categories.forEach(c => buildGroupRecursive(c, content));
  }
}

function toggleAllGroups(show) {
  document.querySelectorAll('.group-content').forEach(c => {
    if (show) c.classList.remove('hidden');
    else c.classList.add('hidden');
  });
  document.querySelectorAll('.group-toggle').forEach(t => {
    t.innerText = show ? '▼' : '▶';
  });
}

function updateJsonFromTree() {
  const container = document.getElementById('treeContainer');
  jsonData.categories = serialize(container);
  hasUnsavedChanges = true;
  setSaveButtonState();
}

function serialize(container) {
  return [...container.querySelectorAll(':scope > .group')].map(group => {
    const inner = group.querySelector('.group-content');
    return {
      name: group.querySelector('.group-title').innerText,
      values: [...inner.querySelectorAll(':scope > .item')].map(item => ({
        label: item.querySelector('.item-label').innerText,
        value: item.querySelector('.item-value').innerText
      })),
      categories: serialize(inner)
    };
  });
}

// ============================================
// JSON Load / Save
// ============================================
function replaceDatePlaceholders(obj) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const today = `${dd}.${mm}.${yyyy}`;
  const replacements = { '__TODAY__': today, '__YEAR__': String(yyyy) };
  if (Array.isArray(obj?.categories)) {
    for (const cat of obj.categories) {
      if (Array.isArray(cat.values)) {
        for (const v of cat.values) {
          if (replacements[v.value]) v.value = replacements[v.value];
        }
      }
      replaceDatePlaceholders(cat);
    }
  }
}

async function loadJsonData() {
  try {
    const response = await fetch('data.json?t=' + Date.now());
    if (response.ok) {
      jsonData = await response.json();
      replaceDatePlaceholders(jsonData);
      console.log('JSON загружен из data.json');
    } else {
      console.log('data.json не найден, используем пустую структуру');
    }
  } catch (e) {
    console.log('Ошибка загрузки data.json:', e.message);
  }
}

async function saveJsonData() {
  updateJsonFromTree();
  const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function saveTreeJSON() {
  saveJsonData();
  hasUnsavedChanges = false;
  setSaveButtonState();
  showToast('✅ JSON сохранён!', 'success');
}

async function loadMapping() {
  try {
    const response = await fetch('mapping.json?t=' + Date.now());
    if (response.ok) {
      mappingData = await response.json();
      console.log(`Mapping загружен: ${Object.keys(mappingData).length} сопоставлений`);
    }
  } catch (e) {
    console.log('mapping.json не загружен:', e.message);
  }
}

async function saveMapping(newPairs) {
  if (!newPairs || Object.keys(newPairs).length === 0) return;
  try {
    await fetch('save-mapping.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPairs)
    });
    Object.assign(mappingData, newPairs);
    debugLog(`💾 Сохранено ${Object.keys(newPairs).length} новых сопоставлений`);
  } catch (e) {
    debugLog('Ошибка сохранения mapping:', e.message);
  }
}
