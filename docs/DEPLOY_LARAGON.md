# Развёртывание на своём сервере под Laragon (Windows)

Инструкция для запуска приложения у себя на сервере с Laragon-ом (Apache
+ PHP + MySQL на Windows), чтобы не зависеть от Fly.io или любого
другого стороннего сервиса.

## Что получится в итоге

```
Браузер  →  Apache (Laragon, порт 80/443)  →  Uvicorn (Python 3.12, порт 8000)
                    ↑                                 ↑
            HTTPS и домен                    FastAPI + Gemini
```

Apache Laragon-а будет работать «прокси» (как обычно отдаёт ваши
PHP-проекты), а само приложение — отдельным процессом Python на
внутреннем порту `8000`. Снаружи всё выглядит как обычный сайт по
вашему адресу.

## Шаг 1. Установить Python 3.12

1. Скачайте Python 3.12 (Windows installer, 64-bit) с
   <https://www.python.org/downloads/windows/>.
2. В установщике **обязательно поставьте галку «Add python.exe to PATH»**.
3. После установки откройте **PowerShell** и проверьте:

   ```powershell
   python --version
   ```

   Должно показать `Python 3.12.x`.

## Шаг 2. Положить код в корневую папку Laragon

По умолчанию корневая папка Laragon — `C:\laragon\www`. В меню Laragon
есть кнопка «Коренёвая папка», она её и открывает.

В PowerShell:

```powershell
cd C:\laragon\www
git clone https://github.com/vascin/docx-llm-filler.git
cd docx-llm-filler
```

Если Git не установлен — скачайте проект zip-ом со страницы
<https://github.com/vascin/docx-llm-filler> и распакуйте в
`C:\laragon\www\docx-llm-filler`.

## Шаг 3. Установить зависимости

```powershell
cd C:\laragon\www\docx-llm-filler
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Шаг 4. Прописать ключ Gemini

Создайте файл `.env` в папке проекта:

```powershell
Copy-Item .env.example .env
notepad .env
```

В открывшемся блокноте впишите ваш ключ:

```
GEMINI_API_KEY=ВАШ_КЛЮЧ_СЮДА
GEMINI_MODEL=gemini-2.5-flash-lite
```

Сохраните и закройте.

## Шаг 5. Запустить вручную и проверить

```powershell
cd C:\laragon\www\docx-llm-filler
.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Откройте в браузере `http://127.0.0.1:8000/` — должна открыться форма
загрузки. Работает — значит Python-часть настроена правильно.
Остановите `Ctrl+C`.

## Шаг 6. Настроить авто-запуск через NSSM (служба Windows)

Чтобы приложение стартовало само при включении компьютера:

1. Скачайте NSSM ([nssm.cc/download](https://nssm.cc/download)),
   распакуйте `nssm.exe` например в `C:\laragon\bin\nssm.exe`.
2. Создайте службу:

   ```powershell
   C:\laragon\bin\nssm.exe install DocxFiller
   ```

   В открывшемся окне:

   * **Path** — `C:\laragon\www\docx-llm-filler\.venv\Scripts\uvicorn.exe`
   * **Startup directory** — `C:\laragon\www\docx-llm-filler`
   * **Arguments** — `app.main:app --host 127.0.0.1 --port 8000`
   * Вкладка **Environment** — по желанию продублируйте переменные из
     `.env`, если Python-служба их не видит.
   * Вкладка **I/O** — укажите путь к файлам логов, например
     `C:\laragon\www\docx-llm-filler\logs\stdout.log` и
     `...\stderr.log` (саму папку `logs` создайте заранее).

   Нажмите **Install service**.

3. Запустите службу и поставьте авто-старт:

   ```powershell
   nssm start DocxFiller
   nssm set DocxFiller Start SERVICE_AUTO_START
   ```

4. Проверьте `http://127.0.0.1:8000/` — опять должна открываться форма.

## Шаг 7. Настроить Apache Laragon-а как reverse-proxy

### Вариант A (проще) — отдельный домен `docx-filler.test`

Laragon автоматически поднимает виртуальный хост на каждую папку в
`www\`, но для reverse-proxy проще завести конфиг вручную:

1. Откройте через меню Laragon: **Меню → Apache → sites-enabled**
   (или вручную: `C:\laragon\etc\apache2\sites-enabled`).
2. Создайте там файл `auto.docx-filler.test.conf` с содержимым:

   ```apache
   <VirtualHost *:80>
       ServerName docx-filler.test
       ServerAlias *.docx-filler.test

       ProxyPreserveHost On
       ProxyPass        / http://127.0.0.1:8000/
       ProxyPassReverse / http://127.0.0.1:8000/

       # Длинные запросы к Gemini: до 2 минут
       ProxyTimeout 120

       # Увеличим лимит загружаемых файлов до 50 МБ
       LimitRequestBody 52428800
   </VirtualHost>

   <VirtualHost *:443>
       ServerName docx-filler.test
       ServerAlias *.docx-filler.test
       SSLEngine On
       SSLCertificateFile      "${SSL_CERTS_DIR}/docx-filler.test.crt"
       SSLCertificateKeyFile   "${SSL_CERTS_DIR}/docx-filler.test.key"

       ProxyPreserveHost On
       ProxyPass        / http://127.0.0.1:8000/
       ProxyPassReverse / http://127.0.0.1:8000/
       ProxyTimeout 120
       LimitRequestBody 52428800
   </VirtualHost>
   ```

3. В главном окне Laragon нажмите **Перезагрузить** (там, где Apache).
   Laragon сам выпустит локальный SSL-сертификат и пропишет
   `docx-filler.test` в `hosts`.
4. Откройте в браузере `https://docx-filler.test/` — должна появиться
   форма.

### Вариант B — поддомен существующего сайта, например `/docx-filler/`

Если вы хотите держать всё на одном домене и просто выделить путь:

```apache
# внутри уже имеющегося <VirtualHost *:443>:
ProxyPass        /docx-filler/ http://127.0.0.1:8000/
ProxyPassReverse /docx-filler/ http://127.0.0.1:8000/
ProxyTimeout 120
```

Затем в приложении FastAPI добавьте опцию `root_path=/docx-filler` в
`FastAPI(...)` (если понадобится — напишите, я подскажу точнее).

## Шаг 8. Проверка

В браузере откройте ваш URL (например `https://docx-filler.test/`),
выберите Word-файл и источник информации, нажмите **Заполнить и
скачать** — готовый `.docx` должен скачаться.

## Как обновить приложение

```powershell
cd C:\laragon\www\docx-llm-filler
git pull
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
nssm restart DocxFiller
```

## Частые проблемы

* **502 Proxy Error** в Apache — скорее всего Python-служба не
  запущена. Проверьте: `sc query DocxFiller`. Если `STOPPED` —
  `nssm start DocxFiller`, затем посмотрите логи в
  `C:\laragon\www\docx-llm-filler\logs\stderr.log`.
* **Ошибка 500 «GEMINI_API_KEY не задан»** — `.env` не прочитался.
  Продублируйте `GEMINI_API_KEY` в NSSM → вкладка Environment.
* **HTTPS-сертификат «недоверенный»** — Laragon выдаёт локальные
  сертификаты, которые надо один раз добавить в «Доверенные корневые»:
  в меню Laragon → **Дополнительно → Выпустить root-сертификат** →
  установите.
* **Файлы больше 10 МБ не принимаются** — поднимите
  `LimitRequestBody` в конфиге Apache и (если нужно)
  `--limit-max-requests` у uvicorn / `client_max_body_size` у
  обратного прокси.

## Где брать ключ Gemini

1. Зайдите в <https://aistudio.google.com/app/apikey>.
2. Нажмите **Create API Key**, выберите свой Google-проект.
3. Скопируйте ключ, положите в `.env` под именем `GEMINI_API_KEY`.

Бесплатная модель `gemini-2.5-flash-lite` работает без платного
аккаунта и без региональных ограничений — то, что используется по
умолчанию.
