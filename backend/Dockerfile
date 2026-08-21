FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN groupadd --gid 10001 lingolife && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin lingolife
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=10001:10001 backend/lingolife ./lingolife
COPY --chown=10001:10001 backend/content ./content
COPY --chown=10001:10001 config /app/config
# The release artifact is built and type-checked on the development/CI machine.
# The VPS only assembles the lightweight runtime image; this keeps host memory
# constraints from influencing client visual quality.
COPY --chown=10001:10001 web/dist /app/web/dist
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "lingolife.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
