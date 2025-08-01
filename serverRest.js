// Importiamo il modulo 'express'
const express = require('express');

// Creiamo una nuova applicazione express
const app = express();

// Definiamo una route GET per la radice ('/')
app.get('/', (req, res) => {
  // Rispondiamo con un oggetto JSON
  res.json({ message: 'Hello World' });
});

// Impostiamo il server per ascoltare sulla porta 3000
const port = 3001;
app.listen(port, () => {
  console.log(`Server in ascolto su http://localhost:${port}`);
});
