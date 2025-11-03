process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const STORE_FILE = path.join(__dirname, 'tenders.json');
const SEEN_FILE = path.join(__dirname, 'seen.json');
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '10', 10);

async function scrapePage(page) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const url = `https://etenders.gov.eg/Tender/DoSearch?page=${page}`;
  console.log('Fetching', url);
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 180000 });
  const $ = cheerio.load(res.data);
  const rows = $('table.table tbody tr');
  const items = [];
  rows.each((i, el) => {
    const a = $(el).find('td a').first();
    const tds = $(el).find('td');
    if (a && tds.length >= 3) {
      const title = a.text().trim();
      const link = a.attr('href') || '';
      const submission = $(tds.get(1)).text().trim();
      const opening = $(tds.get(2)).text().trim();
      items.push({ title, link: link.startsWith('http') ? link : ('https://etenders.gov.eg' + link), submission, opening });
    }
  });
  return items;
}

async function scrapeAll() {
  let all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    try {
      const items = await scrapePage(p);
      if (!items || items.length === 0) break;
      all = all.concat(items);
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error('Error scraping page', p, e.message || e);
      break;
    }
  }
  const map = {};
  all.forEach(it => map[it.title] = it);
  const list = Object.values(map);
  fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2));
  return list;
}

function loadTenders() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE,'utf8')); } catch(e){ return []; }
}

async function checkAndScrape() {
  try {
    const list = await scrapeAll();
    const seen = JSON.parse(fs.existsSync(SEEN_FILE) ? fs.readFileSync(SEEN_FILE,'utf8') : '[]');
    const seenSet = new Set(seen);
    const newItems = list.filter(it => !seenSet.has(it.title));
    if (newItems.length > 0) {
      console.log('New tenders found:', newItems.length);
      const combined = [...new Set([...newItems.map(i=>i.title), ...seen])];
      fs.writeFileSync(SEEN_FILE, JSON.stringify(combined, null, 2));
    } else {
      console.log('No new tenders');
    }
  } catch (e) { console.error('checkAndScrape error', e.message || e); }
}

(async ()=>{ await scrapeAll(); await checkAndScrape(); })();
const interval = process.env.SCRAPE_INTERVAL_MINUTES || '60';
cron.schedule(`*/${interval} * * * *`, () => { console.log('Scheduled scrape'); checkAndScrape(); });

const app = express();
app.get('/tenders', (req, res) => {
  const list = loadTenders();
  res.json(list);
});
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(PORT, ()=> console.log('Server listening on', PORT));
