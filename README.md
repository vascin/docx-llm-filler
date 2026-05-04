# docx-llm-filler

Два инструмента для заполнения Word-шаблонов (`.docx`) с помощью LLM.

## Два варианта использования

### 1. Браузерный редактор (`editor/`)

Standalone HTML-приложение (без Node.js) с рендерингом документа прямо в браузере.

- Рендеринг DOCX с корректными полями страницы и шириной таблиц
- Дерево JSON-данных с drag-and-drop в ячейки документа
- 5 LLM-провайдеров: Gemini, Wormsoft, GigaChat, YandexGPT, Ollama
- Серверный прокси для Gemini (обход гео-блокировки)
- Тёмная/светлая тема
- Автоподстановка дат

**Запуск:** открыть `editor/editor.html` в браузере или через сервер:
```bash
pip install fastapi uvicorn httpx
cd editor && uvicorn server:app --reload
```

**Деплой:** https://docx-editor-jirstmod.fly.dev/

### 2. Серверный API (`app/`)

FastAPI-сервис с REST API и веб-формой загрузки.

- Два режима: по плейсхолдерам (`{{ имя }}`) и свободный (LLM сам находит пустые поля)
- 3 LLM-провайдера: Gemini, GigaChat, YandexGPT
- Поддержка .json, .txt, .md, .csv, .xlsx, .docx как источник данных
- Ключи вводятся только на странице — сервер их не хранит

## Требования

- **Редактор:** современный браузер (Chrome, Firefox, Edge)
- **API:** Python 3.10+, API-ключ одного из провайдеров

> Gemini: модель `gemini-2.5-flash` работает в free tier. Из РФ доступна через серверный прокси.

## Установка

```bash
git clone <repo-url>
cd docx-llm-filler

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
# либо: pip install -e ".[dev]"

cp .env.example .env
# отредактируйте .env и вставьте GEMINI_API_KEY
```

## Запуск

```bash
uvicorn app.main:app --reload
# UI откроется на http://127.0.0.1:8000
```

## Использование через API

```bash
curl -X POST http://127.0.0.1:8000/fill \
  -F "template=@examples/invoice_template.docx" \
  -F "data=@examples/invoice_data.json" \
  -o invoice.filled.docx
```

Ответ — бинарный `.docx`. Служебные заголовки:

| Заголовок | Значение |
| --- | --- |
| `X-Fill-Mode` | `placeholder` или `freeform` |
| `X-Fill-Changed-Paragraphs` | сколько абзацев было изменено |

## Формат плейсхолдеров

Все три варианта поддерживаются одновременно и могут встречаться вперемешку:

```
Уважаемый(ая) {{ client_name }},

Сумма к оплате: { amount } руб.
Срок: [ due_date ]
```

Если в документе нет ни одного плейсхолдера, сервис автоматически
переключится в **free-form** режим и попытается заполнить пустые поля
по смыслу.

## Разработка

```bash
pip install -e ".[dev]"
pytest            # unit-тесты (LLM замокан)
ruff check .      # линт
```

Тесты работают без сетевого доступа: `tests/test_docx_filler.py`
подменяет LLM классом-заглушкой.

## Структура

```
editor/               # Браузерный редактор
  editor.html         # Главная страница
  js/                 # JS-модули (state, utils, ui, tree, docx, ai, ...)
  css/style.css       # Стили с CSS-переменными для тем
  server.py           # FastAPI-сервер + Gemini-прокси
  data.json           # Данные с автоподстановкой дат
app/                  # Серверный API
  config.py           # Переменные окружения
  gemini_client.py    # Google Gemini + протокол LLMClient
  gigachat_client.py  # GigaChat (Сбер) с Russian Trusted CA
  yandex_client.py    # YandexGPT
  docx_filler.py      # Режимы placeholder / freeform
  main.py             # FastAPI: /, /fill, /health
templates/index.html  # UI для серверного API
static/style.css
tests/
```

## Лицензия

MIT
