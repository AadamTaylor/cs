FROM caddy:2-alpine

RUN apk add --no-cache nodejs npm curl bash

# 拷贝 Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# 拷贝后台
COPY admin /admin
WORKDIR /admin
RUN npm install

WORKDIR /

EXPOSE 3000

# 同时启动 Node + Caddy
CMD sh -c "node /admin/server.js & caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"
