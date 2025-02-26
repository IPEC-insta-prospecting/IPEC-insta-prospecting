import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express(); 
app.use(cors());
app.use(express.json());

let isBrowserActive = false;
let isScrapingCancelled = false; 

app.post('/cancel', (req, res) => {
  isScrapingCancelled = true;
  res.status(200).json({ message: 'Processo de scraping cancelado.' });
});

app.post('/scrape', async (req, res) => {
  const { segmento, cidade, estado } = req.body;
  
  if (!segmento || !cidade || !estado) {
    return res.status(400).json({ error: 'Os campos segmento, cidade e estado são obrigatórios.' });
  }

  isBrowserActive = true;
  isScrapingCancelled = false;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: puppeteer.executablePath(), 
  });

  const page = await browser.newPage();

  try {
    await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  } catch (err) {
  }

  const urlDePesquisa = "https://www.google.com.br/maps";

  try {
    await page.goto(urlDePesquisa);
    await page.waitForSelector("#searchboxinput", { visible: true });
  } catch (err) {
    console.error("Erro ao carregar a página ou encontrar o seletor:", err);
  }

  if (isScrapingCancelled) {
    await browser.close();
    return res.status(200).json({ message: 'Scraping cancelado pelo usuário.' });
  }
  
  console.log(`Buscando por ${segmento} em ${cidade}, ${estado}`);

  try {
    await page.type("#searchboxinput", `${segmento} em ${cidade}, ${estado}`);
    await page.click("#searchbox-searchbutton > span");
  } catch (err) {
    console.error("Erro ao digitar ou clicar no botão de pesquisa:", err);
  }
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1.5 });

  try {
    await page.waitForSelector('div[role="feed"]', { visible: true, timeout: 150000 });
  } catch (error) {
    console.log("Erro ao esperar o feed de resultados:", error);
    return;
  }

  await page.evaluate(async (isCancelled) => {
    const wrapper = document.querySelector('div[role="feed"]');
    if (!wrapper) {
      throw new Error("Feed de resultados não encontrado!");
    }
    
    let previousScrollHeight = 0;
    let attemptsWithoutChange = 0;
  
    while (attemptsWithoutChange < 5) {
      if (isCancelled) {
        throw new Error("Scraping cancelado pelo usuário");
      }
  
      wrapper.scrollBy(0, wrapper.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 6000));
  
      const currentScrollHeight = wrapper.scrollHeight;
      if (currentScrollHeight === previousScrollHeight) {
        attemptsWithoutChange++;
      } else {
        attemptsWithoutChange = 0;
      }
  
      previousScrollHeight = currentScrollHeight;
  
      if (wrapper.scrollTop + wrapper.clientHeight >= currentScrollHeight) {
        console.log("Rolagem completa!");
        break;
      }
    }
  }, isScrapingCancelled);  

  console.log('Scroll finalizado.');

  const links = await page.$$('div[role="feed"] > div:nth-child(odd) > [jsaction] a:not(.bm892c):not(.A1zNzb)');

  const results = [];
  const seenTitles = new Set();

  for (let i = 0; i < links.length; i++) {

    if (isScrapingCancelled) {
      await browser.close();
      return res.status(200).json({ message: 'Scraping cancelado pelo usuário.' });
    }

    const link = links[i];
    let capturouDados = false;

    await Promise.all([
      link.click(),
      await new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    try {
      await page.waitForSelector('h1.DUwDvf.lfPIob', { visible: true, timeout: 60000 });
    } catch (error) {
      console.log(`Erro ao encontrar titulo da empresa ${i}: ${error}. Continuando...`);
    }

    const existeTelefone = await page.$('button[aria-label^="Telefone:"]');
    const existeTitulo = await page.$('h1.DUwDvf.lfPIob');

    if (existeTelefone || existeTitulo) {
      try {
        const titulo = await page.$eval('h1.DUwDvf.lfPIob', el => el.textContent);
        let telefone = await page.$eval('button[aria-label^="Telefone:"]', el => el.getAttribute('aria-label'));

        let website = null;
        const existeWebsite = await page.$('div > div:nth-child(7) > div:nth-child(5) > a');
        if (existeWebsite) {
          website = await page.$eval('div > div:nth-child(7) > div:nth-child(5) > a', el => el.getAttribute('aria-label'));
        }

        if (website && website.startsWith("Website: ")) {
          website = website.replace("Website: ", "");
        }
        if (telefone && telefone.startsWith("Telefone: ")) {
          telefone = telefone.replace("Telefone: ", "");
        }

        telefone = telefone.replace(/\D/g, '');
        if (!telefone.startsWith('55')) {
        telefone = '55' + telefone; 
      }

        results.push({
          titulo,
          telefone,
          website,
        });

        capturouDados = true;
      } catch (error) {
        continue;
      }
    }

    if (i < links.length - 1) {
      await links[i + 1].click();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  const uniqueResults = [...new Map(results.map(item => [item.titulo, item])).values()];
  console.log("Número de locais encontrados:", uniqueResults.length);

  const csvFileName = `${segmento}_${cidade}_${estado}.csv`;
  const csvFilePath = path.join(__dirname, csvFileName);  

  const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: [
      { id: 'titulo', title: 'Título' },
      { id: 'telefone', title: 'Telefone' },
      { id: 'website', title: 'Website' },
    ],
  });

  try {
    await csvWriter.writeRecords(uniqueResults); 
    console.log('Arquivo CSV gerado com sucesso.');

    res.setHeader('Content-Disposition', `attachment; filename="${csvFileName}"`);
    res.setHeader('Content-Type', 'text/csv');
    res.sendFile(csvFilePath);
  } catch (error) {
    console.error('Erro ao criar o arquivo CSV:', error);
    res.status(500).json({ error: 'Erro ao processar os resultados.' });
  } finally {
    isBrowserActive = false;
    await browser.close();
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
