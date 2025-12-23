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

// 安全请求 Caddy Admin API
async function requestCaddy(method, url, data) {
  try {
    const res = await axios({
      method,
      url,
      data,
      responseType: 'text',
      validateStatus: () => true
    });

    if (res.headers['content-type']?.includes('application/json') && res.data) {
      return JSON.parse(res.data);
    }

    if (res.status >= 200 && res.status < 300) return {};
    throw new Error(`Caddy 返回非 JSON 响应: ${res.data}`);
  } catch (e) {
    throw new Error(e.message);
  }
}

// 获取 Caddy server 名
async function getServerName() {
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  const servers = cfg.apps.http.servers;
  return Object.keys(servers)[0];
}

// 构造业务路由 JSON
function buildCaddyRoute(route) {
  return {
    match: [{ path: [route.path + '*'] }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: route.target }]
      }
    ]
  };
}

/* ========= 路由操作 ========= */

// 添加业务路由
async function applyRoute(route) {
  const serverName = await getServerName();
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  const currentRoutes = cfg.apps.http.servers[serverName].routes || [];

  const lockedPaths = ['/admin', '/'];
  const filteredRoutes = currentRoutes.filter(r => {
    const pathMatch = r.match?.[0]?.path?.[0] || '';
    return !lockedPaths.some(lp => pathMatch.startsWith(lp));
  });

  filteredRoutes.unshift(buildCaddyRoute(route));

  await requestCaddy(
    'put',
    `http://127.0.0.1:2019/config/apps/http/servers/${serverName}/routes`,
    filteredRoutes
  );
}

// 删除业务路由
async function deleteRouteByIndex(index) {
  const serverName = await getServerName();
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  const currentRoutes = cfg.apps.http.servers[serverName].routes || [];
  const lockedPaths = ['/admin', '/'];

  const filteredRoutes = currentRoutes.filter((r, i) => {
    const pathMatch = r.match?.[0]?.path?.[0] || '';
    if (lockedPaths.some(lp => pathMatch.startsWith(lp))) return true;
    return i !== index;
  });

  await requestCaddy(
    'put',
    `http://127.0.0.1:2019/config/apps/http/servers/${serverName}/routes`,
    filteredRoutes
  );
}

// 检查路由是否可达
async function checkRoute(path) {
  try {
    const res = await axios.get(`http://127.0.0.1:3000${path}`, { timeout: 2000, validateStatus: () => true });
    return res.status < 500;
  } catch {
    return false;
  }
}

// 更新路由状态
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

const adminRouter = express.Router();
app.use('/admin', adminRouter);

// 获取路由列表
adminRouter.get('/api/routes', async (_, res) => {
  try {
    await updateRoutesStatus();
    res.json(routes);
  } catch (e) {
    res.status(500).json({ error: '获取路由失败: ' + e.message });
  }
});

// 添加业务路由
adminRouter.post('/api/routes', async (req, res) => {
  const { path: p, target } = req.body;
  if (!p || !target) return res.status(400).json({ status: 'failed', error: '参数缺失' });
  if (['/admin', '/'].some(lp => p.startsWith(lp))) {
    return res.status(403).json({ status: 'failed', error: '禁止修改锁死路由' });
  }

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

// 删除业务路由
adminRouter.delete('/api/routes/:index', async (req, res) => {
  const index = Number(req.params.index);
  if (isNaN(index)) return res.status(400).json({ status: 'failed', error: 'index 错误' });

  const route = routes[index];
  if (!route) return res.status(404).json({ status: 'failed', error: '路由不存在' });
  if (['/admin', '/'].some(lp => route.path.startsWith(lp))) {
    return res.status(403).json({ status: 'failed', error: '禁止删除锁死路由' });
  }

  try {
    await deleteRouteByIndex(index);
    routes.splice(index, 1);
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'failed', error: e.message });
  }
});

// 一键重载业务路由
adminRouter.post('/api/reload', async (_, res) => {
  try {
    const serverName = await getServerName();
    const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
    const currentRoutes = cfg.apps.http.servers[serverName].routes || [];

    const lockedPaths = ['/admin', '/'];
    const businessRoutes = currentRoutes.filter(r => {
      const pathMatch = r.match?.[0]?.path?.[0] || '';
      return !lockedPaths.some(lp => pathMatch.startsWith(lp));
    });

    for (let i = businessRoutes.length - 1; i >= 0; i--) {
      await deleteRouteByIndex(i);
    }

    for (const r of routes) {
      await applyRoute(r);
      r.alive = await checkRoute(r.path);
      r.status = r.alive ? 'active' : 'failed';
    }

    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'failed', error: e.message });
  }
});

app.listen(4000, () => {
  console.log('Admin panel running on port 4000');
});
