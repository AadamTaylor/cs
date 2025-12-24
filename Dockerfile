FROM caddy:2-alpine

# 安装 Node.js + curl + bash
RUN apk add --no-cache nodejs npm curl bash

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

# 启动 Node + Caddy (使用入口脚本)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
