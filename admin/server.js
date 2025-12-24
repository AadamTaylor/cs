const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const ROUTES_FILE = './routes.json';
let routes = fs.existsSync(ROUTES_FILE)
  ? JSON.parse(fs.readFileSync(ROUTES_FILE))
  : [];

// Caddy Admin API 工具
async function requestCaddy(method, url, data) {
  try {
    const res = await axios({ method, url, data, validateStatus: () => true });
    if (res.headers['content-type']?.includes('application/json') && res.data) return res.data;
    if (res.status >= 200 && res.status < 300) return {};
    throw new Error(`Caddy 返回非 JSON 响应: ${res.data}`);
  } catch (e) {
    throw new Error(e.message);
  }
}

async function getServerName() {
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  return Object.keys(cfg.apps.http.servers)[0];
}

function buildCaddyRoute(route) {
  return {
    match: [{ path: [route.path + '*'] }],
    handle: [
      { handler: 'reverse_proxy', upstreams: [{ dial: route.target }] }
    ]
  };
}

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

async function checkRoute(path) {
  try {
    const res = await axios.get(`http://127.0.0.1:3000${path}`, { timeout: 2000, validateStatus: () => true });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function updateRoutesStatus() {
  for (const r of routes) {
    r.alive = await checkRoute(r.path);
    r.status = r.alive ? 'active' : 'failed';
  }
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
}

// API 路由
const router = express.Router();
app.use('/admin/api', router);

router.get('/routes', async (_, res) => {
  try {
    await updateRoutesStatus();
    res.json(routes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/routes', async (req, res) => {
  const { path, target } = req.body;
  if (!path || !target) return res.status(400).json({ error: '参数缺失' });
  if (['/admin', '/'].some(lp => path.startsWith(lp))) return res.status(403).json({ error: '禁止修改锁死路由' });

  const route = { path, target, status: 'pending', alive: false };
  routes.push(route);
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));

  try {
    await applyRoute(route);
    route.alive = await checkRoute(path);
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

router.delete('/routes/:index', async (req, res) => {
  const index = Number(req.params.index);
  if (isNaN(index) || !routes[index]) return res.status(400).json({ error: 'index 错误或不存在' });
  if (['/admin', '/'].some(lp => routes[index].path.startsWith(lp))) return res.status(403).json({ error: '禁止删除锁死路由' });

  try {
    await deleteRouteByIndex(index);
    routes.splice(index, 1);
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reload', async (_, res) => {
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
    res.status(500).json({ error: e.message });
  }
});

app.listen(4000, () => console.log('Node API running on port 4000'));
