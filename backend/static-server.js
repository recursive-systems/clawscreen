import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.FRONTEND_PORT || 18842);
const HOST = process.env.FRONTEND_HOST || '0.0.0.0';

app.use(cors({ origin: true }));
app.use(express.static(projectRoot));

app.get('/', (_req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[frontend] listening on http://${HOST}:${PORT}`);
});
