
from pathlib import Path
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import Model, predict

# Load the Basic Pitch model once
model = Model(ICASSP_2022_MODEL_PATH)


def transcribe_audio(audio_path):
    # Check that the audio file exists
    audio_path = Path(audio_path)

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Convert the audio into MIDI and note events
    model_output, midi_data, note_events = predict(
        audio_path,
        model,
    )

    return midi_data, note_events