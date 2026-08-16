'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { db } = require('./db');
const E = require('./examen');

const PORT = Number(process.env.PORT || 8080);
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'profe123';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 512 * 1024;
const SESION_DOCENTE_MS = 12 * 60 * 60 * 1000;

// ───────────────────────────── utilidades ─────────────────────────────

const ahora = () => Date.now();
const id = () => crypto.randomBytes(9).toString('base64url');
const token = () => crypto.randomBytes(24).toString('base64url');

const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

function nuevoCodigo() {
  const existe = db.prepare('SELECT 1 FROM runs WHERE code = ?');
  for (let intento = 0; intento < 40; intento++) {
    let c = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) c += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
    if (!existe.get(c)) return c;
  }
  throw new Error('No se pudo generar un código libre');
}

function json(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const error = (res, status, msg) => json(res, status, { ok: false, error: msg });

function leerCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function cookie(nombre, valor, maxAge) {
  const partes = [`${nombre}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  partes.push(`Max-Age=${maxAge}`);
  return partes.join('; ');
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) {
        reject(new Error('body demasiado grande'));
        req.destroy();
        return;
      }
      trozos.push(c);
    });
    req.on('end', () => {
      if (!trozos.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(trozos).toString('utf8')));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// ───────────────────────────── autenticación ─────────────────────────────

const sesionesDocente = new Map(); // token -> vence (ms)

function nuevaSesionDocente() {
  const t = token();
  sesionesDocente.set(t, ahora() + SESION_DOCENTE_MS);
  return t;
}

function esDocente(req) {
  const t = leerCookies(req).es_docente;
  if (!t) return false;
  const vence = sesionesDocente.get(t);
  if (!vence) return false;
  if (vence < ahora()) {
    sesionesDocente.delete(t);
    return false;
  }
  return true;
}

function claveValida(intento) {
  const a = Buffer.from(String(intento || ''));
  const b = Buffer.from(TEACHER_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function alumnoDe(req) {
  const t = leerCookies(req).es_alumno;
  if (!t) return null;
  return db.prepare('SELECT * FROM students WHERE token = ?').get(t) || null;
}

// ───────────────────────────── consultas ─────────────────────────────

const Q = {
  examen: db.prepare('SELECT * FROM exams WHERE id = ?'),
  examenes: db.prepare('SELECT * FROM exams ORDER BY updated_at DESC'),
  run: db.prepare('SELECT * FROM runs WHERE id = ?'),
  runPorCodigo: db.prepare('SELECT * FROM runs WHERE code = ?'),
  runsDeExamen: db.prepare('SELECT * FROM runs WHERE exam_id = ? ORDER BY created_at DESC'),
  runsActivos: db.prepare("SELECT * FROM runs WHERE status = 'running'"),
  alumnos: db.prepare('SELECT * FROM students WHERE run_id = ? ORDER BY joined_at ASC'),
  alumno: db.prepare('SELECT * FROM students WHERE id = ?'),
  incidentes: db.prepare('SELECT * FROM incidents WHERE student_id = ? ORDER BY at ASC'),
  incidentesRun: db.prepare('SELECT * FROM incidents WHERE run_id = ? ORDER BY at ASC'),
};

function parse(txt, fallback) {
  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function examenPublico(fila) {
  const questions = parse(fila.questions, []);
  const runs = Q.runsDeExamen.all(fila.id);
  return {
    id: fila.id,
    title: fila.title,
    subject: fila.subject,
    instructions: fila.instructions,
    timeLimit: fila.time_limit,
    questions,
    puntajeTotal: Math.round(questions.reduce((a, q) => a + q.points, 0) * 100) / 100,
    createdAt: fila.created_at,
    updatedAt: fila.updated_at,
    tomas: runs.length,
    ultimaToma: runs.length ? runs[0].created_at : null,
  };
}

function runPublico(fila) {
  return {
    id: fila.id,
    examId: fila.exam_id,
    code: fila.code,
    title: fila.title,
    subject: fila.subject,
    instructions: fila.instructions,
    timeLimit: fila.time_limit,
    status: fila.status,
    createdAt: fila.created_at,
    startedAt: fila.started_at,
    endsAt: fila.ends_at,
    endedAt: fila.ended_at,
  };
}

/** Foto completa de una toma para el docente: incluye claves y correcciones. */
function fotoDocente(runId) {
  const fila = Q.run.get(runId);
  if (!fila) return null;
  const questions = parse(fila.questions, []);
  const alumnos = Q.alumnos.all(runId).map((a) => {
    const answers = parse(a.answers, {});
    const overrides = parse(a.overrides, {});
    const incidents = Q.incidentes.all(a.id).map((i) => ({ at: i.at, dur: i.dur, type: i.type }));
    return {
      id: a.id,
      name: a.name,
      course: a.course,
      status: a.status,
      joinedAt: a.joined_at,
      submittedAt: a.submitted_at,
      submitReason: a.submit_reason,
      lastSeen: a.last_seen,
      tarde: Boolean(fila.started_at && a.joined_at > fila.started_at),
      answers,
      overrides,
      incidents,
      correccion: E.corregir(questions, answers, overrides),
    };
  });
  return { ok: true, run: runPublico(fila), questions, alumnos, now: ahora() };
}

/** Estado que ve un alumno: sin claves de corrección y sin datos de sus compañeros. */
function estadoAlumno(alumnoFila) {
  const fila = Q.run.get(alumnoFila.run_id);
  if (!fila) return null;
  const enCurso = fila.status === 'running';
  const questions = parse(fila.questions, []);
  const presentes = Q.alumnos.all(fila.id);
  return {
    ok: true,
    student: {
      id: alumnoFila.id,
      name: alumnoFila.name,
      course: alumnoFila.course,
      status: alumnoFila.status,
      submittedAt: alumnoFila.submitted_at,
      submitReason: alumnoFila.submit_reason,
    },
    run: {
      code: fila.code,
      title: fila.title,
      subject: fila.subject,
      instructions: fila.instructions,
      status: fila.status,
      timeLimit: fila.time_limit,
      startedAt: fila.started_at,
      endsAt: fila.ends_at,
    },
    questions: enCurso ? E.sanitizarParaAlumno(questions) : null,
    answers: enCurso ? parse(alumnoFila.answers, {}) : {},
    sala: presentes.map((p) => ({ name: p.name, course: p.course, status: p.status })),
    now: ahora(),
  };
}

// ───────────────────────────── canal SSE ─────────────────────────────

const clientes = new Set(); // { res, rol: 'docente'|'alumno', runId, studentId }

function abrirSSE(req, res, cliente) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  const entrada = { ...cliente, res };
  clientes.add(entrada);
  const latido = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* la limpieza la hace el close */
    }
  }, 25000);
  const cerrar = () => {
    clearInterval(latido);
    clientes.delete(entrada);
  };
  req.on('close', cerrar);
  res.on('error', cerrar);
  return entrada;
}

function enviar(entrada, evento, datos) {
  try {
    entrada.res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  } catch {
    clientes.delete(entrada);
  }
}

/** Reenvía el estado a todos los conectados a una toma. */
function difundir(runId) {
  const foto = fotoDocente(runId);
  if (!foto) return;
  for (const c of clientes) {
    if (c.runId !== runId) continue;
    if (c.rol === 'docente') {
      enviar(c, 'estado', foto);
    } else {
      const fila = Q.alumno.get(c.studentId);
      if (!fila) continue;
      const estado = estadoAlumno(fila);
      if (estado) enviar(c, 'estado', estado);
    }
  }
}

/** Aviso puntual al docente, para el panel de actividad en vivo. */
function avisarDocentes(runId, evento, datos) {
  for (const c of clientes) {
    if (c.runId === runId && c.rol === 'docente') enviar(c, evento, datos);
  }
}

// ───────────────────────────── acciones ─────────────────────────────

function cerrarToma(runId, motivo) {
  const fila = Q.run.get(runId);
  if (!fila || fila.status === 'ended') return;
  const t = ahora();
  db.prepare("UPDATE runs SET status = 'ended', ended_at = ? WHERE id = ?").run(t, runId);
  db.prepare(
    "UPDATE students SET status = 'submitted', submitted_at = ?, submit_reason = ? WHERE run_id = ? AND status != 'submitted'"
  ).run(t, motivo, runId);
  difundir(runId);
}

// Cada segundo: cortar las tomas cuyo tiempo se agotó.
setInterval(() => {
  const t = ahora();
  for (const fila of Q.runsActivos.all()) {
    if (fila.ends_at && fila.ends_at <= t) cerrarToma(fila.id, 'tiempo');
  }
}, 1000).unref();

// ───────────────────────────── rutas ─────────────────────────────

async function rutasApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const seg = p.split('/').filter(Boolean); // ['api', ...]

  if (p === '/api/health') return json(res, 200, { ok: true, now: ahora() });

  // ---------- docente: sesión ----------
  if (p === '/api/teacher/login' && m === 'POST') {
    const body = await leerBody(req);
    if (!claveValida(body.password)) return error(res, 401, 'Clave incorrecta.');
    const t = nuevaSesionDocente();
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('es_docente', t, SESION_DOCENTE_MS / 1000) });
  }
  if (p === '/api/teacher/logout' && m === 'POST') {
    const t = leerCookies(req).es_docente;
    if (t) sesionesDocente.delete(t);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('es_docente', '', 0) });
  }
  if (p === '/api/teacher/me') return json(res, 200, { ok: esDocente(req) });

  // ---------- alumno ----------
  if (p === '/api/join' && m === 'POST') {
    const body = await leerBody(req);
    const codigo = E.limpiarTexto(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nombre = E.limpiarTexto(body.name, 60);
    const curso = E.limpiarTexto(body.course, 40);
    if (!codigo) return error(res, 400, 'Ingresá el código del examen.');
    if (!nombre) return error(res, 400, 'Ingresá tu nombre y apellido.');

    const fila = Q.runPorCodigo.get(codigo);
    if (!fila) return error(res, 404, 'No existe un examen con ese código.');
    if (fila.status === 'ended') return error(res, 409, 'Ese examen ya está cerrado.');

    // Si el alumno ya tenía sesión en esta misma toma, la reutiliza (F5, reconexión).
    const previo = alumnoDe(req);
    if (previo && previo.run_id === fila.id) {
      db.prepare('UPDATE students SET name = ?, course = ?, last_seen = ? WHERE id = ?')
        .run(nombre, curso, ahora(), previo.id);
      difundir(fila.id);
      return json(res, 200, estadoAlumno(Q.alumno.get(previo.id)));
    }

    if (Q.alumnos.all(fila.id).length >= 200) return error(res, 409, 'La sala está completa.');

    const t = ahora();
    const alumnoId = id();
    const alumnoToken = token();
    db.prepare(
      `INSERT INTO students (id, run_id, token, name, course, status, joined_at, answers, overrides, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?)`
    ).run(alumnoId, fila.id, alumnoToken, nombre, curso, fila.status === 'running' ? 'active' : 'waiting', t, t);

    difundir(fila.id);
    return json(res, 200, estadoAlumno(Q.alumno.get(alumnoId)), {
      'Set-Cookie': cookie('es_alumno', alumnoToken, 24 * 3600),
    });
  }

  if (p === '/api/student/state') {
    const a = alumnoDe(req);
    // Es el sondeo que hace la página al cargar: "no hay sesión" es una respuesta
    // válida, no un error, así que no devolvemos 401.
    if (!a) return json(res, 200, { ok: true, student: null });
    db.prepare('UPDATE students SET last_seen = ? WHERE id = ?').run(ahora(), a.id);
    return json(res, 200, estadoAlumno(a));
  }

  if (p === '/api/student/stream') {
    const a = alumnoDe(req);
    if (!a) return error(res, 401, 'Sin sesión de alumno.');
    const entrada = abrirSSE(req, res, { rol: 'alumno', runId: a.run_id, studentId: a.id });
    enviar(entrada, 'estado', estadoAlumno(a));
    return;
  }

  if (p === '/api/student/answer' && m === 'POST') {
    const a = alumnoDe(req);
    if (!a) return error(res, 401, 'Sin sesión de alumno.');
    const fila = Q.run.get(a.run_id);
    if (!fila || fila.status !== 'running') return error(res, 409, 'El examen no está en curso.');
    if (a.status === 'submitted') return error(res, 409, 'Ya entregaste el examen.');

    const body = await leerBody(req);
    const questions = parse(fila.questions, []);
    const q = questions.find((x) => x.id === body.questionId);
    if (!q) return error(res, 400, 'Pregunta desconocida.');

    let valor = body.value;
    if (q.type === 'mc') valor = Number(valor);
    else if (q.type === 'tf') valor = Boolean(valor);
    else if (q.type === 'ms') {
      valor = [...new Set((Array.isArray(valor) ? valor : []).map(Number))]
        .filter((k) => Number.isInteger(k) && k >= 0 && k < (q.options || []).length)
        .sort((x, y) => x - y);
    } else valor = String(valor == null ? '' : valor).slice(0, q.type === 'long' ? 5000 : 300);

    const answers = parse(a.answers, {});
    answers[q.id] = valor;
    db.prepare('UPDATE students SET answers = ?, last_seen = ? WHERE id = ?')
      .run(JSON.stringify(answers), ahora(), a.id);
    difundir(a.run_id);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/student/incident' && m === 'POST') {
    const a = alumnoDe(req);
    if (!a) return error(res, 401, 'Sin sesión de alumno.');
    const body = await leerBody(req);
    const tipo = String(body.type || '');
    if (!Object.prototype.hasOwnProperty.call(E.TIPOS_EVENTO, tipo)) {
      return error(res, 400, 'Tipo de evento desconocido.');
    }
    const cuantos = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE student_id = ?').get(a.id).n;
    if (cuantos >= 500) return json(res, 200, { ok: true, ignorado: true });

    const dur = Math.max(0, Math.min(Number(body.dur) || 0, 6 * 3600 * 1000));
    const at = ahora();
    db.prepare('INSERT INTO incidents (student_id, run_id, at, dur, type) VALUES (?, ?, ?, ?, ?)')
      .run(a.id, a.run_id, at, dur, tipo);
    avisarDocentes(a.run_id, 'incidente', {
      studentId: a.id,
      name: a.name,
      course: a.course,
      incident: { at, dur, type: tipo },
    });
    difundir(a.run_id);
    return json(res, 200, { ok: true, total: cuantos + 1 });
  }

  if (p === '/api/student/submit' && m === 'POST') {
    const a = alumnoDe(req);
    if (!a) return error(res, 401, 'Sin sesión de alumno.');
    if (a.status === 'submitted') return json(res, 200, estadoAlumno(Q.alumno.get(a.id)));
    const t = ahora();
    db.prepare("UPDATE students SET status = 'submitted', submitted_at = ?, submit_reason = 'manual' WHERE id = ?")
      .run(t, a.id);
    difundir(a.run_id);
    return json(res, 200, estadoAlumno(Q.alumno.get(a.id)));
  }

  // ---------- a partir de acá, solo el docente ----------
  if (!esDocente(req)) return error(res, 401, 'Necesitás iniciar sesión como docente.');

  // /api/exams
  if (p === '/api/exams' && m === 'GET') {
    return json(res, 200, { ok: true, exams: Q.examenes.all().map(examenPublico) });
  }
  if (p === '/api/exams' && m === 'POST') {
    const body = await leerBody(req);
    const title = E.limpiarTexto(body.title, 120);
    if (!title) return error(res, 400, 'Poné un título al examen.');
    const { questions, error: err } = E.validarPreguntas(body.questions);
    if (err) return error(res, 400, err);
    const limite = Math.round(Number(body.timeLimit));
    if (!Number.isFinite(limite) || limite < 60 || limite > 6 * 3600) {
      return error(res, 400, 'El tiempo debe estar entre 1 y 360 minutos.');
    }
    const t = ahora();
    const examId = id();
    db.prepare(
      `INSERT INTO exams (id, title, subject, instructions, time_limit, questions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      examId,
      title,
      E.limpiarTexto(body.subject, 60),
      E.limpiarTexto(body.instructions, 800),
      limite,
      JSON.stringify(questions),
      t,
      t
    );
    return json(res, 200, { ok: true, exam: examenPublico(Q.examen.get(examId)) });
  }

  if (seg[0] === 'api' && seg[1] === 'exams' && seg[2] && seg.length === 3) {
    const fila = Q.examen.get(seg[2]);
    if (!fila) return error(res, 404, 'Examen inexistente.');
    if (m === 'GET') return json(res, 200, { ok: true, exam: examenPublico(fila) });
    if (m === 'PUT') {
      const body = await leerBody(req);
      const title = E.limpiarTexto(body.title, 120);
      if (!title) return error(res, 400, 'Poné un título al examen.');
      const { questions, error: err } = E.validarPreguntas(body.questions);
      if (err) return error(res, 400, err);
      const limite = Math.round(Number(body.timeLimit));
      if (!Number.isFinite(limite) || limite < 60 || limite > 6 * 3600) {
        return error(res, 400, 'El tiempo debe estar entre 1 y 360 minutos.');
      }
      db.prepare(
        'UPDATE exams SET title = ?, subject = ?, instructions = ?, time_limit = ?, questions = ?, updated_at = ? WHERE id = ?'
      ).run(
        title,
        E.limpiarTexto(body.subject, 60),
        E.limpiarTexto(body.instructions, 800),
        limite,
        JSON.stringify(questions),
        ahora(),
        fila.id
      );
      return json(res, 200, { ok: true, exam: examenPublico(Q.examen.get(fila.id)) });
    }
    if (m === 'DELETE') {
      // Las tomas ya rendidas se conservan: guardan su propia copia de las preguntas.
      db.prepare('DELETE FROM exams WHERE id = ?').run(fila.id);
      return json(res, 200, { ok: true });
    }
  }

  if (seg[0] === 'api' && seg[1] === 'exams' && seg[3] === 'duplicate' && m === 'POST') {
    const fila = Q.examen.get(seg[2]);
    if (!fila) return error(res, 404, 'Examen inexistente.');
    const t = ahora();
    const nuevo = id();
    db.prepare(
      `INSERT INTO exams (id, title, subject, instructions, time_limit, questions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nuevo, (fila.title + ' (copia)').slice(0, 120), fila.subject, fila.instructions, fila.time_limit, fila.questions, t, t);
    return json(res, 200, { ok: true, exam: examenPublico(Q.examen.get(nuevo)) });
  }

  // Tomas de un examen
  if (seg[0] === 'api' && seg[1] === 'exams' && seg[3] === 'runs') {
    const fila = Q.examen.get(seg[2]);
    if (!fila) return error(res, 404, 'Examen inexistente.');

    if (m === 'GET') {
      const runs = Q.runsDeExamen.all(fila.id).map((r) => ({
        ...runPublico(r),
        alumnos: Q.alumnos.all(r.id).length,
      }));
      return json(res, 200, { ok: true, runs });
    }

    if (m === 'POST') {
      const body = await leerBody(req);
      const questions = parse(fila.questions, []);
      if (!questions.length) return error(res, 400, 'El examen no tiene preguntas.');
      let limite = Math.round(Number(body.timeLimit));
      if (!Number.isFinite(limite)) limite = fila.time_limit;
      if (limite < 60 || limite > 6 * 3600) return error(res, 400, 'El tiempo debe estar entre 1 y 360 minutos.');

      const runId = id();
      db.prepare(
        `INSERT INTO runs (id, exam_id, code, title, subject, instructions, questions, time_limit, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lobby', ?)`
      ).run(runId, fila.id, nuevoCodigo(), fila.title, fila.subject, fila.instructions, fila.questions, limite, ahora());
      return json(res, 200, { ok: true, run: runPublico(Q.run.get(runId)) });
    }
  }

  // Todas las tomas (historial)
  if (p === '/api/runs' && m === 'GET') {
    const runs = db
      .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 200')
      .all()
      .map((r) => {
        const alumnos = Q.alumnos.all(r.id);
        return {
          ...runPublico(r),
          alumnos: alumnos.length,
          entregados: alumnos.filter((a) => a.status === 'submitted').length,
          incidentes: Q.incidentesRun.all(r.id).length,
        };
      });
    return json(res, 200, { ok: true, runs });
  }

  if (seg[0] === 'api' && seg[1] === 'runs' && seg[2]) {
    const fila = Q.run.get(seg[2]);
    if (!fila) return error(res, 404, 'Toma inexistente.');
    const runId = fila.id;

    if (seg.length === 3 && m === 'GET') return json(res, 200, fotoDocente(runId));

    if (seg.length === 3 && m === 'DELETE') {
      db.prepare('DELETE FROM incidents WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM students WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
      difundir(runId);
      return json(res, 200, { ok: true });
    }

    if (seg[3] === 'stream' && m === 'GET') {
      const entrada = abrirSSE(req, res, { rol: 'docente', runId });
      enviar(entrada, 'estado', fotoDocente(runId));
      return;
    }

    if (seg[3] === 'start' && m === 'POST') {
      if (fila.status === 'ended') return error(res, 409, 'Esa toma ya está cerrada.');
      if (fila.status === 'running') return json(res, 200, fotoDocente(runId));
      const body = await leerBody(req);
      let limite = Math.round(Number(body.timeLimit));
      if (!Number.isFinite(limite)) limite = fila.time_limit;
      if (limite < 60 || limite > 6 * 3600) return error(res, 400, 'El tiempo debe estar entre 1 y 360 minutos.');

      const t = ahora();
      db.prepare("UPDATE runs SET status = 'running', started_at = ?, ends_at = ?, time_limit = ? WHERE id = ?")
        .run(t, t + limite * 1000, limite, runId);
      db.prepare("UPDATE students SET status = 'active' WHERE run_id = ? AND status = 'waiting'").run(runId);
      difundir(runId);
      return json(res, 200, fotoDocente(runId));
    }

    if (seg[3] === 'end' && m === 'POST') {
      cerrarToma(runId, 'docente');
      return json(res, 200, fotoDocente(runId));
    }

    if (seg[3] === 'extend' && m === 'POST') {
      if (fila.status !== 'running') return error(res, 409, 'La toma no está en curso.');
      const body = await leerBody(req);
      const minutos = Math.round(Number(body.minutes));
      if (!Number.isFinite(minutos) || minutos === 0 || Math.abs(minutos) > 120) {
        return error(res, 400, 'Ajuste de tiempo fuera de rango.');
      }
      const nuevoFin = Math.max(ahora() + 5000, fila.ends_at + minutos * 60000);
      db.prepare('UPDATE runs SET ends_at = ? WHERE id = ?').run(nuevoFin, runId);
      difundir(runId);
      return json(res, 200, fotoDocente(runId));
    }

    // /api/runs/:id/students/:sid/...
    if (seg[3] === 'students' && seg[4]) {
      const alumno = Q.alumno.get(seg[4]);
      if (!alumno || alumno.run_id !== runId) return error(res, 404, 'Alumno inexistente.');

      if (seg[5] === 'override' && m === 'POST') {
        const body = await leerBody(req);
        const questions = parse(fila.questions, []);
        if (!questions.some((q) => q.id === body.questionId)) return error(res, 400, 'Pregunta desconocida.');
        const overrides = parse(alumno.overrides, {});
        if (body.value === null) delete overrides[body.questionId];
        else overrides[body.questionId] = Boolean(body.value);
        db.prepare('UPDATE students SET overrides = ? WHERE id = ?').run(JSON.stringify(overrides), alumno.id);
        difundir(runId);
        return json(res, 200, { ok: true });
      }

      if (seg[5] === 'submit' && m === 'POST') {
        const t = ahora();
        db.prepare("UPDATE students SET status = 'submitted', submitted_at = ?, submit_reason = 'docente' WHERE id = ?")
          .run(t, alumno.id);
        difundir(runId);
        return json(res, 200, { ok: true });
      }

      if (seg.length === 5 && m === 'DELETE') {
        db.prepare('DELETE FROM incidents WHERE student_id = ?').run(alumno.id);
        db.prepare('DELETE FROM students WHERE id = ?').run(alumno.id);
        difundir(runId);
        return json(res, 200, { ok: true });
      }
    }
  }

  return error(res, 404, 'Ruta no encontrada.');
}

// ───────────────────────────── archivos estáticos ─────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/docente' || rel === '/docente/') rel = '/docente.html';

  const destino = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!destino.startsWith(PUBLIC_DIR)) return error(res, 403, 'Prohibido.');

  fs.readFile(destino, (err, datos) => {
    if (err) return error(res, 404, 'Archivo no encontrado.');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Content-Length': datos.length,
      'Cache-Control': 'no-cache',
    });
    res.end(datos);
  });
}

// ───────────────────────────── arranque ─────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    rutasApi(req, res, url).catch((e) => {
      if (res.headersSent) return;
      const msg = e && e.message === 'JSON inválido' ? 'JSON inválido.' : 'Error interno del servidor.';
      if (!msg.includes('JSON')) console.error('[api]', e);
      json(res, msg.includes('JSON') ? 400 : 500, { ok: false, error: msg });
    });
    return;
  }
  servirEstatico(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Evaluador Seguro escuchando en http://localhost:${PORT}`);
  console.log(`  alumnos → /        docente → /docente`);
  if (TEACHER_PASSWORD === 'profe123') {
    console.log('  ⚠ Usando la clave por defecto. Definí TEACHER_PASSWORD antes de exponerlo en red.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
