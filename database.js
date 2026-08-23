const sqlite3 = require('sqlite3').verbose();

// 1. Conectamos o creamos el archivo de la base de datos
const db = new sqlite3.Database('./victory.db', (err) => {
  if (err) {
    console.error("❌ Error al abrir la base de datos:", err.message);
  } else {
    console.log("🟢 Conectado con éxito a la base de datos SQLite (victory.db).");
    
    // 2. TABLA DE CHOFERES (El personal)
    db.run(`CREATE TABLE IF NOT EXISTS choferes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      dni TEXT UNIQUE, 
      nombre TEXT, 
      vencimiento_registro TEXT
    )`);

    // 3. TABLA DE VIAJES (El micro y la ruta del día)
    db.run(`CREATE TABLE IF NOT EXISTS viajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      chofer_dni TEXT, 
      unidad TEXT, 
      origen TEXT, 
      destino TEXT, 
      fecha TEXT,
      estado TEXT DEFAULT 'PENDIENTE'
    )`);

    // 4. TABLA HOJA DE RUTA (Los pasajeros exactos de cada viaje)
    db.run(`CREATE TABLE IF NOT EXISTS hoja_ruta (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      viaje_id INTEGER, 
      dni_boleto TEXT,
      nombre_pasajero TEXT, 
      butaca TEXT, 
      parada_subida TEXT, 
      parada_bajada TEXT, 
      estado TEXT DEFAULT 'PENDIENTE', 
      hora_subida TEXT, 
      lat_subida REAL, 
      lng_subida REAL,
      hora_bajada TEXT,
      lat_bajada REAL,
      lng_bajada REAL,
      observaciones TEXT
    )`);

    console.log("✅ Tablas listas para operar.");
  }
});

// Exportamos la base de datos para usarla en el servidor
module.exports = db;
