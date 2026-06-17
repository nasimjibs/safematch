require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  const key = process.env.OPENROUTER_API_KEY || '';
  console.log(`SafeMatch server running on http://localhost:${PORT}`);
  console.log(`API key configured: ${key && key.startsWith('sk-or-') ? 'Yes' : 'NO — set OPENROUTER_API_KEY in .env'}`);
});
