import express from 'express';
import dotenv from 'dotenv';
import healthRouter from './routes/health.js';
import oauthRouter from './routes/oauth.js';
import salesforceRouter from './routes/salesforce.js';
import intentRoutes from './routes/intent.routes.js';

dotenv.config();

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/oauth', oauthRouter);
app.use('/sf', salesforceRouter);
app.use('/intent', intentRoutes);

const PORT = process.env.PORT ?? 4000;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
