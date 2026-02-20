const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ID de la aplicación para organizar los datos
const appId = "mi-rastreador-gps";

// --- CONFIGURACIÓN FIREBASE ---
try {
  const serviceAccount = require("./firebase-key.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 [FIREBASE] Conectado y listo.");
} catch (e) {
  console.error("❌ [ERROR] No se pudo cargar firebase-key.json");
}

const db = admin.firestore();

// 1. REGISTRO (Cuando el celular se conecta)
app.post("/api/register-device", async (req, res) => {
  const { deviceId, token } = req.body;
  console.log(`📱 [REGISTRO] Intentando registrar: ${deviceId}`);
  try {
    await db.collection("artifacts").doc(deviceId).set(
      {
        deviceId,
        token,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`✅ [REGISTRO] ${deviceId} guardado con éxito.`);
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [ERROR REGISTRO] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 2. LISTA (Para la web)
app.get("/api/devices", async (req, res) => {
  try {
    const snapshot = await db.collection("artifacts").get();
    const devices = [];
    snapshot.forEach((doc) => {
      if (doc.id !== "lastLocation") {
        // Ignoramos el doc de ubicación
        devices.push(doc.data());
      }
    });
    console.log(`📋 [LISTA] Enviando ${devices.length} dispositivos a la web.`);
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. SOLICITUD (Cuando presionas el botón en la web)
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  console.log(
    `📡 [SOLICITUD] Enviando orden de GPS al token: ${deviceToken.substring(0, 10)}...`,
  );

  const message = {
    data: { command: "REQUEST_GPS" },
    token: deviceToken,
    android: { priority: "high" },
  };

  try {
    await admin.messaging().send(message);
    // Limpiamos la ubicación anterior para esperar la nueva
    await db
      .collection("artifacts")
      .doc("lastLocation")
      .set({ status: "WAITING" });
    console.log("🚀 [FCM] Mensaje enviado al celular.");
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [ERROR FCM] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 4. RECIBIR (Cuando el celular responde)
app.post("/api/receive-location", async (req, res) => {
  const { lat, lng, accuracy, deviceId, provider } = req.body;
  console.log(`📍 [GPS RECIBIDO] De: ${deviceId} (Acc: ${accuracy}m)`);
  try {
    await db.collection("artifacts").doc("lastLocation").set({
      lat,
      lng,
      accuracy,
      deviceId,
      provider,
      status: "OK",
      timestamp: Date.now(),
    });
    res.sendStatus(200);
  } catch (error) {
    console.error(`❌ [ERROR GUARDADO] ${error.message}`);
    res.status(500).send(error.message);
  }
});

// 5. CONSULTAR (La web pregunta por el resultado)
app.get("/api/get-status", async (req, res) => {
  const doc = await db.collection("artifacts").doc("lastLocation").get();
  res.json(doc.exists ? doc.data() : { status: "WAITING" });
});

app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor Pro listo en puerto ${PORT}`));
