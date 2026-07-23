#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ebur128::{EbuR128, Mode};
use serde::Serialize;
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
    formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Analysis {
    integrated_lufs: f64,
    loudness_range: f64,
    true_peak_dbtp: f64,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u32,
}

fn db(value: f64) -> f64 {
    if value <= 0.0 {
        -120.0
    } else {
        20.0 * value.log10()
    }
}

/// Decode one local file and measure it with the ITU-R BS.1770 / EBU R128 algorithm.
fn measure_file(path: &Path) -> Result<Analysis, String> {
    let file = File::open(path).map_err(|e| format!("Unable to open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = Hint::new();
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Unsupported audio file: {e}"))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("No audio track was found")?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or("The audio file has no sample rate")?;
    let channels = track
        .codec_params
        .channels
        .ok_or("The audio file has no channel layout")?
        .count() as u32;
    if channels == 0 || channels > 8 {
        return Err("Only audio files with 1 to 8 channels are supported".into());
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;
    let mut meter = EbuR128::new(
        channels,
        sample_rate,
        Mode::I | Mode::LRA | Mode::TRUE_PEAK | Mode::SAMPLE_PEAK,
    )
    .map_err(|e| format!("Could not initialize loudness meter: {e}"))?;
    let mut duration_frames: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                return Err("This stream requires a decoder reset".into())
            }
            Err(err) => return Err(format!("Error reading audio data: {err}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(format!("Error decoding audio: {err}")),
        };
        duration_frames += decoded.frames() as u64;
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        meter
            .add_frames_f32(samples.samples())
            .map_err(|e| format!("Loudness measurement failed: {e}"))?;
    }

    let integrated_lufs = meter
        .loudness_global()
        .map_err(|e| format!("Unable to calculate integrated loudness: {e}"))?;
    let loudness_range = meter.loudness_range().unwrap_or(0.0);
    let mut true_peak = 0.0_f64;
    for channel in 0..channels {
        true_peak = true_peak.max(meter.true_peak(channel).unwrap_or(0.0));
    }
    Ok(Analysis {
        integrated_lufs,
        loudness_range,
        true_peak_dbtp: db(true_peak),
        duration_seconds: duration_frames as f64 / sample_rate as f64,
        sample_rate,
        channels,
    })
}

#[tauri::command]
fn analyze_audio(path: String) -> Result<Analysis, String> {
    measure_file(Path::new(&path))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_audio])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
