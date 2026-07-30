
require('dotenv').config();
const express = require('express');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const CircuitBreaker = require('opossum');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || 'sk-hime-prod-secret';

// 1. Configuración de Redis con Manejo Defensivo
const redisConfig = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', redisConfig);

redisConnection.on('error', (err) => {
  console.error(' [REDIS ERROR]: No se pudo conectar a la instancia. El servidor sigue en marcha pero las colas están inactivas.', err.message);
});

// 2. Configuración de BullMQ
const emergencyQueue = new Queue('emergency-alerts', { connection: redisConnection });

// 3. Circuit Breaker para encolado (Resiliencia)
const breakerOptions = { timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 30000 };
const enqueueAlert = async (data) => {
  return await emergencyQueue.add('process-alert', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true
  });
};
const breaker = new CircuitBreaker(enqueueAlert, breakerOptions);

// 4. Middlewares de Seguridad y Control
app.use(express.json());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones. Límite de seguridad de HIME Network excedido.' }
});
app.use(limiter);

const authenticateAPI = (req, res, next) => {
  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid HIME API Key' });
  }
  next();
};

// 5. Endpoints
// Healthcheck Real
app.get('/', async (req, res) => {
  let redisStatus = false;
  try {
    const ping = await redisConnection.ping();
    redisStatus = ping === 'PONG';
  } catch (e) {
    redisStatus = false;
  }

  res.json({
    status: "online",
    network: "HIME Interoperability Network",
    timestamp: new Date().toISOString(),
    redisConnected: redisStatus
  });
});

// Endpoint de Alerta de Emergencia
app.post('/v1/emergency/alert', 
  authenticateAPI,
  [
    body('patientId').isString().notEmpty().trim(),
    body('alertType').isIn(['medical', 'security', 'disaster']),
    body('idempotencyKey').isUUID(4),
    body('patientConsentToken').isString().notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', errors: errors.array() });
    }

    try {
      // Usar Circuit Breaker para evitar caídas si Redis está saturado
      const job = await breaker.fire(req.body);

      return res.status(202).json({
        status: "accepted",
        jobId: job.id,
        message: "Alerta encolada con éxito en HIME Network",
        trackingUrl: `/v1/status/${job.id}`
      });
    } catch (error) {
      console.error(' [API ERROR]: Fallo al encolar alerta.', error.message);
      return res.status(503).json({
        status: 'error',
        message: 'Servicio temporalmente sobrecargado. Reintente en unos segundos.'
      });
    }
  }
);

// 6. Arranque del Servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 HIME Hub operando en puerto ${PORT}`);
});

// Manejo de señales de cierre
process.on('SIGTERM', () => {
  console.log('Cierre de señal SIGTERM recibido. Limpiando conexiones...');
  server.close(() => {
    redisConnection.quit();
    process.exit(0);
  });
});
