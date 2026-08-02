FROM python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_INDEX=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    NUMEXPR_NUM_THREADS=2 \
    ORT_DISABLE_ALL_NETWORK=1 \
    HOME=/tmp/piper-home

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg=7:5.1.9-0+deb12u1 \
        tini=0.19.0-1+b3 \
    && rm -rf /var/lib/apt/lists/*

COPY wheelhouse/ /wheelhouse/
COPY piper-candidate/requirements-runtime.lock /tmp/requirements-runtime.lock
RUN python -m pip install --no-index --find-links=/wheelhouse --require-hashes \
        --requirement /tmp/requirements-runtime.lock \
    && python -m pip check \
    && rm -rf /wheelhouse /root/.cache/pip

RUN groupadd --gid 10001 piper \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp/piper-home piper

WORKDIR /app
COPY piper-candidate/bmo_piper/ /app/bmo_piper/
COPY piper-candidate/comparison-text.json /app/comparison-text.json

USER piper
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["python", "-m", "bmo_piper.worker", "--help"]

FROM runtime AS test
USER root
COPY wheelhouse/ /wheelhouse/
COPY piper-candidate/requirements-verify.lock /tmp/requirements-verify.lock
RUN python -m pip install --no-index --find-links=/wheelhouse --require-hashes \
        --requirement /tmp/requirements-verify.lock \
    && python -m pip check \
    && rm -rf /wheelhouse /root/.cache/pip
COPY piper-candidate/tests/ /app/tests/
COPY piper-candidate/Dockerfile /app/Dockerfile
COPY piper-candidate/Dockerfile.dockerignore /app/Dockerfile.dockerignore
USER piper
CMD ["python", "-m", "pytest", "-p", "no:cacheprovider", "-q", "/app/tests"]
