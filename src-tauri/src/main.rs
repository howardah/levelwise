#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ebur128::{EbuR128, Mode};
use serde::Serialize;
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::{AudioBufferRef, SampleBuffer, Signal},
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
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
fn measure_file(mut progress: impl FnMut(u8), path: &Path) -> Result<Analysis, String> {
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
    let total_frames = track.codec_params.n_frames;
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
    let mut last_progress = 0;
    // Most compressed formats decode to f32. Pass those planar buffers straight to the meter;
    // for other sample formats this buffer is retained and reused rather than allocated per packet.
    let mut converted_samples: Option<SampleBuffer<f32>> = None;
    progress(2);

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
        if let Some(total_frames) = total_frames {
            let percentage =
                ((duration_frames.saturating_mul(95) / total_frames.max(1)) + 2).min(97) as u8;
            // Avoid flooding the WebView event queue while still making the bar feel live.
            if percentage >= last_progress + 1 {
                progress(percentage);
                last_progress = percentage;
            }
        }
        match decoded {
            AudioBufferRef::F32(buffer) => {
                let mut planar_samples = smallvec::SmallVec::<[&[f32]; 8]>::new();
                for channel in 0..channels as usize {
                    planar_samples.push(buffer.chan(channel));
                }
                meter
                    .add_frames_planar_f32(&planar_samples)
                    .map_err(|e| format!("Loudness measurement failed: {e}"))?;
            }
            decoded => {
                let required_capacity = decoded.capacity() * channels as usize;
                if converted_samples
                    .as_ref()
                    .is_none_or(|buffer| buffer.capacity() < required_capacity)
                {
                    converted_samples = Some(SampleBuffer::<f32>::new(
                        decoded.capacity() as u64,
                        *decoded.spec(),
                    ));
                }
                let samples = converted_samples
                    .as_mut()
                    .expect("conversion buffer is initialized");
                samples.copy_interleaved_ref(decoded);
                meter
                    .add_frames_f32(samples.samples())
                    .map_err(|e| format!("Loudness measurement failed: {e}"))?;
            }
        }
    }

    let integrated_lufs = meter
        .loudness_global()
        .map_err(|e| format!("Unable to calculate integrated loudness: {e}"))?;
    let loudness_range = meter.loudness_range().unwrap_or(0.0);
    let mut true_peak = 0.0_f64;
    for channel in 0..channels {
        true_peak = true_peak.max(meter.true_peak(channel).unwrap_or(0.0));
    }
    progress(100);
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
async fn analyze_audio(window: tauri::Window, path: String) -> Result<Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        measure_file(
            |percentage| {
                let _ = window.emit("analysis-progress", percentage);
            },
            Path::new(&path),
        )
    })
    .await
    .map_err(|error| format!("Analysis task failed: {error}"))?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_audio])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
