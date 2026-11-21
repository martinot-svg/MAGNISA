FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# The IMAP transport is isolated from the Next.js application dependency tree.
# Keep the client version exact and install it only in this worker image.
RUN npm install --omit=dev --no-audit --no-fund --save-exact \
  @supabase/supabase-js@2.57.0 \
  tsx@4.20.6 \
  imapflow@2.12.2

COPY scripts/magnibox ./scripts/magnibox

USER node
CMD ["sh", "-c", "while true; do ./node_modules/.bin/tsx scripts/magnibox/run-imap-sync.ts || true; sleep 15; done"]
