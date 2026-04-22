"""FastAPI application exposing the docx-llm-filler service.

Routes:

* ``GET  /``      - simple HTML upload form.
* ``POST /fill``  - accept ``template`` (.docx) and ``data`` (.json) uploads,
                    return the filled .docx as a download.
* ``GET  /health`` - liveness probe.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import get_settings
from .docx_filler import fill_document
from .gemini_client import GeminiClient

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


def _build_llm() -> GeminiClient:
    settings = get_settings()
    return GeminiClient(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        max_output_tokens=settings.gemini_max_output_tokens,
    )


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    settings = get_settings()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "model": settings.gemini_model,
            "has_key": bool(settings.gemini_api_key),
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/fill")
async def fill(
    template: UploadFile = File(..., description=".docx template to fill"),
    data: UploadFile = File(..., description="JSON data source"),
) -> Response:
    if not template.filename or not template.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="'template' must be a .docx file.")
    if not data.filename or not data.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="'data' must be a .json file.")

    docx_bytes = await template.read()
    data_bytes = await data.read()

    if not docx_bytes:
        raise HTTPException(status_code=400, detail="Template file is empty.")
    if not data_bytes:
        raise HTTPException(status_code=400, detail="Data file is empty.")

    try:
        payload = json.loads(data_bytes.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Data file is not valid UTF-8: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Data file is not valid JSON: {exc}") from exc

    try:
        llm = _build_llm()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        result = fill_document(docx_bytes, payload, llm)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc

    out_name = _filled_name(template.filename)
    headers = {
        "Content-Disposition": f'attachment; filename="{out_name}"',
        "X-Fill-Mode": result.mode,
        "X-Fill-Changed-Paragraphs": str(result.changed_paragraphs),
    }
    return Response(content=result.content, media_type=DOCX_MIME, headers=headers)


def _filled_name(original: str) -> str:
    stem = original.rsplit(".", 1)[0] or "filled"
    return f"{stem}.filled.docx"
