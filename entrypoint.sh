#!/bin/sh
# 启动 Node 后台服务
node /admin/server.js &
# 启动 Caddy 前台服务
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
