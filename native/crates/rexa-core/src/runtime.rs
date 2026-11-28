//! A shared Tokio runtime for database I/O. GPUI runs its own executors, so
//! driver futures are spawned here and their `JoinHandle`s awaited from GPUI tasks.

use std::future::Future;
use std::sync::OnceLock;
use tokio::runtime::Runtime;
use tokio::task::JoinHandle;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub fn init() {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("rexa-io")
            .enable_all()
            .build()
            .expect("failed to start the I/O runtime")
    });
}

/// Run `fut` on the I/O runtime; the result surfaces errors from a panicked task as `Err`.
pub fn spawn<T: Send + 'static>(
    fut: impl Future<Output = anyhow::Result<T>> + Send + 'static,
) -> impl Future<Output = anyhow::Result<T>> {
    let handle: JoinHandle<anyhow::Result<T>> = RUNTIME.get().expect("runtime::init not called").spawn(fut);
    async move { handle.await.map_err(anyhow::Error::from)? }
}
