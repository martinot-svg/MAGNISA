FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN npm install --omit=dev --no-audit --no-fund --save-exact @supabase/supabase-js@2.57.0 tsx@4.20.6

COPY scripts/magnibox/attachment-scan-core.ts ./scripts/magnibox/attachment-scan-core.ts
COPY scripts/magnibox/scan-attachments.ts ./scripts/magnibox/scan-attachments.ts

USER node
CMD ["sh", "-c", "while true; do ./node_modules/.bin/tsx scripts/magnibox/scan-attachments.ts || true; sleep 60; done"]
