FROM python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015 AS rvc-builder

ARG RVC_ENGINE_REVISION=7b284a634667c34103eaaeed972b48ccdb4b893e
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    MAX_JOBS=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        git \
        libavcodec-dev \
        libavdevice-dev \
        libavfilter-dev \
        libavformat-dev \
        libavutil-dev \
        libswresample-dev \
        libswscale-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-rvc-build.lock requirements-rvc.lock requirements-rvc-git.lock /tmp/rvc-requirements/
RUN python -m venv /opt/rvc-venv \
    && /opt/rvc-venv/bin/python -m pip install \
        --require-hashes \
        --requirement /tmp/rvc-requirements/requirements-rvc-build.lock \
    && /opt/rvc-venv/bin/python -m pip install \
        --no-build-isolation \
        --require-hashes \
        --requirement /tmp/rvc-requirements/requirements-rvc.lock \
    && /opt/rvc-venv/bin/python -m pip install \
        --no-build-isolation \
        --no-deps \
        --requirement /tmp/rvc-requirements/requirements-rvc-git.lock \
    && /opt/rvc-venv/bin/python -m pip check \
    && /opt/rvc-venv/bin/python -c 'import importlib.metadata as m; names={d.metadata["Name"].lower() for d in m.distributions()}; assert not any(n.startswith("nvidia-") for n in names); assert "triton" not in names; import torch; assert torch.__version__ == "2.11.0+cpu"; assert not torch.cuda.is_available()'

RUN git init /tmp/rvc-engine-source \
    && git -C /tmp/rvc-engine-source remote add origin https://github.com/RVC-Project/Retrieval-based-Voice-Conversion.git \
    && git -C /tmp/rvc-engine-source fetch --depth 1 origin "${RVC_ENGINE_REVISION}" \
    && test "$(git -C /tmp/rvc-engine-source rev-parse FETCH_HEAD)" = "${RVC_ENGINE_REVISION}" \
    && mkdir /opt/rvc-engine \
    && git -C /tmp/rvc-engine-source archive --format=tar FETCH_HEAD --output=/tmp/rvc-engine.tar \
    && tar --extract --file=/tmp/rvc-engine.tar --directory=/opt/rvc-engine


FROM python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015

ARG VCS_REF
LABEL org.opencontainers.image.title="BMO Audio Service" \
      org.opencontainers.image.description="BMO MVP speech-to-text and text-to-speech service with isolated RVC candidate" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.rvc-engine-revision="7b284a634667c34103eaaeed972b48ccdb4b893e"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TORCH_FORCE_WEIGHTS_ONLY_LOAD=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ffmpeg \
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

COPY --from=rvc-builder /opt/rvc-venv /opt/rvc-venv
COPY --from=rvc-builder /opt/rvc-engine /opt/rvc-engine
COPY app ./app
COPY scripts/rvc_infer.py ./scripts/rvc_infer.py
COPY scripts/audio_service_entrypoint.py ./scripts/audio_service_entrypoint.py

USER bmo

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/livez', timeout=2).read()"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "scripts/audio_service_entrypoint.py"]
