# docx-llm-filler

Онлайн-сервис, который заполняет Word-шаблоны (`.docx`) с помощью LLM
(Google Gemini) и произвольного JSON-файла с данными. На входе — шаблон
и JSON, на выходе — заполненный `.docx`.

Есть и веб-интерфейс (форма загрузки), и REST API, так что сервисом можно
пользоваться как из браузера, так и из других систем.

## Возможности

- **Два режима заполнения.** Если в шаблоне есть плейсхолдеры вида
  `{{ имя }}`, `{ имя }` или `[ имя ]` — LLM возвращает словарь
  `{плейсхолдер: значение}` и они подставляются на места. Если плейсхолдеров
  нет — LLM проходит по абзацам и сам заполняет пустые поля, опираясь
  на JSON.
- **Любой JSON.** Как словарь готовых значений (`{"имя": "Иван"}`), так и
  база знаний / контекст, из которого модель извлекает нужные поля.
- **Замена провайдера.** В `app/gemini_client.py` определён протокол
  `LLMClient` — легко подключить Claude, OpenAI, YandexGPT и т.п.

## Требования

- Python 3.10+
- API-ключ Google Gemini (бесплатно получить: <https://aistudio.google.com/apikey>)

> Для free tier важно: модель `gemini-2.0-flash` гео-заблокирована в РФ и ряде других стран (возвращает `limit: 0`). По умолчанию используется `gemini-2.5-flash-lite` — она работает в free tier без геоограничений.

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
app/
  config.py         # переменные окружения
  gemini_client.py  # обёртка над google-genai + протокол LLMClient
  docx_filler.py    # режимы placeholder / freeform
  main.py           # FastAPI: /, /fill, /health
templates/index.html
static/style.css
tests/
```

## Лицензия

MIT
