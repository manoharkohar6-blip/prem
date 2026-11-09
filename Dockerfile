FROM node:26-alpine AS build
RUN apk update && apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM python:3-alpine
# apk update busts the cached layer so the final image picks up current fixed packages
RUN apk update \
 && apk upgrade --no-cache \
 && apk add --no-cache --upgrade zlib \
 && rm -rf /var/cache/apk/*
WORKDIR /app
COPY --from=build /app/dist ./
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "python3 -m http.server ${PORT:-3000} --bind 0.0.0.0"]
