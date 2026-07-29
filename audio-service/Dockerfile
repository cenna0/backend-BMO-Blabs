FROM python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015

ARG VCS_REF
LABEL org.opencontainers.image.title="BMO Audio Service" \
      org.opencontainers.image.description="BMO MVP speech-to-text and text-to-speech service" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ffmpeg \
        libgomp1 \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 bmo \
    && useradd --uid 10001 --gid bmo --create-home --shell /usr/sbin/nologin bmo

WORKDIR /app

COPY requirements-runtime.lock ./
RUN pip install --no-cache-dir --requirement requirements-runtime.lock

COPY app ./app

USER bmo

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/livez', timeout=2).read()"]

CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001"]
