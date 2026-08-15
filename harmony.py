import copy
import json

import pretty_midi


def note_events_to_names(note_events):
    # Basic Pitch returns each note as an event containing informatio eg.
    # (start_time, end_time, midi_pitch, amplitude,  pitch_bends,)

    # Sorts the events accoridng to when they appear using the start time at position 0
    # eg event[0] retrieves the start time from each event
    sorted_events = sorted(
        note_events,
        key=lambda event: event[0],
    )

    # Loops through the sorted events and retrieves the MIDI pitch stored at position 2
    # cast the pitch to an int and convert it to a text name eg 60 becomes C4
    return [
        pretty_midi.note_number_to_name(
            int(event[2])
        )
        for event in sorted_events
    ]


def group_melody_notes(melody_notes, notes_per_chord):
    # Create groups of note for the prompt we send to Hugging Face
    # user selection in the app UI controls how many notes are placed in each group
    note_groups = []

    for index in range(
        0,
        len(melody_notes),
        notes_per_chord,
    ):
        # Get the next section of note names using the chosen group size
        group = melody_notes[index:index + notes_per_chord]
        # add group to a list
        note_groups.append(group)

    return note_groups


def group_note_events(note_events, notes_per_chord):
    # The user chooses how many melody notes should share one chord
    # each of these note groups gets a chord
    # We use the Basic Pitch event information to determine when each chord should begin and end
    # Sort the detected events using the start time data
    # This groups them in the order they are played originally
    sorted_events = sorted(
        note_events,
        key=lambda event: event[0],
    )

    event_groups = []

    for index in range(
        0,
        len(sorted_events),
        notes_per_chord,
    ):
        # Take the next group of events
        group = sorted_events[
            index:index + notes_per_chord
        ]

        # Store the group so its note timings can later be assigned to one chord
        event_groups.append(group)

    # Return the timed groups for use when constructing the MIDI chords
    return event_groups


def build_harmony_prompt(melody_notes, note_groups):
    # Building the instructions, melody groups and JSON template sent to Hugging Face
    json_template = {
        "estimated_key": "KEY_NAME",
        "chords": {
            f"Group_{index + 1}": "CHORD"
            for index in range(len(note_groups))
        },
    }

    all_notes = ", ".join(melody_notes)

    prompt = (
        "You are an expert music theory algorithm.\n"
        f"Full list of melody notes: {all_notes}\n\n"
        "Determine the most likely key signature.\n"
        "Assign one major or minor triad to each note group.\n"
        "Use the format 'Root:maj' or 'Root:min'.\n"
        "Do not use seventh chords or other chord types.\n"
        "Chord roots must not include octave numbers. "
        "Example: Use 'F#:min', not 'F#4:min'.\n\n"
    )

    # Number each group and add its notes to the prompt in a clear Group_1 format
    for index, group in enumerate(note_groups):
        group_text = "-".join(group)
        prompt += (
            f"Group_{index + 1} notes: "
            f"{group_text}\n"
        )

    # provide the required response structure to the prompt
    prompt += (
        "\nReturn only a JSON object matching "
        "this template:\n"
        f"{json.dumps(json_template)}"
    )

    return prompt


def request_harmony(client, prompt):
    # Extract the JSON text and convert it to a dictionary
    response = client.chat_completion(
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        max_tokens=500,
        temperature=0.1,
    )

    raw_output = response.choices[0].message.content

    # locate the braces
    json_start = raw_output.find("{")
    json_end = raw_output.rfind("}")

    if json_start == -1 or json_end == -1:
        raise ValueError(
            "Could not return valid JSON"
        )

    json_text = raw_output[
        json_start:json_end + 1
    ]
 # results should be something like  {"estimated_key": "D Major", "chords": {"Group_1": "D:maj"}}
    return json.loads(json_text)


def chord_to_midi_pitches(chord_name):
    # Convert a chord name into three MIDI pitches
    try:
        root_name, chord_quality = chord_name.split(
            ":",
            maxsplit=1,
        )
    except ValueError:
        raise ValueError(
            f"Invalid chord format: {chord_name}"
        )

    # filter out any unwanted octave data added that moght have been added
    root_name = root_name.rstrip("0123456789")
    # constrct hcords using these note intervals
    if chord_quality == "maj":
        intervals = [0, 4, 7]
    elif chord_quality == "min":
        intervals = [0, 3, 7]
    else:
        raise ValueError(
            f"Unsupported chord type: {chord_name}"
        )

    # Place the chord root in octave three as the baseline pitch register
    root_pitch = pretty_midi.note_name_to_number(
        f"{root_name}3"
    )

    return [
        root_pitch + interval
        for interval in intervals
    ]


def add_chords_to_midi(midi_data,note_event_groups,chord_dict,):
    # Copy the origianl melody MIDI and add the suggested chords as a separate guitar track
    harmonised_midi = copy.deepcopy(midi_data)

    chord_program = (
        pretty_midi.instrument_name_to_program(
            "Acoustic Guitar (nylon)"
        )
    )

    chord_track = pretty_midi.Instrument(
        program=chord_program,
        name="AI suggested chords",
    )

    # Loop through each timed group while keeping its position for the matching Group_1 chord
    for group_index, event_group in enumerate(
        note_event_groups
    ):
        group_name = f"Group_{group_index + 1}"
        chord_name = chord_dict.get(group_name)

        if not chord_name:
            continue

        # Start with the first melody note in the group.
        chord_start = float(event_group[0][0])

        # Finish when the final melody note in the group finishes.
        chord_end = max(
            float(event[1])
            for event in event_group
        )

        # failsafe for chord timings
        # If Basic Pitch produces invalid timings, make the chord last at least 0.5 seconds
        if chord_end <= chord_start:
            chord_end = chord_start + 0.5

        # Convert the text chord name into its three MIDI pitches
        # For example, C:maj (C,E,G)becomes [48, 52, 55] in MIDI
        chord_pitches = chord_to_midi_pitches(chord_name)

        # give them equal timing to make them sound together like a real chord and provide the chord info
        for pitch in chord_pitches:
            chord_note = pretty_midi.Note(
                velocity=50,
                pitch=pitch,
                start=chord_start,
                end=chord_end,
            )

            chord_track.notes.append(chord_note)

    harmonised_midi.instruments.append(
        chord_track
    )

    return harmonised_midi


def chord_transcription(midi_data,note_events,notes_per_chord,client,):
    # Run the full chord generation flow
    melody_notes = note_events_to_names(note_events)

    note_groups = group_melody_notes(
        melody_notes,
        notes_per_chord,
    )

    note_event_groups = group_note_events(
        note_events,
        notes_per_chord,
    )

    prompt = build_harmony_prompt(
        melody_notes,
        note_groups,
    )

    harmony_result = request_harmony(
        client,
        prompt,
    )

    chord_dict = harmony_result.get(
        "chords",
        {},
    )

    harmonised_midi = add_chords_to_midi(
        midi_data,
        note_event_groups,
        chord_dict,
    )

    return harmonised_midi, harmony_result
