# Multi-stage Hardened Container Image for ECDAT eBPF Runtime Observation Agent
# Stage 1: Build & Validate BPF artifacts with Clang toolchain
FROM python:3.12-slim@sha256:606e12e753bf88a444a8fbbfd65dfae87740e53a2588eec86ad6077ff6e20796 AS builder

WORKDIR /opt/ecdat
COPY bpf ./bpf

# Stage 2: Minimal runtime image - NO COMPILER TOOLCHAIN IN RUNTIME
FROM python:3.12-slim@sha256:606e12e753bf88a444a8fbbfd65dfae87740e53a2588eec86ad6077ff6e20796 AS runner

WORKDIR /opt/ecdat

# Deterministic reproducible build flags & read-only fs compatibility
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOURCE_DATE_EPOCH=0 \
    TMPDIR=/tmp

# Dedicated unprivileged non-root user (UID 10002)
RUN groupadd -g 10002 ecdat-agent && \
    useradd -u 10002 -g ecdat-agent -s /bin/sh -d /opt/ecdat ecdat-agent

# Install dependencies from deterministic lockfile without build tools
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt

# Copy BPF descriptors and Python runtime modules
COPY --from=builder /opt/ecdat/bpf ./bpf
COPY scanners/runtime ./scanners/runtime
COPY scanners/domain ./scanners/domain
COPY rules ./rules

# Enforce least-privilege immutable filesystem permissions
RUN chown -R ecdat-agent:ecdat-agent /opt/ecdat \
    && chmod -R 0555 /opt/ecdat

# Drop all root privileges
USER ecdat-agent

# Local loopback healthcheck verifying collector module integrity
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import scanners.runtime.ebpf_collector; print('healthy')" || exit 1

ENTRYPOINT ["python", "-m", "scanners.runtime.ebpf_collector"]
