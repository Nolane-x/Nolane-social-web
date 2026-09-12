import { DatabaseSync } from 'node:sqlite'

class StatementAdapter {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.args = []
  }
  bind(...args) {
    const copy = new StatementAdapter(this.db, this.sql)
    copy.args = args
    return copy
  }
  async first() {
    const statement = this.db.prepare(this.sql)
    return statement.get(...this.args) ?? null
  }
  async all() {
    const statement = this.db.prepare(this.sql)
    return { results: statement.all(...this.args) }
  }
  async run() {
    const statement = this.db.prepare(this.sql)
    const result = statement.run(...this.args)
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }
  }
}

export class D1Sqlite {
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON;')
  }
  exec(sql) {
    this.raw.exec(sql)
  }
  prepare(sql) {
    return new StatementAdapter(this.raw, sql)
  }
  async batch(statements) {
    this.raw.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.raw.exec('COMMIT')
      return results
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }
  close() {
    this.raw.close()
  }
}
