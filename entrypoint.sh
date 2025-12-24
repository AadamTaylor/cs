#!/bin/sh

# 启动 Cloudflared 隧道
cloudflared tunnel --no-autoupdate run &

# 启动 Node 后台
node /admin/server.js &

# 启动 Caddy
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
