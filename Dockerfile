FROM caddy:2-alpine

# 安装 Node.js
RUN apk add --no-cache nodejs npm

# 拷贝 Caddy 配置
COPY Caddyfile /etc/caddy/Caddyfile

# 拷贝后台管理程序
COPY admin /admin

# 安装 Node 依赖
WORKDIR /admin
RUN npm install
WORKDIR /

# 暴露单端口
EXPOSE 3000

# 启动 Node + Caddy
CMD ["sh", "-c", "node /admin/server.js & caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
