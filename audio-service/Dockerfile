FROM python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015

ARG VCS_REF
LABEL org.opencontainers.image.title="BMO Audio Service" \
      org.opencontainers.image.description="BMO MVP speech-to-text and text-to-speech service" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    NUMEXPR_NUM_THREADS=2 \
    ORT_DISABLE_ALL_NETWORK=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ffmpeg=7:5.1.9-0+deb12u1 \
        libgomp1 \
        libsndfile1 \
        tini=0.19.0-1+b3 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 bmo \
    && useradd --uid 10001 --gid bmo --create-home --shell /usr/sbin/nologin bmo

WORKDIR /app

COPY requirements-runtime.lock ./
RUN pip install --no-cache-dir --requirement requirements-runtime.lock \
    && python -c 'import importlib.metadata as metadata; import spacy; assert metadata.version("en-core-web-sm") == "3.8.0"; spacy.load("en_core_web_sm")'

COPY app ./app

USER bmo

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/livez', timeout=2).read()"]

CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001"]
