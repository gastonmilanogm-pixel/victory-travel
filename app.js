const express = require('express');
const db = require('./database');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;
// ==========================================
// CONFIGURACIÓN
// ==========================================
// IMPORTANTE:
// No dejamos la clave de Gemini escrita directamente en el código.
// La configuraremos después como GEMINI_API_KEY.
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// ==========================================
// TORRE DE CONTROL - SEGURIDAD
// ==========================================
// Credenciales de acceso.
// Por ahora:
// Usuario: admin
// Contraseña: Admintorre
//
// Después podemos cambiarlas por variables de entorno.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admintorre';
// ==========================================
// BASE DE DATOS
// ==========================================
db.serialize(() => {
  db.run(
    `ALTER TABLE choferes ADD COLUMN vencimiento_licencia TEXT`,
    (err) => {
      // Si ya existe la columna, ignoramos el error.
    }
  );
});
// ==========================================
// SEGURIDAD - TORRE DE CONTROL
// ==========================================
const protegerTorre = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const b64auth = authHeader.split(' ')[1] || '';
  let usuario = '';
  let password = '';
  try {
    [usuario, password] =
      Buffer.from(b64auth, 'base64')
        .toString()
        .split(':');
  } catch (e) {
    usuario = '';
    password = '';
  }
  if (
    usuario === ADMIN_USER &&
    password === ADMIN_PASSWORD
  ) {
    return next();
  }
  res.set(
    'WWW-Authenticate',
    'Basic realm="TravelFest - Torre de Control"'
  );
  res.status(401).send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport"
            content="width=device-width, initial-scale=1.0">
      <title>Acceso restringido</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          background:
            radial-gradient(
              circle at top,
              #123d5c 0,
              #071d30 45%,
              #04111c 100%
            );
          color: white;
          font-family: Arial, Helvetica, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .box {
          width: 100%;
          max-width: 420px;
          background: #0d2a40;
          border: 1px solid #1f6fb2;
          border-radius: 22px;
          padding: 30px;
          text-align: center;
          box-shadow:
            0 20px 60px rgba(0,0,0,.6);
        }
        .icon {
          font-size: 60px;
          margin-bottom: 10px;
        }
        h1 {
          color: #ffc107;
          margin-bottom: 10px;
        }
        p {
          color: #a8c7df;
        }
        .btn {
          display: inline-block;
          margin-top: 15px;
          padding: 14px 22px;
          background: #ffc107;
          color: #071d30;
          border-radius: 12px;
          text-decoration: none;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="icon">🔐</div>
        <h1>Acceso restringido</h1>
        <p>
          La Torre de Control de TravelFest
          requiere autenticación.
        </p>
        <a href="/admin" class="btn">
          Volver a intentar
        </a>
      </div>
    </body>
    </html>
  `);
};
// ==========================================
// RUTAS API
// ==========================================
// ------------------------------------------
// CREAR VIAJE
// ------------------------------------------
app.post(
  '/api/crear-viaje',
  protegerTorre,
  (req, res) => {
    const {
      unidad,
      origen,
      destino
    } = req.body;
    db.run(
      `
      INSERT INTO viajes
      (
        chofer_dni,
        unidad,
        origen,
        destino,
        estado
      )
      VALUES
      (
        '0',
        ?,
        ?,
        ?,
        'PENDIENTE'
      )
      `,
      [
        unidad,
        origen,
        destino
      ],
      (err) => {
        if (err) {
          console.error(err);
          return res
            .status(500)
            .send('Error creando viaje.');
        }
        res.redirect('/admin');
      }
    );
  }
);
// ------------------------------------------
// BORRAR VIAJE
// ------------------------------------------
app.post(
  '/api/borrar-viaje',
  protegerTorre,
  (req, res) => {
    const {
      viaje_id
    } = req.body;
    db.run(
      `DELETE FROM viajes WHERE id = ?`,
      [viaje_id],
      () => {
        db.run(
          `DELETE FROM hoja_ruta WHERE viaje_id = ?`,
          [viaje_id],
          () => {
            res.json({
              success: true
            });
          }
        );
      }
    );
  }
);
// ------------------------------------------
// CANCELAR VIAJE
// ------------------------------------------
app.post(
  '/api/cancelar-viaje',
  (req, res) => {
    const {
      viaje_id
    } = req.body;
    db.run(
      `
      UPDATE viajes
      SET estado = 'CANCELADO 🚨'
      WHERE id = ?
      `,
      [viaje_id],
      () => {
        res.json({
          success: true
        });
      }
    );
  }
);
// ==========================================
// LECTOR DE DNI
// ==========================================
function normalizarDNI(valor) {
  if (!valor) {
    return '';
  }
  const soloNumeros =
    String(valor).replace(/\D/g, '');
  if (
    soloNumeros.length === 7 ||
    soloNumeros.length === 8
  ) {
    return soloNumeros;
  }
  return '';
}
// ------------------------------------------
// EXTRAER DNI DESDE PDF417 / OCR
// ------------------------------------------
function extraerDatosDNI(texto) {
  const original =
    String(texto || '').trim();
  if (!original) {
    return {
      dni: '',
      raw: original
    };
  }
  // El PDF417 del DNI argentino
  // normalmente devuelve campos separados por @.
  const partes =
    original
      .split('@')
      .map(p => p.trim())
      .filter(Boolean);
  // Primero buscamos campos que sean
  // directamente un DNI de 7 u 8 números.
  for (const parte of partes) {
    const candidato =
      normalizarDNI(parte);
    if (!candidato) {
      continue;
    }
    const numero =
      Number(candidato);
    if (
      numero >= 1000000 &&
      numero <= 99999999
    ) {
      return {
        dni: candidato,
        raw: original
      };
    }
  }
  // ----------------------------------------
  // RESPALDO PARA OCR
  // ----------------------------------------
  const encontrados =
    original.match(/\b\d{7,8}\b/g) || [];
  for (const encontrado of encontrados) {
    const dni =
      normalizarDNI(encontrado);
    if (dni) {
      return {
        dni,
        raw: original
      };
    }
  }
  return {
    dni: '',
    raw: original
  };
}
// ==========================================
// LOGIN DEL CHOFER - DNI
// ==========================================
app.post(
  '/api/login-scan',
  (req, res) => {
    const {
      texto_escaneado
    } = req.body || {};
    const datos =
      extraerDatosDNI(texto_escaneado);
    if (!datos.dni) {
      return res.json({
        success: false,
        error:
          'No pude identificar el DNI. ' +
          'Enfocá el código del reverso ' +
          'y probá nuevamente.'
      });
    }
    db.get(
      `
      SELECT *
      FROM choferes
      WHERE dni = ?
      `,
      [datos.dni],
      (err, chofer) => {
        if (err) {
          console.error(err);
          return res.json({
            success: false,
            error:
              'Error consultando la base de datos.'
          });
        }
        res.json({
          success: true,
          require_license: !chofer,
          dni: datos.dni,
          nombre:
            chofer?.nombre || ''
        });
      }
    );
  }
);
// ==========================================
// REGISTRO DE CHOFER
// LECTURA DE LICENCIA CON IA
// ==========================================
app.post(
  '/api/register-driver',
  upload.single('foto_licencia'),
  async (req, res) => {
    const dni =
      req.body.dni;
    try {
      if (!genAI) {
        return res.json({
          success: false,
          error:
            'Falta configurar GEMINI_API_KEY en el servidor.'
        });
      }
      if (!req.file) {
        return res.json({
          success: false,
          error:
            'Falta la foto de la licencia.'
        });
      }
      const model =
        genAI.getGenerativeModel({
          model: "gemini-1.5-flash"
        });
      const prompt = `
Extraé SOLO la fecha de vencimiento
(DD/MM/YYYY) impresa en el frente
de esta licencia de conducir argentina.
Devolvé únicamente la fecha,
sin texto adicional.
`;
      const imagePart = {
        inlineData: {
          data:
            req.file.buffer.toString(
              "base64"
            ),
          mimeType:
            req.file.mimetype
        }
      };
      const result =
        await model.generateContent([
          prompt,
          imagePart
        ]);
      let vencimiento =
        result.response
          .text()
          .trim();
      db.run(
        `
        INSERT INTO choferes
        (
          dni,
          nombre,
          vencimiento_licencia
        )
        VALUES
        (?, ?, ?)
        `,
        [
          dni,
          "Chofer " + dni,
          vencimiento
        ],
        (err) => {
          if (err) {
            console.error(err);
            return res.json({
              success: false,
              error:
                'No se pudo guardar el chofer.'
            });
          }
          res.json({
            success: true,
            dni
          });
        }
      );
    } catch (error) {
      console.error(
        'Error licencia:',
        error
      );
      res.json({
        success: false,
        error:
          'Error al leer la licencia con IA. ' +
          'Probá sacar la foto con más luz.'
      });
    }
  }
);
// ==========================================
// ASIGNAR INTERNO
// ==========================================
app.post(
  '/api/asignar-interno',
  (req, res) => {
    const {
      dni,
      interno
    } = req.body;
    db.get(
      `
      SELECT id
      FROM viajes
      WHERE unidad = ?
      AND estado = 'PENDIENTE'
      `,
      [interno],
      (err, viaje) => {
        if (!viaje) {
          return res.json({
            success: false,
            error:
              'Ese interno no figura como PENDIENTE en la administración.'
          });
        }
        db.run(
          `
          UPDATE viajes
          SET
            chofer_dni = ?,
            estado = 'EN RUTA'
          WHERE id = ?
          `,
          [
            dni,
            viaje.id
          ],
          () => {
            res.json({
              success: true,
              viaje_id:
                viaje.id
            });
          }
        );
      }
    );
  }
);
// ==========================================
// ESCANEAR PASAJERO
// ==========================================
app.post(
  '/api/escanear',
  (req, res) => {
    const {
      codigo,
      lat,
      lng,
      viaje_id
    } = req.body;
    const hora =
      new Date()
        .toLocaleTimeString('es-AR');
    db.get(
      `
      SELECT *
      FROM hoja_ruta
      WHERE dni_boleto = ?
      AND viaje_id = ?
      `,
      [
        codigo,
        viaje_id
      ],
      (err, pasajero) => {
        if (!pasajero) {
          return res.json({
            success: false,
            error:
              'Pasajero no encontrado en ESTE viaje.'
          });
        }
        db.run(
          `
          UPDATE hoja_ruta
          SET
            estado = 'A BORDO',
            hora_subida = ?,
            lat_subida = ?,
            lng_subida = ?
          WHERE id = ?
          `,
          [
            hora,
            lat,
            lng,
            pasajero.id
          ],
          () => {
            res.json({
              success: true
            });
          }
        );
      }
    );
  }
);
// ==========================================
// ACCIÓN MANUAL PASAJERO
// ==========================================
app.post(
  '/api/accion',
  (req, res) => {
    const {
      id_pasajero,
      accion,
      lat,
      lng
    } = req.body;
    db.run(
      `
      UPDATE hoja_ruta
      SET
        estado = ?,
        hora_subida = ?,
        lat_subida = ?,
        lng_subida = ?
      WHERE id = ?
      `,
      [
        accion === 'subida'
          ? 'A BORDO'
          : 'AUSENTE',
        new Date()
          .toLocaleTimeString('es-AR'),
        lat,
        lng,
        id_pasajero
      ],
      () => {
        res.json({
          success: true
        });
      }
    );
  }
);
// ==========================================
// CARGA AUTOMÁTICA DE PLANILLA
// PDF / FOTO
// ==========================================
app.post(
  '/api/subir-planilla/:viaje_id',
  protegerTorre,
  upload.single('archivoPlanilla'),
  async (req, res) => {
    const viaje_id =
      req.params.viaje_id;
    try {
      if (!genAI) {
        return res.send(
          '❌ Falta configurar GEMINI_API_KEY en el servidor.'
        );
      }
      if (!req.file) {
        return res.send(
          '❌ No hay archivo.'
        );
      }
      const model =
        genAI.getGenerativeModel({
          model: "gemini-1.5-flash"
        });
      const prompt = `
Extraé los pasajeros de este documento
(PDF o Imagen).
Devolvé ÚNICAMENTE un arreglo JSON
con las claves exactas:
"nombre_pasajero"
"dni_boleto"
"butaca"
"parada_subida"
Sin texto adicional.
Sin markdown.
`;
      const documentPart = {
        inlineData: {
          data:
            req.file.buffer.toString(
              "base64"
            ),
          mimeType:
            req.file.mimetype
        }
      };
      const result =
        await model.generateContent([
          prompt,
          documentPart
        ]);
      const pasajeros =
        JSON.parse(
          result.response
            .text()
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim()
        );
      pasajeros.forEach(p => {
        db.run(
          `
          INSERT INTO hoja_ruta
          (
            viaje_id,
            dni_boleto,
            nombre_pasajero,
            butaca,
            parada_subida
          )
          VALUES
          (?, ?, ?, ?, ?)
          `,
          [
            viaje_id,
            p.dni_boleto || 'S/N',
            p.nombre_pasajero,
            p.butaca || '0',
            p.parada_subida || 'Terminal'
          ]
        );
      });
      res.redirect(
        '/admin/viaje/' + viaje_id
      );
    } catch (error) {
      console.error(error);
      res.send(
        '❌ Error en la IA. Revisá que el PDF sea legible.'
      );
    }
  }
);
// ==========================================
// CARGA MANUAL
// ==========================================
app.post(
  '/api/carga-manual/:viaje_id',
  protegerTorre,
  (req, res) => {
    const {
      nombre,
      dni,
      butaca,
      parada
    } = req.body;
    db.run(
      `
      INSERT INTO hoja_ruta
      (
        viaje_id,
        dni_boleto,
        nombre_pasajero,
        butaca,
        parada_subida
      )
      VALUES
      (?, ?, ?, ?, ?)
      `,
      [
        req.params.viaje_id,
        dni || 'S/N',
        nombre,
        butaca || '0',
        parada || 'Terminal'
      ],
      () => {
        res.redirect(
          '/admin/viaje/' +
          req.params.viaje_id
        );
      }
    );
  }
);// ==========================================
// FRONTEND - LOGIN DEL CHOFER
// ==========================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
>
<meta
  name="theme-color"
  content="#071d30"
>
<title>TravelFest | Hoja de Ruta</title>
<!-- LECTOR DE CÓDIGOS -->
<script
  src="https://unpkg.com/html5-qrcode"
  type="text/javascript">
</script>
<style>
/* =========================================
   VARIABLES
========================================= */
:root {
  --bg: #061522;
  --card: #0d2a40;
  --card2: #103b59;
  --line: #1f6fb2;
  --yellow: #ffc107;
  --green: #28a745;
  --red: #dc3545;
  --text: #ffffff;
  --muted: #a8c7df;
}
/* =========================================
   GENERAL
========================================= */
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(
      circle at top,
      #123d5c 0,
      #071d30 45%,
      #04111c 100%
    );
  color: var(--text);
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  padding: 18px;
}
/* =========================================
   CONTENEDOR
========================================= */
.wrap {
  max-width: 460px;
  margin: 0 auto;
  padding-top: 18px;
}
/* =========================================
   LOGO
========================================= */
.brand {
  text-align: center;
  margin: 8px 0 22px;
}
.logo {
  width: 72px;
  height: 72px;
  border-radius: 22px;
  background:
    linear-gradient(
      145deg,
      #ffc107,
      #ffda5c
    );
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 38px;
  box-shadow:
    0 10px 35px #0008;
}
h1 {
  margin:
    12px 0 3px;
  color:
    var(--yellow);
  font-size:
    30px;
}
.subtitle {
  color:
    var(--muted);
  margin:
    0;
}
/* =========================================
   TARJETA
========================================= */
.card {
  background:
    rgba(13,42,64,.96);
  border:
    1px solid var(--line);
  border-radius:
    22px;
  padding:
    24px;
  box-shadow:
    0 18px 50px #0008;
}
/* =========================================
   PASOS
========================================= */
.step {
  display:
    none;
}
.step.active {
  display:
    block;
}
/* =========================================
   BADGE
========================================= */
.badge {
  display:
    inline-block;
  padding:
    7px 11px;
  border-radius:
    999px;
  background:
    #071d30;
  color:
    var(--yellow);
  font-size:
    12px;
  font-weight:
    700;
}
/* =========================================
   TEXTOS
========================================= */
h2 {
  font-size:
    22px;
  margin:
    12px 0 8px;
}
p {
  line-height:
    1.45;
  color:
    var(--muted);
}
/* =========================================
   BOTONES
========================================= */
.btn {
  width:
    100%;
  border:
    0;
  border-radius:
    14px;
  padding:
    16px 18px;
  font-size:
    17px;
  font-weight:
    800;
  cursor:
    pointer;
  margin-top:
    12px;
}
.btn-yellow {
  background:
    var(--yellow);
  color:
    #071d30;
  box-shadow:
    0 5px 0 #b38600;
}
.btn-green {
  background:
    var(--green);
  color:
    #fff;
  box-shadow:
    0 5px 0 #1a6f2d;
}
.btn-gray {
  background:
    #183b54;
  color:
    #fff;
}
/* =========================================
   INPUTS
========================================= */
input {
  width:
    100%;
  padding:
    15px;
  border-radius:
    12px;
  border:
    1px solid var(--line);
  background:
    #071d30;
  color:
    #fff;
  font-size:
    17px;
  margin-top:
    8px;
  outline:
    none;
}
input:focus {
  border-color:
    var(--yellow);
  box-shadow:
    0 0 0 3px #ffc10733;
}
/* =========================================
   LECTOR DNI
========================================= */
#reader-container {
  width:
    100%;
  margin:
    18px auto 5px;
  display:
    none;
  border:
    3px solid var(--yellow);
  border-radius:
    16px;
  overflow:
    hidden;
  background:
    #000;
}
/* =========================================
   MENSAJES
========================================= */
.hint {
  font-size:
    13px;
  margin-top:
    10px;
}
.ok {
  color:
    #5ee37b;
}
.err {
  color:
    #ff6b78;
}
/* =========================================
   CARGANDO
========================================= */
.spinner {
  display:
    none;
  margin:
    18px auto;
  width:
    35px;
  height:
    35px;
  border:
    4px solid #ffffff33;
  border-top-color:
    var(--yellow);
  border-radius:
    50%;
  animation:
    spin .8s linear infinite;
}
@keyframes spin {
  to {
    transform:
      rotate(360deg);
  }
}
/* =========================================
   FOOTER
========================================= */
.footer {
  text-align:
    center;
  color:
    #6f9ab7;
  font-size:
    12px;
  margin-top:
    18px;
}
</style>
</head>
<body>
<div class="wrap">
  <!-- =====================================
       ENCABEZADO
  ====================================== -->
  <div class="brand">
    <div class="logo">
      🚍
    </div>
    <h1>
      TravelFest
    </h1>
    <p class="subtitle">
      Hoja de Ruta · Acceso de Choferes
    </p>
  </div>
  <!-- =====================================
       TARJETA PRINCIPAL
  ====================================== -->
  <div
    class="card"
    id="caja-principal"
  >
    <!-- ===================================
         PASO 1
    ==================================== -->
    <div
      id="step-1"
      class="step active"
    >
      <span class="badge">
        PASO 1 · IDENTIFICACIÓN
      </span>
      <h2>
        Leé tu DNI
      </h2>
      <p>
        Usá el
        <b>reverso del DNI</b>
        y enfocá el código de barras
        PDF417.
        El sistema intentará
        identificarlo automáticamente.
      </p>
      <button
        class="btn btn-yellow"
        onclick="iniciarEscaner()"
      >
        📷 Leer DNI
      </button>
      <!-- LECTOR -->
      <div
        id="reader-container"
      ></div>
      <p class="hint">
        💡 Buena luz, cámara limpia
        y mantené el DNI dentro
        del recuadro.
      </p>
      <div
        id="mensaje"
        class="hint"
      ></div>
    </div>
    <!-- ===================================
         PASO 2
    ==================================== -->
    <div
      id="step-2"
      class="step"
    >
      <span class="badge">
        PASO 2 · CHOFER NUEVO
      </span>
      <h2>
        Registrar licencia
      </h2>
      <p>
        El DNI fue identificado
        correctamente.
        Ahora sacale una foto clara
        al
        <b>frente de tu licencia
        de conducir</b>.
      </p>
      <input
        type="file"
        id="input-foto"
        accept="image/*"
        capture="environment"
      >
      <button
        class="btn btn-green"
        onclick="procesarFotoLicencia()"
      >
        📷 Leer licencia
      </button>
      <button
        class="btn btn-gray"
        onclick="volverDNI()"
      >
        ↩ Volver a leer DNI
      </button>
      <div
        class="spinner"
        id="spinner"
      ></div>
    </div>
    <!-- ===================================
         PASO 3
    ==================================== -->
    <div
      id="step-3"
      class="step"
    >
      <span class="badge">
        PASO 3 · DESPACHO
      </span>
      <h2>
        Seleccioná tu unidad
      </h2>
      <p
        id="chofer-confirmado"
      ></p>
      <input
        type="text"
        id="input-interno"
        placeholder="Ej.: 101 o AD186IH"
        autocomplete="off"
      >
      <button
        class="btn btn-green"
        onclick="asignarInterno()"
      >
        🚌 Empezar viaje
      </button>
    </div>
  </div>
  <div class="footer">
    TravelFest · Sistema de Operaciones
  </div>
</div>
<script>
// ==========================================
// VARIABLES
// ==========================================
let dniGuardado = '';
let html5QrCode = null;
let leyendo = false;
// ==========================================
// MENSAJES
// ==========================================
function mensaje(
  txt,
  tipo = ''
) {
  const el =
    document.getElementById(
      'mensaje'
    );
  if (!el) return;
  el.innerHTML =
    '<span class="' +
    tipo +
    '">' +
    txt +
    '</span>';
}
// ==========================================
// CAMBIAR PASO
// ==========================================
function mostrarPaso(n) {
  document
    .querySelectorAll('.step')
    .forEach(
      x =>
        x.classList.remove(
          'active'
        )
    );
  document
    .getElementById(
      'step-' + n
    )
    .classList.add(
      'active'
    );
}
// ==========================================
// VOLVER AL DNI
// ==========================================
function volverDNI() {
  dniGuardado = '';
  document
    .getElementById(
      'input-foto'
    )
    .value = '';
  mostrarPaso(1);
}
// ==========================================
// DETENER ESCÁNER
// ==========================================
async function detenerEscaner() {
  if (
    html5QrCode &&
    leyendo
  ) {
    try {
      await html5QrCode.stop();
    } catch (e) {}
    leyendo = false;
  }
  const reader =
    document.getElementById(
      'reader-container'
    );
  if (reader) {
    reader.style.display =
      'none';
  }
}
// ==========================================
// INICIAR ESCÁNER
// ==========================================
function iniciarEscaner() {
  mensaje('');
  const reader =
    document.getElementById(
      'reader-container'
    );
  reader.style.display =
    'block';
  if (!html5QrCode) {
    html5QrCode =
      new Html5Qrcode(
        'reader-container'
      );
  }
  if (leyendo) return;
  leyendo = true;
  // Intentamos PDF417.
  // Si el navegador no lo soporta,
  // usamos el lector normal.
  const formatos = [];
  if (
    window.Html5QrcodeSupportedFormats &&
    Html5QrcodeSupportedFormats.PDF_417
  ) {
    formatos.push(
      Html5QrcodeSupportedFormats.PDF_417
    );
  }
  if (
    window.Html5QrcodeSupportedFormats &&
    Html5QrcodeSupportedFormats.QR_CODE
  ) {
    formatos.push(
      Html5QrcodeSupportedFormats.QR_CODE
    );
  }
  const config = {
    fps: 12,
    qrbox: {
      width: 330,
      height: 170
    },
    disableFlip: true
  };
  if (formatos.length) {
    config.formatsToSupport =
      formatos;
  }
  // ========================================
  // PRIMER INTENTO
  // ========================================
  html5QrCode.start(
    {
      facingMode: {
        exact: 'environment'
      }
    },
    config,
    async textoEscaneado => {
      await detenerEscaner();
      procesarDNI(
        textoEscaneado
      );
    }
  )
  .catch(
    async () => {
      // ====================================
      // SEGUNDO INTENTO
      // ====================================
      try {
        await html5QrCode.start(
          {
            facingMode:
              'environment'
          },
          config,
          async textoEscaneado => {
            await detenerEscaner();
            procesarDNI(
              textoEscaneado
            );
          }
        );
      }
      catch (err) {
        leyendo = false;
        reader.style.display =
          'none';
        mensaje(
          '❌ No se pudo abrir la cámara. Revisá los permisos del navegador.',
          'err'
        );
      }
    }
  );
}
// ==========================================
// PROCESAR DNI
// ==========================================
function procesarDNI(texto) {
  mensaje(
    '🔎 DNI leído. Verificando…'
  );
  fetch(
    '/api/login-scan',
    {
      method:
        'POST',
      headers: {
        'Content-Type':
          'application/json'
      },
      body:
        JSON.stringify({
          texto_escaneado:
            texto
        })
    }
  )
  .then(
    res =>
      res.json()
  )
  .then(
    data => {
      if (!data.success) {
        mensaje(
          '❌ ' +
          data.error,
          'err'
        );
        setTimeout(
          () =>
            iniciarEscaner(),
          700
        );
        return;
      }
      // Guardamos DNI
      dniGuardado =
        data.dni;
      mensaje(
        '✅ DNI ' +
        data.dni +
        ' identificado.',
        'ok'
      );
      // ====================================
      // CHOFER NUEVO
      // ====================================
      if (
        data.require_license
      ) {
        document
          .getElementById(
            'step-2'
          )
          .classList.add(
            'active'
          );
        document
          .getElementById(
            'step-1'
          )
          .classList.remove(
            'active'
          );
      }
      // ====================================
      // CHOFER EXISTENTE
      // ====================================
      else {
        document
          .getElementById(
            'chofer-confirmado'
          )
          .innerHTML =
            'Chofer identificado: ' +
            '<strong>DNI ' +
            data.dni +
            '</strong>' +
            (
              data.nombre
                ? '<br><span style="color:#a8c7df">' +
                  data.nombre +
                  '</span>'
                : ''
            );
        mostrarPaso(3);
      }
    }
  )
  .catch(
    () => {
      mensaje(
        '❌ Error de conexión con el servidor.',
        'err'
      );
    }
  );
}
// ==========================================
// PROCESAR FOTO DE LICENCIA
// ==========================================
function procesarFotoLicencia() {
  const inputFoto =
    document.getElementById(
      'input-foto'
    );
  if (
    !inputFoto.files[0]
  ) {
    return alert(
      'Por favor, sacale una foto a la licencia primero.'
    );
  }
  const spinner =
    document.getElementById(
      'spinner'
    );
  spinner.style.display =
    'block';
  const formData =
    new FormData();
  formData.append(
    'dni',
    dniGuardado
  );
  formData.append(
    'foto_licencia',
    inputFoto.files[0]
  );
  fetch(
    '/api/register-driver',
    {
      method:
        'POST',
      body:
        formData
    }
  )
  .then(
    res =>
      res.json()
  )
  .then(
    data => {
      spinner.style.display =
        'none';
      if (data.success) {
        document
          .getElementById(
            'chofer-confirmado'
          )
          .innerHTML =
            'Chofer registrado: ' +
            '<strong>DNI ' +
            data.dni +
            '</strong>';
        mostrarPaso(3);
      }
      else {
        alert(
          '❌ ' +
          data.error
        );
      }
    }
  )
  .catch(
    () => {
      spinner.style.display =
        'none';
      alert(
        '❌ Error de conexión.'
      );
    }
  );
}
// ==========================================
// ASIGNAR INTERNO
// ==========================================
function asignarInterno() {
  const interno =
    document
      .getElementById(
        'input-interno'
      )
      .value
      .trim();
  if (!interno) {
    return alert(
      'Escribí el interno.'
    );
  }
  fetch(
    '/api/asignar-interno',
    {
      method:
        'POST',
      headers: {
        'Content-Type':
          'application/json'
      },
      body:
        JSON.stringify({
          dni:
            dniGuardado,
          interno:
            interno
        })
    }
  )
  .then(
    res =>
      res.json()
  )
  .then(
    data => {
      if (
        data.success
      ) {
        window.location.href =
          '/viaje/' +
          data.viaje_id;
      }
      else {
        alert(
          '❌ ' +
          data.error
        );
      }
    }
  )
  .catch(
    () =>
      alert(
        '❌ Error de conexión.'
      )
  );
}
</script>
</body>
</html>
`);
});// ==========================================
// 4. FRONTEND - HOJA DE RUTA
// ==========================================
app.get('/viaje/:viaje_id', (req, res) => {
  const viaje_id = req.params.viaje_id;
  db.get(
    `
    SELECT
      v.*,
      c.dni
    FROM viajes v
    JOIN choferes c
      ON v.chofer_dni = c.dni
    WHERE v.id = ?
    `,
    [viaje_id],
    (err, infoViaje) => {
      if (!infoViaje) {
        return res.send(`
          <!DOCTYPE html>
          <html lang="es">
          <body style="
            background:#071d30;
            color:white;
            font-family:Arial;
            text-align:center;
            padding:50px;
          ">
            <h1>🚍 Viaje no encontrado</h1>
            <p>
              El viaje no existe
              o todavía no fue asignado.
            </p>
          </body>
          </html>
        `);
      }
      // =====================================
      // VIAJE CANCELADO
      // =====================================
      if (
        infoViaje.estado.includes(
          'CANCELADO'
        )
      ) {
        return res.send(`
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8">
            <meta
              name="viewport"
              content="width=device-width,
              initial-scale=1.0"
            >
            <style>
              body {
                margin:0;
                min-height:100vh;
                background:#dc3545;
                color:white;
                font-family:Arial;
                display:flex;
                align-items:center;
                justify-content:center;
                text-align:center;
              }
              .box {
                padding:40px;
              }
              .icon {
                font-size:70px;
              }
            </style>
          </head>
          <body>
            <div class="box">
              <div class="icon">
                🚨
              </div>
              <h1>
                VIAJE CANCELADO
              </h1>
              <p>
                Este viaje fue cancelado
                por la Torre de Control.
              </p>
            </div>
          </body>
          </html>
        `);
      }
      // =====================================
      // PASAJEROS
      // =====================================
      db.all(
        `
        SELECT *
        FROM hoja_ruta
        WHERE viaje_id = ?
        `,
        [viaje_id],
        (err, pasajeros) => {
          let htmlPendientes = '';
          let htmlAbordo = '';
          let htmlAusentes = '';
          pasajeros.forEach(p => {
            // =================================
            // PENDIENTES
            // =================================
            if (
              p.estado === 'PENDIENTE'
            ) {
              htmlPendientes += `
                <div class="pasajero">
                  <div class="pasajero-info">
                    <div class="pasajero-icon">
                      👤
                    </div>
                    <div>
                      <h3>
                        ${p.nombre_pasajero}
                      </h3>
                      <p>
                        💺 Butaca
                        <strong>
                          ${p.butaca}
                        </strong>
                      </p>
                      <p>
                        📍 Sube:
                        ${p.parada_subida}
                      </p>
                      <p>
                        🪪 DNI / Reserva:
                        ${p.dni_boleto}
                      </p>
                    </div>
                  </div>
                  <div class="acciones">
                    <button
                      class="btn btn-verde"
                      onclick="
                        registrarAccion(
                          ${p.id},
                          'subida'
                        )
                      "
                    >
                      ✅ A Bordo
                    </button>
                    <button
                      class="btn btn-rojo"
                      onclick="
                        registrarAccion(
                          ${p.id},
                          'ausente'
                        )
                      "
                    >
                      ❌ Ausente
                    </button>
                  </div>
                </div>
              `;
            }
            // =================================
            // A BORDO
            // =================================
            else if (
              p.estado === 'A BORDO'
            ) {
              htmlAbordo += `
                <div
                  class="pasajero abordo"
                >
                  <div class="pasajero-info">
                    <div class="pasajero-icon">
                      ✅
                    </div>
                    <div>
                      <h3>
                        ${p.nombre_pasajero}
                      </h3>
                      <p>
                        💺 Butaca
                        ${p.butaca}
                      </p>
                      <p>
                        ⏱️ Subió:
                        ${p.hora_subida}
                      </p>
                    </div>
                  </div>
                </div>
              `;
            }
            // =================================
            // AUSENTES
            // =================================
            else {
              htmlAusentes += `
                <div
                  class="pasajero ausente"
                >
                  <div class="pasajero-info">
                    <div class="pasajero-icon">
                      ❌
                    </div>
                    <div>
                      <h3>
                        ${p.nombre_pasajero}
                      </h3>
                      <p>
                        💺 Butaca
                        ${p.butaca}
                      </p>
                      <p>
                        ⏱️ Marcado:
                        ${p.hora_subida}
                      </p>
                    </div>
                  </div>
                </div>
              `;
            }
          });
          // =================================
          // SIN PENDIENTES
          // =================================
          if (
            htmlPendientes === ''
          ) {
            htmlPendientes = `
              <div class="todo-listo">
                <div>
                  🎉
                </div>
                <h2>
                  ¡Todos los pasajeros listos!
                </h2>
                <p>
                  No quedan pasajeros pendientes.
                </p>
              </div>
            `;
          }
          // =================================
          // HTML
          // =================================
          res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1.0,
    viewport-fit=cover
  "
>
<meta
  name="theme-color"
  content="#071d30"
>
<title>
  TravelFest | Hoja de Ruta
</title>
<script
  src="https://unpkg.com/html5-qrcode"
  type="text/javascript">
</script>
<style>
:root {
  --bg:#061522;
  --card:#0d2a40;
  --card2:#123c5e;
  --line:#1f6fb2;
  --yellow:#ffc107;
  --green:#28a745;
  --red:#dc3545;
  --text:#ffffff;
  --muted:#a8c7df;
}
* {
  box-sizing:border-box;
}
body {
  margin:0;
  min-height:100vh;
  background:
    radial-gradient(
      circle at top,
      #123d5c 0,
      #071d30 45%,
      #04111c 100%
    );
  color:white;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  padding:15px;
}
.contenedor {
  width:100%;
  max-width:850px;
  margin:auto;
}
.header {
  background:
    rgba(7,29,48,.97);
  border:
    1px solid var(--line);
  border-left:
    5px solid var(--yellow);
  border-radius:
    18px;
  padding:
    18px;
  margin-bottom:
    18px;
  box-shadow:
    0 12px 35px #0007;
}
.header-top {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.logo {
  font-size:34px;
}
.header h1 {
  color:
    var(--yellow);
  margin:
    0;
  font-size:
    25px;
}
.header p {
  margin:
    7px 0 0;
  color:
    var(--muted);
}
.estado {
  background:
    #28a745;
  padding:
    7px 12px;
  border-radius:
    999px;
  font-size:
    12px;
  font-weight:
    bold;
}
.tabs {
  display:flex;
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    15px;
  overflow:hidden;
  margin-bottom:
    18px;
}
.tab-btn {
  flex:1;
  padding:
    15px 6px;
  background:
    transparent;
  color:
    white;
  border:
    none;
  font-weight:
    bold;
  font-size:
    13px;
}
.tab-btn.activo {
  background:
    var(--card2);
  color:
    var(--yellow);
  border-bottom:
    3px solid var(--yellow);
}
.tab-content {
  display:none;
}
.tab-content.activo {
  display:block;
}
.escaner-box {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    18px;
  padding:
    18px;
  margin-bottom:
    18px;
}
.btn {
  width:100%;
  border:none;
  border-radius:
    13px;
  padding:
    15px;
  font-size:
    16px;
  font-weight:
    bold;
  cursor:pointer;
}
.btn-escaner {
  background:
    var(--yellow);
  color:
    #071d30;
  box-shadow:
    0 5px 0 #b38600;
}
.btn-verde {
  background:
    var(--green);
  color:white;
  box-shadow:
    0 4px 0 #1a6f2d;
}
.btn-rojo {
  background:
    var(--red);
  color:white;
  box-shadow:
    0 4px 0 #921925;
}
.pasajero {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    16px;
  padding:
    16px;
  margin-bottom:
    14px;
  box-shadow:
    0 8px 25px #0004;
}
.pasajero-info {
  display:flex;
  gap:13px;
}
.pasajero-icon {
  width:43px;
  height:43px;
  border-radius:
    12px;
  background:
    #071d30;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:22px;
  flex-shrink:0;
}
.pasajero h3 {
  margin:
    0 0 7px;
  font-size:
    18px;
}
.pasajero p {
  margin:
    4px 0;
  color:
    var(--muted);
  font-size:
    14px;
}
.acciones {
  display:flex;
  gap:12px;
  margin-top:
    16px;
}
.acciones .btn {
  flex:1;
}
.abordo {
  border-left:
    5px solid var(--green);
}
.abordo h3 {
  color:
    #5ee37b;
}
.ausente {
  border-left:
    5px solid var(--red);
  opacity:.75;
}
.ausente h3 {
  color:
    #ff6b78;
}
#reader {
  width:100%;
  display:none;
  border:
    3px solid var(--yellow);
  border-radius:
    15px;
  overflow:hidden;
  margin-top:
    15px;
}
.todo-listo {
  text-align:center;
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    18px;
  padding:
    35px 20px;
}
.todo-listo div {
  font-size:
    55px;
}
.todo-listo h2 {
  color:
    var(--green);
}
.cancelar {
  margin-top:
    20px;
  padding:
    16px;
  background:
    #4b1117;
  border:
    1px solid var(--red);
  color:
    white;
  border-radius:
    14px;
  font-weight:
    bold;
  width:100%;
}
.small {
  color:
    var(--muted);
  font-size:
    13px;
  text-align:center;
  margin:
    12px 0;
}
</style>
</head>
<body>
<div class="contenedor">
  <!-- ================================
       CABECERA
  ================================= -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="logo">
          🚍
        </div>
        <h1>
          Hoja de Ruta
        </h1>
      </div>
      <div class="estado">
        EN RUTA
      </div>
    </div>
    <p>
      👋 Chofer DNI:
      <strong>
        ${infoViaje.dni}
      </strong>
    </p>
    <p>
      🚌 Interno:
      <strong>
        ${infoViaje.unidad}
      </strong>
    </p>
    <p>
      📍
      ${infoViaje.origen}
      ➜
      ${infoViaje.destino}
    </p>
  </div>
  <!-- ================================
       TABS
  ================================= -->
  <div class="tabs">
    <button
      class="tab-btn activo"
      id="btn-pendientes"
      onclick="
        cambiarTab('pendientes')
      "
    >
      ⏳ Pendientes
    </button>
    <button
      class="tab-btn"
      id="btn-abordo"
      onclick="
        cambiarTab('abordo')
      "
    >
      ✅ A Bordo
    </button>
    <button
      class="tab-btn"
      id="btn-ausentes"
      onclick="
        cambiarTab('ausentes')
      "
    >
      ❌ Ausentes
    </button>
  </div>
  <!-- ================================
       PENDIENTES
  ================================= -->
  <div
    id="tab-pendientes"
    class="tab-content activo"
  >
    <div class="escaner-box">
      <button
        class="btn btn-escaner"
        onclick="
          iniciarEscaner()
        "
      >
        📷 Escanear pasajero
      </button>
      <div id="reader"></div>
      <p class="small">
        Escaneá el código del boleto
        o QR del pasajero.
      </p>
    </div>
    ${htmlPendientes}
  </div>
  <!-- ================================
       A BORDO
  ================================= -->
  <div
    id="tab-abordo"
    class="tab-content"
  >
    ${htmlAbordo || `
      <div class="todo-listo">
        <div>🚌</div>
        <h2>
          Todavía no hay pasajeros
          a bordo.
        </h2>
      </div>
    `}
  </div>
  <!-- ================================
       AUSENTES
  ================================= -->
  <div
    id="tab-ausentes"
    class="tab-content"
  >
    ${htmlAusentes || `
      <div class="todo-listo">
        <div>👍</div>
        <h2>
          No hay pasajeros ausentes.
        </h2>
      </div>
    `}
  </div>
  <!-- ================================
       CANCELAR
  ================================= -->
  <button
    class="cancelar"
    onclick="
      cancelarViaje()
    "
  >
    🚨 Cancelar viaje por emergencia
  </button>
</div>
<script>
const viajeID =
  ${viaje_id};
// ======================================
// CAMBIAR TAB
// ======================================
function cambiarTab(tabId) {
  document
    .querySelectorAll(
      '.tab-content'
    )
    .forEach(
      el =>
        el.classList.remove(
          'activo'
        )
    );
  document
    .querySelectorAll(
      '.tab-btn'
    )
    .forEach(
      el =>
        el.classList.remove(
          'activo'
        )
    );
  document
    .getElementById(
      'tab-' + tabId
    )
    .classList.add(
      'activo'
    );
  document
    .getElementById(
      'btn-' + tabId
    )
    .classList.add(
      'activo'
    );
}
// ======================================
// ESCÁNER PASAJEROS
// ======================================
const html5QrCode =
  new Html5Qrcode(
    "reader"
  );
let escaneando =
  false;
async function detenerEscaner() {
  if (escaneando) {
    try {
      await html5QrCode.stop();
    }
    catch(e) {}
    escaneando =
      false;
  }
  document
    .getElementById(
      'reader'
    )
    .style.display =
      'none';
}
function iniciarEscaner() {
  const reader =
    document.getElementById(
      'reader'
    );
  reader.style.display =
    'block';
  if (escaneando)
    return;
  escaneando =
    true;
  html5QrCode.start(
    {
      facingMode:
        "environment"
    },
    {
      fps:12,
      qrbox:{
        width:350,
        height:150
      },
      disableFlip:true
    },
    async texto => {
      await detenerEscaner();
      let codigo =
        texto;
      // Si devuelve formato @,
      // intentamos obtener DNI/reserva.
      if (
        texto.includes('@')
      ) {
        const partes =
          texto
            .split('@')
            .filter(Boolean);
        codigo =
          partes[4] ||
          partes[1] ||
          texto;
      }
      // =================================
      // GPS
      // =================================
      navigator.geolocation
        .getCurrentPosition(
          pos => {
            fetch(
              '/api/escanear',
              {
                method:
                  'POST',
                headers:{
                  'Content-Type':
                    'application/json'
                },
                body:
                  JSON.stringify({
                    codigo:
                      codigo,
                    lat:
                      pos.coords.latitude,
                    lng:
                      pos.coords.longitude,
                    viaje_id:
                      viajeID
                  })
              }
            )
            .then(
              res =>
                res.json()
            )
            .then(
              data => {
                if (
                  data.success
                ) {
                  window
                    .location
                    .reload();
                }
                else {
                  alert(
                    '❌ ' +
                    data.error
                  );
                }
              }
            );
          },
          err => {
            alert(
              '⚠️ Activá el GPS para registrar la subida del pasajero.'
            );
          },
          {
            enableHighAccuracy:
              true
          }
        );
    }
  )
  .catch(
    err => {
      escaneando =
        false;
      reader.style.display =
        'none';
      alert(
        '❌ No se pudo abrir la cámara. Revisá los permisos.'
      );
    }
  );
}
// ======================================
// REGISTRAR ACCIÓN MANUAL
// ======================================
function registrarAccion(
  id,
  accion
) {
  navigator
    .geolocation
    .getCurrentPosition(
      pos => {
        fetch(
          '/api/accion',
          {
            method:
              'POST',
            headers:{
              'Content-Type':
                'application/json'
            },
            body:
              JSON.stringify({
                id_pasajero:
                  id,
                accion:
                  accion,
                lat:
                  pos.coords.latitude,
                lng:
                  pos.coords.longitude
              })
          }
        )
        .then(
          res =>
            res.json()
        )
        .then(
          data => {
            if (
              data.success
            ) {
              window
                .location
                .reload();
            }
            else {
              alert(
                '❌ No se pudo registrar.'
              );
            }
          }
        );
      },
      err => {
        alert(
          '⚠️ Activá el GPS.'
        );
      },
      {
        enableHighAccuracy:
          true
      }
    );
}
// ======================================
// CANCELAR VIAJE
// ======================================
function cancelarViaje() {
  const confirmar =
    confirm(
      '🚨 ¿Confirmás cancelar este viaje?\\n\\nEsta acción avisará a la central.'
    );
  if (!confirmar)
    return;
  fetch(
    '/api/cancelar-viaje',
    {
      method:
        'POST',
      headers:{
        'Content-Type':
          'application/json'
      },
      body:
        JSON.stringify({
          viaje_id:
            viajeID
        })
    }
  )
  .then(
    res =>
      res.json()
  )
  .then(
    data => {
      if (
        data.success
      ) {
        window.location.href =
          '/';
      }
    }
  );
}
</script>
</body>
</html>
`);
        }
      );
    }
  );
});
// ==========================================
// 5. TORRE DE CONTROL
// ==========================================
app.get(
  '/admin',
  protegerTorre,
  (req, res) => {
    db.all(
      `
      SELECT
        v.*,
        c.dni AS chofer_doc
      FROM viajes v
      LEFT JOIN choferes c
        ON v.chofer_dni = c.dni
      ORDER BY v.id DESC
      `,
      [],
      (err, viajes) => {
        if (err) {
          console.error(err);
          return res.status(500).send(
            'Error leyendo viajes.'
          );
        }
        let htmlCards = '';
        viajes.forEach(v => {
          let colorEstado =
            v.estado.includes(
              'CANCELADO'
            )
              ? '#dc3545'
              : (
                v.estado === 'PENDIENTE'
                  ? '#ffc107'
                  : '#28a745'
              );
          let textoChofer =
            v.chofer_doc &&
            v.chofer_doc !== '0'
              ? v.chofer_doc
              : 'Esperando asignación';
          htmlCards += `
            <div class="viaje-card">
              <div class="viaje-top">
                <div>
                  <span class="label">
                    INTERNO
                  </span>
                  <h2>
                    ${v.unidad}
                  </h2>
                </div>
                <div
                  class="estado"
                  style="
                    color:${colorEstado};
                    border-color:${colorEstado};
                  "
                >
                  ${v.estado}
                </div>
              </div>
              <div class="ruta">
                📍
                <strong>
                  ${v.origen}
                </strong>
                <span>
                  ➜
                </span>
                <strong>
                  ${v.destino}
                </strong>
              </div>
              <div class="datos">
                <div>
                  👷
                  <span>
                    Chofer
                  </span>
                  <strong>
                    ${textoChofer}
                  </strong>
                </div>
              </div>
              <div class="acciones">
                <a
                  href="/admin/viaje/${v.id}"
                  class="btn btn-azul"
                >
                  📋 Planilla
                </a>
                <button
                  onclick="
                    borrarViaje(${v.id})
                  "
                  class="btn btn-rojo"
                >
                  🗑️ Eliminar
                </button>
              </div>
            </div>
          `;
        });
        if (
          htmlCards === ''
        ) {
          htmlCards = `
            <div class="vacio">
              <div>
                🚌
              </div>
              <h2>
                No hay viajes cargados
              </h2>
              <p>
                Creá el primer viaje
                desde el formulario.
              </p>
            </div>
          `;
        }
        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1.0
  "
>
<meta
  name="theme-color"
  content="#071d30"
>
<title>
  TravelFest | Torre de Control
</title>
<style>
:root {
  --bg:#061522;
  --card:#0d2a40;
  --card2:#123c5e;
  --line:#1f6fb2;
  --yellow:#ffc107;
  --green:#28a745;
  --red:#dc3545;
  --blue:#1f6fb2;
  --muted:#a8c7df;
}
* {
  box-sizing:border-box;
}
body {
  margin:0;
  min-height:100vh;
  background:
    radial-gradient(
      circle at top,
      #123d5c 0,
      #071d30 45%,
      #04111c 100%
    );
  color:white;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  padding:20px;
}
.contenedor {
  max-width:1200px;
  margin:auto;
}
.header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  background:
    rgba(7,29,48,.97);
  border:
    1px solid var(--line);
  border-radius:
    20px;
  padding:
    20px;
  margin-bottom:
    25px;
  box-shadow:
    0 15px 40px #0007;
}
.logo {
  font-size:40px;
}
h1 {
  color:
    var(--yellow);
  margin:
    3px 0;
}
.subtitle {
  color:
    var(--muted);
  margin:
    0;
}
.seguro {
  background:
    #071d30;
  border:
    1px solid #28a745;
  color:
    #5ee37b;
  padding:
    10px 14px;
  border-radius:
    999px;
  font-size:
    13px;
  font-weight:
    bold;
}
.form-crear {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-top:
    5px solid var(--yellow);
  border-radius:
    18px;
  padding:
    22px;
  margin-bottom:
    25px;
}
.form-crear h2 {
  margin-top:0;
  color:
    var(--yellow);
}
.form {
  display:grid;
  grid-template-columns:
    repeat(3,1fr);
  gap:12px;
}
input {
  width:100%;
  padding:
    14px;
  background:
    #071d30;
  color:white;
  border:
    1px solid var(--line);
  border-radius:
    10px;
  font-size:
    16px;
}
input:focus {
  outline:none;
  border-color:
    var(--yellow);
}
.btn {
  border:none;
  border-radius:
    11px;
  padding:
    13px 16px;
  font-weight:
    bold;
  font-size:
    15px;
  cursor:pointer;
  text-decoration:none;
  display:inline-block;
  text-align:center;
}
.btn-crear {
  background:
    var(--yellow);
  color:
    #071d30;
}
.btn-azul {
  background:
    var(--blue);
  color:white;
}
.btn-rojo {
  background:
    var(--red);
  color:white;
}
.viajes-titulo {
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:
    15px;
}
.viajes-titulo h2 {
  margin:0;
}
.grid {
  display:grid;
  grid-template-columns:
    repeat(
      auto-fill,
      minmax(320px,1fr)
    );
  gap:18px;
}
.viaje-card {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    18px;
  padding:
    20px;
  box-shadow:
    0 10px 30px #0005;
}
.viaje-top {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
}
.label {
  color:
    var(--muted);
  font-size:
    11px;
  font-weight:
    bold;
}
.viaje-card h2 {
  margin:
    4px 0 0;
  color:
    #fff;
  font-size:
    30px;
}
.estado {
  border:
    1px solid;
  padding:
    7px 10px;
  border-radius:
    999px;
  font-size:
    11px;
  font-weight:
    bold;
  white-space:
    nowrap;
}
.ruta {
  background:
    #071d30;
  border-radius:
    12px;
  padding:
    14px;
  margin:
    16px 0;
  color:
    var(--muted);
}
.ruta strong {
  color:white;
}
.datos {
  color:
    var(--muted);
}
.datos span {
  margin-right:
    7px;
}
.datos strong {
  color:white;
}
.acciones {
  display:flex;
  gap:10px;
  margin-top:
    18px;
}
.acciones .btn {
  flex:1;
}
.vacio {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    18px;
  padding:
    45px;
  text-align:center;
}
.vacio div {
  font-size:
    55px;
}
.vacio h2 {
  color:
    var(--yellow);
}
.vacio p {
  color:
    var(--muted);
}
@media(max-width:700px) {
  body {
    padding:12px;
  }
  .header {
    flex-direction:
      column;
    align-items:
      flex-start;
  }
  .form {
    grid-template-columns:
      1fr;
  }
  .grid {
    grid-template-columns:
      1fr;
  }
  .acciones {
    flex-direction:
      column;
  }
}
</style>
</head>
<body>
<div class="contenedor">
  <!-- ================================
       CABECERA
  ================================= -->
  <div class="header">
    <div>
      <div class="logo">
        🚍
      </div>
      <h1>
        Torre de Control
      </h1>
      <p class="subtitle">
        TravelFest · Tráfico y Operaciones
      </p>
    </div>
    <div class="seguro">
      🔐 ACCESO PROTEGIDO
    </div>
  </div>
  <!-- ================================
       CREAR VIAJE
  ================================= -->
  <div class="form-crear">
    <h2>
      ➕ Habilitar nuevo interno
    </h2>
    <form
      action="/api/crear-viaje"
      method="POST"
      class="form"
    >
      <input
        type="text"
        name="unidad"
        placeholder="N° Interno"
        required
      >
      <input
        type="text"
        name="origen"
        placeholder="Origen"
        required
      >
      <input
        type="text"
        name="destino"
        placeholder="Destino"
        required
      >
      <button
        type="submit"
        class="btn btn-crear"
      >
        🚌 Generar hoja de ruta
      </button>
    </form>
  </div>
  <!-- ================================
       VIAJES
  ================================= -->
  <div class="viajes-titulo">
    <h2>
      🚍 Internos despachados
      (${viajes.length})
    </h2>
  </div>
  <div class="grid">
    ${htmlCards}
  </div>
</div>
<script>
// ======================================
// BORRAR VIAJE
// ======================================
function borrarViaje(id) {
  if (
    !confirm(
      '⚠️ ¿Eliminar este viaje por completo?\\n\\nSe eliminará también su hoja de ruta.'
    )
  ) {
    return;
  }
  fetch(
    '/api/borrar-viaje',
    {
      method:
        'POST',
      headers:{
        'Content-Type':
          'application/json'
      },
      body:
        JSON.stringify({
          viaje_id:
            id
        })
    }
  )
  .then(
    res =>
      res.json()
  )
  .then(
    data => {
      if (
        data.success
      ) {
        window
          .location
          .reload();
      }
      else {
        alert(
          '❌ No se pudo eliminar.'
        );
      }
    }
  )
  .catch(
    () =>
      alert(
        '❌ Error de conexión.'
      )
  );
}
</script>
</body>
</html>
`);
      }
    );
  }
);
// ==========================================
// 6. DETALLE DE VIAJE
// ==========================================
app.get(
  '/admin/viaje/:id',
  protegerTorre,
  (req, res) => {
    const viaje_id =
      req.params.id;
    db.get(
      `
      SELECT *
      FROM viajes
      WHERE id = ?
      `,
      [viaje_id],
      (err, infoViaje) => {
        if (!infoViaje) {
          return res.send(
            'Viaje no encontrado.'
          );
        }
        db.all(
          `
          SELECT *
          FROM hoja_ruta
          WHERE viaje_id = ?
          `,
          [viaje_id],
          (err, pasajeros) => {
            let tablaHTML = '';
            pasajeros.forEach(p => {
              let colorEstado =
                p.estado === 'A BORDO'
                  ? '#28a745'
                  : (
                    p.estado === 'AUSENTE'
                      ? '#dc3545'
                      : '#ffc107'
                  );
              tablaHTML += `
                <tr>
                  <td>
                    <strong>
                      ${p.nombre_pasajero}
                    </strong>
                    <br>
                    <small>
                      🪪 DNI/Reserva:
                      ${p.dni_boleto}
                    </small>
                    <br>
                    <small>
                      💺 Butaca:
                      ${p.butaca}
                    </small>
                    <br>
                    <small>
                      📍 ${p.parada_subida}
                    </small>
                  </td>
                  <td
                    style="
                      color:${colorEstado};
                      font-weight:bold;
                    "
                  >
                    ${p.estado}
                  </td>
                  <td>
                    ${
                      p.hora_subida ||
                      '-'
                    }
                  </td>
                </tr>
              `;
            });
            res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1.0
  "
>
<meta
  name="theme-color"
  content="#071d30"
>
<title>
  TravelFest | Gestión de Planilla
</title>
<style>
:root {
  --bg:#061522;
  --card:#0d2a40;
  --line:#1f6fb2;
  --yellow:#ffc107;
  --green:#28a745;
  --red:#dc3545;
  --muted:#a8c7df;
}
* {
  box-sizing:border-box;
}
body {
  margin:0;
  min-height:100vh;
  background:
    radial-gradient(
      circle at top,
      #123d5c 0,
      #071d30 45%,
      #04111c 100%
    );
  color:white;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  padding:20px;
}
.contenedor {
  max-width:1100px;
  margin:auto;
}
.btn-volver {
  display:inline-block;
  background:
    #183b54;
  color:white;
  padding:
    12px 17px;
  border-radius:
    11px;
  text-decoration:none;
  font-weight:bold;
  margin-bottom:
    20px;
}
h1 {
  color:
    var(--yellow);
}
.info {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-left:
    5px solid var(--yellow);
  border-radius:
    16px;
  padding:
    18px;
  margin-bottom:
    20px;
}
.info p {
  color:
    var(--muted);
}
.panels {
  display:grid;
  grid-template-columns:
    repeat(
      2,
      minmax(0,1fr)
    );
  gap:20px;
}
.panel {
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    17px;
  padding:
    20px;
}
.panel-ia {
  border-top:
    5px solid var(--yellow);
}
.panel-manual {
  border-top:
    5px solid var(--green);
}
.panel h2 {
  margin-top:0;
}
.panel p {
  color:
    var(--muted);
  font-size:
    14px;
}
input {
  width:100%;
  padding:
    13px;
  border:
    1px solid var(--line);
  border-radius:
    10px;
  background:
    #071d30;
  color:white;
  margin:
    5px 0;
}
.btn {
  width:100%;
  padding:
    14px;
  border:none;
  border-radius:
    11px;
  font-weight:bold;
  cursor:pointer;
  margin-top:
    8px;
}
.btn-yellow {
  background:
    var(--yellow);
  color:
    #071d30;
}
.btn-green {
  background:
    var(--green);
  color:white;
}
.tabla-box {
  margin-top:
    25px;
  background:
    var(--card);
  border:
    1px solid var(--line);
  border-radius:
    17px;
  overflow:hidden;
}
table {
  width:100%;
  border-collapse:
    collapse;
}
th,
td {
  padding:
    13px;
  border-bottom:
    1px solid var(--line);
  text-align:left;
}
th {
  background:
    #123c5e;
  color:
    var(--yellow);
}
td {
  color:white;
}
small {
  color:
    var(--muted);
}
@media(max-width:750px) {
  .panels {
    grid-template-columns:
      1fr;
  }
  body {
    padding:12px;
  }
  table {
    font-size:
      13px;
  }
}
</style>
</head>
<body>
<div class="contenedor">
  <a
    href="/admin"
    class="btn-volver"
  >
    ⬅ Volver a Torre de Control
  </a>
  <div class="info">
    <h1>
      📋 Gestión de planilla
    </h1>
    <p>
      🚌 Interno:
      <strong>
        ${infoViaje.unidad}
      </strong>
    </p>
    <p>
      📍
      ${infoViaje.origen}
      ➜
      ${infoViaje.destino}
    </p>
    <p>
      Estado:
      <strong>
        ${infoViaje.estado}
      </strong>
    </p>
  </div>
  <!-- ================================
       PANELES
  ================================= -->
  <div class="panels">
    <!-- ==============================
         IA
    =============================== -->
    <div class="panel panel-ia">
      <h2>
        🧠 Carga automática
      </h2>
      <p>
        Subí el PDF o una foto
        de la planilla.
        La IA intentará leer
        automáticamente los pasajeros.
      </p>
      <form
        action="/api/subir-planilla/${viaje_id}"
        method="POST"
        enctype="multipart/form-data"
      >
        <input
          type="file"
          name="archivoPlanilla"
          accept=".pdf,image/*"
          required
        >
        <button
          type="submit"
          class="btn btn-yellow"
        >
          🧠 Procesar planilla
        </button>
      </form>
    </div>
    <!-- ==============================
         MANUAL
    =============================== -->
    <div class="panel panel-manual">
      <h2>
        ✍️ Agregar pasajero
      </h2>
      <p>
        Para pasajeros agregados
        a último momento.
      </p>
      <form
        action="/api/carga-manual/${viaje_id}"
        method="POST"
      >
        <input
          type="text"
          name="nombre"
          placeholder="Nombre completo"
          required
        >
        <input
          type="number"
          name="dni"
          placeholder="DNI o Reserva"
        >
        <input
          type="text"
          name="butaca"
          placeholder="Butaca"
        >
        <input
          type="text"
          name="parada"
          placeholder="Parada de subida"
        >
        <button
          type="submit"
          class="btn btn-green"
        >
          ➕ Agregar pasajero
        </button>
      </form>
    </div>
  </div>
  <!-- ================================
       TABLA
  ================================= -->
  <div class="tabla-box">
    <table>
      <thead>
        <tr>
          <th>
            Pasajero
          </th>
          <th>
            Estado
          </th>
          <th>
            Hora
          </th>
        </tr>
      </thead>
      <tbody>
        ${tablaHTML}
      </tbody>
    </table>
  </div>
</div>
</body>
</html>
`);
          }
        );
      }
    );
  }
);
// ==========================================
// SERVIDOR
// ==========================================
app.listen(
  PORT,
  () => {
    console.log(
      '================================'
    );
    console.log(
      '🚍 TravelFest - Hoja de Ruta'
    );
    console.log(
      'Puerto: ' + PORT
    );
    console.log(
      'Torre de Control: PROTEGIDA 🔐'
    );
    if (!genAI) {
      console.log(
        '⚠️ GEMINI_API_KEY no configurada'
      );
      console.log(
        'La lectura IA de licencia/planilla no funcionará.'
      );
    }
    console.log(
      '================================'
    );
  }
);
