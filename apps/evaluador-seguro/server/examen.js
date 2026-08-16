'use strict';

// Lógica de examen compartida por todos los endpoints: validación de preguntas,
// autocorrección y cálculo de nota. Vive en el servidor para que el alumno nunca
// reciba las respuestas correctas.

const TIPOS = new Set(['mc', 'ms', 'tf', 'sa', 'long']);

const TIPOS_EVENTO = {
  'cambio-de-pestana': 'Cambio de pestaña / ventana oculta',
  'ventana-sin-foco': 'Ventana sin foco',
  'atajo-f12': 'Atajo detectado (F12)',
  'atajo-copiar-pegar': 'Atajo detectado (Ctrl+C / Ctrl+V)',
  'salida-pantalla-completa': 'Salida de pantalla completa',
  'cierre-pestana': 'Cierre de pestaña · sesión interrumpida',
};

const norm = (s) =>
  String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const sinResponder = (v) => v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');

function limpiarTexto(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Normaliza y valida el arreglo de preguntas que manda el editor del docente.
 * Devuelve { questions, error }.
 */
function validarPreguntas(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'El examen necesita al menos una pregunta.' };
  }
  if (raw.length > 60) return { error: 'Máximo 60 preguntas por examen.' };

  const questions = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i] || {};
    const n = i + 1;
    const type = String(q.type || '');
    if (!TIPOS.has(type)) return { error: `Pregunta ${n}: tipo de pregunta desconocido.` };

    const text = limpiarTexto(q.text, 600);
    if (!text) return { error: `Pregunta ${n}: falta el enunciado.` };

    const points = Number(q.points);
    if (!Number.isFinite(points) || points <= 0 || points > 100) {
      return { error: `Pregunta ${n}: el puntaje debe ser un número mayor a 0.` };
    }

    const out = { id: 'q' + n, type, text, points: Math.round(points * 100) / 100 };

    if (type === 'mc' || type === 'ms') {
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => limpiarTexto(o, 240))
        .filter((o) => o !== '');
      if (options.length < 2) return { error: `Pregunta ${n}: cargá al menos 2 opciones.` };
      if (options.length > 8) return { error: `Pregunta ${n}: máximo 8 opciones.` };
      out.options = options;

      if (type === 'mc') {
        const correct = Number(q.correct);
        if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          return { error: `Pregunta ${n}: marcá cuál es la opción correcta.` };
        }
        out.correct = correct;
      } else {
        const set = [...new Set((Array.isArray(q.correct) ? q.correct : []).map(Number))]
          .filter((k) => Number.isInteger(k) && k >= 0 && k < options.length)
          .sort((a, b) => a - b);
        if (set.length === 0) return { error: `Pregunta ${n}: marcá al menos una opción correcta.` };
        out.correct = set;
      }
    } else if (type === 'tf') {
      if (typeof q.correct !== 'boolean') {
        return { error: `Pregunta ${n}: elegí si la afirmación es verdadera o falsa.` };
      }
      out.correct = q.correct;
    } else if (type === 'sa') {
      const accepted = (Array.isArray(q.accepted) ? q.accepted : [])
        .map((a) => limpiarTexto(a, 120))
        .filter((a) => a !== '');
      if (accepted.length === 0) {
        return { error: `Pregunta ${n}: cargá al menos una respuesta aceptada.` };
      }
      if (accepted.length > 20) return { error: `Pregunta ${n}: máximo 20 respuestas aceptadas.` };
      out.accepted = [...new Set(accepted)];
    }
    // 'long' (desarrollo) no lleva clave: siempre lo corrige el docente a mano.

    questions.push(out);
  }
  return { questions };
}

/** Versión de las preguntas que sí puede ver el alumno: sin claves de corrección. */
function sanitizarParaAlumno(questions) {
  return questions.map((q) => {
    const out = { id: q.id, type: q.type, text: q.text, points: q.points };
    if (q.options) out.options = q.options;
    return out;
  });
}

/**
 * Corrección automática de una respuesta.
 * Devuelve true / false, o null si el tipo no se puede corregir solo.
 */
function autoCorregir(q, val) {
  if (sinResponder(val)) return false;

  if (q.type === 'mc') return Number(val) === q.correct;

  if (q.type === 'tf') return (val === true || val === 'true') === q.correct;

  if (q.type === 'ms') {
    const dado = [...new Set((Array.isArray(val) ? val : []).map(Number))]
      .filter((k) => Number.isInteger(k))
      .sort((a, b) => a - b);
    const esperado = q.correct;
    return dado.length === esperado.length && dado.every((k, i) => k === esperado[i]);
  }

  if (q.type === 'sa') {
    const dado = norm(val);
    return (q.accepted || []).some((a) => norm(a) === dado);
  }

  return null; // 'long'
}

/**
 * Estado de corrección de cada pregunta para un alumno, aplicando los ajustes
 * manuales del docente por encima de la autocorrección.
 */
function corregir(questions, answers, overrides) {
  const detalle = questions.map((q) => {
    const val = answers[q.id];
    const auto = autoCorregir(q, val);
    const tieneOverride = Object.prototype.hasOwnProperty.call(overrides || {}, q.id);
    const ok = tieneOverride ? Boolean(overrides[q.id]) : auto;
    return {
      id: q.id,
      type: q.type,
      auto,
      override: tieneOverride ? Boolean(overrides[q.id]) : null,
      ok,
      points: q.points,
      respondida: !sinResponder(val),
    };
  });

  const total = questions.reduce((a, q) => a + q.points, 0);
  const obtenido = detalle.reduce((a, d) => a + (d.ok === true ? d.points : 0), 0);
  const pendientes = detalle.filter((d) => d.ok === null).length;

  return {
    detalle,
    total: Math.round(total * 100) / 100,
    obtenido: Math.round(obtenido * 100) / 100,
    // Nota sobre 10, redondeada a un decimal.
    nota: total > 0 ? Math.round((obtenido / total) * 100) / 10 : 0,
    pendientes,
    provisional: pendientes > 0,
    respondidas: detalle.filter((d) => d.respondida).length,
  };
}

module.exports = {
  TIPOS,
  TIPOS_EVENTO,
  norm,
  sinResponder,
  limpiarTexto,
  validarPreguntas,
  sanitizarParaAlumno,
  autoCorregir,
  corregir,
};
