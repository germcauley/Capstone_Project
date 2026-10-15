import streamlit as st
import json
from huggingface_hub import InferenceClient

# testing use of the HF api for inferance and chord and key suggestions

@st.cache_resource
def load_api_client():
    HF_TOKEN = st.secrets["HF_TOKEN"]
    
    return InferenceClient(
        model="Qwen/Qwen2.5-72B-Instruct", 
        token=HF_TOKEN
    )

st.title("Add chords to a melody")

# manually input melody notes for now, replace with midi notes in v2
melody_input = st.text_input(
    "Melody notes",
    value="",
    placeholder="Input notes separated by commas, e.g. g,b,d,c,e,g",
)

# user sets the nmbre of notes to be used to determine a chord
notes_per_chord = st.selectbox(
    "How often should the chord change?",
    options=[2, 3, 4, 6, 8],
    index=1,
    format_func=lambda number: f"Every {number} melody notes",
)

if st.button("Suggest chords"):
    # Convert the text into a list of individual notes
    melody_notes = [note.strip() for note in melody_input.split(",") if note.strip()]
    
    # check if empty
    if not melody_notes:
        st.warning("Please enter at least a few melody notes first!")
    else:
        # load API client
        client = load_api_client()

        with st.spinner("Hugging Face Cloud is analysing..."):
            
            # Group notes based on user selection
            grouped_notes = []
            for index in range(0, len(melody_notes), notes_per_chord):
                note_group = melody_notes[index : index + notes_per_chord]
                grouped_notes.append("-".join(note_group))

            # template for the output
            json_template = {
                "estimated_key": "KEY_NAME",
                "chords": {f"Group_{i+1}": "CHORD" for i in range(len(grouped_notes))}
            }

            all_notes_string = ", ".join(melody_notes)

            # master prompt
            prompt = (
                "You are an expert music theory algorithm.\n"
                f"Full melody notes: {all_notes_string}\n\n"
                "1. Analyse all notes together to determine the most likely Key Signature (e.g. 'C Major' or 'A Minor').\n"
                "2. Assign a harmonising chordal triad ('Root:maj' or 'Root:min') for each group of notes. DO NOT use 7th chords or any other type of chord.\n\n"
                "EXAMPLE OUTPUT\n"
                '{"estimated_key": "C Major", "chords": {"Group_1": "C:maj", "Group_2": "A:min"}}\n\n'
            )
            
            # create note groups and heir position
            for i, group in enumerate(grouped_notes):
                # add each group to the prompt
                prompt += f"Group_{i+1} notes: {group}\n"

            # add final output instructions, placeholders are replaced
            prompt += (
                f"\nReturn ONLY a JSON object matching this exact template, replacing KEY_NAME and CHORD:\n"
                f"{json.dumps(json_template)}"
            )

            # final messaage for the api
            messages = [{"role": "user", "content": prompt}]

            try:
                # send prompt to the api
                response = client.chat_completion(
                    messages=messages,
                    max_tokens=500, 
                    temperature=0.1,    
                )

                # extract text from the response
                raw_output = response.choices[0].message.content

                # Parse the json
                clean_text = raw_output.strip().strip("```json").strip("```").strip()
                result_data = json.loads(clean_text)
                
                # extract results
                estimated_key = result_data.get("estimated_key", "Unknown Key")
                chord_dict = result_data.get("chords", {})
                
                st.success("Chords generated successfuly!")
                
                # show estimated key
                st.info(f"🎼 **Estimated Key:** {estimated_key}")
                
                #show  suggestedchords
                st.write("### Chord Progression")
                chord_list = list(chord_dict.values())
                for group_number, (notes, chord) in enumerate(zip(grouped_notes, chord_list), start=1):
                    st.write(f"**Group {group_number}** ({notes}) ➔ **{chord}**")
                    
            except json.JSONDecodeError:
                st.error("Failed to parse the AI output:")
                st.code(raw_output)
            except Exception as e:
                st.error(f"An error occurred: {e}")