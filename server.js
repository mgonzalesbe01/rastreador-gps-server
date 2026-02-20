const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURACIÓN FIREBASE ---
// Aquí cargaremos la llave privada que descargaremos de Firebase enseguida
try {
  const serviceAccount = require("./firebase-key.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Firebase conectado correctamente");
} catch (e) {
  console.warn(
    "⚠️ Advertencia: No se encontró 'firebase-key.json'. Las notificaciones no funcionarán hasta que lo agregues.",
  );
}

// --- MEMORIA DEL SERVIDOR ---
// Guardamos los celulares conectados y la última ubicación en la memoria RAM
let registeredDevices = [];
let lastLocation = {
  lat: 0,
  lng: 0,
  accuracy: 0,
  status: "WAITING",
  timestamp: null,
};

// --- ENDPOINTS (Rutas de la API) ---

// 1. El celular se registra automáticamente al abrir la app
app.post("/api/register-device", (req, res) => {
  const { deviceId, token } = req.body;

  if (!deviceId || !token) return res.status(400).send("Faltan datos");

  // Buscamos si el celular ya estaba registrado
  const index = registeredDevices.findIndex((d) => d.deviceId === deviceId);
  if (index >= 0) {
    registeredDevices[index].token = token; // Actualiza el token si cambió
  } else {
    registeredDevices.push({ deviceId, token }); // Lo añade si es nuevo
  }

  console.log(`📱 Dispositivo registrado: ${deviceId}`);
  res.json({ success: true, message: "Dispositivo registrado" });
});

// 2. La página web pide la lista de celulares
app.get("/api/devices", (req, res) => {
  res.json(registeredDevices);
});

// 3. La página web pide rastrear un celular específico
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  if (!deviceToken)
    return res.status(400).json({ error: "Falta el Token del dispositivo" });

  // Mensaje silencioso de alta prioridad para despertar la app de Kotlin
  const message = {
    data: { command: "REQUEST_GPS" },
    token: deviceToken,
    android: { priority: "high" },
  };

  try {
    await admin.messaging().send(message);
    lastLocation.status = "REQUESTED";
    res.json({ success: true });
  } catch (error) {
    console.error("Error enviando orden FCM:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. El celular envía sus coordenadas (GPS) al servidor
app.post("/api/receive-location", (req, res) => {
  const { lat, lng, accuracy, deviceId } = req.body;
  console.log(
    `📍 Coordenadas recibidas de ${deviceId}: Lat ${lat}, Lng ${lng}`,
  );

  lastLocation = {
    lat,
    lng,
    accuracy,
    deviceId,
    status: "OK",
    timestamp: new Date(),
  };
  res.sendStatus(200);
});

// 5. La página web pregunta constantemente: "¿Ya llegaron las coordenadas?"
app.get("/api/get-status", (req, res) => {
  res.json(lastLocation);
});

// --- SERVIR LA PÁGINA WEB ---
// Le decimos a Node que todos los archivos estáticos (HTML) estarán en la carpeta 'public'
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor web y API corriendo en el puerto ${PORT}`);
  console.log(`👉 Abre tu navegador en: http://localhost:${PORT}`);
});
