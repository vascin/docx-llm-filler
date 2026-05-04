from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import httpx
import os

app = FastAPI()

STATIC_DIR = os.path.dirname(__file__)


@app.get("/")
async def root():
    return FileResponse(os.path.join(STATIC_DIR, "editor.html"))


@app.post("/api/gemini/{version}/models/{model}:generateContent")
async def gemini_proxy(version: str, model: str, request: Request):
    api_key = request.query_params.get("key", "")
    url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:generateContent?key={api_key}"
    body = await request.body()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, content=body, headers={"Content-Type": "application/json"})
        return JSONResponse(content=resp.json(), status_code=resp.status_code)


# Mount static at root so js/state.js, css/style.css etc. resolve correctly
app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
