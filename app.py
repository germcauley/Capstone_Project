import streamlit as st

st.write("test")

st.title("Capstone project Audio upload > MIDI > Harmony generation")

audio_file =st.file_uploader("Upload an audio file", type=["wav", "mp3"])

if audio_file is not None:
    st.audio(audio_file, format='audio/wav')
    st.success("File uploaded!") 