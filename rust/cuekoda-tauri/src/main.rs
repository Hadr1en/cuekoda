#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cuekoda_core::music::{self, Backend, Summary};
use cuekoda_core::{Cancellation, Options, Stage, TrackPreview, analyze_preview, supported_file};
use serde::{Deserialize, Serialize};
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

#[tauri::command]
async fn import_playlist(app: AppHandle) -> Result<Vec<Track>, String> {
    async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("M3U8", &["m3u8"])
            .blocking_pick_file()
            .and_then(|value| value.into_path().ok())
        else {
            return Ok(Vec::new());
        };
        let sources = music::read_playlist(&file).map_err(|error| error.to_string())?;
        approve_tracks(&app, sources)
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

const PROJECT_NAME: &str = "CueKoda Tauri Experiment";

#[derive(Serialize)]
struct Preview {
    #[serde(flatten)]
    waveform: TrackPreview,
    music: Option<Summary>,
}

#[tauri::command]
fn music_enabled() -> bool {
    Backend::from_environment().is_ok()
}

fn approved(library: &Library, path: &Path) -> Result<(), String> {
    if !library.paths.contains(path) || path.canonicalize().ok().as_deref() != Some(path) {
        return Err("Track has not been approved".into());
    }
    Ok(())
}

#[tauri::command]
fn saved_music(library: State<Mutex<Library>>, path: PathBuf) -> Result<Option<Summary>, String> {
    {
        let library = library.lock().map_err(|error| error.to_string())?;
        approved(&library, &path)?;
    }
    let root = music::storage_root(PROJECT_NAME).map_err(|error| error.to_string())?;
    Ok(music::saved_track(&root, &path)
        .map_err(|error| error.to_string())?
        .map(|track| track.summary))
}

#[tauri::command]
async fn analyze(app: AppHandle, path: PathBuf) -> Result<Preview, String> {
    let state = app.state::<Mutex<Library>>();
    let cancellation = {
        let mut library = state.lock().map_err(|error| error.to_string())?;
        approved(&library, &path)?;
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
        let waveform = analyze_preview(&path, &options, &cancellation, |stage| {
            let stage = match stage {
                Stage::Decoding => "decoding",
                Stage::Waveform => "waveform",
                Stage::Complete => "complete",
            };
            let _ = handle.emit("analysis-stage", stage);
        })
        .map_err(|error| error.to_string())?;
        let music = if let Ok(backend) = Backend::from_environment() {
            let _ = handle.emit("analysis-stage", "music");
            let root = music::storage_root(PROJECT_NAME).map_err(|error| error.to_string())?;
            let previous = music::saved_track(&root, &path).map_err(|error| error.to_string())?;
            let analysis = backend
                .analyze_with_previous(
                    &path,
                    previous.as_ref().map(|track| &track.value),
                    &cancellation,
                )
                .and_then(music::Track::try_from)
                .map_err(|error| error.to_string())?;
            music::write_track(&music::track_path(&root, &path), &analysis)
                .map_err(|error| error.to_string())?;
            Some(analysis.summary)
        } else {
            None
        };
        Ok::<_, String>(Preview { waveform, music })
    })
    .await;
    app.state::<Mutex<Library>>()
        .lock()
        .map_err(|error| error.to_string())?
        .current = None;
    result.map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum MusicAction {
    Cue { slot: u8, time_sec: f64 },
    Import,
    Export { format: String },
}

#[tauri::command]
async fn edit_music(
    app: AppHandle,
    path: PathBuf,
    action: MusicAction,
) -> Result<Option<Summary>, String> {
    let cancellation = {
        let state = app.state::<Mutex<Library>>();
        let mut library = state.lock().map_err(|error| error.to_string())?;
        approved(&library, &path)?;
        if library.current.is_some() {
            return Err("Another analysis or edit is running".into());
        }
        let cancellation = Cancellation::default();
        library.current = Some(cancellation.clone());
        cancellation
    };
    let handle = app.clone();
    let outcome = async_runtime::spawn_blocking(move || -> Result<Option<Summary>, String> {
        let backend = Backend::from_environment().map_err(|error| error.to_string())?;
        let root = music::storage_root(PROJECT_NAME).map_err(|error| error.to_string())?;
        let track = music::saved_track(&root, &path)
            .map_err(|error| error.to_string())?
            .ok_or("Analyze the track first")?;
        let result = match action {
            MusicAction::Cue { slot, time_sec } => {
                backend.set_cue(&track.value, slot, time_sec, &cancellation)
            }
            MusicAction::Import => {
                let Some(file) = handle
                    .dialog()
                    .file()
                    .add_filter("DJ collection", &["xml", "nml"])
                    .blocking_pick_file()
                    .and_then(|path| path.into_path().ok())
                else {
                    return Ok(None);
                };
                let format = file
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !["xml", "nml"].contains(&format.as_str()) {
                    return Err("Unsupported collection format".into());
                }
                backend.import(&format, &file, &track.value, &cancellation)
            }
            MusicAction::Export { format } => {
                if !["xml", "nml", "m3u8"].contains(&format.as_str()) {
                    return Err("Unsupported export format".into());
                }
                let Some(file) = handle
                    .dialog()
                    .file()
                    .set_file_name(format!("CueKoda.{format}"))
                    .add_filter("DJ collection", &[&format])
                    .blocking_save_file()
                    .and_then(|path| path.into_path().ok())
                else {
                    return Ok(None);
                };
                // Never overwrite the audio or another existing file.
                let collection = backend
                    .export(&format, &track.value, &cancellation)
                    .map_err(|error| error.to_string())?;
                music::write_export(&file, &collection).map_err(|error| error.to_string())?;
                return Ok(Some(track.summary));
            }
        }
        .and_then(music::Track::try_from)
        .map_err(|error| error.to_string())?;
        music::write_track(&music::track_path(&root, &path), &result)
            .map_err(|error| error.to_string())?;
        Ok(Some(result.summary))
    })
    .await;
    app.state::<Mutex<Library>>()
        .lock()
        .map_err(|error| error.to_string())?
        .current = None;
    outcome.map_err(|error| error.to_string())?
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
fn prepare_benchmark_enabled() -> bool {
    cfg!(debug_assertions) && std::env::var_os("CUEKODA_PREPARE_BENCHMARK").is_some()
}

#[tauri::command]
fn finish_prepare_benchmark(app: AppHandle, summary: String) -> Result<(), String> {
    if !prepare_benchmark_enabled() || summary.len() > 1024 {
        return Err("Prepare benchmark is unavailable".into());
    }
    println!("CUEKODA_PREPARED {summary}");
    app.exit(0);
    Ok(())
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
            let mut paths = collect(std::env::args_os().skip(1).map(PathBuf::from).collect());
            if !prepare_benchmark_enabled()
                && !library_benchmark_enabled()
                && let Ok(root) = music::storage_root(PROJECT_NAME)
            {
                paths.extend(music::saved_sources(&root));
            }
            approve_tracks(app.handle(), paths).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_tracks,
            music_enabled,
            prepare_benchmark_enabled,
            finish_prepare_benchmark,
            saved_music,
            edit_music,
            library_benchmark_enabled,
            finish_library_benchmark,
            import_tracks,
            import_playlist,
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
