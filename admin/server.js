const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const ROUTES_FILE = path.join(__dirname, 'routes.json');

// 加载已有路由
let routes = [];
if (fs.existsSync(ROUTES_FILE)) {
    routes = JSON.parse(fs.readFileSync(ROUTES_FILE));
}

// 获取当前路由
app.get('/api/routes', (req, res) => {
    res.json(routes);
});

// 添加新路由
app.post('/api/routes', async (req, res) => {
    const { path: routePath, target } = req.body;
    if (!routePath || !target) return res.status(400).send('path and target required');

    routes.push({ path: routePath, target });
    fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));

    try {
        // 调用 Caddy Admin API 动态添加路由
        await axios.post('http://localhost:2019/config/apps/http/servers/srv0/routes', {
            "handle": [
                {
                    "handler": "reverse_proxy",
                    "match": [{ "path": [routePath + "*"] }],
                    "upstreams": [{ "dial": target }]
                }
            ]
        });
        res.send('Route added');
    } catch (e) {
        console.error(e.message);
        res.status(500).send('Failed to update Caddy');
    }
});

// 启动后台管理界面
app.listen(4000, () => {
    console.log('Admin panel running on port 4000');
});
