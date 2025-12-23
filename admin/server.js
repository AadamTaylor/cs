const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const ROUTES_FILE = path.join(__dirname, 'routes.json');
let routes = fs.existsSync(ROUTES_FILE)
  ? JSON.parse(fs.readFileSync(ROUTES_FILE))
  : [];

/* ========= 工具函数 ========= */

// 自动检测 Caddy server 名（不写死 srv0）
async function getServerName() {
  const res = await axios.get('http://localhost:2019/config/');
  const servers = res.data.apps.http.servers;
  return Object.keys(servers)[0];
}

// 构造 Caddy route 对象（✅ 正确 JSON 结构）
function buildCaddyRoute(route) {
  return {
    match: [
      { path: [route.path + '*'] }
    ],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [
          { dial: route.target }
        ]
      }
    ]
  };
}

// 添加单条路由（POST 追加）
async function applyRoute(route) {
  const serverName = await getServerName();
  return axios.post(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes`,
    buildCaddyRoute(route)
  );
}

// 删除指定 index 的路由
async function deleteRouteByIndex(index) {
  const serverName = await getServerName();
  return axios.delete(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes/${index}`
  );
}

// 健康检测
async function checkRoute(path) {
  try {
    const res = await axios.get(`http://127.0.0.1:3000${path}`, {
      timeout: 2000,
      validateStatus: () => true
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

/* ========= API ========= */

// 获取路由列表
app.get('/api/routes', async (_, res) => {
  for (const r of routes) {
    r.alive = await checkRoute(r.path);
  }
  res.json(routes);
});

// 添加路由
app.post('/api/routes', async (req, res) => {
  const { path: p, target } = req.body;
  if (!p || !target) return res.status(400).send('参数缺失');

  const route = { path: p, target, status: 'pending' };
  routes.push(route);

  try {
    await applyRoute(route);
    route.status = 'active';
    route.alive = await checkRoute(p);
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.send('路由已生效');
  } catch (e) {
    route.status = 'failed';
    route.error = e.message;
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.status(500).send('写入失败');
  }
});

// 删除路由
app.delete('/api/routes/:index', async (req, res) => {
  const index = Number(req.params.index);
  if (isNaN(index)) return res.status(400).send('index 错误');

  try {
    await deleteRouteByIndex(index);
    routes.splice(index, 1);
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.send('已删除');
  } catch (e) {
    res.status(500).send('删除失败');
  }
});

// 一键重载
app.post('/api/reload', async (_, res) => {
  try {
    const serverName = await getServerName();

    // 先删除所有现有 routes
    const cfg = await axios.get('http://localhost:2019/config/');
    const currentRoutes =
      cfg.data.apps.http.servers[serverName].routes || [];

    for (let i = currentRoutes.length - 1; i >= 0; i--) {
      await deleteRouteByIndex(i);
    }

    // 再重新写入
    for (const r of routes) await applyRoute(r);

    res.send('已重载');
  } catch (e) {
    res.status(500).send('重载失败');
  }
});

app.listen(4000, () => {
  console.log('Admin panel running on port 4000');
});
