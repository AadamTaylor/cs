const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CADDYFILE_PATH = '/etc/caddy/Caddyfile';

// 查看当前路由
app.get('/routes', (req, res) => {
    const content = fs.readFileSync(CADDYFILE_PATH, 'utf8');
    res.send(content);
});

// 添加新服务
app.post('/routes', (req, res) => {
    const { path: routePath, target } = req.body;
    if (!routePath || !target) return res.status(400).send('path and target required');

    let caddyfile = fs.readFileSync(CADDYFILE_PATH, 'utf8');
    caddyfile += `\nroute ${routePath}/* {\n    reverse_proxy ${target}\n}\n`;
    fs.writeFileSync(CADDYFILE_PATH, caddyfile);

    // 重载 Caddy
    exec('caddy reload --config /etc/caddy/Caddyfile', (err, stdout, stderr) => {
        if (err) return res.status(500).send(stderr);
        res.send('Route added and Caddy reloaded');
    });
});

app.listen(4000, () => console.log('Admin panel running on port 4000'));
