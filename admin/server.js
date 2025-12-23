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

// 自动检测 server 名
async function getServerName() {
  const res = await axios.get('http://localhost:2019/config/');
  const servers = res.data.apps.http.servers;
  return Object.keys(servers)[0];
}

// 写入路由
async function applyRoute(route) {
  const serverName = await getServerName();
  return axios.post(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes`,
    {
      handle: [{
        handler: 'reverse_proxy',
        match: [{ path: [route.path + '*'] }],
        upstreams: [{ dial: route.target }]
      }]
    }
  );
}

// 清空路由（rollback）
async function clearRoutes() {
  const serverName = await getServerName();
  await axios.put(
    `http://localhost:2019/config/apps/http/servers/${serverName}/routes`,
    []
  );
}

/* ========= API ========= */

// 获取路由
app.get('/api/routes', (req, res) => {
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
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.send('生效成功');
  } catch (e) {
    route.status = 'failed';
    route.error = e.message;
    res.status(500).send('写入失败');
  }
});

// 删除路由
app.delete('/api/routes/:path', async (req, res) => {
  const p = decodeURIComponent(req.params.path);
  routes = routes.filter(r => r.path !== p);

  try {
    await clearRoutes();
    for (const r of routes) await applyRoute(r);
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.send('已删除并重建');
  } catch (e) {
    res.status(500).send('删除失败');
  }
});

// 一键 reload
app.post('/api/reload', async (_, res) => {
  try {
    await clearRoutes();
    for (const r of routes) await applyRoute(r);
    res.send('已重载');
  } catch {
    res.status(500).send('重载失败');
  }
});

app.listen(4000, () => {
  console.log('Admin panel running on port 4000');
});
