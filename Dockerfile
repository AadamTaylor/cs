FROM caddy:2-alpine

# 安装 Node.js 和 bash
RUN apk add --no-cache bash nodejs npm curl && \
    curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod +x /usr/local/bin/cloudflared

# 拷贝 Caddy 配置
COPY Caddyfile /etc/caddy/Caddyfile

# 拷贝 Cloudflared 配置
COPY cloudflared.yml /etc/cloudflared/config.yml

# 拷贝后台管理程序
COPY admin /admin

WORKDIR /admin
RUN npm install
WORKDIR /

# 暴露端口
EXPOSE 3000

# 启动顺序
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
