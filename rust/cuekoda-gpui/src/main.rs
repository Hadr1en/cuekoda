#![forbid(unsafe_code)]

use cuekoda_core::{Cancellation, Options, Stage, TrackPreview, analyze_preview, supported_file};
use gpui::{
    App, Application, Bounds, Context, Div, ExternalPaths, FocusHandle, MouseButton,
    PathPromptOptions, ScrollStrategy, UniformListScrollHandle, Window, WindowBounds,
    WindowOptions, canvas, div, fill, point, prelude::*, px, rgb, size, uniform_list,
};
use rodio::{Decoder, MixerDeviceSink, Player};
use std::{
    cell::Cell,
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::PathBuf,
    rc::Rc,
    sync::{Arc, Mutex},
    time::Duration,
};

struct Playback {
    player: Player,
    _device: MixerDeviceSink,
}

#[derive(Default)]
struct Library {
    sources: HashSet<PathBuf>,
    visible: Vec<PathBuf>,
    selected: Option<PathBuf>,
    previews: HashMap<PathBuf, Arc<TrackPreview>>,
    job: Option<Cancellation>,
    status: String,
    query: String,
    searching: bool,
    reverse: bool,
    light: bool,
    zoom: f64,
    offset: f64,
    focus: Option<FocusHandle>,
    scroll: UniformListScrollHandle,
    audio: Option<Playback>,
    cues: HashMap<PathBuf, [Option<f64>; 8]>,
    smoke: bool,
    smoke_result: Option<bool>,
}

impl Drop for Library {
    fn drop(&mut self) {
        if let Some(job) = &self.job {
            job.cancel();
        }
    }
}

fn title(path: &std::path::Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn scan(mut pending: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut tracks = Vec::new();
    while let Some(path) = pending.pop() {
        let Ok(path) = path.canonicalize() else {
            continue;
        };
        if path.is_dir() {
            if let Ok(entries) = fs::read_dir(path) {
                pending.extend(entries.flatten().filter_map(|entry| {
                    let kind = entry.file_type().ok()?;
                    (kind.is_dir() || kind.is_file()).then(|| entry.path())
                }));
            }
        } else if path.is_file() && supported_file(&path) {
            tracks.push(path);
        }
    }
    tracks
}

impl Library {
    fn add(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        cx.spawn(async move |entity, cx| {
            let tracks = cx
                .background_executor()
                .spawn(async move { scan(paths) })
                .await;
            let _ = entity.update(cx, |library, cx| {
                library.sources.extend(tracks);
                library.filter();
                if library.selected.is_none() {
                    library.selected = library.visible.first().cloned();
                }
                if library.smoke {
                    if library.selected.is_some() {
                        library.analyze(cx);
                    } else {
                        library.smoke_result = Some(false);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn pick(&mut self, directories: bool, cx: &mut Context<Self>) {
        let selection = cx.prompt_for_paths(PathPromptOptions {
            files: !directories,
            directories,
            multiple: true,
            prompt: Some("Importer".into()),
        });
        cx.spawn(async move |entity, cx| match selection.await {
            Ok(Ok(Some(paths))) => {
                let _ = entity.update(cx, |library, cx| library.add(paths, cx));
            }
            Ok(Err(error)) => {
                let _ = entity.update(cx, |library, cx| {
                    library.status = error.to_string();
                    cx.notify();
                });
            }
            _ => {}
        })
        .detach();
    }

    fn filter(&mut self) {
        let query = self.query.to_lowercase();
        self.visible = self
            .sources
            .iter()
            .filter(|path| title(path).to_lowercase().contains(&query))
            .cloned()
            .collect();
        self.visible
            .sort_by_cached_key(|path| (title(path).to_lowercase(), path.clone()));
        if self.reverse {
            self.visible.reverse();
        }
    }

    fn select(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        if self.selected.as_ref() != Some(&path) {
            self.audio = None;
            self.selected = Some(path);
            self.zoom = 1.0;
            self.offset = 0.0;
            cx.notify();
        }
    }

    fn analyze(&mut self, cx: &mut Context<Self>) {
        if self.job.is_some() {
            return;
        }
        let Some(path) = self.selected.clone() else {
            return;
        };
        let job = Cancellation::default();
        self.job = Some(job.clone());
        self.status = "Décodage…".into();
        let stage = Arc::new(Mutex::new(Stage::Decoding));
        let background_stage = stage.clone();
        let source = path.clone();
        let task = cx.background_executor().spawn(async move {
            let options = Options {
                ffmpeg: std::env::var_os("CUEKODA_EXPERIMENT_FFMPEG")
                    .unwrap_or_else(|| "ffmpeg".into())
                    .into(),
                ..Options::default()
            };
            analyze_preview(&source, &options, &job, |stage| {
                *background_stage.lock().expect("stage lock poisoned") = stage;
            })
        });
        cx.spawn(async move |entity, cx| {
            let outcome = task.await;
            let _ = entity.update(cx, |library, cx| {
                library.job = None;
                if library.smoke {
                    library.smoke_result = Some(
                        outcome
                            .as_ref()
                            .is_ok_and(|preview| !preview.waveform.peak.is_empty()),
                    );
                }
                library.status = match outcome {
                    Ok(preview) => {
                        if library.previews.len() >= 12
                            && !library.previews.contains_key(&path)
                            && let Some(old) = library.previews.keys().next().cloned()
                        {
                            library.previews.remove(&old);
                        }
                        library.previews.insert(path, Arc::new(preview));
                        "Forme d’onde prête".into()
                    }
                    Err(error) => error.to_string(),
                };
                cx.notify();
            });
        })
        .detach();
        cx.spawn(async move |entity, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(100))
                    .await;
                let current = *stage.lock().expect("stage lock poisoned");
                let running = entity.update(cx, |library, cx| {
                    if library.job.is_some()
                        && matches!(current, Stage::Waveform)
                        && library.status != "Calcul de la forme d’onde…"
                    {
                        library.status = "Calcul de la forme d’onde…".into();
                        cx.notify();
                    }
                    library.job.is_some() && !matches!(current, Stage::Complete)
                });
                if !running.unwrap_or(false) {
                    break;
                }
            }
        })
        .detach();
        cx.notify();
    }

    fn playback(&mut self, cx: &mut Context<Self>) {
        if let Some(audio) = &self.audio
            && !audio.player.empty()
        {
            if audio.player.is_paused() {
                audio.player.play();
                self.refresh_playhead(cx);
            } else {
                audio.player.pause();
            }
        } else if let Some(path) = self.selected.clone() {
            match Self::open_audio(path, 1.0) {
                Ok(audio) => {
                    self.audio = Some(audio);
                    self.refresh_playhead(cx);
                }
                Err(error) => self.status = error.to_string(),
            }
        }
        cx.notify();
    }

    fn open_audio(path: PathBuf, volume: f32) -> Result<Playback, Box<dyn std::error::Error>> {
        let source = Decoder::try_from(File::open(path)?)?;
        let device = rodio::DeviceSinkBuilder::open_default_sink()?;
        let player = Player::connect_new(device.mixer());
        player.set_volume(volume);
        player.append(source);
        Ok(Playback {
            player,
            _device: device,
        })
    }

    fn playing(&self) -> bool {
        self.audio
            .as_ref()
            .is_some_and(|audio| !audio.player.is_paused() && !audio.player.empty())
    }

    fn cue(&mut self, slot: usize, set: bool, cx: &mut Context<Self>) {
        let (Some(track), Some(audio)) = (self.selected.as_ref(), &self.audio) else {
            return;
        };
        let cues = self.cues.entry(track.clone()).or_default();
        if let Some(time) = cues[slot].filter(|_| !set) {
            if let Err(error) = audio.player.try_seek(Duration::from_secs_f64(time)) {
                self.status = error.to_string();
            }
        } else {
            cues[slot] = Some(audio.player.get_pos().as_secs_f64());
        }
        cx.notify();
    }

    fn refresh_playhead(&self, cx: &mut Context<Self>) {
        cx.spawn(async move |entity, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(33))
                    .await;
                let active = entity.update(cx, |library, cx| {
                    cx.notify();
                    library.playing()
                });
                if !active.unwrap_or(false) {
                    break;
                }
            }
        })
        .detach();
    }

    fn wave(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let preview = self
            .selected
            .as_ref()
            .and_then(|path| self.previews.get(path))
            .cloned();
        let play = self
            .audio
            .as_ref()
            .map_or(0.0, |audio| audio.player.get_pos().as_secs_f64());
        let zoom = self.zoom.max(1.0);
        let offset = self.offset;
        let cues = self
            .selected
            .as_ref()
            .and_then(|track| self.cues.get(track))
            .copied()
            .unwrap_or_default();
        let hit_bounds = Rc::new(Cell::new(None));
        let prepaint_bounds = hit_bounds.clone();
        div()
            .relative()
            .h(px(250.0))
            .w_full()
            .child(
                canvas(
                    move |bounds, _, _| prepaint_bounds.set(Some(bounds)),
                    move |bounds, (), window, _| {
                        let width: f32 = bounds.size.width.into();
                        if let Some(preview) = preview.as_ref() {
                            let span = preview.duration_sec / zoom;
                            let start = (preview.duration_sec - span) * offset;
                            let bands = [
                                (&preview.waveform.peak, 0x666b8a),
                                (&preview.waveform.low, 0x795eff),
                                (&preview.waveform.mid, 0x34c7b6),
                                (&preview.waveform.high, 0xe4b768),
                            ];
                            let columns = (width as usize).clamp(1, 1200);
                            for (band, color) in bands {
                                for column in 0..columns {
                                    let begin = ((start + span * column as f64 / columns as f64)
                                        * f64::from(preview.waveform.per_sec))
                                        as usize;
                                    let end = ((start
                                        + span * (column + 1) as f64 / columns as f64)
                                        * f64::from(preview.waveform.per_sec))
                                    .ceil() as usize;
                                    let amplitude = band[begin.min(band.len())..end.min(band.len())]
                                        .iter()
                                        .copied()
                                        .fold(0.0_f64, f64::max)
                                        as f32;
                                    let height = bounds.size.height * amplitude;
                                    let step = width / columns as f32;
                                    let origin = bounds.origin
                                        + point(
                                            px(step * column as f32),
                                            (bounds.size.height - height) * 0.5,
                                        );
                                    window.paint_quad(fill(
                                        Bounds {
                                            origin,
                                            size: size(px(step), height),
                                        },
                                        rgb(color),
                                    ));
                                }
                            }
                            for cue in cues.into_iter().flatten() {
                                let position = ((cue - start) / span) as f32;
                                if (0.0..=1.0).contains(&position) {
                                    let origin =
                                        bounds.origin + point(px(width * position), px(0.0));
                                    window.paint_quad(fill(
                                        Bounds {
                                            origin,
                                            size: size(px(2.0), bounds.size.height),
                                        },
                                        rgb(0x7ee89b),
                                    ));
                                }
                            }
                            let position = ((play - start) / span) as f32;
                            if (0.0..=1.0).contains(&position) {
                                let origin = bounds.origin + point(px(width * position), px(0.0));
                                window.paint_quad(fill(
                                    Bounds {
                                        origin,
                                        size: size(px(2.0), bounds.size.height),
                                    },
                                    rgb(0xfa6175),
                                ));
                            }
                        }
                    },
                )
                .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &gpui::MouseDownEvent, _, cx| {
                    if let Some(audio) = &this.audio
                        && let Some(preview) = this
                            .selected
                            .as_ref()
                            .and_then(|path| this.previews.get(path))
                        && let Some(bounds) = hit_bounds.get()
                    {
                        let width: f32 = bounds.size.width.into();
                        let x: f32 = (event.position.x - bounds.origin.x).into();
                        let position = (x / width.max(1.0)).clamp(0.0, 1.0);
                        let span = preview.duration_sec / this.zoom.max(1.0);
                        let target = (preview.duration_sec - span) * this.offset
                            + span * f64::from(position);
                        if let Err(error) = audio.player.try_seek(Duration::from_secs_f64(target)) {
                            this.status = error.to_string();
                        }
                        cx.notify();
                    }
                }),
            )
    }
}

fn button(id: &'static str, text: impl Into<gpui::SharedString>) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .px_3()
        .py_1()
        .rounded_md()
        .border_1()
        .border_color(rgb(0x77709a))
        .cursor_pointer()
        .child(text.into())
}

impl Render for Library {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(ok) = self.smoke_result.take() {
            let status = self.status.clone();
            window.on_next_frame(move |_, cx| {
                if ok {
                    println!("CueKoda GPUI smoke: {status}");
                    cx.quit();
                } else {
                    eprintln!("CueKoda GPUI smoke failed: {status}");
                    std::process::exit(1);
                }
            });
        }
        let focus = self
            .focus
            .get_or_insert_with(|| {
                let focus = cx.focus_handle();
                focus.focus(window);
                focus
            })
            .clone();
        let (bg, panel, text) = if self.light {
            (0xf3f4f8, 0xffffff, 0x1b1e2a)
        } else {
            (0x101116, 0x1c1e29, 0xe8eaf0)
        };
        let preview = self
            .selected
            .as_ref()
            .and_then(|path| self.previews.get(path));
        let detail = preview
            .map(|preview| preview.metadata.title.clone())
            .or_else(|| self.selected.as_deref().map(title))
            .unwrap_or_else(|| "Bibliothèque musicale".into());
        let tags = preview
            .map(|preview| {
                [
                    &preview.metadata.artist,
                    &preview.metadata.album,
                    &preview.metadata.genre,
                ]
                .into_iter()
                .filter_map(|value| value.as_deref())
                .collect::<Vec<_>>()
                .join(" · ")
            })
            .unwrap_or_default();
        div()
            .track_focus(&focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(bg))
            .text_color(rgb(text))
            .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| {
                this.add(paths.paths().to_vec(), cx)
            }))
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                let key = &event.keystroke.key;
                match key.as_str() {
                    "escape" if this.searching => this.searching = false,
                    "backspace" if this.searching => {
                        this.query.pop();
                        this.filter();
                    }
                    "enter" if this.searching => this.searching = false,
                    "space" if !this.searching => this.playback(cx),
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" if !this.searching => {
                        let slot = usize::from(key.as_bytes()[0] - b'1');
                        this.cue(slot, event.keystroke.modifiers.shift, cx);
                    }
                    "up" | "down" if !this.visible.is_empty() => {
                        let index = this
                            .selected
                            .as_ref()
                            .and_then(|p| this.visible.iter().position(|candidate| candidate == p))
                            .unwrap_or(0);
                        let next = if key == "up" {
                            index.saturating_sub(1)
                        } else {
                            (index + 1).min(this.visible.len() - 1)
                        };
                        this.select(this.visible[next].clone(), cx);
                        this.scroll.scroll_to_item(next, ScrollStrategy::Center);
                    }
                    _ if this.searching => {
                        if let Some(input) = &event.keystroke.key_char {
                            this.query.push_str(input);
                            this.filter();
                        }
                    }
                    _ => return,
                }
                cx.notify();
            }))
            .child(
                div()
                    .p_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .bg(rgb(panel))
                    .child(div().text_xl().child("CueKoda"))
                    .child(
                        button("files", "Ajouter des fichiers")
                            .on_click(cx.listener(|this, _, _, cx| this.pick(false, cx))),
                    )
                    .child(
                        button("folders", "Ajouter un dossier")
                            .on_click(cx.listener(|this, _, _, cx| this.pick(true, cx))),
                    )
                    .child(
                        button(
                            "search",
                            format!(
                                "Filtrer{} · {}",
                                if self.searching { "…" } else { "" },
                                self.query
                            ),
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.searching = true;
                            cx.notify();
                        })),
                    )
                    .child(
                        button(
                            "sort",
                            if self.reverse {
                                "Titre ↓"
                            } else {
                                "Titre ↑"
                            },
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.reverse = !this.reverse;
                            this.filter();
                            cx.notify();
                        })),
                    )
                    .child(
                        button(
                            "theme",
                            if self.light {
                                "Thème sombre"
                            } else {
                                "Thème clair"
                            },
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.light = !this.light;
                            cx.notify();
                        })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div().w(px(320.0)).h_full().bg(rgb(panel)).child(
                            uniform_list(
                                "tracks",
                                self.visible.len(),
                                cx.processor(|this, range: std::ops::Range<usize>, _, cx| {
                                    range
                                        .map(|index| {
                                            let path = this.visible[index].clone();
                                            let selected = this.selected.as_ref() == Some(&path);
                                            div()
                                                .id(index)
                                                .h(px(34.0))
                                                .px_3()
                                                .flex()
                                                .items_center()
                                                .cursor_pointer()
                                                .when(selected, |row| {
                                                    row.bg(rgb(0x493e79)).text_color(rgb(0xffffff))
                                                })
                                                .child(title(&path))
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.select(path.clone(), cx)
                                                }))
                                        })
                                        .collect()
                                }),
                            )
                            .track_scroll(self.scroll.clone())
                            .h_full(),
                        ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .p(px(22.0))
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(div().text_xl().child(detail))
                            .child(tags)
                            .child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .child(
                                        button("analyze", "Analyser la forme d’onde").on_click(
                                            cx.listener(|this, _, _, cx| this.analyze(cx)),
                                        ),
                                    )
                                    .when(self.job.is_some(), |row| {
                                        row.child(button("cancel", "Annuler").on_click(
                                            cx.listener(|this, _, _, _| {
                                                if let Some(job) = &this.job {
                                                    job.cancel();
                                                }
                                            }),
                                        ))
                                    })
                                    .child(
                                        button(
                                            "play",
                                            if self.playing() { "Pause" } else { "Lire" },
                                        )
                                        .on_click(cx.listener(|this, _, _, cx| this.playback(cx))),
                                    ),
                            )
                            .child(div().bg(rgb(panel)).child(self.wave(cx)))
                            .child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .child(button("zoom-in", "Zoom +").on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.zoom = (this.zoom * 2.0).clamp(1.0, 16.0);
                                            cx.notify();
                                        },
                                    )))
                                    .child(button("zoom-out", "Zoom −").on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.zoom = (this.zoom / 2.0).max(1.0);
                                            cx.notify();
                                        },
                                    )))
                                    .child(button("prev", "←").on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.offset = (this.offset - 0.1).max(0.0);
                                            cx.notify();
                                        },
                                    )))
                                    .child(button("next", "→").on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.offset = (this.offset + 0.1).min(1.0);
                                            cx.notify();
                                        },
                                    ))),
                            )
                            .child("Pads 1–8 · Maj pour déplacer")
                            .child(self.status.clone()),
                    ),
            )
    }
}

fn main() {
    let mut arguments = std::env::args_os().skip(1).peekable();
    let smoke = arguments
        .peek()
        .is_some_and(|argument| argument == "--analysis-smoke");
    if smoke {
        arguments.next();
    }
    let files = arguments.map(PathBuf::from).collect();
    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1280.0), px(800.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                window.set_window_title("CueKoda · GPUI");
                cx.new(|cx| {
                    let mut library = Library::default();
                    library.zoom = 1.0;
                    library.smoke = smoke;
                    library.add(files, cx);
                    library
                })
            },
        )
        .expect("open CueKoda GPUI window");
        cx.activate(true);
    });
}

#[cfg(test)]
mod playback_tests {
    use super::*;

    #[test]
    #[ignore = "requires an audio output device and a local synthetic WAV fixture"]
    fn native_output_advances_and_seeks() {
        let path = std::env::var_os("CUEKODA_TEST_AUDIO")
            .expect("set CUEKODA_TEST_AUDIO to a WAV fixture");
        let audio = Library::open_audio(path.into(), 0.0).expect("open muted output");
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while audio.player.get_pos().is_zero() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(audio.player.get_pos() > Duration::ZERO);
        audio
            .player
            .try_seek(Duration::from_secs(2))
            .expect("seek inside WAV fixture");
        assert!(audio.player.get_pos() >= Duration::from_secs(2));
        audio.player.pause();
        assert!(audio.player.is_paused());
    }
}
