
from pathlib import Path

import basic_pitch
from basic_pitch.inference import Model, predict


# try ONXX  ersion of the model
model_path = (
    Path(basic_pitch.__file__).parent
    / "saved_models"
    / "icassp_2022"
    / "nmp.onnx"
)

model = Model(model_path)


def transcribe_audio(audio_path):
    audio_path = Path(audio_path)

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    model_output, midi_data, note_events = predict(
        audio_path,
        model,
    )

    return midi_data, note_events