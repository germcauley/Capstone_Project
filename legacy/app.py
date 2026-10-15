
from pathlib import Path
import base64
import tempfile
import streamlit as st
from huggingface_hub import InferenceClient
from audio_to_midi import transcribe_audio
from harmony import chord_transcription


@st.cache_resource
def load_api_client():
    # load and cache the Hugging Face client
    hf_token = st.secrets["HF_TOKEN"]

    return InferenceClient(
        model="Qwen/Qwen2.5-72B-Instruct",
        token=hf_token,
    )


# Embed MIDI bytes in an HTML player
def display_midi_player(midi_bytes):

    midi_base64 = base64.b64encode(
        midi_bytes
    ).decode("ascii")

    player_html = f"""
        <script src="https://cdn.jsdelivr.net/combine/npm/tone@14.7.58,npm/@magenta/music@1.23.1/es6/core.js,npm/focus-visible@5,npm/html-midi-player@1.5.0"></script>

        <midi-player
            id="midi-player"
            sound-font
            visualizer="#midi-visualizer">
        </midi-player>

        <midi-visualizer
            type="staff"
            id="midi-visualizer">
        </midi-visualizer>

        <script>
            const midiData = atob("{midi_base64}");

            const midiBytes = Uint8Array.from(
                midiData,
                character => character.charCodeAt(0)
            );

            const midiBlob = new Blob(
                [midiBytes],
                {{type: "audio/midi"}}
            );

            const midiUrl = URL.createObjectURL(
                midiBlob
            );

            document.getElementById(
                "midi-player"
            ).src = midiUrl;

            document.getElementById(
                "midi-visualizer"
            ).src = midiUrl;
        </script>

        <style>
            body {{
                background: white;
                color: black;
                margin: 0;
            }}

            midi-visualizer {{
                display: block;
                background: white;
            }}
        </style>
    """

    st.iframe(player_html, height=180)


st.title(
    "Audio to MIDI transcription and Harmonisation Pipeline"
)

audio_file = st.file_uploader(
    "Upload an audio file",
    type=["wav", "mp3"],
)


if audio_file is not None:
    st.audio(audio_file)

    notes_per_chord = st.selectbox(
        "How often should the chords change?",
        options=[2, 3, 4,5, 6,7, 8,9,10],
        index=1,
        format_func=lambda number: (
            f"Every {number} melody notes"
        ),
    )

    if st.button("Transcribe and harmonise"):
        try:
            with st.spinner("Processing audio..."):
                audio_suffix = (
                    Path(audio_file.name).suffix
                    or ".wav"
                )
                # temp file so basic pitch receives a filepath
                with tempfile.NamedTemporaryFile(
                    suffix=audio_suffix,
                    delete=False,
                ) as temp_audio:
                    temp_audio.write(
                        audio_file.getvalue()
                    )
                    audio_path = Path(
                        temp_audio.name
                    )

                midi_data, note_events = (
                    transcribe_audio(audio_path)
                )

                if not note_events:
                    raise ValueError(
                        "Basic Pitch did not detect any notes."
                    )

                # Save the Basic Pitch audio to MIDI transcription and read its bytes for browser playback
                midi_path = Path(
                    "transcribed_melody.mid"
                )
                midi_data.write(str(midi_path))
                midi_bytes = midi_path.read_bytes()



            st.subheader("Original MIDI transcription")
            display_midi_player(midi_bytes)
            
            st.download_button(
                label="Download original MIDI",
                data=midi_bytes,
                file_name="transcribed_melody.mid",
                mime="audio/midi",
            )

            with st.spinner(
                "Generating chord suggestions..."
            ):
                client = load_api_client()
                # Run the complete harmony module using the Basic Pitch result
                harmonised_midi,harmony_result = chord_transcription(
                    midi_data,
                    note_events,
                    notes_per_chord,
                    client,
                )

            harmonised_path = Path(
                "harmonised_melody.mid"
            )
            harmonised_midi.write(
                str(harmonised_path)
            )

            harmonised_bytes = (
                harmonised_path.read_bytes()
            )
            estimated_key = harmony_result.get(
                "estimated_key",
                "Unknown",
            )

            st.info(
                f"Estimated key: {estimated_key}"
            )
            
            st.subheader(
                "Melody with chord accompaniment"
            )
            display_midi_player(
                harmonised_bytes
            )
            st.download_button(
                label="Download harmonised MIDI",
                data=harmonised_bytes,
                file_name="harmonised_melody.mid",
                mime="audio/midi",
            )

        except Exception as error:
            st.error(
                f"Could not complete processing: "
                f"{error}"
            )
