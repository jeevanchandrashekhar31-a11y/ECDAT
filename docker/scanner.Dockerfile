FROM python:3.12-slim
WORKDIR /opt/ecdat
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY scanners ./scanners
COPY rules ./rules
COPY docker/demo_cbom.json docker/demo_import.py ./docker/
CMD ["python", "-m", "scanners.static.main", "--help"]
