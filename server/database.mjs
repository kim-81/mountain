import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const deriveKey = promisify(scrypt);

export function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, nickname TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS responses(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, PRIMARY KEY(plan_id,user_id));
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), mountain_id TEXT NOT NULL, content TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reviews_mountain_idx ON reviews(mountain_id);
    CREATE INDEX IF NOT EXISTS reviews_owner_idx ON reviews(owner_id);
  `);
  return db;
}

export async function passwordHash(password, salt) {
  return Buffer.from(await deriveKey(password, salt, 64)).toString('hex');
}
export async function passwordMatches(password, user) {
  const candidate = Buffer.from(await passwordHash(password, user.salt), 'hex');
  return timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex'));
}
export function newId() { return randomBytes(16).toString('hex'); }
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
