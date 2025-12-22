const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// 获取当前路由
app.get('/api/routes', (req, res) => {
    const caddyfile = fs.readFileSync('../Caddyfile', 'utf8');
    res.send(caddyfile);
});

// 添加新路由
app.post('/api/routes', (req, res) => {
    const { path, target } = req.body;
    const newRoute = `\nhandle_path ${path}* {\n    reverse_proxy ${target}\n}\n`;
    fs.appendFileSync('../Caddyfile', newRoute);
    exec('caddy reload --config /etc/caddy/Caddyfile', (err, stdout, stderr) => {
        if (err) return res.status(500).send(stderr);
        res.send('Route added and Caddy reloaded');
    });
});

app.listen(4000, () => console.log('Admin panel running on port 4000'));
