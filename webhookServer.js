const http = require('http');

/**
 * Webhook server — receives alerts from TradingView
 * 
 * Endpoints:
 *   POST /webhook — main alert receiver
 *   GET /health — health check
 * 
 * Payload types:
 *   Cluster:          { action: "cluster", type, timeframe, priceHigh, priceLow }
 *   Print:            { action: "print", price, timeframe }
 *   SMT:              { action: "smt", type, price }
 *   Price:            { action: "price", price }
 *   Bias:             { action: "bias", poc, vah, val, overnightHigh, ... }
 *   TPO Bar:          { action: "tpo", letter, high, low, open, close, period, tickSize }
 *   TPO Single Print: { action: "tpo_single_print", direction, high, low, mid, letter }
 *   TPO Reset:        { action: "tpo_reset", rthOpen }
 *   TPO Session Close:{ action: "tpo_session_close", sessionHigh, sessionLow, periodsCompleted }
 */
class WebhookServer {
    constructor(port, secret, handlers) {
        this.port = port;
        this.secret = secret;
        this.handlers = handlers;
        this.server = null;
    }

    start() {
        this.server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/webhook') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);

                        // Validate secret
                        if (this.secret && data.secret !== this.secret) {
                            res.writeHead(401);
                            res.end('Unauthorized');
                            return;
                        }

                        const action = data.action || 'cluster';

                        switch (action) {
                            case 'cluster':
                                if (data.type && data.priceHigh && data.priceLow) {
                                    this.handlers.onCluster(data);
                                }
                                break;

                            case 'print':
                                if (data.price) {
                                    this.handlers.onPrint(data);
                                }
                                break;

                            case 'smt':
                                if (data.type && data.price) {
                                    this.handlers.onSMT(data);
                                }
                                break;

                            case 'price':
                                if (data.price) {
                                    this.handlers.onPrice(parseFloat(data.price));
                                }
                                break;

                            case 'bias':
                                this.handlers.onBias(data);
                                break;

                            // ========== TPO ACTIONS ==========
                            case 'tpo':
                                if (data.high && data.low) {
                                    this.handlers.onTPO(data);
                                }
                                break;

                            case 'tpo_single_print':
                                if (data.high && data.low && data.direction) {
                                    this.handlers.onTPOSinglePrint(data);
                                }
                                break;

                            case 'tpo_reset':
                                this.handlers.onTPOReset(data);
                                break;

                            case 'tpo_session_close':
                                this.handlers.onTPOSessionClose(data);
                                break;

                            default:
                                // Legacy format (no action field)
                                if (data.type && data.priceHigh) {
                                    this.handlers.onCluster(data);
                                }
                                if (data.price) {
                                    this.handlers.onPrice(parseFloat(data.price));
                                }
                        }

                        res.writeHead(200);
                        res.end('OK');
                    } catch (e) {
                        console.error('[Webhook] Parse error:', e.message);
                        res.writeHead(400);
                        res.end('Bad Request');
                    }
                });
            } else if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`[Webhook] Port ${this.port} ready`);
        });
    }

    stop() {
        if (this.server) this.server.close();
    }
}

module.exports = WebhookServer;
