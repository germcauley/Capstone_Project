import tempfile # required for Baisc pitch processsing
from pathlib import Path
import streamlit as st
import base64

from audio_to_midi import transcribe_audio


def display_midi_player(midi_bytes):
    # convert the midi to base64 so it can be embedded in the html player
    midi_base64 = base64.b64encode(midi_bytes).decode("ascii")

    # embed the midi player and visualizer in the Streamlit app
    player_html = f"""
        <script src="https://cdn.jsdelivr.net/combine/npm/tone@14.7.58,npm/@magenta/music@1.23.1/es6/core.js,npm/html-midi-player@1.5.0"></script>

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
            character => character.charCodeAt(0));

        const midiBlob = new Blob(
            [midiBytes],
            {{ type: "audio/midi" }}
        );

        const midiUrl = URL.createObjectURL(midiBlob);

        document.getElementById("midi-player").src = midiUrl;
        document.getElementById("midi-visualizer").src = midiUrl;
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

    st.iframe(player_html, height=300)


st.title("Capstone project Audio upload > MIDI > Harmony generation")

audio_file =st.file_uploader("Upload an audio file", type=["wav", "mp3"])

if audio_file is not None:
    st.audio(audio_file, format='audio/wav')
    st.success("File uploaded!") 
    
    if st.button("Convert to MIDI"):
        try:
            with st.spinner("Processing audio..."):
                # save the uploaded audio temporarily
                with tempfile.NamedTemporaryFile(
                    suffix=".wav",
                    delete=False,
                ) as temp_audio:
                    temp_audio.write(audio_file.getvalue())
                    audio_path = Path(temp_audio.name)

                # transcribe using basic pitch processing
                midi_data, note_events = transcribe_audio(audio_path)

                # save the midi data to a file
                midi_path = Path("transcribed_melody.mid")
                midi_data.write(str(midi_path))

            st.success(
                f"Conversion complete. Detected {len(note_events)} notes."
            )

            # allow the user to download the midi file
            midi_bytes = midi_path.read_bytes()

            st.subheader("Converted MIDI playback")
            display_midi_player(midi_bytes)

            st.download_button(
                "Download MIDI",
                data=midi_bytes,
                file_name="transcribed_melody.mid",
                mime="audio/midi",
            )

        except Exception as error:
            st.error(f"Could not process the audio: {error}")