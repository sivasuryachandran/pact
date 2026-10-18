FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PACT_HOST=0.0.0.0 \
    PACT_PORT=8787 \
    PACT_BEDROCK_ENABLED=0 \
    PACT_SQLITE_PATH=/data/pact-data.sqlite3 \
    PACT_ALLOW_DOCKER_CLIENTS=1

WORKDIR /app
COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt
COPY pact ./pact
COPY web ./web
COPY scripts ./scripts
COPY README.md .env.example ./
RUN mkdir -p /data

EXPOSE 8787
VOLUME ["/data"]
CMD ["python", "-m", "pact.server"]
