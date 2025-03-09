import azure.cognitiveservices.speech as speechsdk

speech_config = speechsdk.SpeechConfig(subscription="86uN49qhSE9I9BK1kYljff9rdqFdUac2pbiyHj1vg0uNG6yIYGOZJQQJ99BBAC5RqLJXJ3w3AAAYACOG6Nkm", region="westeurope")
speech_config.speech_synthesis_voice_name = "en-US-EmmaNeural"
audio_config = speechsdk.audio.AudioOutputConfig(filename="test_john.mp3")
synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
result = synthesizer.speak_text_async("Hello, I am John.").get()
if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
    print("Success!")
else:
    print(f"Failed: {result.reason}, {getattr(result, 'error_details', 'No details')}")