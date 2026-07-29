const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    network: 'HIME Interoperability Network v1.0',
    message: 'Hub Middleware de Salud y Emergencias funcionando correctamente.'
  });
});

app.post('/v1/emergency/alert', (req, res) => {
  const { event_id, patient_info, location, vital_signs_snapshot } = req.body;

  if (!patient_info || !location) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Faltan campos obligatorios en el paquete JSON (patient_info o location).'
    });
  }

  console.log(`[HIME EVENTO RUTA EN VIVO] Alerta recibida ID: ${event_id || 'N/A'}`);

  const hime_processed_packet = {
    hime_tracking_id: `HIME-${Date.now()}`,
    status: 'DISPATCHED_TO_MEDICAL_NETWORK',
    received_at: new Date().toISOString(),
    payload_summary: {
      user: patient_info.user_id || 'Anonimo',
      coordinates: `${location.latitude}, ${location.longitude}`,
      critical_vitals: vital_signs_snapshot || 'No adjuntos'
    }
  };

  return res.status(201).json({
    success: true,
    message: 'Evento procesado y enrutado con exito a través del Hub HIME.',
    data: hime_processed_packet
  });
});

app.listen(PORT, () => {
  console.log(`Servidor HIME activo en puerto ${PORT}`);
});
