use lofty::{config::ParseOptions, prelude::*, probe::Probe};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
}

pub fn read(path: &Path) -> Metadata {
    let mut metadata = Metadata {
        title: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        ..Metadata::default()
    };
    let options = ParseOptions::new()
        .read_properties(false)
        .read_cover_art(false);
    if let Ok(tagged) = Probe::open(path).and_then(|probe| probe.options(options).read())
        && let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag())
    {
        if let Some(title) = tag.title().filter(|title| !title.trim().is_empty()) {
            metadata.title = title.into_owned();
        }
        metadata.artist = tag.artist().map(|value| value.into_owned());
        metadata.album = tag.album().map(|value| value.into_owned());
        metadata.genre = tag.genre().map(|value| value.into_owned());
    }
    metadata
}
