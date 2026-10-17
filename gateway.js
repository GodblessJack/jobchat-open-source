const express = require('express');
const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

function sendSPA(res, indexPath, appName) {
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(503).send(`<h1>${appName} is not built yet</h1><p>Run the build command and try again.</p>`);
    }
}

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Strip client-supplied forwarding headers. The proxy adds the actual client IP.
app.use((req, res, next) => {
    delete req.headers['x-forwarded-for'];
    next();
});

const proxy = httpProxy.createProxyServer({
    target: 'http://localhost:5272',
    changeOrigin: true,
    xfwd: true,
    ws: true,
});

proxy.on('error', (error, req, res) => {
    console.error(`Proxy error for ${req.method || 'WS'} ${req.url}: ${error.message}`);
    if (res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad gateway');
    } else if (res.destroy) {
        res.destroy();
    }
});

// Express strips the /api mount prefix; restore it before forwarding.
app.use('/api', (req, res) => {
    req.url = `/api${req.url}`;
    proxy.web(req, res);
});

// Preserve file downloads and signed upload/download query strings.
app.use('/files', (req, res) => {
    req.url = `/files${req.url}`;
    proxy.web(req, res);
});

app.use('/chat', express.static(path.join(__dirname, 'jchat/dist')));
app.use('/login', express.static(path.join(__dirname, 'jchat/dist')));
app.use('/call', express.static(path.join(__dirname, 'meeting/build')));
app.use('/', express.static(path.join(__dirname, 'landing/build')));

app.get(/^\/chat(\/.*)?$/, (req, res) => sendSPA(res, path.join(__dirname, 'jchat/dist/index.html'), 'JChat'));
app.get(/^\/login(\/.*)?$/, (req, res) => sendSPA(res, path.join(__dirname, 'jchat/dist/index.html'), 'JChat'));
app.get(/^\/call(\/.*)?$/, (req, res) => sendSPA(res, path.join(__dirname, 'meeting/build/index.html'), 'Meeting'));
app.get(/^.*$/, (req, res) => sendSPA(res, path.join(__dirname, 'landing/build/index.html'), 'Landing'));

const server = app.listen(PORT, () => console.log(`Gateway is running on port ${PORT}`));
server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/ws')) {
        proxy.ws(req, socket, head);
    } else {
        socket.destroy();
    }
});
