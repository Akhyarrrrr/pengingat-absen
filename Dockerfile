FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY monitor.js ./
COPY tools/ ./tools/
COPY runtime/ocr-model.json runtime/ocr-model.json
RUN mkdir -p runtime

CMD ["sleep", "infinity"]