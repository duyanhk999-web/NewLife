FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY shared ./shared
COPY supabase ./supabase

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 2567

CMD ["node", "index.js"]
