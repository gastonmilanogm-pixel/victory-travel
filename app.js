const express = require('express');
const db = require('./database'); 
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require('multer');

const app = express();
const PORT = 3000;

// ==========================================
// CONFIGURACIÓN DE IA
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public')); 

// ==========================================
// 1. BASE DE DATOS
// ==========================================
db.serialize(() => {
  db.run(`ALTER TABLE choferes ADD COLUMN vencimiento_licencia TEXT`, (err) => {});
});

// ==========================================
// 2. RUTAS API
// ==========================================

async function procesarIAYGuardar(file, viaje_id, res) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Extraé los pasajeros de este documento (PDF o Imagen). Devolvé ÚNICAMENTE un arreglo JSON con las claves exactas: "nombre_pasajero", "dni_boleto", "butaca", "parada_subida". Sin texto adicional ni markdown.`;
    const documentPart = { inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype } };
    const result = await model.generateContent([prompt, documentPart]);
    const cleanText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const pasajeros = JSON.parse(cleanText);

    if (!pasajeros || pasajeros.length === 0) throw new Error("No se leyeron pasajeros");

    pasajeros.forEach(p => {
      db.run(`INSERT INTO hoja_ruta (viaje_id, dni_boleto, nombre_pasajero, butaca, parada_subida) VALUES (?, ?, ?, ?, ?)`, 
        [viaje_id, p.dni_boleto || 'S/N', p.nombre_pasajero, p.butaca || '0', p.parada_subida || 'Terminal']
      );
    });
    return true;
  } catch (error) {
    console.error("Error IA:", error);
    return false;
  }
}

app.post('/api/crear-viaje', (req, res) => {
  const { unidad, origen, destino } = req.body;
  db.run(`INSERT INTO viajes (chofer_dni, unidad, origen, destino, estado) VALUES ('0', ?, ?, ?, 'PENDIENTE')`, 
    [unidad, origen, destino], (err) => { res.redirect('/admin'); });
});

app.post('/api/borrar-viaje', (req, res) => {
  db.run(`DELETE FROM viajes WHERE id = ?`, [req.body.viaje_id], () => {
    db.run(`DELETE FROM hoja_ruta WHERE viaje_id = ?`, [req.body.viaje_id], () => res.json({ success: true }));
  });
});

app.post('/api/cancelar-viaje', (req, res) => {
  db.run(`UPDATE viajes SET estado = 'CANCELADO 🚨' WHERE id = ?`, [req.body.viaje_id], () => res.json({ success: true }));
});

app.post('/api/login-scan', (req, res) => {
  const { texto_escaneado } = req.body;
  let dni = texto_escaneado.includes('@') ? (texto_escaneado.split('@')[4] || texto_escaneado.split('@')[1]) : texto_escaneado;
  if (!dni) return res.json({ success: false, error: 'No se pudo leer el DNI' });
  db.get(`SELECT * FROM choferes WHERE dni = ?`, [dni], (err, chofer) => {
    if (!chofer) res.json({ success: true, require_license: true, dni: dni });
    else res.json({ success: true, require_license: false, dni: dni }); 
  });
});

app.post('/api/register-driver-foto', upload.single('fotoLicencia'), async (req, res) => {
  const { dni } = req.body;
  if (!req.file) return res.send('❌ No hay foto de licencia.');
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Extraé SOLO la fecha de vencimiento (formato DD/MM/YYYY) de esta licencia de conducir argentina. Devolvé únicamente la fecha.`;
    const documentPart = { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } };
    const result = await model.generateContent([prompt, documentPart]);
    let vencimiento = result.response.text().trim();
    
    db.run(`INSERT INTO choferes (dni, nombre, vencimiento_licencia) VALUES (?, ?, ?)`, [dni, "Chofer " + dni, vencimiento], () => {
      db.get(`SELECT id FROM viajes WHERE chofer_dni = '0' AND estado = 'PENDIENTE' LIMIT 1`, [], (err, viaje) => {
        // Redirige directamente al primer viaje disponible o al panel
        res.redirect('/');
      });
    });
  } catch (error) { 
    res.send('❌ Error al leer la licencia con IA.'); 
  }
});

app.post('/api/asignar-interno', (req, res) => {
  const { dni, interno } = req.body;
  db.get(`SELECT id FROM viajes WHERE unidad = ? AND estado = 'PENDIENTE'`, [interno], (err, viaje) => {
    if (!viaje) return res.json({ success: false, error: 'Ese interno no figura como PENDIENTE.' });
    db.run(`UPDATE viajes SET chofer_dni = ?, estado = 'EN RUTA' WHERE id = ?`, [dni, viaje.id], () => {
      res.json({ success: true, viaje_id: viaje.id });
    });
  });
});

app.post('/api/escanear', (req, res) => {
  const { codigo, lat, lng, viaje_id } = req.body;
  const hora = new Date().toLocaleTimeString('es-AR');
  db.get(`SELECT * FROM hoja_ruta WHERE dni_boleto = ? AND viaje_id = ?`, [codigo, viaje_id], (err, pasajero) => {
    if (!pasajero) return res.json({ success: false, error: 'Pasajero no encontrado.' });
    db.run(`UPDATE hoja_ruta SET estado = 'A BORDO', hora_subida = ?, lat_subida = ?, lng_subida = ? WHERE id = ?`, 
      [hora, lat, lng, pasajero.id], () => res.json({ success: true })
    );
  });
});

app.post('/api/accion', (req, res) => {
  const { id_pasajero, accion, lat, lng } = req.body;
  db.run(`UPDATE hoja_ruta SET estado = ?, hora_subida = ?, lat_subida = ?, lng_subida = ? WHERE id = ?`, 
    [accion === 'subida' ? 'A BORDO' : 'AUSENTE', new Date().toLocaleTimeString('es-AR'), lat, lng, id_pasajero], 
    () => res.json({ success: true })
  );
});

app.post('/api/subir-planilla/:viaje_id', upload.single('archivoPlanilla'), async (req, res) => {
  const viaje_id = req.params.viaje_id;
  const proviene_de_chofer = req.query.origen === 'chofer';
  
  if (!req.file) return res.send('❌ No hay archivo.');
  
  const exito = await procesarIAYGuardar(req.file, viaje_id, res);
  
  if (exito) {
    if (proviene_de_chofer) res.redirect('/viaje/' + viaje_id); 
    else res.redirect('/admin/viaje/' + viaje_id); 
  } else {
    res.send("❌ Error en la IA. Revisá que el documento sea legible.");
  }
});

// ==========================================
// 3. FRONTEND - LOGIN DEL CHOFER
// ==========================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Login Chofer</title><script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script><style>body { background: #0b2942; color: white; font-family: Arial; text-align: center; padding: 40px 20px; margin: 0; } .login-box { background: #123c5e; padding: 30px 20px; border-radius: 15px; border: 1px solid #1f6fb2; max-width: 400px; margin: 40px auto; box-shadow: 0px 5px 15px rgba(0,0,0,0.5); } h1 { color: #ffc107; font-size: 32px; } .btn { padding: 15px 30px; border-radius: 12px; font-size: 18px; font-weight: bold; border: none; cursor: pointer; color: white; width:100%; margin-top: 15px;} .btn-escaner { background: #ffc107; color: #0b2942; box-shadow: 0 6px 0 #b38600; } .btn-verde { background: #28a745; box-shadow: 0 6px 0 #1a6f2d; } input { padding: 15px; width: 100%; box-sizing: border-box; border-radius: 8px; border: none; font-size: 18px; text-align: center; margin-bottom: 10px; } #reader-container { width: 100%; max-width: 350px; margin: 20px auto; display: none; border-radius: 10px; border: 3px solid #ffc107; overflow: hidden; }</style></head><body id="caja-principal"><h1>🚍 Hoja de Ruta</h1><div class="login-box"><div id="step-1"><p>Identificate escaneando tu DNI.</p><button class="btn btn-escaner" onclick="iniciarEscaner()">📷 Escanear mi DNI</button></div><div id="reader-container"></div><div id="step-2" style="display: none;"><h3>¡Chofer Nuevo!</h3><p>Sacale una foto a tu Licencia de Conducir:</p><form action="/api/register-driver-foto" method="POST" enctype="multipart/form-data"><input type="hidden" name="dni" id="hidden-dni"><input type="file" name="fotoLicencia" accept="image/*" required style="margin:15px 0; color:white;"><button type="submit" class="btn btn-verde">Enviar Licencia 🧠</button></form></div><div id="step-3" style="display: none;"><h3>🚌 Selección de Unidad</h3><p>Ingresá el número de interno:</p><input type="text" id="input-interno" placeholder="Ej: 101"><button class="btn btn-verde" onclick="asignarInterno()">Empezar Viaje ➔</button></div></div><script>let dniGuardado = ''; let html5QrCode; function iniciarEscaner() { document.getElementById('step-1').style.display='none'; document.getElementById('reader-container').style.display='block'; if (!html5QrCode) html5QrCode = new Html5Qrcode("reader-container"); html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 100 } }, (texto) => { html5QrCode.stop(); document.getElementById('reader-container').style.display='none'; let dni = texto.includes('@') ? (texto.split('@')[4] || texto.split('@')[1]) : texto; if (!dni) { alert('No se pudo leer el DNI'); window.location.reload(); return; } dniGuardado = dni; fetch('/api/login-scan', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ texto_escaneado: texto }) }).then(res=>res.json()).then(data=>{ if(data.success) { if(data.require_license) { document.getElementById('hidden-dni').value = dniGuardado; document.getElementById('step-2').style.display='block'; } else { mostrarPasoInterno(); } } else { alert(data.error); } }); }); } function mostrarPasoInterno() { document.getElementById('step-3').style.display='block'; } function asignarInterno() { const interno = document.getElementById('input-interno').value; fetch('/api/asignar-interno', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ dni: dniGuardado, interno: interno }) }).then(res=>res.json()).then(data => { if(data.success) window.location.href = '/viaje/' + data.viaje_id; else alert(data.error); }); }</script></body></html>`);
});

// ==========================================
// 4. FRONTEND - HOJA DE RUTA (APP CHOFER)
// ==========================================
app.get('/viaje/:viaje_id', (req, res) => {
  const viaje_id = req.params.viaje_id;
  db.get(`SELECT v.*, c.dni FROM viajes v JOIN choferes c ON v.chofer_dni = c.dni WHERE v.id = ?`, [viaje_id], (err, infoViaje) => {
    if (!infoViaje) return res.send("Viaje no asignado.");
    if (infoViaje.estado.includes('CANCELADO')) return res.send("<h1>🚨 VIAJE CANCELADO</h1>");
    db.all(`SELECT * FROM hoja_ruta WHERE viaje_id = ?`, [viaje_id], (err, pasajeros) => {
      let htmlPendientes = ''; let htmlAbordo = '';
      pasajeros.forEach(p => {
        if (p.estado === 'PENDIENTE') htmlPendientes += `<div class="pasajero"><h3>👤 ${p.nombre_pasajero}</h3><p>💺 Butaca ${p.butaca}</p><div style="display:flex;gap:10px;"><button class="btn btn-verde" onclick="registrarAccion(${p.id}, 'subida')">✅ A Bordo</button><button class="btn btn-rojo" onclick="registrarAccion(${p.id}, 'ausente')">❌ Faltó</button></div></div>`;
        else if (p.estado === 'A BORDO') htmlAbordo += `<div class="pasajero" style="border-left: 5px solid #28a745;"><h3>✅ ${p.nombre_pasajero}</h3></div>`;
      });
      res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Hoja de Ruta</title><script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script><style>body { background: #0b2942; color: white; font-family: Arial; padding: 15px; } .header { background: #071d30; padding: 15px; border-radius: 10px; position: relative;} h1 { color: #ffc107; } .tabs { display: flex; margin: 15px 0; background: #123c5e; border-radius: 10px; } .tab-btn { flex: 1; padding: 10px; background: transparent; color: white; border: none; font-weight: bold;} .tab-btn.activo { color: #ffc107; border-bottom: 2px solid #ffc107; } .tab-content { display: none; } .tab-content.activo { display: block; } .btn { padding: 10px; border-radius: 8px; font-weight: bold; border: none; } .btn-verde { background: #28a745; color: white; flex:1;} .btn-rojo { background: #dc3545; color: white; flex:1;} .pasajero { background: #123c5e; padding: 15px; border-radius: 10px; margin-bottom: 10px; } #reader { width: 100%; display: none; border: 3px solid #ffc107; border-radius: 10px;} .panel-chofer { background: #071d30; padding: 15px; border-radius: 10px; border-top: 4px solid #28a745; margin-bottom: 15px;}</style></head><body>
      <div class="header">
        <h1>Unidad ${infoViaje.unidad}</h1>
        <p>📍 ${infoViaje.origen} ➔ ${infoViaje.destino}</p>
        <button onclick="window.location.reload()" style="position:absolute; right:10px; top:10px; padding: 8px; border-radius: 5px; font-size:16px;">🔄</button>
      </div>

      <div class="panel-chofer">
        <h3 style="margin-top:0; color:#28a745;">➕ Recibí Planilla Extra</h3>
        <p style="font-size:12px; color:#a5c7e6; margin-bottom:10px;">Venta de último minuto (PDF/Foto):</p>
        <form action="/api/subir-planilla/${viaje_id}?origen=chofer" method="POST" enctype="multipart/form-data" style="display:flex; gap:10px;">
          <input type="file" name="archivoPlanilla" accept=".pdf, image/*" required style="font-size:12px; color:white; flex:2;">
          <button type="submit" style="background:#28a745; color:white; padding:5px 10px; border-radius:5px; border:none; font-weight:bold; flex:1;">Subir 🧠</button>
        </form>
      </div>

      <div class="tabs"><button class="tab-btn activo" onclick="cambiarTab('pendientes')">⏳ Pendientes</button><button class="tab-btn" onclick="cambiarTab('abordo')">✅ A Bordo</button></div><div id="tab-pendientes" class="tab-content activo"><button class="btn" style="width:100%;background:#ffc107;color:#0b2942;margin-bottom:10px;" onclick="iniciarEscaner()">📷 Escanear Pasajero</button><div id="reader"></div>${htmlPendientes}</div><div id="tab-abordo" class="tab-content">${htmlAbordo}</div><script>function cambiarTab(id) { document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('activo')); document.getElementById('tab-'+id).classList.add('activo'); } const html5QrCode = new Html5Qrcode("reader"); function iniciarEscaner() { document.getElementById('reader').style.display='block'; html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (texto) => { html5QrCode.stop(); document.getElementById('reader').style.display='none'; let cod = texto.includes('@') ? (texto.split('@')[4] || texto.split('@')[1]) : texto; navigator.geolocation.getCurrentPosition((pos) => { fetch('/api/escanear', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ codigo: cod, lat: pos.coords.latitude, lng: pos.coords.longitude, viaje_id: ${viaje_id} }) }).then(res=>res.json()).then(data=>{ window.location.reload(); }); }, (err)=>alert("Activá GPS")); }).catch(err=>console.log(err)); } function registrarAccion(id, accion) { navigator.geolocation.getCurrentPosition((pos) => { fetch('/api/accion', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id_pasajero: id, accion: accion, lat: pos.coords.latitude, lng: pos.coords.longitude }) }).then(res=>window.location.reload()); }); }</script></body></html>`);
    });
  });
});

// ==========================================
// 5. TORRE DE CONTROL Y DETALLE
// ==========================================
app.get('/admin', (req, res) => {
  db.all(`SELECT v.*, c.dni as chofer_doc FROM viajes v LEFT JOIN choferes c ON v.chofer_dni = c.dni`, [], (err, viajes) => {
    let htmlCards = '';
    viajes.forEach(v => {
      let colorEstado = v.estado.includes('CANCELADO') ? '#dc3545' : (v.estado === 'PENDIENTE' ? '#ffc107' : '#28a745'); 
      htmlCards += `<div style="background:#123c5e; padding:20px; border-radius:10px; border:1px solid #1f6fb2; margin-bottom:15px;"><h3 style="margin-top:0; color:#28a745; font-size:24px;">Interno: ${v.unidad}</h3><p>📍 ${v.origen} ➔ ${v.destino}</p><p style="color:${colorEstado}; font-weight:bold;">Estado: ${v.estado}</p><div style="display:flex; gap:10px; margin-top:15px;"><a href="/admin/viaje/${v.id}" style="background:#1f6fb2; color:white; padding:10px; border-radius:5px; text-decoration:none; flex:2; text-align:center; font-weight:bold;">Planillas / Detalles ➔</a><button onclick="borrarViaje(${v.id})" style="background:#dc3545; color:white; border:none; border-radius:5px; padding:10px; cursor:pointer;">🗑️</button></div></div>`;
    });
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Torre de Control</title></head><body style="background:#0b2942;color:white;font-family:Arial;padding:20px;"><h1>🏢 Tráfico</h1><div style="background:#071d30;padding:20px;border-radius:10px;margin-bottom:20px;"><h3>➕ Nuevo Interno</h3><form action="/api/crear-viaje" method="POST" style="display:flex;gap:10px;"><input type="text" name="unidad" placeholder="Interno" required><input type="text" name="origen" placeholder="Origen" required><input type="text" name="destino" placeholder="Destino" required><button type="submit">Crear</button></form></div>${htmlCards}<script>function borrarViaje(id) { if(confirm("⚠️ ¿Eliminar viaje?")) { fetch('/api/borrar-viaje', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ viaje_id: id }) }).then(res=>res.json()).then(data=>{ window.location.reload(); }); } }</script></body></html>`);
  });
});

app.get('/admin/viaje/:id', (req, res) => {
  const viaje_id = req.params.id;
  db.get(`SELECT * FROM viajes WHERE id = ?`, [viaje_id], (err, infoViaje) => {
    db.all(`SELECT * FROM hoja_ruta WHERE viaje_id = ?`, [viaje_id], (err, pasajeros) => {
      let tablaHTML = ''; 
      pasajeros.forEach(p => tablaHTML += `<tr><td>${p.nombre_pasajero}</td><td>${p.estado}</td></tr>`);
      res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Viaje</title><style>table { width: 100%; border-collapse: collapse; } td, th { border: 1px solid #1f6fb2; padding: 10px; }</style></head><body style="background:#0b2942;color:white;font-family:Arial;padding:20px;"><a href="/admin" style="color:white;text-decoration:none;">⬅ Volver</a><h1 style="color:#ffc107;">Interno ${infoViaje.unidad}</h1><div style="background:#123c5e;padding:20px;border-radius:10px;margin-bottom:20px;border-top:4px solid #ffc107;"><h3>📄 Carga IA</h3><form action="/api/subir-planilla/${viaje_id}" method="POST" enctype="multipart/form-data"><input type="file" name="archivoPlanilla" accept=".pdf, image/*" required><button type="submit">Subir 🧠</button></form></div><table><tr><th>Pasajero</th><th>Estado</th></tr>${tablaHTML}</table></body></html>`);
    });
  });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en el puerto ${PORT}`);
});
