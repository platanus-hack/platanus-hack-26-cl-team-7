const express = require('express');
const https = require('https');
const { requireAuth } = require('../auth');
const { isText, toNumber, isIsoDate } = require('../validate');

// Simple in-memory price cache (5 min TTL) to avoid hammering Yahoo Finance
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cachedFetch(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.data);
  return fetcher().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

function yahooGet(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Bad response from Yahoo Finance')); }
      });
    }).on('error', reject);
  });
}

const RANGE_INTERVALS = {
  '1d':  '5m',
  '5d':  '1h',
  '1mo': '1d',
  '1y':  '1wk',
  'max': '1mo',
};

// Returns { values } for a valid body or { error } with the message for the 400.
function parseHolding(body) {
  const { ticker, shares, purchase_price, purchase_date, notes = '' } = body;
  if (!isText(ticker) || !shares || purchase_price == null || !purchase_date)
    return { error: 'ticker, shares, purchase_price, purchase_date required' };
  const sharesNumber = toNumber(shares);
  const priceNumber = toNumber(purchase_price);
  if (sharesNumber === null || priceNumber === null)
    return { error: 'shares and purchase_price must be numbers' };
  if (!isIsoDate(purchase_date)) return { error: 'purchase_date must be a date (YYYY-MM-DD)' };
  if (typeof notes !== 'string') return { error: 'notes must be text' };
  return { values: { ticker: ticker.toUpperCase().trim(), shares: sharesNumber, purchase_price: priceNumber, purchase_date, notes } };
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /investments — holdings with current price from Yahoo
  router.get('/', async (req, res) => {
    const holdings = db.prepare('SELECT * FROM stock_holdings ORDER BY purchase_date').all();
    const tickers = [...new Set(holdings.map(h => h.ticker))];

    const prices = {};
    await Promise.all(tickers.map(async ticker => {
      try {
        const data = await cachedFetch(`price:${ticker}`, () => yahooGet(ticker, '1d', '1d'));
        const meta = data?.chart?.result?.[0]?.meta ?? {};
        prices[ticker] = {
          current: meta.regularMarketPrice ?? null,
          prev_close: meta.chartPreviousClose ?? meta.previousClose ?? null,
          currency: meta.currency ?? 'CAD',
        };
      } catch {
        prices[ticker] = { current: null, prev_close: null, currency: 'CAD' };
      }
    }));

    res.json(holdings.map(h => ({ ...h, price: prices[h.ticker] ?? null })));
  });

  // GET /investments/history/:ticker?range=1mo
  router.get('/history/:ticker', async (req, res) => {
    const ticker = req.params.ticker;
    const range = RANGE_INTERVALS[req.query.range] ? req.query.range : '1mo';
    const interval = RANGE_INTERVALS[range];

    try {
      const data = await cachedFetch(`hist:${ticker}:${range}`, () => yahooGet(ticker, range, interval));
      const result = data?.chart?.result?.[0];
      if (!result) return res.status(404).json({ error: 'No data returned for this ticker' });

      const timestamps = result.timestamp ?? [];
      const quotes = result.indicators?.quote?.[0] ?? {};
      const closes = quotes.close ?? [];

      const points = timestamps
        .map((t, i) => ({ t: t * 1000, price: closes[i] }))
        .filter(p => p.price != null);

      res.json({ points, meta: result.meta });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /investments
  router.post('/', (req, res) => {
    const { values: v, error } = parseHolding(req.body);
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO stock_holdings (ticker, shares, purchase_price, purchase_date, notes) VALUES (?,?,?,?,?)'
    ).run(v.ticker, v.shares, v.purchase_price, v.purchase_date, v.notes);
    res.status(201).json(db.prepare('SELECT * FROM stock_holdings WHERE id=?').get(lastInsertRowid));
  });

  // PUT /investments/:id
  router.put('/:id', (req, res) => {
    const { values: v, error } = parseHolding(req.body);
    if (error) return res.status(400).json({ error });
    const result = db.prepare(
      'UPDATE stock_holdings SET ticker=?,shares=?,purchase_price=?,purchase_date=?,notes=? WHERE id=?'
    ).run(v.ticker, v.shares, v.purchase_price, v.purchase_date, v.notes, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM stock_holdings WHERE id=?').get(req.params.id));
  });

  // DELETE /investments/:id
  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM stock_holdings WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
