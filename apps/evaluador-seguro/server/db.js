'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'evaluador.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS exams (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    time_limit  INTEGER NOT NULL DEFAULT 600,
    questions   TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    exam_id     TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    questions   TEXT NOT NULL,
    time_limit  INTEGER NOT NULL,
    status      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    ends_at     INTEGER,
    ended_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS students (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    token        TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    course       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL,
    joined_at    INTEGER NOT NULL,
    submitted_at INTEGER,
    submit_reason TEXT,
    answers      TEXT NOT NULL DEFAULT '{}',
    overrides    TEXT NOT NULL DEFAULT '{}',
    last_seen    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    run_id     TEXT NOT NULL,
    at         INTEGER NOT NULL,
    dur        INTEGER NOT NULL DEFAULT 0,
    type       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_exam      ON runs(exam_id);
  CREATE INDEX IF NOT EXISTS idx_runs_code      ON runs(code);
  CREATE INDEX IF NOT EXISTS idx_students_run   ON students(run_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_stu  ON incidents(student_id);
`);

module.exports = { db, DB_PATH };
