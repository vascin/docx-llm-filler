"""FastAPI application exposing the docx-llm-filler service.

Routes:

* ``GET  /``      - simple HTML upload form.
* ``POST /fill``  - accept ``template`` (.docx) and ``data`` (.json) uploads,
                    return the filled .docx as a download.
* ``GET  /health`` - liveness probe.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import get_settings
from .data_sources import SUPPORTED_EXTENSIONS, UnsupportedDataFormat, parse_data_file
from .docx_filler import fill_document
from .llm_factory import DEFAULT_PROVIDER, PROVIDER_INFO, PROVIDERS, build_llm

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="docx-llm-filler",
    description="Fill Word (.docx) templates with an LLM using a JSON data source.",
    version="0.1.0",
)

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    settings = get_settings()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "model": settings.gemini_model,
            "providers": [PROVIDER_INFO[p] for p in PROVIDERS],
            "default_provider": DEFAULT_PROVIDER,
            "supported_extensions": ", ".join(SUPPORTED_EXTENSIONS),
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/fill")
async def fill(
    template: UploadFile = File(..., description=".docx template to fill"),
    data: UploadFile = File(
        ...,
        description=f"Data source ({', '.join(SUPPORTED_EXTENSIONS)})",
    ),
    provider: str = Form(DEFAULT_PROVIDER, description="LLM provider id"),
    api_key: str = Form("", description="Optional user-supplied API key"),
    extra: str = Form("", description="Optional second credential (scope / folder_id)"),
) -> Response:
    if not template.filename or not template.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="'template' must be a .docx file.")
    if not data.filename:
        raise HTTPException(status_code=400, detail="'data' must have a filename.")

    docx_bytes = await template.read()
    data_bytes = await data.read()

    if not docx_bytes:
        raise HTTPException(status_code=400, detail="Template file is empty.")
    if not data_bytes:
        raise HTTPException(status_code=400, detail="Data file is empty.")

    try:
        payload = parse_data_file(data.filename, data_bytes)
    except UnsupportedDataFormat as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse data file: {exc}") from exc

    settings = get_settings()
    try:
        llm = build_llm(provider, settings, api_key=api_key, extra=extra)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = fill_document(docx_bytes, payload, llm)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc

    out_name = _filled_name(template.filename)
    headers = {
        "Content-Disposition": _content_disposition(out_name),
        "X-Fill-Mode": result.mode,
        "X-Fill-Changed-Paragraphs": str(result.changed_paragraphs),
        "X-Fill-Provider": provider,
    }
    return Response(content=result.content, media_type=DOCX_MIME, headers=headers)


def _filled_name(original: str) -> str:
    stem = original.rsplit(".", 1)[0] or "filled"
    return f"{stem}.filled.docx"


def _content_disposition(filename: str) -> str:
    """Build an RFC 5987 ``Content-Disposition`` header.

    Starlette encodes outgoing header values as latin-1, which fails for
    filenames containing Cyrillic or any non-ASCII characters. We emit both
    an ASCII ``filename`` fallback and an UTF-8 ``filename*`` parameter so
    modern browsers pick up the original name while legacy clients still see
    something sensible.
    """
    ascii_fallback = filename.encode("ascii", errors="replace").decode("ascii").replace("?", "_")
    encoded = quote(filename, safe="")
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded}'
