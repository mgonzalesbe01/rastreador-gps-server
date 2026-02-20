const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURACIÓN FIREBASE ---
try {
  const serviceAccount = require("./firebase-key.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 [SISTEMA] Firebase conectado.");
} catch (e) {
  console.error("❌ [ERROR] Llave firebase-key.json no encontrada.");
}

const db = admin.firestore();

// 1. REGISTRO
app.post("/api/register-device", async (req, res) => {
  const { deviceId, token } = req.body;
  try {
    await db.collection("artifacts").doc(deviceId).set(
      {
        deviceId,
        token,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`📱 [DISPOSITIVO] Registrado: ${deviceId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// 2. LISTA
app.get("/api/devices", async (req, res) => {
  const snapshot = await db.collection("artifacts").get();
  const devices = [];
  snapshot.forEach((doc) => {
    if (doc.id !== "lastLocation") devices.push(doc.data());
  });
  res.json(devices);
});

// 3. SOLICITUD (Orden de rastreo)
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  console.log(
    `📡 [WEB] Solicitando GPS al token: ${deviceToken.substring(0, 10)}...`,
  );

  const message = {
    data: { command: "REQUEST_GPS" },
    token: deviceToken,
    android: { priority: "high" },
  };

  try {
    await admin.messaging().send(message);
    // Limpiamos la ubicación vieja para que la web detecte el cambio
    await db.collection("artifacts").doc("lastLocation").delete();
    console.log("🚀 [FCM] Mensaje enviado al celular.");
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [FCM ERROR] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 4. RECIBIR (¡Esta es la parte que falta en tus logs!)
app.post("/api/receive-location", async (req, res) => {
  console.log("📥 [RECIBIENDO] Datos entrando desde el celular...");
  const { lat, lng, accuracy, deviceId, provider } = req.body;

  if (!lat || !lng) {
    console.log("⚠️ [ADVERTENCIA] El celular envió una petición vacía.");
    return res.status(400).send("Datos incompletos");
  }

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
    console.log(`✅ [UBICACIÓN GUARDADA] ${lat}, ${lng} de ${deviceId}`);
    res.sendStatus(200);
  } catch (error) {
    console.error(`❌ [ERROR FIRESTORE] ${error.message}`);
    res.status(500).send(error.message);
  }
});

// 5. STATUS
app.get("/api/get-status", async (req, res) => {
  const doc = await db.collection("artifacts").doc("lastLocation").get();
  res.json(doc.exists ? doc.data() : { status: "WAITING" });
});

app.use(express.static("public"));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor listo en puerto ${PORT}`));
