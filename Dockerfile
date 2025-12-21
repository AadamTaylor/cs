# 使用 Caddy 官方轻量镜像
FROM caddy:2-alpine

# 安装 cloudflared
RUN apk add --no-cache curl && \
    curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod +x /usr/local/bin/cloudflared

# 拷贝 Caddy 配置
COPY Caddyfile /etc/caddy/Caddyfile

# 拷贝 Cloudflared 配置
COPY cloudflared.yml /etc/cloudflared/config.yml

# 暴露端口
EXPOSE 80 8080

# 启动 cloudflared + Caddy
CMD ["sh", "-c", "cloudflared tunnel --no-autoupdate run & caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
