# AGENTS.md - Development Guidelines

Browser-based web application for filling DOCX templates with JSON data. No Node.js/npm required.

## Project Structure

```
editor.html          - Main app (HTML only, loads CSS & JS modules)
css/style.css        - All styles (theming, layout, components)
js/state.js          - Global state & constants (NS, filledCells, etc.)
js/utils.js          - Utility functions (escapeXml, normalizeStr, replaceCellText, etc.)
js/ui.js             - UI helpers (showToast, debugLog, theme, edit mode, resizer)
js/tree.js           - JSON tree editor (create/serialize/drag, load/save JSON)
js/docx.js           - DOCX parsing, rendering & saving
js/ai.js             - AI fill logic (Ollama, Gemini, GigaChat, Yandex)
js/main.js           - Initialization, event listeners, keyboard shortcuts
data.json            - Data file (auto-loaded)
mapping.json         - Learned header→label mappings
prompts/ai-fill.txt  - AI prompt template
jszip.min.js         - DOCX handling library (vendored)
FileSaver.min.js     - File saving library (vendored)
gigachat-proxy.php   - PHP proxy for GigaChat API
save-mapping.php     - PHP endpoint for saving mappings
test_parse.html      - Browser-based unit tests for parseOllamaResponse
tests/               - Playwright e2e tests
```

Script load order in editor.html (dependencies flow top→down):
`state.js → utils.js → ui.js → tree.js → docx.js → ai.js → main.js`

## Running/Testing

**No build system.** Open HTML files in browser directly.

**Important:** When running locally (file://), libraries must be in the same folder as HTML files:
- jszip.min.js
- FileSaver.min.js

## Code Style

### JavaScript
- Use ES6+: `const`/`let`, arrow functions, template literals
- Prefer `const`, use `let` only when reassignment needed
- Variable names in English, UI strings in Russian
- Error handling: use try/catch for JSON parsing, .catch() for async

```javascript
// Good
const treeContainer = document.getElementById('tree');
const handleDragStart = (e) => { … };
// Avoid: var, function declarations
```

### HTML
```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>DOCX Editor</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <!-- HTML markup only, no inline JS/CSS -->
  <script src="js/state.js"></script>
  <script src="js/utils.js"></script>
  <!-- ... -->
</body>
</html>
```

### CSS
- CSS custom properties for theming
- BEM-like class names: `.tree__item`, `.tree__label`
- Flexbox/grid for layout

### JSON Structure (data.json)
```json
{
  "categories": [
    {
      "name": "Category",
      "values": [{ "label": "Field", "value": "Value" }],
      "categories": [{ "name": "Sub", "values": [], "categories": [] }]
    }
  ]
}
```
- Preserve structure (categories → values + categories)
- Russian text for labels
- Validate JSON syntax after changes

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables/Functions | camelCase | `treeData`, `handleDragStart()` |
| CSS classes | BEM-like | `tree__item`, `tree__label` |
| HTML ids | camelCase | `treeContainer`, `editorPanel` |
| JSON keys | camelCase | `name`, `values`, `categories` |

### Imports
Libraries loaded via `<script src="">` (no npm):
- jszip.min.js - DOCX handling
- FileSaver.min.js - File saving

### Formatting
- Indent: 2 spaces
- No trailing whitespace
- Max line: 120 chars

### Keyboard Shortcuts
- Save: Ctrl+S / Cmd+S
- Open DOCX: Ctrl+O / Cmd+O

## Error Handling

### JSON Parsing
```javascript
try {
  const data = JSON.parse(jsonString);
} catch (e) {
  console.error('Invalid JSON:', e);
  alert('Ошибка JSON: ' + e.message);
}
```

### File Loading
```javascript
fetch('data.json')
  .then(r => r.json())
  .then(data => { … })
  .catch(err => { console.error(err); alert('Не удалось загрузить'); });
```

### File Saving
Use FileSaver.saveAs() from vendored library. Note: direct saving
requires user interaction (button click).

## Debugging

- Open browser DevTools (F12)
- Check Console for errors
- Use console.log() for debugging
- Inspect DOM with Elements panel

## Common Tasks

### Adding a New Field
1. Click "Загрузить" to load data.json (or open via file dialog)
2. Click "＋ Уровень" to add a category
3. Click "＋ Поле" inside category to add a field
4. Click "Сохранить" to save changes

### Adding a New Category
1. Click "＋ Уровень" in the tree panel
2. Enter category name
3. Add fields inside

### Automated Tests (Playwright)
```bash
npx playwright test              # run all tests
npx playwright test --reporter=line  # compact output
```
Tests are in `tests/docx-save.spec.js` and verify DOCX save integrity:
- No new fonts introduced
- Run properties (rPr), paragraph properties (pPr), cell properties (tcPr) preserved
- No duplicate xmlns:w declarations
- Table structure (tables, rows, vMerge, gridSpan) intact
- All original namespaces preserved

Requires Laragon (or any local server) serving at `http://localhost/filler/`.

### Testing Single Operation
Perform manually in browser.

## AI / Ollama

- Ollama requests go directly from browser to `http://127.0.0.1:11434` (no PHP proxy)
- Requires `OLLAMA_ORIGINS=*` environment variable for CORS
- Streaming enabled (`stream: true`) for real-time response display
- Default model: `gemma3:1b` (lightweight, good for CPU-only machines)
- Options: `temperature: 0`, `num_ctx: 2048` for speed
- Prompt sends only empty cells with their headers, not full document text

## Notes
- Standalone HTML app, not Node.js
- Git initialized
- User-facing text in Russian
- Data saves via "Сохранить" button (FileSaver library)
- Load JSON manually via "Загрузить" button