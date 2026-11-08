//! Synchronous facade for the SQLite worker, called only on blocking threads.
use sqlx::{sqlite::SqliteConnectOptions, Column, Connection, Row, SqliteConnection};
use std::{path::Path, sync::OnceLock, time::Duration};
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("SQLite runtime")
    })
}
pub struct Database {
    connection: SqliteConnection,
}
impl Database {
    pub fn open(path: &Path, readonly: bool, immutable: bool) -> Result<Self, String> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(!readonly)
            .read_only(readonly)
            .immutable(immutable)
            .busy_timeout(Duration::from_secs(3));
        runtime()
            .block_on(SqliteConnection::connect_with(&options))
            .map(|connection| Self { connection })
            .map_err(|e| e.to_string())
    }
    pub fn batch(&mut self, sql: &str) -> Result<(), String> {
        runtime()
            .block_on(sqlx::raw_sql(sql).execute(&mut self.connection))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    pub fn execute(&mut self, sql: &str, args: &[&str]) -> Result<(), String> {
        let mut q = sqlx::query(sql);
        for arg in args {
            q = q.bind(*arg);
        }
        runtime()
            .block_on(q.execute(&mut self.connection))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    pub fn rows(&mut self, sql: &str, args: &[&str]) -> Result<Vec<Vec<String>>, String> {
        let mut q = sqlx::query(sql);
        for arg in args {
            q = q.bind(*arg);
        }
        runtime()
            .block_on(q.fetch_all(&mut self.connection))
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|row| {
                row.columns()
                    .iter()
                    .map(|c| {
                        row.try_get::<String, _>(c.ordinal())
                            .or_else(|_| row.try_get::<i64, _>(c.ordinal()).map(|v| v.to_string()))
                            .map_err(|e| e.to_string())
                    })
                    .collect()
            })
            .collect()
    }
    pub fn transaction<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        self.batch("BEGIN IMMEDIATE")?;
        match f(self) {
            Ok(value) => {
                if let Err(e) = self.batch("COMMIT") {
                    let _ = self.batch("ROLLBACK");
                    return Err(e);
                }
                Ok(value)
            }
            Err(e) => {
                let _ = self.batch("ROLLBACK");
                Err(e)
            }
        }
    }
}
