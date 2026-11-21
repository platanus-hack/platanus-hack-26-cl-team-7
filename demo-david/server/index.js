const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { seedIfEmpty } = require('./seed-rich');
const { errorHandler } = require('./errors');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/status',           require('./routes/statusRoutes')(db));

app.use('/api/auth',         require('./routes/authRoutes')(db));
app.use('/api/accounts',     require('./routes/accountRoutes')(db));
app.use('/api/categories',   require('./routes/categoryRoutes')(db));
app.use('/api/budget',       require('./routes/budgetRoutes')(db));
app.use('/api/transactions', require('./routes/transactionRoutes')(db));
app.use('/api/import',       require('./routes/importRoutes')(db));
app.use('/api/debts',        require('./routes/debtRoutes')(db));
app.use('/api/goals',        require('./routes/goalRoutes')(db));
app.use('/api/rules',        require('./routes/rulesRoutes')(db));
app.use('/api/calendar',     require('./routes/calendarRoutes')(db));
app.use('/api/investments',  require('./routes/investmentRoutes')(db));

// Serve the built client whenever it exists (npm run build), in any environment.
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (_, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

if (require.main === module) {
  if (seedIfEmpty(db)) console.log('Empty database: loaded mock data');
  app.listen(config.PORT, () => console.log(`Server on port ${config.PORT}`));
}

module.exports = app;
