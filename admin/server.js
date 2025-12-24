const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const ROUTES_FILE = path.join(__dirname, 'routes.json');
let routes = fs.existsSync(ROUTES_FILE)
  ? JSON.parse(fs.readFileSync(ROUTES_FILE))
  : [];

/* ========= Caddy Admin API ========= */
async function requestCaddy(method, url, data) {
  const res = await axios({
    method,
    url,
    data,
    validateStatus: () => true
  });
  if (res.status >= 200 && res.status < 300) return res.data || {};
  throw new Error(`Caddy API error: ${res.status}`);
}

async function getServerName() {
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  return Object.keys(cfg.apps.http.servers)[0];
}

function buildRoute(route) {
  return {
    match: [{ path: [route.path + '*'] }],
    handle: [{
      handler: 'reverse_proxy',
      upstreams: [{ dial: route.target }]
    }]
  };
}

async function applyRoute(route) {
  const server = await getServerName();
  const cfg = await requestCaddy('get', 'http://127.0.0.1:2019/config/');
  const routesArr = cfg.apps.http.servers[server].routes || [];
  routesArr.unshift(buildRoute(route));
  await requestCaddy(
    'put',
    `http://127.0.0.1:2019/config/apps/http/servers/${server}/routes`,
    routesArr
  );
}

async function replayRoutes() {
  for (const r of routes) {
    try { await applyRoute(r); } catch {}
  }
}

/* ========= API ========= */
const router = express.Router();
app.use('/admin/api', router);

router.get('/routes', async (_, res) => {
  res.json(routes);
});

router.post('/routes', async (req, res) => {
  const { path, target } = req.body;
  if (!path || !target || !path.startsWith('/'))
    return res.status(400).json({ error: '参数错误' });
  if (path.startsWith('/admin'))
    return res.status(403).json({ error: '禁止修改管理路由' });

  const r = { path, target };
  routes.push(r);
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
  try {
    await applyRoute(r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/routes/:i', async (req, res) => {
  const i = Number(req.params.i);
  if (!routes[i]) return res.status(400).end();
  routes.splice(i, 1);
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
  res.json({ ok: true });
});

router.post('/reload', async (_, res) => {
  await replayRoutes();
  res.json({ ok: true });
});

/* ========= 启动 ========= */
replayRoutes();

app.listen(4000, '0.0.0.0', () => {
  console.log('Admin API on 4000');
});
