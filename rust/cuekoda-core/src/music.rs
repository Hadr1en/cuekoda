//! Compatibility path for the musical algorithms and DJ format adapters.
use crate::{Cancellation, Error};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_MESSAGE: u64 = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct Backend {
    pub node: PathBuf,
    pub worker: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("musical analysis requires CUEKODA_EXPERIMENT_WORKER pointing to the built worker")]
    MissingWorker,
    #[error("invalid response from musical analysis worker")]
    InvalidResponse,
    #[error("musical analysis worker exited with {0}")]
    WorkerExit(std::process::ExitStatus),
    #[error("{0}")]
    Analysis(String),
    #[error(transparent)]
    Control(#[from] Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Serialize)]
#[serde(tag = "operation", rename_all = "lowercase")]
enum Request<'a> {
    Analyze {
        source: &'a Path,
        #[serde(skip_serializing_if = "Option::is_none")]
        previous: Option<&'a Value>,
    },
    #[serde(rename_all = "camelCase")]
    Cue {
        track: &'a Value,
        slot: u8,
        time_sec: f64,
    },
    Export {
        format: &'a str,
        track: &'a Value,
    },
    Import {
        format: &'a str,
        collection: &'a str,
        track: &'a Value,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response<T> {
    schema_version: u32,
    result: Option<T>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub slot: i32,
    pub name: String,
    pub time_sec: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub label: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatGrid {
    pub first_downbeat_sec: f64,
    pub bpm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Key {
    pub camelot: String,
    pub musical: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Summary {
    pub bpm: f64,
    pub key: Key,
    pub grid: BeatGrid,
    pub cues: Vec<Cue>,
    pub sections: Vec<Section>,
}

impl Backend {
    pub fn from_environment() -> Result<Self, BackendError> {
        let worker = std::env::var_os("CUEKODA_EXPERIMENT_WORKER")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.is_file())
            .ok_or(BackendError::MissingWorker)?;
        let node = std::env::var_os("CUEKODA_EXPERIMENT_NODE")
            .unwrap_or_else(|| "node".into())
            .into();
        Ok(Self { node, worker })
    }

    pub fn analyze(&self, source: &Path, cancel: &Cancellation) -> Result<Value, BackendError> {
        self.analyze_with_previous(source, None, cancel)
    }

    pub fn analyze_with_previous(
        &self,
        source: &Path,
        previous: Option<&Value>,
        cancel: &Cancellation,
    ) -> Result<Value, BackendError> {
        self.run(Request::Analyze { source, previous }, cancel)
    }

    pub fn set_cue(
        &self,
        track: &Value,
        slot: u8,
        time_sec: f64,
        cancel: &Cancellation,
    ) -> Result<Value, BackendError> {
        self.run(
            Request::Cue {
                track,
                slot,
                time_sec,
            },
            cancel,
        )
    }

    pub fn export(
        &self,
        format: &str,
        track: &Value,
        cancel: &Cancellation,
    ) -> Result<String, BackendError> {
        self.run(Request::Export { format, track }, cancel)
    }

    pub fn import(
        &self,
        format: &str,
        path: &Path,
        track: &Value,
        cancel: &Cancellation,
    ) -> Result<Value, BackendError> {
        let mut collection = String::new();
        File::open(path)?
            .take(MAX_MESSAGE + 1)
            .read_to_string(&mut collection)?;
        if collection.len() as u64 > MAX_MESSAGE {
            return Err(BackendError::InvalidResponse);
        }
        self.run(
            Request::Import {
                format,
                collection: &collection,
                track,
            },
            cancel,
        )
    }

    fn run<T: DeserializeOwned>(
        &self,
        request: Request<'_>,
        cancel: &Cancellation,
    ) -> Result<T, BackendError> {
        cancel.check()?;
        let directory = tempfile::tempdir()?;
        let data = serde_json::to_vec(&request)?;
        if data.len() as u64 > MAX_MESSAGE {
            return Err(BackendError::InvalidResponse);
        }
        fs::write(directory.path().join("request.json"), data)?;
        let mut command = Command::new(&self.node);
        command
            .arg(&self.worker)
            .arg(directory.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let started = Instant::now();
        let status = loop {
            let control = cancel.check().and_then(|()| {
                if started.elapsed() >= Duration::from_secs(120) {
                    Err(Error::Timeout)
                } else {
                    Ok(())
                }
            });
            if let Err(error) = control {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(15)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.into());
                }
            }
        };
        if !status.success() {
            return Err(BackendError::WorkerExit(status));
        }
        let mut data = Vec::new();
        File::open(directory.path().join("response.json"))?
            .take(MAX_MESSAGE + 1)
            .read_to_end(&mut data)?;
        if data.len() as u64 > MAX_MESSAGE {
            return Err(BackendError::InvalidResponse);
        }
        let response: Response<T> = serde_json::from_slice(&data)?;
        if response.schema_version != 1 {
            return Err(BackendError::InvalidResponse);
        }
        match (response.result, response.error) {
            (Some(result), None) => Ok(result),
            (None, Some(error)) => Err(BackendError::Analysis(error)),
            _ => Err(BackendError::InvalidResponse),
        }
    }
}

/// A compact projection for the UI, with full analysis fields retained for round trips.
#[derive(Clone)]
pub struct Track {
    pub value: Value,
    pub summary: Summary,
}

impl TryFrom<Value> for Track {
    type Error = BackendError;
    fn try_from(value: Value) -> Result<Self, Self::Error> {
        let summary = Summary::deserialize(&value)?;
        Ok(Self { value, summary })
    }
}

pub fn read_track(path: &Path) -> Result<Option<Track>, BackendError> {
    let mut data = Vec::new();
    match File::open(path) {
        Ok(file) => file.take(MAX_MESSAGE + 1).read_to_end(&mut data)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if data.len() as u64 > MAX_MESSAGE {
        return Err(BackendError::InvalidResponse);
    }
    Ok(Some(Track::try_from(serde_json::from_slice::<Value>(
        &data,
    )?)?))
}

pub fn write_track(path: &Path, track: &Track) -> Result<(), BackendError> {
    let directory = path.parent().ok_or(BackendError::InvalidResponse)?;
    fs::create_dir_all(directory)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer(&mut temporary, &track.value)?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

// Encode the same path to the same cache entry after restart. Confirm the path in the file before loading.
pub fn track_path(root: &Path, source: &Path) -> PathBuf {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hash = DefaultHasher::new();
    source.hash(&mut hash);
    root.join(format!("{:016x}.json", hash.finish()))
}

pub fn saved_track(root: &Path, source: &Path) -> Result<Option<Track>, BackendError> {
    Ok(read_track(&track_path(root, source))?.filter(|track| {
        track
            .value
            .get("path")
            .and_then(Value::as_str)
            .and_then(|path| Path::new(path).canonicalize().ok())
            .as_deref()
            == Some(source)
    }))
}

pub fn storage_root(app: &str) -> std::io::Result<PathBuf> {
    let base = if let Some(path) = std::env::var_os("CUEKODA_EXPERIMENT_DATA") {
        Some(PathBuf::from(path))
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
    };
    base.map(|path| path.join(app).join("musical-analysis"))
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "No experiment data directory")
        })
}
