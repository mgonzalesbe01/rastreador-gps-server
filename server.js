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
  console.log("🔥 [SISTEMA] Firebase conectado y listo.");
} catch (e) {
  console.error("❌ [ERROR] Llave firebase-key.json no encontrada.");
}

const db = admin.firestore();

// 1. REGISTRO (El celular informa su nombre y su token)
app.post("/api/register-device", async (req, res) => {
  const { deviceId, token } = req.body;
  console.log(`📱 [REGISTRO] Solicitud de: ${deviceId}`);
  try {
    await db.collection("artifacts").doc(deviceId).set(
      {
        deviceId,
        token,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`✅ [DISPOSITIVO] ${deviceId} registrado con éxito.`);
    res.json({ success: true });
  } catch (e) {
    console.error(`❌ [ERROR REGISTRO] ${e.message}`);
    res.status(500).send(e.message);
  }
});

// 2. LISTA (La web consulta qué celulares hay)
app.get("/api/devices", async (req, res) => {
  try {
    const snapshot = await db.collection("artifacts").get();
    const devices = [];
    snapshot.forEach((doc) => {
      // Filtramos para no mostrar el documento de estado de ubicación
      if (doc.id !== "lastLocation") devices.push(doc.data());
    });
    res.json(devices);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// 3. SOLICITUD (La web ordena rastrear)
app.post("/api/request-location", async (req, res) => {
  const { deviceToken } = req.body;
  console.log(
    `📡 [WEB] Solicitando GPS al token: ${deviceToken.substring(0, 10)}...`,
  );

  const message = {
    data: { command: "REQUEST_GPS" }, // COMANDO DE DATOS (Invisible)
    token: deviceToken,
    android: {
      priority: "high",
      ttl: 0, // Mensaje inmediato, no se guarda en cola
    },
  };

  try {
    await admin.messaging().send(message);
    // IMPORTANTE: Borramos la ubicación anterior para que la web detecte que estamos esperando una nueva
    await db.collection("artifacts").doc("lastLocation").delete();
    console.log(
      "🚀 [FCM] Orden enviada a los servidores de Google para el celular.",
    );
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ [FCM ERROR] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 4. RECIBIR (El celular envía sus coordenadas AQUÍ)
app.post("/api/receive-location", async (req, res) => {
  console.log("📥 [RECIBIENDO] Datos entrando desde el celular...");
  const { lat, lng, accuracy, deviceId, provider } = req.body;

  if (!lat || !lng) {
    console.log(
      "⚠️ [ALERTA] El celular intentó enviar datos pero llegaron vacíos.",
    );
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
    console.log(
      `✅ [UBICACIÓN GUARDADA] Lat: ${lat}, Lng: ${lng} de ${deviceId}`,
    );
    res.sendStatus(200);
  } catch (error) {
    console.error(`❌ [ERROR FIRESTORE] ${error.message}`);
    res.status(500).send(error.message);
  }
});

// 5. STATUS (La web pregunta: ¿Ya llegó la ubicación?)
app.get("/api/get-status", async (req, res) => {
  const doc = await db.collection("artifacts").doc("lastLocation").get();
  res.json(doc.exists ? doc.data() : { status: "WAITING" });
});

app.use(express.static("public"));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`),
);
