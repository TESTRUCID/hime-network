const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// 1. Conexión a Redis
const redisUrl = process.env.REDIS_URL;
let alertQueue = null;
let redisConnection = null;

if (redisUrl) {
  redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  alertQueue = new Queue('emergency-alerts', { connection: redisConnection });
}

// 2. Control de tráfico (Rate Limiting)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // Máximo 100 peticiones por minuto por IP
  message: { error: 'Demasiadas solicitudes, intente de nuevo en un minuto' }
});
app.use(limiter);

// 3. Endpoint principal (Verificación REAL mediante PING a Redis)
app.get('/', async (req, res) => {
  let isRedisHealthy = false;

  if (redisConnection) {
    try {
      const pingResult = await redisConnection.ping();
      isRedisHealthy = (pingResult === 'PONG');
    } catch (error) {
      isRedisHealthy = false;
    }
  }

  res.json({ 
    status: 'online', 
    network: 'HIME Interoperability Network',
    redisConnected: isRedisHealthy 
  });
});

// 4. Endpoint de Alerta con Autenticación Real
app.post('/v1/emergency/alert', [
  body('patientId').isString().notEmpty().withMessage('patientId es requerido'),
  body('alertType').isIn(['medical', 'security', 'disaster']).withMessage('Tipo de alerta inválido'),
  body('idempotencyKey').isUUID().withMessage('idempotencyKey debe ser un UUID válido'),
  body('patientConsentToken').isString().notEmpty().withMessage('Consentimiento del paciente es obligatorio')
], async (req, res) => {
  
  // Validar campos de entrada
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Autenticación Real: Compara contra la variable API_KEY de Render (o una clave por defecto)
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY || 'sk-hime-prod-secret';
  
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'API Key inválida o no proporcionada' });
  }

  const { idempotencyKey, patientConsentToken, ...alertData } = req.body;

  try {
    if (alertQueue && redisConnection && redisConnection.status === 'ready') {
      const job = await alertQueue.add('process-alert', {
        ...alertData,
        idempotencyKey,
        patientConsentToken,
        receivedAt: new Date().toISOString()
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });

      return res.status(202).json({
        status: 'accepted',
        jobId: job.id,
        message: 'Alerta encolada con éxito en HIME Network'
      });
    }

    res.status(503).json({ error: 'Servicio de cola no disponible en este momento' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor', detail: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`HIME Network activo en puerto ${PORT}`);
});
