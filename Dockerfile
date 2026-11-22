FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 VESTA_DB=/data/evaluation.sqlite
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 vesta && mkdir /data && chown vesta:vesta /data
COPY vesta ./vesta
USER vesta
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"
CMD ["uvicorn","vesta.api:create_app","--factory","--host","0.0.0.0","--port","8000","--workers","1","--limit-concurrency","32"]
