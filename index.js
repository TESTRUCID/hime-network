const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// 1. Conexión a Redis en la nube
const redisUrl = process.env.REDIS_URL;
let alertQueue = null;

if (redisUrl) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  alertQueue = new Queue('emergency-alerts', { connection });
}

// 2. Control de tráfico (Rate Limiting) - Protección DoS
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // Máximo 100 peticiones por minuto por IP
  message: { error: 'Demasiadas solicitudes, intente de nuevo en un minuto' }
});
app.use(limiter);

// 3. Endpoint principal de salud
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    network: 'HIME Interoperability Network',
    redisConnected: !!redisUrl 
  });
});

// 4. Endpoint de Alerta con Validaciones de Seguridad
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

  // Verificar Autenticación BÁSICA por Encabezado
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API Key no proporcionada en x-api-key' });
  }

  const { idempotencyKey, patientConsentToken, ...alertData } = req.body;

  try {
    // Si la cola Redis está activa, procesar asíncronamente
    if (alertQueue) {
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

    // Respuesta diferida si Redis no estuviera conectado
    res.status(200).json({ status: 'received_unqueued', data: alertData });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor', detail: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`HIME Network activo en puerto ${PORT}`);
});
