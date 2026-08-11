FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
# npm can omit Rolldown's platform-specific optional package when installing
# from a lockfile generated on another platform. Alpine needs the musl
# binding explicitly for Vite/Rolldown to start.
RUN npm install --no-save --package-lock=false --include=optional @rolldown/binding-linux-x64-musl@1.2.3
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8501
CMD ["nginx", "-g", "daemon off;"]
