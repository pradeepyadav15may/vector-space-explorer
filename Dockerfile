# Build the web app, then run the API and serve the built web app from one container.
FROM node:22-slim AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/srv/.cache/fastembed \
    PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
# Download the embedding model at build time so the first visitor doesn't wait for it.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"
COPY backend backend
COPY data data
COPY --from=web /src/frontend/dist frontend/dist
RUN useradd --create-home app && chown -R app /srv
USER app
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860"]
