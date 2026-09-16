# Hardened, reproducible build for ECDAT Scanner Engine
# Aligned with SLSA Level 3 and OpenSSF container guidelines
FROM python:3.12-slim@sha256:606e12e753bf88a444a8fbbfd65dfae87740e53a2588eec86ad6077ff6e20796

WORKDIR /opt/ecdat

# Deterministic reproducible build flags
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOURCE_DATE_EPOCH=0 \
    TMPDIR=/tmp

# Create dedicated unprivileged non-root user (UID 10001)
RUN groupadd -g 10001 ecdat && \
    useradd -u 10001 -g ecdat -s /bin/sh -d /opt/ecdat ecdat

# Install strictly pinned dependencies from deterministic lockfile
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt

# Copy application code and schemas
COPY scanners ./scanners
COPY rules ./rules
COPY docker/demo_cbom.json docker/demo_import.py ./docker/

# Enforce least-privilege ownership and immutable permissions
RUN chown -R ecdat:ecdat /opt/ecdat \
    && chmod -R 0555 /opt/ecdat

# Drop root privileges completely
USER ecdat

# Offline self-test healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import scanners.static.main; print('healthy')" || exit 1

CMD ["python", "-m", "scanners.static.main", "--help"]
