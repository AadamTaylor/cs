FROM caddy:2-alpine

# 安装 curl、bash、Node.js、npm
RUN apk add --no-cache curl bash nodejs npm && \
    curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod +x /usr/local/bin/cloudflared

# 拷贝 Caddy 配置
COPY Caddyfile /etc/caddy/Caddyfile

# 拷贝 Cloudflared 配置
COPY cloudflared.yml /etc/cloudflared/config.yml

# 拷贝后台管理程序
COPY admin /admin

# 👇👇👇 核心修复（就这三行）👇👇👇
WORKDIR /admin
RUN npm install
WORKDIR /
# 👆👆👆 核心修复 👆👆👆

# 暴露单端口
EXPOSE 3000

# 启动 cloudflared + Node.js 后台 + Caddy
CMD ["sh", "-c", "cloudflared tunnel --no-autoupdate run & node /admin/server.js & caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
