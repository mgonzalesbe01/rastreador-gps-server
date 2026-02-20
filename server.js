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
  console.error("❌ ERROR: Asegúrate de tener el archivo 'firebase-key.json'");
}

const db = admin.firestore();

// --- RUTAS DE LA API ---

// A. REGISTRO: El celular guarda su nombre y token en la base de datos
app.post("/api/register-device", async (req, res) => {
  const { deviceId, token } = req.body;
  if (!deviceId || !token) return res.status(400).send("Faltan datos");

  try {
    // Guardamos en la ruta obligatoria: /artifacts/{appId}/public/data/devices
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

    console.log(`📱 Dispositivo registrado en la nube: ${deviceId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// B. LISTA: La web lee los celulares guardados en Firestore
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

// C. PETICIÓN: La web marca que quiere rastrear
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  const message = {
    data: { command: "REQUEST_GPS" },
    token: deviceToken,
    android: { priority: "high" },
  };

  try {
    await admin.messaging().send(message);
    // Guardamos el estado "Buscando" en Firestore
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

// D. RECIBIR: El celular envía el GPS y lo guardamos en Firestore
app.post("/api/receive-location", async (req, res) => {
  const { lat, lng, accuracy, deviceId } = req.body;
  try {
    await db
      .collection("artifacts", appId, "public", "data", "status")
      .doc("lastLocation")
      .set({
        lat,
        lng,
        accuracy,
        deviceId,
        status: "OK",
        timestamp: Date.now(),
      });
    res.sendStatus(200);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// E. CONSULTAR: La web pregunta si ya llegó el GPS
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

// Servir la web
app.use(express.static("public"));
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor con base de datos listo en puerto ${PORT}`),
);
