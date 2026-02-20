const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ID de la aplicación para organizar los datos en Firestore
const appId = typeof __app_id !== "undefined" ? __app_id : "mi-rastreador-gps";

// --- CONFIGURACIÓN FIREBASE ---
try {
  const serviceAccount = require("./firebase-key.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Conectado a Firebase y Firestore correctamente");
} catch (e) {
  console.error(
    "❌ ERROR: Asegúrate de tener el archivo 'firebase-key.json' en la raíz",
  );
}

const db = admin.firestore();

// --- RUTAS DE LA API ---

// 1. REGISTRO: El celular guarda su nombre y token en Firestore
app.post("/api/register-device", async (req, res) => {
  const { deviceId, token } = req.body;
  if (!deviceId || !token) return res.status(400).send("Faltan datos");

  try {
    await db
      .collection("artifacts", appId, "public", "data", "devices")
      .doc(deviceId)
      .set(
        {
          deviceId,
          token,
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    console.log(`📱 Dispositivo registrado: ${deviceId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. LISTA: La web lee los celulares disponibles
app.get("/api/devices", async (req, res) => {
  try {
    const snapshot = await db
      .collection("artifacts", appId, "public", "data", "devices")
      .get();
    const devices = [];
    snapshot.forEach((doc) => devices.push(doc.data()));
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. PETICIÓN: La web solicita rastreo vía Firebase Cloud Messaging
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  if (!deviceToken) return res.status(400).json({ error: "Falta el Token" });

  const message = {
    data: { command: "REQUEST_GPS" },
    token: deviceToken,
    android: { priority: "high" },
  };

  try {
    await admin.messaging().send(message);
    // Marcamos estado pendiente
    await db
      .collection("artifacts", appId, "public", "data", "status")
      .doc("lastLocation")
      .set(
        {
          status: "REQUESTED",
        },
        { merge: true },
      );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. RECIBIR: El celular envía el GPS y el "PROVEEDOR" (GPS/Red)
app.post("/api/receive-location", async (req, res) => {
  const { lat, lng, accuracy, deviceId, provider } = req.body;
  try {
    await db
      .collection("artifacts", appId, "public", "data", "status")
      .doc("lastLocation")
      .set({
        lat,
        lng,
        accuracy,
        deviceId,
        provider: provider || "network", // Guardamos si es GPS o Red
        status: "OK",
        timestamp: Date.now(),
      });
    console.log(`📍 GPS recibido de ${deviceId} vía ${provider}`);
    res.sendStatus(200);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 5. CONSULTAR: La web pregunta si ya hay datos nuevos
app.get("/api/get-status", async (req, res) => {
  try {
    const doc = await db
      .collection("artifacts", appId, "public", "data", "status")
      .doc("lastLocation")
      .get();
    res.json(doc.exists ? doc.data() : { status: "WAITING" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- SERVIR LA WEB ---
app.use(express.static("public"));

// SOLUCIÓN: Para evitar el PathError en Node 22, usamos la ruta raíz específica
// Como es una aplicación de una sola página, esto es lo más seguro.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor Pro listo en puerto ${PORT}`));
