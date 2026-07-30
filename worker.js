require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const crypto = require('crypto');

console.log('⚙️ HIME Worker Iniciado - Procesando flujos médicos...');

// Conexión dedicada para el Worker
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null
});

/**
 * Función de Pseudonimización (Cumplimiento NOM-024-SSA3 / HIPAA)
 * Transforma el patientId sensible en un Hash irreversible para trazabilidad segura.
 */
const pseudonymizePatientId = (patientId) => {
  return crypto.createHmac('sha256', process.env.API_KEY || 'hime-internal-salt')
    .update(patientId)
    .digest('hex');
};

const worker = new Worker('emergency-alerts', async (job) => {
  const { patientId, alertType, idempotencyKey } = job.data;
  
  console.log(`[JOB ${job.id}] Procesando alerta de tipo: ${alertType.toUpperCase()}`);

  // Simulación de lógica de negocio/interoperabilidad HL7 FHIR
  const pseudoId = pseudonymizePatientId(patientId);
  
  // En un escenario real, aquí se llamaría a otro microservicio o base de datos médica
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simular latencia de red médica

  console.log(`[JOB ${job.id}] ÉXITO: Alerta procesada para hash_paciente: ${pseudoId}`);
  
  return {
    processedAt: new Date().toISOString(),
    traceId: idempotencyKey,
    secureHash: pseudoId
  };
}, { 
  connection: redisConnection,
  concurrency: 5 // Permite procesar hasta 5 alertas simultáneas por instancia de worker
});

// Eventos del Ciclo de Vida del Worker
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completado satisfactoriamente.`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} falló después de sus reintentos: ${err.message}`);
});

worker.on('error', (err) => {
  console.error('Critical Worker Error:', err);
});

// Manejo de cierre elegante
process.on('SIGTERM', async () => {
  await worker.close();
  redisConnection.quit();
});
