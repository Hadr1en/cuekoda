#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cuekoda_core::{Cancellation, Options, Stage, TrackPreview, analyze_preview, supported_file};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, async_runtime};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Library {
    paths: HashSet<PathBuf>,
    current: Option<Cancellation>,
}

#[derive(Clone, Serialize)]
struct Track {
    path: PathBuf,
    title: String,
}

fn collect(inputs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut pending = inputs;
    let mut tracks = Vec::new();
    while let Some(path) = pending.pop() {
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if canonical.is_dir() {
            if let Ok(entries) = fs::read_dir(&canonical) {
                pending.extend(entries.flatten().filter_map(|entry| {
                    let kind = entry.file_type().ok()?;
                    (!kind.is_symlink() && (kind.is_file() || kind.is_dir())).then(|| entry.path())
                }));
            }
        } else if canonical.is_file() && supported_file(&canonical) {
            tracks.push(canonical);
        }
    }
    tracks.sort();
    tracks.dedup();
    tracks
}

#[tauri::command]
async fn import_tracks(app: AppHandle, folder: bool) -> Result<Vec<Track>, String> {
    async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let selection = if folder {
            dialog.blocking_pick_folder().into_iter().collect()
        } else {
            dialog.blocking_pick_files().unwrap_or_default()
        };
        let paths = collect(
            selection
                .into_iter()
                .filter_map(|file| file.into_path().ok())
                .collect(),
        );
        approve_tracks(&app, paths)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn approve_tracks(app: &AppHandle, paths: Vec<PathBuf>) -> Result<Vec<Track>, String> {
    let state = app.state::<Mutex<Library>>();
    let mut library = state.lock().map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for path in paths {
        if library.paths.contains(&path) {
            continue;
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|error| error.to_string())?;
        library.paths.insert(path.clone());
        imported.push(Track::from(path));
    }
    Ok(imported)
}

#[tauri::command]
fn initial_tracks(library: State<Mutex<Library>>) -> Result<Vec<Track>, String> {
    let library = library.lock().map_err(|error| error.to_string())?;
    Ok(library.paths.iter().cloned().map(Track::from).collect())
}

impl From<PathBuf> for Track {
    fn from(path: PathBuf) -> Self {
        let title = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Self { path, title }
    }
}

#[tauri::command]
async fn analyze(app: AppHandle, path: PathBuf) -> Result<TrackPreview, String> {
    let state = app.state::<Mutex<Library>>();
    let cancellation = {
        let mut library = state.lock().map_err(|error| error.to_string())?;
        if !library.paths.contains(&path) || path.canonicalize().ok().as_ref() != Some(&path) {
            return Err("Track has not been approved".into());
        }
        if library.current.is_some() {
            return Err("Another analysis is running".into());
        }
        let cancellation = Cancellation::default();
        library.current = Some(cancellation.clone());
        cancellation
    };
    let handle = app.clone();
    let result = async_runtime::spawn_blocking(move || {
        let options = Options {
            ffmpeg: std::env::var_os("CUEKODA_EXPERIMENT_FFMPEG")
                .unwrap_or_else(|| "ffmpeg".into())
                .into(),
            ..Options::default()
        };
        analyze_preview(Path::new(&path), &options, &cancellation, |stage| {
            let stage = match stage {
                Stage::Decoding => "decoding",
                Stage::Waveform => "waveform",
                Stage::Complete => "complete",
            };
            let _ = handle.emit("analysis-stage", stage);
        })
    })
    .await;
    app.state::<Mutex<Library>>()
        .lock()
        .map_err(|error| error.to_string())?
        .current = None;
    result
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel(library: State<Mutex<Library>>) {
    if let Ok(library) = library.lock()
        && let Some(job) = &library.current
    {
        job.cancel();
    }
}

#[tauri::command]
fn library_benchmark_enabled() -> bool {
    cfg!(debug_assertions)
        && std::env::args_os()
            .nth(1)
            .is_some_and(|value| value == "--library-benchmark")
}

#[tauri::command]
fn finish_library_benchmark(app: AppHandle, result: String) -> Result<(), String> {
    if !library_benchmark_enabled() || result.len() > 64 * 1024 {
        return Err("Library benchmark is unavailable".into());
    }
    println!("{result}");
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(Library::default()))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = collect(std::env::args_os().skip(1).map(PathBuf::from).collect());
            approve_tracks(app.handle(), paths).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_tracks,
            library_benchmark_enabled,
            finish_library_benchmark,
            import_tracks,
            analyze,
            cancel
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let paths = paths.clone();
                let app = window.app_handle().clone();
                async_runtime::spawn_blocking(move || match approve_tracks(&app, collect(paths)) {
                    Ok(tracks) => {
                        let _ = app.emit("tracks-imported", tracks);
                    }
                    Err(error) => {
                        let _ = app.emit("import-error", error);
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("CueKoda Tauri failed");
}
