import tempfile # required for Baisc pitch processsing
from pathlib import Path
import streamlit as st

from audio_to_midi import transcribe_audio


st.write("test")

st.title("Capstone project Audio upload > MIDI > Harmony generation")

audio_file =st.file_uploader("Upload an audio file", type=["wav", "mp3"])

if audio_file is not None:
    st.audio(audio_file, format='audio/wav')
    st.success("File uploaded!") 
    
    if st.button("Convert to MIDI"):
        try:
            with st.spinner("Processing audio..."):
                # Save the uploaded audio temporarily
                with tempfile.NamedTemporaryFile(
                    suffix=".wav",
                    delete=False,
                ) as temp_audio:
                    temp_audio.write(audio_file.getvalue())
                    audio_path = Path(temp_audio.name)

                # Run Basic Pitch
                midi_data, note_events = transcribe_audio(audio_path)

                # Save the MIDI output
                midi_path = Path("transcribed_melody.mid")
                midi_data.write(str(midi_path))

            st.success(
                f"Conversion complete. Detected {len(note_events)} notes."
            )

            # Let the user download the MIDI file
            with open(midi_path, "rb") as midi_file:
                st.download_button(
                    "Download MIDI",
                    data=midi_file.read(),
                    file_name="transcribed_melody.mid",
                    mime="audio/midi",
                )

        except Exception as error:
            st.error(f"Could not process the audio: {error}")