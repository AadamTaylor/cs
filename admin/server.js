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

// 自动获取 Caddy server 名
async function getServerName() {
  const res = await axios.get('http://localhost:2019/config/');
  const servers = res.data.apps.http.servers;
  return Object.keys(servers)[0];
}

// 构造 Caddy route JSON（Admin API 最新格式）
function buildCaddyRoute(route) {
  return {
    matcher_sets: [
      { path: [route.path + '*'] }
    ],
    handlers: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: route.target }]
      }
    ]
  };
}

// 添加单条路由
async function applyRoute(route) {
  const serverName = await getServerName();
  await axios.post(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes`,
    buildCaddyRoute(route)
  );
}

// 删除指定 index 的路由
async function deleteRouteByIndex(index) {
  const serverName = await getServerName();
  await axios.delete(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes/${index}`
  );
}

// 检查路由是否可达（返回 true/false）
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

// 更新所有路由状态
async function updateRoutesStatus() {
  for (const r of routes) {
    r.alive = await checkRoute(r.path);
    if (!r.status || r.status === 'pending') {
      r.status = r.alive ? 'active' : 'failed';
    }
  }
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
}

/* ========= API ========= */

// 获取路由列表
app.get('/api/routes', async (_, res) => {
  await updateRoutesStatus();
  res.json(routes);
});

// 添加路由
app.post('/api/routes', async (req, res) => {
  const { path: p, target } = req.body;
  if (!p || !target) return res.status(400).send('参数缺失');

  const route = { path: p, target, status: 'pending', alive: false };
  routes.push(route);
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));

  try {
    await applyRoute(route);
    route.alive = await checkRoute(p);
    route.status = route.alive ? 'active' : 'failed';
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.json(route);
  } catch (e) {
    route.status = 'failed';
    route.error = e.message;
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.status(500).json(route);
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

    // 获取当前 routes 并删除
    const cfg = await axios.get('http://localhost:2019/config/');
    const currentRoutes = cfg.data.apps.http.servers[serverName].routes || [];
    for (let i = currentRoutes.length - 1; i >= 0; i--) {
      await deleteRouteByIndex(i);
    }

    // 重新写入
    for (const r of routes) {
      await applyRoute(r);
      r.alive = await checkRoute(r.path);
      r.status = r.alive ? 'active' : 'failed';
    }

    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.send('已重载');
  } catch (e) {
    res.status(500).send('重载失败: ' + e.message);
  }
});

app.listen(4000, () => {
  console.log('Admin panel running on port 4000');
});
